import { randomBytes } from 'node:crypto';
import { expectAtLeast, expectEq, printLines, runStandalone } from './lib/demo-output';
import { makeTraceparent, newTraceId, parseLogLines, request, settle, startObsServer, traceIdOf } from './lib/obs-demo-kit';

const BURST = 12;

runStandalone(async (failures) => {
    const server = await startObsServer();
    try {
        const header = makeTraceparent(newTraceId());
        const singleFrom = server.lines.length;
        const checkout = await request(
            server.port,
            'POST',
            '/orders/checkout',
            { traceparent: header, authorization: 'Bearer demo-token', 'x-tenant': 'acme', 'idempotency-key': 'demo-logs-1' },
            { items: [{ sku: 'demo', qty: 1 }] },
        );
        await settle(server.lines);
        const single = parseLogLines(server.lines.slice(singleFrom)).rows;
        const singleIds = new Set(single.map((row) => row.trace_id ?? '(none)'));
        const layers = new Set(single.map((row) => row.layer).filter(Boolean)).size;
        const matchesHeader = singleIds.size === 1 && singleIds.has(traceIdOf(header)) ? 1 : 0;

        const sent = Array.from({ length: BURST }, () => makeTraceparent(newTraceId()));
        const sentIds = sent.map(traceIdOf);
        const burstFrom = server.lines.length;
        await Promise.all(sent.map((traceparent) => request(server.port, 'GET', '/orders/42', { traceparent, 'x-tenant': 'acme' })));
        await settle(server.lines);
        const groups = new Map<string, number>();
        for (const row of parseLogLines(server.lines.slice(burstFrom)).rows) {
            const key = row.trace_id ?? '(none)';
            groups.set(key, (groups.get(key) ?? 0) + 1);
        }
        const sizes = [...groups.values()];
        const uneven = sizes.length === 0 ? Number.POSITIVE_INFINITY : Math.max(...sizes) - Math.min(...sizes);
        const matchedSent = sentIds.filter((id) => groups.has(id)).length;

        const bearer = `secret-${randomBytes(8).toString('hex')}`;
        const password = `secret-${randomBytes(8).toString('hex')}`;
        const nestedPassword = `secret-${randomBytes(8).toString('hex')}`;
        const apiKey = `secret-${randomBytes(8).toString('hex')}`;
        const queryToken = `secret-${randomBytes(8).toString('hex')}`;
        await request(
            server.port,
            'POST',
            `/auth/login?token=${queryToken}`,
            { authorization: `Bearer ${bearer}`, 'x-api-key': apiKey },
            { email: 'demo@example.com', password, user: { password: nestedPassword } },
        );
        await settle(server.lines);

        const all = parseLogLines(server.lines);
        const secretReqLogged = all.rows.some((row) => row.msg === 'request' && String(row.req?.url).startsWith('/auth/login')) ? 1 : 0;
        const markers = [bearer, password, nestedPassword, apiKey, queryToken];
        const secretInLogs = server.lines.filter((line) => markers.some((marker) => line.includes(marker))).length;

        printLines({
            'non-json-lines': all.nonJson,
            layers,
            'distinct-trace-ids': singleIds.size,
            'trace-id-matches-header': matchesHeader,
            burst: BURST,
            'burst-trace-ids': groups.size,
            'burst-uneven': uneven,
            'secret-req-logged': secretReqLogged,
            'secret-in-logs': secretInLogs,
        });

        expectEq(failures, 'checkout status', checkout.status, 201);
        expectEq(failures, 'non-json-lines', all.nonJson, 0);
        expectAtLeast(failures, 'layers', layers, 3);
        expectEq(failures, 'distinct-trace-ids', singleIds.size, 1);
        expectEq(failures, 'trace-id-matches-header', matchesHeader, 1);
        expectAtLeast(failures, 'burst', BURST, 8);
        expectEq(failures, 'burst-trace-ids', groups.size, BURST);
        expectEq(failures, 'sent ids found in logs', matchedSent, BURST);
        expectEq(failures, 'burst-uneven', uneven, 0);
        expectEq(failures, 'secret-req-logged', secretReqLogged, 1);
        expectEq(failures, 'secret-in-logs', secretInLogs, 0);
    } finally {
        await server.stop();
    }
});
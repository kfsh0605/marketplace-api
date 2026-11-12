import './lib/demo-client-env';
import { flushTraces, shutdownTracing } from './observability/tracing';
import { trace } from '@opentelemetry/api';
import { expectAtLeast, expectEq, printLines, runStandalone } from './lib/demo-output';
import { LogRow, ObsServer, request, settle, startObsServer } from './lib/obs-demo-kit';
import { sleep } from './lib/sleep';

interface JaegerSpan {
    spanID: string;
    traceID: string;
    operationName: string;
    references: Array<{ refType: string; spanID: string }>;
    tags: Array<{ key: string; value: unknown }>;
}

interface Scenario {
    rootTraceId: string;
    status: number;
    requestRow: LogRow | undefined;
}

const TRACEPARENT = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;
const tracer = trace.getTracer('demo-trace');
const traceApi = (): string => process.env.TRACE_API_URL ?? 'http://127.0.0.1:22904';

const tagOf = (span: JaegerSpan, key: string): unknown => span.tags.find((tag) => tag.key === key)?.value;
const serverSpanOf = (spans: JaegerSpan[]): JaegerSpan | undefined => spans.find((span) => tagOf(span, 'span.kind') === 'server');
const isError = (span: JaegerSpan): boolean => tagOf(span, 'otel.status_code') === 'ERROR' || tagOf(span, 'error') === true;

async function runScenario(
    server: ObsServer,
    name: string,
    method: string,
    path: string,
    body?: unknown,
): Promise<Scenario> {
    const outcome = await tracer.startActiveSpan(name, async (span) => {
        try {
            const result = await request(server.port, method, path, { 'x-tenant': 'acme', 'idempotency-key': `demo-trace-${name}` }, body);
            return { status: result.status, rootTraceId: span.spanContext().traceId };
        } finally {
            span.end();
        }
    });
    await settle(server.lines);
    const requestRow = server.lines
        .map((line) => {
            try {
                return JSON.parse(line) as LogRow;
            } catch {
                return undefined;
            }
        })
        .find((row) => row?.msg === 'request' && row.req?.url === path);
    return { ...outcome, requestRow };
}

async function fetchTrace(traceId: string | undefined, minSpans: number): Promise<JaegerSpan[]> {
    if (!traceId) {
        return [];
    }
    const deadline = Date.now() + 20000;
    let spans: JaegerSpan[] = [];
    let changedAt = Date.now();
    while (Date.now() < deadline) {
        const response = await fetch(`${traceApi()}/api/traces/${traceId}`).catch(() => undefined);
        if (response?.ok) {
            const payload: any = await response.json();
            const current: JaegerSpan[] = payload?.data?.[0]?.spans ?? [];
            if (current.length !== spans.length) {
                spans = current;
                changedAt = Date.now();
            } else if (spans.length >= minSpans && Date.now() - changedAt >= 1500) {
                return spans;
            }
        }
        await sleep(300);
    }
    return spans;
}

runStandalone(async (failures) => {
    const server = await startObsServer();
    try {
        const ok = await runScenario(server, 'checkout', 'POST', '/orders/checkout', { items: [{ sku: 'demo', qty: 1 }] });
        const fail = await runScenario(server, 'boom', 'GET', '/orders/boom');
        const missing = await runScenario(server, 'missing', 'GET', '/orders/missing');

        await flushTraces().catch((error: Error) => failures.push(`flushTraces: ${error.message}`));

        const okLogTraceId: string | undefined = ok.requestRow?.trace_id;
        const okSpans = await fetchTrace(okLogTraceId, 2);
        const failSpans = await fetchTrace(fail.requestRow?.trace_id, 2);
        const missingSpans = await fetchTrace(missing.requestRow?.trace_id, 2);

        const okServer = serverSpanOf(okSpans);
        const ids = new Set(okSpans.map((span) => span.spanID));
        const orphans = okSpans.filter((span) => span.references.some((ref) => ref.refType === 'CHILD_OF' && !ids.has(ref.spanID))).length;

        const header: string | undefined = ok.requestRow?.req?.headers?.traceparent;
        const headerTraceId = header ? TRACEPARENT.exec(header)?.[1] : undefined;
        const matchesHeader = okServer && headerTraceId && headerTraceId === okServer.traceID ? 1 : 0;

        const repoRow = server.lines
            .map((line) => {
                try {
                    return JSON.parse(line) as LogRow;
                } catch {
                    return undefined;
                }
            })
            .find((row) => row?.layer === 'orders.repo' && row.trace_id === okLogTraceId && row.span_id);
        const repoSpan = repoRow ? okSpans.find((span) => span.spanID === repoRow.span_id) : undefined;
        const matchesLog = repoRow && repoSpan && repoSpan.traceID === repoRow.trace_id ? 1 : 0;

        const failServer = serverSpanOf(failSpans);
        const missingServer = serverSpanOf(missingSpans);
        const statusError = failServer && isError(failServer) ? 1 : 0;

        printLines({
            spans: okSpans.length,
            'orphan-spans': orphans,
            'trace-matches-header': matchesHeader,
            'trace-matches-log': matchesLog,
            'span-status-error': statusError,
        });

        expectEq(failures, 'checkout status', ok.status, 201);
        expectEq(failures, 'boom status', fail.status, 500);
        expectEq(failures, 'missing status', missing.status, 404);
        expectAtLeast(failures, 'spans', okSpans.length, 2);
        expectEq(failures, 'orphan-spans', orphans, 0);
        expectEq(failures, 'trace-matches-header', matchesHeader, 1);
        expectEq(failures, 'trace-matches-log', matchesLog, 1);
        expectEq(failures, 'span-status-error', statusError, 1);
        expectEq(failures, 'client trace continued by server', headerTraceId, ok.rootTraceId);
        expectEq(failures, '4xx server span is not ERROR', missingServer ? isError(missingServer) : undefined, false);
    } finally {
        await server.stop();
        await shutdownTracing().catch(() => undefined);
    }
});
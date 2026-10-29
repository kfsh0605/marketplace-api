import { cleanupDemoData, createDemoUser, DEMO_PASSWORD, runTag, startDemoApp, tokenOf } from './lib/auth-demo-kit';
import { expectEq, printLines, runStandalone } from './lib/demo-output';

void runStandalone(async (failures) => {
    const app = await startDemoApp();
    const email = `${runTag('reuse')}@example.com`;

    try {
        const user = await createDemoUser(app.dataSource, email, 'customer');

        const login = await app.call('POST', '/auth/login', { body: { email, password: DEMO_PASSWORD } });
        const r1 = tokenOf(login, 'refreshToken');

        const r1Refresh = await app.call('POST', '/auth/refresh', { body: { refreshToken: r1 } });
        const r2 = tokenOf(r1Refresh, 'refreshToken');
        const accessBeforeReuse = await app.call('GET', '/orders', { token: tokenOf(r1Refresh, 'accessToken') });

        const r1Reuse = await app.call('POST', '/auth/refresh', { body: { refreshToken: r1 } });
        const r2AfterReuse = await app.call('POST', '/auth/refresh', { body: { refreshToken: r2 } });
        const accessAfterReuse = await app.call('GET', '/orders', { token: tokenOf(r1Refresh, 'accessToken') });

        printLines({
            login: login.status,
            'r1-refresh': r1Refresh.status,
            'r1-reuse': r1Reuse.status,
            'r2-after-reuse': r2AfterReuse.status,
        });

        expectEq(failures, 'login', login.status, 200);
        expectEq(failures, 'r1-refresh', r1Refresh.status, 200);
        expectEq(failures, 'r1-reuse', r1Reuse.status, 401);
        expectEq(failures, 'r2-after-reuse', r2AfterReuse.status, 401);
        expectEq(failures, 'access сім\'ї до повтору працював', accessBeforeReuse.status, 200);
        expectEq(failures, 'access сім\'ї після повтору відхилено', accessAfterReuse.status, 401);

        const alive: Array<{ n: number }> = await app.dataSource.query(
            `SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`,
            [user.id],
        );
        expectEq(failures, 'жива refresh-сім\'я після повтору', alive[0].n, 0);
    } finally {
        const leftovers = await cleanupDemoData(app.dataSource, [email], []).catch((error: Error) => {
            failures.push(`cleanup: ${error.message}`);
            return 0;
        });
        expectEq(failures, 'залишки демо-даних після cleanup', leftovers, 0);
        await app.stop().catch(() => undefined);
    }
});
import { cleanupDemoData, createDemoUser, DEMO_PASSWORD, runTag, startDemoApp, tokenOf } from './lib/auth-demo-kit';
import { expectEq, printLines, runStandalone } from './lib/demo-output';

void runStandalone(async (failures) => {
    const app = await startDemoApp();
    const email = `${runTag('auth')}@example.com`;

    try {
        const user = await createDemoUser(app.dataSource, email, 'customer');

        const login = await app.call('POST', '/auth/login', { body: { email, password: DEMO_PASSWORD } });
        const noToken = await app.call('GET', '/orders');
        const withToken = await app.call('GET', '/orders', { token: tokenOf(login, 'accessToken') });
        const refresh = await app.call('POST', '/auth/refresh', { body: { refreshToken: tokenOf(login, 'refreshToken') } });
        const logout = await app.call('POST', '/auth/logout', { token: tokenOf(refresh, 'accessToken') });
        const afterLogout = await app.call('GET', '/orders', { token: tokenOf(refresh, 'accessToken') });
        const refreshAfterLogout = await app.call('POST', '/auth/refresh', {
            body: { refreshToken: tokenOf(refresh, 'refreshToken') },
        });

        printLines({
            login: login.status,
            'no-token': noToken.status,
            'with-token': withToken.status,
            refresh: refresh.status,
            logout: logout.status,
            'after-logout': afterLogout.status,
            'refresh-after-logout': refreshAfterLogout.status,
        });

        expectEq(failures, 'login', login.status, 200);
        expectEq(failures, 'no-token', noToken.status, 401);
        expectEq(failures, 'with-token', withToken.status, 200);
        expectEq(failures, 'refresh', refresh.status, 200);
        expectEq(failures, 'logout', [200, 204].includes(logout.status), true);
        expectEq(failures, 'after-logout', afterLogout.status, 401);
        expectEq(failures, 'refresh-after-logout', refreshAfterLogout.status, 401);

        const alive: Array<{ n: number }> = await app.dataSource.query(
            `SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`,
            [user.id],
        );
        expectEq(failures, 'жива refresh-сім\'я після logout', alive[0].n, 0);
    } finally {
        const leftovers = await cleanupDemoData(app.dataSource, [email], []).catch((error: Error) => {
            failures.push(`cleanup: ${error.message}`);
            return 0;
        });
        expectEq(failures, 'залишки демо-даних після cleanup', leftovers, 0);
        await app.stop().catch(() => undefined);
    }
});
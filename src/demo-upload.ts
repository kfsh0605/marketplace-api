import { randomBytes, randomUUID } from 'node:crypto';
import { createDemoUser, DEMO_PASSWORD, runTag, startDemoApp, tokenOf } from './lib/auth-demo-kit';
import { expectEq, printLines, runStandalone } from './lib/demo-output';
import { purgeDemoUploads } from './lib/files-demo-kit';
import { isPortOpen } from './lib/net-probe';
import { putFromKeylessProcess } from './lib/offline-put';
import { sleep } from './lib/sleep';
import { loadStorageConfig } from './storage/storage.config';
import { StorageService } from './storage/storage.service';

const PAYLOAD_BYTES = 64 * 1024;
const CONTENT_TYPE = 'image/png';
const MALICIOUS_FILENAME = '../../etc/passwd';
const SHORT_TTL_SECONDS = 2;
const EXPIRY_WAIT_MS = 3200;
const DEMO_EMAIL_PATTERN = 'demo-upload-%';

async function putWithFetch(url: string, contentType: string, body: Buffer): Promise<number> {
    const response = await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': contentType },
        body: new Uint8Array(body),
    });
    await response.arrayBuffer();
    return response.status;
}

void runStandalone(async (failures) => {
    const storage = new StorageService(loadStorageConfig());
    await storage.ensureBucket();

    let app = await startDemoApp();
    const email = `${runTag('upload')}@example.com`;
    const payload = randomBytes(PAYLOAD_BYTES);
    const knownKeys: string[] = [];

    try {
        await purgeDemoUploads(app.dataSource, storage, DEMO_EMAIL_PATTERN);

        const user = await createDemoUser(app.dataSource, email, 'customer');
        const login = await app.call('POST', '/auth/login', { body: { email, password: DEMO_PASSWORD } });
        const token = tokenOf(login, 'accessToken');

        const anon = await app.call('POST', '/uploads/intent', { body: { contentType: CONTENT_TYPE } });

        const intent = await app.call('POST', '/uploads/intent', {
            token,
            body: { contentType: CONTENT_TYPE, size: payload.length, filename: MALICIOUS_FILENAME },
        });
        const fileId: string = intent.body?.fileId ?? '';
        const key: string = intent.body?.key ?? '';
        const url: string = intent.body?.url ?? '';
        knownKeys.push(key);

        const keyShape = new RegExp(`^uploads/${user.id}/[0-9a-f-]{36}\\.png$`);
        const keyFromServer = keyShape.test(key) && !key.includes('passwd') && !key.includes('..') ? 1 : 0;

        const unused = await app.call('POST', '/uploads/intent', {
            token,
            body: { contentType: CONTENT_TYPE, size: payload.length },
        });
        knownKeys.push(unused.body?.key ?? '');
        const commitWithoutBytes = await app.call('POST', '/uploads/commit', {
            token,
            body: { fileId: unused.body?.fileId },
        });
        const contentTypeSwap = await putWithFetch(unused.body?.url ?? '', 'text/html', payload);

        expectEq(failures, 'підготовка: URL містить ключ', url.includes(key), true);
        const forgedKey = key.replace(/[0-9a-f-]{36}/, randomUUID());
        const tampered = await putWithFetch(url.replace(key, forgedKey), CONTENT_TYPE, payload);

        const aliveBefore = (await isPortOpen(app.port)) ? 1 : 0;
        const stoppedPort = app.port;
        await app.stop();
        const apiAlive = (await isPortOpen(stoppedPort)) ? 1 : 0;
        const putOffline = putFromKeylessProcess(url, CONTENT_TYPE, payload);

        app = await startDemoApp();
        const commit = await app.call('POST', '/uploads/commit', { token, body: { fileId } });

        const redirect = await fetch(`http://127.0.0.1:${app.port}/files/${fileId}`, {
            headers: { authorization: `Bearer ${token}` },
            redirect: 'manual',
        });
        const location = redirect.headers.get('location');
        const downloaded = location ? Buffer.from(await (await fetch(location)).arrayBuffer()) : Buffer.alloc(0);

        const expiredKey = `uploads/${user.id}/${randomUUID()}.png`;
        knownKeys.push(expiredKey);
        const shortUrl = await storage.presignPut(expiredKey, CONTENT_TYPE, SHORT_TTL_SECONDS);
        const freshShort = await putWithFetch(shortUrl, CONTENT_TYPE, payload);
        await sleep(EXPIRY_WAIT_MS);
        const expired = await putWithFetch(shortUrl, CONTENT_TYPE, payload);

        printLines({
            'intent-anon': anon.status,
            intent: intent.status,
            'key-from-server': keyFromServer,
            'api-alive-before': aliveBefore,
            'api-alive': apiAlive,
            'put-offline': putOffline,
            commit: commit.status,
            'commit-without-bytes': commitWithoutBytes.status,
            'content-type-swap': contentTypeSwap,
            tampered,
            'fresh-short-url': freshShort,
            expired,
            'download-redirect': redirect.status,
            'download-no-store': redirect.headers.get('cache-control') === 'no-store' ? 1 : 0,
            'download-match': Buffer.compare(downloaded, payload) === 0 ? 1 : 0,
        });

        expectEq(failures, 'intent-anon', anon.status, 401);
        expectEq(failures, 'intent', intent.status, 200);
        expectEq(failures, 'key-from-server', keyFromServer, 1);
        expectEq(failures, 'api-alive-before', aliveBefore, 1);
        expectEq(failures, 'api-alive', apiAlive, 0);
        expectEq(failures, 'put-offline', putOffline, 200);
        expectEq(failures, 'commit', commit.status, 200);
        expectEq(failures, 'commit: статус COMPLETED', commit.body?.status, 'COMPLETED');
        expectEq(failures, 'commit: розмір зі сховища', commit.body?.size, payload.length);
        expectEq(
            failures,
            'commit-without-bytes: будь-який 4xx',
            commitWithoutBytes.status >= 400 && commitWithoutBytes.status < 500,
            true,
        );
        expectEq(failures, 'content-type-swap', contentTypeSwap, 403);
        expectEq(failures, 'tampered', tampered, 403);
        expectEq(failures, 'fresh-short-url', freshShort, 200);
        expectEq(failures, 'expired', expired, 403);
        expectEq(failures, 'download-redirect', redirect.status, 302);
        expectEq(failures, 'download-no-store', redirect.headers.get('cache-control'), 'no-store');
        expectEq(failures, 'download-match', Buffer.compare(downloaded, payload), 0);
    } finally {
        const leftovers = await purgeDemoUploads(app.dataSource, storage, DEMO_EMAIL_PATTERN).catch(
            (error: Error) => {
                failures.push(`cleanup: ${error.message}`);
                return -1;
            },
        );
        for (const key of knownKeys.filter(Boolean)) {
            await storage.delete(key).catch(() => undefined);
        }
        const survivors: string[] = [];
        for (const key of knownKeys.filter(Boolean)) {
            if ((await storage.head(key).catch(() => null)) !== null) {
                survivors.push(key);
            }
        }
        expectEq(failures, 'залишки демо-користувачів після cleanup', leftovers, 0);
        expectEq(failures, 'залишки об\'єктів у сховищі після cleanup', survivors.length, 0);
        await app.stop().catch(() => undefined);
        storage.client.destroy();
    }
});
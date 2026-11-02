import { createHash } from 'node:crypto';
import { MIB } from './files/multipart-plan';
import { createDemoUser, DEMO_PASSWORD, runTag, startDemoApp, tokenOf } from './lib/auth-demo-kit';
import { expectEq, printLines, runStandalone } from './lib/demo-output';
import { purgeDemoUploads } from './lib/files-demo-kit';
import { makePayload } from './lib/multipart-client';
import { runMultipartChild, uploadedCountOf } from './lib/multipart-runner';
import { loadStorageConfig } from './storage/storage.config';
import { StorageService } from './storage/storage.service';

const TOTAL_BYTES = 11 * MIB;
const PARTS_BEFORE_CRASH = 2;
const DEMO_EMAIL_PATTERN = 'demo-multipart-%';

void runStandalone(async (failures) => {
    const storage = new StorageService(loadStorageConfig());
    await storage.ensureBucket();

    const app = await startDemoApp();
    const email = `${runTag('multipart')}@example.com`;
    const apiBase = `http://127.0.0.1:${app.port}`;
    let key = '';
    let keyPrefix = '';

    try {
        await purgeDemoUploads(app.dataSource, storage, DEMO_EMAIL_PATTERN);

        const user = await createDemoUser(app.dataSource, email, 'customer');
        keyPrefix = `uploads/${user.id}/`;
        const login = await app.call('POST', '/auth/login', { body: { email, password: DEMO_PASSWORD } });
        const token = tokenOf(login, 'accessToken');
        const payload = makePayload(TOTAL_BYTES);

        const intent = await app.call('POST', '/uploads/intent', {
            token,
            body: { contentType: 'application/gzip', size: TOTAL_BYTES },
        });
        const fileId: string = intent.body?.fileId ?? '';
        key = intent.body?.key ?? '';

        const crashed = await runMultipartChild(apiBase, token, fileId, TOTAL_BYTES, PARTS_BEFORE_CRASH);
        const crashExitNonZero = crashed.code !== 0 && uploadedCountOf(crashed) === null ? 1 : 0;

        const afterCrash = await app.call('GET', `/uploads/${fileId}/parts`, { token });
        const partsAfterCrash: number = afterCrash.body?.parts?.length ?? 0;
        const headBeforeComplete = (await storage.head(key)) === null ? 404 : 200;

        const resumed = await runMultipartChild(apiBase, token, fileId, TOTAL_BYTES);
        const resumedParts = uploadedCountOf(resumed) ?? -1;

        const commit = await app.call('POST', '/uploads/commit', { token, body: { fileId } });
        const head = await storage.head(key);
        const sizeMatch = head?.size === TOTAL_BYTES ? 1 : 0;
        const etag = (head?.etag ?? '').replace(/"/g, '');
        const md5 = createHash('md5').update(payload).digest('hex');
        const etagMultipart = /^[0-9a-f]{32}-3$/.test(etag) && !etag.startsWith(md5) ? 1 : 0;
        const unfinished = (await storage.listMultipartUploads(keyPrefix)).length;

        const redirect = await fetch(`${apiBase}/files/${fileId}`, {
            headers: { authorization: `Bearer ${token}` },
            redirect: 'manual',
        });
        const location = redirect.headers.get('location');
        const downloaded = location ? Buffer.from(await (await fetch(location)).arrayBuffer()) : Buffer.alloc(0);
        const contentMatch = Buffer.compare(downloaded, payload) === 0 ? 1 : 0;

        printLines({
            intent: intent.status,
            'crash-exit-nonzero': crashExitNonZero,
            'parts-after-crash': partsAfterCrash,
            'head-before-complete': headBeforeComplete,
            'resumed-parts': resumedParts,
            complete: commit.status,
            'size-match': sizeMatch,
            'etag-multipart': etagMultipart,
            'unfinished-after-complete': unfinished,
            'content-match': contentMatch,
        });

        expectEq(failures, 'intent', intent.status, 200);
        expectEq(failures, 'intent: режим multipart', intent.body?.mode, 'multipart');
        expectEq(failures, 'intent: три частини по 5 МіБ', JSON.stringify(intent.body?.multipart), '{"partSize":5242880,"partCount":3}');
        expectEq(failures, 'crash-exit-nonzero', crashExitNonZero, 1);
        expectEq(failures, 'parts-after-crash', partsAfterCrash, PARTS_BEFORE_CRASH);
        expectEq(failures, 'head-before-complete', headBeforeComplete, 404);
        expectEq(failures, 'resumed-parts', resumedParts, 1);
        expectEq(failures, 'complete', commit.status, 200);
        expectEq(failures, 'complete: статус COMPLETED', commit.body?.status, 'COMPLETED');
        expectEq(failures, 'size-match', sizeMatch, 1);
        expectEq(failures, 'etag-multipart', etagMultipart, 1);
        expectEq(failures, 'unfinished-after-complete', unfinished, 0);
        expectEq(failures, 'content-match', contentMatch, 1);
    } finally {
        const leftovers = await purgeDemoUploads(app.dataSource, storage, DEMO_EMAIL_PATTERN).catch(
            (error: Error) => {
                failures.push(`cleanup: ${error.message}`);
                return -1;
            },
        );
        const stale = keyPrefix ? await storage.listMultipartUploads(keyPrefix).catch(() => []) : [];
        for (const upload of stale) {
            await storage.abortMultipartUpload(upload.key, upload.uploadId).catch(() => undefined);
        }
        const survivor = key ? await storage.head(key).catch(() => null) : null;

        expectEq(failures, 'залишки демо-користувачів після cleanup', leftovers, 0);
        expectEq(failures, 'незавершені multipart після cleanup', stale.length, 0);
        expectEq(failures, 'залишки об\'єкта у сховищі після cleanup', survivor, null);
        await app.stop().catch(() => undefined);
        storage.client.destroy();
    }
});
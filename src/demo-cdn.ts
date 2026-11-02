import { startEdge } from './cdn/edge';
import { ASSETS_PREFIX, hashedAssetName, IMMUTABLE_CACHE_CONTROL, publishAsset } from './cdn/publish-asset';
import { expectEq, printLines, runStandalone } from './lib/demo-output';
import { directObjectUrl, loadStorageConfig } from './storage/storage.config';
import { StorageService } from './storage/storage.service';

const CSS_V1 = 'body{color:red}\n';
const CSS_V2 = 'body{color:green}\n';
const MUTABLE_KEY = `${ASSETS_PREFIX}app.css`;
const NO_CACHE_CONTROL_KEY = `${ASSETS_PREFIX}no-cache-control.css`;
const SHORT_CACHE_CONTROL = 'public, max-age=60';

const KEY_V1 = `${ASSETS_PREFIX}${hashedAssetName('app', 'css', Buffer.from(CSS_V1))}`;
const KEY_V2 = `${ASSETS_PREFIX}${hashedAssetName('app', 'css', Buffer.from(CSS_V2))}`;
const KNOWN_KEYS = [KEY_V1, KEY_V2, MUTABLE_KEY, NO_CACHE_CONTROL_KEY];

interface Fetched {
    status: number;
    body: string;
    cache: string | null;
    cacheControl: string | null;
}

async function get(url: string): Promise<Fetched> {
    const response = await fetch(url);
    return {
        status: response.status,
        body: await response.text(),
        cache: response.headers.get('x-cache'),
        cacheControl: response.headers.get('cache-control'),
    };
}

async function removeKnownObjects(storage: StorageService): Promise<void> {
    for (const key of KNOWN_KEYS) {
        await storage.delete(key).catch(() => undefined);
    }
}

void runStandalone(async (failures) => {
    const config = loadStorageConfig();
    const storage = new StorageService(config);
    await storage.ensureBucket();
    const edge = await startEdge(storage);
    const edgeUrl = (key: string): string => `http://127.0.0.1:${edge.port}/${key}`;

    try {
        await removeKnownObjects(storage);

        const v1 = await publishAsset(storage, 'app', 'css', Buffer.from(CSS_V1), 'text/css');
        const direct = await get(directObjectUrl(config, v1.key));
        const first = await get(edgeUrl(v1.key));
        const second = await get(edgeUrl(v1.key));
        const originFetchesForTwo = edge.originFetches();

        const v2 = await publishAsset(storage, 'app', 'css', Buffer.from(CSS_V2), 'text/css');
        const fresh = await get(edgeUrl(v2.key));
        const oldAgain = await get(edgeUrl(v1.key));

        await storage.putObject(MUTABLE_KEY, Buffer.from(CSS_V1), 'text/css', SHORT_CACHE_CONTROL);
        await get(edgeUrl(MUTABLE_KEY));
        await get(edgeUrl(MUTABLE_KEY));
        await storage.putObject(MUTABLE_KEY, Buffer.from(CSS_V2), 'text/css', SHORT_CACHE_CONTROL);
        const stale = await get(edgeUrl(MUTABLE_KEY));
        const originNow = await storage.getObject(MUTABLE_KEY);

        await storage.putObject(NO_CACHE_CONTROL_KEY, Buffer.from(CSS_V1), 'text/css');
        await get(edgeUrl(NO_CACHE_CONTROL_KEY));
        const withoutCacheControl = await get(edgeUrl(NO_CACHE_CONTROL_KEY));

        const privateViaEdge = await get(edgeUrl('uploads/1/secret.png'));

        const results = {
            direct: direct.status,
            'edge-miss': first.status,
            'edge-hit': second.status,
            'cache-hit': second.cache === 'HIT' ? 1 : 0,
            'first-is-miss': first.cache === 'MISS' ? 1 : 0,
            'cache-control-passthrough': second.cacheControl === IMMUTABLE_CACHE_CONTROL ? 1 : 0,
            'origin-fetches-for-two-requests': originFetchesForTwo,
            'new-name': v2.name !== v1.name ? 1 : 0,
            'new-url': fresh.status,
            'new-url-is-miss': fresh.cache === 'MISS' ? 1 : 0,
            'content-changed': fresh.body === CSS_V2 && second.body === CSS_V1 ? 1 : 0,
            'old-url-intact': oldAgain.cache === 'HIT' && oldAgain.body === CSS_V1 ? 1 : 0,
            'mutable-name-stale':
                stale.cache === 'HIT' && stale.body === CSS_V1 && originNow?.body.toString() === CSS_V2 ? 1 : 0,
            'without-cache-control-hit': withoutCacheControl.cache === 'HIT' ? 1 : 0,
            'private-via-edge': privateViaEdge.status,
        };
        printLines(results);

        expectEq(failures, 'direct', results.direct, 403);
        expectEq(failures, 'edge-miss', results['edge-miss'], 200);
        expectEq(failures, 'edge-hit', results['edge-hit'], 200);
        expectEq(failures, 'cache-hit', results['cache-hit'], 1);
        expectEq(failures, 'first-is-miss', results['first-is-miss'], 1);
        expectEq(failures, 'cache-control-passthrough', results['cache-control-passthrough'], 1);
        expectEq(failures, 'origin-fetches-for-two-requests', results['origin-fetches-for-two-requests'], 1);
        expectEq(failures, 'new-name', results['new-name'], 1);
        expectEq(failures, 'new-url', results['new-url'], 200);
        expectEq(failures, 'new-url-is-miss', results['new-url-is-miss'], 1);
        expectEq(failures, 'content-changed', results['content-changed'], 1);
        expectEq(failures, 'old-url-intact', results['old-url-intact'], 1);
        expectEq(failures, 'mutable-name-stale', results['mutable-name-stale'], 1);
        expectEq(failures, 'without-cache-control-hit', results['without-cache-control-hit'], 0);
        expectEq(failures, 'private-via-edge', results['private-via-edge'], 404);
    } finally {
        await removeKnownObjects(storage);
        const survivors: string[] = [];
        for (const key of KNOWN_KEYS) {
            if ((await storage.head(key).catch(() => null)) !== null) {
                survivors.push(key);
            }
        }
        expectEq(failures, 'залишки ассетів у сховищі після cleanup', survivors.length, 0);
        await edge.close();
        storage.client.destroy();
    }
});
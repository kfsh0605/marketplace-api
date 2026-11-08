import { etagMatches, startEdge } from '../../src/cdn/edge';
import type { AssetOrigin, Edge, OriginObject } from '../../src/cdn/edge';
import { hashedAssetName, IMMUTABLE_CACHE_CONTROL } from '../../src/cdn/publish-asset';

class FakeOrigin implements AssetOrigin {
    readonly calls: string[] = [];
    readonly conditionalCalls: Array<{ key: string; etag: string }> = [];
    readonly objects = new Map<string, OriginObject>();

    async getObject(key: string): Promise<OriginObject | null> {
        this.calls.push(key);
        return this.objects.get(key) ?? null;
    }

    async getObjectIfChanged(key: string, etag: string): Promise<OriginObject | 'not-modified' | null> {
        this.conditionalCalls.push({ key, etag });
        const object = this.objects.get(key) ?? null;
        if (object && object.etag === etag) {
            return 'not-modified';
        }
        return object;
    }
}

function immutable(body: string): OriginObject {
    return { body: Buffer.from(body), contentType: 'text/css', cacheControl: IMMUTABLE_CACHE_CONTROL };
}

function versioned(body: string, etag: string): OriginObject {
    return { body: Buffer.from(body), contentType: 'text/css', cacheControl: 'public, max-age=60', etag };
}

async function request(target: string, init?: RequestInit) {
    const response = await fetch(target, init);
    return { status: response.status, headers: response.headers, body: await response.text() };
}

describe('edge: кеш-шар перед закритим сховищем', () => {
    let origin: FakeOrigin;
    let edge: Edge;
    const url = (key: string): string => `http://127.0.0.1:${edge.port}/${key}`;

    beforeEach(async () => {
        origin = new FakeOrigin();
        edge = await startEdge(origin);
    });

    afterEach(async () => {
        await edge.close();
    });

    it('перший запит MISS, другий HIT, у сховище ходили один раз, Cache-Control з origin віддається як є', async () => {
        origin.objects.set('assets/app.aaaaaaaa.css', immutable('a'));

        const first = await fetch(url('assets/app.aaaaaaaa.css'));
        const second = await fetch(url('assets/app.aaaaaaaa.css'));

        expect(first.headers.get('x-cache')).toBe('MISS');
        expect(second.headers.get('x-cache')).toBe('HIT');
        expect(second.headers.get('cache-control')).toBe(IMMUTABLE_CACHE_CONTROL);
        expect(await second.text()).toBe('a');
        expect(origin.calls).toEqual(['assets/app.aaaaaaaa.css']);
    });

    it('без Cache-Control кожен запит іде в origin і HIT не буває', async () => {
        origin.objects.set('assets/plain.css', { body: Buffer.from('x') });

        const first = await fetch(url('assets/plain.css'));
        const second = await fetch(url('assets/plain.css'));

        expect(first.headers.get('x-cache')).toBe('MISS');
        expect(second.headers.get('x-cache')).toBe('MISS');
        expect(origin.calls).toHaveLength(2);
    });

    it('private і no-store не кешуються навіть із max-age', async () => {
        origin.objects.set('assets/p.css', { body: Buffer.from('p'), cacheControl: 'private, max-age=3600' });
        origin.objects.set('assets/n.css', { body: Buffer.from('n'), cacheControl: 'public, max-age=3600, no-store' });

        await fetch(url('assets/p.css'));
        const privateAgain = await fetch(url('assets/p.css'));
        await fetch(url('assets/n.css'));
        const noStoreAgain = await fetch(url('assets/n.css'));

        expect(privateAgain.headers.get('x-cache')).toBe('MISS');
        expect(noStoreAgain.headers.get('x-cache')).toBe('MISS');
    });

    it('усе поза префіксом assets/ дає 404 і до сховища не доходить', async () => {
        origin.objects.set('uploads/1/secret.png', immutable('s'));

        const direct = await fetch(url('uploads/1/secret.png'));
        const traversal = await fetch(url('assets/a%2F..%2Fuploads%2F1%2Fsecret.png'));

        expect(direct.status).toBe(404);
        expect(traversal.status).toBe(404);
        expect(origin.calls).toHaveLength(0);
    });

    it('неіснуючий ассет дає 404 і не кешується', async () => {
        const first = await fetch(url('assets/missing.css'));
        const second = await fetch(url('assets/missing.css'));

        expect(first.status).toBe(404);
        expect(second.status).toBe(404);
        expect(origin.calls).toHaveLength(2);
    });

    it('новий хеш означає новий URL: старий лишається у кеші зі старим тілом', async () => {
        origin.objects.set('assets/app.11111111.css', immutable('old'));
        origin.objects.set('assets/app.22222222.css', immutable('new'));

        await fetch(url('assets/app.11111111.css'));
        const fresh = await fetch(url('assets/app.22222222.css'));
        const oldAgain = await fetch(url('assets/app.11111111.css'));

        expect(fresh.headers.get('x-cache')).toBe('MISS');
        expect(await fresh.text()).toBe('new');
        expect(oldAgain.headers.get('x-cache')).toBe('HIT');
        expect(await oldAgain.text()).toBe('old');
    });
});

describe('hashedAssetName: імʼя залежить від вмісту', () => {
    it('має форму base.hash8.ext, детерміноване і змінюється разом із вмістом', () => {
        const a = hashedAssetName('app', 'css', Buffer.from('body{color:red}'));
        const again = hashedAssetName('app', 'css', Buffer.from('body{color:red}'));
        const b = hashedAssetName('app', 'css', Buffer.from('body{color:green}'));

        expect(a).toMatch(/^app\.[0-9a-f]{8}\.css$/);
        expect(again).toBe(a);
        expect(b).not.toBe(a);
    });
});

describe('etagMatches', () => {
    it.each([
        ['"e1"', true],
        ['W/"e1"', true],
        ['"zzz", "e1"', true],
        ['*', true],
        ['"other"', false],
        ['', false],
    ])('If-None-Match %p дає %p', (header, expected) => {
        expect(etagMatches(header, '"e1"')).toBe(expected);
    });

    it('без заголовка збігу немає', () => {
        expect(etagMatches(undefined, '"e1"')).toBe(false);
    });
});

describe('edge: HEAD, умовні запити, ревалідація, ліміт памʼяті', () => {
    const realNow = Date.now.bind(Date);
    let skewMs = 0;
    let origin: FakeOrigin;
    let edge: Edge | undefined;
    const url = (key: string): string => `http://127.0.0.1:${(edge as Edge).port}/${key}`;

    async function start(maxCacheBytes?: number): Promise<Edge> {
        edge = await startEdge(origin, 0, { maxCacheBytes });
        return edge;
    }

    beforeEach(() => {
        skewMs = 0;
        jest.spyOn(Date, 'now').mockImplementation(() => realNow() + skewMs);
        origin = new FakeOrigin();
        edge = undefined;
    });

    afterEach(async () => {
        await edge?.close();
        jest.restoreAllMocks();
    });

    it('HEAD після GET: HIT, ті самі заголовки, порожнє тіло, у сховище не ходили вдруге', async () => {
        origin.objects.set('assets/a.css', versioned('body{}', '"e1"'));
        await start();

        const getResponse = await request(url('assets/a.css'));
        const head = await request(url('assets/a.css'), { method: 'HEAD' });

        expect(head.status).toBe(200);
        expect(head.body).toBe('');
        expect(head.headers.get('x-cache')).toBe('HIT');
        expect(head.headers.get('etag')).toBe('"e1"');
        expect(head.headers.get('content-length')).toBe(getResponse.headers.get('content-length'));
        expect(origin.calls).toHaveLength(1);
    });

    it('HEAD на холодний кеш це MISS із кешуванням, наступний GET HIT; на відсутній ассет 404', async () => {
        origin.objects.set('assets/a.css', versioned('body{}', '"e1"'));
        await start();

        const head = await request(url('assets/a.css'), { method: 'HEAD' });
        const next = await request(url('assets/a.css'));
        const missing = await request(url('assets/missing.css'), { method: 'HEAD' });

        expect(head.status).toBe(200);
        expect(head.headers.get('x-cache')).toBe('MISS');
        expect(next.headers.get('x-cache')).toBe('HIT');
        expect(missing.status).toBe(404);
    });

    it('інші методи отримують 404', async () => {
        origin.objects.set('assets/a.css', versioned('body{}', '"e1"'));
        await start();

        const post = await request(url('assets/a.css'), { method: 'POST', body: 'x' });

        expect(post.status).toBe(404);
        expect(origin.calls).toHaveLength(0);
    });

    it.each(['"e1"', 'W/"e1"', '"zzz", "e1"', '*'])('If-None-Match %s дає 304 без тіла', async (header) => {
        origin.objects.set('assets/a.css', versioned('body{}', '"e1"'));
        await start();
        await request(url('assets/a.css'));

        const conditional = await request(url('assets/a.css'), { headers: { 'if-none-match': header } });

        expect(conditional.status).toBe(304);
        expect(conditional.body).toBe('');
        expect(conditional.headers.get('etag')).toBe('"e1"');
        expect(conditional.headers.get('x-cache')).toBe('HIT');
    });

    it('If-None-Match з іншим ETag дає повну відповідь 200', async () => {
        origin.objects.set('assets/a.css', versioned('body{}', '"e1"'));
        await start();

        const response = await request(url('assets/a.css'), { headers: { 'if-none-match': '"other"' } });

        expect(response.status).toBe(200);
        expect(response.body).toBe('body{}');
    });

    it('після TTL edge питає сховище умовним запитом і при 304 лише продовжує запис, тіло не тягнеться', async () => {
        origin.objects.set('assets/a.css', versioned('body{}', '"e1"'));
        await start();

        const first = await request(url('assets/a.css'));
        skewMs = 61_000;
        const second = await request(url('assets/a.css'));
        const third = await request(url('assets/a.css'));

        expect(first.headers.get('x-cache')).toBe('MISS');
        expect(second.headers.get('x-cache')).toBe('REVALIDATED');
        expect(second.body).toBe('body{}');
        expect(third.headers.get('x-cache')).toBe('HIT');
        expect(origin.calls).toHaveLength(1);
        expect(origin.conditionalCalls).toEqual([{ key: 'assets/a.css', etag: '"e1"' }]);
    });

    it('якщо після TTL об’єкт змінився, віддається нова версія як MISS', async () => {
        origin.objects.set('assets/a.css', versioned('old', '"e1"'));
        await start();

        await request(url('assets/a.css'));
        origin.objects.set('assets/a.css', versioned('new', '"e2"'));
        skewMs = 61_000;
        const refreshed = await request(url('assets/a.css'));
        const afterwards = await request(url('assets/a.css'));

        expect(refreshed.headers.get('x-cache')).toBe('MISS');
        expect(refreshed.body).toBe('new');
        expect(afterwards.headers.get('x-cache')).toBe('HIT');
        expect(afterwards.body).toBe('new');
    });

    it('якщо після TTL об’єкт зник, відповідь 404 і запис видалено з кешу', async () => {
        origin.objects.set('assets/a.css', versioned('body{}', '"e1"'));
        const running = await start();

        await request(url('assets/a.css'));
        origin.objects.delete('assets/a.css');
        skewMs = 61_000;
        const gone = await request(url('assets/a.css'));

        expect(gone.status).toBe(404);
        expect(running.cacheEntries()).toBe(0);
        expect(running.cacheBytes()).toBe(0);
    });

    it('кеш обмежений у байтах і витісняє найдовше не використаний запис', async () => {
        origin.objects.set('assets/a.css', immutable('aaaa'));
        origin.objects.set('assets/b.css', immutable('bbbb'));
        origin.objects.set('assets/c.css', immutable('cccc'));
        const running = await start(10);

        await request(url('assets/a.css'));
        await request(url('assets/b.css'));
        const touchA = await request(url('assets/a.css'));
        await request(url('assets/c.css'));

        expect(touchA.headers.get('x-cache')).toBe('HIT');
        expect(running.cacheBytes()).toBe(8);
        expect(running.cacheEntries()).toBe(2);

        const aSurvived = await request(url('assets/a.css'));
        const bEvicted = await request(url('assets/b.css'));

        expect(aSurvived.headers.get('x-cache')).toBe('HIT');
        expect(bEvicted.headers.get('x-cache')).toBe('MISS');
        expect(running.cacheBytes()).toBeLessThanOrEqual(10);
    });

    it('об’єкт більший за весь ліміт віддається, але не кешується і нічого не витісняє', async () => {
        origin.objects.set('assets/small.css', immutable('aaaa'));
        origin.objects.set('assets/huge.css', immutable('x'.repeat(11)));
        const running = await start(10);

        await request(url('assets/small.css'));
        const huge = await request(url('assets/huge.css'));
        const hugeAgain = await request(url('assets/huge.css'));
        const small = await request(url('assets/small.css'));

        expect(huge.status).toBe(200);
        expect(huge.body).toHaveLength(11);
        expect(hugeAgain.headers.get('x-cache')).toBe('MISS');
        expect(small.headers.get('x-cache')).toBe('HIT');
        expect(running.cacheBytes()).toBe(4);
    });

    it('перезапис того самого ключа після TTL не подвоює облік байтів', async () => {
        origin.objects.set('assets/a.css', { body: Buffer.from('12345'), cacheControl: 'public, max-age=60' });
        const running = await start(100);

        await request(url('assets/a.css'));
        skewMs = 61_000;
        const again = await request(url('assets/a.css'));

        expect(again.headers.get('x-cache')).toBe('MISS');
        expect(running.cacheBytes()).toBe(5);
        expect(running.cacheEntries()).toBe(1);
    });
});
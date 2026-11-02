import { startEdge } from '../../src/cdn/edge';
import type { AssetOrigin, Edge, OriginObject } from '../../src/cdn/edge';
import { hashedAssetName, IMMUTABLE_CACHE_CONTROL } from '../../src/cdn/publish-asset';

class FakeOrigin implements AssetOrigin {
    readonly calls: string[] = [];
    readonly objects = new Map<string, OriginObject>();

    async getObject(key: string): Promise<OriginObject | null> {
        this.calls.push(key);
        return this.objects.get(key) ?? null;
    }
}

function immutable(body: string): OriginObject {
    return { body: Buffer.from(body), contentType: 'text/css', cacheControl: IMMUTABLE_CACHE_CONTROL };
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
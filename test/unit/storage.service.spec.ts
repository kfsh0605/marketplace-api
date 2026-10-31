import { StorageService } from '../../src/storage/storage.service';
import { PRESIGN_GET_TTL_SECONDS, PRESIGN_PUT_TTL_SECONDS } from '../../src/storage/storage.constants';

const config = {
    endpoint: 'http://127.0.0.1:22650',
    region: 'us-east-1',
    bucket: 'hw26-files',
    accessKeyId: 'unit-access-key',
    secretAccessKey: 'unit-secret-key-value',
};

describe('StorageService: presigned URL (офлайн, без мережі)', () => {
    const storage = new StorageService(config);

    it('PUT: ключ у шляху, строк і алгоритм у query, підпис накриває хост і Content-Type', async () => {
        const url = new URL(await storage.presignPut('uploads/1/abc.png', 'image/png'));

        expect(url.origin).toBe('http://127.0.0.1:22650');
        expect(url.pathname).toBe('/hw26-files/uploads/1/abc.png');
        expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
        expect(url.searchParams.get('X-Amz-Expires')).toBe(String(PRESIGN_PUT_TTL_SECONDS));
        const signedHeaders = (url.searchParams.get('X-Amz-SignedHeaders') ?? '').split(';');
        expect(signedHeaders).toEqual(expect.arrayContaining(['host', 'content-type']));
    });

    it('у query немає контрольної суми порожнього тіла (requestChecksumCalculation: WHEN_REQUIRED)', async () => {
        const url = new URL(await storage.presignPut('uploads/1/abc.png', 'image/png'));

        expect(url.searchParams.has('x-amz-checksum-crc32')).toBe(false);
    });

    it('секретний ключ не потрапляє в URL', async () => {
        const url = await storage.presignPut('uploads/1/abc.png', 'image/png');

        expect(url).not.toContain(config.secretAccessKey);
    });

    it('інший ключ об\'єкта дає інший підпис', async () => {
        const first = new URL(await storage.presignPut('uploads/1/a.png', 'image/png'));
        const second = new URL(await storage.presignPut('uploads/1/b.png', 'image/png'));

        expect(first.searchParams.get('X-Amz-Signature')).not.toBe(second.searchParams.get('X-Amz-Signature'));
    });

    it('GET: строк за замовчуванням коротший за хвилину і його можна перевизначити', async () => {
        const byDefault = new URL(await storage.presignGet('uploads/1/abc.png'));
        const custom = new URL(await storage.presignGet('uploads/1/abc.png', 1));

        expect(byDefault.searchParams.get('X-Amz-Expires')).toBe(String(PRESIGN_GET_TTL_SECONDS));
        expect(custom.searchParams.get('X-Amz-Expires')).toBe('1');
    });
});
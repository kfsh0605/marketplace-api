import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { StoredFile } from '../../src/entities/stored-file.entity';
import { FilesService } from '../../src/files/files.service';
import { PgHandle, startPg } from './testkit/pg-container';
import { resetDatabase } from './testkit/reset-database';
import { FakeStorage } from './testkit/fake-storage';

async function insertUser(dataSource: DataSource, email: string, role = 'customer'): Promise<number> {
    const rows = await dataSource.query(
        `INSERT INTO "users" ("email", "name", "role") VALUES ($1, 'files-test', $2) RETURNING "id"`,
        [email, role],
    );
    return rows[0].id;
}

describe('FilesService: intent, commit, скачування (Postgres + фейкове сховище)', () => {
    let pg: PgHandle;
    let dataSource: DataSource;
    let storage: FakeStorage;
    let service: FilesService;
    let alice: number;
    let bob: number;

    beforeAll(async () => {
        pg = await startPg('files-service');
        dataSource = pg.dataSource;
    }, 60_000);

    beforeEach(async () => {
        storage = new FakeStorage();
        service = new FilesService(dataSource.getRepository(StoredFile), storage);
        alice = await insertUser(dataSource, 'alice@example.com');
        bob = await insertUser(dataSource, 'bob@example.com');
    });

    afterEach(async () => {
        await resetDatabase(dataSource);
    });

    afterAll(async () => {
        await pg.stop();
    });

    it('intent: ключ генерує сервер, filename клієнта в ключ не потрапляє, рядок PENDING', async () => {
        const intent = await service.createIntent(alice, {
            contentType: 'image/png',
            size: 1024,
            filename: '../../etc/passwd',
        });

        expect(intent.key).toMatch(new RegExp(`^uploads/${alice}/[0-9a-f-]{36}\\.png$`));
        expect(intent.key).not.toContain('passwd');
        expect(intent.key).not.toContain('..');
        expect(intent.headers['content-type']).toBe('image/png');
        expect(storage.putRequests).toEqual([{ key: intent.key, contentType: 'image/png', expiresIn: 300 }]);

        const row = await dataSource.getRepository(StoredFile).findOneByOrFail({ id: intent.fileId });
        expect(row.status).toBe('PENDING');
        expect(row.ownerId).toBe(alice);
        expect(row.size).toBe(1024);
    });

    it('intent: тип поза allowlist відхиляється й нічого не записується', async () => {
        await expect(service.createIntent(alice, { contentType: 'text/html' })).rejects.toBeInstanceOf(
            BadRequestException,
        );

        expect(await dataSource.getRepository(StoredFile).count()).toBe(0);
    });

    it('commit без завантажених байтів дає 409 і рядок лишається PENDING', async () => {
        const intent = await service.createIntent(alice, { contentType: 'image/png' });

        await expect(service.commit(alice, intent.fileId)).rejects.toBeInstanceOf(ConflictException);

        const row = await dataSource.getRepository(StoredFile).findOneByOrFail({ id: intent.fileId });
        expect(row.status).toBe('PENDING');
    });

    it('commit після завантаження: COMPLETED, розмір береться зі сховища', async () => {
        const intent = await service.createIntent(alice, { contentType: 'image/png' });
        storage.objects.set(intent.key, 4096);

        const committed = await service.commit(alice, intent.fileId);

        expect(committed.status).toBe('COMPLETED');
        expect(committed.size).toBe(4096);
        expect(committed.completedAt).not.toBeNull();
    });

    it('commit: розмір у сховищі не збігається із заявленим, 409 і PENDING', async () => {
        const intent = await service.createIntent(alice, { contentType: 'image/png', size: 4096 });
        storage.objects.set(intent.key, 100);

        await expect(service.commit(alice, intent.fileId)).rejects.toBeInstanceOf(ConflictException);

        const row = await dataSource.getRepository(StoredFile).findOneByOrFail({ id: intent.fileId });
        expect(row.status).toBe('PENDING');
    });

    it('повторний commit ідемпотентний і не змінює completedAt', async () => {
        const intent = await service.createIntent(alice, { contentType: 'image/png' });
        storage.objects.set(intent.key, 10);

        const first = await service.commit(alice, intent.fileId);
        const second = await service.commit(alice, intent.fileId);

        expect(second.status).toBe('COMPLETED');
        expect(second.completedAt).toBe(first.completedAt);
    });

    it('чужий файл: commit і скачування дають однаковий NotFound', async () => {
        const intent = await service.createIntent(alice, { contentType: 'image/png' });
        storage.objects.set(intent.key, 10);
        await service.commit(alice, intent.fileId);

        await expect(service.commit(bob, intent.fileId)).rejects.toBeInstanceOf(NotFoundException);
        await expect(service.downloadUrl(bob, intent.fileId)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('скачування: незавершений файл недоступний, завершений дає короткий presigned GET, admin бачить чужий', async () => {
        const admin = await insertUser(dataSource, 'admin@example.com', 'admin');
        const intent = await service.createIntent(alice, { contentType: 'image/png' });

        await expect(service.downloadUrl(alice, intent.fileId)).rejects.toBeInstanceOf(NotFoundException);

        storage.objects.set(intent.key, 10);
        await service.commit(alice, intent.fileId);

        expect(await service.downloadUrl(alice, intent.fileId)).toBe(`fake://get/${intent.key}?expires=60`);
        expect(await service.downloadUrl(admin, intent.fileId)).toBe(`fake://get/${intent.key}?expires=60`);
    });
});
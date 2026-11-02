import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { StoredFile } from '../../src/entities/stored-file.entity';
import { FilesService } from '../../src/files/files.service';
import { PgHandle, startPg } from './testkit/pg-container';
import { resetDatabase } from './testkit/reset-database';
import { FakeStorage } from './testkit/fake-storage';

const MIB = 1024 * 1024;

async function insertUser(dataSource: DataSource, email: string): Promise<number> {
    const rows = await dataSource.query(
        `INSERT INTO "users" ("email", "name") VALUES ($1, 'files-test') RETURNING "id"`,
        [email],
    );
    return rows[0].id;
}

describe('FilesService: multipart (Postgres + фейкове сховище)', () => {
    let pg: PgHandle;
    let dataSource: DataSource;
    let storage: FakeStorage;
    let service: FilesService;
    let alice: number;
    let bob: number;

    beforeAll(async () => {
        pg = await startPg('files-multipart');
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

    async function bigIntent(size = 11 * MIB) {
        return service.createIntent(alice, { contentType: 'application/gzip', size });
    }

    async function uploadIdOf(fileId: string): Promise<string> {
        const row = await dataSource.getRepository(StoredFile).findOneByOrFail({ id: fileId });
        return row.uploadId as string;
    }

    it('intent: файл більший за поріг дає multipart із порахованим розміром частини і без одиночного URL', async () => {
        const intent = await bigIntent();

        expect(intent.mode).toBe('multipart');
        expect(intent.multipart).toEqual({ partSize: 5 * MIB, partCount: 3 });
        expect(intent.url).toBeUndefined();
        expect(await uploadIdOf(intent.fileId)).toMatch(/^upload-/);
        expect(storage.putRequests).toHaveLength(0);
    });

    it('intent: файл до порогу лишається одиночним PUT без upload_id', async () => {
        const intent = await bigIntent(10 * MIB);

        expect(intent.mode).toBe('single');
        expect(intent.url).toContain('fake://put/');
        expect(await uploadIdOf(intent.fileId)).toBeNull();
    });

    it('ListParts: клієнт бачить, які частини вже лежать у сховищі', async () => {
        const intent = await bigIntent();
        const uploadId = await uploadIdOf(intent.fileId);
        storage.putPart(uploadId, 1, 5 * MIB);
        storage.putPart(uploadId, 2, 5 * MIB);

        const listed = await service.listUploadedParts(alice, intent.fileId);

        expect(listed.partCount).toBe(3);
        expect(listed.parts.map((part) => part.partNumber)).toEqual([1, 2]);
    });

    it('URL частин видаються лише для номерів у межах 1..partCount', async () => {
        const intent = await bigIntent();

        const issued = await service.presignParts(alice, intent.fileId, [3]);

        expect(issued.urls).toHaveLength(1);
        expect(issued.urls[0].url).toContain('part=3');
        await expect(service.presignParts(alice, intent.fileId, [4])).rejects.toBeInstanceOf(BadRequestException);
        await expect(service.presignParts(alice, intent.fileId, [0])).rejects.toBeInstanceOf(BadRequestException);
    });

    it('commit без усіх частин: 409 з переліком відсутніх, об\'єкта немає, рядок PENDING', async () => {
        const intent = await bigIntent();
        const uploadId = await uploadIdOf(intent.fileId);
        storage.putPart(uploadId, 1, 5 * MIB);
        storage.putPart(uploadId, 2, 5 * MIB);

        await expect(service.commit(alice, intent.fileId)).rejects.toThrow(/Не вистачає частин: 1 з 3 \(перші: 3\)/);

        expect(storage.objects.has(intent.key)).toBe(false);
        const row = await dataSource.getRepository(StoredFile).findOneByOrFail({ id: intent.fileId });
        expect(row.status).toBe('PENDING');
    });

    it('commit із частиною неправильного розміру: 409', async () => {
        const intent = await bigIntent();
        const uploadId = await uploadIdOf(intent.fileId);
        storage.putPart(uploadId, 1, 5 * MIB);
        storage.putPart(uploadId, 2, 3 * MIB);
        storage.putPart(uploadId, 3, 1 * MIB);

        await expect(service.commit(alice, intent.fileId)).rejects.toBeInstanceOf(ConflictException);
    });

    it('commit з усіма частинами: Complete за порядком 1..N, COMPLETED, upload_id очищено', async () => {
        const intent = await bigIntent();
        const uploadId = await uploadIdOf(intent.fileId);
        storage.putPart(uploadId, 3, 1 * MIB);
        storage.putPart(uploadId, 1, 5 * MIB);
        storage.putPart(uploadId, 2, 5 * MIB);

        const committed = await service.commit(alice, intent.fileId);

        expect(committed.status).toBe('COMPLETED');
        expect(committed.size).toBe(11 * MIB);
        expect(storage.completions).toEqual([{ key: intent.key, partNumbers: [1, 2, 3] }]);
        expect(await uploadIdOf(intent.fileId)).toBeNull();
    });

    it('повторний commit після збою між Complete і записом у базу не потребує ListParts', async () => {
        const intent = await bigIntent();
        const uploadId = await uploadIdOf(intent.fileId);
        storage.putPart(uploadId, 1, 5 * MIB);
        storage.putPart(uploadId, 2, 5 * MIB);
        storage.putPart(uploadId, 3, 1 * MIB);
        await storage.completeMultipartUpload(
            intent.key,
            uploadId,
            await storage.listParts(intent.key, uploadId),
        );

        const committed = await service.commit(alice, intent.fileId);

        expect(committed.status).toBe('COMPLETED');
        expect(committed.size).toBe(11 * MIB);
    });

    it('чужий користувач не бачить частин і не може видавати URL', async () => {
        const intent = await bigIntent();

        await expect(service.listUploadedParts(bob, intent.fileId)).rejects.toBeInstanceOf(NotFoundException);
        await expect(service.presignParts(bob, intent.fileId, [1])).rejects.toBeInstanceOf(NotFoundException);
    });
});
import { DataSource } from 'typeorm';
import { PgHandle, startPg } from './testkit/pg-container';
import { resetDatabase } from './testkit/reset-database';
import { StoredFile } from '../../src/entities/stored-file.entity';

async function insertUser(dataSource: DataSource, email: string): Promise<number> {
    const rows = await dataSource.query(
        `INSERT INTO "users" ("email", "name") VALUES ($1, 'files-test') RETURNING "id"`,
        [email],
    );
    return rows[0].id;
}

function insertFile(
    dataSource: DataSource,
    ownerId: number,
    key: string,
    extra: Record<string, string> = {},
): Promise<unknown> {
    const columns = ['"key"', '"owner_id"', '"content_type"', ...Object.keys(extra).map((name) => `"${name}"`)];
    const values = ['$1', '$2', `'image/png'`, ...Object.values(extra)];
    return dataSource.query(`INSERT INTO "files" (${columns.join(', ')}) VALUES (${values.join(', ')})`, [
        key,
        ownerId,
    ]);
}

describe('Таблиця files: обмеження цілісності (Postgres, testcontainers)', () => {
    let pg: PgHandle;
    let dataSource: DataSource;

    beforeAll(async () => {
        pg = await startPg('files');
        dataSource = pg.dataSource;
    }, 60_000);

    afterEach(async () => {
        await resetDatabase(dataSource);
    });

    afterAll(async () => {
        await pg.stop();
    });

    it('новий рядок за замовчуванням PENDING без розміру й upload_id', async () => {
        const owner = await insertUser(dataSource, 'a@example.com');
        await insertFile(dataSource, owner, 'uploads/1/a.png');

        const row = await dataSource.getRepository(StoredFile).findOneByOrFail({ key: 'uploads/1/a.png' });

        expect(row.status).toBe('PENDING');
        expect(row.size).toBeNull();
        expect(row.uploadId).toBeNull();
        expect(row.completedAt).toBeNull();
    });

    it('ключ унікальний: другий рядок із тим самим ключем відхиляється', async () => {
        const owner = await insertUser(dataSource, 'a@example.com');
        await insertFile(dataSource, owner, 'uploads/1/a.png');

        await expect(insertFile(dataSource, owner, 'uploads/1/a.png')).rejects.toThrow(/UQ_files_key/);
    });

    it('невідомий статус відхиляється', async () => {
        const owner = await insertUser(dataSource, 'a@example.com');

        await expect(
            insertFile(dataSource, owner, 'uploads/1/a.png', { status: `'DONE'`, completed_at: 'now()' }),
        ).rejects.toThrow(/CHK_files_status/);
    });

    it('COMPLETED без completed_at відхиляється', async () => {
        const owner = await insertUser(dataSource, 'a@example.com');

        await expect(
            insertFile(dataSource, owner, 'uploads/1/a.png', { status: `'COMPLETED'` }),
        ).rejects.toThrow(/CHK_files_completed/);
    });

    it('від\'ємний розмір відхиляється', async () => {
        const owner = await insertUser(dataSource, 'a@example.com');

        await expect(insertFile(dataSource, owner, 'uploads/1/a.png', { size: '-1' })).rejects.toThrow(
            /CHK_files_size/,
        );
    });

    it('розмір понад 2 ГіБ зберігається і читається числом', async () => {
        const owner = await insertUser(dataSource, 'a@example.com');
        const fiveGiB = 5 * 1024 * 1024 * 1024;
        await insertFile(dataSource, owner, 'uploads/1/big.bin', { size: String(fiveGiB) });

        const row = await dataSource.getRepository(StoredFile).findOneByOrFail({ key: 'uploads/1/big.bin' });

        expect(row.size).toBe(fiveGiB);
    });

    it('видалення користувача каскадно видаляє його рядки', async () => {
        const owner = await insertUser(dataSource, 'a@example.com');
        await insertFile(dataSource, owner, 'uploads/1/a.png');

        await dataSource.query(`DELETE FROM "users" WHERE "id" = $1`, [owner]);

        expect(await dataSource.getRepository(StoredFile).count()).toBe(0);
    });

    it('індекс для чистильника охоплює лише PENDING-рядки', async () => {
        const rows = await dataSource.query(
            `SELECT "indexdef" FROM "pg_indexes" WHERE "indexname" = 'IDX_files_pending_created'`,
        );

        expect(rows).toHaveLength(1);
        expect(rows[0].indexdef).toContain(`status = 'PENDING'`);
    });
});
import type { DataSource } from 'typeorm';
import type { StorageService } from '../storage/storage.service';

export async function purgeDemoUploads(
    dataSource: DataSource,
    storage: StorageService,
    emailPattern: string,
): Promise<number> {
    const rows: Array<{ key: string }> = await dataSource.query(
        `SELECT f."key" FROM "files" f JOIN "users" u ON u."id" = f."owner_id" WHERE u."email" LIKE $1`,
        [emailPattern],
    );
    for (const row of rows) {
        await storage.delete(row.key).catch(() => undefined);
    }
    await dataSource.query(`DELETE FROM "users" WHERE "email" LIKE $1`, [emailPattern]);

    const left: Array<{ n: number }> = await dataSource.query(
        `SELECT count(*)::int AS n FROM "users" WHERE "email" LIKE $1`,
        [emailPattern],
    );
    return left[0].n;
}
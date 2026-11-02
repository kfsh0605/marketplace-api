import type { DataSource } from 'typeorm';
import type { StorageService } from '../storage/storage.service';

export async function purgeDemoUploads(
    dataSource: DataSource,
    storage: StorageService,
    emailPattern: string,
): Promise<number> {
    const rows: Array<{ key: string; upload_id: string | null }> = await dataSource.query(
        `SELECT f."key", f."upload_id" FROM "files" f JOIN "users" u ON u."id" = f."owner_id" WHERE u."email" LIKE $1`,
        [emailPattern],
    );
    for (const row of rows) {
        if (row.upload_id) {
            await storage.abortMultipartUpload(row.key, row.upload_id).catch(() => undefined);
        }
        await storage.delete(row.key).catch(() => undefined);
    }
    await dataSource.query(`DELETE FROM "users" WHERE "email" LIKE $1`, [emailPattern]);

    const left: Array<{ n: number }> = await dataSource.query(
        `SELECT count(*)::int AS n FROM "users" WHERE "email" LIKE $1`,
        [emailPattern],
    );
    return left[0].n;
}
import type { Pool } from 'pg';
import type { EffectStore, Queryable } from './consumer';

/**
 * Хранилище для консьюмера поверх pg.Pool.
 * transaction(): ОДНО соединение на весь BEGIN … COMMIT. pool.query('BEGIN') так не умеет:
 * он отправил бы BEGIN и COMMIT на разные соединения, и "одна транзакция" оказалась бы фикцией.
 */
export function pgStore(pool: Pool): EffectStore {
    return {
        query: async (sql, params) => (await pool.query(sql, params as any[])).rows,

        transaction: async (fn) => {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const tx: Queryable = {
                    query: async (sql, params) => (await client.query(sql, params as any[])).rows,
                };
                const result = await fn(tx);
                await client.query('COMMIT');
                return result;
            } catch (err) {
                await client.query('ROLLBACK').catch(() => undefined);
                throw err;
            } finally {
                client.release();
            }
        },
    };
}
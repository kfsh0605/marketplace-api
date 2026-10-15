import { Pool } from 'pg';

/**
 * Прямой pg.Pool, а не TypeORM: relay держит одну транзакцию на одном соединении,
 * и нам не нужен шум TypeORM-логов в выводе. Параметры берутся из тех же DB_*, что и у приложения
 * (их подставляет scripts/with-secrets.sh или грейдер).
 *
 * Через PgBouncer (pool_mode=transaction) это работает: вся работа relay укладывается
 * в одну транзакцию BEGIN … COMMIT, а на время транзакции PgBouncer закрепляет за нами одно соединение.
 */
export function createPool(max = 5): Pool {
    return new Pool({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT ?? 5432),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        max,
    });
}
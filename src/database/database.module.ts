import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { Pool } from 'pg';
import { Env } from '../config/env.schema';

export const PG_POOL = 'PG_POOL';

const DB_PASSWORD_FILE = join(process.cwd(), 'secrets', 'db_password');

async function readDbPassword(): Promise<string> {
    const raw = await readFile(DB_PASSWORD_FILE, 'utf8');
    return raw.trim();
}

@Global()
@Module({
    imports: [ConfigModule],
    providers: [
        {
            provide: PG_POOL,
            inject: [ConfigService],
            useFactory: (configService: ConfigService<Env, true>) => {
                const pool = new Pool({
                    host: configService.get('DB_HOST', { infer: true }),
                    port: configService.get('DB_PORT', { infer: true }),
                    user: configService.get('DB_USER', { infer: true }),
                    password: readDbPassword,
                    database: configService.get('DB_NAME', { infer: true }),
                    max: 10,
                    idleTimeoutMillis: 30000,
                    connectionTimeoutMillis: 5000,
                });

                pool.on('error', (err) => {
                    console.error('Unexpected error on idle Postgres client', err);
                });

                return pool;
            },
        },
    ],
    exports: [PG_POOL],
})
export class DatabaseModule {}
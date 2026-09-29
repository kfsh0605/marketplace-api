import { readFile } from 'fs/promises';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.schema';

export interface PgConnectionOptions {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
}

const DB_PASSWORD_FILE = join(process.cwd(), 'secrets', 'db_password');

async function readDbPasswordFromFile(): Promise<string> {
    const raw = await readFile(DB_PASSWORD_FILE, 'utf8');
    return raw.trim();
}

export async function resolvePgConnectionOptions(
    configService: ConfigService<Env, true>,
): Promise<PgConnectionOptions> {
    const databaseUrl = process.env.DATABASE_URL;

    if (databaseUrl) {
        const url = new URL(databaseUrl);
        return {
            host: url.hostname,
            port: Number(url.port || 5432),
            username: decodeURIComponent(url.username),
            password: decodeURIComponent(url.password),
            database: decodeURIComponent(url.pathname.slice(1)),
        };
    }

    return {
        host: configService.get('DB_HOST', { infer: true }),
        port: configService.get('DB_PORT', { infer: true }),
        username: configService.get('DB_USER', { infer: true }),
        password: await readDbPasswordFromFile(),
        database: configService.get('DB_NAME', { infer: true }),
    };
}
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { hashPassword } from '../auth/password';
import type { UserRole } from '../auth/roles';
import { configureApp } from '../configure-app';
import { User } from '../entities/user.entity';

export const DEMO_PASSWORD = 'demo-password-not-a-secret';

export interface CallOptions {
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
}

export interface CallResult {
    status: number;
    body: any;
}

export interface DemoApp {
    dataSource: DataSource;
    call(method: string, path: string, options?: CallOptions): Promise<CallResult>;
    stop(): Promise<void>;
}

export function runTag(demo: string): string {
    return `demo-${demo}-${randomBytes(4).toString('hex')}`;
}

export async function startDemoApp(): Promise<DemoApp> {
    process.env.RABBITMQ_DISABLED = '1';
    const { AppModule } = await import('../app.module');
    const app = await NestFactory.create(AppModule, { logger: ['error'] });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

    return {
        dataSource: app.get(DataSource),
        async call(method, path, options = {}) {
            const headers: Record<string, string> = { ...options.headers };
            if (options.token) {
                headers.authorization = `Bearer ${options.token}`;
            }
            if (options.body !== undefined) {
                headers['content-type'] = 'application/json';
            }
            const response = await fetch(`${baseUrl}${path}`, {
                method,
                headers,
                body: options.body === undefined ? undefined : JSON.stringify(options.body),
            });
            const text = await response.text();
            let body: any = null;
            try {
                body = text ? JSON.parse(text) : null;
            } catch {
                body = text;
            }
            return { status: response.status, body };
        },
        async stop() {
            await app.close();
        },
    };
}

export async function createDemoUser(dataSource: DataSource, email: string, role: UserRole): Promise<User> {
    const users = dataSource.getRepository(User);
    return users.save(
        users.create({
            email,
            name: email.split('@')[0],
            role,
            passwordHash: await hashPassword(DEMO_PASSWORD),
        }),
    );
}

export function tokenOf(result: CallResult, field: 'accessToken' | 'refreshToken'): string {
    const value = result.body?.[field];
    return typeof value === 'string' ? value : '';
}

export function forgeAdminToken(accessToken: string): string {
    const [header, payload, signature] = accessToken.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const forged = Buffer.from(JSON.stringify({ ...claims, role: 'admin' })).toString('base64url');
    return `${header}.${forged}.${signature}`;
}

export async function cleanupDemoData(
    dataSource: DataSource,
    emails: string[],
    productNames: string[],
): Promise<number> {
    await dataSource.query(
        `DELETE FROM outbox
          WHERE aggregate_type = 'Order'
            AND aggregate_id IN (
                SELECT id::text FROM orders WHERE "userId" IN (SELECT id FROM users WHERE email = ANY($1))
            )`,
        [emails],
    );
    await dataSource.query(`DELETE FROM orders WHERE "userId" IN (SELECT id FROM users WHERE email = ANY($1))`, [emails]);
    await dataSource.query(`DELETE FROM products WHERE name = ANY($1)`, [productNames]);
    await dataSource.query(`DELETE FROM users WHERE email = ANY($1)`, [emails]);

    const rows: Array<{ n: number }> = await dataSource.query(
        `SELECT (SELECT count(*) FROM users WHERE email = ANY($1))::int
              + (SELECT count(*) FROM products WHERE name = ANY($2))::int AS n`,
        [emails, productNames],
    );
    return rows[0].n;
}
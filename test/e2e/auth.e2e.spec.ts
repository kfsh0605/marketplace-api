import request from 'supertest';
import { hashPassword } from '../../src/auth/password';
import { User } from '../../src/entities/user.entity';
import { E2eApp, bootstrapE2eApp } from './testkit/bootstrap-app';

const EMAIL = 'auth.e2e@example.com';
const PASSWORD = 'e2e-password-123';

interface TokenPair {
    accessToken: string;
    refreshToken: string;
    tokenType: string;
    expiresIn: number;
}

describe('Auth E2E: login, refresh, logout (Postgres і Redis через testcontainers)', () => {
    let e2e: E2eApp;

    const http = () => request(e2e.app.getHttpServer());

    async function login(): Promise<TokenPair> {
        const res = await http().post('/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200);
        return res.body as TokenPair;
    }

    beforeAll(async () => {
        e2e = await bootstrapE2eApp();
    }, 120_000);

    afterAll(async () => {
        await e2e.close();
    });

    beforeEach(async () => {
        const users = e2e.dataSource.getRepository(User);
        await users.save(
            users.create({
                email: EMAIL,
                name: 'Auth E2E',
                role: 'customer',
                passwordHash: await hashPassword(PASSWORD),
            }),
        );
    });

    afterEach(async () => {
        await e2e.dataSource.query('TRUNCATE TABLE users RESTART IDENTITY CASCADE');
    });

    it('login: 200 і пара токенів потрібної форми', async () => {
        const pair = await login();

        expect(pair.accessToken.split('.')).toHaveLength(3);
        expect(pair.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(pair.tokenType).toBe('Bearer');
        expect(pair.expiresIn).toBe(600);
    });

    it('login: неправильний пароль і неіснуючий email дають 401 з однаковим detail', async () => {
        const wrongPassword = await http().post('/auth/login').send({ email: EMAIL, password: 'wrong-password' }).expect(401);
        const unknownEmail = await http().post('/auth/login').send({ email: 'nobody@example.com', password: PASSWORD }).expect(401);

        expect(wrongPassword.headers['content-type']).toContain('application/problem+json');
        expect(unknownEmail.body.detail).toBe(wrongPassword.body.detail);
        expect(unknownEmail.body.title).toBe('Unauthorized');
    });

    it('login: некоректне тіло -> 400, зайве поле -> 400', async () => {
        await http().post('/auth/login').send({ email: EMAIL }).expect(400);
        await http().post('/auth/login').send({ email: 'not-an-email', password: PASSWORD }).expect(400);
        await http().post('/auth/login').send({ email: EMAIL, password: PASSWORD, role: 'admin' }).expect(400);
    });

    it('захищений маршрут без токена, зі сміттям і зі схемою Basic -> 401 + WWW-Authenticate', async () => {
        const none = await http().post('/auth/logout').expect(401);
        await http().post('/auth/logout').set('Authorization', 'Bearer not.a.jwt').expect(401);
        await http().post('/auth/logout').set('Authorization', 'Basic dXNlcjpwYXNz').expect(401);

        expect(none.headers['www-authenticate']).toBe('Bearer');
    });

    it('підроблений payload зі старим підписом -> 401', async () => {
        const { accessToken } = await login();
        const [header, payload, signature] = accessToken.split('.');
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        const forged = Buffer.from(JSON.stringify({ ...claims, role: 'admin' })).toString('base64url');

        await http().post('/auth/logout').set('Authorization', `Bearer ${header}.${forged}.${signature}`).expect(401);
    });

    it('refresh: ротація видає нову пару, нова пара працює', async () => {
        const first = await login();

        const rotated = await http().post('/auth/refresh').send({ refreshToken: first.refreshToken }).expect(200);

        expect(rotated.body.refreshToken).not.toBe(first.refreshToken);
        expect(rotated.body.accessToken).not.toBe(first.accessToken);
        await http().post('/auth/logout').set('Authorization', `Bearer ${rotated.body.accessToken}`).expect(204);
    });

    it('refresh: невідомий токен і порожнє тіло', async () => {
        await http().post('/auth/refresh').send({ refreshToken: 'A'.repeat(43) }).expect(401);
        await http().post('/auth/refresh').send({}).expect(400);
    });

    it('logout: 204, потім той самий access -> 401, а refresh цієї сесії -> 401', async () => {
        const pair = await login();

        await http().post('/auth/logout').set('Authorization', `Bearer ${pair.accessToken}`).expect(204);

        await http().post('/auth/logout').set('Authorization', `Bearer ${pair.accessToken}`).expect(401);
        await http().post('/auth/refresh').send({ refreshToken: pair.refreshToken }).expect(401);
        const [{ n }] = await e2e.dataSource.query('SELECT count(*)::int AS n FROM refresh_tokens WHERE revoked_at IS NULL');
        expect(n).toBe(0);
    });

    it('повтор refresh: 401, уся сім\'я мертва, у тому числі access-токен сім\'ї', async () => {
        const first = await login();
        const second = await http().post('/auth/refresh').send({ refreshToken: first.refreshToken }).expect(200);

        await http().post('/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);

        await http().post('/auth/refresh').send({ refreshToken: second.body.refreshToken }).expect(401);
        await http().post('/auth/logout').set('Authorization', `Bearer ${second.body.accessToken}`).expect(401);
    });
});
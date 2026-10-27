import request from 'supertest';
import { hashPassword } from '../../../src/auth/password';
import type { UserRole } from '../../../src/auth/roles';
import { User } from '../../../src/entities/user.entity';
import type { E2eApp } from './bootstrap-app';

export const TEST_PASSWORD = 'e2e-password-123';

export async function createUser(e2e: E2eApp, email: string, role: UserRole = 'customer'): Promise<User> {
    const users = e2e.dataSource.getRepository(User);
    return users.save(
        users.create({
            email,
            name: email.split('@')[0],
            role,
            passwordHash: await hashPassword(TEST_PASSWORD),
        }),
    );
}

export async function loginAs(e2e: E2eApp, email: string): Promise<string> {
    const res = await request(e2e.app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(200);
    return res.body.accessToken as string;
}

export const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });
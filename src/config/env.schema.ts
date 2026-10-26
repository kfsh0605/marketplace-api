import { z } from 'zod';

const FROM_VAULT = 'не задана: секрет має приїхати зі сховища (bash scripts/with-secrets.sh dev <команда>)';
const vaultString = () => z.string(FROM_VAULT).min(1, FROM_VAULT);

export const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DB_HOST: z.string().min(1),
    DB_PORT: z.coerce.number().int().positive().default(5432),
    DB_USER: z.string().min(1),
    DB_NAME: z.string().min(1),
    DATABASE_URL: z.string().min(1).optional(),
    RABBITMQ_HOST: z.string().min(1).default('localhost'),
    RABBITMQ_PORT: z.coerce.number().int().positive().default(5672),
    RABBITMQ_USER: z.string().min(1).default('marketplace'),
    RABBITMQ_URL: z.string().min(1).optional(),
    REDIS_URL: z.string().min(1).optional(),
    REDIS_QUEUE_URL: z.string().min(1).optional(),
    REDIS_DISABLED: z.string().optional(),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),    JWT_KID: vaultString(),
    JWT_PRIVATE_KEY: vaultString(),
    JWT_PUBLIC_KEY: vaultString(),
    REFRESH_TOKEN_PEPPER: vaultString().min(32, 'коротший за 32 символи: потрібен випадковий рядок від 32 байтів'),
});
export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
    const parsed = envSchema.safeParse(config);

    if (!parsed.success) {
        const formatted = parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ');
        throw new Error(`Помилка конфігурації середовища: ${formatted}`);
    }

    return parsed.data;
}
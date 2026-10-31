import { envSchema } from '../config/env.schema';
import type { Env } from '../config/env.schema';

export interface StorageConfig {
    endpoint?: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
}

type StorageEnv = Pick<
    Env,
    'STORAGE_ENDPOINT' | 'STORAGE_REGION' | 'STORAGE_BUCKET' | 'STORAGE_ACCESS_KEY' | 'STORAGE_SECRET_KEY'
>;

const storageEnvSchema = envSchema.pick({
    STORAGE_ENDPOINT: true,
    STORAGE_REGION: true,
    STORAGE_BUCKET: true,
    STORAGE_ACCESS_KEY: true,
    STORAGE_SECRET_KEY: true,
});

export function storageConfigFromEnv(env: StorageEnv): StorageConfig {
    return {
        endpoint: env.STORAGE_ENDPOINT,
        region: env.STORAGE_REGION,
        bucket: env.STORAGE_BUCKET,
        accessKeyId: env.STORAGE_ACCESS_KEY,
        secretAccessKey: env.STORAGE_SECRET_KEY,
    };
}

export function loadStorageConfig(source: NodeJS.ProcessEnv = process.env): StorageConfig {
    const parsed = storageEnvSchema.safeParse(source);
    if (!parsed.success) {
        const formatted = parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ');
        throw new Error(`Помилка конфігурації сховища: ${formatted}`);
    }
    return storageConfigFromEnv(parsed.data);
}
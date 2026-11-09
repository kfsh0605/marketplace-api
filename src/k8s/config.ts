import { z } from 'zod';

const FROM_VAULT = 'не задана: секрет має приїхати зі сховища (K8s Secret ← bash scripts/with-secrets.sh dev <команда>)';

const k8sEnvSchema = z.object({
    PORT: z.coerce.number().int().positive().default(3000),
    WARMUP_MS: z.coerce.number().int().min(0).default(4000),
    DRAIN_MS: z.coerce.number().int().min(0).default(5000),
    LATENCY_MS: z.coerce.number().int().min(0).default(20),
    REV: z.string().min(1).default('0'),
    DB_PASSWORD: z.string(FROM_VAULT).min(1, FROM_VAULT),
});

export type K8sConfig = z.infer<typeof k8sEnvSchema>;

export function loadK8sConfig(env: NodeJS.ProcessEnv): K8sConfig {
    const parsed = k8sEnvSchema.safeParse(env);

    if (!parsed.success) {
        const formatted = parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ');
        throw new Error(`Помилка конфігурації: ${formatted}`);
    }

    return parsed.data;
}
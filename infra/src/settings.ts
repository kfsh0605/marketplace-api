import { PROFILES, Profile } from './profiles';

export const REQUIRED_SECRETS = [
    'DB_PASSWORD',
    'DATABASE_URL',
    'JWT_KID',
    'JWT_PRIVATE_KEY',
    'JWT_PUBLIC_KEY',
    'REFRESH_TOKEN_PEPPER',
    'STORAGE_ACCESS_KEY',
    'STORAGE_SECRET_KEY',
] as const;

export const DEFINED_SECRETS = ['JWT_PREVIOUS_KID', 'JWT_PREVIOUS_PUBLIC_KEY', 'STORAGE_ENDPOINT'] as const;

export type SecretName = (typeof REQUIRED_SECRETS)[number] | (typeof DEFINED_SECRETS)[number];

export interface Settings {
    context: string;
    namespace: string;
    image: string;
    profile: Profile;
    rev: string;
    replicas: number;
    secrets: Record<SecretName, string>;
}

function parseReplicas(raw: string | undefined): number {
    const text = (raw ?? '3').trim();
    if (!/^\d+$/.test(text)) {
        throw new Error(`REPLICAS має бути цілим числом, отримано "${raw}"`);
    }
    const value = Number(text);
    if (value < 2 || value > 10) {
        throw new Error(`REPLICAS=${value}: потрібно від 2 до 10. Одна репліка з PDB це самообман, сенс з'являється від двох`);
    }
    return value;
}

function parseProfile(raw: string | undefined): Profile {
    const value = (raw ?? 'zero').trim();
    if (!(PROFILES as readonly string[]).includes(value)) {
        throw new Error(`ROLLOUT_PROFILE="${value}": дозволено ${PROFILES.join(' | ')}`);
    }
    return value as Profile;
}

export function loadSettings(env: NodeJS.ProcessEnv): Settings {
    const problems: string[] = [];

    const missing = REQUIRED_SECRETS.filter((name) => (env[name] ?? '').trim() === '');
    if (missing.length > 0) {
        problems.push(
            `немає значень зі сховища: ${missing.join(', ')}. Запустіть через bash scripts/with-secrets.sh dev <команда> або експортуйте їх і задайте SKIP_VAULT=1`,
        );
    }

    const undefinedOnes = DEFINED_SECRETS.filter((name) => env[name] === undefined);
    if (undefinedOnes.length > 0) {
        problems.push(
            `змінні мають бути задані (порожнє значення означає «немає», відсутня змінна означає «забули»): ${undefinedOnes.join(', ')}`,
        );
    }

    if (problems.length > 0) {
        throw new Error(`Конфігурація розгортання неповна: ${problems.join('; ')}`);
    }

    const secrets = {} as Record<SecretName, string>;
    for (const name of [...REQUIRED_SECRETS, ...DEFINED_SECRETS]) {
        secrets[name] = env[name] as string;
    }

    return {
        context: env.KUBE_CONTEXT?.trim() || 'kind-hw28',
        namespace: env.K8S_NAMESPACE?.trim() || 'marketplace',
        image: env.IMAGE?.trim() || 'marketplace-api:hw28',
        profile: parseProfile(env.ROLLOUT_PROFILE),
        rev: env.ROLLOUT_REV?.trim() || '1',
        replicas: parseReplicas(env.REPLICAS),
        secrets,
    };
}

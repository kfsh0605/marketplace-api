import { readFileSync } from 'node:fs';
import { envSchema } from '../src/config/env.schema.ts';

const REQUIRED_KEYS = Object.keys(envSchema.shape);

const content = readFileSync('.env.example', 'utf8');

const presentKeys = new Set(
    content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
        .map((line) => line.split('=')[0].trim()),
);

const missing = REQUIRED_KEYS.filter((key) => !presentKeys.has(key));

if (missing.length > 0) {
    console.error('.env.example не синхронізований зі схемою. Відсутні змінні:');
    for (const key of missing) {
        console.error(`  - ${key}`);
    }
    process.exit(1);
}

console.log('.env.example синхронізований зі схемою:', REQUIRED_KEYS.join(', '));
process.exit(0);
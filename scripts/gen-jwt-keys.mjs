import { createHash, createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const slug = process.argv[2];
const force = process.argv.includes('--force');

if (slug !== 'dev' && slug !== 'prod') {
    console.error('використання: node scripts/gen-jwt-keys.mjs <dev|prod> [--force]');
    process.exit(2);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'secrets', 'jwt', slug);
const names = ['private.pem', 'public.pem', 'kid', 'refresh_pepper'];

if (!force && names.some((name) => existsSync(join(dir, name)))) {
    console.error(`${dir} уже містить ключі. Перегенерація вб'є всі видані токени. Якщо це навмисно: --force`);
    process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const kid = `${slug}-${new Date().toISOString().slice(0, 10)}`;
const pepper = randomBytes(32).toString('base64url');

mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'private.pem'), privateKey, { mode: 0o600 });
writeFileSync(join(dir, 'public.pem'), publicKey);
writeFileSync(join(dir, 'kid'), kid);
writeFileSync(join(dir, 'refresh_pepper'), pepper, { mode: 0o600 });

const der = createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
const fingerprint = createHash('sha256').update(der).digest('hex').slice(0, 8);
console.log(`[fp] ${slug}=${fingerprint} kid=${kid}`);
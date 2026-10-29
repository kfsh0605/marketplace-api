import { createHash, createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const slug = process.argv[2];
const force = process.argv.includes('--force');
const rotate = process.argv.includes('--rotate');

if (slug !== 'dev' && slug !== 'prod') {
    console.error('використання: node scripts/gen-jwt-keys.mjs <dev|prod> [--force | --rotate]');
    process.exit(2);
}

if (force && rotate) {
    console.error('--force і --rotate взаємовиключні');
    process.exit(2);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'secrets', 'jwt', slug);
const names = ['private.pem', 'public.pem', 'kid', 'refresh_pepper'];

function fingerprintOf(publicPem) {
    const der = createPublicKey(publicPem).export({ type: 'spki', format: 'der' });
    return createHash('sha256').update(der).digest('hex').slice(0, 8);
}

if (rotate) {
    const missing = names.filter((name) => !existsSync(join(dir, name)));
    if (missing.length > 0) {
        console.error(`--rotate: у ${dir} немає ${missing.join(', ')}, нічого ротувати. Спершу: node scripts/gen-jwt-keys.mjs ${slug}`);
        process.exit(1);
    }
} else if (!force && names.some((name) => existsSync(join(dir, name)))) {
    console.error(`${dir} уже містить ключі. Перегенерація вб'є всі видані токени. Якщо це навмисно: --force. Для ротації з перекриттям: --rotate`);
    process.exit(1);
}

const previousKid = rotate ? readFileSync(join(dir, 'kid'), 'utf8').trim() : null;
if (rotate) {
    copyFileSync(join(dir, 'public.pem'), join(dir, 'previous_public.pem'));
    writeFileSync(join(dir, 'previous_kid'), previousKid);
}

const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
});

let kid = `${slug}-${new Date().toISOString().slice(0, 10)}`;
if (kid === previousKid) {
    kid = `${kid}-${Date.now().toString(36)}`;
}

mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'private.pem'), privateKey, { mode: 0o600 });
writeFileSync(join(dir, 'public.pem'), publicKey);
writeFileSync(join(dir, 'kid'), kid);
if (!rotate) {
    writeFileSync(join(dir, 'refresh_pepper'), randomBytes(32).toString('base64url'), { mode: 0o600 });
}

console.log(`[fp] ${slug}=${fingerprintOf(publicKey)} kid=${kid}`);
if (rotate) {
    console.log(`[fp] ${slug}-previous=${fingerprintOf(readFileSync(join(dir, 'previous_public.pem')))} kid=${previousKid}`);
}
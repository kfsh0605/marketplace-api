// Готує чистий клон до запуску: створює .env і файли-секрети з шаблонів, генерує dev-ключі JWT.
// Нічого не перезаписує. Після нього: docker compose --profile app up -d --wait
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const at = (...parts) => join(root, ...parts);

function report(action, name) {
    console.log(`${action.padEnd(9)} ${name}`);
}

// .env: DATABASE_URL і RABBITMQ_URL у шаблоні мають заглушку `changeme`, а справжні значення збирає
// scripts/with-secrets.sh із файлів-секретів. Заглушку в .env не переносимо, інакше вона б їх перекрила.
if (existsSync(at('.env'))) {
    report('є', '.env');
} else {
    const lines = readFileSync(at('.env.example'), 'utf8')
        .split(/\r?\n/)
        .filter((line) => !/^(DATABASE_URL|RABBITMQ_URL)=/.test(line));
    writeFileSync(at('.env'), `${lines.join('\n')}\n`);
    report('створено', '.env (з .env.example без DATABASE_URL і RABBITMQ_URL)');
}

for (const name of ['db_password', 'rabbitmq_password', 'storage_access_key', 'storage_secret_key', 'grafana_admin_password']) {
    const target = at('secrets', name);
    if (existsSync(target)) {
        report('є', `secrets/${name}`);
    } else {
        copyFileSync(at('secrets', `${name}.example`), target);
        report('створено', `secrets/${name} (dev-значення з шаблону, не секрет)`);
    }
}

const jwtFiles = ['private.pem', 'public.pem', 'kid', 'refresh_pepper'];
if (jwtFiles.every((name) => existsSync(at('secrets', 'jwt', 'dev', name)))) {
    report('є', 'secrets/jwt/dev (ключі ES256)');
} else {
    const result = spawnSync(process.execPath, [at('scripts', 'gen-jwt-keys.mjs'), 'dev'], { stdio: 'inherit' });
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
    report('створено', 'secrets/jwt/dev (ключі ES256)');
}

// контейнер працює не від root і має прочитати змонтовані ключі
if (process.platform !== 'win32') {
    for (const name of jwtFiles) {
        chmodSync(at('secrets', 'jwt', 'dev', name), 0o644);
    }
}

console.log('\nГотово. Далі: docker compose --profile app up -d --wait');

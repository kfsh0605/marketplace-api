# Marketplace API

Навчальний курсовий проєкт: REST API для маркетплейсу (товари та замовлення) на NestJS.

## Обраний варіант

API реалізує 2 ресурси та 5 операцій:

- `GET /products` — список товарів (курсорна пагінація)
- `GET /products/{productId}` — товар за id
- `GET /orders` — список замовлень (курсорна пагінація)
- `GET /orders/{orderId}` — замовлення за id
- `POST /orders` — створення замовлення, з підтримкою ідемпотентності через заголовок `Idempotency-Key`

Ідемпотентність: клієнт сам генерує унікальний `Idempotency-Key` для кожного нового замовлення. Якщо той самий ключ повторно приходить з тим самим тілом запиту — сервер повертає збережену раніше відповідь (з заголовком `Idempotency-Replay: true`), не створюючи нове замовлення. Якщо той самий ключ приходить з іншим тілом — повертається `422 Unprocessable Entity`.

Усі помилки повертаються в єдиному форматі `application/problem+json` (RFC 9457): `type`, `title`, `status`, `detail`, `instance`.

## Технології

- NestJS (контролери, DTO з `class-validator`, `@nestjs/swagger` для контракту з коду)
- PostgreSQL (через `pg.Pool`), Docker Compose
- Zod — валідація змінних середовища з fail-fast стартом

## Встановлення

npm install


## Конфігурація

Проєкт читає конфігурацію з двох джерел: `.env`-файл (звичайні налаштування) та `secrets/db_password` (пароль БД — окремо, файлом, а не змінною середовища).

1. Скопіюй шаблон змінних середовища і заповни своїми значеннями:
   cp .env.example .env
2. Створи файл-секрет з паролем PostgreSQL (для локальної розробки підійде шаблон):
   cp secrets/db_password.example secrets/db_password

| Змінна          | Обов'язкова | Опис                                              |
|-----------------|:-----------:|----------------------------------------------------|
| `PORT`          | ні (`3000` за замовч.) | Порт HTTP-сервера                        |
| `NODE_ENV`      | ні (`development` за замовч.) | `development` \| `test` \| `production` |
| `DB_HOST`       | так         | Хост PostgreSQL                                    |
| `DB_PORT`       | ні (`5432` за замовч.) | Порт PostgreSQL                          |
| `DB_USER`       | так         | Користувач PostgreSQL                              |
| `DB_NAME`       | так         | Назва бази даних                                   |
| `DATABASE_URL`  | ні          | Рядок підключення до БД одним рядком (контракт для сумісності з ДЗ #13 та інструментами на кшталт грейдера). **Джерело — сховище**: в реальному оточенні значення приходить із секрет-менеджера/змінних середовища платформи, а не з файлу в git. Сам застосунок (`src/database/database.module.ts`) продовжує підключатись через `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_NAME` + файл-пароль нижче — `DATABASE_URL` цю логіку не замінює. |

Пароль PostgreSQL **не** є змінною середовища — він читається застосунком з файлу `secrets/db_password` (`src/database/database.module.ts`), причому файл перечитується заново при кожному новому підключенні до БД. Це і дозволяє міняти пароль без рестарту застосунку (див. розділ "Ротація" нижче).

Конфігурація зі схеми (`src/config/env.schema.ts`, Zod) валідується одразу при старті застосунку через `ConfigModule.forRoot({ validate })`. Якщо обов'язкова змінна відсутня або має неправильний тип — застосунок **не стартує** і одразу завершується з ненульовим кодом виходу та переліком усіх помилок одразу (fail-fast), замість того щоб впасти пізніше під час роботи.

Перевірити, що `.env.example` не розійшовся зі схемою (без запуску застосунку):

npm run check:env


**Секрети:** `.env` і `secrets/db_password` ніколи не комітяться в git (див. `.gitignore`) і ніколи не потрапляють у Docker-образ (див. `.dockerignore`) — у самому образі є лише `.env.example` як довідковий шаблон. У `Dockerfile`/`docker-compose.yml` немає жодного реального значення секрету: Postgres теж отримує пароль через файл (`POSTGRES_PASSWORD_FILE`, той самий `secrets/db_password`), а не через змінну середовища. У git натомість лежить `secrets/db_password.example` — шаблон із заглушкою, з якого й копіюється реальний файл.

## Запуск

Разова збірка та запуск (використовується і в Docker, і як `npm run start` — процес завершується з ненульовим кодом при помилці конфігурації, тому годиться і для CI-перевірок):

npm run build
npm run start

Розробка з автоперезапуском при зміні файлів:

npm run start:dev

Разом із Postgres через Docker Compose:

docker compose up -d
npm run start:dev


Після старту:
- API: `http://localhost:3000`
- Swagger-документація (згенерована з коду через `@nestjs/swagger`): `http://localhost:3000/docs`
- Перевірка стану застосунку, підключення до БД та uptime процесу: `http://localhost:3000/health`

## Ротація пароля БД без рестарту

`pg.Pool` у застосунку налаштований так, що пароль передається не рядком, а функцією (`src/database/database.module.ts`), яка при кожному новому підключенні до Postgres заново читає файл `secrets/db_password` з диска. Ніякого кешування паролю в пам'яті немає — тому змінити пароль можна "на льоту", без перезапуску Node-процесу.

Скрипт `rotate.sh` виконує повний цикл ротації в правильному порядку:
1. Генерує новий випадковий пароль.
2. Застосовує його в Postgres (`ALTER ROLE ... WITH PASSWORD ...`).
3. **Тільки після цього** перезаписує файл `secrets/db_password` (порядок важливий: якщо зробити навпаки, виникне вікно, коли файл уже з новим паролем, а Postgres ще очікує старий).
4. Розриває всі активні з'єднання від імені застосунку (`pg_terminate_backend`), щоб `pg.Pool` одразу переоткрив з'єднання вже з новим паролем.

Запуск:

bash rotate.sh

(на Windows — через Git Bash, який встановлюється разом із Git for Windows)

Перевірити, що ротація пройшла без рестарту, можна порівнявши `uptime` в `/health` до і після:

curl http://localhost:3000/health # запам'ятай uptime
bash rotate.sh
curl http://localhost:3000/health # uptime має бути більшим, а не скинутим до нуля


## Docker

Збірка production-образу застосунку (multi-stage build — фінальний образ не містить dev-залежностей, TypeScript-джерел, `.env` і `secrets/`):

docker build -t marketplace-api .


## База даних (ДЗ №12)

Головна таблиця — **`orders`** (мінімум 100 000 рядків після `db/seed.sql`, фактично 120 000).

Підняти Postgres з нуля (файл-секрет береться з шаблону, якщо реального ще нема):

Підняти Postgres з нуля (потрібні `.env` і файл-секрет — беремо з шаблонів, якщо реальних ще нема):

    docker compose down -v
    cp .env.example .env
    cp secrets/db_password.example secrets/db_password
    docker compose up -d --wait

(PowerShell: замість `cp` — `Copy-Item .env.example .env` і `Copy-Item secrets/db_password.example secrets/db_password`)

(PowerShell: замість `cp` — `Copy-Item secrets/db_password.example secrets/db_password -ErrorAction SilentlyContinue`)

Прогнати всі кроки по порядку (папка `db/` змонтована всередину контейнера Postgres як `/db`, тому команди однакові в будь-якій оболонці):

docker compose exec -T postgres psql -U marketplace -d marketplace -v ON_ERROR_STOP=1 -f /db/schema.sql
docker compose exec -T postgres psql -U marketplace -d marketplace -v ON_ERROR_STOP=1 -f /db/seed.sql
docker compose exec -T postgres psql -U marketplace -d marketplace -v ON_ERROR_STOP=1 -f /db/indexes.sql
docker compose exec -T postgres psql -U marketplace -d marketplace -c "ANALYZE;"

Перевірити, що база піднялась і готова приймати запити:

docker compose exec -T postgres psql -U marketplace -d marketplace -Atc "SELECT 1"

Порівняння `EXPLAIN (ANALYZE, BUFFERS)` до і після застосування індексів — `db/OPTIMIZATIONS.md`.

## Структура

| Шлях                          | Призначення                                      |
|-------------------------------|---------------------------------------------------|
| `src/products/`                | Модуль товарів (контролер, сервіс, DTO)          |
| `src/orders/`                  | Модуль замовлень (контролер, сервіс, DTO)        |
| `src/common/`                  | Пагінація, exception filter, interceptor         |
| `src/config/`                  | Zod-схема середовища та fail-fast валідація      |
| `src/database/`                | `pg.Pool` з паролем-функцією, що читає файл-секрет |
| `src/health/`                  | Ендпоінт `/health` (стан БД + uptime)            |
| `db/schema.sql`                | Таблиці курсового домену (`users`, `products`, `orders`, `order_items`) + constraints |
| `db/seed.sql`                  | Генерація ~120 000 замовлень і пов'язаних даних, `VACUUM (ANALYZE)` наприкінці |
| `db/queries/q1.sql, q2.sql, q3.sql` | Три "важкі" запити (власник+період, статус, регістронезалежний пошук) |
| `db/indexes.sql`               | Індекси-ліки для цих трьох запитів (composite, partial, expression) |
| `db/OPTIMIZATIONS.md`          | `EXPLAIN (ANALYZE, BUFFERS)` до/після по кожному запиту |
| `secrets/db_password`          | Файл-секрет з паролем PostgreSQL (у `.gitignore`)|
| `secrets/db_password.example`  | Шаблон секрету для свіжого клону/грейдера        |
| `scripts/check-env-example.mjs`| Звірка `.env.example` зі схемою (`npm run check:env`) |
| `docker-compose.yml`           | PostgreSQL для локальної розробки, `db/` змонтована в контейнер як `/db` |
| `Dockerfile` + `.dockerignore` | Production-образ застосунку (multi-stage), без секретів у шарах |
| `rotate.sh`                    | Ротація пароля БД без рестарту                   |
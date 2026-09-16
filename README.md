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

## ORM у Node.js: TypeORM (ДЗ №13)

Курсова схема з ДЗ №12 (таблиці `users`, `products`, `orders`, `order_items`, три FK) тепер описана у вигляді TypeORM entities (`src/entities/`) замість чистого SQL і піднімається через міграції — `synchronize` вимкнено (`synchronize: false` у `src/data-source.ts`), жодна таблиця не створюється й не змінюється "магічно" при старті застосунку.

### Команди

    npm run build              # компіляція TypeScript → dist/ (потрібна перед будь-якою з команд нижче)
    npm run migrate            # застосувати всі нові міграції
    npm run migrate:show       # список міграцій зі статусом [X]/[ ]
    npm run migrate:revert     # відкотити останню застосовану міграцію
    npm run seed                # наповнити базу детермінованими тестовими даними (ідемпотентно)
    npm run demo:nplus1        # продемонструвати проблему N+1 і три способи її вирішення
    npm run report              # звіт "топ товарів за виторгом" через QueryBuilder

Усі команди, що ходять у базу (`migrate`, `migrate:show`, `migrate:revert`, `seed`, `demo:nplus1`, `report`), загорнуті у `scripts/with-secrets.sh dev ...` — той самий скрипт з ДЗ №11, що підтягує `DB_PASSWORD` з файлу-секрету (або пропускає цей крок при `SKIP_VAULT=1`, див. розділ "Grading" нижче).

### onDelete: чому саме так

| Зв'язок                            | Стратегія   | Чому |
|-------------------------------------|-------------|------|
| `order_items.order` → `orders`      | `CASCADE`   | Позиції замовлення не мають сенсу без самого замовлення — видалення замовлення видаляє й усі його позиції, як список покупок, приколотий до чека: викинув чек — викинув і список. |
| `order_items.product` → `products`  | `RESTRICT`  | Не можна тихо видалити товар з каталогу, поки на нього посилається хоч одна позиція в чиємусь замовленні — інакше в базі лишилась би позиція, що вказує на неіснуючий товар. |
| `orders.user` → `users`             | `RESTRICT`  | Так само — не можна видалити користувача, поки в нього є історія замовлень; спершу потрібно явно вирішити, що робити з його замовленнями. |

### N+1: демонстрація і фікс (`npm run demo:nplus1`)

Граф зв'язків: `Order → OrderItem → Product` (2 рівні). Вимірювалось власним `Logger`, що інкрементить лічильник на кожен реальний SQL-запит.

| Стратегія                                                | Запитів (виміряно) | Формула з завдання           |
|------------------------------------------------------------|:---:|-------------------------------|
| Наївний підхід (запит у циклі)                              | 49  | ≥ N (N=10 замовлень)          |
| `find()` + `relations` (join-стратегія за замовчуванням)    | 1   | 1                              |
| `leftJoinAndSelect` (QueryBuilder, явно те саме)            | 1   | 1                              |
| `relationLoadStrategy: 'query'`                             | 5   | 1 + 2×2 (два рівні зв'язків)   |

Наївний підхід — це насправді не просто "N+1", а "N+1+M": один запит на список замовлень, ще N — по одному на позиції кожного замовлення, і ще M×2 — по два запити на кожну окрему позицію (TypeORM для одиночного `findOne` зі зв'язком спершу окремим запитом знаходить id, а вже потім тягне дані). Обидва JOIN-варіанти (`relations` і `leftJoinAndSelect`) дають рівно 1 запит незалежно від кількості замовлень — по суті вони генерують однаковий SQL. Головний висновок: у "хороших" стратегій кількість запитів **стала** і не залежить від об'єму даних, а в наївного підходу вона **лінійно росте** разом з кількістю рядків.

### Repository vs QueryBuilder

`Repository` (`find`, `findOne`, `save`, `upsert`) використовується всюди, де потрібні самі сутності схеми — читання, запис, підвантаження зв'язків. `QueryBuilder` (`createQueryBuilder().getRawMany()`) — лише там, де результат у принципі не є сутністю: агрегати (`SUM`, `GROUP BY`), як у `report.ts`. Межа проста: якщо результат запиту можна змалювати як список об'єктів `Order`/`Product`/... — це `Repository`; якщо результат — обчислене значення (сума, кількість, групування) — це `QueryBuilder` з `getRawMany()`.

## Grading

Грейдер (і будь-хто на свіжому клоні без доступу до сховища секретів) виконує рівно ці команди з кореня репозиторію:

    cp secrets/db_password.example secrets/db_password
    export DB_HOST=127.0.0.1
    export DB_PORT=5432
    export DB_USER=marketplace
    export DB_PASSWORD=dev_password_change_me
    export DB_NAME=marketplace
    export SKIP_VAULT=1    # у грейдера немає доступу до сховища
    docker compose up -d --wait

    npm ci
    npx tsc --noEmit

    npm run build
    npm run migrate
    npm run migrate:show

    npm run migrate:revert
    npm run migrate

    npm run seed
    npm run seed

    npm run demo:nplus1
    npm run report

`DB_PASSWORD=dev_password_change_me` — те саме dev-значення, що лежить у `secrets/db_password.example` і завжди використовується для локальної розробки; воно навмисно не є секретом (домовленість з ДЗ №11). Крок `cp secrets/db_password.example secrets/db_password` обов'язковий: без нього Docker при спробі змонтувати неіснуючий секрет-файл створить на його місці порожню директорію замість файлу, і Postgres впаде з помилкою "superuser password is not specified" (перевірено на реальному чистому клоні).

Перевірка ідемпотентності сіда (кількість рядків не змінюється після повторного запуску):

    docker compose exec -T postgres psql -U marketplace -d marketplace -Atc \
      "SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM products) AS products, (SELECT count(*) FROM orders) AS orders, (SELECT count(*) FROM order_items) AS order_items;"

## Структура

| Шлях                          | Призначення                                      |
|-------------------------------|---------------------------------------------------|
| `src/products/`                | Модуль товарів (контролер, сервіс, DTO)          |
| `src/orders/`                  | Модуль замовлень (контролер, сервіс, DTO)        |
| `src/common/`                  | Пагінація, exception filter, interceptor         |
| `src/config/`                  | Zod-схема середовища та fail-fast валідація      |
| `src/database/`                | `pg.Pool` з паролем-функцією, що читає файл-секрет |
| `src/health/`                  | Ендпоінт `/health` (стан БД + uptime)            |
| `src/entities/`                | TypeORM entities схеми з ДЗ №12 (`User`, `Product`, `Order`, `OrderItem`) |
| `src/migrations/`              | Згенеровані TypeORM-міграції (`Init`, `AddProductsNameUnique`) |
| `src/data-source.ts`           | `DataSource` для TypeORM CLI та скриптів: `synchronize: false`, конфіг з `process.env` |
| `src/seed.ts`                  | Детермінований ідемпотентний seed (users/products через `upsert`, orders/order_items — за guard'ом на існуючий count) |
| `src/demo-nplus1.ts`           | Демо проблеми N+1 і трьох способів фіксу, з власним `Logger`-лічильником запитів |
| `src/report.ts`                | Звіт "топ товарів за виторгом" через `createQueryBuilder().getRawMany()` |
| `db/schema.sql`                | Таблиці курсового домену (`users`, `products`, `orders`, `order_items`) + constraints |
| `db/seed.sql`                  | Генерація ~120 000 замовлень і пов'язаних даних, `VACUUM (ANALYZE)` наприкінці |
| `db/queries/q1.sql, q2.sql, q3.sql` | Три "важкі" запити (власник+період, статус, регістронезалежний пошук) |
| `db/indexes.sql`               | Індекси-ліки для цих трьох запитів (composite, partial, expression) |
| `db/OPTIMIZATIONS.md`          | `EXPLAIN (ANALYZE, BUFFERS)` до/після по кожному запиту |
| `secrets/db_password`          | Файл-секрет з паролем PostgreSQL (у `.gitignore`)|
| `secrets/db_password.example`  | Шаблон секрету для свіжого клону/грейдера        |
| `scripts/check-env-example.mjs`| Звірка `.env.example` зі схемою (`npm run check:env`) |
| `scripts/with-secrets.sh`      | Обгортка, що підтягує `DB_PASSWORD` із `secrets/db_password` перед будь-якою командою до бази (пропускається при `SKIP_VAULT=1`) |
| `package.json`                 | Скрипти `build`, `migrate`, `migrate:show`, `migrate:revert`, `seed`, `demo:nplus1`, `report` |
| `docker-compose.yml`           | PostgreSQL для локальної розробки, `db/` змонтована в контейнер як `/db` |
| `Dockerfile` + `.dockerignore` | Production-образ застосунку (multi-stage), без секретів у шарах |
| `rotate.sh`                    | Ротація пароля БД без рестарту                   |
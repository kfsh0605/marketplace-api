# Marketplace API

Навчальний курсовий проєкт: REST API для маркетплейсу (товари та замовлення) на NestJS.

## Обраний варіант

API реалізує 2 ресурси та 5 операцій:

- `GET /products` — список товарів (курсорна пагінація)
- `GET /products/{productId}` — товар за id
- `GET /orders` — список замовлень (курсорна пагінація)
- `GET /orders/{orderId}` — замовлення за id
- `POST /orders` — створення замовлення, з підтримкою ідемпотентності через заголовок `Idempotency-Key`

Ідемпотентність: клієнт сам генерує унікальний `Idempotency-Key` для кожного нового замовлення (заголовок обов'язковий, без нього `400`). Якщо той самий ключ повторно приходить з тим самим тілом запиту — сервер повертає те саме замовлення (з заголовком `Idempotency-Replay: true`), не створюючи нового. Якщо той самий ключ приходить з іншим тілом — повертається `422 Unprocessable Entity`. Ключі зберігаються в таблиці `idempotency_keys` в Postgres і записуються тією ж транзакцією, що й замовлення (деталі: розділ «Outbox та ідемпотентність (ДЗ №22)»).

Усі помилки повертаються в єдиному форматі `application/problem+json` (RFC 9457): `type`, `title`, `status`, `detail`, `instance`.

## Технології

- NestJS (контролери, DTO з `class-validator`, `@nestjs/swagger` для контракту з коду)
- PostgreSQL (через `pg.Pool`), Docker Compose
- Zod — валідація змінних середовища з fail-fast стартом
- Redis 8 (ioredis, BullMQ): кеш, сесії, ліміти запитів і черга задач на двох окремих інстансах (ДЗ №23)

## Встановлення

npm install


## Конфігурація

Проєкт читає конфігурацію з двох джерел: `.env`-файл (звичайні налаштування) та `secrets/db_password` (пароль БД — окремо, файлом, а не змінною середовища).

1. Скопіюй шаблон змінних середовища і заповни своїми значеннями:
   cp .env.example .env
2. Створи файл-секрет з паролем PostgreSQL (для локальної розробки підійде шаблон):
   cp secrets/db_password.example secrets/db_password
3. Створи файл-секрет з паролем RabbitMQ (ДЗ №19, так само шаблон):
   cp secrets/rabbitmq_password.example secrets/rabbitmq_password

| Змінна          | Обов'язкова | Опис                                              |
|-----------------|:-----------:|----------------------------------------------------|
| `PORT`          | ні (`3000` за замовч.) | Порт HTTP-сервера                        |
| `NODE_ENV`      | ні (`development` за замовч.) | `development` \| `test` \| `production` |
| `DB_HOST`       | так         | Хост PgBouncer (застосунок ходить у базу через PgBouncer, не напряму в Postgres) |
| `DB_PORT`       | ні (`6432` за замовч.) | Порт PgBouncer (Postgres сам слухає 5432, але застосунок туди не ходить) |
| `DB_USER`       | так         | Користувач PostgreSQL                              |
| `DB_NAME`       | так         | Назва бази даних                                   |
| `DATABASE_URL`  | ні          | Рядок підключення до БД одним рядком (контракт для сумісності з ДЗ #13/#15 та інструментами на кшталт грейдера, вказує на PgBouncer). **Джерело — сховище**: в реальному оточенні значення приходить із секрет-менеджера/змінних середовища платформи, а не з файлу в git. Сам застосунок (`src/data-source.ts`) продовжує підключатись через `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_NAME` + файл-пароль нижче — `DATABASE_URL` цю логіку не замінює, ним користуються лише `scripts/backup.sh`/`scripts/restore-drill.sh` (див. "Data layer ops"). |
| `RABBITMQ_HOST` | ні (`localhost` за замовч.) | Хост брокера RabbitMQ (ДЗ №19) |
| `RABBITMQ_PORT` | ні (`5672` за замовч.) | AMQP-порт (не `15672`: це HTTP-панель управління) |
| `RABBITMQ_USER` | ні (`marketplace` за замовч.) | Користувач брокера |
| `RABBITMQ_URL`  | ні          | Повний `amqp://`-URL. Якщо не заданий, його збирає `scripts/with-secrets.sh` із полів вище та `secrets/rabbitmq_password` |
| `RABBITMQ_DISABLED` | ні      | `1` вимикає брокер повністю (e2e-тести і CI без RabbitMQ) |
| `REDIS_URL` | ні (без неї Redis вимкнено) | Інстанс-**кеш** (`redis-cache`, `allkeys-lru`): картки товарів, локи, ліміти. Шаблон: `redis://127.0.0.1:6390` (ДЗ №23) |
| `REDIS_QUEUE_URL` | ні | Інстанс-**черга** (`redis-queue`, `noeviction` + AOF): BullMQ і сесії. Шаблон: `redis://127.0.0.1:6380` |
| `REDIS_DISABLED` | ні | `1` вимикає Redis повністю: API працює без кешу й ліміту (e2e-тести і CI без Redis) |
| `TRUST_PROXY_HOPS` | ні (`0` за замовч.) | Скільки reverse-proxy стоїть перед API; потрібно, щоб rate-limit бачив справжній IP клієнта з `X-Forwarded-For` |

Змінні AuthN/AuthZ (`JWT_KID`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `REFRESH_TOKEN_PEPPER`) не мають дефолтів і описані з джерелом окремою таблицею в розділі «Auth».

Пароль PostgreSQL **не** є змінною середовища — він читається застосунком з файлу `secrets/db_password` (`src/database/database.module.ts`), причому файл перечитується заново при кожному новому підключенні до БД. Це і дозволяє міняти пароль без рестарту застосунку (див. розділ "Ротація" нижче).

Конфігурація зі схеми (`src/config/env.schema.ts`, Zod) валідується одразу при старті застосунку через `ConfigModule.forRoot({ validate })`. Якщо обов'язкова змінна відсутня або має неправильний тип — застосунок **не стартує** і одразу завершується з ненульовим кодом виходу та переліком усіх помилок одразу (fail-fast), замість того щоб впасти пізніше під час роботи.

Перевірити, що `.env.example` не розійшовся зі схемою (без запуску застосунку):

npm run check:env


**Секрети:** `.env` і `secrets/db_password` ніколи не комітяться в git (див. `.gitignore`) і ніколи не потрапляють у Docker-образ (див. `.dockerignore`) — у самому образі є лише `.env.example` як довідковий шаблон. У `Dockerfile`/`docker-compose.yml` немає жодного реального значення секрету: Postgres теж отримує пароль через файл (`POSTGRES_PASSWORD_FILE`, той самий `secrets/db_password`), а не через змінну середовища. У git натомість лежить `secrets/db_password.example` — шаблон із заглушкою, з якого й копіюється реальний файл. Той самий пароль (навмисно не є секретом, домовленість з ДЗ №11) прописаний і в `pgbouncer/userlist.txt` — інакше PgBouncer не зможе піднімати власне з'єднання до Postgres.

## Запуск

Разова збірка та запуск (використовується і в Docker, і як `npm run start` — процес завершується з ненульовим кодом при помилці конфігурації, тому годиться і для CI-перевірок):

npm run build
npm run start

Розробка з автоперезапуском при зміні файлів:

npm run start:dev

Разом із Postgres, PgBouncer, RabbitMQ та двома Redis (кеш і черга) через Docker Compose:

docker compose up -d --wait
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

Після ротації не забудь синхронно оновити пароль і в `pgbouncer/userlist.txt` — інакше PgBouncer не зможе підключитись до Postgres власним backend-з'єднанням (client-side автентифікація в PgBouncer і server-side підключення до Postgres використовують той самий пароль).

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

## Конкурентність: транзакційний checkout, черга задач і retry (ДЗ №14)

Бізнес-операція "оформити замовлення" (`src/checkout.ts`) виконується в одній транзакції на одному клієнті пула (`AppDataSource.transaction(...)`): атомарно зменшує `stock` товару, атомарно списує `balanceCents` покупця, записує `Order` + `OrderItem`, і кладе задачу на постобробку (лист/чек) у чергу `post_processing_jobs`. Якщо товару чи грошей не вистачає — транзакція відкочується цілком, замовлень-"сиріт" не виникає.

### Чому атомарний `UPDATE ... RETURNING`, а не `SELECT ... FOR UPDATE`

Обидва зменшення (stock і balance) реалізовані як `UPDATE ... SET x = x - $n WHERE ... AND x >= $n RETURNING ...`, а не як явний лок рядка. Перевірка достатності та сама зміна відбуваються одним неподільним оператором — між ними немає вікна, в яке могла б втрутитися інша транзакція, тому навіть дефолтний `READ COMMITTED` тут повністю захищає від lost update: Postgres сам чекає конкурентний `UPDATE`, що вже торкнувся цього рядка, і перевіряє `WHERE`-умову заново проти вже оновлених даних. `FOR UPDATE` був би виправданий, якби між читанням і записом потрібно було виконати щось зовнішнє (наприклад, звернутись до платіжного шлюзу) — тоді лок довелося б тримати відкритим на час цього звернення. У checkout такої паузи немає, тому атомарний `UPDATE` простіший і не змушує конкурентних покупців чекати один одного в черзі на рівні застосунку.

### Черга задач і SKIP LOCKED

Кожне успішне замовлення кладе рядок у `post_processing_jobs` (`status = 'new'`). Воркери (`src/demo-workers.ts`) розбирають чергу запитом `SELECT ... WHERE status = 'new' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`, тримаючи транзакцію відкритою на весь час "обробки" задачі, і лише в кінці одним пакетом виставляють `status = 'done'` і інкрементують лічильник `processed`. Порожній результат `SKIP LOCKED` не означає "черга порожня" (можливо, останні задачі саме зараз тримають інші воркери) — тому воркер перед завершенням додатково перевіряє реальну кількість задач зі `status = 'new'`.

### Retry і чому лише 40001/40P01

`demo:retry` навмисно відтворює read-modify-write під `REPEATABLE READ` (два конкурентні читання балансу з подальшим записом обчисленого в JS значення) — це той самий "поганий" патерн, що й lost update, але під ізоляцією, яка не дає його зробити тихо: другій транзакції, що намагається записати вже змінений конкурентом рядок, Postgres повертає `40001 (serialization_failure)`. Обгортка `withRetry` (`src/demo-retry.ts`) ловить **лише** `40001` і `40P01` (deadlock, `deadlock_detected`) — це єдині два коди, якими база сама каже "нічого не зламано, просто невдалий збіг у часі, повтори транзакцію цілком з початку". Будь-який інший код (наприклад, `23514` — порушення `CHECK`) означає реальну помилку в даних чи логіці: повторювати таку операцію безглуздо, вона провалиться так само і вдесяте. Повтор виконується **цілком**, включно з початковим читанням, а не лише останнім записом — інакше повтор просто відтворив би той самий lost update кроком пізніше, вже з застарілим значенням, зчитаним на першій спробі.

### Команди

    npm run demo:race       # 50 паралельних checkout() на товар зі stock=10
    npm run demo:workers    # ≥2 воркери розбирають чергу задач через SKIP LOCKED
    npm run demo:retry      # read-modify-write під REPEATABLE READ + retry на 40001

Усі три, як і решта команд до бази, загорнуті у `scripts/with-secrets.sh dev ...`.

### Цифри з реального запуску

**`demo:race`** — 50 паралельних викликів `checkout()` на товар зі стартовим stock=10 (окремий, ізольований від каталогу товар `DEMO_RACE_PRODUCT`, ресетиться самим скриптом при кожному запуску):

    Спроб: 50
    Успішних: 10
    Фінальний stock: 0
    Рядків із від'ємним stock: 0

**`demo:workers`** — 12 задач, 4 воркери, імітація роботи 100 мс на задачу:

    Розподіл задач по воркерах: { worker-1: 3, worker-2: 3, worker-3: 3, worker-4: 3 }
    Оброблено двічі: 0
    Необроблено: 0
    Час (паралельно): 359 мс
    Час (послідовно, теоретично): 1200 мс

**`demo:retry`** — конкурентний read-modify-write балансу під `REPEATABLE READ` (A: +5000, B: −3000, старт 100000):

    [A] спроба 1 впала з 40001 (serialization failure), повтор через 69 мс
    Фінальний баланс: 102000 (очікували 102000)

Усі три демо перевірені повторно вже після ДЗ №15 — з тим самим результатом, але тепер увесь трафік фізично йде через PgBouncer (`pool_mode = transaction`, 8 реальних з'єднань до Postgres замість одного на кожен виклик застосунку): 50/10/0/0 для race, 3/3/3/3 без дублів і пропусків для workers (368 мс паралельно проти 1200 мс послідовно), спіймана `40001` і коректний фінальний баланс 102000 для retry.

## Data layer ops: PgBouncer, backup і restore drill (ДЗ №15)

### PgBouncer перед Postgres

Клієнтські з'єднання (скільки одночасних запитів шле застосунок) і серверні з'єднання Postgres (реальні, дорогі, обмежені `max_connections`) — це різні речі. PgBouncer стоїть між ними і мультиплексує багато клієнтських з'єднань у невелику, стабільну кількість серверних. Конфіг — `pgbouncer/pgbouncer.ini` (монтується в контейнер як є, без генерації з env-змінних) і `pgbouncer/userlist.txt` (клієнтська автентифікація, `auth_type = scram-sha-256`, пароль збігається з паролем Postgres). Застосунок ходить у базу через `DB_HOST`/`DB_PORT=6432`, тобто через PgBouncer, а не напряму в Postgres (`5432`).

Режим пулінгу — `pool_mode = transaction`: клієнт отримує реальне серверне з'єднання лише на час однієї транзакції, одразу після `COMMIT`/`ROLLBACK` це з'єднання може дістатись іншому клієнту. Це дає максимальну економію з'єднань, але ламає щонайменше три речі, які працюють в `session`-режимі:

1. **Session-level стан** (`SET`, тимчасові таблиці, `LISTEN`/`NOTIFY`) не переживає межу транзакції — наступний запит клієнта може дістатись зовсім іншого фізичного з'єднання до Postgres, де цього стану ніколи не було.
2. **Advisory locks**, узяті в одній транзакції і потрібні в наступній, ламаються з тієї ж причини — лок фізично належить конкретному серверному з'єднанню, а не клієнту.
3. **Named prepared statements драйвера** прив'язані до конкретного серверного з'єднання; клієнт після транзакції може отримати інше — звідси `max_prepared_statements` у конфізі PgBouncer як запобіжник.

`checkout()`, `demo:race`, `demo:workers` і `demo:retry` (ДЗ №14) із цим сумісні "з коробки": кожен з них — це рівно одна транзакція на виклик, без стану, що мав би пережити межу `COMMIT`, тому вони пройшли через PgBouncer без жодних змін у коді (див. цифри в розділі вище).

Перевірка вручну:

    docker compose up -d --wait
    docker compose exec -e PGPASSWORD="$(cat secrets/db_password)" postgres psql -h pgbouncer -p 6432 -U marketplace -d marketplace -c "SELECT 1"
    docker compose exec -e PGPASSWORD="$(cat secrets/db_password)" postgres psql -h pgbouncer -p 6432 -U marketplace -d pgbouncer -c "SHOW POOLS"

### Backup

`scripts/backup.sh` знімає `pg_dump -Fc` тим самим шляхом, яким ходить застосунок — через PgBouncer, `DATABASE_URL` з обгортки `with-secrets.sh`. Дамп кладеться в `backups/` (поза git, є в `.gitignore`) з датою в імені файлу, і одразу перевіряється через `pg_restore --list`, що архів валідний.

    bash scripts/with-secrets.sh dev bash scripts/backup.sh

Розклад — `backup.cron`, нічний бекап. Раз на добу означає чесний RPO "до 24 годин" — див. `RESTORE-DRILL.md`.

### Restore drill

`scripts/restore-drill.sh` бере останній дамп, піднімає повністю чистий, щойно створений контейнер Postgres (без жодного спільного стану з живою базою), відновлює туди дамп і звіряє контрольну суму ключової таблиці (`count(*) || sum(...)`) до і після. Друкує `MATCH` і виходить з кодом 0, якщо дані співпали; інакше — ненульовий код. Контейнер видаляється сам, незалежно від результату.

    bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh

Результати реального прогону (дата, розмір дампу, виміряний RTO, чесний RPO) — `RESTORE-DRILL.md`.

## Тестування: integration, E2E (ДЗ №16)

Два незалежні шари тестів, кожен зі своєю моделлю ізоляції:

    npm run test:integration   # репозиторії проти реального Postgres у testcontainer
    npm run test:e2e           # повний Nest-застосунок (supertest) проти testcontainer

Обидва проєкти описані в `jest.config.js` (multi-project конфіг), кожен піднімає власний одноразовий контейнер `postgres:16-alpine` і прожене на ньому реальні міграції — жодних моків БД, тестується справжній SQL і справжня схема.

### Чому TRUNCATE, а не ROLLBACK, для ізоляції між тестами

Для очищення стану між тестами в межах одного testcontainer розглядались два варіанти: відкочувати транзакцію після кожного тесту (`ROLLBACK`) або зачищати таблиці командою `TRUNCATE ... RESTART IDENTITY CASCADE`. Обрано другий варіант. `ROLLBACK`-підхід вимагає, щоб і сам тест, і увесь код, який він викликає, працювали через один і той самий `QueryRunner` з відкритою транзакцією — а в наших даних чотири пов'язані таблиці (`users → orders → order_items → products`) і сервіси, що самі відкривають власні транзакції (`manager.transaction(...)` в `OrdersService`), тому "протягнути" один спільний `QueryRunner` через усі шари виявляється громіздкіше, ніж просто зачистити таблиці між тестами. `TRUNCATE ... RESTART IDENTITY CASCADE` виконується один раз між тестами, скидає авто-інкременти (щоб id в очікуваннях тестів були передбачуваними) і коректно каскадно чистить залежні таблиці за FK.

### Чому @nestjs/* закріплені на 11.x, а не 12.x

NestJS 12 публікується як чистий ESM-пакет (`"type": "module"` у package.json кожного з `@nestjs/*` пакетів) — це свідоме архітектурне рішення команди Nest, а не помилка складання. Jest 30 має нативну підтримку `require(esm)` для Node.js 24.9+, але на практиці для графа залежностей `@nestjs/testing` → `@nestjs/common` цей fallback у зв'язці Jest 30.5.2 + Node 24.20 не спрацював (файл коректно резолвиться і навіть проганяється через кастомний трансформер, але Jest все одно відмовляється виконати його як CommonJS). Офіційний migration-guide Nest прямо допускає залишитися на CommonJS-версії без втрати функціональності ("your CommonJS project stays a CommonJS project"), тому для сумісності з Jest (вимога завдання) увесь стек `@nestjs/*` закріплено на останній CommonJS-версії (11.2.6 для common/core/platform-express/testing, 11.4.7 для swagger, 11.0.3 для typeorm, 4.0.4 для config — цей пакет синхронізував нумерацію версій з ядром саме на релізі 12.x). На "бойовий" код застосунку (декоратори, DI, TypeORM-інтеграцію) це ніяк не впливає — API між 11.x і 12.x у цій частині ідентичне.

### E2E без підміни провайдерів

`test/e2e/testkit/bootstrap-app.ts` піднімає справжній `AppModule` через `Test.createTestingModule({ imports: [AppModule] }).compile()` — без жодних `overrideProvider`. "Ін'єкція" testcontainer-бази відбувається не через DI, а через змінну середовища `DATABASE_URL`, яку `src/database/pg-connection-options.ts` розпізнає з вищим пріоритетом за `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_NAME` + файл-пароль — той самий механізм, яким у проді користується `DATABASE_URL` для `scripts/backup.sh` (ДЗ №15). Завдяки цьому e2e-тести і продакшн-застосунок збирають з'єднання до бази однаковим кодом.

## Contract-тестування: Pact, Pact Broker, can-i-deploy (ДЗ №16, п.4-6)

### CI

Той самий gate автоматизований у `.github/workflows/ci.yml`: джоба `test` (type-check, integration, e2e) → джоба `contract` (публікація контракту, верифікація провайдера з `publishVerificationResult: true`, тегування версії провайдера як `prod`, `can-i-deploy`). Якщо `can-i-deploy` поверне не `true` — джоба падає, і мердж/деплой блокується.

Для кроків, які піднімають повний Nest-застосунок (E2E-тести, верифікація провайдера), потрібні значення `DB_HOST`/`DB_USER`/`DB_NAME` — вони проходять первинну валідацію конфігурації ще до старту testcontainer-а з реальною базою (яка вже після старту підміняє ці значення на справжні). Локально їх дає файл `.env`; у CI — заглушки прямо в `ci.yml`, оскільки на цьому етапі важливий лише факт наявності рядка, а не його вміст.

### Consumer-контракт і верифікація провайдера

Consumer-тест (`test/contract/products.consumer.spec.ts`) описує очікування уявного фронтенду (`MarketplaceWebClient`) від ендпойнта `GET /products/:id` і генерує файл контракту `pacts/MarketplaceWebClient-MarketplaceApi.json`:

    npm run test:contract

Provider verification (`test/contract/verify-provider.ts`) піднімає справжній застосунок (той самий testcontainers-стенд, що і в E2E), сідить у БД товар через `stateHandlers`, і ганяє реальні HTTP-запити проти нього, звіряючи відповідь із контрактом:

    npm run verify:provider

Без `PACT_BROKER_URL` в env скрипт верифікує проти локального файлу `pacts/*.json`. З виставленим `PACT_BROKER_URL` — тягне контракт із брокера і публікує результат верифікації назад.

### OpenAPI-специфікація

`openapi.yaml` в корені репозиторію генерується зі спільної Swagger-конфігурації (`src/swagger-config.ts`), яка також використовується в `src/main.ts`:

    npm run generate:openapi

Після ДЗ №24 застосунок не стартує без ключів, тому скрипт іде через `bash scripts/with-secrets.sh dev …` (потрібні `npm run build` і запущений `redis-queue` з `docker compose up -d --wait`). У специфікації з’явилися `POST /auth/login|refresh|logout` та схема безпеки `bearer`.

Шлях і форма відповіді в consumer-інтеракції відповідають ендпойнту `/products/{productId}` з цієї специфікації.

### Pact Broker локально

У `docker-compose.yml` є два додаткові сервіси: `pact-broker-db` (окрема Postgres-база тільки для брокера, щоб не чіпати схему застосунку) і `pact-broker` (офіційний образ `pactfoundation/pact-broker`, порт `9292`). Підняти:

    docker compose up -d --wait

Брокер буде доступний на `http://127.0.0.1:9292`.

### Секрети

`PACT_BROKER_URL` за замовчуванням вказує на локальний `http://127.0.0.1:9292` — це не секрет, тому його можна відкрито тримати в конфігурації. `PACT_BROKER_TOKEN` потрібен лише якщо брокер вимагає авторизацію (наприклад, хмарний PactFlow); код читає його виключно з `process.env.PACT_BROKER_TOKEN` і ніколи не хардкодить. Локально токен (якщо потрібен) приїжджає через ту саму обгортку, що й інші секрети з ДЗ №11/13:

    bash scripts/with-secrets.sh dev npm run verify:provider

У CI — через `secrets.PACT_BROKER_TOKEN` в GitHub Actions.

### Демонстрація can-i-deploy gate

Послідовність команд:

    docker compose up -d --wait
    curl -i -X PUT -H "Content-Type: application/json" --data-binary "@pacts/MarketplaceWebClient-MarketplaceApi.json" "http://127.0.0.1:9292/pacts/provider/MarketplaceApi/consumer/MarketplaceWebClient/version/0.1.0"
    curl -s "http://127.0.0.1:9292/can-i-deploy?pacticipant=MarketplaceWebClient&version=0.1.0&to=prod"
    PACT_BROKER_URL=http://127.0.0.1:9292 PACT_PROVIDER_VERSION=0.1.0 npm run verify:provider
    curl -i -X PUT -H "Content-Type: application/json" "http://127.0.0.1:9292/pacticipants/MarketplaceApi/versions/0.1.0/tags/prod"
    curl -s "http://127.0.0.1:9292/can-i-deploy?pacticipant=MarketplaceWebClient&version=0.1.0&to=prod"

**До верифікації і тегування провайдера** (контракт опубліковано, але ще нема ні підтвердженої відповідності, ні версії провайдера з тегом `prod`):

    {
      "summary": {
        "deployable": null,
        "reason": "There is no verified pact between version 0.1.0 of MarketplaceWebClient and the latest version of MarketplaceApi with tag prod (no such version exists)",
        "success": 0,
        "failed": 0,
        "unknown": 1
      }
    }

**Після верифікації провайдера і тегування його версії `0.1.0` як `prod`:**

    {
      "summary": {
        "deployable": true,
        "reason": "All required verification results are published and successful",
        "success": 1,
        "failed": 0,
        "unknown": 0
      }
    }

Різниця між цими двома відповідями і є сенсом gate'а: брокер каже "не знаю", доки нема опублікованого успішного результату верифікації для тієї версії провайдера, яка позначена як production, і каже "можна" тільки після цього.

## Grading

Грейдер (і будь-хто на свіжому клоні без доступу до сховища секретів) виконує рівно ці команди з кореня репозиторію:

    cp secrets/db_password.example secrets/db_password
    cp secrets/rabbitmq_password.example secrets/rabbitmq_password
    export DB_HOST=127.0.0.1
    export DB_PORT=6432
    export DB_USER=marketplace
    export DB_PASSWORD=VgiPEzaFq/5KKivNpzGqUnko2bXMpiT2
    export DB_NAME=marketplace
    export RABBITMQ_PASSWORD=n4mPz9VuTxQaRy7bGhDsLk2E
    export RABBITMQ_URL=amqp://marketplace:n4mPz9VuTxQaRy7bGhDsLk2E@127.0.0.1:5672
    export BROKER_URL=amqp://marketplace:n4mPz9VuTxQaRy7bGhDsLk2E@127.0.0.1:5672
    export REDIS_URL=redis://127.0.0.1:6390
    export REDIS_QUEUE_URL=redis://127.0.0.1:6380
    export SKIP_VAULT=1    # у грейдера немає доступу до сховища
    eval "$(node -e '
    const { generateKeyPairSync, randomBytes } = require("node:crypto");
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const b64 = (pem) => Buffer.from(pem).toString("base64");
    console.log("export JWT_KID=grader-oneoff");
    console.log("export JWT_PRIVATE_KEY=" + b64(privateKey));
    console.log("export JWT_PUBLIC_KEY=" + b64(publicKey));
    console.log("export REFRESH_TOKEN_PEPPER=" + randomBytes(32).toString("base64url"));
    ')"
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

    npm run demo:race
    npm run demo:workers
    npm run demo:retry

    npm run demo:publish
    npm run demo:dlq
    npm run demo:duplicate

    npm run demo:outbox
    npm run demo:crash-write
    npm run demo:crash-relay

    npm run demo:cache
    npm run demo:session
    npm run demo:ratelimit
    npm run demo:queue

    npm run demo:auth
    npm run demo:reuse
    npm run demo:rbac

    psql -h 127.0.0.1 -p 6432 -U marketplace -d marketplace -c "SELECT 1"
    psql -h 127.0.0.1 -p 6432 -U marketplace -d pgbouncer -c "SHOW POOLS"

    export DATABASE_URL=postgres://marketplace:VgiPEzaFq%2F5KKivNpzGqUnko2bXMpiT2@127.0.0.1:6432/marketplace
    bash scripts/with-secrets.sh dev bash scripts/backup.sh
    bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh

    docker compose exec -T rabbitmq rabbitmq-diagnostics -q check_running

`DB_PASSWORD=VgiPEzaFq/5KKivNpzGqUnko2bXMpiT2` — те саме dev-значення, що лежить у `secrets/db_password.example`, `pgbouncer/userlist.txt` і завжди використовується для локальної розробки; воно навмисно не є секретом (домовленість з ДЗ №11). У `DATABASE_URL` той самий пароль йде вже URL-кодованим (`%2F` замість `/`) — інакше `/` в паролі зламав би розбір рядка підключення. Крок `cp secrets/db_password.example secrets/db_password` обов'язковий: без нього Docker при спробі змонтувати неіснуючий секрет-файл створить на його місці порожню директорію замість файлу, і Postgres впаде з помилкою "superuser password is not specified" (перевірено на реальному чистому клоні).

**RabbitMQ (ДЗ №19).** Брокер піднімається тією самою командою `docker compose up -d --wait`: `--wait` чекає healthcheck `rabbitmq-diagnostics -q check_running`, тож після повернення команди брокер уже готовий приймати з'єднання. Клієнти ходять по **AMQP на порту 5672** (`amqp://marketplace:<пароль>@127.0.0.1:5672`), а не на 15672: це HTTP-панель управління, AMQP-клієнт там отримає помилку протоколу. Оскільки з `SKIP_VAULT=1` обгортка `with-secrets.sh` не виконується, `RABBITMQ_URL` грейдер експортує сам (див. команди вище). `RABBITMQ_PASSWORD` — те саме dev-значення, що лежить у `secrets/rabbitmq_password.example` і є дефолтом у `docker-compose.yml`; воно навмисно не є секретом (як і пароль БД). Крок `cp secrets/rabbitmq_password.example secrets/rabbitmq_password` потрібен для запуску без `SKIP_VAULT`. Три демо (`demo:publish`, `demo:dlq`, `demo:duplicate`) самі скидають свій стан, друкують `key=value`, самі перевіряють інваріанти й завершуються ненульовим кодом при порушенні; перед ними не має працювати `npm run consumer` (чужий споживач на тій самій черзі забрав би частину повідомлень, і демо чесно впаде).

**Outbox (ДЗ №22).** Брокерна змінна читається так: `RABBITMQ_URL`, а якщо її нема — `BROKER_URL` (`src/messaging/rabbitmq.config.ts`); URL має вигляд `amqp://marketplace:<пароль>@127.0.0.1:5672` (AMQP-порт **5672**, не 15672). Три нові демо (`demo:outbox`, `demo:crash-write`, `demo:crash-relay`) запускаються через `bash scripts/with-secrets.sh dev …`, а з `SKIP_VAULT=1` обгортка просто виконує команду, тож `DB_*` і `RABBITMQ_URL`/`BROKER_URL` мають бути експортовані (як вище). Нових env-файлів нема, у git немає жодного файлу з живим рядком підключення. Команда `npm run migrate` створює таблиці `outbox`, `processed_messages` і `idempotency_keys`. Демо самоочисні, мають повторюватися з тими самими числами, і перед ними не мають працювати `npm run relay` і `npm run consumer`. Деталі, власні числа та обґрунтування — розділ «Outbox та ідемпотентність (ДЗ №22)».

**Redis (ДЗ №23).** Обидва Redis піднімає та сама `docker compose up -d --wait` (healthcheck `redis-cli ping`, тож після повернення команди вони готові). Порти: **6390** (кеш, `allkeys-lru`) і **6380** (черга й сесії, `noeviction` + AOF), обидва на `127.0.0.1` і поза діапазоном 22300–22399. Порт 6379 свідомо не зайнято: на машині розробника його часто тримає чужий Redis, і застосунок тихо працював би з ним. З `SKIP_VAULT=1` обгортка `with-secrets.sh` не виконується, тому `REDIS_URL` і `REDIS_QUEUE_URL` грейдер експортує сам (див. команди вище). Чотири нові демо (`demo:cache`, `demo:session`, `demo:ratelimit`, `demo:queue`) запускаються через `bash scripts/with-secrets.sh dev …`, друкують `key=number`, самі перевіряють інваріанти, завершуються кодом 0 і прибирають за собою свої ключі (BullMQ-демо працює у власному префіксі `bull-demo`). `demo:cache` і `demo:queue` читають `CONFIG GET maxmemory-policy` з живого з'єднання, тому підключення до не того інстансу (наприклад, обидва URL на кеш) дає `FAIL`, а не фальшиву «зелень». Нових env-файлів немає, у dev-Redis немає пароля, у git немає жодного рядка підключення з обліковими даними. Деталі та власні числа: розділ «Redis: кеш, сесії, ліміти, черга».

**Auth (ДЗ №24).** Ключів і pepper у git немає (`secrets/jwt/` у `.gitignore`, у `.env.example` змінні порожні). Грейдер без сховища генерує одноразову пару ES256 (`generateKeyPairSync('ec', { namedCurve: 'P-256', … })`, PEM у base64) і експортує `JWT_KID`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `REFRESH_TOKEN_PEPPER` командою з блоку вище; разом із `SKIP_VAULT=1` обгортка `with-secrets.sh` просто виконує команду, не чіпаючи оточення. `DATABASE_URL` експортується так само, як і раніше. Таблиця `refresh_tokens` створюється `npm run migrate`, тож перед демо потрібні `npm run build` і `npm run migrate` (вони є вище). Голий `npm run start` без цих змінних завершується з ненульовим кодом і називає відсутню змінну. Три демо (`demo:auth`, `demo:reuse`, `demo:rbac`) самі стартують застосунок у процесі, самі прибирають за собою, друкують `key=number` і завершуються ненульовим кодом при порушенні інваріанта; їм потрібні Postgres і `redis-queue` (`REDIS_QUEUE_URL`) з `docker compose up -d --wait`. Деталі: розділ «Auth».

Якщо `psql` немає на машині грейдера локально — той самий `SELECT 1`/`SHOW POOLS` перевіряється зсередини вже запущеного контейнера `postgres`, який має власний psql-клієнт:

    docker compose exec -e PGPASSWORD="$DB_PASSWORD" postgres psql -h pgbouncer -p 6432 -U marketplace -d marketplace -c "SELECT 1"

Перевірка ідемпотентності сіда (кількість рядків не змінюється після повторного запуску):

    docker compose exec -T postgres psql -U marketplace -d marketplace -Atc \
      "SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM products) AS products, (SELECT count(*) FROM orders) AS orders, (SELECT count(*) FROM order_items) AS order_items;"

## Realtime: WebSocket + SSE (ДЗ №18)

Покупець дізнається про зміну статусу свого замовлення миттєво, без перезавантаження сторінки — двома транспортами: WebSocket-кімнати (`socket.io`) та SSE-потік з підтримкою `Last-Event-ID`. Обидва транспорти живляться з однієї спільної шини подій (`OrderEventsService`), а не з двох незалежних джерел.

### Запуск

    npm run build
    npm run start          # застосунок на http://localhost:3000

Далі, в окремому терміналі — сидовані дані обов'язкові, бо демо і curl-перевірки нижче спираються на конкретних власників конкретних замовлень:

    npm run migrate
    npm run seed

### Перевірка SSE вручну

    curl -sN --max-time 5 http://localhost:3000/orders/1/events

В іншому терміналі змінити статус — подія прилетить у перший термінал:

    curl -X PATCH http://localhost:3000/orders/1/status -H "content-type: application/json" -d "{\"status\":\"packed\"}"

Перевірка `Last-Event-ID` (після щонайменше 4 змін статусу замовлення 1):

    curl -sN --max-time 2 -H "Last-Event-ID: 3" http://localhost:3000/orders/1/events

### Headless-демо ізоляції кімнат

    node scripts/realtime-demo.mjs               # основний: різні кімнати, B не чує
    node scripts/realtime-demo.mjs --same-room    # контрольний: спільна кімната, B чує

### Trade-offs: WebSocket vs SSE

| Критерій | WebSocket | SSE |
|---|---|---|
| Напрям каналу | двосторонній (full-duplex): клієнт і сервер шлють дані в обидва боки по одному з'єднанню | лише сервер → клієнт; відповідь клієнта (якщо потрібна) йде окремим звичайним HTTP-запитом |
| Реконект і відновлення | не з коробки: сирий `ws` вимагає ручної логіки; `socket.io`, який ми використали, додає реконект і `ack` сам | вбудовано в браузерний `EventSource`; `Last-Event-ID` дозволяє догнати саме пропущені події з буфера, без дублів |
| Вимоги до інфраструктури | `Upgrade`-рукостискання (HTTP 101), не всі проксі/баланс. однаково дружні до цього; на 2+ інстансах потрібні sticky sessions | звичайний довгий HTTP-запит (`text/event-stream`), працює через будь-який HTTP-проксі без особливих налаштувань |
| Ціна на подію | мінімальна після рукостискання — бінарний фрейм від 2 байтів заголовка | текстовий формат (`id:`/`event:`/`data:`) важчий за WS-фрейм, але значно дешевший за окремий HTTP-запит при поллінгу |

Для нотифікацій про статус замовлення в проді я лишив би SSE: канал і так односторонній (клієнту не потрібно щось відповідати серверу по тому самому каналу), а SSE дає реконект і відновлення пропущеного через `Last-Event-ID` безкоштовно, без окремої бібліотеки. WebSocket виправданий там, де дійсно потрібен двосторонній канал в реальному часі — чат, спільні курсори, гра; тут це була б зайва складність заради можливості, якою ніхто не скористається.

При 2+ інстансах застосунку за балансувальником кімнати `socket.io` живуть окремо в пам'яті кожного інстансу — клієнт, що зайшов у кімнату `orders:1` на інстансі A, не отримає подію, якщо `emit` стався на інстансі B; лікується підключенням `@socket.io/redis-adapter`, який пересилає події між інстансами через Redis Pub/Sub.


## Async-події через RabbitMQ

ДЗ №19. Коли `POST /orders` зберіг замовлення в Postgres, API публікує подію `order.placed` у RabbitMQ, а окремий процес-споживач (`npm run consumer`) обробляє її асинхронно. Брокер тут — склад між двома процесами: він **зберігає** повідомлення, доки споживач не підтвердить обробку, а не "доставляє" їх сам. Черга — це робота, яку треба виконати (розібрали — зникла), а не журнал фактів.

### Запуск

    cp secrets/rabbitmq_password.example secrets/rabbitmq_password
    docker compose up -d --wait    # postgres + pgbouncer + rabbitmq
    npm run build
    npm run migrate                # processed_order_events, outbox, processed_messages, idempotency_keys
    npm run rabbit:setup           # оголошує топологію (ідемпотентно)
    npm run start                  # API: пише замовлення й подію в outbox однією транзакцією
    npm run relay                  # relay: переносить події з outbox у брокер (без нього консюмеру нічого не прийде)
    npm run consumer               # споживач: обробляє події

AMQP-порт — **5672** (`amqp://marketplace:<пароль>@localhost:5672`). `15672` — це HTTP-панель управління (`http://localhost:15672`), AMQP-клієнт туди не підключається. `RABBITMQ_URL` збирає наявна обгортка `scripts/with-secrets.sh` з `secrets/rabbitmq_password`, окремих env-файлів не додано. Healthcheck сервісу — `rabbitmq-diagnostics -q check_running`, тому `docker compose up -d --wait` повертається, коли брокер уже готовий. У CI брокера немає: e2e-тести вимикають його змінною `RABBITMQ_DISABLED=1`, а API без брокера стартує й працює як раніше.

### Топологія

| Сутність | Тип і аргументи | Роль |
|---|---|---|
| `shop.events` | exchange, `topic`, durable, `alternate-exchange = shop.events.unrouted` | точка входу подій; routing key — ярлик на конверті, його ставить продюсер |
| `orders.order-placed` | quorum-черга, `x-delivery-limit = 3`, `x-dead-letter-exchange = shop.events.dlx`, `x-dead-letter-routing-key = order.placed.dead`, `x-dead-letter-strategy = at-least-once`, `x-overflow = reject-publish` | робоча черга |
| binding `shop.events` → `orders.order-placed` | ключ `order.placed` | рядок таблиці сортування: інфраструктура, а не код продюсера |
| `shop.events.dlx` | exchange, `direct` | вхід у DLQ-контур |
| `orders.order-placed.dlq` | quorum-черга, binding до `shop.events.dlx` з ключем `order.placed.dead` | окремий контур для "мертвих" повідомлень |
| `shop.events.unrouted` + `shop.unrouted` | `fanout` + quorum-черга | alternate exchange: сюди потрапляє те, для чого не знайшлось жодної черги |

Топологію оголошує **споживач/bootstrap**, а не продюсер: `TopologyBootstrap` при старті API, `npm run rabbit:setup` і `npm run consumer` викликають одну й ту саму `assertTopology` (`src/messaging/topology.ts`; оголошення ідемпотентне). Продюсер лише пасивно перевіряє, що обмінник існує, і інакше підказує запустити `npm run rabbit:setup`. Аргументи черги незмінні: інші значення для вже існуючої черги дають `406 PRECONDITION_FAILED`, змінювати їх треба політиками або перестворенням черги.

Чому quorum: класичне дзеркалювання черг (`ha-mode`) прибране в RabbitMQ 4.0, а `x-delivery-limit` і надійний DLX працюють саме на quorum-чергах. Стратегія `x-dead-letter-strategy: at-least-once` вимагає `x-overflow: reject-publish`.

### Контракт події

Подія — це **не ORM-сутність**: поля обрані свідомо (`src/messaging/events.ts`), тож зміна схеми БД не ламає підписників.

    {
      "eventId": "order-placed:35",
      "type": "order.placed",
      "occurredAt": "2026-10-06T21:02:46.900Z",
      "data": {
        "orderId": 35,
        "customerEmail": "a@b.com",
        "totalCents": 249900,
        "currency": "UAH",
        "items": [{ "productId": 1, "quantity": 1 }]
      }
    }

`eventId` детермінований від `orderId` (`order-placed:<orderId>`), а не випадковий: повторна публікація тієї самої події має той самий id, і саме за ним споживач відсіює дублі. Він же йде в AMQP `messageId`.

### Публікація: confirm + mandatory

`EventPublisher.publish` працює через **confirm-канал** (`createConfirmChannel` + `waitForConfirms`): позитивне підтвердження означає "брокер узяв відповідальність" (повідомлення збережено), а не "споживач отримав". Повідомлення `persistent` і з `mandatory: true`: якщо жодна черга не підійшла, брокер повертає його через `basic.return` (воно приходить **до** `basic.ack`), і `publish` кидає `UnroutableMessageError`. Без `mandatory` брокер при невдалій маршрутизації теж шле позитивний ack, і подія мовчки зникла б; а `alternate-exchange` на `shop.events` додатково кладе таке повідомлення в `shop.unrouted`.

З ДЗ №22 API **сам нічого не публікує**: подія пишеться в таблицю `outbox` тією ж транзакцією, що й замовлення, а в брокер її переносить окремий процес `relay` (`src/outbox/relay.ts`), який викликає саме `EventPublisher.publish` з цього розділу: confirm, `mandatory`, таймаут 5 с. Раніше (ДЗ №19) публікація йшла з API після коміту, і збій брокера губив подію. Ця вада розібрана в розділі «Outbox та ідемпотентність (ДЗ №22)» нижче.

### Два шляхи створення замовлення

Замовлення в системі народжується двома шляхами, і подія `order.placed` має йти з **обох**: інакше підписники бачать лише частину замовлень. З ДЗ №22 обидва шляхи пишуть подію в outbox тією ж транзакцією, що й замовлення:

| Шлях | Хто викликає | Статус замовлення | Подія `order.placed` |
|---|---|---|---|
| `OrdersService.create` / `createIdempotent` | `POST /orders` | `created` | так: `enqueueOrderPlaced` у транзакції замовлення |
| `checkout()` (`src/checkout.ts`) | оплата: stock і баланс списуються однією транзакцією | `paid` | так: той самий `enqueueOrderPlaced` у транзакції checkout |

Подію збирає **один** `buildOrderPlacedEvent` (`src/messaging/events.ts`), а в outbox її кладе **одна** функція `enqueueOrderPlaced` (`src/outbox/outbox.ts`): контракт події не розходиться між шляхами, а третій шлях має піти туди ж. Продюсера в бізнес-коді більше немає: `checkout(userId, productId, quantity, deps)` приймає лише необов'язковий `deps.dataSource` для тестів. `demo:race` викликає `checkout` без жодних додаткових параметрів: події цих замовлень лягають в outbox і лишаються там, доки не запрацює relay.

Це перевіряє `test/integration/checkout.outbox.spec.ts` (Postgres у testcontainers): `checkout()` пише замовлення й рядок outbox разом, `published_at` порожній; відмова `checkout` (мало товару) не лишає ні замовлення, ні події; збій запису в outbox відкочує **все** (замовлення, склад і баланс); `POST /orders` кладе в outbox подію того самого контракту.

### Споживач: ack після ефекту

Споживач (`src/messaging/consumer.ts`) бере повідомлення з `noAck: false` і підтверджує його **після** ефекту. Порядок "ефект, потім ack" дає at-least-once; порядок "ack, потім ефект" (і `autoAck`) дав би at-most-once, тобто втрату роботи при аварії.

| Ситуація | Дія споживача | Що буде далі |
|---|---|---|
| ефект застосовано вперше | `ack` | повідомлення зникає з черги |
| дубль (`eventId` уже є в журналі) | ефект пропущено, `ack` | повтор безпечний |
| "отруйне" повідомлення (не JSON, немає `eventId`) | `reject(requeue=false)` | DLX, потім DLQ з причиною `rejected` |
| тимчасова помилка (наприклад, БД недоступна) | `reject(requeue=true)` | повторна доставка; після `x-delivery-limit` (3) повідомлення йде в DLQ з причиною `delivery_limit` |

Для повернення використовується `reject(requeue=true)`: він завжди рахується в `x-delivery-count`, тож "отруйне" повідомлення впирається в `x-delivery-limit` і йде в DLQ. З `nack(requeue=true)` важлива версія брокера: до RabbitMQ 4.3 кожне повернення збільшувало лічильник, а починаючи з 4.3 `basic.nack` збільшує лише `acquired-count` і не наближає повідомлення до ліміту (повернень стає "необмежено"), тож без власного ліміту спроб таке повідомлення могло б крутитися по колу вічно. Поведінка `reject` від версії не залежить.

### prefetch: обґрунтування

`prefetch` задається явно (`PREFETCH = 20` у `src/messaging/rabbitmq.config.ts`, `basic.qos` перед `consume`, на кожного споживача). Дефолт RabbitMQ — 0, тобто **без ліміту**: один жадібний споживач забрав би все, інші б простоювали.

**Що обмежує prefetch: `consumer_timeout`, а не мережа.** Усе вікно prefetch споживач тримає непідтвердженим. Якщо повідомлення лишається непідтвердженим довше за `consumer_timeout` (дефолт 30 хв), брокер закриває канал з `PRECONDITION_FAILED` і повертає непідтверджені повідомлення в чергу, тож робота починається заново. Тому умова безпеки в найгіршому випадку (повідомлення вікна обробляються по черзі, і останнє чекає на `ack` усе вікно): `prefetch × найгірший час обробки < consumer_timeout`, тобто стеля `prefetch ≤ consumer_timeout / найгірший час обробки`. Окрема стеля від самого брокера: quorum-черги обрізають prefetch до 2000, щоб не розпухав Raft-лог.

Виміряно `npm run demo:publish` (локальний Docker, 5 повідомлень на прогін, 5 прогонів): час обробки одного повідомлення в середньому 10–16 мс, максимум 13–27 мс. Стеля за `consumer_timeout`: 1 800 000 мс / 27 мс ≈ 66 000, тож діє межа quorum-черги 2000. Наші 20 далеко під стелею: у найгіршому випадку все вікно розбирається за 20 × 27 мс = 540 мс, це 0.03% від `consumer_timeout`. Демо друкує цю стелю й завершується з кодом 1, якщо `prefetch` її перевищує.

**Чому не "час обробки / RTT".** Така формула була в попередній версії, і вона не відтворюється між машинами: у мене RTT до брокера 0.57–0.74 мс (оцінка 14–25), а при перевірці на іншій машині RTT вийшов 0.05 мс, і та сама формула дала 150. RTT відрізняється в рази між середовищами, тож і оцінка гуляє в рази, а `consumer_timeout` — фіксований параметр брокера, який від мережі не залежить. Тому prefetch прив'язано до нього, а замір RTT (`measureRttMs`) із демо прибрано.

**Чому саме 20.** Стеля задає лише безпечний коридор 1..2000, а не конкретне число, тож 20 обрано консервативно, а не виведено формулою. Менше вікно означає менше повідомлень, які повернуться в чергу й будуть оброблені повторно, якщо споживач помре (ефект ідемпотентний, але дубль усе одно коштує роботи), і рівномірніший розподіл між кількома споживачами. Документація RabbitMQ називає 100–300 типовим діапазоном для найкращої пропускної здатності, а 1 найконсервативнішим, і зазначає, що quorum-черги виграють від вищого prefetch, щоб споживачі не голодували. Тож 20 це обережний старт: якщо споживач стане вузьким місцем, піднімати можна без ризику для `consumer_timeout`, але вирішувати це треба заміром пропускної здатності при кількох значеннях, а не оцінкою.

### DLQ як окремий контур

Основна черга знає про брак лише одне: "відправляти в `shop.events.dlx`" (аргументи `x-dead-letter-exchange` і `x-dead-letter-routing-key`). Далі працює окремий контур: свій exchange, своя черга, своя прив'язка. Якщо основний конвеєр забитий чи зламаний, брак усе одно знайде місце, а розбирати його можна окремим процесом чи людиною.

Брокер ставить на мертве повідомлення "штампи" в заголовок `x-death` (черга, причина, лічильник, час) і дублює першу причину в `x-first-death-reason`. `readDeathInfo` (`src/messaging/dlq.ts`) читає саме їх. Можливі причини:

| Причина | Коли |
|---|---|
| `rejected` | споживач зробив `reject`/`nack` з `requeue=false` |
| `expired` | минув TTL повідомлення чи черги |
| `maxlen` | перевищено ліміт довжини черги |
| `delivery_limit` | перевищено `x-delivery-limit` |

DLQ — не смітник: поява в ній повідомлень має бути приводом для сповіщення, а після виправлення причини їх можна повернути в основну чергу.

### Ідемпотентний споживач

Ефект споживача — запис у таблицю `processed_order_events` (`"eventId"` — PRIMARY KEY, міграція `ProcessedOrderEvents`):

    INSERT INTO processed_order_events ("eventId", "orderId") VALUES ($1, $2)
    ON CONFLICT ("eventId") DO NOTHING
    RETURNING "eventId"

Один рядок у відповіді означає "застосовано вперше", нуль рядків — "дубль, пропускаємо". "Перевірити і записати" — одна атомарна операція, тож між перевіркою та записом ніхто не вклиниться. Журнал живе в Postgres, а не в `Set` у пам'яті, тому переживає перезапуск споживача (саме це й показує `demo:duplicate` з реальним `kill -9`).

### Demo-скрипти

Усі три працюють через `bash scripts/with-secrets.sh dev ...`, самі скидають свій стан (чистять чергу, DLQ і рядки журналу з `orderId >= 900000`), друкують протокол `key=value`, самі перевіряють інваріанти й завершуються ненульовим кодом при порушенні. Перед запуском **зупини** `npm run consumer`: чужий споживач на тій самій черзі забрав би частину повідомлень, і демо чесно впаде з поясненням.

| Команда | Що показує | Реальний вивід |
|---|---|---|
| `npm run demo:publish` | 5 подій через confirm-канал лягають у чергу, споживач з `prefetch` обробляє їх і підтверджує після ефекту | `published=5 delivered=5 effect=5 acked=5 dlq=0 prefetch=20` |
| `npm run demo:dlq` | "отруйне" повідомлення відхиляється без повернення і потрапляє в DLQ; причина читається з `x-death` | `rejected=1 work=0 dlq=1 dlq-reason=rejected effect=0` |
| `npm run demo:duplicate` | споживач у окремому процесі гине через `kill -9` між ефектом і `ack`; повідомлення приходить удруге, ефект пропускається | `deliveries=2 effect=1 skipped=1` |

У `demo:duplicate` аварія справжня (`process.kill(process.pid, 'SIGKILL')` усередині `crash-consumer.ts`), а не `channel.close()`: канал, який закрито штатно, лишає споживачу шанс "прибрати за собою", а `kill -9` — ні, і брокер дізнається про аварію лише з обриву з'єднання. `deliveries` береться з `x-delivery-count`, тобто це лічильник самого брокера. На Windows примусово завершений процес дає код виходу 1 без імені сигналу, на Linux і macOS буде `SIGKILL`.

### At-least-once, а не exactly-once

**RabbitMQ не дає exactly-once.** Він гарантує at-least-once доставку: якщо споживач помер між ефектом і `ack`, повідомлення прийде знову (це і показує `deliveries=2`). Результат, схожий на exactly-once, дає лише комбінація *at-least-once доставка + ідемпотентний ефект*: другу доставку споживач розпізнає за `eventId` й не повторює ефект (`effect=1`, `skipped=1`). Дві речі, які легко сплутати: **ідемпотентність** — це властивість операції (виконати двічі = виконати один раз), а **ключ ідемпотентності** — інструмент, яким цього досягають (тут `eventId` разом із PRIMARY KEY).

### Межі

Postgres і RabbitMQ не мають спільної транзакції (dual write): у варіанті ДЗ №19 замовлення могло зберегтися, а публікація події провалитися (брокер лежить, таймаут), і тоді подія губилася назавжди. **У ДЗ №22 це закрито** transactional outbox (див. наступний розділ). Лишається межа іншого роду: якщо ефект споживача зовнішній (лист, платіж), запис про обробку й сам ефект треба робити в одній транзакції або передавати ідемпотентний ключ далі.

### Версії

Образ `rabbitmq:4.2-management` (перевірено на 4.2.9, Erlang 27.3.4.18). 4.2.x — LTS-гілка (підтримка до 2030-06-30), 4.3.x — поточна (до 2028-04-30).

## Outbox та ідемпотентність (ДЗ №22)

### Проблема: подвійний запис

Створення замовлення потребує двох дій: записати рядок у Postgres і повідомити брокера (RabbitMQ). Спільної транзакції в них немає. Якщо зберегти замовлення, а процес помре до publish, подію втрачено назавжди. Якщо спершу publish, а потім упаде COMMIT, брокер розсилає подію про замовлення, якого не існує.

### Рішення: transactional outbox

Бізнес-запис і запис про подію йдуть в **одній транзакції** (один COMMIT): `orders` + `order_items` + рядок у `outbox` (`src/checkout.ts`, `src/orders/orders.service.ts`, обидва через `enqueueOrderPlaced` з `src/outbox/outbox.ts`). У `outbox.payload` лежить явний контракт `OrderPlacedEvent` (`src/messaging/events.ts`), а не ORM-сутність; `eventId` детермінований: `order-placed:<orderId>`.

Таблиця `outbox` (міграція `OutboxAndProcessedMessages`): `id`, `aggregate_type`, `aggregate_id`, `type`, `payload jsonb`, `created_at`, `published_at` (NULL = ще не відправлено), `attempts`. Частковий індекс `outbox_unpublished_idx ON outbox(created_at) WHERE published_at IS NULL` тримає вибірку швидкою, хоч би скільки вже відправлених рядків лежало в таблиці.

**Relay** (`src/outbox/relay.ts`, запуск `npm run relay`) раз на 500 мс відкриває одну транзакцію на одному з'єднанні й робить:

    SELECT id, type, payload FROM outbox
     WHERE published_at IS NULL
     ORDER BY created_at, id
     FOR UPDATE SKIP LOCKED
     LIMIT 100

Далі публікує кожну подію брокеру (confirm + mandatory, таймаут 5 с), одним `UPDATE outbox SET published_at = now(), attempts = attempts + 1 WHERE id = ANY(...)` позначає відправлені й робить COMMIT. `FOR UPDATE SKIP LOCKED` дозволяє запустити кілька relay паралельно: кожен бере лише рядки, які не заблокував інший. Без блокування два relay взяли б ті самі рядки й відправили їх двічі; з голим `FOR UPDATE` дублів нема, але другий relay просто стоїть і чекає першого, тож паралелізму теж нема.

### Гарантії доставки: at-least-once + ідемпотентний споживач

Порядок «publish, потім UPDATE і COMMIT» дає **at-least-once**: подія дійде щонайменше раз, але може дійти двічі (relay помер після publish, до COMMIT). Результат exactly-once дає лише ідемпотентний споживач. Захист має два рівні в **одній транзакції** з ефектом (`applyOrderPlacedEffect` у `src/messaging/consumer.ts`):

1. **Inbox** `processed_messages (message_id, consumer)`, PRIMARY KEY на парі: `INSERT … ON CONFLICT (message_id, consumer) DO NOTHING RETURNING message_id`. Якщо рядок не вставився, повідомлення вже оброблене, і воно пропускається.
2. **Природний ключ** ефекту: `INSERT INTO processed_order_events ("eventId", "orderId") … ON CONFLICT ("eventId") DO NOTHING`. Друга лінія захисту на самому ефекті.

Обидва INSERT-и і є ефектом, тому або застосовано все, або нічого. Якщо два однакові повідомлення прийдуть одночасно, унікальний індекс змусить друге чекати завершення першої транзакції, а потім воно побачить конфлікт.

Дублі бувають двох видів: relay надіслав повторно (для брокера це **нове** повідомлення, `redelivered=false`) і брокер сам доставив повторно (`redelivered=true`). Тому дедуплікація йде за `eventId` з тіла події, а не за прапорцем брокера: прапорець ловить лише другий вид.

### Idempotency-Key на краї API

`POST /orders` вимагає заголовок `Idempotency-Key` (інакше `400`). Ключ — це **намір** клієнта («цей конкретний клік»), а не хеш тіла: два різні ключі з однаковим тілом дають два замовлення. Ключ записується в таблицю `idempotency_keys` (міграція `IdempotencyKeys`) тією ж транзакцією, що й замовлення та outbox:

- повтор з тим самим ключем і тим самим тілом повертає **те саме замовлення** (`Idempotency-Replay: true`), нових рядків у `orders` і `outbox` немає;
- той самий ключ з іншим тілом (порівнюється `request_hash`) дає `422`;
- два одночасні запити з одним ключем серіалізуються унікальним індексом: другий чекає першого й отримує повтор;
- якщо транзакція відкотилась, ключ теж звільняється, і клієнт може безпечно повторити запит.

Попередній варіант (інтерцептор з `Map` у пам'яті процесу) не працював для кількох інстансів API, мав гонку між перевіркою й записом і не був атомарним із замовленням. Його видалено.

### Запуск

    docker compose up -d --wait
    npm run build
    npm run migrate
    npm run rabbit:setup
    npm run start       # API
    npm run relay       # переносить outbox у брокер
    npm run consumer    # застосовує ефект

`relay` і `consumer` зупиняються по Ctrl+C: поточна пачка доробляється, з'єднання закриваються.

### Демо та власні числа

Три демо самоочисні (видаляють лише свої дані: замовлення з email `outbox-demo@example.com`, ключі з префіксом `demo-outbox-` і пов'язані рядки outbox/inbox; чужі рядки outbox не чіпають, relay у демо бере лише рядки, створені після старту демо), самі перевіряють інваріанти й завершуються ненульовим кодом при порушенні. Усі запускаються через `bash scripts/with-secrets.sh dev …`. Перед запуском **зупини** `npm run relay` і `npm run consumer`: чужий споживач забрав би повідомлення, чужий relay перехопив би конверти демо.

| Команда | Що перевіряє | Реальний вивід |
|---|---|---|
| `npm run demo:outbox` | клієнт повторив запит із тим самим `Idempotency-Key` | `requests=2 orders=1 outbox=1 published=1 deliveries=1 effect=1 processed=1` |
| `npm run demo:crash-write` | COMMIT падає вже після вставки в outbox | `write-failed=1 orders=0 outbox=0 published=0 deliveries=0 effect=0` |
| `npm run demo:crash-relay` | relay гине після publish, до UPDATE | `published=1 deliveries=2 applied=1 effect=1 processed=1` |

(Кожне ключове слово друкується окремим рядком `key=number`.)

`effect` — скільки разів ефект застосовано насправді (дублі не рахуються), `processed` — кількість рядків inbox, `applied` — скільки повідомлень консюмер підтвердив як нові, `deliveries` — скільки повідомлень прийшло до консюмера. Числа рахуються запитами до бази, а не лічильниками в пам'яті, окрім `deliveries` і `applied`: їх бачить лише сам консюмер.

**Яка форма збою обрана.** У `demo:crash-relay` це **справжній `kill -9`**: демо запускає окремий процес (`src/outbox/crash-relay.ts`), який у хуку `afterPublish` (після підтвердження брокера, до `UPDATE`) викликає `process.kill(process.pid, 'SIGKILL')`. Жодного COMMIT, ROLLBACK чи `close()` не відбувається. На Linux і macOS код виходу — сигнал `SIGKILL`, на Windows примусово завершений процес дає код 1 без імені сигналу (так і вийшло в моєму прогоні). Після аварії демо перевіряє наслідки: у черзі 1 повідомлення, у `outbox` `published_at` порожній. Рестарт relay відправляє подію вдруге, звідси `deliveries=2` і `applied=1`: другу копію відкинув inbox. У `demo:crash-write` збій **змодельований**: на час демо на `outbox` вішається відкладений constraint-тригер, що кидає виняток у момент COMMIT, коли замовлення й рядок outbox уже вставлені. Весь COMMIT відкочується, тому `orders=0 outbox=0`. Тригер видаляється в `finally` і на початку кожного запуску.

### Чому не можна просто поміняти місцями publish і UPDATE published_at

Якщо спершу зафіксувати `published_at`, а потім робити publish, то смерть процесу між цими кроками залишить рядок позначеним як відправлений, хоча брокер повідомлення не отримав. Подія втрачена назавжди: relay більше не вибере цей рядок, і ніхто не дізнається про втрату. У нашому порядку (publish, потім UPDATE і COMMIT) та сама смерть дає лише **дубль**. Дубль виліковується ідемпотентним споживачем, втрата не виліковується нічим. Тому ми свідомо обираємо at-least-once замість at-most-once: надлишкова доставка безпечніша за загублену. Це видно в `demo:crash-relay`: якби порядок був іншим, `deliveries` було б 0 або 1 без жодного шансу відновитися.

### Порядок подій

Порядок гарантується лише **в межах одного ключа партиціонування** (`aggregate_id`, тут id замовлення), та й то за умови, що події одного замовлення відправляє один relay-прохід і обробляє один споживач. Глобального порядку немає, і це не вада реалізації, а властивість схеми: `created_at` ставиться в момент **початку** транзакції (`now()` у Postgres), а видимою для relay вона стає після COMMIT, тож довга транзакція з раннім `created_at` потрапляє в outbox пізніше за коротку з пізнішим. До того ж `id` у `outbox` — випадковий uuid, тому порядок за ним нічого не означає й `ORDER BY created_at, id` лише дає детермінованість. При кількох relay (`SKIP LOCKED`) пачки відправляються паралельно, а повторна доставка брокером теж міняє порядок. Тому споживачі не повинні покладатися на глобальний порядок і мають бути стійкими до переставлення.

### Очищення

Таблиці ростуть без обмежень, тому в реальній системі їх потрібно чистити (очищення `outbox` автоматизовано в ДЗ №23: періодична задача BullMQ, див. розділ «Redis: кеш, сесії, ліміти, черга»; інші таблиці чистяться вручну; демо чистять лише власні дані):

- `outbox`: періодично, невеликими пачками, `DELETE FROM outbox WHERE published_at < now() - interval '7 days'`. Невідправлені рядки не чіпаємо. Швидкість вибірки relay від цього не залежить (частковий індекс), чистимо заради місця на диску.
- `processed_messages`: зберігаємо довше, ніж максимально можливий інтервал між повторними доставками (наприклад, 30 днів), інакше дубль пройде повз inbox.
- `idempotency_keys`: TTL, наприклад 24 години (скільки клієнт ще може повторити запит).
- Рядки outbox, які лишились неопублікованими (наприклад, після `demo:race`, що створює замовлення без запущеного relay), відправить наступний запуск `npm run relay`.

## Redis: кеш, сесії, ліміти, черга

Розділ ДЗ №23. Redis виконує чотири ролі на **двох окремих інстансах**. Для API він необов'язковий: `REDIS_DISABLED=1` (або відсутній `REDIS_URL`) вимикає його повністю, і API працює без кешу та ліміту (так працюють e2e-тести і CI). Якщо Redis увімкнений, але недоступний, кеш деградує до «йдемо в базу», а лімітер пропускає запити (fail-open) і пише попередження. Старт API не чекає на Redis: клієнт підключається у фоні й сам перепідключається.

### Два інстанси і чому саме два

| Інстанс | Адреса | Політика пам'яті | Персистентність | Що там живе |
|---|---|---|---|---|
| `redis-cache` | `127.0.0.1:6390` | `maxmemory 64mb`, `maxmemory-policy allkeys-lru` | немає (`--save ""`, `appendonly no`) | картки товарів, локи single-flight, лічильники rate-limit |
| `redis-queue` | `127.0.0.1:6380` | `maxmemory 128mb`, `maxmemory-policy noeviction` | AOF, `appendfsync everysec`, окремий volume | черга BullMQ, сесії |

**Чому не один.** `maxmemory-policy` задається на рівні процесу, а `SELECT <db>` лише розділяє імена ключів, але не пам'ять і не політику. Кеш і черга хочуть протилежного. Кеш одноразовий: при нестачі пам'яті треба викидати найдавніше невживане (`allkeys-lru`), інакше він перетворюється на джерело помилок запису (`OOM command not allowed`). Черга й сесії це зобов'язання, а не копії: якби вони жили під `allkeys-lru`, Redis мовчки викинув би ключі BullMQ, і задачі зникли б без жодної помилки. Тому там `noeviction` (при заповненні краще явна помилка, ніж тиха втрата) і AOF `everysec` (при аварії втрачається не більше ~1 с записів; `always` дає повну стійкість, але платить fsync за кожну команду). BullMQ сам друкує попередження, якщо політика не `noeviction`.

Порт 6379 свідомо не використано: на машині розробника його може тримати чужий Redis, і застосунок тихо працював би з ним. Обидва порти слухають лише `127.0.0.1`, без пароля (dev; у проді ACL/пароль і TLS). Демо читають `CONFIG GET maxmemory-policy` з живого з'єднання (`cache-lru=1`, `queue-noeviction=1`), тож «не той інстанс» ловиться поведінкою, а не словами.

Власний експеримент (крок 1 ДЗ): масовий запис через `redis-benchmark` на `redis-cache` дав `evicted_keys:92251` без помилок запису, а на `redis-queue` після заповнення 128 МБ записи отримали `OOM command not allowed when used memory > 'maxmemory'`.

### Кеш: cache-aside для картки товару

`GET /products/{productId}/card` повертає товар зі статистикою продажів (агрегат по `order_items`: `unitsSold`, `revenueCents`, `ordersCount`). Це важке читання, тому воно йде через `ProductCardService` (`src/products/`):

- ключ `product:card:<id>`; промах → читання з Postgres → запис у Redis;
- **TTL ставиться завжди**: 300 с + випадковий джитер 0–60 с (`jitteredTtl`). Ключі, прогріті одночасно, не помирають одночасно, тому немає лавини перезапитів; у демо 60 прогрітих ключів дали 36–38 різних значень TTL;
- **негативний кеш**: відсутній товар запам'ятовується на 30 с, щоб запити на неіснуючий id не били в базу;
- **кеш ніколи не кидає виняток**: помилка Redis трактується як промах. Клієнт ioredis має `commandTimeout 500 мс`, `maxRetriesPerRequest 1` і вимкнений offline queue, тож недоступний Redis не вішає запит;
- **інвалідація**: після коміту замовлення `OrdersService` видаляє ключі карток його товарів (`create` і `createIdempotent`; повтор запиту з тим самим `Idempotency-Key` нічого не створює і кеш не чіпає). Інвалідація має гонку (читач міг прочитати стару цифру з бази до коміту й записати її в кеш після нашого `DEL`), тому **TTL залишається завжди**: він гарантує, що застаріле значення живе не довше за 6 хв. Поле `stock` у картці може відставати до кінця TTL, це зазначено в OpenAPI.

### Single-flight проти stampede

Коли популярний ключ вмирає, сотні запитів одночасно йдуть у базу (stampede). Тому промах обробляє один «лідер» (`src/cache/redis-lock.ts`, `ProductCardService.loadOnMiss`):

1. лідер бере лок `SET lock:product:card:<id> <token> NX PX 5000` (токен випадковий, TTL лока 5 с);
2. під локом він ще раз перевіряє кеш (інший лідер міг щойно закінчити), потім читає базу й пише кеш;
3. лок знімається **compare-and-delete** Lua-скриптом (`GET == token` → `DEL`), а не голим `DEL`: якщо лідер повільніший за TTL лока й лок уже належить іншому, голий `DEL` зніс би чужий лок. Це перевіряє демо (`lock-foreign-release`);
4. решта запитів кожні 25 мс перечитують кеш; бюджет очікування 2 с, після нього запит читає базу сам.

Власний вимір (50 одночасних читань холодного ключа): без лока `db-calls-nolock=50`, з локом `db-calls=1`. Лічильник чесний: це кількість SQL-запитів з тегом `/* product-card */`, зловлених `Logger`-ом TypeORM (`src/lib/query-counter.ts`), а не лічильник у коді кешу.

**Що буде, якщо lock stampede зламається, і чому це прийнятно.** Лок тут дає **ефективність, а не коректність**. Усі його збої зводяться до «кілька запитів сходили в базу зайвий раз»: (а) Redis недоступний, `acquire` кидає помилку, запит читає базу напряму (це поведінка «без лока», у демо 50 запитів); (б) лідер завис довше за 5 с, лок протух, другий лідер читає ту саму базу паралельно; (в) лок знято передчасно, дві копії завантажують одне й те саме; (г) очікування обмежене 2 с, тож ніхто не висить вічно. Нічого не псується, бо значення в кеші **похідне** (його завжди можна відтворити з бази), запис у той самий ключ ідемпотентний (обидва лідери пишуть однакове значення, виграє останній), а база й так справляється з цим навантаженням без кешу. Це принципово відрізняється від лока навколо грошової операції, де такий збій призвів би до збитків; для таких місць ми не покладаємось на Redis-лок взагалі, а використовуємо `Idempotency-Key` і унікальні обмеження в Postgres (ДЗ №22). Тому Redlock і fencing tokens для кешу були б надмірними.

### Сесії

**Обрано серверні сесії в Redis**, а не стан у JWT і не кеш-інстанс. У cookie лише непрозорий `sid` (256 випадкових біт, base64url, 43 символи), сам стан лежить у `sess:<sid>` на **`redis-queue`** (`src/sessions/`). Чому не в `redis-cache`: під `allkeys-lru` при нестачі пам'яті Redis викинув би найдавніше невживані сесії, тобто мовчки розлогінив би людей без жодної помилки в логах; сесія не похідне значення й з бази її не відновити. Чому не JWT: вийти («відкликати» токен) без серверного стану неможливо, а тут це видалення ключа.

- **rolling TTL**: кожне читання виконує `GETEX sess:<sid> EX <ttl>`, тобто читає й подовжує TTL однією атомарною командою (без гонки між `GET` і `EXPIRE`); у відповідь іде свіжий `Set-Cookie` із `Max-Age`. Бездіяльність 30 хв закінчує сесію;
- **абсолютна межа 24 год** від `createdAt`, щоб активний клієнт не тримав сесію вічно;
- `sid` перевіряється за форматом до звернення в Redis; cookie `HttpOnly; SameSite=Lax` (+ `Secure` у production); сесія створюється лише там, де їй є що зберігати (`saveUninitialized: false`);
- **fail closed**: помилка Redis → `503`, а не «вважаємо користувача анонімом»;
- сесії спільні для всіх інстансів API, тому «інший процес бачить сесію» (демо перевіряє дочірнім процесом).

Чесно про межі: у навчальному API немає логіну, тому сесійний шар (`SessionStore` + middleware) підключений лише у `demo:session` на міні-сервері, а не до маршрутів `/orders` і `/products`.

### Rate limit на спільному сховищі

`POST /orders` обмежено **30 запитами за 60 с на IP**. Модель: **ковзне вікно з журналом (ZSET)**. Обрано її, бо фіксоване вікно пропускає на межі двох вікон до 2× ліміту, а тут потрібна точність, і пам'яті на ключ треба мало (не більше 30 записів). Лічильник живе в Redis, тому ліміт спільний для всіх інстансів API: лічильник у пам'яті процесу на трьох подах пропустив би втричі більше (демо: `memory-allowed=15` проти `allowed=5`).

- вся перевірка це **один Lua-скрипт** (видалити старі записи, порахувати, додати): атомарність тут вимога коректності, інакше два одночасні запити обидва побачили б «ще є місце»; час береться з Redis (`TIME`), тож розсинхрон годинників подів нічого не ламає;
- `RateLimitGuard` спрацьовує **до** `ValidationPipe`, тому рахує й невалідні запити (так і треба для захисту від зловживань);
- відповідь `429 Too Many Requests` (RFC 6585) у форматі `problem+json` із заголовком `Retry-After` (секунд до звільнення найстарішого слота; не константа);
- fail-open: якщо Redis недоступний, лімітер пропускає запити й пише попередження (лімітер це захист, а не бізнес-правило, він не має валити API);
- ключ береться з `req.ip`. За балансувальником усі запити мали б однакову адресу, тому `TRUST_PROXY_HOPS` вказує Express, скільки проксі стоїть перед API. За замовчуванням `0`: сліпо довіряти `X-Forwarded-For` не можна, його легко підробити.

### Черга: BullMQ

Черга `order-tasks` на `redis-queue` (`src/queue/`). Конвеєр: `API → outbox → relay → RabbitMQ → consumer → BullMQ → worker`. RabbitMQ розносить **події** між сервісами, BullMQ виконує **відкладену роботу з повторами**.

- **`send-receipt`**: консюмер ставить задачу після застосування ефекту (`afterApplied` у `src/messaging/consumer.ts`), і для нового повідомлення, і для **дубля**: якщо процес упав між ефектом у Postgres і постановкою задачі, повторна доставка відновить задачу. Подвійного чека не буде завдяки `jobId = receipt-order-<orderId>`;
- повтори: `attempts: 5`, `backoff: { type: 'exponential', delay: 1000, jitter: 0.5 }`. Джитер потрібен, щоб після збою зовнішнього сервісу всі задачі не прокинулись у ту саму мить;
- **`removeOnComplete: { age: 24 год }`, а не `true`**: з `true` BullMQ видаляє виконану задачу негайно, `jobId` звільняється, і запізніле повторне повідомлення поставило б другий чек. Невдалі зберігаються 7 діб;
- **`outbox-cleanup`**: планувальник `upsertJobScheduler` раз на годину видаляє з `outbox` рядки, **вже надіслані** понад 7 діб тому (невідправлені не чіпає). `upsert` означає «створи або онови»: розклад зберігається в Redis в єдиному екземплярі, скільки б воркерів не стартувало (`schedulers=1`), на відміну від `setInterval` у кожному процесі. Для перевірки інтервал можна скоротити: `OUTBOX_CLEANUP_EVERY_MS=5000 npm run queue:worker`;
- **воркер це окремий процес** (`npm run queue:worker`, concurrency 5, graceful stop чекає активні задачі), тому сплеск чеків не сповільнює HTTP, а падіння воркера не валить API: задачі чекають у Redis;
- два клієнти з різною політикою: воркеру потрібен `maxRetriesPerRequest: null` (він має блокуюче читання), продюсеру навпаки швидкий фейл.

Межі: набір `failed` в BullMQ це **не DLQ**. Задача, що вичерпала спроби, просто лежить там 7 діб, і потрібен алерт на його розмір, інакше її ніхто не побачить. Якщо Redis недоступний, постановка в консюмері падає й повідомлення повертається в RabbitMQ негайно (`requeue`); у проді тут потрібна затримка або ліміт спроб із DLQ.

### Секрети та запуск

Усі команди йдуть через `bash scripts/with-secrets.sh dev …` (секрети з сховища ДЗ №11); обгортка додає дефолти `REDIS_URL=redis://127.0.0.1:6390` і `REDIS_QUEUE_URL=redis://127.0.0.1:6380`. Нових env-файлів немає, `.env.example` містить лише шаблони без облікових даних.

    docker compose up -d --wait
    npm run build
    npm run start          # API: картка товару, ліміт на POST /orders
    npm run relay          # outbox -> RabbitMQ
    npm run consumer       # RabbitMQ -> BullMQ (ставить send-receipt)
    npm run queue:worker   # BullMQ: чеки та очищення outbox

### Демо та власні числа

Чотири демо самоочисні (видаляють лише свої ключі й дані), самі перевіряють інваріанти й завершуються кодом 0 (`OK: усі інваріанти виконано`) або 1 (`FAIL …`).

| Команда | Що показує | Реальний вивід |
|---|---|---|
| `npm run demo:cache` | політика кеш-інстансу, прогрів, розкид TTL, холодний ключ під 50 одночасними читаннями з локом і без | `cache-lru=1 cache-maxmemory=1 warmed=60 ttl-distinct=38 db-calls-warm=0 concurrent=50 db-calls=1 db-calls-nolock=50` |
| `npm run demo:session` | одна сесія, ключ у Redis, TTL подовжується при зверненні (TTL демо 4 с) | `sessions=1 in-redis=1 ttl-renewed=1` |
| `npm run demo:ratelimit` | три «поди» з одним сховищем, ліміт 5 на вікно 10 с | `instances=3 limit=5 requests=15 allowed=5 blocked=10 status=429 retry-after=1 retry-after-sec=10 memory-allowed=15` |
| `npm run demo:queue` | політика черги, повтори з backoff, дедуп за `jobId`, планувальник | `queue-noeviction=1 attempts=3 completed=1 added=2 queued=1 schedulers=1 scheduled-runs=6` |

(`ttl-distinct` між прогонами коливається, 36–38, бо джитер випадковий. `retry-after=1` означає «заголовок присутній», а `retry-after-sec` це його значення. `added=2 queued=1`: два `add` з однаковим `jobId` дали одну задачу.)

Вимірювання на живому API:

- два запити `GET /products/1/card` підряд дали `keyspace_misses:2` (промах і повторна перевірка під локом) та `keyspace_hits:3` (звільнення лока Lua-скриптом, друге читання картки, моя діагностична команда `TTL`); `TTL` ключа 296 с (діапазон 300–360 с мінус час між командами); для `GET /products/99999999/card` `404` і `TTL` негативного ключа 23 с (≤ 30);
- `POST /orders` для товару 1 скинув ключ `product:card:1` (`EXISTS` 1 → 0), наступне читання показало `unitsSold` 13 → 14;
- на `POST /orders` із порожнім тілом: 29 відповідей `400` (запит рахується до валідації, один слот займав попередній справжній заказ), далі `429` з `Retry-After: 32`;
- з `REDIS_DISABLED=1` картка читається з бази, в Redis не з'являється жодного ключа (`DBSIZE 0`), а 35 запитів дали 35 разів `400` без жодного `429`;
- перший запуск воркера: `send-receipt` для замовлень 79 і 80 виконано, очищення outbox видалило 31 надісланий рядок старше 7 діб; повторний запуск із іншим інтервалом залишив `ZCARD bull:order-tasks:repeat` рівним 1.

## Auth

AuthN і AuthZ для API (ДЗ №24): короткий access JWT, підписаний асиметрично (ES256), непрозорий refresh-токен із ротацією та виявленням повторного використання, logout, що справді відкликає сесію, і два рівні RBAC (роль та власник ресурсу). Код живе в `src/auth/`.

### Змінні та їхнє джерело

У таблиці `<env>` — це `dev` або `prod`. Ключі й pepper **не мають дефолтів**: застосунок без них не стартує. Конфіг валідується в `ConfigModule.forRoot({ validate })` до підключення до БД, тож голий `npm run start` завершується з ненульовим кодом і називає відсутню змінну, а не падає пізніше в рантаймі.

| Змінна | Обов'язкова | Джерело | Опис |
|--------|:-----------:|---------|------|
| `JWT_KID` | так | сховище: `secrets/jwt/<env>/kid` через `scripts/with-secrets.sh` | Ідентифікатор поточного ключа підпису (`dev-2026-10-26`). Потрапляє в заголовок `kid` кожного access-токена |
| `JWT_PRIVATE_KEY` | так | сховище: `secrets/jwt/<env>/private.pem` через `scripts/with-secrets.sh` | Приватний ключ ES256 (EC P-256, PKCS#8), PEM у base64. Підписує access-токени |
| `JWT_PUBLIC_KEY` | так | сховище: `secrets/jwt/<env>/public.pem` через `scripts/with-secrets.sh` | Публічний ключ тієї ж пари (SPKI), PEM у base64. Перевіряє підпис; при старті звіряється з приватним за відбитком |
| `REFRESH_TOKEN_PEPPER` | так | сховище: `secrets/jwt/<env>/refresh_pepper` через `scripts/with-secrets.sh` | Секрет для `HMAC-SHA256` refresh-токена, щонайменше 32 символи. У БД лежить лише `HMAC(pepper, token)` |
| `REDIS_QUEUE_URL` | так для Auth (у загальній схемі необов'язкова) | обгортка `with-secrets.sh` (дефолт `redis://127.0.0.1:6380`) або змінні середовища платформи | Інстанс `redis-queue` (`noeviction` + AOF) для denylist. `REDIS_DISABLED` Auth ігнорує: без Redis logout не може бути чесним |

TTL і алгоритм — не змінні середовища, а константи коду (`src/auth/auth.constants.ts`): access живе 600 с, refresh — 7 діб простою і 30 діб абсолютно від першого логіну, алгоритм лише `ES256`.

Згенерувати ключі (приватні файли лежать у `secrets/jwt/`, який у `.gitignore`):

    node scripts/gen-jwt-keys.mjs dev
    node scripts/gen-jwt-keys.mjs prod

Скрипт друкує `[fp] <dev|prod>=<8 hex> kid=<kid>` і відмовляється перезаписувати наявні ключі без `--force` (перегенерація вбиває всі видані токени).

### Відбитки ключів

Відбиток — перші 8 hex-символів SHA-256 від DER-представлення публічного ключа (SPKI). Приватний ключ у git не потрапляє, а за відбитком видно, який саме ключ працює: застосунок друкує при старті `ключ підпису: kid=… fp=…`.

| Середовище | `kid` | Відбиток |
|------------|-------|----------|
| dev | `dev-2026-10-26` | `7392731b` |
| prod | `prod-2026-10-26` | `1e667d9e` |

### Access-токен

JWT ES256 із заголовком `kid` і claims `iss`, `aud`, `sub` (id користувача), `jti`, `exp`, `iat`, `role`, `fid` (id родини refresh-токенів). Перевірка (`TokenService.verifyAccess`) завжди йде з явним списком `algorithms: ['ES256']`: токен із `alg: none` або `HS256` (атака підміни алгоритму, де публічний ключ використовують як HMAC-секрет) відхиляється ще до перевірки підпису. Ключ береться за `kid` із `KeyStore`; невідомий `kid` означає 401. `iss` і `aud` перевіряє `jsonwebtoken`, а наявність і тип `sub`, `jti`, `exp`, `fid` і допустиму `role` застосунок перевіряє вручну, бо сама бібліотека `exp` не вимагає. Claim `role` у токені — лише підказка: права завжди читаються з БД (див. RBAC).

Бібліотека — `jsonwebtoken` (CJS). `jose` 6 є ESM-only і не працює під Jest 30 на Node 22.

### Refresh-токен: ротація та виявлення повторного використання

Refresh — 32 випадкові байти в base64url, не JWT. У БД (таблиця `refresh_tokens`, міграція `AuthTables`) зберігається `token_hash = HMAC-SHA256(pepper, token)`: витік дампу бази не дає жодного придатного токена, а звичайний SHA-256 без pepper дозволив би перебір.

Усі токени одного логіну мають спільний `family_id`. Кожен `POST /auth/refresh`:

1. у транзакції блокує рядок `SELECT … FOR UPDATE` за `token_hash`;
2. якщо токен уже використаний (`revoked_at IS NOT NULL`) — це **повторне використання**: відкликається вся родина (`UPDATE … SET revoked_at = now() WHERE family_id = …`), у лог іде рядок `[ІНЦИДЕНТ] refresh_reuse_detected — family=… user=… відкликано рядків: N`, клієнт отримує 401;
3. інакше старий рядок відкликається і створюється новий у тій самій родині, а нова пара (access + refresh) віддається клієнту.

Відкликання та видача нової пари — **один COMMIT**: або обидва, або жоден. Колбек транзакції *повертає* результат, а 401 кидається вже після COMMIT. Якби виняток летів зсередини, транзакція відкотилася б разом із відкликанням родини, і виявлення повтору нічого б не зробило. Пільгового вікна (grace) немає: другий refresh тим самим токеном завжди є сигналом крадіжки. Ціна — законний клієнт, що повторив запит після обриву мережі, буде розлогінений; це свідомий вибір на користь безпеки.

Для родини діють два обмеження: простій 7 діб (`expires_at` кожного нового токена) і абсолютний ліміт 30 діб від початку родини: `expires_at = LEAST(now() + 7d, family_started_at + 30d)`. Без другого активний клієнт ніколи б не розлогінювався.

Після виявлення повтору активні access-токени цієї родини теж гаснуть: у denylist ставиться `deny:fam:<family_id>` з TTL = життя access-токена (600 с). Це best-effort: якщо Redis недоступний, родина вже відкликана в БД, тож максимум 10 хвилин живе лише вже виданий access.

### Logout: чому це дві дії, а не одна

`POST /auth/logout` (204) робить дві окремі речі в двох різних сховищах, і **атомарними вони бути не можуть**: Postgres і Redis не діляться транзакцією.

1. У БД родина refresh-токенів відкликається (`revoked_at`). Після цього отримати нову пару неможливо.
2. У Redis ставиться `deny:jti:<jti>` з TTL = залишок життя access-токена. Після цього поточний access перестає працювати відразу, а не через 10 хвилин. TTL = залишок, бо після `exp` токен і так мертвий: запис не росте нескінченно.

Порядок навмисний: **спочатку БД, потім Redis**. Якщо впаде між кроками, найгірше — access-токен проживе до свого `exp` (щонайбільше 10 хвилин), але refresh уже мертвий. Зворотний порядок залишив би живу сесію, яку користувач вважає закритою. Якщо Redis недоступний на кроці 2, API відповідає 503 «повторіть logout»; операція ідемпотентна: повторний виклик знаходить родину вже відкликаною, пропускає крок 1 і доробляє крок 2.

Denylist живе саме в `redis-queue`, а не в `redis-cache`: кеш має `allkeys-lru` і при тиску пам'яті мовчки викинув би запис про відкликаний токен. `redis-queue` — `noeviction` + AOF. Перевірка denylist — fail-closed: якщо Redis не відповів, запит із access-токеном отримує 503, а не пропускається. In-memory запасного варіанту немає навмисно: для кількох інстансів він би розійшовся.

### 401 проти 403

| Код | Значення | Приклад | Що робить клієнт |
|-----|----------|---------|------------------|
| 401 | «не впізнаю»: токена немає, прострочений, підпис/alg/kid/aud невірні, у denylist, родина відкликана | `GET /orders` без заголовка; підроблений токен; після logout | SDK оновлює токен через refresh і повторює запит |
| 403 | «впізнаю, але не дозволено» | `customer` робить `POST /products`; чуже `GET /orders/{id}` | Повтор безглуздий, refresh нічого не змінить |

401 завжди містить `WWW-Authenticate: Bearer`. Помилки йдуть у форматі RFC 9457 (`application/problem+json`) через `ProblemExceptionFilter`.

### RBAC: два рівні

**Рівень ролі** (`@Roles('seller', 'admin')` + глобальний `RolesGuard`): `POST /products` і `PATCH /orders/:id/status` дозволені лише `seller` і `admin`, `customer` отримує 403. Читання товарів і `/health` позначені `@Public()`. Роль гард бере **з БД**, а не з claim `role`.

**Рівень власника** (`OrdersService.assertCanView`, не гард): `GET /orders/{foreign}` дає 403. Перевірка живе в сервісі, а не в гарді, бо гард не знає, чий саме це рядок, поки не прочитає його з БД; а сервіс у будь-якому випадку читає рядок. Порядок: `SELECT "userId"` → 404, якщо замовлення немає → 403, якщо ти не власник і не `admin`. Списки (`GET /orders`) фільтруються в `WHERE` за `userId`, тож чужого там просто нема. SSE-підписка перевіряється до `writeHead`, щоб відмову ще можна було віддати нормальним статусом.

**Де проходить межа.** Токен доводить *хто ти був на момент видачі*. Права — *що тобі дозволено зараз* — читаються з БД на кожному запиті. Тому понижений адмін (скажімо, `admin` → `customer`) зі своїм ще чинним access-токеном:

- лишається **автентифікованим** до `exp` (до 10 хвилин): підпис і строк дійсні, і це не помилка, бо токен нічого не стверджує про поточні права;
- але **негайно втрачає права**: `RolesGuard` і перевірка власника читають роль із БД, тож claim `role: "admin"` у його токені нічого не дає;
- щоб прибрати і автентифікацію, потрібно відкликати родину (`revokeFamily`) і поставити `deny:fam:<fid>`.

Підроблений токен (змінений claim `role` без перепідпису) відхиляється як 401 на перевірці підпису: це перевіряє `demo:rbac` (`tampered=401`).

Ключ ідемпотентності `Idempotency-Key` обмежений користувачем (`"<userId>:<key>"`): інакше чужий клієнт міг би повторити ключ і отримати відповідь на чуже замовлення.

### Ротація ключів з перекриттям і роль `kid`

`kid` — це «номерок» ключа в заголовку токена. Без нього перевіряючий мав би єдиний ключ і не міг би змінити його без миттєвого знецінення всіх токенів. З ним `KeyStore` тримає мапу `kid → публічний ключ` і обирає потрібний за заголовком. Ротація з перекриттям:

1. Згенерувати нову пару з новим `kid` (`node scripts/gen-jwt-keys.mjs prod --force` у новий каталог або з новою датою в `kid`).
2. Розкотити на всі інстанси **перевірку** обох ключів (старий і новий публічні в мапі), підпис ще старим.
3. Перемкнути **підпис** на новий ключ: нові токени йдуть з новим `kid`, старі ще перевіряються.
4. Почекати щонайменше `ACCESS_TTL` (10 хвилин) плюс запас: усі токени зі старим `kid` вичерпали життя.
5. Прибрати старий публічний ключ із мапи і знищити приватний.

Refresh-токени непрозорі й не прив'язані до ключа, тому ротація їх не зачіпає: навіть без перекриття (миттєва заміна) клієнти отримали б 401 лише на access, SDK зробив би refresh і продовжив з новим `kid`. Перекриття прибирає і ці 401.

Що реалізовано в цій ДЗ: `KeyStore` вже є мапою за `kid` і відхиляє невідомий `kid`, але реєструє лише один ключ (поточний з `JWT_KID`/`JWT_PUBLIC_KEY`). Кроки 2 і 4 вимагають додати до мапи попередній публічний ключ (окрема пара змінних із сховища); це місце розширення, у цій роботі воно не доробляється.

### Запуск і демо

Усі три демо самі стартують Nest у процесі на порту 0, створюють тимчасових користувачів `demo-<ім'я>-<hex>@example.com`, самі прибирають за собою (і перевіряють, що нічого не лишилося), друкують `key=number` і завершуються з кодом ≠ 0 при порушенні інваріанта. Потрібні `docker compose up -d --wait`, `npm run build` і `npm run migrate`; запускаються через `bash scripts/with-secrets.sh dev …`, тому ключі беруться зі сховища:

    npm run build
    npm run migrate
    npm run demo:auth
    npm run demo:reuse
    npm run demo:rbac

Очікуваний вивід (кожна пара `ключ=число` на окремому рядку; три демо наведено підряд):

    login=200
    no-token=401
    with-token=200
    refresh=200
    logout=204
    after-logout=401
    refresh-after-logout=401

    login=200
    r1-refresh=200
    r1-reuse=401
    r2-after-reuse=401

    anon=401
    own=200
    foreign=403
    role-denied=403
    role-allowed=201
    tampered=401

Після ключів кожне демо друкує `OK: усі інваріанти виконано` і завершується кодом 0. `demo:reuse` пише рядок `[ІНЦИДЕНТ] refresh_reuse_detected …` у stderr. Серверна частина: `npm run start:vault` (`npm run build && bash scripts/with-secrets.sh dev node dist/main.js`). Голий `npm run start` без змінних з таблиці вище завершується з ненульовим кодом і назвою відсутньої змінної.

Тести: `npm run test:unit` (TokenService), `npm run test:integration` (refresh-токени, denylist), `npm run test:e2e` (auth, RBAC продуктів, власність замовлень). Integration і e2e піднімають Postgres 16 і Redis 8.4 через Testcontainers, тож потрібен Docker.

### Відомі прогалини

- WebSocket-шлюз у `join` бере `userId` із payload, а не з токена: аутентифікація сокетів у цю ДЗ не входила.
- Логін не має rate limit (є ліміт на `POST /orders` із ДЗ №23). Перебір паролів стримує лише argon2id (m=19456, t=2, p=1) і однакова відповідь на «немає користувача» та «невірний пароль» (з dummy-хешем для вирівнювання часу).
- `EventSource` у браузері не вміє надсилати `Authorization`, тож SSE із браузера потребує cookie-схеми або fetch-стріму.
- 403 замість 404 на чуже замовлення розкриває, що замовлення з таким id існує.
- У `seller` немає зв'язку із замовленнями, тому `PATCH /orders/:id/status` — це лише `@Roles('seller', 'admin')`, без перевірки «замовлення містить мої товари». Це місце для ReBAC-кортежів (бонус).

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
| `src/migrations/`              | Згенеровані TypeORM-міграції (`Init`, `AddProductsNameUnique`, `OrdersOrderItemsIndexes`, `CheckoutSchema`) |
| `src/data-source.ts`           | `DataSource` для TypeORM CLI та скриптів: `synchronize: false`, конфіг з `process.env` |
| `src/seed.ts`                  | Детермінований ідемпотентний seed (users/products через `upsert`, orders/order_items — за guard'ом на існуючий count) |
| `src/demo-nplus1.ts`           | Демо проблеми N+1 і трьох способів фіксу, з власним `Logger`-лічильником запитів |
| `src/report.ts`                | Звіт "топ товарів за виторгом" через `createQueryBuilder().getRawMany()` |
| `src/checkout.ts`              | Транзакційна бізнес-операція "оформити замовлення": атомарний decrement stock/balance, запис Order+OrderItem+задачі в чергу; після коміту публікує `order.placed` (продюсера передають явно) |
| `src/entities/post-processing-job.entity.ts` | Entity черги задач на постобробку замовлення (лист/чек) |
| `src/lib/sleep.ts`             | Допоміжна `sleep()` для імітації роботи та backoff при retry |
| `src/demo-race.ts`             | 50 паралельних `checkout()` на один товар — демонстрація захисту від oversell |
| `src/demo-workers.ts`          | Воркер-пул, що розбирає чергу задач через `FOR UPDATE SKIP LOCKED` |
| `src/demo-retry.ts`            | Провокує `40001` під `REPEATABLE READ` і демонструє повний retry транзакції |
| `pgbouncer/pgbouncer.ini`      | Конфіг PgBouncer: `pool_mode = transaction`, `admin_users`, монтується в контейнер як є |
| `pgbouncer/userlist.txt`       | Клієнтська автентифікація PgBouncer (`scram-sha-256`), пароль синхронізовано з Postgres |
| `scripts/lib/parse-database-url.sh` | Розбір `$DATABASE_URL` на складові через `URL` з Node.js (не bash-регулярками — у паролі є `/`) |
| `scripts/backup.sh`            | `pg_dump -Fc` через PgBouncer, дата в імені файлу, перевірка архіву `pg_restore --list` |
| `scripts/restore-drill.sh`     | Відновлення останнього дампу в чистий одноразовий контейнер, звірка контрольної суми до/після, вимір RTO |
| `backup.cron`                  | Розклад нічного бекапу (RPO ≈ до 24 годин) |
| `RESTORE-DRILL.md`             | Протокол реального прогону restore drill: дата, розмір, RTO, RPO |
| `db/schema.sql`                | Таблиці курсового домену (`users`, `products`, `orders`, `order_items`) + constraints |
| `db/seed.sql`                  | Генерація ~120 000 замовлень і пов'язаних даних, `VACUUM (ANALYZE)` наприкінці |
| `db/queries/q1.sql, q2.sql, q3.sql` | Три "важкі" запити (власник+період, статус, регістронезалежний пошук) |
| `db/indexes.sql`               | Індекси-ліки для цих трьох запитів (composite, partial, expression) |
| `db/OPTIMIZATIONS.md`          | `EXPLAIN (ANALYZE, BUFFERS)` до/після по кожному запиту |
| `secrets/db_password`          | Файл-секрет з паролем PostgreSQL (у `.gitignore`)|
| `secrets/db_password.example`  | Шаблон секрету для свіжого клону/грейдера (той самий пароль, що й у `pgbouncer/userlist.txt`) |
| `scripts/check-env-example.mjs`| Звірка `.env.example` зі схемою (`npm run check:env`) |
| `scripts/with-secrets.sh`      | Обгортка: підтягує `DB_PASSWORD` із `secrets/db_password` і збирає `DATABASE_URL` перед будь-якою командою до бази (пропускається при `SKIP_VAULT=1`) |
| `package.json`                 | Скрипти `build`, `migrate`, `migrate:show`, `migrate:revert`, `seed`, `demo:nplus1`, `report`, `demo:race`, `demo:workers`, `demo:retry`, `rabbit:setup`, `consumer`, `demo:publish`, `demo:dlq`, `demo:duplicate` |
| `docker-compose.yml`           | PostgreSQL + PgBouncer (`pool_mode = transaction`) + RabbitMQ 4.2 для локальної розробки, `db/` змонтована в контейнер як `/db` |
| `test/integration/`            | Integration-тести репозиторіїв і публікації `order.placed` з обох шляхів створення замовлення (`checkout.publish.spec.ts`) проти testcontainer-Postgres (TRUNCATE-ізоляція між тестами) |
| `test/e2e/`                    | E2E-тести повного Nest-застосунку через supertest, без підміни провайдерів |
| `jest.config.js`               | Multi-project конфіг Jest: `integration`, `e2e`, `contract` |
| `Dockerfile` + `.dockerignore` | Production-образ застосунку (multi-stage), без секретів у шарах |
| `rotate.sh`                    | Ротація пароля БД без рестарту (пам'ятай синхронно оновити `pgbouncer/userlist.txt`) |
| `src/orders/order-events.service.ts` | Спільна шина подій (RxJS `Subject`) + буфер останніх подій для `Last-Event-ID` — одна на WS і SSE |
| `src/orders/orders.gateway.ts` | WebSocket-gateway: `join` з перевіркою власника замовлення, кімнати `orders:<id>`, ретрансляція подій із шини |
| `src/orders/order-status.ts`   | Список допустимих статусів замовлення (`ORDER_STATUSES`) |
| `src/orders/dto/update-order-status.dto.ts` | DTO тіла `PATCH /orders/:orderId/status` |
| `scripts/realtime-demo.mjs`    | Headless-демо ізоляції WS-кімнат (`socket.io-client`) + контрольний режим `--same-room` |
| `src/messaging/rabbitmq.config.ts` | Імена exchange/queue/routing key, `PREFETCH`, `DELIVERY_LIMIT`, збирання `RABBITMQ_URL` |
| `src/messaging/topology.ts`    | `assertTopology`: exchange, черга, binding, DLX-контур і alternate exchange (оголошує споживач/bootstrap, не продюсер) |
| `src/messaging/events.ts`      | Контракт події `order.placed` (не ORM-сутність) і детермінований `eventId` |
| `src/messaging/publisher.ts`   | Публікація через confirm-канал: `mandatory` + `basic.return`, `persistent`, перепідключення |
| `src/messaging/publish-order-placed.ts` | Залишок ДЗ №19 (публікація після коміту); з ДЗ №22 бізнес-код його не викликає, події йдуть через outbox |
| `src/messaging/consumer.ts`    | Споживач: явний `prefetch`, ручний `ack` після ефекту, ідемпотентний ефект (`ON CONFLICT DO NOTHING`) |
| `src/messaging/dlq.ts`         | Читання причини смерті з `x-death` / `x-first-death-reason` |
| `src/messaging/messaging.module.ts` | Nest-модуль: фабрика `EventPublisher` і `TopologyBootstrap` |
| `src/messaging/setup.ts`, `src/messaging/run-consumer.ts` | `npm run rabbit:setup` і `npm run consumer` |
| `src/messaging/demo-kit.ts`, `src/messaging/crash-consumer.ts` | Спільне для демо (самоскидання, протокол `key=value`) і споживач, що гине через `kill -9` |
| `src/demo-rabbit-publish.ts`, `src/demo-rabbit-dlq.ts`, `src/demo-rabbit-duplicate.ts` | `npm run demo:publish`, `demo:dlq`, `demo:duplicate` |
| `src/migrations/1791122400000-ProcessedOrderEvents.ts` | Таблиця `processed_order_events` (журнал оброблених подій, PK = `eventId`) |
| `secrets/rabbitmq_password`, `secrets/rabbitmq_password.example` | Пароль брокера (перший у `.gitignore`, другий — шаблон для клону/грейдера) |
| `src/migrations/1791300000000-OutboxAndProcessedMessages.ts` | Таблиці `outbox` (з частковим індексом на неопубліковані) і `processed_messages` (inbox, PK `(message_id, consumer)`) |
| `src/migrations/1791400000000-IdempotencyKeys.ts` | Таблиця `idempotency_keys` (ключ, хеш запиту, `order_id`) |
| `src/outbox/outbox.ts` | `enqueueOrderPlaced`: запис події в outbox у транзакції бізнес-операції |
| `src/outbox/relay.ts` | `relayOnce` / `relayLoop`: `SELECT … FOR UPDATE SKIP LOCKED` → publish → `UPDATE published_at` |
| `src/outbox/run-relay.ts`, `src/outbox/pool.ts` | `npm run relay` (graceful stop по SIGINT/SIGTERM) і пул `pg` |
| `src/outbox/crash-relay.ts` | Relay, що гине через `kill -9` після publish, до UPDATE (для `demo:crash-relay`) |
| `src/outbox/demo-kit.ts` | Спільні помічники трьох демо: самоочищення, тригер збою COMMIT, `snapshot`, друк `key=number` |
| `src/messaging/pg-store.ts` | `pgStore`: транзакція на одному з'єднанні для ідемпотентного ефекту консюмера |
| `src/demo-outbox.ts`, `src/demo-crash-write.ts`, `src/demo-crash-relay.ts` | `npm run demo:outbox`, `demo:crash-write`, `demo:crash-relay` |
| `test/integration/checkout.outbox.spec.ts`, `test/integration/orders.idempotency.spec.ts` | Тести: замовлення й подія в одній транзакції; `Idempotency-Key` (повтор, паралельні запити, 422, відкат ключа) |
| `src/redis/` | `connect.ts` (клієнти ioredis з таймаутами; `openCacheClient` для API, `createCacheClient`/`createSessionClient` для демо, `queueConnectionOptions` для BullMQ), `redis.module.ts` (глобальний модуль: `CACHE_REDIS` і `RATE_LIMITER`, `null` при `REDIS_DISABLED`), `redis.config.ts`, `tokens.ts` |
| `src/cache/` | `redis-cache.ts` (cache-aside, помилка = промах), `redis-lock.ts` (`SET NX PX` + Lua compare-and-delete), `ttl.ts` (TTL, джитер, параметри лока) |
| `src/products/product-card*.ts` | Картка товару: клас з описом для OpenAPI, репозиторій важкого агрегату, сервіс із single-flight |
| `src/sessions/`, `src/session-probe.ts` | Сесії в Redis: `SessionStore` (`GETEX`, rolling TTL), middleware з cookie; дочірній процес для демо |
| `src/ratelimit/` | Ковзне вікно (ZSET + Lua, час із `TIME`), Express-middleware для демо і `RateLimitGuard` для Nest |
| `src/queue/` | `order-tasks.ts` (черга, `jobId`-дедуп, backoff з джитером, `upsertJobScheduler`), `order-tasks-worker.ts`, `run-worker.ts` (`npm run queue:worker`) |
| `src/auth/` | AuthN/AuthZ: `token.service.ts` (ES256, явний `algorithms`), `key-store.ts` (`kid → ключ`), `refresh-token.service.ts` (ротація, виявлення повтору), `access-denylist.ts` (Redis), `auth.service.ts` / `auth.controller.ts` (`/auth/login`, `/refresh`, `/logout`), глобальні `auth.guard.ts` і `roles.guard.ts`, декоратори `@Public()`, `@Roles()`, `@CurrentUser()` |
| `src/config/auth-env.ts`, `src/config/jwt-keys.ts` | Валідація ключів до старту (формат, EC P-256, відповідність пари за відбитком) |
| `src/migrations/1793000000000-AuthTables.ts` | Таблиця `refresh_tokens` (`token_hash`, `family_id`, `revoked_at`, `expires_at`, `family_started_at`) |
| `src/lib/auth-demo-kit.ts`, `src/demo-auth.ts`, `src/demo-reuse.ts`, `src/demo-rbac.ts` | `npm run demo:auth`, `demo:reuse`, `demo:rbac` (самозапуск, самоочищення, `key=number`) |
| `scripts/gen-jwt-keys.mjs` | `npm run keys:gen -- <env>`: ES256-пара, `kid`, pepper у `secrets/jwt/<slug>/` та відбиток |
| `test/unit/token.service.spec.ts`, `test/integration/refresh-tokens.spec.ts`, `test/integration/access-denylist.spec.ts`, `test/e2e/auth*.spec.ts`, `test/e2e/*rbac*.spec.ts`, `test/e2e/orders.ownership.e2e.spec.ts` | Тести Auth: unit, integration (Postgres і Redis у Testcontainers), e2e |
| `src/lib/query-counter.ts`, `src/lib/demo-output.ts` | Логер TypeORM, що рахує запити за тегом; спільний друк `key=number` і перевірки інваріантів для демо |
| `src/demo-cache.ts`, `src/demo-session.ts`, `src/demo-ratelimit.ts`, `src/demo-queue.ts` | `npm run demo:cache`, `demo:session`, `demo:ratelimit`, `demo:queue` |

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
| `DB_HOST`       | так         | Хост PgBouncer (застосунок ходить у базу через PgBouncer, не напряму в Postgres) |
| `DB_PORT`       | ні (`6432` за замовч.) | Порт PgBouncer (Postgres сам слухає 5432, але застосунок туди не ходить) |
| `DB_USER`       | так         | Користувач PostgreSQL                              |
| `DB_NAME`       | так         | Назва бази даних                                   |
| `DATABASE_URL`  | ні          | Рядок підключення до БД одним рядком (контракт для сумісності з ДЗ #13/#15 та інструментами на кшталт грейдера, вказує на PgBouncer). **Джерело — сховище**: в реальному оточенні значення приходить із секрет-менеджера/змінних середовища платформи, а не з файлу в git. Сам застосунок (`src/data-source.ts`) продовжує підключатись через `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_NAME` + файл-пароль нижче — `DATABASE_URL` цю логіку не замінює, ним користуються лише `scripts/backup.sh`/`scripts/restore-drill.sh` (див. "Data layer ops"). |

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

Разом із Postgres та PgBouncer через Docker Compose:

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

## Grading

Грейдер (і будь-хто на свіжому клоні без доступу до сховища секретів) виконує рівно ці команди з кореня репозиторію:

    cp secrets/db_password.example secrets/db_password
    export DB_HOST=127.0.0.1
    export DB_PORT=6432
    export DB_USER=marketplace
    export DB_PASSWORD=VgiPEzaFq/5KKivNpzGqUnko2bXMpiT2
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

    npm run demo:race
    npm run demo:workers
    npm run demo:retry

    psql -h 127.0.0.1 -p 6432 -U marketplace -d marketplace -c "SELECT 1"
    psql -h 127.0.0.1 -p 6432 -U marketplace -d pgbouncer -c "SHOW POOLS"

    export DATABASE_URL=postgres://marketplace:VgiPEzaFq%2F5KKivNpzGqUnko2bXMpiT2@127.0.0.1:6432/marketplace
    bash scripts/with-secrets.sh dev bash scripts/backup.sh
    bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh

`DB_PASSWORD=VgiPEzaFq/5KKivNpzGqUnko2bXMpiT2` — те саме dev-значення, що лежить у `secrets/db_password.example`, `pgbouncer/userlist.txt` і завжди використовується для локальної розробки; воно навмисно не є секретом (домовленість з ДЗ №11). У `DATABASE_URL` той самий пароль йде вже URL-кодованим (`%2F` замість `/`) — інакше `/` в паролі зламав би розбір рядка підключення. Крок `cp secrets/db_password.example secrets/db_password` обов'язковий: без нього Docker при спробі змонтувати неіснуючий секрет-файл створить на його місці порожню директорію замість файлу, і Postgres впаде з помилкою "superuser password is not specified" (перевірено на реальному чистому клоні).

Якщо `psql` немає на машині грейдера локально — той самий `SELECT 1`/`SHOW POOLS` перевіряється зсередини вже запущеного контейнера `postgres`, який має власний psql-клієнт:

    docker compose exec -e PGPASSWORD="$DB_PASSWORD" postgres psql -h pgbouncer -p 6432 -U marketplace -d marketplace -c "SELECT 1"

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
| `src/migrations/`              | Згенеровані TypeORM-міграції (`Init`, `AddProductsNameUnique`, `OrdersOrderItemsIndexes`, `CheckoutSchema`) |
| `src/data-source.ts`           | `DataSource` для TypeORM CLI та скриптів: `synchronize: false`, конфіг з `process.env` |
| `src/seed.ts`                  | Детермінований ідемпотентний seed (users/products через `upsert`, orders/order_items — за guard'ом на існуючий count) |
| `src/demo-nplus1.ts`           | Демо проблеми N+1 і трьох способів фіксу, з власним `Logger`-лічильником запитів |
| `src/report.ts`                | Звіт "топ товарів за виторгом" через `createQueryBuilder().getRawMany()` |
| `src/checkout.ts`              | Транзакційна бізнес-операція "оформити замовлення": атомарний decrement stock/balance, запис Order+OrderItem+задачі в чергу |
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
| `package.json`                 | Скрипти `build`, `migrate`, `migrate:show`, `migrate:revert`, `seed`, `demo:nplus1`, `report`, `demo:race`, `demo:workers`, `demo:retry` |
| `docker-compose.yml`           | PostgreSQL + PgBouncer (`pool_mode = transaction`) для локальної розробки, `db/` змонтована в контейнер як `/db` |
| `Dockerfile` + `.dockerignore` | Production-образ застосунку (multi-stage), без секретів у шарах |
| `rotate.sh`                    | Ротація пароля БД без рестарту (пам'ятай синхронно оновити `pgbouncer/userlist.txt`) |
-- db/seed.sql
-- Реалістичний обсяг тестових даних. Застосовується: psql -f db/seed.sql

-- 1. Користувачі
INSERT INTO users (email, name)
SELECT
    'user' || i || '@example.com',
    'User ' || i
FROM generate_series(1, 5000) AS s(i);

-- 2. Товари
INSERT INTO products (name, price, currency)
SELECT
    'Product ' || i,
    round((random() * 20000 + 50)::numeric, 2),
    'UAH'
FROM generate_series(1, 300) AS s(i);

-- 3. Замовлення (головна таблиця, 120 000 рядків) — перекошений розподіл статусів
INSERT INTO orders (user_id, customer_email, status, total, currency, created_at)
SELECT
    user_id,
    CASE (floor(random() * 3))::int
        WHEN 0 THEN 'user' || user_id || '@example.com'
        WHEN 1 THEN upper('user' || user_id || '@example.com')
        ELSE initcap('user' || user_id || '@example.com')
END,
    CASE
        WHEN roll < 0.55 THEN 'delivered'
        WHEN roll < 0.70 THEN 'shipped'
        WHEN roll < 0.85 THEN 'paid'
        WHEN roll < 0.93 THEN 'pending'
        WHEN roll < 0.98 THEN 'cancelled'
        ELSE 'refunded'
END,
    round((random() * 5000 + 50)::numeric, 2),
    'UAH',
    now() - (random() * interval '730 days')
FROM (
    SELECT
        (floor(random() * 5000) + 1)::bigint AS user_id,
        random() AS roll
    FROM generate_series(1, 120000) AS s(i)
) picked;

-- 4. Позиції замовлень (~300 000 рядків, у середньому 2.5 на замовлення)
INSERT INTO order_items (order_id, product_id, quantity, unit_price)
SELECT
    (floor(random() * 120000) + 1)::bigint,
    (floor(random() * 300) + 1)::bigint,
    (floor(random() * 3) + 1)::int,
    round((random() * 20000 + 50)::numeric, 2)
FROM generate_series(1, 300000) AS s(i);

VACUUM (ANALYZE);
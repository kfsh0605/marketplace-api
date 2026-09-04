-- db/schema.sql
-- Схема даних курсового проєкту Marketplace API.
-- Застосовується на чисту базу командою: psql -f db/schema.sql

CREATE TABLE users (
                       id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                       email TEXT NOT NULL UNIQUE,
                       name TEXT NOT NULL,
                       created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
                          id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                          name TEXT NOT NULL,
                          price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
                          currency TEXT NOT NULL DEFAULT 'UAH',
                          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
                        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                        user_id BIGINT NOT NULL REFERENCES users(id),
                        customer_email TEXT NOT NULL,
                        status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded')),
                        total NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
                        currency TEXT NOT NULL DEFAULT 'UAH',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
                             id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                             order_id BIGINT NOT NULL REFERENCES orders(id),
                             product_id BIGINT NOT NULL REFERENCES products(id),
                             quantity INT NOT NULL CHECK (quantity > 0),
                             unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0)
);
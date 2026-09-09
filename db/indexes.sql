-- db/indexes.sql
-- Індекси, що лікують три повільні запити з db/queries/.

-- q1: пошук по власнику + період — складений індекс, рівність на першому місці
CREATE INDEX idx_orders_user_created ON orders (user_id, created_at);

-- q2: фільтр по статусу — partial-індекс лише по рідкісному статусу
CREATE INDEX idx_orders_pending ON orders (created_at) WHERE status = 'pending';

-- q3: пошук без урахування регістру — expression-індекс по lower(email)
CREATE INDEX idx_orders_email_lower ON orders (lower(customer_email));
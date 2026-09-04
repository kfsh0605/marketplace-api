SELECT id, user_id, total, created_at
FROM orders
WHERE status = 'pending';
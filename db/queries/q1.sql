SELECT id, status, total, created_at
FROM orders
WHERE user_id = 2500
  AND created_at BETWEEN now() - interval '90 days' AND now();
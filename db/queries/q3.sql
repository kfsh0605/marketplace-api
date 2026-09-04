SELECT id, status, total, created_at
FROM orders
WHERE lower(customer_email) = lower('User2500@Example.com');
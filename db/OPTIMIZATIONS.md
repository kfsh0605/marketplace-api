# Оптимізація запитів: EXPLAIN до/після

Стенд: `orders` — 120 000 рядків, `order_items` — 300 000 рядків, `users` — 5 000, `products` — 300.

## Запит 1: пошук за власником і періодом (`db/queries/q1.sql`)

### До індексів

```
 Gather  (cost=1000.00..4195.01 rows=3 width=30) (actual time=11.746..21.842 rows=6 loops=1)
   Workers Planned: 1
   Workers Launched: 1
   Buffers: shared read=1430
   ->  Parallel Seq Scan on orders  (cost=0.00..3194.71 rows=2 width=30) (actual time=7.785..14.760 rows=3 loops=2)
         Filter: ((user_id = 2500) AND (created_at <= now()) AND (created_at >= (now() - '90 days'::interval)))
         Rows Removed by Filter: 59997
         Buffers: shared read=1430
 Planning:
   Buffers: shared hit=60 read=23 dirtied=5
 Planning Time: 6.050 ms
 Execution Time: 21.957 ms
```

### Після індексів (`idx_orders_user_created`)

```
 Bitmap Heap Scan on orders  (cost=4.46..16.13 rows=3 width=30) (actual time=0.058..0.076 rows=6 loops=1)
   Recheck Cond: ((user_id = 2500) AND (created_at >= (now() - '90 days'::interval)) AND (created_at <= now()))
   Heap Blocks: exact=6
   Buffers: shared hit=9 read=3
   ->  Bitmap Index Scan on idx_orders_user_created  (cost=0.00..4.46 rows=3 width=0) (actual time=0.046..0.046 rows=6 loops=1)
         Index Cond: ((user_id = 2500) AND (created_at >= (now() - '90 days'::interval)) AND (created_at <= now()))
         Buffers: shared hit=3 read=3
 Planning:
   Buffers: shared hit=139 read=4
 Planning Time: 1.127 ms
 Execution Time: 0.127 ms
```

**Що змінилось і чому:** `Parallel Seq Scan` (читання всіх 1430 сторінок таблиці двома процесами) замінився на `Bitmap Index Scan` по складеному індексу `(user_id, created_at)` — індекс одразу знаходить лише сторінки з потрібним `user_id`, а всередині них — потрібний діапазон дат, тому замість 1430 сторінок читається лише 12.

## Запит 2: фільтр за статусом (`db/queries/q2.sql`)

### До індексів

```
 Seq Scan on orders  (cost=0.00..2930.00 rows=9360 width=30) (actual time=0.014..12.104 rows=9505 loops=1)
   Filter: (status = 'pending'::text)
   Rows Removed by Filter: 110495
   Buffers: shared hit=1430
 Planning:
   Buffers: shared hit=70 read=2
 Planning Time: 0.822 ms
 Execution Time: 12.502 ms
```

### Після індексів (`idx_orders_pending`, partial)

```
 Bitmap Heap Scan on orders  (cost=160.12..1704.02 rows=9112 width=30) (actual time=0.643..3.020 rows=9505 loops=1)
   Recheck Cond: (status = 'pending'::text)
   Heap Blocks: exact=1427
   Buffers: shared hit=1427 read=27
   ->  Bitmap Index Scan on idx_orders_pending  (cost=0.00..157.84 rows=9112 width=0) (actual time=0.522..0.522 rows=9505 loops=1)
         Buffers: shared read=27
 Planning:
   Buffers: shared hit=129
 Planning Time: 0.767 ms
 Execution Time: 3.441 ms
```

**Що змінилось і чому:** `Seq Scan` замінився на `Bitmap Index Scan` по partial-індексу, що містить лише рядки зі статусом `pending` — час виконання впав з 12.5 до 3.4 мс, хоча кількість прочитаних сторінок самої таблиці майже не змінилась (1427 замість 1430), бо ці ~8% рядків розкидані по всій таблиці, а не лежать компактно.

## Запит 3: пошук без урахування регістру (`db/queries/q3.sql`)

### До індексів

```
 Seq Scan on orders  (cost=0.00..3230.00 rows=600 width=30) (actual time=1.581..36.036 rows=31 loops=1)
   Filter: (lower(customer_email) = 'user2500@example.com'::text)
   Rows Removed by Filter: 119969
   Buffers: shared hit=1430
 Planning:
   Buffers: shared hit=69
 Planning Time: 0.584 ms
 Execution Time: 36.108 ms
```

### Після індексів (`idx_orders_email_lower`, expression)

```
 Bitmap Heap Scan on orders  (cost=4.48..91.51 rows=24 width=30) (actual time=0.103..0.210 rows=31 loops=1)
   Recheck Cond: (lower(customer_email) = 'user2500@example.com'::text)
   Heap Blocks: exact=31
   Buffers: shared hit=31 read=2
   ->  Bitmap Index Scan on idx_orders_email_lower  (cost=0.00..4.47 rows=24 width=0) (actual time=0.091..0.091 rows=31 loops=1)
         Index Cond: (lower(customer_email) = 'user2500@example.com'::text)
         Buffers: shared read=2
 Planning:
   Buffers: shared hit=126
 Planning Time: 0.917 ms
 Execution Time: 0.297 ms
```

**Що змінилось і чому:** `Seq Scan` з викликом `lower()` на кожному з 120 000 рядків замінився на `Bitmap Index Scan` по expression-індексу `lower(customer_email)` — Postgres тепер використовує готовий проіндексований результат функції замість обчислення її наживо для кожного рядка, час виконання впав з 36 до 0.3 мс.
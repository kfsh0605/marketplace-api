import type { DataSource } from 'typeorm';
import { CARD_QUERY_TAG, ProductCard } from './product-card';

const CARD_SQL = `/* ${CARD_QUERY_TAG} */
SELECT p.id, p.name, p."priceCents", p.currency, p.stock,
       s.units_sold, s.revenue_cents, s.orders_count
FROM products p
CROSS JOIN LATERAL (
    SELECT COALESCE(sum(oi.quantity), 0)::int AS units_sold,
           COALESCE(sum(oi.quantity::bigint * oi."priceAtPurchaseCents"), 0)::text AS revenue_cents,
           count(DISTINCT oi."orderId")::int AS orders_count
    FROM order_items oi
    WHERE oi."productId" = p.id
) s
WHERE p.id = $1`;

export class ProductCardRepository {
    constructor(private readonly dataSource: DataSource) {}

    async loadCard(productId: number): Promise<ProductCard | null> {
        const rows = await this.dataSource.query(CARD_SQL, [productId]);
        if (rows.length === 0) {
            return null;
        }
        const row = rows[0];
        return {
            id: String(row.id),
            name: row.name,
            priceCents: row.priceCents,
            currency: row.currency,
            stock: row.stock,
            unitsSold: row.units_sold,
            revenueCents: Number(row.revenue_cents),
            ordersCount: row.orders_count,
        };
    }
}
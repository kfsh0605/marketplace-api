import 'reflect-metadata';
import { AppDataSource } from './data-source';
import { OrderItem } from './entities/order-item.entity';

async function main() {
    await AppDataSource.initialize();

    const rows = await AppDataSource.getRepository(OrderItem)
        .createQueryBuilder('item')
        .innerJoin('item.product', 'product')
        .select('product.id', 'productId')
        .addSelect('product.name', 'productName')
        .addSelect('SUM(item.quantity)', 'totalQuantity')
        .addSelect('SUM(item.quantity * item.priceAtPurchaseCents)', 'totalRevenueCents')
        .groupBy('product.id')
        .addGroupBy('product.name')
        .orderBy('"totalRevenueCents"', 'DESC')
        .getRawMany<{
            productId: number;
            productName: string;
            totalQuantity: string;
            totalRevenueCents: string;
        }>();

    console.log('Топ товарів за виторгом:\n');
    for (const row of rows) {
        const quantity = Number(row.totalQuantity);
        const revenue = Number(row.totalRevenueCents) / 100;
        console.log(
            `  ${row.productName.padEnd(28)} продано: ${String(quantity).padStart(3)} шт.  виторг: ${revenue.toFixed(2)} UAH`,
        );
    }

    await AppDataSource.destroy();
}

main().catch((error) => {
    console.error('Report failed:', error);
    process.exit(1);
});
import 'reflect-metadata';
import { DataSource, Logger } from 'typeorm';
import { User } from './entities/user.entity';
import { Product } from './entities/product.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';

class CountingLogger implements Logger {
    count = 0;
    verbose = false;

    logQuery(query: string): void {
        this.count += 1;
        if (this.verbose) {
            console.log(`  [${this.count}] ${query}`);
        }
    }
    logQueryError(): void {}
    logQuerySlow(): void {}
    logSchemaBuild(): void {}
    logMigration(): void {}
    log(): void {}
}

async function main() {
    const logger = new CountingLogger();

    const dataSource = new DataSource({
        type: 'postgres',
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT ?? 5432),
        username: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        entities: [User, Product, Order, OrderItem],
        synchronize: false,
        logger,
    });

    await dataSource.initialize();

    const orderRepo = dataSource.getRepository(Order);
    const itemRepo = dataSource.getRepository(OrderItem);

    // 1. Наивный подход
    logger.count = 0;
    logger.verbose = false;
    const naiveOrders = await orderRepo.find();
    for (const order of naiveOrders) {
        const items = await itemRepo.find({ where: { order: { id: order.id } } });
        for (const item of items) {
            await itemRepo.findOne({ where: { id: item.id }, relations: ['product'] });
        }
    }
    logger.verbose = false;
    console.log(`1) Наивный подход (N+1+M):        ${logger.count} запрос(ов) — заказов: ${naiveOrders.length}`);

    // 2. find() + relations (join)
    logger.count = 0;
    await orderRepo.find({ relations: { items: { product: true } } });
    console.log(`2) find() + relations (join):     ${logger.count} запрос(ов)`);

    // 3. leftJoinAndSelect
    logger.count = 0;
    await orderRepo
        .createQueryBuilder('order')
        .leftJoinAndSelect('order.items', 'items')
        .leftJoinAndSelect('items.product', 'product')
        .getMany();
    console.log(`3) leftJoinAndSelect:              ${logger.count} запрос(ов)`);

    // 4. relationLoadStrategy: 'query'
    logger.count = 0;
    logger.verbose = false;
    await orderRepo.find({
        relations: { items: { product: true } },
        relationLoadStrategy: 'query',
    });
    logger.verbose = false;
    console.log(`4) relationLoadStrategy:'query':   ${logger.count} запрос(ов)`);

    await dataSource.destroy();
}

main().catch((error) => {
    console.error('Demo failed:', error);
    process.exit(1);
});
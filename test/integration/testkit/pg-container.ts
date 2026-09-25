import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { User } from '../../../src/entities/user.entity';
import { Product } from '../../../src/entities/product.entity';
import { Order } from '../../../src/entities/order.entity';
import { OrderItem } from '../../../src/entities/order-item.entity';
import { PostProcessingJob } from '../../../src/entities/post-processing-job.entity';
import { Init1788985076642 } from '../../../src/migrations/1788985076642-Init';
import { AddProductsNameUnique1789030528991 } from '../../../src/migrations/1789030528991-AddProductsNameUnique';
import { OrdersOrderItemsIndexes1789420020545 } from '../../../src/migrations/1789420020545-OrdersOrderItemsIndexes';
import { CheckoutSchema1789593338925 } from '../../../src/migrations/1789593338925-CheckoutSchema';

export interface PgHandle {
    container: StartedPostgreSqlContainer;
    dataSource: DataSource;
    startupMs: number;
    stop(): Promise<void>;
}

export async function startPg(label = ''): Promise<PgHandle> {
    const t0 = Date.now();
    const container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const startupMs = Date.now() - t0;

    const dataSource = new DataSource({
        type: 'postgres',
        url: container.getConnectionUri(),
        entities: [User, Product, Order, OrderItem, PostProcessingJob],
        migrations: [
            Init1788985076642,
            AddProductsNameUnique1789030528991,
            OrdersOrderItemsIndexes1789420020545,
            CheckoutSchema1789593338925,
        ],
        synchronize: false,
    });

    await dataSource.initialize();
    await dataSource.runMigrations();

    console.log(`[testkit] postgres:16-alpine (${label}) готовий за ${startupMs} ms`);

    return {
        container,
        dataSource,
        startupMs,
        async stop() {
            await dataSource.destroy();
            await container.stop();
        },
    };
}
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import type { AppModule as AppModuleType } from '../../../src/app.module';
import { configureApp } from '../../../src/configure-app';
import { generateKeyPairSync } from 'node:crypto'
import { User } from '../../../src/entities/user.entity';
import { Product } from '../../../src/entities/product.entity';
import { Order } from '../../../src/entities/order.entity';
import { OrderItem } from '../../../src/entities/order-item.entity';
import { PostProcessingJob } from '../../../src/entities/post-processing-job.entity';
import { Init1788985076642 } from '../../../src/migrations/1788985076642-Init';
import { AddProductsNameUnique1789030528991 } from '../../../src/migrations/1789030528991-AddProductsNameUnique';
import { OrdersOrderItemsIndexes1789420020545 } from '../../../src/migrations/1789420020545-OrdersOrderItemsIndexes';
import { CheckoutSchema1789593338925 } from '../../../src/migrations/1789593338925-CheckoutSchema';
import { OutboxAndProcessedMessages1791300000000 } from '../../../src/migrations/1791300000000-OutboxAndProcessedMessages';
import { IdempotencyKeys1791400000000 } from '../../../src/migrations/1791400000000-IdempotencyKeys';
import { AuthTables1793000000000 } from '../../../src/migrations/1793000000000-AuthTables';

function setAuthEnv(): void {
    const { privateKey, publicKey } = generateKeyPairSync('ec', {
        namedCurve: 'P-256',
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    process.env.JWT_KID = 'e2e';
    process.env.JWT_PRIVATE_KEY = Buffer.from(privateKey).toString('base64');
    process.env.JWT_PUBLIC_KEY = Buffer.from(publicKey).toString('base64');
    process.env.REFRESH_TOKEN_PEPPER = 'e2e-pepper-'.repeat(4);
}

export interface E2eApp {
    app: INestApplication;
    container: StartedPostgreSqlContainer;
    dataSource: DataSource;
    close(): Promise<void>;
}

export async function bootstrapE2eApp(): Promise<E2eApp> {
    const container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const uri = container.getConnectionUri();

    const migrationDataSource = new DataSource({
        type: 'postgres',
        url: uri,
        entities: [User, Product, Order, OrderItem, PostProcessingJob],
        migrations: [
            Init1788985076642,
            AddProductsNameUnique1789030528991,
            OrdersOrderItemsIndexes1789420020545,
            CheckoutSchema1789593338925,
            OutboxAndProcessedMessages1791300000000,
            IdempotencyKeys1791400000000,
            AuthTables1793000000000,
        ],
        synchronize: false,
    });
    await migrationDataSource.initialize();
    await migrationDataSource.runMigrations();

    process.env.DATABASE_URL = uri;
    process.env.DB_HOST = 'e2e-placeholder';
    process.env.DB_USER = 'e2e-placeholder';
    process.env.DB_NAME = 'e2e-placeholder';
    process.env.RABBITMQ_DISABLED = '1';
    process.env.REDIS_DISABLED = '1';
    setAuthEnv();
    const { AppModule } = require('../../../src/app.module') as { AppModule: typeof AppModuleType };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    return {
        app,
        container,
        dataSource: migrationDataSource,
        async close() {
            await app.close();
            await migrationDataSource.destroy();
            await container.stop();
            delete process.env.DATABASE_URL;
            delete process.env.DB_HOST;
            delete process.env.DB_USER;
            delete process.env.DB_NAME;
            delete process.env.RABBITMQ_DISABLED;
            delete process.env.REDIS_DISABLED;
            delete process.env.JWT_KID;
            delete process.env.JWT_PRIVATE_KEY;
            delete process.env.JWT_PUBLIC_KEY;
            delete process.env.REFRESH_TOKEN_PEPPER;
        },
    };
}
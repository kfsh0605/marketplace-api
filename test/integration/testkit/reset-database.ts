import { DataSource } from 'typeorm';

export async function resetDatabase(dataSource: DataSource): Promise<void> {
    await dataSource.query(
        'TRUNCATE TABLE post_processing_jobs, order_items, orders, products, users RESTART IDENTITY CASCADE',
    );
}
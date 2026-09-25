import { DataSource } from 'typeorm';
import { PgHandle, startPg } from './testkit/pg-container';
import { resetDatabase } from './testkit/reset-database';
import { insertProduct } from './testkit/builders';
import { Product } from '../../src/entities/product.entity';

describe('ProductsRepository (Postgres, testcontainers)', () => {
    let pg: PgHandle;
    let dataSource: DataSource;

    beforeAll(async () => {
        pg = await startPg('products');
        dataSource = pg.dataSource;
    }, 60_000);

    afterEach(async () => {
        await resetDatabase(dataSource);
    });

    afterAll(async () => {
        await pg.stop();
    });

    it('зберігає товар і читає його назад', async () => {
        const saved = await insertProduct(dataSource, { name: 'Клавіатура тестова' });
        const found = await dataSource.getRepository(Product).findOneBy({ id: saved.id });
        expect(found?.name).toBe('Клавіатура тестова');
    });

    it('віддає точні priceCents і stock, а не приблизні значення', async () => {
        const saved = await insertProduct(dataSource, { priceCents: 123456, stock: 7 });
        const found = await dataSource.getRepository(Product).findOneByOrFail({ id: saved.id });
        expect(found.priceCents).toBe(123456);
        expect(found.stock).toBe(7);
    });

    it('не дає створити два товари з однаковою назвою (UNIQUE constraint)', async () => {
        await insertProduct(dataSource, { name: 'Дублікат' });
        await expect(insertProduct(dataSource, { name: 'Дублікат' })).rejects.toThrow(
            /duplicate key value violates unique constraint/,
        );
    });
});
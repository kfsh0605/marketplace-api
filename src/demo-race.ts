import 'reflect-metadata';
import { AppDataSource } from './data-source';
import { Product } from './entities/product.entity';
import { User } from './entities/user.entity';
import { checkout, InsufficientStockError, InsufficientFundsError } from './checkout';

const ATTEMPTS = 50;
const PRODUCT_NAME = 'DEMO_RACE_PRODUCT';
const INITIAL_STOCK = 10;
const BUYER_EMAIL = 'demo-race@example.com';

async function main() {
    await AppDataSource.initialize();

    const productRepo = AppDataSource.getRepository(Product);
    const userRepo = AppDataSource.getRepository(User);

    // свій, детермінований сценарій — не покладаємось на загальний seed.ts
    await productRepo.upsert(
        { name: PRODUCT_NAME, priceCents: 10000, currency: 'UAH', stock: INITIAL_STOCK },
        ['name'],
    );
    await userRepo.upsert(
        { email: BUYER_EMAIL, name: 'Demo Race Buyer', balanceCents: 100_000_000 },
        ['email'],
    );

    const product = await productRepo.findOneByOrFail({ name: PRODUCT_NAME });
    const buyer = await userRepo.findOneByOrFail({ email: BUYER_EMAIL });

    console.log(`Стартовий stock товару "${PRODUCT_NAME}": ${product.stock}`);
    console.log(`Стріляємо ${ATTEMPTS} паралельними checkout()...`);

    const results = await Promise.all(
        Array.from({ length: ATTEMPTS }, () =>
            checkout(buyer.id, product.id, 1)
                .then(() => ({ ok: true as const, expected: false, error: null as unknown }))
                .catch((err) => ({
                    ok: false as const,
                    expected: err instanceof InsufficientStockError || err instanceof InsufficientFundsError,
                    error: err,
                })),
        ),
    );

    const successful = results.filter((r) => r.ok).length;
    const unexpected = results.filter((r) => !r.ok && !r.expected);

    const finalProduct = await productRepo.findOneByOrFail({ name: PRODUCT_NAME });
    const negativeStockRows = await productRepo
        .createQueryBuilder('p')
        .where('p.stock < 0')
        .getCount();

    console.log(`Спроб: ${ATTEMPTS}`);
    console.log(`Успішних: ${successful}`);
    console.log(`Фінальний stock: ${finalProduct.stock}`);
    console.log(`Рядків із від'ємним stock: ${negativeStockRows}`);
    if (unexpected.length > 0) {
        console.error(`Неочікувані помилки (${unexpected.length}):`, unexpected[0].error);
    }

    await AppDataSource.destroy();

    const invariantOk =
        successful === INITIAL_STOCK && finalProduct.stock === 0 &&
        negativeStockRows === 0 && unexpected.length === 0;

    if (!invariantOk) {
        console.error('ІНВАРІАНТ ПОРУШЕНО — oversell або неочікувана помилка.');
        process.exit(1);
    }
    console.log('OK: інваріант дотримано, oversell не стався.');
    process.exit(0);
}

main().catch((err) => {
    console.error('demo:race failed:', err);
    process.exit(1);
});
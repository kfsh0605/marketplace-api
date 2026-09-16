import 'reflect-metadata';
import { AppDataSource } from './data-source';
import { User } from './entities/user.entity';
import { Product } from './entities/product.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';

async function seed() {
    await AppDataSource.initialize();

    const userRepo = AppDataSource.getRepository(User);
    const productRepo = AppDataSource.getRepository(Product);
    const orderRepo = AppDataSource.getRepository(Order);
    const orderItemRepo = AppDataSource.getRepository(OrderItem);

    console.log('Seeding users...');
    const usersData = [
        { email: 'olena.kravchenko@example.com', name: 'Олена Кравченко' },
        { email: 'ivan.petrenko@example.com', name: 'Іван Петренко' },
        { email: 'maria.bondar@example.com', name: 'Марія Бондар' },
        { email: 'andriy.tkachenko@example.com', name: 'Андрій Ткаченко' },
        { email: 'natalia.moroz@example.com', name: 'Наталія Мороз' },
        { email: 'dmytro.shevchenko@example.com', name: 'Дмитро Шевченко' },
    ];
    await userRepo.upsert(usersData, ['email']);
    const users = await userRepo.find({ order: { id: 'ASC' } });

    console.log('Seeding products...');
    const productsData = [
        { name: 'Механічна клавіатура', priceCents: 249900, currency: 'UAH' },
        { name: 'Бездротова миша', priceCents: 89900, currency: 'UAH' },
        { name: 'Монітор 27"', priceCents: 899900, currency: 'UAH' },
        { name: 'USB-C хаб', priceCents: 64900, currency: 'UAH' },
        { name: 'Веб-камера Full HD', priceCents: 129900, currency: 'UAH' },
        { name: 'Навушники з мікрофоном', priceCents: 159900, currency: 'UAH' },
        { name: 'Зовнішній SSD 1TB', priceCents: 249900, currency: 'UAH' },
        { name: 'Портативна колонка', priceCents: 99900, currency: 'UAH' },
    ];
    await productRepo.upsert(productsData, ['name']);
    const products = await productRepo.find({ order: { id: 'ASC' } });

    const existingOrdersCount = await orderRepo.count();
    if (existingOrdersCount > 0) {
        console.log(
            `Orders already seeded (${existingOrdersCount} found), skipping orders/order_items.`,
        );
    } else {
        console.log('Seeding orders and order_items...');
        const statuses = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];

        for (let i = 0; i < 10; i++) {
            const user = users[i % users.length];
            const status = statuses[i % statuses.length];

            const itemsCount = (i % 3) + 1; // от 1 до 3 позиций в заказе
            const itemsSpecs = Array.from({ length: itemsCount }, (_, j) => {
                const product = products[(i + j) % products.length];
                const quantity = ((i + j) % 3) + 1; // от 1 до 3 штук
                return { product, quantity };
            });

            const totalCents = itemsSpecs.reduce(
                (sum, spec) => sum + spec.product.priceCents * spec.quantity,
                0,
            );

            const order = await orderRepo.save(
                orderRepo.create({
                    user,
                    customerEmail: user.email,
                    status,
                    totalCents,
                    currency: 'UAH',
                }),
            );

            const orderItems = itemsSpecs.map((spec) =>
                orderItemRepo.create({
                    order,
                    product: spec.product,
                    quantity: spec.quantity,
                    priceAtPurchaseCents: spec.product.priceCents,
                }),
            );
            await orderItemRepo.save(orderItems);
        }
        console.log('Orders and order_items seeded.');
    }

    console.log('Seeding finished.');
    await AppDataSource.destroy();
}

seed().catch((error) => {
    console.error('Seeding failed:', error);
    process.exit(1);
});
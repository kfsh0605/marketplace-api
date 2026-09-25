import { DataSource } from 'typeorm';
import { Product } from '../../../src/entities/product.entity';
import { User } from '../../../src/entities/user.entity';

let productCounter = 0;
let userCounter = 0;

export function aProduct(overrides: Partial<Product> = {}): Partial<Product> {
    productCounter += 1;
    return {
        name: `product-${productCounter}`,
        priceCents: 10000,
        stock: 10,
        currency: 'UAH',
        ...overrides,
    };
}

export function aUser(overrides: Partial<User> = {}): Partial<User> {
    userCounter += 1;
    return {
        email: `user-${userCounter}@example.com`,
        name: `User ${userCounter}`,
        balanceCents: 100000,
        ...overrides,
    };
}

export async function insertProduct(dataSource: DataSource, overrides: Partial<Product> = {}): Promise<Product> {
    const repo = dataSource.getRepository(Product);
    return repo.save(repo.create(aProduct(overrides)));
}

export async function insertUser(dataSource: DataSource, overrides: Partial<User> = {}): Promise<User> {
    const repo = dataSource.getRepository(User);
    return repo.save(repo.create(aUser(overrides)));
}
import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { OrderItem } from './order-item.entity';

@Entity('products')
export class Product {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ unique: true })
    name: string;

    @Column({ type: 'int' })
    priceCents: number;

    @Column({ type: 'int', default: 0 })
    stock: number;

    @Column({ default: 'UAH' })
    currency: string;

    @Column({ type: 'timestamptz', default: () => 'now()' })
    createdAt: Date;

    @OneToMany(() => OrderItem, (item) => item.product)
    orderItems: OrderItem[];
}
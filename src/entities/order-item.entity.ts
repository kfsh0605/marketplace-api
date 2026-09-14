import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Order } from './order.entity';
import { Product } from './product.entity';

@Entity('order_items')
export class OrderItem {
    @PrimaryGeneratedColumn()
    id: number;

    @Index()
    @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'orderId' })
    order: Order;

    @Index()
    @ManyToOne(() => Product, (product) => product.orderItems, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'productId' })
    product: Product;

    @Column({ type: 'int' })
    quantity: number;

    @Column({ type: 'int' })
    priceAtPurchaseCents: number;
}
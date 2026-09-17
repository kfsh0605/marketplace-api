import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { Order } from './order.entity';

@Entity('users')
export class User {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ unique: true })
    email: string;

    @Column()
    name: string;

    @Column({ type: 'int', default: 0 })
    balanceCents: number;

    @Column({ type: 'timestamptz', default: () => 'now()' })
    createdAt: Date;

    @OneToMany(() => Order, (order) => order.user)
    orders: Order[];
}
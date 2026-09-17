import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Order } from './order.entity';

@Entity('post_processing_jobs')
export class PostProcessingJob {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => Order, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'orderId' })
    order: Order;

    @Column({ default: 'new' })
    status: string;

    @Column({ nullable: true })
    worker: string;

    @Column({ type: 'int', default: 0 })
    processed: number;

    @Column({ type: 'timestamptz', default: () => 'now()' })
    createdAt: Date;
}
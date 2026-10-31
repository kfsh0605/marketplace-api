import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type FileStatus = 'PENDING' | 'COMPLETED';

const bigintAsNumber = {
    to: (value: number | null): number | null => value,
    from: (value: string | null): number | null => (value === null ? null : Number(value)),
};

@Entity('files')
export class StoredFile {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'text', unique: true })
    key: string;

    @Column({ name: 'owner_id', type: 'int' })
    ownerId: number;

    @Column({ type: 'text', default: 'PENDING' })
    status: FileStatus;

    @Column({ name: 'content_type', type: 'text' })
    contentType: string;

    @Column({ type: 'bigint', nullable: true, transformer: bigintAsNumber })
    size: number | null;

    @Column({ name: 'upload_id', type: 'text', nullable: true })
    uploadId: string | null;

    @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
    createdAt: Date;

    @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
    completedAt: Date | null;
}
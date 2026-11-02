import { MigrationInterface, QueryRunner } from 'typeorm';

export class FilesTable1794000000000 implements MigrationInterface {
    name = 'FilesTable1794000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "files" (
                "id"           uuid        NOT NULL DEFAULT gen_random_uuid(),
                "key"          text        NOT NULL,
                "owner_id"     integer     NOT NULL,
                "status"       text        NOT NULL DEFAULT 'PENDING',
                "content_type" text        NOT NULL,
                "size"         bigint,
                "upload_id"    text,
                "created_at"   timestamptz NOT NULL DEFAULT now(),
                "completed_at" timestamptz,
                CONSTRAINT "PK_files" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_files_key" UNIQUE ("key"),
                CONSTRAINT "CHK_files_status" CHECK ("status" IN ('PENDING', 'COMPLETED')),
                CONSTRAINT "CHK_files_size" CHECK ("size" IS NULL OR "size" >= 0),
                CONSTRAINT "CHK_files_completed" CHECK ("status" = 'PENDING' OR "completed_at" IS NOT NULL),
                CONSTRAINT "FK_files_owner" FOREIGN KEY ("owner_id")
                    REFERENCES "users"("id") ON DELETE CASCADE
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_files_owner" ON "files" ("owner_id")`);
        await queryRunner.query(
            `CREATE INDEX "IDX_files_pending_created" ON "files" ("created_at") WHERE "status" = 'PENDING'`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "files"`);
    }
}
import { MigrationInterface, QueryRunner } from "typeorm";

export class AuthTables1793000000000 implements MigrationInterface {
    name = 'AuthTables1793000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "passwordHash" text`);
        await queryRunner.query(`ALTER TABLE "users" ADD "role" character varying NOT NULL DEFAULT 'customer'`);
        await queryRunner.query(
            `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_role" CHECK ("role" IN ('customer', 'seller', 'admin'))`,
        );

        await queryRunner.query(`
            CREATE TABLE "refresh_tokens" (
                "id"                uuid        NOT NULL DEFAULT gen_random_uuid(),
                "user_id"           integer     NOT NULL,
                "family_id"         uuid        NOT NULL,
                "token_hash"        text        NOT NULL,
                "created_at"        timestamptz NOT NULL DEFAULT now(),
                "used_at"           timestamptz,
                "revoked_at"        timestamptz,
                "expires_at"        timestamptz NOT NULL,
                "family_started_at" timestamptz NOT NULL,
                CONSTRAINT "PK_refresh_tokens" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_refresh_tokens_token_hash" UNIQUE ("token_hash"),
                CONSTRAINT "FK_refresh_tokens_user" FOREIGN KEY ("user_id")
                    REFERENCES "users"("id") ON DELETE CASCADE
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_refresh_tokens_family" ON "refresh_tokens" ("family_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_refresh_tokens_user" ON "refresh_tokens" ("user_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "refresh_tokens"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "CHK_users_role"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "role"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "passwordHash"`);
    }
}
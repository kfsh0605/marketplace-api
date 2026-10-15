import { MigrationInterface, QueryRunner } from "typeorm";

export class IdempotencyKeys1791400000000 implements MigrationInterface {
    name = 'IdempotencyKeys1791400000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // "Гардероб": номерок (ключ) -> какой заказ ему соответствует.
        // PRIMARY KEY - это и есть механика: два запроса с одним ключом физически не могут оба вставить строку.
        // order_id заполняется в той же транзакции, что и сам заказ; ON DELETE CASCADE: нет заказа - нет номерка.
        await queryRunner.query(`
            CREATE TABLE "idempotency_keys" (
                "idempotency_key" text        NOT NULL,
                "request_hash"    text        NOT NULL,
                "order_id"        integer,
                "created_at"      timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "PK_idempotency_keys" PRIMARY KEY ("idempotency_key"),
                CONSTRAINT "FK_idempotency_keys_order" FOREIGN KEY ("order_id")
                    REFERENCES "orders"("id") ON DELETE CASCADE
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "idempotency_keys"`);
    }
}
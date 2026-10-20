import { MigrationInterface, QueryRunner } from "typeorm";

export class OutboxAndProcessedMessages1791300000000 implements MigrationInterface {
    name = 'OutboxAndProcessedMessages1791300000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // "Ящик исходящих": строка = конверт, который ещё надо отнести брокеру.
        // published_at IS NULL = ещё не отправлено.
        await queryRunner.query(`
            CREATE TABLE "outbox" (
                "id"             uuid         NOT NULL DEFAULT gen_random_uuid(),
                "aggregate_type" text         NOT NULL,
                "aggregate_id"   text         NOT NULL,
                "type"           text         NOT NULL,
                "payload"        jsonb        NOT NULL,
                "created_at"     timestamptz  NOT NULL DEFAULT now(),
                "published_at"   timestamptz,
                "attempts"       integer      NOT NULL DEFAULT 0,
                CONSTRAINT "PK_outbox" PRIMARY KEY ("id")
            )
        `);

        // Частичный индекс: в нём только "хвост" неотправленных. Таблица растёт, индекс остаётся маленьким.
        await queryRunner.query(`
            CREATE INDEX "outbox_unpublished_idx" ON "outbox" ("created_at") WHERE "published_at" IS NULL
        `);

        // "Список номеров принятых конвертов" для консьюмера.
        // PK (message_id, consumer): один и тот же консьюмер не примет одно сообщение дважды.
        await queryRunner.query(`
            CREATE TABLE "processed_messages" (
                "message_id"   text         NOT NULL,
                "consumer"     text         NOT NULL,
                "processed_at" timestamptz  NOT NULL DEFAULT now(),
                CONSTRAINT "PK_processed_messages" PRIMARY KEY ("message_id", "consumer")
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "processed_messages"`);
        await queryRunner.query(`DROP INDEX "outbox_unpublished_idx"`);
        await queryRunner.query(`DROP TABLE "outbox"`);
    }
}
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Леджер подій платіжного вебхука.
 * - UNIQUE (event_id): повторна доставка тієї самої події не дає другого ефекту;
 * - рядки лише додаються: UPDATE заборонено тригером (видалення можливе лише каскадом разом із замовленням).
 */
export class PaymentEvents1795000000000 implements MigrationInterface {
    name = 'PaymentEvents1795000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "payment_events" (
                "id"           bigserial   NOT NULL,
                "event_id"     text        NOT NULL,
                "order_id"     integer     NOT NULL,
                "amount_cents" integer     NOT NULL,
                "currency"     text        NOT NULL,
                "outcome"      text        NOT NULL,
                "received_at"  timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "PK_payment_events" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_payment_events_event_id" UNIQUE ("event_id"),
                CONSTRAINT "CHK_payment_events_outcome" CHECK ("outcome" IN ('applied', 'amount_mismatch', 'not_payable')),
                CONSTRAINT "FK_payment_events_order" FOREIGN KEY ("order_id")
                    REFERENCES "orders"("id") ON DELETE CASCADE
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_payment_events_order" ON "payment_events" ("order_id")`);
        await queryRunner.query(`
            CREATE FUNCTION "payment_events_no_update"() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                RAISE EXCEPTION 'payment_events is append-only';
            END
            $$
        `);
        await queryRunner.query(`
            CREATE TRIGGER "trg_payment_events_no_update" BEFORE UPDATE ON "payment_events"
            FOR EACH ROW EXECUTE FUNCTION "payment_events_no_update"()
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "payment_events"`);
        await queryRunner.query(`DROP FUNCTION "payment_events_no_update"()`);
    }
}

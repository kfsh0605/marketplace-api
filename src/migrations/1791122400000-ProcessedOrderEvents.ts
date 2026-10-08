import { MigrationInterface, QueryRunner } from "typeorm";

export class ProcessedOrderEvents1791122400000 implements MigrationInterface {
    name = 'ProcessedOrderEvents1791122400000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // "Журнал чеків": eventId — природний ключ події, PK гарантує,
        // що один і той самий eventId фізично не можна записати двічі.
        // Навмисно без FK на orders: demo-скрипти публікують синтетичні події.
        await queryRunner.query(`CREATE TABLE "processed_order_events" ("eventId" character varying(200) NOT NULL, "orderId" integer NOT NULL, "processedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_processed_order_events" PRIMARY KEY ("eventId"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "processed_order_events"`);
    }

}
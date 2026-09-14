import { MigrationInterface, QueryRunner } from "typeorm";

export class OrdersOrderItemsIndexes1789420020545 implements MigrationInterface {
    name = 'OrdersOrderItemsIndexes1789420020545'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_775c9f06fc27ae3ff8fb26f2c4"`);
        await queryRunner.query(`CREATE INDEX "IDX_f1d359a55923bb45b057fbdab0" ON "order_items" ("orderId") `);
        await queryRunner.query(`CREATE INDEX "IDX_cdb99c05982d5191ac8465ac01" ON "order_items" ("productId") `);
        await queryRunner.query(`CREATE INDEX "IDX_orders_pending_created" ON "orders" ("createdAt") WHERE status = 'pending'`);
        await queryRunner.query(`CREATE INDEX "IDX_30e6836e8539f85bfc47198067" ON "orders" ("userId", "createdAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_orders_customer_email_lower" ON "orders" (lower("customerEmail"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_orders_customer_email_lower"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_30e6836e8539f85bfc47198067"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_orders_pending_created"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cdb99c05982d5191ac8465ac01"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f1d359a55923bb45b057fbdab0"`);
        await queryRunner.query(`CREATE INDEX "IDX_775c9f06fc27ae3ff8fb26f2c4" ON "orders" ("status") `);
    }

}

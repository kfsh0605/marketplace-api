import { MigrationInterface, QueryRunner } from "typeorm";

export class CheckoutSchema1789593338925 implements MigrationInterface {
    name = 'CheckoutSchema1789593338925'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "post_processing_jobs" ("id" SERIAL NOT NULL, "status" character varying NOT NULL DEFAULT 'new', "worker" character varying, "processed" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "orderId" integer, CONSTRAINT "PK_cb038c5440f3c6c398611aff891" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "products" ADD "stock" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "users" ADD "balanceCents" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "post_processing_jobs" ADD CONSTRAINT "FK_e3025cb57d8ca6cd5c62dd51097" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "post_processing_jobs" DROP CONSTRAINT "FK_e3025cb57d8ca6cd5c62dd51097"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "balanceCents"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "stock"`);
        await queryRunner.query(`DROP TABLE "post_processing_jobs"`);
    }

}

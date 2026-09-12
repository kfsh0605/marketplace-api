import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProductsNameUnique1789030528991 implements MigrationInterface {
    name = 'AddProductsNameUnique1789030528991'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "UQ_4c9fb58de893725258746385e16" UNIQUE ("name")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "UQ_4c9fb58de893725258746385e16"`);
    }

}

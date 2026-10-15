import type { MigrationInterface, QueryRunner } from 'typeorm';

export class DiscountRequestCustomer1793000000000 implements MigrationInterface {
  name = 'DiscountRequestCustomer1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "discount_requests" ADD "patient_id" uuid`);
    await queryRunner.query(`ALTER TABLE "discount_requests" ADD "customer_name" character varying(200)`);
    await queryRunner.query(
      `ALTER TABLE "discount_requests" ADD CONSTRAINT "FK_discount_requests_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_discount_requests_patient" ON "discount_requests" ("patient_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_discount_requests_patient"`);
    await queryRunner.query(`ALTER TABLE "discount_requests" DROP CONSTRAINT "FK_discount_requests_patient"`);
    await queryRunner.query(`ALTER TABLE "discount_requests" DROP COLUMN "customer_name"`);
    await queryRunner.query(`ALTER TABLE "discount_requests" DROP COLUMN "patient_id"`);
  }
}

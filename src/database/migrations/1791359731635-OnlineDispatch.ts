import type { MigrationInterface, QueryRunner } from 'typeorm';

const swapEnum = async (queryRunner: QueryRunner, values: string[]) => {
  await queryRunner.query(
    `CREATE TYPE "public"."sale_delivery_status_next" AS ENUM(${values.map((v) => `'${v}'`).join(', ')})`,
  );
  await queryRunner.query(
    `ALTER TABLE "sales" ALTER COLUMN "delivery_status" TYPE "public"."sale_delivery_status_next" USING "delivery_status"::"text"::"public"."sale_delivery_status_next"`,
  );
  await queryRunner.query(`DROP TYPE "public"."sale_delivery_status"`);
  await queryRunner.query(`ALTER TYPE "public"."sale_delivery_status_next" RENAME TO "sale_delivery_status"`);
};

export class OnlineDispatch1791359731635 implements MigrationInterface {
  name = 'OnlineDispatch1791359731635';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sales" ADD "dispatched_on" date`);
    await queryRunner.query(`ALTER TABLE "sales" ADD "dispatched_by" uuid`);
    await queryRunner.query(`ALTER TABLE "sales" ADD "delivered_on" date`);
    await swapEnum(queryRunner, ['pending', 'dispatched', 'delivered', 'returned', 'cancelled']);
    await queryRunner.query(`CREATE INDEX "IDX_29f3502779722bd5807f07a46b" ON "sales"  ("dispatched_on") `);
    await queryRunner.query(
      `UPDATE "sales" SET "delivery_status" = 'dispatched' WHERE "sale_type" = 'online' AND "delivery_status" = 'pending'`,
    );
    await queryRunner.query(`UPDATE "sales" SET "dispatched_on" = "date" WHERE "sale_type" = 'online'`);
    await queryRunner.query(`UPDATE "sales" SET "delivered_on" = "date" WHERE "delivery_status" = 'delivered'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "sales" SET "delivery_status" = 'pending' WHERE "delivery_status" IN ('dispatched', 'cancelled')`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_29f3502779722bd5807f07a46b"`);
    await swapEnum(queryRunner, ['pending', 'delivered', 'returned']);
    await queryRunner.query(`ALTER TABLE "sales" DROP COLUMN "delivered_on"`);
    await queryRunner.query(`ALTER TABLE "sales" DROP COLUMN "dispatched_by"`);
    await queryRunner.query(`ALTER TABLE "sales" DROP COLUMN "dispatched_on"`);
  }
}

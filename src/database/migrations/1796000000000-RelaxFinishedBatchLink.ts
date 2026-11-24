import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RelaxFinishedBatchLink1796000000000 implements MigrationInterface {
  name = 'RelaxFinishedBatchLink1796000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "material_batches" DROP CONSTRAINT "CHK_material_batches_stage_links"`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_batches" ADD CONSTRAINT "CHK_material_batches_stage_links" CHECK (("stage" = 'pharmacy_lab' AND "lab_batch_id" IS NULL AND "product_id" IS NULL) OR ("stage" = 'finished_product'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "material_batches" DROP CONSTRAINT "CHK_material_batches_stage_links"`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_batches" ADD CONSTRAINT "CHK_material_batches_stage_links" CHECK (("stage" = 'pharmacy_lab' AND "lab_batch_id" IS NULL AND "product_id" IS NULL) OR ("stage" = 'finished_product' AND "lab_batch_id" IS NOT NULL))`,
    );
  }
}

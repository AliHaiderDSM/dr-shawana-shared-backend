import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ReturnApproval1792100000000 implements MigrationInterface {
  name = 'ReturnApproval1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sale_return_items" ADD "proposed_disposition" "public"."sale_return_disposition"`,
    );
    await queryRunner.query(`ALTER TABLE "sale_return_items" ADD "proposed_by" uuid`);
    await queryRunner.query(`ALTER TABLE "sale_return_items" ADD "proposed_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "sale_return_items" ADD "proposal_note" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of ['proposal_note', 'proposed_at', 'proposed_by', 'proposed_disposition']) {
      await queryRunner.query(`ALTER TABLE "sale_return_items" DROP COLUMN "${column}"`);
    }
  }
}

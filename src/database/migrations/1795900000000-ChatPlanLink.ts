import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ChatPlanLink1795900000000 implements MigrationInterface {
  name = 'ChatPlanLink1795900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chat_messages" ADD "treatment_plan_id" uuid`);
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_messages_treatment_plan_id" ON "chat_messages" ("treatment_plan_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_messages" ADD CONSTRAINT "FK_chat_messages_treatment_plan" FOREIGN KEY ("treatment_plan_id") REFERENCES "treatment_plans"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chat_messages" DROP CONSTRAINT "FK_chat_messages_treatment_plan"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_chat_messages_treatment_plan_id"`);
    await queryRunner.query(`ALTER TABLE "chat_messages" DROP COLUMN "treatment_plan_id"`);
  }
}

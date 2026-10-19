import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class StaffPushTokens1794000000000 implements MigrationInterface {
  name = 'StaffPushTokens1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "staff_push_tokens" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "staff_id" uuid NOT NULL,
        "token" character varying(255) NOT NULL,
        "platform" character varying(20),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_push_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_staff_push_tokens_token" UNIQUE ("token"),
        CONSTRAINT "FK_staff_push_tokens_staff" FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_staff_push_tokens_staff" ON "staff_push_tokens" ("staff_id")`);
    await queryRunner.query(`ALTER TABLE "staff_push_tokens" ENABLE ROW LEVEL SECURITY`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "staff_push_tokens"`);
  }
}

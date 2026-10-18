import type { MigrationInterface, QueryRunner } from 'typeorm';

export class StaffPushSubscriptions1793300000000 implements MigrationInterface {
  name = 'StaffPushSubscriptions1793300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "staff_push_subscriptions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "staff_id" uuid NOT NULL,
        "endpoint" text NOT NULL,
        "p256dh" character varying(200) NOT NULL,
        "auth" character varying(100) NOT NULL,
        "user_agent" character varying(300),
        "last_counts" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_push_subscriptions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_staff_push_subscriptions_endpoint" UNIQUE ("endpoint"),
        CONSTRAINT "FK_staff_push_subscriptions_staff" FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_push_subscriptions_staff" ON "staff_push_subscriptions" ("staff_id")`,
    );
    await queryRunner.query(`ALTER TABLE "staff_push_subscriptions" ENABLE ROW LEVEL SECURITY`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "staff_push_subscriptions"`);
  }
}

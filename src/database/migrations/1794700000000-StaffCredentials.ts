import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class StaffCredentials1794700000000 implements MigrationInterface {
  name = 'StaffCredentials1794700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "staff_credentials" (
        "staff_id" uuid NOT NULL,
        "password_hash" text NOT NULL,
        "password_changed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "failed_attempts" integer NOT NULL DEFAULT 0,
        "locked_until" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_credentials" PRIMARY KEY ("staff_id"),
        CONSTRAINT "CHK_staff_credentials_failed_attempts" CHECK ("failed_attempts" >= 0),
        CONSTRAINT "FK_staff_credentials_staff" FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE TABLE "staff_sessions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "staff_id" uuid NOT NULL,
        "refresh_hash" varchar(64) NOT NULL,
        "previous_hash" varchar(64),
        "rotated_at" TIMESTAMP WITH TIME ZONE,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "absolute_expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "device" varchar(200),
        "ip" varchar(64),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "last_used_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        "revoked_reason" varchar(30),
        CONSTRAINT "PK_staff_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_staff_sessions_refresh_hash" UNIQUE ("refresh_hash"),
        CONSTRAINT "FK_staff_sessions_staff" FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_sessions_previous_hash" ON "staff_sessions" ("previous_hash") WHERE "previous_hash" IS NOT NULL`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_staff_sessions_staff" ON "staff_sessions" ("staff_id")`);
    for (const table of ['staff_credentials', 'staff_sessions']) {
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    }
    await queryRunner.query(
      `DO $$ BEGIN
        IF to_regclass('auth.users') IS NOT NULL THEN
          INSERT INTO "staff_credentials" ("staff_id", "password_hash", "password_changed_at")
          SELECT u.id, u.encrypted_password, COALESCE(u.updated_at, now())
            FROM auth.users u
            JOIN "staff_profiles" s ON s.id = u.id
           WHERE u.encrypted_password ~ '^\\$2[aby]\\$[0-9]{2}\\$'
          ON CONFLICT ("staff_id") DO NOTHING;
        END IF;
      END $$`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_profiles" DROP CONSTRAINT IF EXISTS "FK_staff_profiles_auth_user"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "staff_sessions"`);
    await queryRunner.query(`DROP TABLE "staff_credentials"`);
  }
}

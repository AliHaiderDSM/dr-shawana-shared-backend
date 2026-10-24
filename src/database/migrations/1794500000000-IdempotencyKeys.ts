import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class IdempotencyKeys1794500000000 implements MigrationInterface {
  name = 'IdempotencyKeys1794500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "idempotency_keys" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "scope" varchar(60) NOT NULL,
        "key" varchar(100) NOT NULL,
        "status" varchar(10) NOT NULL DEFAULT 'pending',
        "response_status" integer,
        "response_body" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_idempotency_keys" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_idempotency_keys_owner_key" UNIQUE ("user_id", "scope", "key")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_idempotency_keys_created" ON "idempotency_keys" ("created_at")`,
    );
    await queryRunner.query(`ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "idempotency_keys"`);
  }
}

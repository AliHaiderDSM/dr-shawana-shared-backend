import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PatientApp1792700000000 implements MigrationInterface {
  name = 'PatientApp1792700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "patient_accounts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "patient_id" uuid NOT NULL,
        "password_hash" character varying(255),
        "activated_at" TIMESTAMP WITH TIME ZONE,
        "disabled_at" TIMESTAMP WITH TIME ZONE,
        "failed_attempts" integer NOT NULL DEFAULT 0,
        "locked_until" TIMESTAMP WITH TIME ZONE,
        "last_login_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_patient_accounts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_patient_accounts_patient" UNIQUE ("patient_id"),
        CONSTRAINT "FK_patient_accounts_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE TABLE "patient_activation_codes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "patient_id" uuid NOT NULL,
        "branch_id" uuid,
        "code_hash" character varying(128) NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "used_at" TIMESTAMP WITH TIME ZONE,
        "attempts" integer NOT NULL DEFAULT 0,
        "created_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_patient_activation_codes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_patient_activation_codes_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_patient_activation_codes_patient" ON "patient_activation_codes" ("patient_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE TABLE "patient_sessions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "patient_id" uuid NOT NULL,
        "refresh_hash" character varying(128) NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        "last_used_at" TIMESTAMP WITH TIME ZONE,
        "device" character varying(120),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_patient_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_patient_sessions_refresh" UNIQUE ("refresh_hash"),
        CONSTRAINT "FK_patient_sessions_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_patient_sessions_patient" ON "patient_sessions" ("patient_id")`,
    );
    await queryRunner.query(
      `CREATE TYPE "patient_request_category" AS ENUM ('appointment', 'prescription', 'medicine_order', 'billing', 'profile_correction', 'general', 'other')`,
    );
    await queryRunner.query(
      `CREATE TYPE "patient_request_status" AS ENUM ('submitted', 'in_review', 'in_progress', 'resolved', 'closed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "patient_requests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "deleted_by" uuid,
        "branch_id" uuid NOT NULL,
        "patient_id" uuid NOT NULL,
        "request_no" character varying(30) NOT NULL,
        "category" "patient_request_category" NOT NULL,
        "subject" character varying(150) NOT NULL,
        "message" text NOT NULL,
        "status" "patient_request_status" NOT NULL DEFAULT 'submitted',
        "reply" text,
        "replied_by" uuid,
        "replied_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_patient_requests" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_patient_requests_no" UNIQUE ("request_no"),
        CONSTRAINT "FK_patient_requests_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_patient_requests_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_patient_requests_branch_status" ON "patient_requests" ("branch_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_patient_requests_patient" ON "patient_requests" ("patient_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE TABLE "patient_request_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "request_id" uuid NOT NULL,
        "status" "patient_request_status" NOT NULL,
        "note" text,
        "by_patient" boolean NOT NULL DEFAULT false,
        "actor_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_patient_request_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_patient_request_events_request" FOREIGN KEY ("request_id") REFERENCES "patient_requests"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_patient_request_events_request" ON "patient_request_events" ("request_id", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "medical_records" ADD "uploaded_by_patient" boolean NOT NULL DEFAULT false`,
    );
    for (const table of [
      'patient_accounts',
      'patient_activation_codes',
      'patient_sessions',
      'patient_requests',
      'patient_request_events',
    ]) {
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "medical_records" DROP COLUMN "uploaded_by_patient"`);
    await queryRunner.query(`DROP TABLE "patient_request_events"`);
    await queryRunner.query(`DROP TABLE "patient_requests"`);
    await queryRunner.query(`DROP TYPE "patient_request_status"`);
    await queryRunner.query(`DROP TYPE "patient_request_category"`);
    await queryRunner.query(`DROP TABLE "patient_sessions"`);
    await queryRunner.query(`DROP TABLE "patient_activation_codes"`);
    await queryRunner.query(`DROP TABLE "patient_accounts"`);
  }
}

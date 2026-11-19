import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TreatmentPlans1795700000000 implements MigrationInterface {
  name = 'TreatmentPlans1795700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "treatment_plans" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "patient_id" uuid NOT NULL, "doctor_id" uuid NOT NULL, "date" date NOT NULL, "plan" text NOT NULL, CONSTRAINT "PK_6372779b339933b56aa985167f0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f176bb2b8d3b9af3c3751a0fdf" ON "treatment_plans" ("branch_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_69e82223582d0bd8560c627173" ON "treatment_plans" ("patient_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aff03fb05c1bf0495107b517c4" ON "treatment_plans" ("doctor_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "treatment_plans" ADD CONSTRAINT "FK_f176bb2b8d3b9af3c3751a0fdfe" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "treatment_plans" ADD CONSTRAINT "FK_treatment_plans_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "treatment_plans" ADD CONSTRAINT "FK_treatment_plans_doctor" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "treatment_plans" ENABLE ROW LEVEL SECURITY`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "treatment_plans" DROP CONSTRAINT "FK_treatment_plans_doctor"`);
    await queryRunner.query(`ALTER TABLE "treatment_plans" DROP CONSTRAINT "FK_treatment_plans_patient"`);
    await queryRunner.query(`ALTER TABLE "treatment_plans" DROP CONSTRAINT "FK_f176bb2b8d3b9af3c3751a0fdfe"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_aff03fb05c1bf0495107b517c4"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_69e82223582d0bd8560c627173"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f176bb2b8d3b9af3c3751a0fdf"`);
    await queryRunner.query(`DROP TABLE "treatment_plans"`);
  }
}

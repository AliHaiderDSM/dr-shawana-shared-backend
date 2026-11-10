import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AppointmentRepeats1795100000000 implements MigrationInterface {
  name = 'AppointmentRepeats1795100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "appointments" ADD "repeat_of_id" uuid`);
    await queryRunner.query(`ALTER TABLE "appointments" ADD "repeat_no" smallint`);
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "FK_appointments_repeat_of" FOREIGN KEY ("repeat_of_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "CHK_appointments_repeat" CHECK (("repeat_of_id" IS NULL) = ("repeat_no" IS NULL) AND ("repeat_no" IS NULL OR "repeat_no" > 0))`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_appointments_number"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_appointments_number" ON "appointments" ("appointment_no") WHERE "repeat_no" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_appointments_repeat_number" ON "appointments" ("appointment_no", "repeat_no") WHERE "repeat_no" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_appointments_repeat_of" ON "appointments" ("repeat_of_id") WHERE "repeat_of_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_appointments_repeat_of"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_appointments_repeat_number"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_appointments_number"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_appointments_number" ON "appointments" ("appointment_no")`,
    );
    await queryRunner.query(`ALTER TABLE "appointments" DROP CONSTRAINT "CHK_appointments_repeat"`);
    await queryRunner.query(`ALTER TABLE "appointments" DROP CONSTRAINT "FK_appointments_repeat_of"`);
    await queryRunner.query(`ALTER TABLE "appointments" DROP COLUMN "repeat_no"`);
    await queryRunner.query(`ALTER TABLE "appointments" DROP COLUMN "repeat_of_id"`);
  }
}

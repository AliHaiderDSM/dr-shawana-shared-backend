import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AppointmentEnteredByName1796200000000 implements MigrationInterface {
  name = 'AppointmentEnteredByName1796200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "appointments" ADD "entered_by_name" character varying(150)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "appointments" DROP COLUMN "entered_by_name"`);
  }
}

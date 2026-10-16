import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EducationalResources1793100000000 implements MigrationInterface {
  name = 'EducationalResources1793100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "educational_resource_files" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "resource_key" character varying(40) NOT NULL,
        "file_path" text NOT NULL,
        "file_name" character varying(255) NOT NULL,
        "content_type" character varying(100) NOT NULL,
        "size_bytes" integer NOT NULL,
        "created_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_by" uuid,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_educational_resource_files" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_educational_resource_key" CHECK ("resource_key" IN ('glpDietPlan', 'generalDietPlan', 'liverDetox', 'skinCareRoutine', 'hairCareRoutine'))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_educational_resource_files_key" ON "educational_resource_files" ("resource_key") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(`ALTER TABLE "educational_resource_files" ENABLE ROW LEVEL SECURITY`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "educational_resource_files"`);
  }
}

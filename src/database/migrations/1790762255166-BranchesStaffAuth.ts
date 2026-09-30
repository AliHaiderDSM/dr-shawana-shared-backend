import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class BranchesStaffAuth1790762255166 implements MigrationInterface {
  name = 'BranchesStaffAuth1790762255166';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid, "actor_id" uuid, "action" character varying(50) NOT NULL, "entity" character varying(50) NOT NULL, "entity_id" character varying(64), "before" jsonb, "after" jsonb, "ip" character varying(64), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_ee4c6baac8b07dc19433e575cb" ON "audit_logs"  ("branch_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_177183f29f438c488b5e8510cd" ON "audit_logs"  ("actor_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_2cd10fda8276bb995288acfbfb" ON "audit_logs"  ("created_at") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_82edbc5f8a1821ff01b8b9c865" ON "audit_logs"  ("entity", "entity_id") `,
    );
    await queryRunner.query(`CREATE TYPE "public"."branch_status" AS ENUM('active', 'inactive')`);
    await queryRunner.query(
      `CREATE TABLE "branches" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(150) NOT NULL, "code" character varying(10) NOT NULL, "city" character varying(100) NOT NULL, "address" text, "phone" character varying(30), "email" character varying(150), "logo_path" text, "is_head_office" boolean NOT NULL DEFAULT false, "status" "public"."branch_status" NOT NULL DEFAULT 'active', CONSTRAINT "PK_7f37d3b42defea97f1df0d19535" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_c224a834a4fd6e1c9e180bb37b" ON "branches"  ("status") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_branches_head_office" ON "branches"  ("is_head_office") WHERE "is_head_office" = true AND "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_branches_code" ON "branches"  ("code") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "company_info" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(150) NOT NULL, "phone" character varying(30), "email" character varying(150), "address" text, "logo_path" text, CONSTRAINT "PK_88c3e323679d0747ffbb83f3f78" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."staff_role" AS ENUM('super_admin', 'branch_admin', 'accountant', 'doctor', 'front_desk', 'team_manager', 'pharmacy', 'store_keeper', 'delivery_print')`,
    );
    await queryRunner.query(`CREATE TYPE "public"."gender" AS ENUM('male', 'female')`);
    await queryRunner.query(`CREATE TYPE "public"."staff_status" AS ENUM('active', 'inactive')`);
    await queryRunner.query(
      `CREATE TABLE "staff_profiles" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL, "branch_id" uuid, "role" "public"."staff_role" NOT NULL, "first_name" character varying(100) NOT NULL, "last_name" character varying(100) NOT NULL, "email" character varying(150) NOT NULL, "username" character varying(50) NOT NULL, "phone" character varying(30), "gender" "public"."gender", "designation" character varying(100), "avatar_path" text, "status" "public"."staff_status" NOT NULL DEFAULT 'active', "must_change_password" boolean NOT NULL DEFAULT true, "last_login_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_6d4c6c0b447e39147b4a6dcbede" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a3082d595ead754795d1952f32" ON "staff_profiles"  ("branch_id") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_62c2f2001cd98e70c285952438" ON "staff_profiles"  ("role") `);
    await queryRunner.query(`CREATE INDEX "IDX_d051f60c1476daa60000f5418f" ON "staff_profiles"  ("status") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_staff_profiles_email" ON "staff_profiles"  ("email") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_staff_profiles_username" ON "staff_profiles"  ("username") `,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_profiles" ADD CONSTRAINT "FK_a3082d595ead754795d1952f324" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_company_info_singleton" ON "company_info" ((true)) WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "branches" ADD CONSTRAINT "CHK_branches_code_format" CHECK ("code" ~ '^[A-Z0-9]{2,10}$')`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_profiles" ADD CONSTRAINT "CHK_staff_profiles_branch_matches_role" CHECK (("role" = 'super_admin') = ("branch_id" IS NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_profiles" ADD CONSTRAINT "CHK_staff_profiles_lowercase_login" CHECK ("email" = lower("email") AND "username" = lower("username"))`,
    );
    await queryRunner.query(
      `DO $$ BEGIN IF to_regclass('auth.users') IS NOT NULL THEN ALTER TABLE "staff_profiles" ADD CONSTRAINT "FK_staff_profiles_auth_user" FOREIGN KEY ("id") REFERENCES auth.users("id") ON DELETE CASCADE; END IF; END $$`,
    );
    await queryRunner.query(`ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "company_info" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "staff_profiles" ENABLE ROW LEVEL SECURITY`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "staff_profiles" DROP CONSTRAINT IF EXISTS "FK_staff_profiles_auth_user"`,
    );
    await queryRunner.query(`ALTER TABLE "staff_profiles" DROP CONSTRAINT "FK_a3082d595ead754795d1952f324"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_staff_profiles_username"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_staff_profiles_email"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d051f60c1476daa60000f5418f"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_62c2f2001cd98e70c285952438"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a3082d595ead754795d1952f32"`);
    await queryRunner.query(`DROP TABLE "staff_profiles"`);
    await queryRunner.query(`DROP TYPE "public"."staff_status"`);
    await queryRunner.query(`DROP TYPE "public"."gender"`);
    await queryRunner.query(`DROP TYPE "public"."staff_role"`);
    await queryRunner.query(`DROP TABLE "company_info"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_branches_code"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_branches_head_office"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c224a834a4fd6e1c9e180bb37b"`);
    await queryRunner.query(`DROP TABLE "branches"`);
    await queryRunner.query(`DROP TYPE "public"."branch_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_82edbc5f8a1821ff01b8b9c865"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_2cd10fda8276bb995288acfbfb"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_177183f29f438c488b5e8510cd"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ee4c6baac8b07dc19433e575cb"`);
    await queryRunner.query(`DROP TABLE "audit_logs"`);
  }
}

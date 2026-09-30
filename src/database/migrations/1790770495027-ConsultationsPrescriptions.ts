import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class ConsultationsPrescriptions1790770495027 implements MigrationInterface {
  name = 'ConsultationsPrescriptions1790770495027';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."bhrt_log_status" AS ENUM('on', 'off', 'recommended', 'other')`,
    );
    await queryRunner.query(
      `CREATE TABLE "bhrt_status_log" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "patient_id" uuid NOT NULL, "appointment_id" uuid, "date" date NOT NULL, "status" "public"."bhrt_log_status" NOT NULL, "note" text, CONSTRAINT "PK_c41872a1398b2471340d02fa851" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_db4aeb7b57235ea2be8575014f" ON "bhrt_status_log"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4b70361d6d3a10200db0892604" ON "bhrt_status_log"  ("patient_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3d2f49781a9bddc030b40d1f86" ON "bhrt_status_log"  ("appointment_id") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_c3bdd472bad6bcaecc5513eea1" ON "bhrt_status_log"  ("date") `);
    await queryRunner.query(
      `CREATE TYPE "public"."consultation_section_key" AS ENUM('basic_info', 'follow_up', 'medical_history', 'mrs_scale', 'additional_symptoms', 'imaging_results', 'clinical_assessment', 'referral', 'plans')`,
    );
    await queryRunner.query(
      `CREATE TABLE "consultation_sections" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "consultation_id" uuid NOT NULL, "section_key" "public"."consultation_section_key" NOT NULL, "data" jsonb NOT NULL, CONSTRAINT "PK_3d9307e4691f7c36fe0d9bbb56e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_565bdfa0d19b70471ca24e882d" ON "consultation_sections"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2dfce3f50e0d44f8e9c3b1ac65" ON "consultation_sections"  ("consultation_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_62ea3b9f947b0217ca8edbc1f9" ON "consultation_sections"  ("section_key") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_consultation_sections_key" ON "consultation_sections"  ("consultation_id", "section_key") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(`CREATE TYPE "public"."consultation_status" AS ENUM('open', 'completed')`);
    await queryRunner.query(
      `CREATE TABLE "consultations" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "patient_id" uuid NOT NULL, "doctor_id" uuid NOT NULL, "appointment_id" uuid NOT NULL, "status" "public"."consultation_status" NOT NULL DEFAULT 'open', "discuss_topics" text, "major_complaint" text, "current_medications" text, CONSTRAINT "PK_c5b78e9424d9bc68464f6a12103" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_32bcacc91e1124291296c5560c" ON "consultations"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ee6c335246d3b937f11c329c83" ON "consultations"  ("patient_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f8fd24eb3ea75583c650cc3c0c" ON "consultations"  ("doctor_id") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_e75c735da4edfcec042902c751" ON "consultations"  ("status") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_consultations_appointment" ON "consultations"  ("appointment_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."blood_test" AS ENUM('fsh', 'estradiol', 'testosterone_free', 'testosterone_total', 'dhea_s', 'vit_d3', 'tsh', 'ferritin', 'b12')`,
    );
    await queryRunner.query(
      `CREATE TABLE "blood_work_results" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "patient_id" uuid NOT NULL, "consultation_id" uuid, "test" "public"."blood_test" NOT NULL, "value" numeric(12,3) NOT NULL, "unit" character varying(20) NOT NULL, "test_date" date NOT NULL, CONSTRAINT "PK_6afe6d8ef6b5660b1297e8572f1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d184c786c4b7a846cc054e4ca9" ON "blood_work_results"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b2991dfecae6f8b189a74724db" ON "blood_work_results"  ("patient_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2084d889786b46707385ed425e" ON "blood_work_results"  ("consultation_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_612961536bd1e0f800caead025" ON "blood_work_results"  ("patient_id", "test", "test_date") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."prescription_category" AS ENUM('lab', 'imaging', 'genetic', 'supplement', 'medicine', 'glp', 'skin_care', 'hair_care', 'bhrt', 'symptom')`,
    );
    await queryRunner.query(
      `CREATE TABLE "prescription_items_catalog" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "code" character varying(80) NOT NULL, "category" "public"."prescription_category" NOT NULL, "group_name" character varying(150) NOT NULL, "name" character varying(255) NOT NULL, "default_dose" text, "default_instructions" text, "product_id" uuid, "sort_order" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_7fe2af98469072029fbdd2f0d0f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_732e7f97d14e1d63e96e1a97a8" ON "prescription_items_catalog"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c63b2de0b22c2f76e355100ae9" ON "prescription_items_catalog"  ("product_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d4db717ecd986e37d932f52084" ON "prescription_items_catalog"  ("is_active") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ac500c728968b434713ef91526" ON "prescription_items_catalog"  ("branch_id", "category", "sort_order") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_prescription_items_catalog_code" ON "prescription_items_catalog"  ("branch_id", "code") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."prescription_template_version" AS ENUM('current', 'previous')`,
    );
    await queryRunner.query(
      `CREATE TABLE "prescriptions" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "prescription_no" SERIAL NOT NULL, "patient_id" uuid NOT NULL, "doctor_id" uuid NOT NULL, "consultation_id" uuid, "date" date NOT NULL, "diagnosis" text NOT NULL, "notes" jsonb NOT NULL, "plan_treatment" text, "followup_date" date, "template_version" "public"."prescription_template_version" NOT NULL DEFAULT 'current', CONSTRAINT "PK_097b2cc2f2b7e56825468188503" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_403373fddf17420205644991af" ON "prescriptions"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9389db557647131856661f7d7b" ON "prescriptions"  ("patient_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2d6a1941bd705056030c2b9e07" ON "prescriptions"  ("doctor_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e3442ce8d995f050ee83a52075" ON "prescriptions"  ("consultation_id") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_4e0571112c53d0eb2209a7d991" ON "prescriptions"  ("date") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_prescriptions_number" ON "prescriptions"  ("prescription_no") `,
    );
    await queryRunner.query(
      `CREATE TABLE "prescription_items" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "prescription_id" uuid NOT NULL, "catalog_item_id" uuid, "category" "public"."prescription_category" NOT NULL, "group_name" character varying(150) NOT NULL, "name" character varying(255) NOT NULL, "dose" text, "instructions" text, "optional" boolean NOT NULL DEFAULT false, "sort_order" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_6216831f49afc381b3934c9672c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c1185cc4705f6da9c1555fe4b9" ON "prescription_items"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a603d92d4a8459db5fbe45a4ae" ON "prescription_items"  ("prescription_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3e762146704f4f936987b5ea1e" ON "prescription_items"  ("catalog_item_id") `,
    );
    await queryRunner.query(`ALTER TABLE "doctors" ADD "signature_path" text`);
    await queryRunner.query(
      `CREATE TYPE "public"."medical_record_type" AS ENUM('medical_record', 'imaging')`,
    );
    await queryRunner.query(
      `ALTER TABLE "medical_records" ADD "type" "public"."medical_record_type" NOT NULL DEFAULT 'medical_record'`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_89313f54b6e873cab953c3baa7" ON "medical_records"  ("type") `);
    await queryRunner.query(
      `ALTER TABLE "bhrt_status_log" ADD CONSTRAINT "FK_db4aeb7b57235ea2be8575014fb" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "bhrt_status_log" ADD CONSTRAINT "FK_4b70361d6d3a10200db08926046" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "bhrt_status_log" ADD CONSTRAINT "FK_3d2f49781a9bddc030b40d1f86d" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "consultation_sections" ADD CONSTRAINT "FK_565bdfa0d19b70471ca24e882de" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "consultation_sections" ADD CONSTRAINT "FK_2dfce3f50e0d44f8e9c3b1ac65f" FOREIGN KEY ("consultation_id") REFERENCES "consultations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "consultations" ADD CONSTRAINT "FK_32bcacc91e1124291296c5560c2" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "consultations" ADD CONSTRAINT "FK_ee6c335246d3b937f11c329c837" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "consultations" ADD CONSTRAINT "FK_f8fd24eb3ea75583c650cc3c0c8" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "consultations" ADD CONSTRAINT "FK_590a17c3e9eeda5c69cb7bd594b" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "blood_work_results" ADD CONSTRAINT "FK_d184c786c4b7a846cc054e4ca91" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "blood_work_results" ADD CONSTRAINT "FK_b2991dfecae6f8b189a74724db0" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "blood_work_results" ADD CONSTRAINT "FK_2084d889786b46707385ed425e9" FOREIGN KEY ("consultation_id") REFERENCES "consultations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescription_items_catalog" ADD CONSTRAINT "FK_732e7f97d14e1d63e96e1a97a8d" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescription_items_catalog" ADD CONSTRAINT "FK_c63b2de0b22c2f76e355100ae98" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" ADD CONSTRAINT "FK_403373fddf17420205644991af8" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" ADD CONSTRAINT "FK_9389db557647131856661f7d7b5" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" ADD CONSTRAINT "FK_2d6a1941bd705056030c2b9e07d" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" ADD CONSTRAINT "FK_e3442ce8d995f050ee83a520755" FOREIGN KEY ("consultation_id") REFERENCES "consultations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescription_items" ADD CONSTRAINT "FK_c1185cc4705f6da9c1555fe4b98" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescription_items" ADD CONSTRAINT "FK_a603d92d4a8459db5fbe45a4aea" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescription_items" ADD CONSTRAINT "FK_3e762146704f4f936987b5ea1e8" FOREIGN KEY ("catalog_item_id") REFERENCES "prescription_items_catalog"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "consultations" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "consultation_sections" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "blood_work_results" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "bhrt_status_log" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "prescription_items_catalog" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "prescriptions" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "prescription_items" ENABLE ROW LEVEL SECURITY`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prescription_items" DROP CONSTRAINT "FK_3e762146704f4f936987b5ea1e8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescription_items" DROP CONSTRAINT "FK_a603d92d4a8459db5fbe45a4aea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescription_items" DROP CONSTRAINT "FK_c1185cc4705f6da9c1555fe4b98"`,
    );
    await queryRunner.query(`ALTER TABLE "prescriptions" DROP CONSTRAINT "FK_e3442ce8d995f050ee83a520755"`);
    await queryRunner.query(`ALTER TABLE "prescriptions" DROP CONSTRAINT "FK_2d6a1941bd705056030c2b9e07d"`);
    await queryRunner.query(`ALTER TABLE "prescriptions" DROP CONSTRAINT "FK_9389db557647131856661f7d7b5"`);
    await queryRunner.query(`ALTER TABLE "prescriptions" DROP CONSTRAINT "FK_403373fddf17420205644991af8"`);
    await queryRunner.query(
      `ALTER TABLE "prescription_items_catalog" DROP CONSTRAINT "FK_c63b2de0b22c2f76e355100ae98"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescription_items_catalog" DROP CONSTRAINT "FK_732e7f97d14e1d63e96e1a97a8d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "blood_work_results" DROP CONSTRAINT "FK_2084d889786b46707385ed425e9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "blood_work_results" DROP CONSTRAINT "FK_b2991dfecae6f8b189a74724db0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "blood_work_results" DROP CONSTRAINT "FK_d184c786c4b7a846cc054e4ca91"`,
    );
    await queryRunner.query(`ALTER TABLE "consultations" DROP CONSTRAINT "FK_590a17c3e9eeda5c69cb7bd594b"`);
    await queryRunner.query(`ALTER TABLE "consultations" DROP CONSTRAINT "FK_f8fd24eb3ea75583c650cc3c0c8"`);
    await queryRunner.query(`ALTER TABLE "consultations" DROP CONSTRAINT "FK_ee6c335246d3b937f11c329c837"`);
    await queryRunner.query(`ALTER TABLE "consultations" DROP CONSTRAINT "FK_32bcacc91e1124291296c5560c2"`);
    await queryRunner.query(
      `ALTER TABLE "consultation_sections" DROP CONSTRAINT "FK_2dfce3f50e0d44f8e9c3b1ac65f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "consultation_sections" DROP CONSTRAINT "FK_565bdfa0d19b70471ca24e882de"`,
    );
    await queryRunner.query(`ALTER TABLE "bhrt_status_log" DROP CONSTRAINT "FK_3d2f49781a9bddc030b40d1f86d"`);
    await queryRunner.query(`ALTER TABLE "bhrt_status_log" DROP CONSTRAINT "FK_4b70361d6d3a10200db08926046"`);
    await queryRunner.query(`ALTER TABLE "bhrt_status_log" DROP CONSTRAINT "FK_db4aeb7b57235ea2be8575014fb"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_89313f54b6e873cab953c3baa7"`);
    await queryRunner.query(`ALTER TABLE "medical_records" DROP COLUMN "type"`);
    await queryRunner.query(`DROP TYPE "public"."medical_record_type"`);
    await queryRunner.query(`ALTER TABLE "doctors" DROP COLUMN "signature_path"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3e762146704f4f936987b5ea1e"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a603d92d4a8459db5fbe45a4ae"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c1185cc4705f6da9c1555fe4b9"`);
    await queryRunner.query(`DROP TABLE "prescription_items"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_prescriptions_number"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_4e0571112c53d0eb2209a7d991"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e3442ce8d995f050ee83a52075"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_2d6a1941bd705056030c2b9e07"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_9389db557647131856661f7d7b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_403373fddf17420205644991af"`);
    await queryRunner.query(`DROP TABLE "prescriptions"`);
    await queryRunner.query(`DROP TYPE "public"."prescription_template_version"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_prescription_items_catalog_code"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ac500c728968b434713ef91526"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d4db717ecd986e37d932f52084"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c63b2de0b22c2f76e355100ae9"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_732e7f97d14e1d63e96e1a97a8"`);
    await queryRunner.query(`DROP TABLE "prescription_items_catalog"`);
    await queryRunner.query(`DROP TYPE "public"."prescription_category"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_612961536bd1e0f800caead025"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_2084d889786b46707385ed425e"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b2991dfecae6f8b189a74724db"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d184c786c4b7a846cc054e4ca9"`);
    await queryRunner.query(`DROP TABLE "blood_work_results"`);
    await queryRunner.query(`DROP TYPE "public"."blood_test"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_consultations_appointment"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e75c735da4edfcec042902c751"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f8fd24eb3ea75583c650cc3c0c"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ee6c335246d3b937f11c329c83"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_32bcacc91e1124291296c5560c"`);
    await queryRunner.query(`DROP TABLE "consultations"`);
    await queryRunner.query(`DROP TYPE "public"."consultation_status"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_consultation_sections_key"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_62ea3b9f947b0217ca8edbc1f9"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_2dfce3f50e0d44f8e9c3b1ac65"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_565bdfa0d19b70471ca24e882d"`);
    await queryRunner.query(`DROP TABLE "consultation_sections"`);
    await queryRunner.query(`DROP TYPE "public"."consultation_section_key"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c3bdd472bad6bcaecc5513eea1"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3d2f49781a9bddc030b40d1f86"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_4b70361d6d3a10200db0892604"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_db4aeb7b57235ea2be8575014f"`);
    await queryRunner.query(`DROP TABLE "bhrt_status_log"`);
    await queryRunner.query(`DROP TYPE "public"."bhrt_log_status"`);
  }
}

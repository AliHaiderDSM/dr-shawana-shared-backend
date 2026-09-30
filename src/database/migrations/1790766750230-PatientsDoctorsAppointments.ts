import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class PatientsDoctorsAppointments1790766750230 implements MigrationInterface {
  name = 'PatientsDoctorsAppointments1790766750230';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."doctor_status" AS ENUM('active', 'inactive')`);
    await queryRunner.query(
      `CREATE TABLE "doctors" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "staff_id" uuid NOT NULL, "display_name" character varying(150) NOT NULL, "phone" character varying(30), "email" character varying(150), "details" text, "consultation_fee" numeric(12,2) NOT NULL DEFAULT '0', "status" "public"."doctor_status" NOT NULL DEFAULT 'active', CONSTRAINT "PK_8207e7889b50ee3695c2b8154ff" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_efbb5ff2cfbc55ca8f22d1006d" ON "doctors"  ("branch_id") `);
    await queryRunner.query(`CREATE INDEX "IDX_8921f61b3c526e57009c0157ce" ON "doctors"  ("display_name") `);
    await queryRunner.query(`CREATE INDEX "IDX_bb6b34d0edf46148f12dcd0868" ON "doctors"  ("status") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_doctors_staff" ON "doctors"  ("staff_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(`CREATE TYPE "public"."bhrt_status" AS ENUM('none', 'on', 'off', 'recommended')`);
    await queryRunner.query(
      `CREATE TABLE "patients" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(150) NOT NULL, "phone" character varying(30) NOT NULL, "phone_normalized" character varying(20) NOT NULL, "phone_last9" character varying(9) NOT NULL, "city" character varying(100) NOT NULL, "age" smallint, "date_of_birth" date, "country" character varying(100), "address" text, "bhrt_status" "public"."bhrt_status" NOT NULL DEFAULT 'none', "created_in_branch_id" uuid, CONSTRAINT "CHK_patients_age" CHECK ("age" IS NULL OR ("age" >= 0 AND "age" <= 150)), CONSTRAINT "PK_a7f0b9fcbb3469d5ec0b0aceaa7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_779ac2dcf355f2982db53f4df6" ON "patients"  ("name") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_0ad275694af4c16b190251f54c" ON "patients"  ("phone_normalized") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_bfa842b49716926e581e54ff2d" ON "patients"  ("city") `);
    await queryRunner.query(`CREATE INDEX "IDX_747a6ed52efc30afa8c14226ee" ON "patients"  ("bhrt_status") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_d739f6dc6345fc9f9a508147b0" ON "patients"  ("created_in_branch_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_patients_phone_last9" ON "patients"  ("phone_last9") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(`CREATE TYPE "public"."payment_method" AS ENUM('cash', 'online')`);
    await queryRunner.query(
      `CREATE TABLE "appointment_payments" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "appointment_id" uuid NOT NULL, "method" "public"."payment_method" NOT NULL, "amount" numeric(12,2) NOT NULL, "date" date NOT NULL, "account_sheet_id" uuid NOT NULL, "sender_bank" character varying(150), "sender_account_title" character varying(150), "sender_account_no" character varying(100), "proof_file_path" text, "proof_original_name" character varying(255), "proof_content_type" character varying(100), CONSTRAINT "CHK_appointment_payments_cash_fields" CHECK ("method" = 'online' OR ("sender_bank" IS NULL AND "sender_account_title" IS NULL AND "sender_account_no" IS NULL AND "proof_file_path" IS NULL)), CONSTRAINT "CHK_appointment_payments_amount" CHECK ("amount" > 0), CONSTRAINT "PK_c4e3ea1010777583700f0e5d8e1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ff37f6d5c85b564adaaf30ca29" ON "appointment_payments"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d34297e2dc55119c5ce8272345" ON "appointment_payments"  ("appointment_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d2b6c9b8ddfb4c28d653e016f4" ON "appointment_payments"  ("method") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a8f83b1c023005e7b9b914e7d3" ON "appointment_payments"  ("date") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_58d3dca90eb59d5540740c50ee" ON "appointment_payments"  ("account_sheet_id") `,
    );
    await queryRunner.query(`CREATE TYPE "public"."appointment_mode" AS ENUM('online', 'physical')`);
    await queryRunner.query(`CREATE TYPE "public"."visit_type" AS ENUM('new', 'followup')`);
    await queryRunner.query(
      `CREATE TYPE "public"."appointment_status" AS ENUM('booked', 'completed', 'cancelled')`,
    );
    await queryRunner.query(`CREATE TYPE "public"."appointment_source" AS ENUM('dashboard', 'app')`);
    await queryRunner.query(
      `CREATE TABLE "appointments" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "appointment_no" SERIAL NOT NULL, "patient_id" uuid NOT NULL, "patient_city" character varying(100), "doctor_id" uuid NOT NULL, "date" date NOT NULL, "time_from" TIME NOT NULL, "time_to" TIME NOT NULL, "mode" "public"."appointment_mode" NOT NULL, "visit_type" "public"."visit_type" NOT NULL, "issues" text, "remark" text, "status" "public"."appointment_status" NOT NULL DEFAULT 'booked', "source" "public"."appointment_source" NOT NULL DEFAULT 'dashboard', CONSTRAINT "CHK_appointments_time_range" CHECK ("time_to" > "time_from"), CONSTRAINT "PK_4a437a9a27e948726b8bb3e36ad" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fc5d925c8972ba27457e23e7c0" ON "appointments"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3330f054416745deaa2cc13070" ON "appointments"  ("patient_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4cf26c3f972d014df5c68d503d" ON "appointments"  ("doctor_id") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_6b8e84de5d15269b7f79187992" ON "appointments"  ("date") `);
    await queryRunner.query(`CREATE INDEX "IDX_18cafb5a1d68239170fd5cebf2" ON "appointments"  ("mode") `);
    await queryRunner.query(`CREATE INDEX "IDX_3007a47d97a542e63b3308a69b" ON "appointments"  ("status") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_appointments_number" ON "appointments"  ("appointment_no") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e432a12f17b3bdd13522abceb1" ON "appointments"  ("branch_id", "doctor_id", "date") `,
    );
    await queryRunner.query(
      `CREATE TABLE "appointment_attachments" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "appointment_id" uuid NOT NULL, "file_path" text NOT NULL, "original_name" character varying(255) NOT NULL, "content_type" character varying(100) NOT NULL, "size_bytes" integer NOT NULL, CONSTRAINT "PK_4bf2ebc9072a99be7e68b81b45a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_39aef3786f3b1d9f366b14410b" ON "appointment_attachments"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_47aa5c2ec104c31216eee79722" ON "appointment_attachments"  ("appointment_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "medical_records" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "patient_id" uuid NOT NULL, "appointment_id" uuid, "date" date NOT NULL, "status" character varying(50), "note" text, CONSTRAINT "PK_c200c0b76638124b7ed51424823" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e8e4f12885af7ccc4f3ebd9f09" ON "medical_records"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_43e2800e756c913a6c7a07cc27" ON "medical_records"  ("patient_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4185307f688fcdf88d700b2363" ON "medical_records"  ("appointment_id") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_255b0e5480ecd34e12f1fe92bd" ON "medical_records"  ("date") `);
    await queryRunner.query(
      `CREATE TABLE "medical_record_files" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "medical_record_id" uuid NOT NULL, "file_path" text NOT NULL, "original_name" character varying(255) NOT NULL, "content_type" character varying(100) NOT NULL, "size_bytes" integer NOT NULL, CONSTRAINT "PK_1dfedb2d7cdd82b80df9de64a93" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1ffc3b4d53788f6d109f7b002b" ON "medical_record_files"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e81a68fb384e237a7bc3a5d9fa" ON "medical_record_files"  ("medical_record_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "doctors" ADD CONSTRAINT "FK_efbb5ff2cfbc55ca8f22d1006d8" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctors" ADD CONSTRAINT "FK_dc5bf45b7d5a46ec1345ff033d5" FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" ADD CONSTRAINT "FK_d739f6dc6345fc9f9a508147b00" FOREIGN KEY ("created_in_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment_payments" ADD CONSTRAINT "FK_ff37f6d5c85b564adaaf30ca292" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment_payments" ADD CONSTRAINT "FK_d34297e2dc55119c5ce82723453" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment_payments" ADD CONSTRAINT "FK_58d3dca90eb59d5540740c50ee6" FOREIGN KEY ("account_sheet_id") REFERENCES "account_sheets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "FK_fc5d925c8972ba27457e23e7c09" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "FK_3330f054416745deaa2cc130700" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD CONSTRAINT "FK_4cf26c3f972d014df5c68d503d2" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment_attachments" ADD CONSTRAINT "FK_39aef3786f3b1d9f366b14410bd" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment_attachments" ADD CONSTRAINT "FK_47aa5c2ec104c31216eee797220" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "medical_records" ADD CONSTRAINT "FK_e8e4f12885af7ccc4f3ebd9f091" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "medical_records" ADD CONSTRAINT "FK_43e2800e756c913a6c7a07cc271" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "medical_records" ADD CONSTRAINT "FK_4185307f688fcdf88d700b23631" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "medical_record_files" ADD CONSTRAINT "FK_1ffc3b4d53788f6d109f7b002b6" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "medical_record_files" ADD CONSTRAINT "FK_e81a68fb384e237a7bc3a5d9fa2" FOREIGN KEY ("medical_record_id") REFERENCES "medical_records"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "patients" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "doctors" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "appointment_payments" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "appointment_attachments" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "medical_records" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "medical_record_files" ENABLE ROW LEVEL SECURITY`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "medical_record_files" DROP CONSTRAINT "FK_e81a68fb384e237a7bc3a5d9fa2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "medical_record_files" DROP CONSTRAINT "FK_1ffc3b4d53788f6d109f7b002b6"`,
    );
    await queryRunner.query(`ALTER TABLE "medical_records" DROP CONSTRAINT "FK_4185307f688fcdf88d700b23631"`);
    await queryRunner.query(`ALTER TABLE "medical_records" DROP CONSTRAINT "FK_43e2800e756c913a6c7a07cc271"`);
    await queryRunner.query(`ALTER TABLE "medical_records" DROP CONSTRAINT "FK_e8e4f12885af7ccc4f3ebd9f091"`);
    await queryRunner.query(
      `ALTER TABLE "appointment_attachments" DROP CONSTRAINT "FK_47aa5c2ec104c31216eee797220"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment_attachments" DROP CONSTRAINT "FK_39aef3786f3b1d9f366b14410bd"`,
    );
    await queryRunner.query(`ALTER TABLE "appointments" DROP CONSTRAINT "FK_4cf26c3f972d014df5c68d503d2"`);
    await queryRunner.query(`ALTER TABLE "appointments" DROP CONSTRAINT "FK_3330f054416745deaa2cc130700"`);
    await queryRunner.query(`ALTER TABLE "appointments" DROP CONSTRAINT "FK_fc5d925c8972ba27457e23e7c09"`);
    await queryRunner.query(
      `ALTER TABLE "appointment_payments" DROP CONSTRAINT "FK_58d3dca90eb59d5540740c50ee6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment_payments" DROP CONSTRAINT "FK_d34297e2dc55119c5ce82723453"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment_payments" DROP CONSTRAINT "FK_ff37f6d5c85b564adaaf30ca292"`,
    );
    await queryRunner.query(`ALTER TABLE "patients" DROP CONSTRAINT "FK_d739f6dc6345fc9f9a508147b00"`);
    await queryRunner.query(`ALTER TABLE "doctors" DROP CONSTRAINT "FK_dc5bf45b7d5a46ec1345ff033d5"`);
    await queryRunner.query(`ALTER TABLE "doctors" DROP CONSTRAINT "FK_efbb5ff2cfbc55ca8f22d1006d8"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e81a68fb384e237a7bc3a5d9fa"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_1ffc3b4d53788f6d109f7b002b"`);
    await queryRunner.query(`DROP TABLE "medical_record_files"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_255b0e5480ecd34e12f1fe92bd"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_4185307f688fcdf88d700b2363"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_43e2800e756c913a6c7a07cc27"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e8e4f12885af7ccc4f3ebd9f09"`);
    await queryRunner.query(`DROP TABLE "medical_records"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_47aa5c2ec104c31216eee79722"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_39aef3786f3b1d9f366b14410b"`);
    await queryRunner.query(`DROP TABLE "appointment_attachments"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e432a12f17b3bdd13522abceb1"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_appointments_number"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3007a47d97a542e63b3308a69b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_18cafb5a1d68239170fd5cebf2"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_6b8e84de5d15269b7f79187992"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_4cf26c3f972d014df5c68d503d"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3330f054416745deaa2cc13070"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fc5d925c8972ba27457e23e7c0"`);
    await queryRunner.query(`DROP TABLE "appointments"`);
    await queryRunner.query(`DROP TYPE "public"."appointment_source"`);
    await queryRunner.query(`DROP TYPE "public"."appointment_status"`);
    await queryRunner.query(`DROP TYPE "public"."visit_type"`);
    await queryRunner.query(`DROP TYPE "public"."appointment_mode"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_58d3dca90eb59d5540740c50ee"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a8f83b1c023005e7b9b914e7d3"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d2b6c9b8ddfb4c28d653e016f4"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d34297e2dc55119c5ce8272345"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ff37f6d5c85b564adaaf30ca29"`);
    await queryRunner.query(`DROP TABLE "appointment_payments"`);
    await queryRunner.query(`DROP TYPE "public"."payment_method"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_patients_phone_last9"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d739f6dc6345fc9f9a508147b0"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_747a6ed52efc30afa8c14226ee"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_bfa842b49716926e581e54ff2d"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_0ad275694af4c16b190251f54c"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_779ac2dcf355f2982db53f4df6"`);
    await queryRunner.query(`DROP TABLE "patients"`);
    await queryRunner.query(`DROP TYPE "public"."bhrt_status"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_doctors_staff"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_bb6b34d0edf46148f12dcd0868"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_8921f61b3c526e57009c0157ce"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_efbb5ff2cfbc55ca8f22d1006d"`);
    await queryRunner.query(`DROP TABLE "doctors"`);
    await queryRunner.query(`DROP TYPE "public"."doctor_status"`);
  }
}

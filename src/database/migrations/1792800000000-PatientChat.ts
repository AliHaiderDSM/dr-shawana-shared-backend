import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PatientChat1792800000000 implements MigrationInterface {
  name = 'PatientChat1792800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "chat_conversations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "patient_id" uuid NOT NULL,
        "doctor_id" uuid NOT NULL,
        "last_message_at" TIMESTAMP WITH TIME ZONE,
        "last_message_preview" character varying(200),
        "patient_unread" integer NOT NULL DEFAULT 0,
        "doctor_unread" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chat_conversations" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_chat_conversations_pair" UNIQUE ("patient_id", "doctor_id"),
        CONSTRAINT "FK_chat_conversations_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_chat_conversations_doctor" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_conversations_doctor" ON "chat_conversations" ("doctor_id", "last_message_at")`,
    );
    await queryRunner.query(
      `CREATE TABLE "chat_messages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "conversation_id" uuid NOT NULL,
        "sender" character varying(10) NOT NULL,
        "sender_staff_id" uuid,
        "body" text,
        "file_path" text,
        "file_name" character varying(255),
        "file_type" character varying(100),
        "file_size" integer,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chat_messages" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_chat_messages_sender" CHECK ("sender" IN ('patient', 'doctor')),
        CONSTRAINT "CHK_chat_messages_content" CHECK ("body" IS NOT NULL OR "file_path" IS NOT NULL),
        CONSTRAINT "FK_chat_messages_conversation" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_messages_conversation" ON "chat_messages" ("conversation_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE TABLE "patient_push_tokens" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "patient_id" uuid NOT NULL,
        "session_id" uuid,
        "token" character varying(255) NOT NULL,
        "platform" character varying(20),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_patient_push_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_patient_push_tokens_token" UNIQUE ("token"),
        CONSTRAINT "FK_patient_push_tokens_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE
      )`,
    );
    for (const table of ['chat_conversations', 'chat_messages', 'patient_push_tokens']) {
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "patient_push_tokens"`);
    await queryRunner.query(`DROP TABLE "chat_messages"`);
    await queryRunner.query(`DROP TABLE "chat_conversations"`);
  }
}

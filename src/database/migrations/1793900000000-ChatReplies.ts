import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class ChatReplies1793900000000 implements MigrationInterface {
  name = 'ChatReplies1793900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chat_messages" ADD "reply_to_id" uuid`);
    await queryRunner.query(`ALTER TABLE "chat_messages" ADD "duration_ms" integer`);
    await queryRunner.query(
      `ALTER TABLE "chat_messages" ADD CONSTRAINT "FK_chat_messages_reply_to" FOREIGN KEY ("reply_to_id") REFERENCES "chat_messages"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chat_messages" DROP CONSTRAINT "FK_chat_messages_reply_to"`);
    await queryRunner.query(`ALTER TABLE "chat_messages" DROP COLUMN "duration_ms"`);
    await queryRunner.query(`ALTER TABLE "chat_messages" DROP COLUMN "reply_to_id"`);
  }
}

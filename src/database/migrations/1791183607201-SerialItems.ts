import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SerialItems1791183607201 implements MigrationInterface {
  name = 'SerialItems1791183607201';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."inventory_item_status" AS ENUM('in_stock', 'sold', 'returned', 'quarantined', 'damaged', 'expired', 'supplier_returned', 'dispatched', 'written_off')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."inventory_item_source" AS ENUM('stock_in', 'production', 'labelled')`,
    );
    await queryRunner.query(
      `CREATE TABLE "inventory_items" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "serial" character varying(30) NOT NULL, "serial_no" bigint NOT NULL, "product_id" uuid NOT NULL, "batch_id" uuid, "status" "public"."inventory_item_status" NOT NULL DEFAULT 'in_stock', "source_type" "public"."inventory_item_source" NOT NULL, "source_id" uuid, "received_on" date NOT NULL, "sale_id" uuid, "sold_on" date, "sale_return_item_id" uuid, "stock_out_id" uuid, CONSTRAINT "PK_cf2f451407242e132547ac19169" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_687d174ee41f46d2ee4b0a241a" ON "inventory_items"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8e17955a29e8b63bb8cec3d32c" ON "inventory_items"  ("product_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_68d3c33363a708a71b44aab127" ON "inventory_items"  ("batch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f271fa0df347ddbef1e5ba9659" ON "inventory_items"  ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6d24554b78a8ed39f63fdfec78" ON "inventory_items"  ("sale_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e053ebf880242255d38173632c" ON "inventory_items"  ("sale_return_item_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bf4fc838b269e5e8570ebf6f7b" ON "inventory_items"  ("stock_out_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_42085271e884dd814eff8969f4" ON "inventory_items"  ("source_type", "source_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4a8dcef0dce0115f8ca2f70607" ON "inventory_items"  ("branch_id", "product_id", "status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_inventory_items_serial" ON "inventory_items"  ("serial") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."inventory_item_event_type" AS ENUM('received', 'produced', 'labelled', 'sold', 'sale_edited', 'sale_deleted', 'returned', 'return_cancelled', 'quarantined', 'restocked', 'damaged', 'expired', 'supplier_returned', 'dispatched', 'dispatch_cancelled', 'written_off')`,
    );
    await queryRunner.query(
      `CREATE TABLE "inventory_item_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "item_id" uuid NOT NULL, "branch_id" uuid NOT NULL, "type" "public"."inventory_item_event_type" NOT NULL, "reference_type" character varying(40), "reference_id" uuid, "reference_label" character varying(60), "note" text, "created_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_3c52813c8b1d6e426e15b4bd681" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a31c11d0dff6543f45d7300d83" ON "inventory_item_events"  ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9916be5338145ad4aec8007860" ON "inventory_item_events"  ("item_id", "created_at") `,
    );
    await queryRunner.query(`ALTER TABLE "products" ADD "track_serials" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(
      `ALTER TABLE "inventory_items" ADD CONSTRAINT "FK_687d174ee41f46d2ee4b0a241ae" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_items" ADD CONSTRAINT "FK_8e17955a29e8b63bb8cec3d32c5" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_items" ADD CONSTRAINT "FK_68d3c33363a708a71b44aab127a" FOREIGN KEY ("batch_id") REFERENCES "product_batches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_item_events" ADD CONSTRAINT "FK_0ff6dc6fa18c1767be2baba7e5e" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_item_events" ADD CONSTRAINT "FK_a31c11d0dff6543f45d7300d83d" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`CREATE SEQUENCE "inventory_item_serial_seq" AS bigint START 1`);
    await queryRunner.query(`ALTER TABLE "inventory_items" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "inventory_item_events" ENABLE ROW LEVEL SECURITY`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP SEQUENCE "inventory_item_serial_seq"`);
    await queryRunner.query(
      `ALTER TABLE "inventory_item_events" DROP CONSTRAINT "FK_a31c11d0dff6543f45d7300d83d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_item_events" DROP CONSTRAINT "FK_0ff6dc6fa18c1767be2baba7e5e"`,
    );
    await queryRunner.query(`ALTER TABLE "inventory_items" DROP CONSTRAINT "FK_68d3c33363a708a71b44aab127a"`);
    await queryRunner.query(`ALTER TABLE "inventory_items" DROP CONSTRAINT "FK_8e17955a29e8b63bb8cec3d32c5"`);
    await queryRunner.query(`ALTER TABLE "inventory_items" DROP CONSTRAINT "FK_687d174ee41f46d2ee4b0a241ae"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "track_serials"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_9916be5338145ad4aec8007860"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a31c11d0dff6543f45d7300d83"`);
    await queryRunner.query(`DROP TABLE "inventory_item_events"`);
    await queryRunner.query(`DROP TYPE "public"."inventory_item_event_type"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_inventory_items_serial"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_4a8dcef0dce0115f8ca2f70607"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_42085271e884dd814eff8969f4"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_bf4fc838b269e5e8570ebf6f7b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e053ebf880242255d38173632c"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_6d24554b78a8ed39f63fdfec78"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f271fa0df347ddbef1e5ba9659"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_68d3c33363a708a71b44aab127"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_8e17955a29e8b63bb8cec3d32c"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_687d174ee41f46d2ee4b0a241a"`);
    await queryRunner.query(`DROP TABLE "inventory_items"`);
    await queryRunner.query(`DROP TYPE "public"."inventory_item_source"`);
    await queryRunner.query(`DROP TYPE "public"."inventory_item_status"`);
  }
}

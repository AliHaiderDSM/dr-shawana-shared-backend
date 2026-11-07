import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class StockHolds1795000000000 implements MigrationInterface {
  name = 'StockHolds1795000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."stock_hold_reason" AS ENUM('damaged', 'expired', 'label_issue', 'other')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."stock_hold_status" AS ENUM('open', 'released', 'written_off', 'supplier_returned')`,
    );
    await queryRunner.query(
      `CREATE TABLE "stock_holds" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "hold_no" varchar(30) NOT NULL,
        "branch_id" uuid NOT NULL,
        "item_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "batch_id" uuid,
        "reason" "public"."stock_hold_reason" NOT NULL,
        "note" varchar(500),
        "sale_id" uuid,
        "stock_request_id" uuid,
        "status" "public"."stock_hold_status" NOT NULL DEFAULT 'open',
        "decision_note" varchar(500),
        "decided_by" uuid,
        "decided_at" timestamptz,
        "write_off_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        CONSTRAINT "PK_stock_holds" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_stock_holds_hold_no" UNIQUE ("hold_no"),
        CONSTRAINT "FK_stock_holds_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_stock_holds_item" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_stock_holds_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_stock_holds_batch" FOREIGN KEY ("batch_id") REFERENCES "product_batches"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_stock_holds_sale" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_stock_holds_request" FOREIGN KEY ("stock_request_id") REFERENCES "stock_requests"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_stock_holds_write_off" FOREIGN KEY ("write_off_id") REFERENCES "stock_write_offs"("id") ON DELETE SET NULL
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_stock_holds_open_item" ON "stock_holds" ("item_id") WHERE "status" = 'open'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_stock_holds_branch_status" ON "stock_holds" ("branch_id", "status")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_stock_holds_sale" ON "stock_holds" ("sale_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_stock_holds_request" ON "stock_holds" ("stock_request_id")`);
    await queryRunner.query(`ALTER TABLE "stock_holds" ENABLE ROW LEVEL SECURITY`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "stock_holds"`);
    await queryRunner.query(`DROP TYPE "public"."stock_hold_status"`);
    await queryRunner.query(`DROP TYPE "public"."stock_hold_reason"`);
  }
}

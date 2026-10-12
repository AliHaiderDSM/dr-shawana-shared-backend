import type { MigrationInterface, QueryRunner } from 'typeorm';

export class StockRequests1791900000000 implements MigrationInterface {
  name = 'StockRequests1791900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."stock_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled', 'sent', 'received')`,
    );
    await queryRunner.query(
      `CREATE TABLE "stock_requests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "deleted_by" uuid,
        "branch_id" uuid NOT NULL,
        "request_no" character varying(30) NOT NULL,
        "status" "public"."stock_request_status" NOT NULL DEFAULT 'pending',
        "note" character varying(1000),
        "decided_by" uuid,
        "decided_at" TIMESTAMP WITH TIME ZONE,
        "decision_note" character varying(500),
        "sent_at" TIMESTAMP WITH TIME ZONE,
        "received_at" TIMESTAMP WITH TIME ZONE,
        "received_by" uuid,
        CONSTRAINT "PK_stock_requests" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_stock_requests_no" UNIQUE ("request_no"),
        CONSTRAINT "FK_stock_requests_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_stock_requests_branch" ON "stock_requests" ("branch_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_stock_requests_status" ON "stock_requests" ("status")`);
    await queryRunner.query(
      `CREATE TABLE "stock_request_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "request_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "qty" numeric(12,3) NOT NULL,
        "approved_qty" numeric(12,3),
        "note" character varying(500),
        CONSTRAINT "PK_stock_request_items" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_stock_request_items_qty" CHECK ("qty" > 0 AND ("approved_qty" IS NULL OR "approved_qty" >= 0)),
        CONSTRAINT "FK_stock_request_items_request" FOREIGN KEY ("request_id") REFERENCES "stock_requests"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_stock_request_items_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_stock_request_items_request" ON "stock_request_items" ("request_id")`,
    );

    await queryRunner.query(`ALTER TABLE "stock_outs" ADD "transfer_no" character varying(30)`);
    await queryRunner.query(`ALTER TABLE "stock_outs" ADD "stock_request_id" uuid`);
    await queryRunner.query(`ALTER TABLE "stock_outs" ADD "received_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "stock_outs" ADD "received_by" uuid`);
    await queryRunner.query(
      `ALTER TABLE "stock_outs" ADD CONSTRAINT "FK_stock_outs_stock_request" FOREIGN KEY ("stock_request_id") REFERENCES "stock_requests"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_stock_outs_transfer_no" ON "stock_outs" ("transfer_no")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_stock_outs_stock_request" ON "stock_outs" ("stock_request_id")`,
    );
    await queryRunner.query(
      `UPDATE "stock_outs" o SET "received_at" = o."created_at", "received_by" = o."created_by",
              "transfer_no" = 'TR-' || to_char(o."created_at", 'YYMMDDHH24MISS')
        WHERE o."to_branch_id" IS NOT NULL`,
    );

    await queryRunner.query(`ALTER TABLE "discount_requests" ADD "request_no" character varying(30)`);
    await queryRunner.query(
      `UPDATE "discount_requests" r SET "request_no" = b."code" || '-DR-' || lpad(n.seq::text, 6, '0')
         FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY branch_id ORDER BY created_at) AS seq FROM "discount_requests") n,
              "branches" b
        WHERE n.id = r.id AND b.id = r.branch_id`,
    );
    await queryRunner.query(
      `INSERT INTO "document_sequences" ("branch_id", "key", "last_value")
       SELECT branch_id, 'discount_request', COUNT(*) FROM "discount_requests" GROUP BY branch_id
       ON CONFLICT DO NOTHING`,
    );
    await queryRunner.query(`ALTER TABLE "discount_requests" ALTER COLUMN "request_no" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "discount_requests" ADD CONSTRAINT "UQ_discount_requests_no" UNIQUE ("request_no")`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."write_off_reason" AS ENUM('expired', 'damaged', 'lost', 'adjustment')`,
    );
    await queryRunner.query(
      `CREATE TABLE "stock_write_offs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "deleted_by" uuid,
        "branch_id" uuid NOT NULL,
        "write_off_no" character varying(30) NOT NULL,
        "product_id" uuid NOT NULL,
        "batch_id" uuid,
        "qty" numeric(12,3) NOT NULL,
        "reason" "public"."write_off_reason" NOT NULL,
        "note" character varying(500),
        "date" date NOT NULL,
        CONSTRAINT "PK_stock_write_offs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_stock_write_offs_no" UNIQUE ("write_off_no"),
        CONSTRAINT "FK_stock_write_offs_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_stock_write_offs_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_stock_write_offs_batch" FOREIGN KEY ("batch_id") REFERENCES "product_batches"("id") ON DELETE SET NULL
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_stock_write_offs_branch" ON "stock_write_offs" ("branch_id", "date")`,
    );

    for (const table of ['stock_requests', 'stock_request_items', 'stock_write_offs']) {
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "stock_write_offs"`);
    await queryRunner.query(`DROP TYPE "public"."write_off_reason"`);
    await queryRunner.query(`ALTER TABLE "discount_requests" DROP CONSTRAINT "UQ_discount_requests_no"`);
    await queryRunner.query(`ALTER TABLE "discount_requests" DROP COLUMN "request_no"`);
    await queryRunner.query(`ALTER TABLE "stock_outs" DROP CONSTRAINT "FK_stock_outs_stock_request"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_stock_outs_transfer_no"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_stock_outs_stock_request"`);
    await queryRunner.query(`ALTER TABLE "stock_outs" DROP COLUMN "received_by"`);
    await queryRunner.query(`ALTER TABLE "stock_outs" DROP COLUMN "received_at"`);
    await queryRunner.query(`ALTER TABLE "stock_outs" DROP COLUMN "stock_request_id"`);
    await queryRunner.query(`ALTER TABLE "stock_outs" DROP COLUMN "transfer_no"`);
    await queryRunner.query(`DROP TABLE "stock_request_items"`);
    await queryRunner.query(`DROP TABLE "stock_requests"`);
    await queryRunner.query(`DROP TYPE "public"."stock_request_status"`);
  }
}

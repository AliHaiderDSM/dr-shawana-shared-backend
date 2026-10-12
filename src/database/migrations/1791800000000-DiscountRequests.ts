import type { MigrationInterface, QueryRunner } from 'typeorm';

export class DiscountRequests1791800000000 implements MigrationInterface {
  name = 'DiscountRequests1791800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."discount_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled', 'used')`,
    );
    await queryRunner.query(
      `CREATE TABLE "discount_requests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_by" uuid,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "deleted_by" uuid,
        "branch_id" uuid NOT NULL,
        "product_id" uuid,
        "bundle_id" uuid,
        "qty" numeric(12,3) NOT NULL,
        "unit_price" numeric(12,2) NOT NULL,
        "discount_percent" numeric(5,2) NOT NULL,
        "note" character varying(500),
        "status" "public"."discount_request_status" NOT NULL DEFAULT 'pending',
        "decided_by" uuid,
        "decided_at" TIMESTAMP WITH TIME ZONE,
        "decision_note" character varying(500),
        "sale_id" uuid,
        CONSTRAINT "PK_discount_requests" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_discount_requests_target" CHECK ((("product_id" IS NOT NULL)::int + ("bundle_id" IS NOT NULL)::int) = 1),
        CONSTRAINT "CHK_discount_requests_percent" CHECK ("discount_percent" > 0 AND "discount_percent" < 100),
        CONSTRAINT "FK_discount_requests_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_discount_requests_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_discount_requests_bundle" FOREIGN KEY ("bundle_id") REFERENCES "bundles"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_discount_requests_sale" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_discount_requests_branch" ON "discount_requests" ("branch_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_discount_requests_product" ON "discount_requests" ("product_id")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_discount_requests_status" ON "discount_requests" ("status")`);
    await queryRunner.query(`CREATE INDEX "IDX_discount_requests_sale" ON "discount_requests" ("sale_id")`);
    await queryRunner.query(`ALTER TABLE "discount_requests" ENABLE ROW LEVEL SECURITY`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "discount_requests"`);
    await queryRunner.query(`DROP TYPE "public"."discount_request_status"`);
  }
}

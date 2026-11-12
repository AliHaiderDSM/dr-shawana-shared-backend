import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class SaleReplacements1795200000000 implements MigrationInterface {
  name = 'SaleReplacements1795200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."stock_movement_type" ADD VALUE IF NOT EXISTS 'replacement'`,
    );
    await queryRunner.query(`CREATE TYPE "public"."sale_replacement_status" AS ENUM('pending', 'sent')`);
    await queryRunner.query(
      `CREATE TABLE "sale_replacements" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "replacement_seq" integer NOT NULL, "replacement_no" character varying(30) NOT NULL, "sale_return_id" uuid NOT NULL, "sale_id" uuid NOT NULL, "date" date NOT NULL, "note" text, "status" "public"."sale_replacement_status" NOT NULL DEFAULT 'pending', "sent_on" date, "sent_by" uuid, CONSTRAINT "PK_d6ebcbf66436c040452615ec67d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e8566a9c83c11ffd1cc14e1794" ON "sale_replacements" ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e34ecdee6921daee3438618e1f" ON "sale_replacements" ("replacement_no") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_646d1497665bd6305d24f8462e" ON "sale_replacements" ("sale_return_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_48b30c3f16e631b863006cc078" ON "sale_replacements" ("sale_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5a65bfaf7e014cbe05e419d661" ON "sale_replacements" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1ddfbecf94d9f0b86999937cfd" ON "sale_replacements" ("branch_id", "date") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_sale_replacements_branch_seq" ON "sale_replacements" ("branch_id", "replacement_seq") `,
    );
    await queryRunner.query(
      `CREATE TABLE "sale_replacement_items" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "branch_id" uuid NOT NULL, "sale_replacement_id" uuid NOT NULL, "product_id" uuid NOT NULL, "qty" numeric(12,3) NOT NULL, CONSTRAINT "CHK_sale_replacement_items_qty" CHECK ("qty" > 0), CONSTRAINT "PK_b6b463398861525e72fd0c1096d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2faf4ba45f4cd8fc8a2d264d17" ON "sale_replacement_items" ("branch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4f74ff58eed5f08380d6317b55" ON "sale_replacement_items" ("sale_replacement_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_82f381ae8b0ebd387605765351" ON "sale_replacement_items" ("product_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_replacements" ADD CONSTRAINT "FK_e8566a9c83c11ffd1cc14e1794d" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_replacements" ADD CONSTRAINT "FK_646d1497665bd6305d24f8462ef" FOREIGN KEY ("sale_return_id") REFERENCES "sale_returns"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_replacements" ADD CONSTRAINT "FK_48b30c3f16e631b863006cc0788" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_replacement_items" ADD CONSTRAINT "FK_2faf4ba45f4cd8fc8a2d264d17e" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_replacement_items" ADD CONSTRAINT "FK_4f74ff58eed5f08380d6317b550" FOREIGN KEY ("sale_replacement_id") REFERENCES "sale_replacements"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sale_replacement_items" ADD CONSTRAINT "FK_82f381ae8b0ebd387605765351a" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "sale_replacements" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "sale_replacement_items" ENABLE ROW LEVEL SECURITY`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "sale_replacement_items"`);
    await queryRunner.query(`DROP TABLE "sale_replacements"`);
    await queryRunner.query(`DROP TYPE "public"."sale_replacement_status"`);
    await queryRunner.query(
      `CREATE TYPE "public"."stock_movement_type_old" AS ENUM('purchase_in', 'stock_in', 'stock_out', 'sale', 'sale_return', 'sale_edit_adjust', 'manufacturing_in', 'adjustment')`,
    );
    await queryRunner.query(
      `ALTER TABLE "stock_movements" ALTER COLUMN "type" TYPE "public"."stock_movement_type_old" USING "type"::"text"::"public"."stock_movement_type_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."stock_movement_type"`);
    await queryRunner.query(`ALTER TYPE "public"."stock_movement_type_old" RENAME TO "stock_movement_type"`);
  }
}

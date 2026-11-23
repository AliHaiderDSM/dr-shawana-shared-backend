# posSoft sales import

Two commands move posSoft's sales into this system:

| Command | What it does |
|---|---|
| `npm run db:reset -- --confirm <db name>` | Empties every table except `typeorm_migrations`, then creates the main warehouse (`MAINWH`) again. Without `--confirm` it only prints the database name. |
| `npm run import:possoft-sales -- --file <dump.sql> [--dry-run]` | Reads a posSoft MySQL data export and adds its sales. `--dry-run` does everything inside a transaction, prints the summary, then rolls it back. |
| `npm run import:possoft-catalog -- --file <dump.sql> [--dry-run]` | Adds posSoft's categories and products to the main warehouse and links every branch product with the same name to its warehouse product. Safe to run again: existing warehouse products (same name) are reused. For databases filled by an earlier version of the sales import. |

The import refuses to run when the `sales` table already has rows, so it cannot be added twice.

## What the import creates

- **Branches:** `sale_city` picks the branch: Lahore → `LHR`, Islamabad → `ISB`, Multan → `MUL`, Karachi → `KHI`. Any other city goes to `LHR` and is counted under `skipped.unknownCity`. A branch that does not exist is created; a branch with online sales gets `online_sales = true`.
- **Patients:** one per customer used by a kept sale. Customers whose phones share the same last 9 digits become one patient (`patientsMerged`). A phone with fewer than 10 digits keeps its text, and gets the placeholder key `possoft-<cust_id>` (`patientsWithoutValidPhone`).
- **Main warehouse catalog** (`import-catalog.ts`): every posSoft category that is not deleted, and every posSoft product, go to the main warehouse (`MAINWH`), which is the catalog the Super Admin sees. Products deleted in posSoft are imported as deleted, so the list matches posSoft's product page; they still exist for old sales. The sale price is the newest `product_details` price. Images are not copied.
- **Branch products:** each branch gets a copy of the products it sold, in a category of the same name, linked to the warehouse product by `origin_product_id` (as a stock transfer would). Deleted posSoft products are `inactive` there.
- **Banks and account sheets:** shared by every branch, like accounts made in the dashboard: one row per posSoft account, owned by the main warehouse. Each branch sees only its own payments in them. A sheet whose bank name has the word "cash" (for example "Cash bank", but not "Jazzcash") is a cash sheet. Accounts deleted in posSoft are imported as deleted, so the list matches posSoft. Payments saved in posSoft with no account (`spay_receiver_sheet_id = 0`) go to one deleted account, "posSoft: no account chosen" (`paymentsWithoutAccount`), the same way posSoft left them out of every balance.
- **Sales:** posSoft rows with `close = 0` are skipped. Each branch numbers its sales from `<CODE>-000001` by sale date; the note keeps `posSoft sale #<id>`. `sale_discount` is the percent and `sale_after_discount` the discount amount. Online sales are `delivered` when `sale_status = 1`, otherwise `pending`.
- **Items:** lines with `close = 0` or a quantity of 0 are skipped.
- **Payments:** `Online Payment` rows are online (sender bank, title and number kept); everything else is cash. Rows with an amount of 0 are skipped. All payments are marked approved, so account balances include them. Payment screenshots are not copied.
- **Not touched:** stock ledgers (posSoft sales never reduced stock), journal entries and audit logs. `received`, `remaining` and the payment status come from the imported payments.
- **Sequences:** `document_sequences` continue after the last imported invoice of each branch.

## Steps on the live server

1. In Hostinger phpMyAdmin, export `pos_dsm` as SQL with structure and data (at least the tables `sales`, `sale_products`, `sale_payments`, `customers`, `products`, `product_details`, `categories`, `banks`, `accounts_sheet`). Copy the file to the server outside the app folder, for example `~/possoft/pos_dsm.sql`. It holds patient data: never commit it.
2. Deploy this code (merge `staging` into `main`, then `~/deploy.sh`).
3. Stop the API so nothing writes during the reset: `pm2 stop dsm-api`.
4. Back up the database:
   ```bash
   cd ~/dr-shawana-shared-backend
   mkdir -p ~/backups
   set -a; . ./.env; set +a
   pg_dump "$DATABASE_URL" -Fc -f ~/backups/dsm-before-possoft-$(date +%F).dump
   ls -lh ~/backups
   ```
5. `npm run db:reset` prints the database name. Run it again with `-- --confirm <that name>`.
6. Put `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD` in `.env`, run `npm run seed:super-admin`, then remove the password from `.env`.
7. `npm run import:possoft-sales -- --file ~/possoft/pos_dsm.sql --dry-run`, check the summary, then run it again without `--dry-run`.
8. `npm run seed` (company info, and the prescription catalogue for the new branches).
9. `pm2 restart dsm-api`, sign in as the Super Admin, then add staff, doctors, the dispatch branch and stock again.
10. Delete the export from the server and from every computer it was copied to.

To undo: `pg_restore --clean --if-exists -d "$DATABASE_URL" ~/backups/dsm-before-possoft-<date>.dump` with the API stopped.

Uploaded files in R2 are not deleted by the reset.

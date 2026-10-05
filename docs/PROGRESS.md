# Build Progress

Build plan: `../progress/backend.md`. One phase per session; each phase ends with lint, typecheck and tests passing.

| Phase | Scope                                                                  | Status               |
| ----- | ---------------------------------------------------------------------- | -------------------- |
| B0    | Project setup and rules                                                | ✅ Done (2026-09-30) |
| B1    | Branches, staff, roles and auth                                        | ✅ Done (2026-09-30) |
| B2    | Master data: categories, products, bundles, suppliers, banks, accounts | ✅ Done (2026-09-30) |
| B3    | Inventory ledger, stock in/out and manufacturing                       | ✅ Done (2026-09-30) |
| B4    | Patients, doctors and appointments                                     | ✅ Done (2026-09-30) |
| B5    | Consultation, clinical records and prescriptions                       | ✅ Done (2026-09-30) |
| B6    | POS sales, payments and delivery                                       | ✅ Done (2026-09-30) |
| B7    | Accounts, finance, reports and dashboard KPIs                          | ✅ Done (2026-09-30) |
| B6b   | Sale returns (inspection, refunds) and product barcodes                | ✅ Done (2026-10-01) |
| B6c   | Product batches, expiry and FEFO allocation                            | ✅ Done (2026-10-05) |
| B6d   | Labelled pieces (DSM serials), label printing and scanning             | ✅ Done (2026-10-05) |
| B6e   | Main Warehouse and transfers to branches                               | ✅ Done (2026-10-05) |
| B8    | Mobile app API (patients)                                              | ⏳ Next              |
| B9    | Data migration from posSoft                                            | Not started          |
| B10   | Hardening and deployment                                               | Not started          |

---

## Performance pass (done 2026-10-05)

- Root cause: every query is one network round trip to Supabase in ap-south-1 (Mumbai), about 70 ms from Pakistan. Production also ran the function in `iad1` (Washington), which put about 250 ms of round trip on every query. `vercel.json` now sets `"regions": ["bom1"]`.
- `lib/perf.ts` adds a `Server-Timing` header to every response: `db` time with the query count, `app` time, and `total` time. It is exposed through CORS, so the browser DevTools Network → Timing tab shows it.
- Auth (`staffRepository.findByIdForAuth`) uses one QueryBuilder join. `findOne` with relations ran an extra DISTINCT query on every request.
- Dashboard KPIs run their independent queries with `Promise.all`. The SQL is unchanged.
- `paginate` runs the page query and the count in parallel. `toOneJoins` uses OFFSET/LIMIT instead of a DISTINCT id query; it is used for sales and stock documents.
- The sales list runs its totals and rows in parallel.
- EXPLAIN ANALYZE on Supabase shows index scans under 0.2 ms, so no new indexes were added.
- No duplicate API calls were found from the dashboard.

## B6e — Main Warehouse and transfers (done 2026-10-05)

Stock now flows **Factory → Main Warehouse → Branch → Sale**.

- **Main Warehouse:** `branches.kind` is `warehouse` or `branch` and replaces the old "head office" flag. The migration creates one warehouse (`MAINWH`, "Main Warehouse"). Only the Super Admin can open it: it cannot get staff, cannot be deactivated or deleted, and cannot sell (sale → 409). It comes first in `/admin/branches/options`, which now returns `kind`.
- **Transfer:** in the warehouse, a Stock Out with `toBranchId` moves the stock to that branch in the same transaction:
  - The branch product is found by `products.origin_product_id`, else by the same name (then linked), else copied with its category.
  - Every batch keeps its number, dates and cost. Each batch arrives as a branch Stock In with `transfer_out_id`, marked "From Main Warehouse".
  - Labelled pieces keep their DSM serial and only change branch, product and batch. Their history shows Received (warehouse) → Sent out → Received (branch).
- The branch cannot edit or delete a transferred Stock In. Cancelling the transfer (deleting the warehouse Stock Out) works only while the branch has not sold or moved any of it; the stock and pieces then return to the warehouse. A transfer cannot change product, quantity or branch afterwards.
- Branches cannot transfer, and the warehouse cannot transfer to itself.
- **Branches receive stock only from the Main Warehouse:** once a warehouse exists, a branch Stock In or a purchase entry that adds stock (also a new product's first purchase) is a 409. The dashboard hides those buttons outside the warehouse.
- **Stock on the Stock Out line:** `GET /branch/inventory/stock` takes `productId`; Stock Out shows, under the chosen product, the stock on hand and every batch with its quantity and expiry.
- **The warehouse is not a branch:** `/admin/branches` lists only branches, and the dashboard branch breakdown leaves the warehouse out; it appears only in the branch switcher under its own heading. Branches cannot send stock out (409) and their menu has no Stock Out. The development seed no longer creates a Lahore branch: the Super Admin creates every branch.
- **Super Admin wording and view-only branches:** the warehouse is shown as **Super Admin Stock** (migration `SuperAdminStockName` renames it; transferred stock says "From Super Admin"). In a branch, the Super Admin only views: the dashboard hides every create, edit and delete action except branches, company, staff and doctors (stock work happens in Super Admin Stock). "Open branch dashboard" on a branch page opens that branch.
- **Report charts:** every report shows its main amount over time, and for the Super Admin across all branches a bar per branch; a Branch filter picks one branch.
- **Reports for the Super Admin:** reports no longer follow the branch switcher; they show every branch by default with a Branch filter on every report (product and other filters list the Super Admin Stock items, which match the branch products made from them). New **Branch stock** report (`/branch/reports/branch-stock`, like the posSoft inventory report): per branch and product, stock received from the Super Admin, sold, returned and now in the branch. Report prints with many columns use A4 landscape and a compact table; phone numbers are no longer formatted as amounts.
- **No "All branches" in the header:** the Super Admin always works inside a place; on login it is Super Admin Stock. There the dashboard, expiry alerts and View Sales cover every branch (the client sends no branchId for those while Super Admin Stock is selected). `GET /branch/sales` lists every branch for the Super Admin (with `branch`), and its product filter matches the branch products made from a Super Admin Stock product; opening a sale switches to its branch.
- **Inventory report filters like posSoft:** `supplierId` (stock in and purchases), `dispatcherId` and `toBranchId` (stock out), plus `branchSold` and `inBranch` for the chosen branch; the page adds Month, Supplier, Dispatcher and Stock To.
- **Labels by batch:** `GET /branch/inventory/items/batches` groups labelled pieces by product and batch (counts in stock, sold and other, first and last label; filters: search, product, batch, status). The Labels page opens on this view; a batch row expands into its pieces and prints its labels. `GET /branch/inventory/items` takes `withoutBatch=true`.
- **Expiry alerts:** `GET /branch/inventory/expiry-alerts?days=90` lists batches in stock that expire within 90 days (or already expired), soonest first. The Super Admin without a branch gets every branch and the Main Warehouse. Shown on the dashboard and the Stock page.
- **Dashboard:** the branch switcher shows the Main Warehouse on its own; in the warehouse, Patients & Care and Sales are hidden and Stock Out asks for "Transfer to branch"; branch Stock In marks transferred rows.
- Migration `MainWarehouse`, tested up, down, up and for drift.

**Verified:** lint, build and `npm test` (23 suites, 212 tests); a transfer, the Stock Out stock hint, the expiry alerts and the branch Stock In page driven in a browser.

---

## B6d — Labelled pieces: DSM serials (done 2026-10-05)

Added on request: the packs carry printed labels `DSM-000001`, `DSM-000002`, … and every physical piece is tracked.

- **Tables:** `inventory_items` (one row per piece: serial, product, batch, current branch, status, sale, stock out, return line) and `inventory_item_events` (the history of each piece). The sequence `inventory_item_serial_seq` numbers new labels; serials are unique across all branches. `products.track_serials` turns on the first time a product gets labels.
- **Statuses:** in_stock, sold, returned (awaiting inspection), quarantined, damaged, expired, supplier_returned, dispatched, written_off.
- **Stock In:** each line chooses labels `none`, `generate` (the system numbers one label per piece) or `existing` (packs already carry consecutive labels from `firstSerial`). A labelled product cannot be received without labels. Quantities are whole pieces. Overlapping labels are a 409 listing the clashes.
- **Labels already on the shelf:** `POST /branch/inventory/items/register` (product, batch, first label, count) labels stock that is on hand, up to the stock that has no label yet.
- **Sale:** `serials` on create and edit. A labelled product needs one scanned label per piece (422 `details.labels`); a label that is sold, of another product or branch, or of an expired batch is refused (422 `details.serials`). The stock comes from the scanned pieces' batches. Editing swaps pieces; deleting frees them.
- **Stock Out:** `serials` per line for labelled products; removing the entry brings the pieces back.
- **Returns:** labelled products need the returned labels, which must be sold on that sale. Each label becomes its own return line, so each piece is inspected on its own; restocking puts that exact piece back into its batch.
- **Production** of a labelled product numbers labels for the produced pieces. **Write-off** of a labelled batch takes the scanned labels. **Purchase entries** cannot add stock to a labelled product (use Stock In).
- Editing the product, quantity or batch of a stock entry of a labelled product is refused (delete and enter again). A stock in can be deleted only while none of its pieces has moved.
- **Endpoints:** `GET /branch/inventory/items`, `GET /branch/inventory/items/serial/:serial` (with history), `GET /branch/inventory/items/:itemId`, `POST /branch/inventory/items/register`, `GET /branch/inventory/products/:productId/serials`.
- **Locking:** the stock ledger now locks products `FOR NO KEY UPDATE`, so two receipts of the same product at the same moment no longer deadlock.
- **Dashboard:** Labels column on Stock In, a label print page (38×25 mm roll or A4 sheet, Code 128), scanning on Stock Out, POS, returns and write-off, a Labels page with each piece's history, label registration, and labels on the sale, return and product pages.
- Migration `SerialItems`, tested up, down, up and for drift.

**Important on go-live:** register the labels already stuck on packs **before** printing new labels from Stock In, so new numbers continue after the existing ones.

**Verified:** lint, typecheck, build and `npm test` (22 suites, 204 tests); Stock In with new labels, label printing, POS scanning, the label history and the product page driven in a browser.

---

## B6c — Product batches, expiry and FEFO (done 2026-10-05)

Added on request, from the piece-level tracking spec. The parts that fit this system are built at **batch level**. Per-piece serials (ITEM-000001), stock transfer between branches and printed labels are **not** built: without a label on each pack a serial cannot be read back at return time, and products are separate per branch.

- **Batches:** a new `product_batches` table (product, batch number, manufacturing date, expiry, supplier, purchase price), unique per product and batch number.
  - **Stock In** takes, per line, batch, manufacturing date, expiry and unit cost. A new batch number creates the batch; a repeated one adds to it (a different expiry is a 409; editing the stock-in entry corrects the batch). Dates need a batch number, and expiry cannot be before manufacturing.
  - **Production** (finished product) creates a batch named after the lab batch, with the production date as manufacturing date.
  - Purchase entries and older stock stay "no batch".
- **Ledger:** `stock_movements.batch_id`. Every movement now belongs to a batch (or none).
  - Sales, sale edits and stock outs that take stock are split across batches **FEFO**: the earliest expiry first, then old unbatched stock, then batches without expiry.
  - Sales and stock outs **never take an expired batch**. The 422 shortage then also reports `expired`.
  - Deleting or editing a document reverses into the same batches. Stock given back by a sale edit or a restocked return goes into the batches the sale took it from.
  - Concurrent receipts of the same new batch create one batch (the product row is locked).
- **Returns:** dispositions `quarantined` (held, decided later) and `expired` (written off). A return detail shows the batches the sale took (`soldBatches`) and where restocked items went (`restockedBatches`).
- **Endpoints:** `GET /branch/inventory/batches` (filters: product, search, status active/expiring/expired, inStockOnly), `GET /branch/inventory/batches/:batchId` (with every movement), `POST /branch/inventory/batches/:batchId/write-off` (`stock.update`; reason expired/damaged/lost/adjustment; an audited `adjustment` movement). `GET /branch/sales/:id` adds `batches`; stock balances add `expiredQuantity`; the product ledger adds `batchNo`.
- **Dashboard:** batch columns on Stock In, a "Batches & Expiry" page with batch history and write-off, batches on the product stock page and the sale page, expired stock on the Stock page, POS shows only sellable (not expired) stock, and the new return outcomes.
- Migration `ProductBatches`: the table with RLS, the new columns, the enum values and the `product_stock_balances` view with `expired_quantity`. Tested up, down, up and for drift.

**Verified:** lint, typecheck, build and `npm test` (21 suites, 191 tests) on the temporary local Postgres; the Stock In, Batches, batch detail, product stock and sale pages driven in a browser.

---

## B6b — Sale returns and product barcodes (done 2026-10-01)

Added on request; posSoft had only a "returned" status and no barcodes.

- **Barcodes:** `products.barcode` (the code printed on the pack), unique per branch. `GET /branch/products/barcode/:code` finds the scanned product (`products.view` or `stock.view`), and product search also matches barcodes.
- **Returns:** a new module, `/branch/returns`, with numbering `LHR-RET-000001`.
  - A return holds several products from one sale (part or all of it), a reason and a note. Quantities cannot exceed what is sold minus what was already returned (422 with `details.items`).
  - Returned goods do not go back into stock when they are received. Each item is inspected: **restocked** (a `sale_return` movement puts it back into stock), **damaged** (written off) or **supplier** (sent back). When every item is inspected the return is `completed`.
  - A return can be deleted only before any item is inspected.
  - An optional refund (amount, cash or online, the account it is paid from, date) cannot exceed the money received minus earlier refunds. It is set on creation or with `PUT /:id/refund`.
  - Refunds are credits in `account_movements`, so account balances drop. Dashboard revenue is net of refunds.
- **Sales:** marking an online sale `returned` now creates a pending return for everything still on the sale, instead of restocking straight away. A sale with returns cannot change its items or type, and cannot be deleted.
- **Permissions:** a new `returns` module.
  - Branch admin: everything.
  - Accountant, Front Desk and Team Manager: view and create.
  - Pharmacy and Store Keeper: view and update (inspection).
- Migration `ReturnsBarcodes`: two tables with RLS, the barcode column and index, and the `account_movements` view with refund rows. Tested up, down and for drift.
- **Fixed:** list search on camelCase columns (product batch, staff names, doctor name, account name, lab batch no) crashed with a 500 error. The search helper now maps them to their snake_case columns.

**Verified:** lint, typecheck and `npm test` (20 suites, 181 tests) on the temporary local Postgres.

---

## B6 — POS sales, payments and delivery (done 2026-09-30)

**Built** (migration `SalesPos`; RLS on every new table):

- **Sales:**
  - Invoice numbers are per branch (`LHR-000123`), taken from `document_sequences`.
  - Fields: patient (existing, or created inline), sale type office/online, sale city (defaults to the branch city), patient city snapshot, date and note.
  - Totals: subtotal, discount %, discount amount, total, received, remaining and payment status (unpaid/partial/paid).
  - Online sales also have a delivery status (pending/delivered/returned).
- **One transaction, everything on the server:**
  - Prices come from the product sale price. Client prices are ignored.
  - A bundle expands into its products at the bundle prices, keeping the bundle id on each line, as posSoft did.
  - Stock is checked with locked product rows. A shortfall gets 422 with `details.shortages`.
  - `sale` stock movements are written and payments inserted.
- **Discount:** a percentage, or posSoft's "Auto", which turns any unpaid part into the discount. The percent is then fixed, as posSoft's edit form does.
- **Editing:**
  - New items post only the difference as `sale_edit_adjust` movements.
  - Returning an online sale posts `sale_return`. A returned sale is final.
  - Delete reverses every movement and removes the payments.
  - Payments can be added, edited, given a proof or removed, and totals are recomputed each time. Everything is audited.
- **Front Desk / Team Manager:** they see all sales but change or delete only their own, as posSoft does.
- **Bill print data:** company and branch header, customer, items, totals, and cash/online payments.
- **Delivery slips** (delivery_print role): filters for customer, sale type, date range (today by default) and invoice-number range. The data is laid out two slips per page, and the "From" city is the branch (posSoft hard-coded Lahore).
- **List:** posSoft filters (entry by, customer, product, type, city, delivery and payment status, method, account, dates, invoice/patient search), with totals over every matching sale.

## B7 — Accounts, finance, reports and dashboard KPIs (done 2026-09-30)

**Built** (migration `AccountsReports`; RLS on every new table):

- **Journal** (posSoft General Entries):
  - `journal_entries` are numbered `LHR-JV-000001`; `journal_lines` each hold an account sheet or an expense category, a debit and a credit.
  - Debit must equal credit. The service checks it (422), and a deferred constraint trigger checks it in the database; posSoft never checked.
  - Edit replaces the lines. Branch Admin can edit and delete; the Accountant can view and create.
- **Expenses** (new; posSoft had none):
  - Expense categories and expenses (date, category, amount, paid-from account, note, private attachment).
  - Each expense posts its own journal entry: debit the category, credit the account. The entry follows the expense's edits and deletion.
- **`account_movements` view** (`security_invoker`, revoked from anon/authenticated): sale payments, appointment payments and journal lines per account. posSoft left appointment payments out.
- **Reports** (`/branch/reports/*`):
  - All take `format=csv`.
  - super_admin without `branchId` gets every branch, with a Branch column and a `byBranch` breakdown.
  - The reports: sale products, purchases, stock, appointments, appointment payments, doctor sales, patient history, finance, accounts balance and expenses.
  - The inventory report stays at `/branch/inventory/report` (B3).
  - Report details:
    - Doctor sales keeps posSoft's rule: sales of patients who ever had an appointment with the doctor. The commission is `doctors.commission_percent` (default 3%) instead of posSoft's hard-coded 3%/4%.
    - Accounts balance adds the opening balance and a brought-forward balance for a period. One account gives a dated ledger with a running balance.
    - Patient history gives one row per consultation: MRS items and scores, BMI, menopause stage, FSH/Estradiol/Total testosterone, treatments from the prescription, and still-on-treatment.
- **Dashboard** (`/branch/dashboard`), shaped by the role's permissions:
  - Patient and product counts.
  - Today and this month: sales (bills, qty, revenue) and appointments (count, amount). Doctors see only their own.
  - Revenue split, pending online deliveries, stock in/out and the low-stock count.
  - Yearly monthly series for sales, appointments and product quantities.
  - super_admin without `branchId` also gets a per-branch breakdown.
- **Roles:**
  - Buy, stock and patient-history reports: Branch Admin and Accountant, as in posSoft.
  - Doctor sales: also doctors, for their own sales.
  - Sale products: anyone with `sales.view`.
  - Finance and accounts: `accounts.view`. Expenses: `expenses.view`.

**Verified (B6 + B7)**

- lint and typecheck are clean. `npm test` passes 176/176.
- Both migrations ran on Supabase with no drift. RLS is on for all 8 new tables, with no policies. Both views are `security_invoker` and anon cannot select them.

## B5 — Consultation, clinical records and prescriptions (done 2026-09-30)

The field list was confirmed in `docs/CLINICAL_FIELDS.md` (decisions D1–D13 accepted as proposed).

**Built** (migration `ConsultationsPrescriptions`; RLS on every new table):

- **Consultations** (posSoft "Appointment Remarks"): one per appointment. `POST /branch/appointments/:id/consultation` opens it, or returns the one already open.
  - Each posSoft tab is a section in `consultation_sections` (`jsonb`), saved on its own with `PUT /:id/sections/:key` and validated by its own Zod schema:
    - basic_info, follow_up, medical_history, mrs_scale
    - additional_symptoms, imaging_results, clinical_assessment, referral, plans
  - Server-side rules:
    - BMI and category are computed from weight (kg) and height (decimal feet).
    - MRS scores (somatic, psychological, urogenital, total, %, severity) are computed and never stored.
    - The conditional required fields posSoft meant to enforce are enforced; hidden values are cleared.
    - "Not answered" is stored as `null`.
  - basic_info updates the patient's name, age, city and country, as posSoft does, with an audit entry. referral updates the date of birth.
  - "Top 3 things", "Major complaint" and "Current medications" are stored once per consultation and shared by medical_history and follow_up (D6).
  - Which sections apply:
    - follow_up is only for follow up visits.
    - referral opens once "Referred to specialist" is ticked in clinical_assessment.
    - `availableSections` tells the UI which tabs to show.
  - Other endpoints: list, detail, status (open/completed), delete (Branch Admin), referral-letter data, and MRS history per patient.
- **Blood work** (`blood_work_results`): one row per test (FSH, Estradiol, Testosterone free/total, DHEA-S, Vit D3, TSH, Ferritin, B12), with the posSoft unit as default. Results can be listed as rows and chart series, corrected and removed.
- **BHRT** (`bhrt_status_log`): on, off, recommended or other, with date, note and appointment. The newest entry sets `patients.bhrt_status`; other maps to none.
- **Medical records:** full CRUD, with type medical_record or imaging, several private files, and files added or removed later. Booking a B4 appointment uses the same service.
- **Prescriptions:**
  - `prescription_items_catalog` is per branch. `npm run seed` seeds it with 168 items from posSoft, and new branches get it on creation:
    - the 92 items on the current form, with the dose split from the label and "How to Use" as the default instructions;
    - legacy lab columns, the 42 prescription symptoms and the previous-template items, all inactive.
    - `code` holds the posSoft column name for the B9 migration.
  - A prescription (`PRE#<no>`) has patient, doctor, optional consultation, date, diagnosis, notes per section, plan of treatment, follow-up date and `template_version`.
  - `prescription_items` copy the catalog name, dose and instructions; each can be overridden, and custom items are allowed.
  - Editing replaces the item list. Create, update and delete are audited.
  - `GET /:id/print` returns the print data grouped in posSoft order with the section notes and a signed doctor-signature URL.
  - Doctors write and see only their own prescriptions. Only the Branch Admin deletes them and manages the catalog.
- **Doctor signature** (D11): an image in the private `doctor-signatures` bucket, used on prints instead of posSoft's hardcoded ids.
- **Patient timeline:** `GET /branch/patients/:id/timeline` returns consultations with their sections, prescriptions (if the role may see them), blood work, BHRT and medical records for this branch. super_admin without `branchId` sees every branch.
- **Roles (D1):** Front Desk and Team Manager fill every consultation section and clinical record but cannot see or write prescriptions. Doctors have their own consultations and prescriptions. Branch Admin has everything.

**Verified**

- lint and typecheck are clean. `npm test` passes 156/156.
- The migration ran on Supabase with no drift. `storage:setup` created `doctor-signatures`. `npm run seed` added the 168 catalog items to LHR. RLS is on for all 7 new tables, with no policies.

## B4 — Patients, doctors and appointments (done 2026-09-30)

**Built** (migration `PatientsDoctorsAppointments`; RLS on every new table):

- **Patients** (`patients`, was `customers`) are global, with `created_in_branch_id`:
  - The phone is normalised to +92 (`phone_normalized`). `phone_last9` is unique among live patients, which keeps posSoft's "last 9 digits" duplicate rule. A duplicate gets 409 with the existing patient in `details.patient`.
  - The endpoints are list, options, check-phone, cities (posSoft city suggestions), get, create, edit and delete.
  - The list without `search` shows patients created in, or visiting, this branch. With `search` (name, phone or city) it finds any patient, so a returning patient from another branch can be booked.
  - `GET /:id/summary` returns the profile plus only this branch's appointments, payments and medical records (only their own for a doctor).
  - Delete is blocked while the patient has appointments.
  - `bhrt_status` (none/on/off/recommended) is stored now; B5 adds the BHRT log that updates it.
- **Doctors** (`doctors`): each is linked to a doctor-role staff login and a branch, and has a display name, phone, email, details, consultation fee and status.
  - Create either makes the login in the same step, as posSoft did (`account`, rolled back if the doctor insert fails), or links an existing doctor-role staff member (`staffId`).
  - Other endpoints: `/options` (active doctors only, for booking), `/me` for the signed-in doctor, and `/:id/slots?date=` (posSoft's list of booked times while booking).
- **Appointments:**
  - Fields: `APP#<appointmentNo>`, patient, patient city snapshot (posSoft `app_pat_city`), doctor, date, time from/to, mode online/physical, visit new/followup, issues, remark, status booked/completed/cancelled, and source dashboard/app.
  - Overlapping times for the same doctor are rejected with 409 and `details.conflicts`. As in posSoft, every non-deleted appointment counts, cancelled ones included. The doctor row is locked, so two bookings cannot race.
  - Booking can create the patient inline, add payments with screenshots, and add a medical record with files, all in one transaction. Uploads are removed if it fails.
  - Filters are posSoft's: date range, doctor, patient, status, mode, visit type, entry by, BHRT status, booking date, and search by APP#, name or phone.
  - Other endpoints: calendar (at most 62 days), edit (overlap checked again), and `POST /:id/status` (posSoft "Remarks": status, remark and screenshots).
  - Delete also removes the appointment's payments, as posSoft did.
- **Payments** (`appointment_payments`):
  - cash or online, amount, date and the receiving account sheet; online payments also have the sender bank, account title and number, and a screenshot in the private `payment-proofs` bucket.
  - posSoft deleted and re-inserted payments on every appointment edit. Here they are separate records that can be added, edited, given a proof or deleted, each with an audit log entry.
  - `GET /branch/appointment-payments` is posSoft's payment report: one row per appointment with the total of its matching payments, and `meta.totalAmount`. Filters: month, date range, method, account sheet, doctor, patient, mode, city, status and BHRT status.
- **Medical records** (`medical_records` + `medical_record_files`, private `medical-records` bucket) are created at booking. B5 adds full management. Downloads are always short-lived signed URLs, issued after an access check.
- **Roles, as posSoft:**
  - Front Desk / Team Manager and Doctor can add, edit and delete patients, appointments and payments. posSoft shows edit and delete to these panels; the "own records only" rule in posSoft applies to sales, so it comes in B6.
  - Doctors see and book only their own appointments.
  - Accountant: view and create only.
  - Doctor management is for the Branch Admin; the accountant can only link existing staff.

**Verified**

- lint and typecheck are clean. `npm test` passes 135/135.
- The migration ran on Supabase with no schema drift. `storage:setup` created `payment-proofs` and `medical-records` (private). RLS is on for all 7 new tables, with no policies.

## B2 — Master data (done 2026-09-30)

**Built** (migration `MasterDataAndStockLedger`; every table branch-owned, with RLS):

- **Categories:** CRUD, options, image upload. The name is unique per branch, case-insensitive (posSoft's "already added" check). Delete is blocked while products use the category.
- **Products:**
  - CRUD, options, image upload to the public `product-images` bucket, at `<branchId>/<productId>/<uuid>.<ext>`.
  - `sku` is unique per branch. `batchNo` is posSoft's "Gram" label; `sizeGrams` is its numeric value, used for production loss.
  - `unit`, `lowStockThreshold` (default 10, as posSoft) and `salePrice`.
  - Creating a product can include the first purchase entry, as posSoft's add form does.
- **Purchase entries** (`product_purchase_entries`, was `product_details`):
  - List, add ("Add Stock"), correct and remove. These are history: never delete-and-reinsert.
  - Each entry posts a `purchase_in` stock movement. A correction reverses it and re-posts; a removal reverses it.
  - `salePrice` follows the most recently added entry's price (posSoft `ORDER BY prod_det_id DESC`).
- **Bundles:** rows in `bundle_items` instead of CSV. `totalPrice` = Σ price × qty, computed on the server. Every product in a bundle must be from the same branch.
- **Suppliers:** type `supplier` / `dispatcher`, with a type filter on list and options.
- **Banks and account sheets:**
  - `type` is cash or bank; a bank account requires `bankId` (in posSoft, "sheet type" held the bank id).
  - `openingBalance` defaults to 0. A bank cannot be deleted while account sheets use it.
- **Shared infrastructure:**
  - `branchScopedRepository`: every query is scoped by branch, and save/create reload the row so numeric fields are always `Decimal`.
  - `mountBranchCrud` / `registerCrudDocs`: standard routes and OpenAPI docs.
  - multer upload helpers (type and size checks); `npm run storage:setup`.
  - Money is serialised as `"1500.00"`, quantities as `"20.000"`.
- **Roles:**
  - Branch Admin: full access.
  - Accountant: view + create only (posSoft shows edit/delete to admin only; the plan said full, but posSoft wins).
  - Store Keeper and Pharmacy: read products and suppliers. Front Desk: read products and bundles.

## B3 — Inventory ledger, stock in/out and manufacturing (done 2026-09-30)

**Built** (migration `InventoryManufacturing` plus the ledger from B2):

- **Stock ledger** (`stock_movements`):
  - Append-only: a DB trigger rejects UPDATE and DELETE. Corrections are reversing rows (`reversal_of_id`) dated like the original.
  - Every write locks the affected product rows (`FOR UPDATE`) and refuses to take any product below zero (422 with a `shortages` list).
- **`product_stock_balances` view** (`security_invoker`, revoked from anon/authenticated): quantity per product plus `is_low_stock`.
- **Stock In / Stock Out:**
  - One entry per item, as posSoft did. Create accepts JSON, or multipart with a `data` JSON field plus `files`; the files are shared by every item, as in posSoft.
  - The party type is checked: Stock In takes a supplier, Stock Out a dispatcher. `destination` is free text.
  - Edit reverses and re-posts; delete reverses. Both write an audit log.
  - Attachments go to the private `stock-files` bucket: add, signed download URL, remove.
- **Inventory:**
  - `GET /branch/inventory/stock`: balances, with low stock first and a filter.
  - `GET /branch/inventory/report`: per product, opening / purchased / stock in / manufactured / stock out / sold / returned / adjusted / closing for a date range.
  - `GET /branch/inventory/products/:id/ledger`: dated in/out rows with a running balance.
  - The posSoft hardcoded sales cutoff and per-office split are gone: there is one ledger per branch.
- **Manufacturing:**
  - Material categories: name unique per branch, case-insensitive.
  - Materials: minimum and bare minimum, and a first receipt on create.
  - Material receipts (was `materials_details`): place falcon/pharmacy, reversible edits.
  - `material_movements`: an append-only ledger with location `store` or `lab`.
  - Lab transfer (store keeper, "Material Out → Pharmacy Lab"): store − / lab +. The lab batch number is unique.
  - Production (pharmacy, "Material Out → Finished Product"): picks a lab batch and takes lab −. An optional product + quantity posts `manufacturing_in` stock, which posSoft never did.
  - Posted batches cannot be edited, as in posSoft. Delete reverses everything, and a lab batch cannot be deleted while a production uses it.
  - Recipes are rows (`recipe_items`) with an optional quantity.
- **Reports:**
  - Material report: store or lab location; in / out / opening / closing; the posSoft alerts (below bare minimum, below minimum) with a filter.
  - Finished goods: material used, finished qty (production output plus stock-ins with the same batch, as posSoft), size, loss g and loss %.
- **Permissions:** `manufacturing` is split into `labTransfers` (store keeper) and `production` (pharmacy), matching the two posSoft screens.

**Verified (B2 + B3)**

- lint and typecheck are clean. `npm test` passes 111/111 (temporary local Postgres 18, fake Supabase).
- A test fails if any public table lacks RLS or any view lacks `security_invoker`.
- All 4 migrations ran on Supabase, and `storage:setup` created the buckets there. RLS is on for every table (no policies); the view is `security_invoker`; anon cannot select it.
- End-to-end on real Supabase: super admin login → `/auth/me` → branches → branch stock → token refresh all return 200.

## B1 — Branches, staff, roles and auth (done 2026-09-30)

**Built**

- **Tables** (migration `BranchesStaffAuth`, RLS enabled on every table, no policies):
  - `branches`: code is unique among non-deleted rows, with a format check (e.g. LHR); at most one head office; status active/inactive.
  - `company_info`: global, at most one live row (singleton unique index).
  - `staff_profiles`:
    - `id` = the Supabase auth user id, with an FK to `auth.users` ON DELETE CASCADE (Supabase only).
    - Postgres enum `staff_role` holds the 9 roles. A CHECK makes `branch_id` NULL only for super_admin.
    - Username and email are unique and stored lowercase.
    - `must_change_password` and `last_login_at` columns.
  - `audit_logs`: branch, actor, action, entity, entity id, before/after jsonb, ip.
- **Permissions:** `src/lib/permissions.ts` is the role → permission matrix, built from each posSoft role folder's menu:
  - Accountant: the admin menu without Employees, with view + create only (posSoft shows edit/delete to admin only).
  - Front Desk and Team Manager: the `users/` menu. Doctor: the `doctor/` menu. Pharmacy and Store Keeper: their own menus. Delivery Print: delivery slips only.
- **Auth:**
  - `POST /auth/login` accepts a username OR an email (as posSoft did) and returns the Supabase session plus the profile, branch and permissions.
  - Also `POST /auth/refresh`, `GET/PATCH /auth/me` (own profile) and `POST /auth/change-password` (checks the current password).
  - Login attempts are rate limited (20 per 15 minutes).
  - The `authenticate` middleware loads the staff profile: no profile → 401; inactive staff or inactive/deleted branch → 403.
- **Super Admin:**
  - `/admin/branches`: CRUD, options, activate, deactivate. Delete is refused while the branch still has staff.
  - `POST /admin/branches/:id/admin` creates the Branch Admin: Supabase user + profile in one step, and deletes the auth user again if the profile insert fails.
  - `GET/PUT /admin/company-info`.
- **Staff:** `/branch/staff` for the Branch Admin's own branch, or any branch for super_admin with `?branchId=`.
  - List (search, role/status filter, paging), get, create, edit, reset password, activate, deactivate, soft delete.
  - A branch admin can manage every branch role except branch_admin and super_admin. Nobody can change their own account here.
  - Deactivating or deleting also bans the Supabase login.
  - Every change writes an audit log.
- **Seeds** (idempotent):
  - `npm run seed`: company info (from the posSoft `company_info` row) and the Lahore head-office branch (LHR).
  - `npm run seed:super-admin`: reads SUPER_ADMIN_EMAIL/PASSWORD.
- **Cleanup:** all code comments removed, as the user asked.

**Verified**

- lint, typecheck, and `npm test` 72/72 (temporary local Postgres 18, fake Supabase).
- The migration ran on the Supabase project. The `auth.users` FK, RLS (no policies) and CHECK constraints are present there. The seed created LHR and company info.
- `migration:generate` reports no drift locally.

**For the user**

- Fill `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD` in `.env`, then run `npm run seed:super-admin`. Login and staff creation need these keys.
- Real Supabase login has not been tried yet, because the keys are not set.

## B0 — Project setup (done 2026-09-30)

**Built**

- Node 22+ / Express 5 / TypeScript strict (CommonJS) project, with ESLint (flat config, typescript-eslint) and Prettier.
- Zod-validated env (`src/config/env.ts`), with `.env.example` listing every variable.
- TypeORM 1.x with one `AppDataSource` (`synchronize: false`, SSL, small pool for the Supabase session pooler).
  The migrations table is `typeorm_migrations`.
- `BaseEntity` (uuid id, timestamps, created/updated/deleted by, soft delete) and `BranchScopedEntity` (`branchId`).
- Decimal transformer plus `moneyColumn()` (numeric 12,2) and `quantityColumn()` (numeric 12,3), backed by decimal.js.
- `withTransaction()` (joins an outer transaction when one is passed) and `repo(entity, em?)`.
- First migration: `CREATE EXTENSION IF NOT EXISTS pgcrypto`.
- HTTP: the `{ data, meta? }` / `{ error: { code, message, details?, requestId } }` envelopes, `AppError`,
  a central error handler (Postgres unique → 409, FK → 400/409, not-null/check/format → 400), a 404 handler,
  and pagination, search and sort helpers.
- Middleware:
  - `requestId`, `validate` (Zod → `req.valid`), `authenticate`, `requireRole`, `branchScope`.
  - `authenticate` verifies Supabase tokens now. It gets its staff lookup through `setAuthContextResolver`, which B1 plugs in.
- Also in place:
  - helmet, a CORS allowlist and a rate limit on `/api`.
  - pino logging.
  - Supabase admin client and storage helpers (upload, signed URL, remove).
- OpenAPI from Zod (`@asteasolutions/zod-to-openapi`): served at `/api/docs` and `/api/docs/openapi.json`, and exported by `npm run openapi:export`.
- `GET /api/v1/health`, which runs `select 1`.
- Jest + ts-jest + supertest:
  - Global setup runs the migrations on `TEST_DATABASE_URL` and refuses to run if it equals `DATABASE_URL`.
  - Each suite truncates all tables.
  - 30 tests: health, middleware (auth, roles, branch scope, validation, error mapping), pagination, decimals and transactions.
- Seed runner (`npm run seed`). No seeds are registered yet; B1 adds the Lahore branch.
- Docs: CLAUDE.md, BUSINESS_FLOW.md, POSSOFT_ANALYSIS.md, API.md, openapi.json.

**Verified:** lint, typecheck and `npm test` pass (30/30) against a local Postgres 18 test database (temporary, outside the project). `migration:run`, `migration:show`, `migration:generate`, `build`, `start`, `dev` and `seed` were all run.

**Not done / for the user**

- Fill `.env` with real Supabase values (the session pooler URI, service role key and anon key) and a separate test DB URL.
- Run `npm run migration:run` against Supabase. It has not been run against a hosted project yet.
- `npm run seed:super-admin` and the permission matrix come in B1.

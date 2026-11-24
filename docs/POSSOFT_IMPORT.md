# posSoft sales import

Two commands move posSoft's sales into this system:

| Command | What it does |
|---|---|
| `npm run db:reset -- --confirm <db name>` | Empties every table except `typeorm_migrations`, then creates the main warehouse (`MAINWH`) again. Without `--confirm` it only prints the database name. |
| `npm run import:possoft-sales -- --file <dump.sql> [--dry-run]` | Reads a posSoft MySQL data export and adds its sales. `--dry-run` does everything inside a transaction, prints the summary, then rolls it back. |
| `npm run import:possoft-catalog -- --file <dump.sql> [--dry-run]` | Adds posSoft's categories and products to the main warehouse and links every branch product with the same name to its warehouse product. Safe to run again: existing warehouse products (same name) are reused. For databases filled by an earlier version of the sales import. |
| `npm run import:possoft-clinical -- --file <dump.sql> --password <value> [--dry-run]` | Adds doctors (with logins), appointments, appointment payments and prescriptions. Runs after the sales import and `npm run seed`. Refuses to run when appointments or prescriptions already exist. |
| `npm run possoft:collect-files -- --file <dump.sql> --source <pos-img> --dest <med-files>` | Copies only the medical-record image/pdf files out of the full `pos-img` folder into a smaller folder, so just those (~2.9 GB) need to reach the server. Runs on the machine that holds the files; needs no database. |
| `npm run import:possoft-medical -- --file <dump.sql> --files <folder> [--dry-run]` | Creates medical records and uploads their image/pdf files to storage (R2). Idempotent: a deterministic id per record and file means a re-run skips what is already there and re-uploads the same key. |
| `npm run import:possoft-clinical-extra -- --file <dump.sql> [--dry-run]` | Adds blood-work results and BHRT status logs, linked to the patient in the patient-city branch. Idempotent (deterministic ids). |
| `npm run import:possoft-history -- --file <dump.sql> [--dry-run]` | Adds the intake history: one consultation per matched appointment, with its structured sections. Runs after the clinical import (it matches against the imported appointments). Idempotent (deterministic ids). |
| `npm run fix:clinical-branches [-- --dry-run]` | Moves imported clinical data to the right branch: appointments, payments, consultations and prescriptions to the doctor's branch; medical records, blood work and BHRT to the branch where the patient is treated. Run it after `fix:doctor-branches`. Idempotent. |
| `npm run fix:clinical-remarks [-- --dry-run]` | The posSoft clinical-remark note is each appointment's `app_remark`, which the dashboard shows as the visit's clinical remarks (the `plan` of the `clinical_assessment` section). This fills that plan from the appointment's remark and creates a lightweight consultation for appointments that have a remark but no consultation yet. Idempotent. |

## Why `fix:clinical-remarks` exists

The dashboard's patient-history panel shows each past visit's clinical remarks from `consultation_sections.data->>'plan'` of the `clinical_assessment` section. The posSoft narrative for a visit lives in the appointment's `app_remark` (imported into `appointments.remark`), not in the history columns, so the plan was empty and the panel said "No remarks recorded". This fix copies the remark into the clinical-assessment plan and, for appointments that had a remark but no intake-history consultation, creates a consultation so the remark has somewhere to live. The history import now sets the plan from `app_remark` directly, so this fix is only for data imported before the change.

## Why `fix:clinical-branches` exists

The first clinical import put appointments and prescriptions in the **patient's city** branch (like sales). But an appointment happens at the **doctor's clinic**, so a doctor's appointments ended up scattered across branches and a branch view showed only the patients from that city. `fix:clinical-branches` corrects this: an appointment follows its doctor's branch, its payments and consultation follow the appointment, a prescription follows its doctor, and a patient's records (medical records + files, blood work, BHRT) move to the branch where that patient has the most appointments. Moving a medical record does not touch its file (the stored path already carries the old branch code and still downloads). The clinical import now assigns the doctor's branch directly, so this fix is only for data imported before the change.

## What the history import creates (`import-history.ts`, `history-mapper.ts`)

- Each active `customers_history` row is tied to its posSoft appointment (`hist_appoint_id`), matched to the imported appointment by patient + date + time; the consultation takes that appointment's doctor and branch. Rows whose appointment cannot be matched are skipped (`appointmentNotMatched`).
- The consultation carries the major complaint, current medications and discussion topics. The 300-odd posSoft history columns are mapped into the structured consultation sections (basic info, medical history + conditions + surgeries + family history, MRS scale, additional symptoms, imaging results, clinical assessment, plans, referral).
- **Medical history is mapped in full:** besides conditions, surgeries, family history, allergies, diet and relationship, the mapper now fills the hormones / contraception / periods block (hormone therapy, hormones used, contraception, having periods, last period date, cycle, flow, DUB, oligomenorrhea, periods note, menopause diagnosed + age), the medication flags (UTI antibiotics, pain, mood, sleep, weight-loss) and the lifestyle fields (alcohol, smoking, exercise). `havingPeriods` is only set to `yes` when both the last-period date and the cycle are present, so the section passes its Zod `superRefine` instead of being dropped.
- **Safety:** every section is run through the same Zod schema the dashboard uses (`SECTION_SCHEMAS`) before it is saved. A section that does not validate is dropped (`sectionsInvalid`), so only data the UI can render reaches the database. Empty sections are not created.
- **Re-running updates in place:** sections upsert on `(consultation_id, section_key)` (`DO UPDATE`), so re-running the import after a mapping change refreshes already-imported sections with the new fields rather than skipping them. Run it before clinicians start editing imported consultations, since it overwrites the imported section's data.
- On the real export about 1,835 consultations and 8,420 sections import; ~93 appointments do not match and ~44 sections are dropped.

## What the clinical-extras import creates (`import-clinical-extra.ts`)

- **Blood work:** each `customers_blood_work` row holds up to nine tests (FSH, Estradiol, free/total testosterone, DHEA-S, Vit D3, TSH, Ferritin, B12). Every numeric value becomes a `blood_work_results` row for that test, with a standard unit and the test's date. A value with no date of its own borrows the date of another test in the same row; a non-numeric value, or a row with no date at all, is skipped. On the real export about 4,900 results import.
- **BHRT:** each `customers_bhrt_details` row becomes a `bhrt_status_log` entry for the patient (status mapped to on / off / recommended / other, with the note and date). 908 rows.
- **Not included:** the intake history (`customers_history`, ~1,900 rows, ~350 columns). It needs a consultation tied to each appointment and a large field-by-field mapping into the structured consultation sections; it is a separate, bigger task.

## What the medical import creates (`import-medical.ts`)

- One medical record per active `customers_med_record` row, linked to the patient (matched like the clinical import; a never-seen customer is created), in the patient-city branch, with its date, status and note.
- Each file named in `med_record_screenshot` (comma-separated for several) is uploaded to the `medical-records` bucket at `<branchCode>/medical-records/<id>.<ext>` and recorded as a medical-record file. Only `jpg/jpeg/png/webp/pdf` are taken; other types (zip, mp4, …) are skipped (`filesWrongType`). A file not found in `--files` is skipped (`filesMissing`).
- The record and file ids are derived from the posSoft id, so running the import again adds nothing new and is safe after an interruption. It does not run inside one big transaction, so a stop midway keeps what was already done.
- On the real export a `--dry-run` reports about: medicalRecords 2,005, filesUploaded 5,072, filesWrongType 26, filesMissing 0.

The import refuses to run when the `sales` table already has rows, so it cannot be added twice.

## What the clinical import creates (`import-clinical.ts`)

- **Doctors + logins:** every active posSoft doctor becomes a staff login (role `doctor`, in `LHR`) plus a doctor record. The username comes from `doc_username` (made unique and lowercase); the email from `doc_email` or `<username>@imported.dsm`. Every doctor gets the one starting password you pass and `must_change_password = true`, so they set their own on first login. Re-running reuses a doctor matched by username. All doctors sit in `LHR`; appointments in other cities still reference them, so in the doctor app a doctor sees the appointments of the branch they are viewing, while admins see all.
- **Patients:** appointments and prescriptions reuse the patient already imported (matched by phone, or by `possoft-<cust_id>` for no-phone customers). A consultation-only customer with no earlier sale is created here (`patientsCreated`).
- **Appointments:** `app_pat_city` picks the branch like sales. `app_status` 0→booked, 1→completed, 2→cancelled; `app_on_phy_status` Online/Physical → mode; `app_on_phy_followup` → new/followup. `fee` is the total of the appointment's payments, else `app_received_amount`. Deleted (`close = 0`) rows and ones whose doctor was not imported are skipped. Time is clamped so `time_to > time_from`.
- **Appointment payments:** active rows with amount > 0. The account is matched to the shared account sheet by code (from the sales import); an unknown or `0` account goes to "posSoft: no account chosen". Payment screenshots and appointment remark screenshots are not imported.
- **Prescriptions:** one per active posSoft prescription, linked to the patient and doctor, in the patient-city branch. `pres_diaganosis` → diagnosis; the five `*Note` fields → `notes`; `pres_plantreatment` → plan; `pres_followup_date` → followup. Each ticked `pres_*` lab/checkbox column becomes a prescription item, linked to the branch's prescription catalog by the same code (the catalog `code` is the posSoft column name).
- **Not in this import:** medical records and their files, blood work, intake history and BHRT details.

On the real export a `--dry-run` prints about: doctors 8, appointments 6,055, appointmentPayments 7,027, prescriptions 4,485, prescriptionItems ~75,000, patientsCreated ~2,360.

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

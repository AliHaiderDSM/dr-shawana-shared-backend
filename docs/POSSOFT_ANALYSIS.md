# posSoft Analysis (reference for later phases)

posSoft lives at `../posSoft` and is a **read-only** reference. Use it to understand business rules, never as code to copy.

## Architecture

- **Framework:** custom procedural PHP with no framework, running on XAMPP/Apache.
- **Frontend libraries:** jQuery, Bootstrap, DataTables, Select2, CKEditor and PHPMailer.
- **Database:** MySQL `pos_dsm`, accessed through `mysqli` with SQL built by string concatenation. There are no prepared statements. The schema dump is `backup/pos_dsm.sql`, with 33 tables.
- **Folders:** each role has its own folder:
  - `admin/`, `doctor/`, `users/`, `pharmacy/`, `store-keeper/`, `print-delivery-report/`
- **Inside each folder:**
  - `.htaccess` maps a slug to `index.php?page=X`.
  - `index.php` loads, in order: `env/main-config.php`, then `models/login.php` (the role guard), then `controller/X.php` (POST handling), then `view/X.html.php`.
  - `models/*StateModel.php` and `_*ControllersState.php` are AJAX endpoints that return HTML fragments.
- **Duplication:** the doctor, users, pharmacy and store-keeper folders are mostly copy-pasted subsets of `admin/`.
- **Timezone:** Asia/Karachi (+05:00).

## Roles (the `wt_users.type` column)

| posSoft value         | Folder                                                 | New role       |
| --------------------- | ------------------------------------------------------ | -------------- |
| admin                 | admin/                                                 | branch_admin   |
| accountant            | admin/ (edit and delete buttons hidden in the UI only) | accountant     |
| doctor                | doctor/                                                | doctor         |
| users                 | users/                                                 | front_desk     |
| team manager          | users/                                                 | team_manager   |
| pharmacy              | pharmacy/                                              | pharmacy       |
| store keeper          | store-keeper/                                          | store_keeper   |
| print delivery report | print-delivery-report/                                 | delivery_print |

When a doctor is created, posSoft also inserts a matching `wt_users` row (type doctor, with `doc_id` set).

## Security problems (do NOT reproduce)

- **Passwords:**
  - Staff passwords are unsalted MD5.
  - `doctors.doc_password` is stored in plaintext.
  - Login does not check `status` or `close`, so deleted users can still log in.
  - The login SQL is injectable.
- **Role guards:** each folder's guard redirects without calling `exit`, so the page still runs.
- **Unauthenticated endpoints:**
  - None of the AJAX endpoints, print pages or `getState.php` (the DB backup) check auth.
  - `employeePortalLogin.php` logs in as any user id with no auth.
  - `Import_backup.php` drops every table and runs an uploaded SQL file.
- **Secrets:**
  - The session stores the MD5 hash, and a 30-day cookie holds it too.
  - SMTP credentials are hardcoded in `models/forgot-password.php`.
- **Uploads:** there are no type or size checks, and files go into the public `pos-img/` folder.

## Conventions

- **Soft delete:** `close = 1` means active and `close = 0` means deleted; `del_by` and `del_date` record who and when. `status = 1` means active. `entry_by` holds the creator's id, stored as varchar.
- **Money and quantities** are stored as `varchar(50)`. `general_entries_details` uses `float`.
- **Payments:**
  - The types are "Cash Payment" and "Online Payment".
  - Online payments record the sender bank, account title and number, and a screenshot.
  - `*_receiver_sheet_id` points to `accounts_sheet`.
- **Appointment status:**

  | Value | Meaning   |
  | ----- | --------- |
  | 0     | Booked    |
  | 1     | Complete  |
  | 2     | Cancelled |

  `app_on_phy_status` holds Online/Physical, and `app_on_phy_followup` holds New/Followup.

- **Sales:**
  - `sale_type` is Online Sale or Office Sale. `sale_city` is Islamabad, Multan, Karachi or Lahore.
  - `sale_status` is 0 for pending online sales and 1 otherwise; `View_sale` toggles it.
  - Add_sale uses a one-time form token.
- **Offices:** the list is hardcoded in several places (for example `admin/view/Stock_out.html.php` and the inventory report): Islamabad, Multan, Karachi and Lahore Office, Leading Pharma, and Other.
- **CSV columns:** bundles store `bundle_prod_id` and `bundle_prod_price` as comma-separated strings. Recipes and stock-out file lists are also comma-joined.

## Business rules to keep

- **Duplicate patient check:** strip non-digits, then compare the last 9 digits of the phone (`customerStateModel.php` ~line 36). posSoft only warns; we enforce it with a unique normalized phone.
- **Inline patient creation:** booking an appointment with patient id 0 creates the patient in the same step.
- **Sale price:** comes from the latest `product_details` row (`ORDER BY prod_det_id DESC LIMIT 1`).
- **Edit rights:** Front Desk can edit only records they created.

## Bugs / gaps the rebuild fixes

- **Sales do not reduce stock.** The stock screen computes `SUM(product_details.qty) - SUM(sale_products.qty)` and flags ≤ 10 as low. B3 replaces this with one ledger.
- **The inventory report uses separate data.** It uses `stocks_in`/`stocks_out` and a hardcoded sales cutoff `crt_date >= '2026-09-18'` (`viewInventoryReportModel.php:197`).
- **Product edits destroy history.** Editing a product DELETEs and re-inserts all its `product_details` rows.
- **Manufacturing never adds stock.** Material out to a finished product does not create stock of that product.
- **Appointment payments are missing from balances.** They are commented out of the accounts balance report.

## Table list (pos_dsm.sql)

accounts_sheet, appointments, appointment_payments, banks, bundles, categories, company_info, customers, customers_bhrt_details, customers_blood_work, customers_history (about 350 columns), customers_med_record, doctors, general_entries, general_entries_details, materials, materials_details, materials_out, materials_out_details, material_categories, patients (unused), prescriptions (about 150 boolean columns), prescriptions_previous, products, product_details, product_recipe, sales, sale_payments, sale_products, stocks_in, stocks_out, suppliers, wt_users.

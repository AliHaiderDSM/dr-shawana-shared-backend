# Appendix — Business Flow (save as docs/BUSINESS_FLOW.md)

This project rebuilds **posSoft** as a centralized, multi-branch system on a new **Node.js backend**.

- Each branch keeps the **same business flow posSoft has today**: patients, appointments, consultation, prescriptions, POS sales, stock, manufacturing, accounts and reports.
- The new layer on top is **branches**. A **Super Admin** creates branches, and each **Branch Admin** runs their own branch, including its staff and products.
- The **Patient Mobile App** connects to this same backend through its API.
- The public website **dr-shawan is not part of this project** and stays as it is (see [Out of scope](#out-of-scope)).

---

## 1. System Overview

```
                         SUPER ADMIN
                (creates branches, sees everything)
                              |
        +-----------+---------+---------+-----------+
        |           |                   |           |
     Lahore     Islamabad            Karachi      Multan   ... (more branches later)
   (Branch)     (Branch)             (Branch)     (Branch)
        |           |                   |           |
   Branch Admin + staff in every branch run the posSoft flow
        |           |                   |           |
        +-----------+---------+---------+-----------+
                              |
                    SHARED NODE.JS BACKEND
                     (REST API + business rules)
                              |
               +--------------+--------------+
               |                             |
      Business Dashboard               Patient Mobile App
      (Super Admin, Branch             (patients: appointments,
       Admin and branch staff)          prescriptions, records)
               |                             |
               +--------------+--------------+
                              |
                    CENTRAL RELATIONAL DATABASE
```

| Client | Users | Connects to |
|---|---|---|
| Business Dashboard (the posSoft replacement) | Super Admin, Branch Admin and branch staff | Shared backend |
| Patient Mobile App | Patients | Shared backend (`/api/v1/app/*`) |
| dr-shawan website | Public customers | **Nothing.** It keeps its own Firebase. |

---

## 2. Roles

### 2.1 Platform level

| Role | Scope | Can do |
|---|---|---|
| **Super Admin** | All branches | Create, edit and deactivate branches. Create the Branch Admin of each branch. View every branch's data and reports, including combined organization reports. Manage company info and global settings. |

### 2.2 Branch level

These are the posSoft roles, now tied to one branch.

| Role (posSoft name) | Can do inside **their own branch** |
|---|---|
| **Branch Admin** (`admin`) | Everything posSoft admin can do today, limited to their branch. This includes adding and managing staff, doctors, products, categories, bundles, suppliers, stock, accounts and reports. |
| **Accountant** (`accountant`) | Admin panel without the admin-only actions (employees, delete, backup). |
| **Doctor** (`doctor`) | Own appointments, consultation and remarks, prescriptions, patient history, and own reports. |
| **Front Desk / Team Manager** (`users`, `team manager`) | Customers, add sale, appointments and remarks, inventory report, and sales and appointment reports. Can edit only records they created. |
| **Pharmacy** (`pharmacy`) | Stock in and out, inventory report, material in (Pharmacy Lab), material out to Finished Product, finished goods, and product recipes. |
| **Store Keeper** (`store keeper`) | Materials and material categories, product recipes, material out to Pharmacy Lab, finished goods, stock in and out, and inventory report. |
| **Delivery Print** (`print delivery report`) | Print delivery slips only. |

### 2.3 App level

| Role | Can do |
|---|---|
| **Patient** | Only their own profile, appointments, prescriptions, medical records and payments, across all branches. |

> **Authorization rule:** the backend takes the user's `branch_id` and role from the **auth token**, never from a request parameter. Every query for branch data is filtered by that `branch_id`. Only Super Admin can switch branch or view all branches. Hiding a menu item is not security.

---

## 3. Branch Setup Flow

```
Super Admin logs in
      |
      v
Create Branch  (name, city, address, phone, logo, status)
      |
      v
Create Branch Admin for that branch
      |
      v
Branch Admin logs in  (sees only their branch)
      |
      +--> Add staff (Accountant, Doctor, Front Desk, Pharmacy, Store Keeper, Delivery Print)
      +--> Add doctors
      +--> Add categories, products, bundles
      +--> Add suppliers / dispatchers
      +--> Add banks and account sheets
      |
      v
Branch starts daily operations with the posSoft flow
```

---

## 4. Branch Operational Flow

Every module below works exactly like it does in posSoft today. The only difference is that every record now carries a `branch_id`.

### 4.1 Patients (Customers)

- A patient is created from the Customers screen, or inline while booking an appointment.
- A patient is identified by **phone number**. The duplicate check compares the last 9 digits, as posSoft does today.
- The fields are the posSoft customer fields: name, phone, city, age, country, address and BHRT status.
- **The patient record is global**, which means one person has one record even if they visit several branches. The records created at each visit, such as appointments, sales and history, belong to the branch where they happened. This is what lets the mobile app show one patient everything.

### 4.2 Appointments

```
Front Desk / Admin / Doctor
      |
      v
Select or create patient --> Select doctor (of this branch) --> Date + time from/to
      |
      v
Online / Physical   +   New / Followup   +   Issues   +   optional medical record upload
      |
      v
Payments (one or more: Cash or Online with bank details + screenshot --> account sheet)
      |
      v
Appointment status: Booked (0) --> Complete (1) / Cancelled (2)
```

### 4.3 Consultation (Appointment Remarks)

- One **history record** is created for each appointment. It holds the full posSoft intake:
  - vitals and conditions
  - MRS symptom score
  - periods, surgeries and family history
  - blood work, imaging and diagnosis
  - plan, diet plan flags and referral
- Other clinical records:
  - **Blood work** log (FSH, Estradiol, Testosterone, DHEA, VitD3, TSH, Ferritin, B12)
  - **BHRT status** log (On / Off / Recommended BHRT)
  - **Medical records** (uploaded files)
- Printable documents: the referral letter and the patient history report.

### 4.4 Prescriptions

- A prescription is created from the consultation or from the standalone prescription form.
- It uses the same template as posSoft: diagnosis, labs, imaging, supplements, BHRT items, notes, plan and follow-up date.
- It prints as a PDF.
- It is visible to the patient in the mobile app.

### 4.5 POS Sales

```
Add Sale
  |
  +--> Sale type: Office Sale / Online Sale
  +--> Customer
  +--> Products and bundles (price = latest purchase/price entry)
  +--> Discount, total, received, remaining
  +--> Payments (Cash / Online with bank details + screenshot --> account sheet)
  |
  v
Print Bill (ORD#)
  |
  v
Online Sale: Pending --> Delivered / Returned
  |                                  |
  v                                  v
  |                     Returns section (pending inspection)
  |                       --> Restocked / Damaged / Sent to supplier
  |                       --> optional refund from an account
  |
  v
Delivery slips printed (Delivery Print role)
```

- Online orders that arrive through the dr-shawan website are still entered by hand as **Online Sale**, exactly as they are today.

### 4.6 Products and Inventory

- Products, categories and bundles are added by the **Branch Admin** and belong to that branch.
- Purchase and price entries (quantity, price, supplier) are added per product.
- **Stock In** records stock received from a supplier, with batch, manufacturing date, expiry, purchase price, file and note. Each batch keeps its own stock.
- **Sales take the batch that expires first**, and expired stock cannot be sold. Expired or damaged stock is removed with a write-off on the batch.
- **Labelled products:** every pack carries a DSM label (`DSM-000001`). Stock In prints new labels (or records the labels already on the packs); stock out, sales and returns scan them, so each piece's history (received, sold to whom, returned, restocked) is kept.
- **Stock Out** records stock sent out through a dispatcher.
- **Inventory Report** shows stock per product for the branch.
- Stock is kept **per branch**. One branch's sales and stock never affect another branch.
- **Main Warehouse:** factory stock is received into the Main Warehouse, which only the Super Admin runs and which never sells. A warehouse Stock Out with "Transfer to branch" moves the stock (same batches and labels) straight into that branch's stock; the branch does not enter it again. Branches never receive stock any other way.
- **Expiry alerts:** batches that expire within 3 months appear on the dashboard (every branch for the Super Admin, own branch for branch staff) and on the Stock page.

### 4.7 Manufacturing (Raw Materials)

```
Store Keeper: Material categories --> Materials (min / bare-minimum levels)
      |
      v
Product Recipe (which materials make a product)
      |
      v
Material Out --> "Pharmacy Lab"
      |
      v
Pharmacy: Material Out --> "Finished Product"
      |
      v
Finished Goods / Material Report
```

### 4.8 Accounts / Finance

- **Banks** and **Account Sheets**, which form the chart of accounts for each branch.
- **General Entries**, the double-entry journal with debit and credit lines.
- Revenue comes from **sale payments** and **appointment payments**, each linked to an account sheet.
- **Accounts Balance** and **Finance Report** are available for each branch. Super Admin also sees a combined report for all branches.

### 4.9 Reports

These reports are available for each branch. Super Admin can filter them by branch or see all branches together.

- Sale products
- Buy products
- Stock
- Inventory
- Appointments
- Appointment payments
- Doctor sale report
- Patient history
- Finance and accounts balance
- Dashboard charts: monthly sales vs appointment revenue, and per-product sales

---

## 5. Mobile App ↔ Backend

The mobile app has **no database of its own**. It calls the same shared backend.

```
Patient installs app
      |
      v
Login with phone number (OTP)
      |
      v
Backend finds existing patient by phone --> links app account to that patient
      |                                      (or creates a new patient)
      v
Patient sees their data from ALL branches:
      +--> Profile
      +--> Appointments (upcoming / past, branch + doctor)
      +--> Book appointment (choose branch --> doctor --> date/time)
      +--> Prescriptions (view / download PDF)
      +--> Medical records (upload report / view)
      +--> Payments / bills
```

Appointments booked in the app appear in that branch's dashboard, the same way appointments booked at the front desk do.

Suggested API namespaces:

| Namespace | Used by | Auth |
|---|---|---|
| `/api/v1/auth/*` | Dashboard and app | Staff: username + password. Patient: phone + OTP. |
| `/api/v1/admin/*` | Super Admin | Super Admin token |
| `/api/v1/branch/*` | Branch Admin and staff | Staff token (branch taken from the token) |
| `/api/v1/app/*` | Mobile app | Patient token (own data only) |

---

## 6. Core Data Model

These are the posSoft tables with `branch_id` added, plus a few new ones.

| Entity | Branch relation | posSoft source |
|---|---|---|
| `branches` | new | the hardcoded offices (Lahore, Islamabad, Multan, Karachi) |
| `users` (staff) | branch_id (null for Super Admin) | `wt_users` |
| `doctors` | branch_id | `doctors` |
| `patients` | **global** | `customers` |
| `patient_app_accounts` | global | new (links the mobile login to a patient) |
| `appointments`, `appointment_payments` | branch_id | same |
| `patient_history`, `blood_work`, `bhrt_details`, `medical_records` | branch_id (where created) + patient_id | `customers_history`, `customers_blood_work`, `customers_bhrt_details`, `customers_med_record` |
| `prescriptions` | branch_id + patient_id + doctor_id | `prescriptions`, `prescriptions_previous` |
| `categories`, `products`, `product_details`, `bundles` | branch_id | same |
| `suppliers` (Supplier / Dispatcher) | branch_id | same |
| `stocks_in`, `stocks_out` | branch_id | same |
| `materials`, `material_categories`, `materials_details`, `materials_out`, `product_recipe` | branch_id | same |
| `sales`, `sale_products`, `sale_payments` | branch_id | same |
| `banks`, `accounts_sheet`, `general_entries`, `general_entries_details` | branch_id | same |
| `company_info` | global | same |

**Rules for the new backend:**
- Store money and quantities as numbers (not varchar), use real foreign keys, and hash passwords with bcrypt or argon2.
- Keep soft delete (`close`, `del_by`, `del_date`) and `entry_by` on every table, as posSoft does.
- Store uploaded files (screenshots, medical records) in private storage. The database keeps only the file references.

---

## 7. Migration from posSoft

1. Create the **Lahore** branch and move all existing `pos_dsm` data into it with `branch_id = Lahore`.
2. Merge `customers` into the global `patients` table. The legacy `patients` table is unused and is not migrated.
3. Existing staff accounts become Lahore branch users with their current roles. Their passwords are reset, because the old MD5 hashes are not carried over.
4. Map the old hardcoded "office" values to real branches. Any existing stock-out "to Islamabad Office" and similar records are reviewed and moved to the matching branch's opening stock.
5. Run posSoft and the new system in parallel for a short period, then switch over.

---

## Out of scope

- **dr-shawan website:** stays on its own Firebase with no link to this backend. It keeps its own products, stock and orders. Website orders keep reaching staff by email and are entered by hand as Online Sale.
- **Patient–doctor chat and notifications:** posSoft has only a static placeholder. These can be added later as a separate phase.
- **Stock transfer between branches:** branches do not transfer to each other; stock moves from the Main Warehouse to a branch only.

---

## Open Decisions

These should be confirmed before development starts.

| # | Question | Proposed default |
|---|---|---|
| 1 | Is the patient record shared across branches, or separate per branch? | **Shared (global).** The mobile app needs this. |
| 2 | Are products fully separate per branch, or does Super Admin keep one master list that branches copy from? | **Separate per branch**, created by the Branch Admin. |
| 3 | Can a doctor work in more than one branch? | One branch per doctor at first. |
| 4 | Is inter-branch stock transfer needed later? | Later phase |

## Tech Stack (decided)

| Part | Tech |
|---|---|
| Backend | Node.js, Express, TypeScript, TypeORM |
| Database | Hosted Supabase Postgres, connected by connection string; schema managed by TypeORM migrations |
| Auth | Supabase Auth (staff: email + password; patients: phone OTP), verified by the Express backend |
| Files | Supabase Storage (private buckets, signed URLs) |
| Dashboard | Next.js + Tailwind |
| Mobile | Expo (React Native), later |


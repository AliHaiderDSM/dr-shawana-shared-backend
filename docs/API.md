# API Modules

Base URL: `/api/v1`. The interactive docs are at `/api/docs`, and the machine-readable spec is at `/api/docs/openapi.json` (also exported to `docs/openapi.json` by `npm run openapi:export`).

## Conventions

- **Auth:** send `Authorization: Bearer <Supabase access token>`.
- **Success:** `{ "data": ..., "meta"?: { page, pageSize, total, totalPages } }`.
- **Error:** `{ "error": { "code", "message", "details"?, "requestId" } }`.

  | Code                  | Status |
  | --------------------- | ------ |
  | `VALIDATION_ERROR`    | 400    |
  | `BAD_REQUEST`         | 400    |
  | `UNAUTHORIZED`        | 401    |
  | `FORBIDDEN`           | 403    |
  | `NOT_FOUND`           | 404    |
  | `CONFLICT`            | 409    |
  | `UNPROCESSABLE`       | 422    |
  | `RATE_LIMITED`        | 429    |
  | `INTERNAL_ERROR`      | 500    |
  | `SERVICE_UNAVAILABLE` | 503    |

- **List endpoints:** `?page=1&pageSize=20&search=...&sort=-createdAt`. `pageSize` can be at most 100. `sort` accepts only the fields each endpoint allows.
- **Branch:** always taken from the token. Only super_admin may pass `?branchId=<uuid>`. Branch staff get a 403 if they pass another branch's id.
- **Money and quantities:** returned as decimal strings (e.g. `"1250.50"`).
- **Request ids:** every response carries an `X-Request-Id` header.

## Roles and permissions

- Roles: `super_admin`, `branch_admin`, `accountant`, `doctor`, `front_desk`, `team_manager`, `pharmacy`, `store_keeper`, `delivery_print`.
- Permissions are `<module>.<view|create|update|delete>`. `GET /auth/me` returns the current user's list; the matrix is in `src/lib/permissions.ts`.

## Modules

| Module                | Phase | Endpoints                                                                                                                                                                                                                                              | Access                                                                                 |
| --------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| health                | B0    | `GET /health`                                                                                                                                                                                                                                          | public                                                                                 |
| auth                  | B1    | `POST /auth/login`, `POST /auth/refresh`                                                                                                                                                                                                               | public (rate limited)                                                                  |
| auth                  | B1    | `GET /auth/me`, `PATCH /auth/me`, `POST /auth/change-password`                                                                                                                                                                                         | any staff                                                                              |
| branches              | B1    | `GET/POST /admin/branches`, `GET /admin/branches/options`, `GET/PATCH/DELETE /admin/branches/:id`, `POST /admin/branches/:id/activate`, `POST /admin/branches/:id/deactivate`, `POST /admin/branches/:id/admin`                                        | super_admin                                                                            |
| company               | B1    | `GET/PUT /admin/company-info`                                                                                                                                                                                                                          | super_admin                                                                            |
| staff                 | B1    | `GET/POST /branch/staff`, `GET/PATCH/DELETE /branch/staff/:id`, `POST /branch/staff/:id/reset-password`, `POST /branch/staff/:id/activate`, `POST /branch/staff/:id/deactivate`                                                                        | `staff.*` (branch_admin; super_admin with `?branchId=`)                                |
| categories            | B2    | CRUD `/branch/categories`, `/options`, `POST /:id/image`                                                                                                                                                                                               | `categories.*`                                                                         |
| products              | B2    | CRUD `/branch/products`, `/options`, `POST /:id/image`, `GET/POST /:id/purchases`, `PATCH/DELETE /:id/purchases/:entryId`, `GET /barcode/:code`                                                                                                        | `products.*`                                                                           |
| bundles               | B2    | CRUD `/branch/bundles`, `/options`, `POST /:id/image`                                                                                                                                                                                                  | `bundles.*`                                                                            |
| suppliers             | B2    | CRUD `/branch/suppliers`, `/options?type=`                                                                                                                                                                                                             | `suppliers.*`                                                                          |
| banks                 | B2    | CRUD `/branch/banks`, `/options`                                                                                                                                                                                                                       | `banks.*`                                                                              |
| account sheets        | B2    | CRUD `/branch/account-sheets`, `/options`                                                                                                                                                                                                              | `accounts.*` (options also `appointmentPayments.create/update`, `sales.create/update`) |
| stock in              | B3    | `GET/POST /branch/stock-ins` (JSON or multipart), `GET/PATCH/DELETE /:id`, `POST /:id/attachments`, `GET /:id/attachments/:attachmentId/url`, `DELETE /:id/attachments/:attachmentId`                                                                  | `stock.*`                                                                              |
| stock out             | B3    | same as stock in, under `/branch/stock-outs`                                                                                                                                                                                                           | `stock.*`                                                                              |
| inventory             | B3    | `GET /branch/inventory/stock`, `GET /branch/inventory/report`, `GET /branch/inventory/products/:productId/ledger`                                                                                                                                      | `stock.view` or `inventoryReport.view`                                                 |
| material categories   | B3    | CRUD `/branch/material-categories`                                                                                                                                                                                                                     | `materialCategories.*`                                                                 |
| materials             | B3    | CRUD `/branch/materials`, `GET/POST /:id/receipts`, `PATCH/DELETE /:id/receipts/:receiptId`                                                                                                                                                            | `materials.*`                                                                          |
| recipes               | B3    | CRUD `/branch/recipes`                                                                                                                                                                                                                                 | `recipes.*`                                                                            |
| lab transfers         | B3    | `GET/POST /branch/lab-transfers`, `/options`, `GET/DELETE /:id`                                                                                                                                                                                        | `labTransfers.*`                                                                       |
| productions           | B3    | `GET/POST /branch/productions`, `GET/DELETE /:id`                                                                                                                                                                                                      | `production.*`                                                                         |
| manufacturing reports | B3    | `GET /branch/manufacturing/material-report`, `GET /branch/manufacturing/finished-goods`                                                                                                                                                                | `materialReport.view`, `finishedGoods.view`                                            |
| patients              | B4    | `GET/POST /branch/patients`, `/options`, `/check-phone`, `/cities`, `GET/PATCH/DELETE /:id`, `GET /:id/summary`, `GET /:id/medical-records/files/:fileId/url`                                                                                          | `patients.*` (options, check-phone, cities also `appointments.view`)                   |
| doctors               | B4    | CRUD `/branch/doctors`, `/options`, `/me`, `GET /:id/slots?date=`                                                                                                                                                                                      | `doctors.*` (options and slots also `appointments.view`)                               |
| appointments          | B4    | `GET/POST /branch/appointments` (JSON or multipart), `/calendar`, `GET/PATCH/DELETE /:id`, `POST /:id/status`, `GET/DELETE /:id/attachments/:attachmentId[/url]`, `GET /:id/medical-records/files/:fileId/url`                                         | `appointments.*`; doctors see only their own                                           |
| appointment payments  | B4    | `GET/POST /branch/appointments/:id/payments`, `PATCH/DELETE /:id/payments/:paymentId`, `POST /:id/payments/:paymentId/proof`, `GET /:id/payments/:paymentId/proof-url`, `GET /branch/appointment-payments` (report)                                    | `appointmentPayments.*`                                                                |
| consultations         | B5    | `POST/GET /branch/appointments/:id/consultation`, `GET /branch/consultations`, `GET/DELETE /:id`, `PUT /:id/sections/:key`, `POST /:id/status`, `GET /:id/referral-letter`, `GET /branch/patients/:id/mrs-history`                                     | `consultations.*`; doctors see only their own                                          |
| clinical records      | B5    | `GET/POST /branch/patients/:id/blood-work`, `PATCH/DELETE /:id/blood-work/:resultId`, `GET/POST /:id/bhrt`, `GET/POST /:id/medical-records`, `PATCH/DELETE /:id/medical-records/:recordId`, `POST /:recordId/files`, `DELETE /:recordId/files/:fileId` | `consultations.*`                                                                      |
| prescription catalog  | B5    | `GET /branch/prescription-catalog` (`includeInactive`, `category`), `POST`, `PATCH/DELETE /:id`                                                                                                                                                        | view `prescriptions.view`; manage branch_admin                                         |
| prescriptions         | B5    | `GET/POST /branch/prescriptions`, `GET/PATCH/DELETE /:id`, `GET /:id/print`                                                                                                                                                                            | `prescriptions.*`; doctors see only their own                                          |
| patient timeline      | B5    | `GET /branch/patients/:id/timeline` (super_admin without `branchId`: all branches)                                                                                                                                                                     | `consultations.view`                                                                   |
| doctor signature      | B5    | `POST /branch/doctors/:id/signature`, `GET /branch/doctors/:id/signature-url`                                                                                                                                                                          | `doctors.update` / `doctors.view` or `prescriptions.view`                              |
| sales                 | B6    | `GET/POST /branch/sales` (JSON or multipart), `GET/PATCH/DELETE /:id`, `POST /:id/delivery`, `GET /:id/bill`, `POST /:id/payments`, `PATCH/DELETE /:id/payments/:paymentId`, `POST /:paymentId/proof`, `GET /:paymentId/proof-url`                     | `sales.*`; Front Desk changes only their own                                           |
| delivery slips        | B6    | `GET /branch/sales/delivery-slips`                                                                                                                                                                                                                     | `deliveryReport.view`                                                                  |
| returns               | B6b   | `GET/POST /branch/returns`, `GET /sale/:saleId/returnable`, `GET/DELETE /:id`, `POST /:id/items/:itemId/resolve`, `PUT /:id/refund`                                                                                                                    | `returns.*`                                                                            |
| journal               | B7    | `GET/POST /branch/journal-entries`, `GET/PATCH/DELETE /:id`                                                                                                                                                                                            | `journal.*`                                                                            |
| expenses              | B7    | CRUD `/branch/expense-categories`; `GET/POST /branch/expenses`, `GET/PATCH/DELETE /:id`, `GET /:id/attachment-url`                                                                                                                                     | `expenses.*`                                                                           |
| reports               | B7    | `GET /branch/reports/{sale-products,purchases,stock,appointments,appointment-payments,doctor-sales,patient-history,finance,accounts-balance,expenses}` (`format=csv`)                                                                                  | per report, see PROGRESS                                                               |
| dashboard             | B7    | `GET /branch/dashboard?year=`                                                                                                                                                                                                                          | `dashboard.view`                                                                       |

## Appointment rules

- A doctor cannot have two appointments whose times overlap on the same date (409, `details.conflicts`). Touching ends (10:00–10:30 and 10:30–11:00) are allowed.
- Patients are global and found by phone: the last 9 digits must be unique (409, `details.patient`).
- Files (payment screenshots, remark screenshots, medical records) are private; fetch a signed URL from the matching `/url` endpoint.

## Consultation rules

- Section bodies follow `docs/CLINICAL_FIELDS.md` (OpenAPI schemas `Section_<key>`). A section save replaces the whole section; fields left out are stored as `null`.
- `follow_up` is only for follow up appointments and `referral` only after "Referred to specialist" (422 otherwise).

## Sales and accounting rules

- Sale prices and totals are computed on the server from the products; stock is checked and reduced in the same transaction (422 with `details.shortages`).
- A journal entry's debits must equal its credits (422). An account balance is opening balance + sale payments + appointment payments − return refunds + journal debits − journal credits.
- Reports return `{ title, columns, rows, totals, byBranch?, summary? }`; add `format=csv` for a file.

## Return rules

- Returned goods wait in the returns section; stock changes only when an item is inspected as **restocked**. **Damaged** and **supplier** items never re-enter stock.
- A return cannot exceed sold − already returned per product, and a refund cannot exceed received − earlier refunds (422).
- A sale with returns cannot change its items or be deleted (409).

## Stock rules

- Every stock or material change is a row in an append-only ledger. Editing or deleting a document adds reversing rows.
- A change that would take a product (or a material at a location) below zero is rejected with `422 UNPROCESSABLE` and `details.shortages[]`.
- Product stock is held per batch. Movements that take stock without naming a batch (sales, sale edits, stock out) are split first-expiry-first and skip expired batches; a shortage then also reports `expired`. Stock given back (sale edit, restocked return) returns to the batches the sale took it from.

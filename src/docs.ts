import { generateOpenApiDocument } from './lib/openapi';

import './modules/health/health.schemas';
import './modules/auth/auth.schemas';
import './modules/branches/branches.schemas';
import './modules/company/company.schemas';
import './modules/staff/staff.schemas';
import './modules/categories/categories.schemas';
import './modules/products/products.schemas';
import './modules/bundles/bundles.schemas';
import './modules/suppliers/suppliers.schemas';
import './modules/accounts/accounts.schemas';
import './modules/inventory/stock-documents.schemas';
import './modules/inventory/inventory.schemas';
import './modules/manufacturing/manufacturing.schemas';
import './modules/patients/patients.schemas';
import './modules/doctors/doctors.schemas';
import './modules/appointments/appointments.schemas';
import './modules/consultations/consultations.schemas';
import './modules/clinical-records/clinical-records.schemas';
import './modules/prescriptions/prescriptions.schemas';
import './modules/sales/sales.docs';
import './modules/returns/returns.docs';
import './modules/journal/journal.schemas';
import './modules/expenses/expenses.schemas';
import './modules/reports/reports.schemas';

export const buildOpenApiDocument = generateOpenApiDocument;

import { canManageRole, hasPermission, permissionsFor } from './permissions';

describe('permission matrix (posSoft menus)', () => {
  it('gives the accountant the admin panel without staff, edit or delete', () => {
    expect(hasPermission('accountant', 'sales.view')).toBe(true);
    expect(hasPermission('accountant', 'accounts.create')).toBe(true);
    expect(hasPermission('accountant', 'products.update')).toBe(false);
    expect(hasPermission('accountant', 'products.delete')).toBe(false);
    expect(permissionsFor('accountant').some((p) => p.startsWith('staff.'))).toBe(false);
  });

  it('lets front desk and doctors manage patients, appointments and payments like posSoft', () => {
    for (const role of ['front_desk', 'team_manager', 'doctor'] as const) {
      expect(hasPermission(role, 'patients.delete')).toBe(true);
      expect(hasPermission(role, 'appointments.delete')).toBe(true);
      expect(hasPermission(role, 'appointmentPayments.update')).toBe(true);
      expect(hasPermission(role, 'doctors.view')).toBe(false);
    }
    expect(hasPermission('pharmacy', 'appointments.view')).toBe(false);
  });

  it('lets front desk fill consultations but not prescriptions (D1)', () => {
    expect(hasPermission('front_desk', 'consultations.update')).toBe(true);
    expect(hasPermission('front_desk', 'prescriptions.view')).toBe(false);
    expect(hasPermission('doctor', 'prescriptions.update')).toBe(true);
    expect(hasPermission('doctor', 'prescriptions.delete')).toBe(false);
    expect(hasPermission('branch_admin', 'prescriptions.delete')).toBe(true);
  });

  it('gives B6/B7 modules to the posSoft roles', () => {
    expect(hasPermission('front_desk', 'sales.delete')).toBe(true);
    expect(hasPermission('accountant', 'expenses.create')).toBe(true);
    expect(hasPermission('accountant', 'journal.update')).toBe(false);
    expect(hasPermission('delivery_print', 'deliveryReport.view')).toBe(true);
    expect(hasPermission('front_desk', 'expenses.view')).toBe(false);
  });

  it('limits delivery print to delivery slips', () => {
    expect(permissionsFor('delivery_print')).toEqual(['dashboard.view', 'deliveryReport.view']);
  });

  it('keeps platform modules for super admin only', () => {
    expect(hasPermission('super_admin', 'branches.create')).toBe(true);
    expect(hasPermission('branch_admin', 'branches.view')).toBe(false);
  });

  it('lets branch admins manage every branch role except admins', () => {
    expect(canManageRole('branch_admin', 'front_desk')).toBe(true);
    expect(canManageRole('branch_admin', 'branch_admin')).toBe(false);
    expect(canManageRole('branch_admin', 'super_admin')).toBe(false);
    expect(canManageRole('super_admin', 'branch_admin')).toBe(true);
    expect(canManageRole('front_desk', 'doctor')).toBe(false);
  });
});

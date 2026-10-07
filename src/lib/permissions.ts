export const ROLES = [
  'super_admin',
  'branch_admin',
  'accountant',
  'doctor',
  'front_desk',
  'team_manager',
  'pharmacy',
  'store_keeper',
  'delivery_print',
] as const;

export type Role = (typeof ROLES)[number];
export type BranchRole = Exclude<Role, 'super_admin'>;

export const BRANCH_ROLES = ROLES.filter((r): r is BranchRole => r !== 'super_admin');

export const ROLES_CREATABLE_BY_BRANCH_ADMIN = BRANCH_ROLES.filter((r) => r !== 'branch_admin');

export const PLATFORM_MODULES = ['branches', 'company'] as const;

export const BRANCH_MODULES = [
  'dashboard',
  'staff',
  'doctors',
  'patients',
  'appointments',
  'appointmentPayments',
  'consultations',
  'prescriptions',
  'sales',
  'salePayments',
  'returns',
  'deliveryReport',
  'categories',
  'products',
  'bundles',
  'suppliers',
  'stock',
  'inventoryReport',
  'materials',
  'materialCategories',
  'recipes',
  'labTransfers',
  'production',
  'finishedGoods',
  'materialReport',
  'banks',
  'accounts',
  'journal',
  'expenses',
  'reports',
] as const;

export type Module = (typeof PLATFORM_MODULES)[number] | (typeof BRANCH_MODULES)[number];
export const ACTIONS = ['view', 'create', 'update', 'delete'] as const;
export type Action = (typeof ACTIONS)[number];
export type Permission = `${Module}.${Action}`;

type Grants = Partial<Record<Module, readonly Action[]>>;

const FULL = ACTIONS;
const VIEW = ['view'] as const;
const VIEW_CREATE = ['view', 'create'] as const;
const VIEW_CREATE_UPDATE = ['view', 'create', 'update'] as const;

const grantAll = (modules: readonly Module[], actions: readonly Action[]): Grants =>
  Object.fromEntries(modules.map((m) => [m, actions]));

const frontDeskGrants: Grants = {
  dashboard: VIEW,
  patients: FULL,
  appointments: FULL,
  appointmentPayments: FULL,
  consultations: VIEW_CREATE_UPDATE,
  sales: FULL,
  returns: VIEW_CREATE,
  products: VIEW,
  bundles: VIEW,
  inventoryReport: VIEW,
  reports: VIEW,
};

const MATRIX: Record<Role, Grants> = {
  super_admin: grantAll([...PLATFORM_MODULES, ...BRANCH_MODULES], FULL),
  branch_admin: grantAll(BRANCH_MODULES, FULL),
  accountant: {
    ...grantAll(
      BRANCH_MODULES.filter((m) => m !== 'staff'),
      VIEW_CREATE,
    ),
    salePayments: ['view', 'update'],
  },
  doctor: {
    dashboard: VIEW,
    patients: FULL,
    appointments: FULL,
    appointmentPayments: FULL,
    consultations: VIEW_CREATE_UPDATE,
    prescriptions: VIEW_CREATE_UPDATE,
    reports: VIEW,
  },
  front_desk: frontDeskGrants,
  team_manager: frontDeskGrants,
  pharmacy: {
    dashboard: VIEW,
    returns: ['view', 'update'],
    stock: VIEW_CREATE_UPDATE,
    inventoryReport: VIEW,
    materials: VIEW,
    materialCategories: VIEW_CREATE_UPDATE,
    labTransfers: VIEW,
    production: VIEW_CREATE_UPDATE,
    recipes: VIEW_CREATE_UPDATE,
    finishedGoods: VIEW,
    materialReport: VIEW,
    products: VIEW,
    suppliers: VIEW,
  },
  store_keeper: {
    dashboard: VIEW,
    returns: ['view', 'update'],
    materials: VIEW_CREATE_UPDATE,
    materialCategories: VIEW_CREATE_UPDATE,
    recipes: VIEW_CREATE_UPDATE,
    labTransfers: VIEW_CREATE_UPDATE,
    production: VIEW,
    finishedGoods: VIEW,
    materialReport: VIEW,
    stock: VIEW_CREATE_UPDATE,
    inventoryReport: VIEW,
    products: VIEW,
    suppliers: VIEW,
  },
  delivery_print: {
    dashboard: VIEW,
    deliveryReport: VIEW,
  },
};

function expand(grants: Grants): ReadonlySet<Permission> {
  const permissions = new Set<Permission>();
  for (const [module, actions] of Object.entries(grants)) {
    for (const action of actions ?? []) permissions.add(`${module}.${action}` as Permission);
  }
  return permissions;
}

const PERMISSIONS_BY_ROLE = new Map<Role, ReadonlySet<Permission>>(
  ROLES.map((role) => [role, expand(MATRIX[role])]),
);

export function permissionsFor(role: Role): Permission[] {
  return [...(PERMISSIONS_BY_ROLE.get(role) ?? [])].sort();
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return PERMISSIONS_BY_ROLE.get(role)?.has(permission) ?? false;
}

export function canManageRole(actorRole: Role, targetRole: Role): boolean {
  if (actorRole === 'super_admin') return targetRole !== 'super_admin';
  if (actorRole === 'branch_admin') return (ROLES_CREATABLE_BY_BRANCH_ADMIN as Role[]).includes(targetRole);
  return false;
}

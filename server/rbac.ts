export type PermissionModule =
  | 'dashboard'
  | 'crm'
  | 'products'
  | 'manufacturing'
  | 'sales'
  | 'purchasing'
  | 'pos'
  | 'billing'
  | 'support'
  | 'projects'
  | 'hr'
  | 'tools'
  | 'admin'
  | 'audit';

export type PermissionAction =
  | 'read'
  | 'write'
  | 'validate'
  | 'delete'
  | 'export'
  | 'adjust_stock'
  | 'record_payment'
  | 'log_time'
  | 'manage_roles'
  | 'unlock_users';

export type PermissionMap = Partial<Record<PermissionModule, PermissionAction[]>>;

export interface PermissionCatalogEntry {
  module: PermissionModule;
  label: string;
  description: string;
  actions: { key: PermissionAction; label: string }[];
}

export const PERMISSION_CATALOG: PermissionCatalogEntry[] = [
  {
    module: 'dashboard',
    label: 'Executive Dashboard',
    description: 'View KPIs, cashflow charts, and operational summaries.',
    actions: [{ key: 'read', label: 'View' }],
  },
  {
    module: 'crm',
    label: 'Third Parties, Members & Partnerships',
    description: 'Manage customers, prospects, suppliers, contacts, members, and partnerships.',
    actions: [
      { key: 'read', label: 'View' },
      { key: 'write', label: 'Create / Edit' },
      { key: 'delete', label: 'Delete' },
      { key: 'export', label: 'Export' },
    ],
  },
  {
    module: 'products',
    label: 'Products, Lots, Variants & Warehouses',
    description: 'Manage catalog, barcodes, variants, lots/serials, and warehouse stock.',
    actions: [
      { key: 'read', label: 'View' },
      { key: 'write', label: 'Create / Edit' },
      { key: 'adjust_stock', label: 'Adjust Stock' },
      { key: 'delete', label: 'Delete' },
    ],
  },
  {
    module: 'manufacturing',
    label: 'Manufacturing (BOM, MO & Workstations)',
    description: 'Manage bills of materials, workstations, and production orders.',
    actions: [
      { key: 'read', label: 'View' },
      { key: 'write', label: 'Create / Edit' },
      { key: 'validate', label: 'Produce / Complete' },
      { key: 'delete', label: 'Delete' },
    ],
  },
  {
    module: 'sales',
    label: 'CRM Pipeline, Proposals, Orders & Contracts',
    description: 'Manage opportunities, proposals with online signing, orders, shipments, interventions, and contracts.',
    actions: [
      { key: 'read', label: 'View' },
      { key: 'write', label: 'Create / Edit' },
      { key: 'validate', label: 'Validate / Convert' },
      { key: 'delete', label: 'Delete' },
    ],
  },
  {
    module: 'purchasing',
    label: 'Supplier RFQs, Purchase Orders & Incoterms',
    description: 'Manage pricing requests, purchase orders, receptions, and supplier bills.',
    actions: [
      { key: 'read', label: 'View' },
      { key: 'write', label: 'Create / Edit' },
      { key: 'validate', label: 'Order / Receive' },
      { key: 'delete', label: 'Delete' },
    ],
  },
  {
    module: 'pos',
    label: 'Point of Sale (TakePOS)',
    description: 'Operate retail point-of-sale checkout, barcode scanning, and instant receipts.',
    actions: [
      { key: 'read', label: 'View Register' },
      { key: 'write', label: 'Process Sale' },
    ],
  },
  {
    module: 'billing',
    label: 'Billing, SEPA, Accounting, Loans & Donations',
    description: 'Issue invoices/credit notes, SEPA batches, accounting journal entries, donations, loans, and margin reports.',
    actions: [
      { key: 'read', label: 'View' },
      { key: 'write', label: 'Create / Edit' },
      { key: 'validate', label: 'Validate' },
      { key: 'record_payment', label: 'Record Payment' },
      { key: 'delete', label: 'Delete' },
    ],
  },
  {
    module: 'support',
    label: 'Tickets & Knowledge Base',
    description: 'Manage customer support tickets and internal/public knowledge base articles.',
    actions: [
      { key: 'read', label: 'View' },
      { key: 'write', label: 'Create / Reply' },
      { key: 'validate', label: 'Close / Publish' },
      { key: 'delete', label: 'Delete' },
    ],
  },
  {
    module: 'projects',
    label: 'Projects, Calendar, Events & Surveys',
    description: 'Manage projects, tasks, shared iCal/vCal calendar, event organization, and surveys.',
    actions: [
      { key: 'read', label: 'View' },
      { key: 'write', label: 'Create / Edit' },
      { key: 'log_time', label: 'Log Time' },
      { key: 'delete', label: 'Delete' },
    ],
  },
  {
    module: 'hr',
    label: 'Human Resources (Staff, Leave, Expenses, Hiring)',
    description: 'Manage staff profiles, leave approvals, expense reports, recruitment, and timesheets.',
    actions: [
      { key: 'read', label: 'View' },
      { key: 'write', label: 'Submit / Edit' },
      { key: 'validate', label: 'Approve Leave / Expenses' },
      { key: 'delete', label: 'Delete' },
    ],
  },
  {
    module: 'tools',
    label: 'EDM, Bookmarks, Mass Email, Collector & AI',
    description: 'Access document storage, bookmarks, data import/export, email collector, mass mailing, and AI assistant.',
    actions: [
      { key: 'read', label: 'View' },
      { key: 'write', label: 'Create / Send / AI' },
      { key: 'export', label: 'Import / Export' },
      { key: 'delete', label: 'Delete' },
    ],
  },
  {
    module: 'admin',
    label: 'Users, Roles, Modules & Integrations',
    description: 'Manage team accounts, RBAC matrix, optional modules, LDAP/Payment connectors, and MFA policy.',
    actions: [
      { key: 'read', label: 'View' },
      { key: 'write', label: 'Manage Users & Modules' },
      { key: 'manage_roles', label: 'Edit Roles & Integrations' },
      { key: 'unlock_users', label: 'Unlock / Reset MFA' },
    ],
  },
  {
    module: 'audit',
    label: 'System Audit Log',
    description: 'Inspect security events and system mutation logs.',
    actions: [
      { key: 'read', label: 'View' },
      { key: 'export', label: 'Export' },
    ],
  },
];

export interface DefaultRoleDefinition {
  slug: string;
  name: string;
  description: string;
  requireMfa: boolean;
  isSystem: boolean;
  permissions: PermissionMap;
}

export const DEFAULT_ROLES: DefaultRoleDefinition[] = [
  {
    slug: 'super_admin',
    name: 'Super Admin',
    description: 'Unrestricted access across all ERP modules, optional module manager, RBAC configuration, and security policies.',
    requireMfa: true,
    isSystem: true,
    permissions: {
      dashboard: ['read'],
      crm: ['read', 'write', 'delete', 'export'],
      products: ['read', 'write', 'adjust_stock', 'delete'],
      manufacturing: ['read', 'write', 'validate', 'delete'],
      sales: ['read', 'write', 'validate', 'delete'],
      purchasing: ['read', 'write', 'validate', 'delete'],
      pos: ['read', 'write'],
      billing: ['read', 'write', 'validate', 'record_payment', 'delete'],
      support: ['read', 'write', 'validate', 'delete'],
      projects: ['read', 'write', 'log_time', 'delete'],
      hr: ['read', 'write', 'validate', 'delete'],
      tools: ['read', 'write', 'export', 'delete'],
      admin: ['read', 'write', 'manage_roles', 'unlock_users'],
      audit: ['read', 'export'],
    },
  },
  {
    slug: 'finance_manager',
    name: 'Finance Manager',
    description: 'Full control over invoicing, credit notes, SEPA, accounting ledger, loans, donations, margins, and audit reports.',
    requireMfa: true,
    isSystem: false,
    permissions: {
      dashboard: ['read'],
      crm: ['read', 'export'],
      products: ['read'],
      sales: ['read'],
      purchasing: ['read', 'write', 'validate'],
      billing: ['read', 'write', 'validate', 'record_payment', 'delete'],
      hr: ['read', 'validate'],
      projects: ['read'],
      tools: ['read', 'export'],
      audit: ['read', 'export'],
    },
  },
  {
    slug: 'sales_manager',
    name: 'Sales & CRM Manager',
    description: 'Manage third parties, members, opportunities, proposals, orders, contracts, POS, and support tickets.',
    requireMfa: false,
    isSystem: false,
    permissions: {
      dashboard: ['read'],
      crm: ['read', 'write', 'export'],
      products: ['read'],
      sales: ['read', 'write', 'validate'],
      pos: ['read', 'write'],
      billing: ['read', 'write'],
      support: ['read', 'write', 'validate'],
      projects: ['read', 'write'],
      tools: ['read', 'write'],
    },
  },
  {
    slug: 'warehouse_operator',
    name: 'Warehouse & Manufacturing Operator',
    description: 'Manage catalog, barcodes, lots/serials, multi-warehouse stock, BOMs, manufacturing orders, and shipments.',
    requireMfa: false,
    isSystem: false,
    permissions: {
      dashboard: ['read'],
      crm: ['read'],
      products: ['read', 'write', 'adjust_stock'],
      manufacturing: ['read', 'write', 'validate'],
      sales: ['read', 'validate'],
      purchasing: ['read', 'write', 'validate'],
      tools: ['read'],
    },
  },
  {
    slug: 'project_coordinator',
    name: 'HR & Projects Coordinator',
    description: 'Manage projects, tasks, shared calendar, events, surveys, HR leave, expenses, recruitment, and timesheets.',
    requireMfa: false,
    isSystem: false,
    permissions: {
      dashboard: ['read'],
      crm: ['read'],
      products: ['read'],
      projects: ['read', 'write', 'log_time'],
      hr: ['read', 'write', 'validate'],
      support: ['read', 'write'],
      tools: ['read', 'write'],
    },
  },
];

export function hasPermission(
  permissions: PermissionMap | null | undefined,
  module: PermissionModule,
  action: PermissionAction
): boolean {
  if (!permissions) return false;
  const actions = permissions[module];
  return Array.isArray(actions) && actions.includes(action);
}

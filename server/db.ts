import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_ROLES } from './rbac.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'meridian.db');

export const db = new DatabaseSync(DB_PATH);

export interface OptionalModuleDefinition {
  module_key: string;
  name: string;
  category: string;
  description: string;
  enabled: number;
  locked: number;
}

export const DEFAULT_OPTIONAL_MODULES: Array<Omit<OptionalModuleDefinition, 'enabled'> & { enabled: boolean }> = [
  { module_key: 'crm', name: 'Third Parties & Contacts', category: 'CRM & Directory', description: 'Customers, prospects, suppliers, contacts, and social/dialing links.', enabled: true, locked: 0 },
  { module_key: 'members', name: 'Members & Foundations', category: 'CRM & Directory', description: 'Association memberships, subscriptions, and renewal tracking.', enabled: true, locked: 0 },
  { module_key: 'partnerships', name: 'Partnerships', category: 'CRM & Directory', description: 'Partner agreements, co-selling tracking, and commission terms.', enabled: true, locked: 0 },
  { module_key: 'products', name: 'Products, Stock & Barcodes', category: 'Supply Chain', description: 'Catalog, warehouses, barcodes, lots/serials, and product variants.', enabled: true, locked: 0 },
  { module_key: 'manufacturing', name: 'Manufacturing (BOM, MO & Workstations)', category: 'Supply Chain', description: 'Workstations, bills of materials, and production orders.', enabled: true, locked: 0 },
  { module_key: 'sales', name: 'Sales, Opportunities & Contracts', category: 'Commerce', description: 'Leads/opportunities, proposals with online signing, orders, shipments, contracts, and interventions.', enabled: true, locked: 0 },
  { module_key: 'purchasing', name: 'Purchasing, RFQs & Incoterms', category: 'Commerce', description: 'Supplier pricing requests, purchase orders, receptions, and INCOTERMS.', enabled: true, locked: 0 },
  { module_key: 'pos', name: 'Point of Sale (TakePOS)', category: 'Commerce', description: 'Retail checkout register with barcode lookup and instant payment.', enabled: true, locked: 0 },
  { module_key: 'billing', name: 'Billing, Credit Notes & Banking', category: 'Finance', description: 'Customer/supplier invoices, credit notes, bank accounts, and SEPA batches.', enabled: true, locked: 0 },
  { module_key: 'accounting', name: 'Accounting, Loans, Donations & Margins', category: 'Finance', description: 'Chart of accounts, balanced journal ledger, donations, loans, and margin reports.', enabled: true, locked: 0 },
  { module_key: 'support', name: 'Tickets & Knowledge Base', category: 'Service & Collaboration', description: 'Customer support desk and searchable knowledge management articles.', enabled: true, locked: 0 },
  { module_key: 'projects', name: 'Projects & Tasks', category: 'Service & Collaboration', description: 'Project budgets, tasks, and billable time tracking.', enabled: true, locked: 0 },
  { module_key: 'collaboration', name: 'Calendar (iCal/vCal), Events & Surveys', category: 'Service & Collaboration', description: 'Shared agenda with .ics/.vcs import/export, event organization, and surveys.', enabled: true, locked: 0 },
  { module_key: 'hr', name: 'Human Resources (HR)', category: 'People', description: 'Staff directory, leave requests, expense reports, recruitment, and timesheets.', enabled: true, locked: 0 },
  { module_key: 'edm', name: 'Electronic Document Management (EDM)', category: 'Workspace Tools', description: 'Structured file/document registry with version and folder organization.', enabled: true, locked: 0 },
  { module_key: 'tools', name: 'Bookmarks, Data Import/Export, Mass Mail & RSS', category: 'Workspace Tools', description: 'Shared bookmarks, CSV import/export, mass emailing, email collector, and RSS.', enabled: true, locked: 0 },
  { module_key: 'ai_assistant', name: 'AI Support Assistant', category: 'Workspace Tools', description: 'Server-side Gemini AI assistance for summaries, proposals, and ticket drafts.', enabled: true, locked: 0 },
  { module_key: 'admin', name: 'Security, RBAC & Audit', category: 'Administration', description: 'Core access control, MFA, optional modules, integrations, and audit log.', enabled: true, locked: 1 },
];

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    permissions_json TEXT NOT NULL,
    require_mfa INTEGER NOT NULL DEFAULT 0,
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role_id INTEGER NOT NULL REFERENCES roles(id),
    is_active INTEGER NOT NULL DEFAULT 1,
    mfa_enabled INTEGER NOT NULL DEFAULT 0,
    mfa_secret TEXT,
    mfa_pending_secret TEXT,
    mfa_last_step INTEGER,
    recovery_codes_json TEXT NOT NULL DEFAULT '[]',
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    last_login_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS security_policy (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    max_failed_attempts INTEGER NOT NULL DEFAULT 5,
    lockout_minutes INTEGER NOT NULL DEFAULT 15,
    session_ttl_hours INTEGER NOT NULL DEFAULT 12,
    enforce_mfa_global INTEGER NOT NULL DEFAULT 0,
    min_password_length INTEGER NOT NULL DEFAULT 10,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_email TEXT NOT NULL DEFAULT 'system',
    action TEXT NOT NULL,
    module TEXT NOT NULL,
    entity_ref TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    ip_address TEXT NOT NULL DEFAULT '',
    severity TEXT NOT NULL DEFAULT 'info',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS modules_config (
    module_key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    locked INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS third_parties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    party_type TEXT NOT NULL CHECK (party_type IN ('customer', 'prospect', 'supplier', 'customer_supplier')),
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    tax_id TEXT NOT NULL DEFAULT '',
    payment_terms TEXT NOT NULL DEFAULT 'Net 30',
    credit_limit REAL NOT NULL DEFAULT 25000,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    notes TEXT NOT NULL DEFAULT '',
    social_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    third_party_id INTEGER NOT NULL REFERENCES third_parties(id) ON DELETE CASCADE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    job_title TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    organization TEXT NOT NULL DEFAULT '',
    member_type TEXT NOT NULL DEFAULT 'Individual' CHECK (member_type IN ('Individual', 'Corporate', 'Foundation Patron', 'Student')),
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    subscription_fee REAL NOT NULL DEFAULT 150,
    start_date TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'expired', 'resiliated')),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS partnerships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    third_party_id INTEGER NOT NULL REFERENCES third_parties(id),
    partner_tier TEXT NOT NULL DEFAULT 'Silver' CHECK (partner_tier IN ('Referral', 'Silver', 'Gold', 'Strategic')),
    commission_pct REAL NOT NULL DEFAULT 10,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'paused', 'closed')),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS warehouses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    product_type TEXT NOT NULL CHECK (product_type IN ('product', 'service')),
    category TEXT NOT NULL DEFAULT 'General',
    description TEXT NOT NULL DEFAULT '',
    cost_price REAL NOT NULL DEFAULT 0,
    sell_price REAL NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 20,
    min_stock INTEGER NOT NULL DEFAULT 10,
    barcode TEXT NOT NULL DEFAULT '',
    on_sale INTEGER NOT NULL DEFAULT 1,
    on_purchase INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS stock_levels (
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (product_id, warehouse_id)
  );

  CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('in', 'out', 'transfer', 'adjustment')),
    quantity_delta INTEGER NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    doc_ref TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS product_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    lot_number TEXT NOT NULL,
    serial_number TEXT NOT NULL DEFAULT '',
    quantity INTEGER NOT NULL DEFAULT 0,
    manufacture_date TEXT NOT NULL DEFAULT '',
    expiry_date TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'quarantine', 'consumed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS product_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    sku_suffix TEXT NOT NULL,
    attribute_name TEXT NOT NULL,
    attribute_value TEXT NOT NULL,
    price_delta REAL NOT NULL DEFAULT 0,
    stock_qty INTEGER NOT NULL DEFAULT 0,
    barcode TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS workstations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    hourly_cost REAL NOT NULL DEFAULT 65,
    capacity_per_day INTEGER NOT NULL DEFAULT 8,
    status TEXT NOT NULL DEFAULT 'operational' CHECK (status IN ('operational', 'maintenance', 'offline')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS boms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    workstation_id INTEGER REFERENCES workstations(id),
    label TEXT NOT NULL,
    output_qty INTEGER NOT NULL DEFAULT 1,
    components_json TEXT NOT NULL DEFAULT '[]',
    estimated_minutes INTEGER NOT NULL DEFAULT 60,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS manufacturing_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    bom_id INTEGER NOT NULL REFERENCES boms(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    workstation_id INTEGER REFERENCES workstations(id),
    qty_planned INTEGER NOT NULL DEFAULT 1,
    qty_produced INTEGER NOT NULL DEFAULT 0,
    scheduled_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'in_progress', 'produced', 'cancelled')),
    notes TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS opportunities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    third_party_id INTEGER NOT NULL REFERENCES third_parties(id),
    title TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'qualification' CHECK (stage IN ('qualification', 'proposition', 'negotiation', 'won', 'lost')),
    probability INTEGER NOT NULL DEFAULT 25,
    amount REAL NOT NULL DEFAULT 0,
    close_date TEXT NOT NULL,
    owner_name TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    third_party_id INTEGER NOT NULL REFERENCES third_parties(id),
    title TEXT NOT NULL,
    issue_date TEXT NOT NULL,
    valid_until TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'signed', 'declined', 'billed')),
    lines_json TEXT NOT NULL DEFAULT '[]',
    subtotal_ht REAL NOT NULL DEFAULT 0,
    tax_total REAL NOT NULL DEFAULT 0,
    total_ttc REAL NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    signed_by TEXT NOT NULL DEFAULT '',
    signed_at TEXT NOT NULL DEFAULT '',
    signature_name TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sales_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    third_party_id INTEGER NOT NULL REFERENCES third_parties(id),
    proposal_ref TEXT NOT NULL DEFAULT '',
    order_date TEXT NOT NULL,
    delivery_date TEXT NOT NULL,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    incoterm TEXT NOT NULL DEFAULT 'EXW',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'shipped', 'billed', 'cancelled')),
    lines_json TEXT NOT NULL DEFAULT '[]',
    subtotal_ht REAL NOT NULL DEFAULT 0,
    tax_total REAL NOT NULL DEFAULT 0,
    total_ttc REAL NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS shipments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    sales_order_id INTEGER NOT NULL REFERENCES sales_orders(id),
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    carrier TEXT NOT NULL DEFAULT 'DHL Express',
    tracking_number TEXT NOT NULL DEFAULT '',
    ship_date TEXT NOT NULL,
    weight_kg REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'packed', 'in_transit', 'delivered')),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    third_party_id INTEGER NOT NULL REFERENCES third_parties(id),
    title TEXT NOT NULL,
    billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'quarterly', 'annual')),
    recurring_amount REAL NOT NULL DEFAULT 0,
    start_date TEXT NOT NULL,
    next_billing_date TEXT NOT NULL,
    end_date TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'suspended', 'closed')),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS interventions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    third_party_id INTEGER NOT NULL REFERENCES third_parties(id),
    title TEXT NOT NULL,
    technician_name TEXT NOT NULL DEFAULT '',
    scheduled_date TEXT NOT NULL,
    duration_hours REAL NOT NULL DEFAULT 2,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'billed')),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS supplier_rfqs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    third_party_id INTEGER NOT NULL REFERENCES third_parties(id),
    title TEXT NOT NULL,
    request_date TEXT NOT NULL,
    deadline_date TEXT NOT NULL,
    incoterm TEXT NOT NULL DEFAULT 'CIF',
    lines_json TEXT NOT NULL DEFAULT '[]',
    estimated_total REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'quoted', 'accepted', 'declined')),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    third_party_id INTEGER NOT NULL REFERENCES third_parties(id),
    order_date TEXT NOT NULL,
    expected_date TEXT NOT NULL,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    incoterm TEXT NOT NULL DEFAULT 'FOB',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ordered', 'received', 'billed', 'cancelled')),
    lines_json TEXT NOT NULL DEFAULT '[]',
    subtotal_ht REAL NOT NULL DEFAULT 0,
    tax_total REAL NOT NULL DEFAULT 0,
    total_ttc REAL NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    invoice_type TEXT NOT NULL CHECK (invoice_type IN ('customer', 'supplier')),
    invoice_kind TEXT NOT NULL DEFAULT 'standard' CHECK (invoice_kind IN ('standard', 'credit_note')),
    third_party_id INTEGER NOT NULL REFERENCES third_parties(id),
    source_ref TEXT NOT NULL DEFAULT '',
    issue_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'partial', 'paid', 'cancelled')),
    lines_json TEXT NOT NULL DEFAULT '[]',
    subtotal_ht REAL NOT NULL DEFAULT 0,
    tax_total REAL NOT NULL DEFAULT 0,
    total_ttc REAL NOT NULL DEFAULT 0,
    amount_paid REAL NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bank_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    bank_name TEXT NOT NULL DEFAULT '',
    account_number TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'USD',
    balance REAL NOT NULL DEFAULT 0,
    account_type TEXT NOT NULL DEFAULT 'checking' CHECK (account_type IN ('checking', 'savings', 'cash')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bank_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
    tx_date TEXT NOT NULL,
    label TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Operations',
    amount REAL NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
    invoice_ref TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sepa_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    batch_type TEXT NOT NULL CHECK (batch_type IN ('direct_debit', 'credit_transfer')),
    bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
    execution_date TEXT NOT NULL,
    total_amount REAL NOT NULL DEFAULT 0,
    items_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'transmitted', 'settled')),
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS accounting_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    account_class TEXT NOT NULL CHECK (account_class IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
    balance REAL NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    entry_date TEXT NOT NULL,
    journal_code TEXT NOT NULL DEFAULT 'GEN',
    description TEXT NOT NULL,
    debit_account_code TEXT NOT NULL,
    credit_account_code TEXT NOT NULL,
    amount REAL NOT NULL,
    source_ref TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS donations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    donor_name TEXT NOT NULL,
    donor_email TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL,
    donation_date TEXT NOT NULL,
    payment_mode TEXT NOT NULL DEFAULT 'Bank Transfer',
    status TEXT NOT NULL DEFAULT 'promised' CHECK (status IN ('promised', 'received', 'cancelled')),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    lender_name TEXT NOT NULL,
    principal_amount REAL NOT NULL,
    remaining_principal REAL NOT NULL,
    interest_rate REAL NOT NULL DEFAULT 4.5,
    term_months INTEGER NOT NULL DEFAULT 36,
    start_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paid_off')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    third_party_id INTEGER REFERENCES third_parties(id),
    subject TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Technical Support',
    severity TEXT NOT NULL DEFAULT 'normal' CHECK (severity IN ('low', 'normal', 'high', 'critical')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_customer', 'closed')),
    assignee_name TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    replies_json TEXT NOT NULL DEFAULT '[]',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS kb_articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Operations',
    content TEXT NOT NULL,
    is_public INTEGER NOT NULL DEFAULT 1,
    views INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    third_party_id INTEGER REFERENCES third_parties(id),
    start_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    budget_amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'on_hold', 'completed')),
    progress INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ref TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    assignee_name TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'review', 'done')),
    estimated_hours REAL NOT NULL DEFAULT 0,
    logged_hours REAL NOT NULL DEFAULT 0,
    progress INTEGER NOT NULL DEFAULT 0,
    due_date TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS agenda_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    event_type TEXT NOT NULL DEFAULT 'meeting' CHECK (event_type IN ('meeting', 'call', 'deadline', 'intervention', 'holiday')),
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    organizer TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS org_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    event_date TEXT NOT NULL,
    venue TEXT NOT NULL DEFAULT '',
    capacity INTEGER NOT NULL DEFAULT 100,
    registered_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'full', 'completed')),
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS surveys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    question TEXT NOT NULL,
    options_json TEXT NOT NULL DEFAULT '[]',
    votes_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT 'Operations',
    job_title TEXT NOT NULL DEFAULT '',
    hire_date TEXT NOT NULL,
    annual_salary REAL NOT NULL DEFAULT 75000,
    leave_balance_days REAL NOT NULL DEFAULT 20,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'on_leave', 'terminated')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS leave_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type TEXT NOT NULL DEFAULT 'Paid Time Off' CHECK (leave_type IN ('Paid Time Off', 'Sick Leave', 'Parental', 'Unpaid')),
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    days REAL NOT NULL DEFAULT 1,
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS expense_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    category TEXT NOT NULL DEFAULT 'Travel',
    expense_date TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted', 'approved', 'paid', 'rejected')),
    approved_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS job_postings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    department TEXT NOT NULL DEFAULT 'Engineering',
    location TEXT NOT NULL DEFAULT 'Remote / HQ',
    contract_type TEXT NOT NULL DEFAULT 'Full-Time',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'closed')),
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    stage TEXT NOT NULL DEFAULT 'applied' CHECK (stage IN ('applied', 'screening', 'interview', 'offer', 'hired', 'rejected')),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS timesheets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id),
    work_date TEXT NOT NULL,
    hours REAL NOT NULL DEFAULT 8,
    task_label TEXT NOT NULL DEFAULT '',
    billable INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS edm_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    folder TEXT NOT NULL DEFAULT 'General',
    mime_type TEXT NOT NULL DEFAULT 'text/plain',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '',
    content_text TEXT NOT NULL DEFAULT '',
    uploaded_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'ERP Shortcuts',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS email_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    subject TEXT NOT NULL,
    target_segment TEXT NOT NULL DEFAULT 'all_customers',
    body_text TEXT NOT NULL,
    recipient_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent')),
    sent_at TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS collected_emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    snippet TEXT NOT NULL,
    matched_party TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'unprocessed' CHECK (status IN ('unprocessed', 'converted_ticket', 'archived')),
    received_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS integrations_config (
    config_key TEXT PRIMARY KEY,
    config_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS system_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    app_name TEXT NOT NULL DEFAULT 'KSCAT-ERP',
    company_name TEXT NOT NULL DEFAULT 'KS Cross Asia Technologies Inc.',
    company_email TEXT NOT NULL DEFAULT 'info@kscat-erp.example',
    company_phone TEXT NOT NULL DEFAULT '+63 2 8555 0190',
    company_address TEXT NOT NULL DEFAULT 'BGC Corporate Center, Taguig, Metro Manila',
    tax_id TEXT NOT NULL DEFAULT 'TIN-009-482-110-000',
    default_currency TEXT NOT NULL DEFAULT 'USD',
    default_tax_rate REAL NOT NULL DEFAULT 12.0,
    default_payment_terms TEXT NOT NULL DEFAULT 'Net 30',
    default_incoterm TEXT NOT NULL DEFAULT 'FOB',
    fiscal_year_start INTEGER NOT NULL DEFAULT 1,
    date_format TEXT NOT NULL DEFAULT 'MMM d, yyyy',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function ensureColumn(table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Safe additive migrations for existing databases
ensureColumn('users', 'phone', "TEXT NOT NULL DEFAULT ''");
ensureColumn('users', 'job_title', "TEXT NOT NULL DEFAULT ''");
ensureColumn('users', 'department', "TEXT NOT NULL DEFAULT ''");
ensureColumn('users', 'timezone', "TEXT NOT NULL DEFAULT 'Asia/Manila'");
ensureColumn('third_parties', 'social_json', "TEXT NOT NULL DEFAULT '{}'");
ensureColumn('products', 'barcode', "TEXT NOT NULL DEFAULT ''");
ensureColumn('proposals', 'signed_by', "TEXT NOT NULL DEFAULT ''");
ensureColumn('proposals', 'signed_at', "TEXT NOT NULL DEFAULT ''");
ensureColumn('proposals', 'signature_name', "TEXT NOT NULL DEFAULT ''");
ensureColumn('sales_orders', 'incoterm', "TEXT NOT NULL DEFAULT 'EXW'");
ensureColumn('purchase_orders', 'incoterm', "TEXT NOT NULL DEFAULT 'FOB'");
ensureColumn('invoices', 'invoice_kind', "TEXT NOT NULL DEFAULT 'standard'");

export function ensureDefaults(): void {
  const roleCountRow = db.prepare('SELECT COUNT(*) as cnt FROM roles').get() as { cnt: number };
  if (roleCountRow.cnt === 0) {
    const insertRole = db.prepare(
      `INSERT INTO roles (slug, name, description, permissions_json, require_mfa, is_system)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const r of DEFAULT_ROLES) {
      insertRole.run(
        r.slug,
        r.name,
        r.description,
        JSON.stringify(r.permissions),
        r.requireMfa ? 1 : 0,
        r.isSystem ? 1 : 0
      );
    }
  } else {
    // Keep super_admin aligned with newly introduced permission modules
    const superDef = DEFAULT_ROLES.find((r) => r.slug === 'super_admin');
    if (superDef) {
      const existingSuper = db
        .prepare("SELECT id, permissions_json FROM roles WHERE slug = 'super_admin'")
        .get() as { id: number; permissions_json: string } | undefined;
      if (existingSuper) {
        try {
          const parsed = JSON.parse(existingSuper.permissions_json) as Record<string, string[]>;
          if (!parsed.manufacturing || !parsed.pos || !parsed.hr || !parsed.tools || !parsed.support) {
            db.prepare('UPDATE roles SET permissions_json = ? WHERE id = ?').run(
              JSON.stringify(superDef.permissions),
              existingSuper.id
            );
          }
        } catch {
          db.prepare('UPDATE roles SET permissions_json = ? WHERE id = ?').run(
            JSON.stringify(superDef.permissions),
            existingSuper.id
          );
        }
      }
    }
  }

  const policyRow = db.prepare('SELECT id FROM security_policy WHERE id = 1').get();
  if (!policyRow) {
    db.prepare(
      `INSERT INTO security_policy (id, max_failed_attempts, lockout_minutes, session_ttl_hours, enforce_mfa_global, min_password_length)
       VALUES (1, 5, 15, 12, 0, 10)`
    ).run();
  }

  const sysSettingsRow = db.prepare('SELECT id FROM system_settings WHERE id = 1').get();
  if (!sysSettingsRow) {
    db.prepare(
      `INSERT INTO system_settings (id, app_name, company_name) VALUES (1, 'KSCAT-ERP', 'KS Cross Asia Technologies Inc.')`
    ).run();
  }

  const insertMod = db.prepare(
    `INSERT OR IGNORE INTO modules_config (module_key, name, category, description, enabled, locked)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const m of DEFAULT_OPTIONAL_MODULES) {
    insertMod.run(m.module_key, m.name, m.category, m.description, m.enabled ? 1 : 0, m.locked);
  }

  const acctCount = db.prepare('SELECT COUNT(*) as cnt FROM accounting_accounts').get() as { cnt: number };
  if (acctCount.cnt === 0) {
    const insAcct = db.prepare(
      `INSERT INTO accounting_accounts (code, label, account_class, balance) VALUES (?, ?, ?, ?)`
    );
    insAcct.run('1010', 'Operating Cash & Checking', 'asset', 366370.8);
    insAcct.run('1200', 'Accounts Receivable', 'asset', 9292.0);
    insAcct.run('1400', 'Merchandise Inventory', 'asset', 26840.0);
    insAcct.run('2000', 'Accounts Payable', 'liability', 8448.0);
    insAcct.run('2200', 'VAT / Sales Tax Payable', 'liability', 2196.8);
    insAcct.run('2500', 'Long-Term Debt & Loans', 'liability', 42000.0);
    insAcct.run('3000', 'Retained Earnings & Capital', 'equity', 330000.0);
    insAcct.run('4000', 'Hardware & Product Sales', 'revenue', 18024.0);
    insAcct.run('4100', 'SaaS & Commissioning Services', 'revenue', 8260.0);
    insAcct.run('4500', 'Foundation Donations & Grants', 'revenue', 3500.0);
    insAcct.run('5000', 'Cost of Goods Sold', 'expense', 7040.0);
    insAcct.run('6100', 'Facilities & Warehouse Lease', 'expense', 6800.0);
    insAcct.run('6200', 'Payroll & Benefits', 'expense', 14500.0);
  }

  const defaultIntegrations: Record<string, Record<string, unknown>> = {
    ldap: {
      enabled: false,
      host: 'ldaps://directory.corp.internal',
      port: 636,
      baseDn: 'dc=kscat,dc=corp',
      bindDn: 'cn=erp-sync,ou=services,dc=kscat,dc=corp',
      hasBindSecret: false,
      userFilter: '(uid={{username}})',
    },
    click_to_dial: {
      enabled: true,
      scheme: 'tel:',
      providerName: 'System Softphone / SIP',
      prefix: '',
    },
    payment_gateways: {
      stripe: { enabled: true, mode: 'live_env', webhookPath: '/api/webhooks/stripe', envVarHint: 'STRIPE_SECRET_KEY' },
      paypal: { enabled: true, mode: 'rest_v2', clientId: 'sandbox-kscat-merchant', envVarHint: 'PAYPAL_CLIENT_SECRET' },
      paybox: { enabled: false, siteId: '1999888', rank: '32', hmacConfigured: false },
    },
    social: {
      linkedin: 'https://www.linkedin.com',
      x: 'https://x.com',
      github: 'https://github.com/Dolibarr/dolibarr',
    },
    rss: {
      feeds: [
        { id: 'dolibarr-releases', label: 'Dolibarr ERP GitHub Releases', url: 'https://github.com/Dolibarr/dolibarr/releases.atom' },
      ],
    },
    email_collector: {
      enabled: true,
      imapHost: 'imap.kscat-erp.example',
      imapPort: 993,
      mailbox: 'INBOX/Support',
      autoCreateTicket: true,
    },
  };

  const insInt = db.prepare(`INSERT OR IGNORE INTO integrations_config (config_key, config_json) VALUES (?, ?)`);
  for (const [k, v] of Object.entries(defaultIntegrations)) {
    insInt.run(k, JSON.stringify(v));
  }
}

export function getEnabledModulesMap(): Record<string, boolean> {
  const rows = db.prepare('SELECT module_key, enabled FROM modules_config').all() as Array<{
    module_key: string;
    enabled: number;
  }>;
  const map: Record<string, boolean> = {};
  for (const r of rows) {
    map[r.module_key] = r.enabled === 1;
  }
  return map;
}

export function seedExtendedBusinessData(actorEmail: string): void {
  const oppCount = db.prepare('SELECT COUNT(*) as cnt FROM opportunities').get() as { cnt: number };
  if (oppCount.cnt > 0) return;

  const parties = db.prepare('SELECT id, name, party_type FROM third_parties ORDER BY id ASC').all() as Array<{
    id: number;
    name: string;
    party_type: string;
  }>;
  const products = db.prepare('SELECT id, ref, name, sell_price FROM products ORDER BY id ASC').all() as Array<{
    id: number;
    ref: string;
    name: string;
    sell_price: number;
  }>;
  const warehouses = db.prepare('SELECT id, name FROM warehouses ORDER BY id ASC').all() as Array<{
    id: number;
    name: string;
  }>;
  const salesOrders = db.prepare('SELECT id, ref, warehouse_id FROM sales_orders ORDER BY id ASC').all() as Array<{
    id: number;
    ref: string;
    warehouse_id: number;
  }>;
  const banks = db.prepare('SELECT id FROM bank_accounts ORDER BY id ASC').all() as Array<{ id: number }>;
  const projects = db.prepare('SELECT id FROM projects ORDER BY id ASC').all() as Array<{ id: number }>;

  if (parties.length === 0 || products.length === 0 || warehouses.length === 0) return;

  const p1 = parties[0].id;
  const p2 = (parties[1] ?? parties[0]).id;
  const p3 = (parties[2] ?? parties[0]).id;
  const sup = (parties.find((p) => p.party_type === 'supplier') ?? parties[0]).id;
  const w1 = warehouses[0].id;
  const w2 = (warehouses[1] ?? warehouses[0]).id;
  const pr1 = products[0].id;
  const pr2 = (products[1] ?? products[0]).id;
  const pr3 = (products[2] ?? products[0]).id;
  const pr4 = (products[3] ?? products[0]).id;
  const b1 = banks[0]?.id ?? 1;
  const pj1 = projects[0]?.id ?? null;

  db.exec('BEGIN');
  try {
    // Barcodes on existing products
    db.prepare(`UPDATE products SET barcode = '3760024810014' WHERE id = ? AND barcode = ''`).run(pr1);
    db.prepare(`UPDATE products SET barcode = '3760024810021' WHERE id = ? AND barcode = ''`).run(pr2);
    db.prepare(`UPDATE products SET barcode = '3760024810038' WHERE id = ? AND barcode = ''`).run(pr3);
    db.prepare(`UPDATE products SET barcode = '3760024810045' WHERE id = ? AND barcode = ''`).run(pr4);

    // Members & Partnerships
    db.prepare(
      `INSERT INTO members (ref, full_name, organization, member_type, email, phone, subscription_fee, start_date, expiry_date, status, notes)
       VALUES
       ('MEM2611-0001', 'Elena Vance', 'Open Industrial Alliance', 'Foundation Patron', 'e.vance@oia-foundation.example', '+1 (312) 555-0181', 450, '2026-01-15', '2027-01-15', 'active', 'Annual sustaining patron member.'),
       ('MEM2611-0002', 'Tomasz Kowalczyk', 'Northwind Manufacturing Co.', 'Corporate', 't.kowalczyk@northwind-mfg.example', '+1 (312) 555-0192', 250, '2026-03-01', '2027-03-01', 'active', 'Corporate technical council delegate.')`
    ).run();

    db.prepare(
      `INSERT INTO partnerships (ref, third_party_id, partner_tier, commission_pct, start_date, end_date, status, notes)
       VALUES
       ('PTN2611-0001', ?, 'Gold', 12.5, '2026-01-01', '2027-12-31', 'active', 'DACH regional value-added reseller agreement.'),
       ('PTN2611-0002', ?, 'Silver', 8.0, '2026-06-01', '2027-06-01', 'active', 'Cold-chain telemetry referral partnership.')`
    ).run(p2, p3);

    // Lots & Variants
    db.prepare(
      `INSERT INTO product_lots (product_id, warehouse_id, lot_number, serial_number, quantity, manufacture_date, expiry_date, status)
       VALUES
       (?, ?, 'LOT-GW26-A1', 'SN-X4-88201..88242', 42, '2026-09-10', '', 'available'),
       (?, ?, 'LOT-TP26-C9', 'SN-PT-4410..4432', 22, '2026-10-05', '2028-10-05', 'available')`
    ).run(pr1, w1, pr4, w1);

    db.prepare(
      `INSERT INTO product_variants (product_id, sku_suffix, attribute_name, attribute_value, price_delta, stock_qty, barcode)
       VALUES
       (?, 'LTE-EU', 'Modem Region', 'EU Multi-Band LTE', 35, 12, '3760024810019'),
       (?, 'POE-24V', 'Power Input', '24V PoE+ Industrial', 20, 18, '3760024810028')`
    ).run(pr1, pr2);

    // Workstations, BOMs & Manufacturing Orders
    const ws1 = Number(
      db.prepare(
        `INSERT INTO workstations (ref, name, location, hourly_cost, capacity_per_day, status)
         VALUES ('WS-ASM-01', 'Electronics Final Assembly Bay A', 'Chicago Plant Floor 2', 85, 8, 'operational')`
      ).run().lastInsertRowid
    );
    const ws2 = Number(
      db.prepare(
        `INSERT INTO workstations (ref, name, location, hourly_cost, capacity_per_day, status)
         VALUES ('WS-CAL-02', 'Sensor Calibration & Burn-In Rig', 'Chicago QA Lab', 72, 10, 'operational')`
      ).run().lastInsertRowid
    );

    const bom1 = Number(
      db.prepare(
        `INSERT INTO boms (ref, product_id, workstation_id, label, output_qty, components_json, estimated_minutes, status)
         VALUES ('BOM-X4-STD', ?, ?, 'Standard Edge Gateway X4 Assembly', 1, ?, 45, 'active')`
      ).run(
        pr1,
        ws1,
        JSON.stringify([
          { productId: pr2, ref: 'PRD-1002', name: 'Optical Flow Conveyor Sensor', qty: 1 },
          { productId: pr3, ref: 'PRD-1003', name: '48V Redundant Power Module', qty: 1 },
        ])
      ).lastInsertRowid
    );

    db.prepare(
      `INSERT INTO manufacturing_orders (ref, bom_id, product_id, warehouse_id, workstation_id, qty_planned, qty_produced, scheduled_date, status, notes, created_by)
       VALUES ('MO2611-0001', ?, ?, ?, ?, 4, 0, '2026-11-28', 'validated', 'Q4 fulfillment batch for Northwind expansion.', ?)`
    ).run(bom1, pr1, w1, ws1, actorEmail);

    // Opportunities, Shipments, Contracts, Interventions, Supplier RFQs
    db.prepare(
      `INSERT INTO opportunities (ref, third_party_id, title, stage, probability, amount, close_date, owner_name, notes)
       VALUES
       ('OPP2611-0001', ?, 'Cold-Chain Fleet Telemetry Phase 2', 'negotiation', 75, 28400, '2026-12-15', 'Sales Desk', 'Final technical review scheduled.'),
       ('OPP2611-0002', ?, 'Automated Pallet Line Sensors (6x Warehouses)', 'proposition', 55, 42000, '2027-01-10', 'Sales Desk', 'Proposal PR2611-0003 submitted.')`
    ).run(p3, p2);

    if (salesOrders[0]) {
      db.prepare(
        `INSERT INTO shipments (ref, sales_order_id, warehouse_id, carrier, tracking_number, ship_date, weight_kg, status, notes)
         VALUES ('SH2611-0001', ?, ?, 'DHL Freight', 'DHL-8841209341', '2026-11-08', 18.4, 'delivered', 'Signed at Chicago receiving dock.')`
      ).run(salesOrders[0].id, salesOrders[0].warehouse_id);
    }

    db.prepare(
      `INSERT INTO contracts (ref, third_party_id, title, billing_cycle, recurring_amount, start_date, next_billing_date, status, notes)
       VALUES
       ('CTR2611-0001', ?, '24/7 Industrial Telemetry SLA & Cloud Retention', 'monthly', 960, '2026-06-01', '2026-12-01', 'active', 'Auto-renews annually with 30-day notice.'),
       ('CTR2611-0002', ?, 'Munich Depot Priority Hardware Replacement', 'quarterly', 2400, '2026-10-01', '2027-01-01', 'active', 'Covers 4-hour European courier dispatch.')`
    ).run(p1, p2);

    db.prepare(
      `INSERT INTO interventions (ref, third_party_id, title, technician_name, scheduled_date, duration_hours, status, notes)
       VALUES ('INT2611-0001', ?, 'Line-4 Optical Calibration & Firmware Patch', 'Marcus Chen', '2026-11-29', 4.5, 'planned', 'Bring spare PT1000 calibration harness.')`
    ).run(p1);

    db.prepare(
      `INSERT INTO supplier_rfqs (ref, third_party_id, title, request_date, deadline_date, incoterm, lines_json, estimated_total, status, notes)
       VALUES ('RFQ2611-0001', ?, 'Q1 Enclosure & 48V PSU Volume Quote', '2026-11-18', '2026-12-02', 'DDP', ?, 9200, 'open', 'Requesting tiered pricing for 100+ units.')`
    ).run(
      sup,
      JSON.stringify([{ productId: pr3, ref: 'PRD-1003', label: '48V Redundant Power Module', qty: 100, unitPrice: 72, discountPct: 0, taxRate: 20 }])
    );

    // SEPA, Journal Entries, Donations, Loans
    db.prepare(
      `INSERT INTO sepa_batches (ref, batch_type, bank_account_id, execution_date, total_amount, items_json, status, created_by)
       VALUES ('SEPA2611-0001', 'credit_transfer', ?, '2026-11-30', 8448.0, ?, 'prepared', ?)`
    ).run(
      b1,
      JSON.stringify([{ partyName: 'Kestrel Precision Components', iban: 'DE89370400440532013000', invoiceRef: 'SI2611-0001', amount: 8448.0 }]),
      actorEmail
    );

    db.prepare(
      `INSERT INTO journal_entries (ref, entry_date, journal_code, description, debit_account_code, credit_account_code, amount, source_ref, created_by)
       VALUES
       ('JRN2611-0001', '2026-11-12', 'SAL', 'Customer Invoice IN2611-0001 Revenue Recognition', '1200', '4000', 7364.0, 'IN2611-0001', ?),
       ('JRN2611-0002', '2026-11-14', 'BNK', 'Customer Settlement IN2611-0001', '1010', '1200', 8836.8, 'IN2611-0001', ?),
       ('JRN2611-0003', '2026-11-14', 'PUR', 'Supplier Bill SI2611-0001 Inventory Intake', '1400', '2000', 7040.0, 'SI2611-0001', ?)`
    ).run(actorEmail, actorEmail, actorEmail);

    db.prepare(
      `INSERT INTO donations (ref, donor_name, donor_email, amount, donation_date, payment_mode, status, notes)
       VALUES ('DON2611-0001', 'Open Industrial Alliance', 'grants@oia-foundation.example', 3500, '2026-11-04', 'SEPA Transfer', 'received', 'Annual open-hardware calibration grant.')`
    ).run();

    db.prepare(
      `INSERT INTO loans (ref, label, lender_name, principal_amount, remaining_principal, interest_rate, term_months, start_date, status)
       VALUES ('LN2611-0001', 'CNC & Calibration Lab Equipment Facility', 'Silicon Valley Commercial Bank', 60000, 42000, 4.25, 48, '2025-07-01', 'active')`
    ).run();

    // Tickets & KB
    db.prepare(
      `INSERT INTO tickets (ref, third_party_id, subject, category, severity, status, assignee_name, message, replies_json, created_by)
       VALUES
       ('TCK2611-0001', ?, 'LTE failover delay on Edge Gateway #4', 'Hardware', 'high', 'in_progress', 'Field Engineering', 'Unit took 45 seconds to switch from Ethernet to secondary LTE SIM during maintenance window.', ?, ?),
       ('TCK2611-0002', ?, 'Request additional API webhook token for Munich depot', 'Cloud Telemetry', 'normal', 'open', 'Platform Ops', 'Please issue read-only webhook credentials for Bavarian warehouse WMS integration.', '[]', ?)`
    ).run(
      p1,
      JSON.stringify([{ author: 'Field Engineering', date: '2026-11-22', text: 'Recommended updating cellular keepalive interval to 10s in Gateway firmware v4.2.' }]),
      actorEmail,
      p2,
      actorEmail
    );

    db.prepare(
      `INSERT INTO kb_articles (ref, title, category, content, is_public, views)
       VALUES
       ('KB-101', 'Configuring Fast LTE Failover on Edge Gateway X4', 'Hardware', 'Set WAN Health Probe Interval to 5s and Failure Threshold to 2 packets in the Gateway Console under Network > Failover.', 1, 148),
       ('KB-102', 'SEPA ISO 20022 Export & Bank Reconciliation Checklist', 'Finance', 'Validate supplier IBANs under Third Parties, batch open bills under Billing > SEPA, and export the pain.001 XML package for treasury upload.', 1, 92)`
    ).run();

    // Collaboration: Agenda Events, Org Events, Surveys
    db.prepare(
      `INSERT INTO agenda_events (uid, title, event_type, start_at, end_at, location, organizer, description)
       VALUES
       ('meridian-evt-101@erp', 'Q4 Supply Chain & Inventory Review', 'meeting', '2026-11-27T10:00:00', '2026-11-27T11:30:00', 'HQ Boardroom / Meet', 'Operations Lead', 'Review low-stock triggers for PSU-48V and Cold-Chain Probes.'),
       ('meridian-evt-102@erp', 'Line-4 Field Calibration Window', 'intervention', '2026-11-29T09:00:00', '2026-11-29T13:30:00', 'Chicago Plant', 'Marcus Chen', 'On-site optical calibration.')`
    ).run();

    db.prepare(
      `INSERT INTO org_events (ref, title, event_date, venue, capacity, registered_count, status, description)
       VALUES ('EVT2611-0001', 'Industrial Telemetry & Dolibarr Automation Summit', '2026-12-12', 'Chicago Merchandise Mart', 120, 64, 'open', 'Customer showcase and live hardware workshop.')`
    ).run();

    db.prepare(
      `INSERT INTO surveys (ref, title, question, options_json, votes_json, status)
       VALUES ('SRV2611-0001', 'Q1 Customer Portal Priorities', 'Which self-service portal capability should ship first in Q1?', ?, ?, 'open')`
    ).run(
      JSON.stringify(['Online Invoice PDF + Stripe Pay', 'Live Shipment Tracking Map', 'RMA & Warranty Claim Form']),
      JSON.stringify({ 'Online Invoice PDF + Stripe Pay': 14, 'Live Shipment Tracking Map': 9, 'RMA & Warranty Claim Form': 6 })
    );

    // HR: Employees, Leave, Expenses, Recruitment, Timesheets
    const emp1 = Number(
      db.prepare(
        `INSERT INTO employees (ref, full_name, email, phone, department, job_title, hire_date, annual_salary, leave_balance_days, status)
         VALUES ('EMP-001', 'Marcus Chen', 'm.chen@meridian-erp.example', '+1 (312) 555-0133', 'Field Engineering', 'Lead Commissioning Engineer', '2024-03-15', 108000, 18.5, 'active')`
      ).run().lastInsertRowid
    );
    const emp2 = Number(
      db.prepare(
        `INSERT INTO employees (ref, full_name, email, phone, department, job_title, hire_date, annual_salary, leave_balance_days, status)
         VALUES ('EMP-002', 'Sofia Alvarez', 's.alvarez@meridian-erp.example', '+1 (312) 555-0155', 'Finance & Accounting', 'Senior Controller', '2023-09-01', 118000, 21, 'active')`
      ).run().lastInsertRowid
    );

    db.prepare(
      `INSERT INTO leave_requests (ref, employee_id, leave_type, start_date, end_date, days, reason, status, reviewed_by)
       VALUES ('LVR2611-0001', ?, 'Paid Time Off', '2026-12-22', '2026-12-24', 3, 'Holiday travel', 'pending', '')`
    ).run(emp1);

    db.prepare(
      `INSERT INTO expense_reports (ref, employee_id, category, expense_date, amount, tax_amount, description, status, approved_by)
       VALUES ('EXP2611-0001', ?, 'Travel & Lodging', '2026-11-16', 482.5, 48.25, 'Customer commissioning visit — Northwind Line-4', 'submitted', '')`
    ).run(emp1);

    const job1 = Number(
      db.prepare(
        `INSERT INTO job_postings (ref, title, department, location, contract_type, status, description)
         VALUES ('JOB2611-0001', 'Embedded Firmware & IIoT Engineer', 'Engineering', 'Chicago / Hybrid', 'Full-Time', 'open', 'Maintain Edge Gateway X4 RTOS drivers and MQTT telemetry pipelines.')`
      ).run().lastInsertRowid
    );

    db.prepare(
      `INSERT INTO candidates (job_id, full_name, email, phone, stage, notes)
       VALUES
       (?, 'Priya Nair', 'priya.nair@example.com', '+1 (312) 555-0177', 'interview', 'Strong STM32 and industrial Modbus experience.'),
       (?, 'Daniel Brooks', 'd.brooks@example.com', '+1 (415) 555-0112', 'screening', 'Background in embedded Linux telemetry.')`
    ).run(job1, job1);

    db.prepare(
      `INSERT INTO timesheets (employee_id, project_id, work_date, hours, task_label, billable)
       VALUES
       (?, ?, '2026-11-21', 7.5, 'Conveyor B optical sensor calibration', 1),
       (?, NULL, '2026-11-21', 8.0, 'November SEPA batch & VAT reconciliation', 0)`
    ).run(emp1, pj1, emp2);

    // EDM, Bookmarks, Mass Email, Collected Emails
    db.prepare(
      `INSERT INTO edm_documents (ref, title, folder, mime_type, size_bytes, tags, content_text, uploaded_by)
       VALUES
       ('DOC2611-0001', 'ISO-9001 Warehouse Receiving SOP v3.2', 'Operations/SOP', 'text/markdown', 2480, 'sop,warehouse,iso9001', 'Verify lot serial range against PO before booking inbound stock movement.', ?),
       ('DOC2611-0002', 'SEPA Creditor Identifier Mandate Template', 'Finance/Compliance', 'text/plain', 1640, 'sepa,banking,compliance', 'Standard Core Direct Debit mandate notice for European B2B accounts.', ?)`
    ).run(actorEmail, actorEmail);

    db.prepare(
      `INSERT INTO bookmarks (title, url, category, created_by)
       VALUES
       ('Dolibarr ERP Official Repository', 'https://github.com/Dolibarr/dolibarr', 'Reference', ?),
       ('European Payments Council SEPA Guidelines', 'https://www.europeanpaymentscouncil.eu', 'Finance', ?)`
    ).run(actorEmail, actorEmail);

    db.prepare(
      `INSERT INTO email_campaigns (ref, subject, target_segment, body_text, recipient_count, status, sent_at, created_by)
       VALUES ('CMP2611-0001', 'Q4 Cold-Chain Calibration Window & Firmware v4.2', 'all_customers', 'Dear partner, schedule your annual PT1000 calibration slot and Edge Gateway firmware upgrade before December 15.', 3, 'sent', '2026-11-15T14:20:00Z', ?)`
    ).run(actorEmail);

    db.prepare(
      `INSERT INTO collected_emails (sender_email, subject, snippet, matched_party, status)
       VALUES
       ('n.okafor@helios-coldchain.example', 'Re: Oakland Pilot Proposal PR2611-0002', 'We reviewed the probe lead times and would like to confirm online signing next Tuesday.', 'Helios Cold-Chain Systems', 'unprocessed'),
       ('l.weber@vespera-logistics.example', 'Munich WMS Webhook IP Whitelist Request', 'Can your platform team share the outbound IP CIDR for Bavarian fulfillment notifications?', 'Vespera Logistics GmbH', 'unprocessed')`
    ).run();

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function seedSampleBusinessData(actorEmail: string): void {
  const existingParties = db.prepare('SELECT COUNT(*) as cnt FROM third_parties').get() as { cnt: number };
  if (existingParties.cnt > 0) {
    seedExtendedBusinessData(actorEmail);
    return;
  }

  db.exec('BEGIN');
  try {
    const insertParty = db.prepare(
      `INSERT INTO third_parties (ref, name, party_type, email, phone, website, address, city, country, tax_id, payment_terms, credit_limit, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const p1 = Number(
      insertParty.run(
        'CU2611-0001',
        'Northwind Manufacturing Co.',
        'customer',
        'ap@northwind-mfg.example',
        '+1 (312) 555-0142',
        'https://northwind-mfg.example',
        '440 Industrial Parkway',
        'Chicago',
        'United States',
        'US-EIN-84-21904',
        'Net 30',
        120000,
        'active',
        'Key enterprise manufacturing partner for automated assembly sensors.'
      ).lastInsertRowid
    );
    const p2 = Number(
      insertParty.run(
        'CU2611-0002',
        'Vespera Logistics GmbH',
        'customer',
        'finance@vespera-logistics.example',
        '+49 89 555 8120',
        'https://vespera-logistics.example',
        'Landsberger Strasse 110',
        'Munich',
        'Germany',
        'DE-298441029',
        'Net 45',
        95000,
        'active',
        'European warehouse distribution rollout across Bavaria.'
      ).lastInsertRowid
    );
    const p3 = Number(
      insertParty.run(
        'PR2611-0003',
        'Helios Cold-Chain Systems',
        'prospect',
        'procurement@helios-coldchain.example',
        '+1 (415) 555-0199',
        'https://helios-coldchain.example',
        '820 Harbor Blvd',
        'Oakland',
        'United States',
        'US-EIN-92-44012',
        'Net 30',
        50000,
        'active',
        'Evaluating Q1 telemetry controller package.'
      ).lastInsertRowid
    );
    const p4 = Number(
      insertParty.run(
        'SU2611-0004',
        'Kestrel Precision Components',
        'supplier',
        'orders@kestrel-components.example',
        '+1 (512) 555-0168',
        'https://kestrel-components.example',
        '2100 Silicon Ridge',
        'Austin',
        'United States',
        'US-EIN-75-30918',
        'Net 30',
        80000,
        'active',
        'Primary supplier for CNC enclosures and industrial power supplies.'
      ).lastInsertRowid
    );
    const p5 = Number(
      insertParty.run(
        'CS2611-0005',
        'Boreal Maritime Freight',
        'customer_supplier',
        'billing@boreal-freight.example',
        '+1 (206) 555-0115',
        'https://boreal-freight.example',
        '95 Pier Ave',
        'Seattle',
        'United States',
        'US-EIN-61-88320',
        'Net 15',
        75000,
        'active',
        'Both freight vendor and SaaS fleet monitoring customer.'
      ).lastInsertRowid
    );

    const insertContact = db.prepare(
      `INSERT INTO contacts (third_party_id, first_name, last_name, job_title, email, phone, is_primary)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    insertContact.run(p1, 'Claire', 'Hendricks', 'VP of Operations', 'c.hendricks@northwind-mfg.example', '+1 (312) 555-0144', 1);
    insertContact.run(p1, 'Marcus', 'Vogel', 'Accounts Payable Lead', 'm.vogel@northwind-mfg.example', '+1 (312) 555-0149', 0);
    insertContact.run(p2, 'Lukas', 'Weber', 'Head of Procurement', 'l.weber@vespera-logistics.example', '+49 89 555 8122', 1);
    insertContact.run(p3, 'Nadia', 'Okafor', 'Systems Architect', 'n.okafor@helios-coldchain.example', '+1 (415) 555-0190', 1);
    insertContact.run(p4, 'David', 'Kowalski', 'Wholesale Desk', 'd.kowalski@kestrel-components.example', '+1 (512) 555-0170', 1);
    insertContact.run(p5, 'Hannah', 'Lindqvist', 'Logistics Director', 'h.lindqvist@boreal-freight.example', '+1 (206) 555-0118', 1);

    const insertWh = db.prepare(`INSERT INTO warehouses (ref, name, location, status) VALUES (?, ?, ?, 'active')`);
    const w1 = Number(insertWh.run('WH-MAIN', 'Main Distribution Center', 'Chicago, IL').lastInsertRowid);
    const w2 = Number(insertWh.run('WH-WEST', 'West Coast Hub', 'Oakland, CA').lastInsertRowid);
    const w3 = Number(insertWh.run('WH-EU', 'Munich Fulfillment Depot', 'Munich, DE').lastInsertRowid);

    const insertProd = db.prepare(
      `INSERT INTO products (ref, name, product_type, category, description, cost_price, sell_price, tax_rate, min_stock, barcode, on_sale, on_purchase)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    );
    const pr1 = Number(insertProd.run('PRD-1001', 'Industrial IoT Edge Gateway X4', 'product', 'Hardware', 'DIN-rail ruggedized telemetry gateway with dual Ethernet & LTE.', 320, 640, 20, 15, '3760024810014', 1).lastInsertRowid);
    const pr2 = Number(insertProd.run('PRD-1002', 'Optical Flow Conveyor Sensor', 'product', 'Sensors', 'High-speed IP67 optical sensor unit for automated lines.', 110, 245, 20, 25, '3760024810021', 1).lastInsertRowid);
    const pr3 = Number(insertProd.run('PRD-1003', '48V Redundant Power Module', 'product', 'Power', '240W industrial PSU with hot-swap failover relay.', 75, 165, 20, 20, '3760024810038', 1).lastInsertRowid);
    const pr4 = Number(insertProd.run('PRD-1004', 'Thermal Probe Kit (3-Pack)', 'product', 'Sensors', 'Calibrated PT1000 stainless cold-chain temperature probes.', 48, 120, 20, 30, '3760024810045', 1).lastInsertRowid);
    const pr5 = Number(insertProd.run('SRV-2001', 'On-Site Commissioning & Calibration', 'service', 'Professional Services', 'Full-day field engineering deployment and sensor calibration.', 450, 1250, 20, 0, '', 0).lastInsertRowid);
    const pr6 = Number(insertProd.run('SRV-2002', 'Annual Telemetry Cloud License', 'service', 'Subscriptions', '12-month fleet monitoring, alerting, and API retention.', 180, 960, 20, 0, '', 0).lastInsertRowid);

    const insertStock = db.prepare(`INSERT INTO stock_levels (product_id, warehouse_id, quantity) VALUES (?, ?, ?)`);
    insertStock.run(pr1, w1, 42);
    insertStock.run(pr1, w2, 18);
    insertStock.run(pr1, w3, 12);
    insertStock.run(pr2, w1, 64);
    insertStock.run(pr2, w2, 11);
    insertStock.run(pr3, w1, 14);
    insertStock.run(pr3, w2, 4);
    insertStock.run(pr4, w1, 22);
    insertStock.run(pr4, w3, 6);

    const insertMove = db.prepare(
      `INSERT INTO stock_movements (product_id, warehouse_id, movement_type, quantity_delta, reason, doc_ref, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    insertMove.run(pr1, w1, 'in', 50, 'Initial opening stock balance', 'OPEN-2026', actorEmail);
    insertMove.run(pr1, w1, 'out', -8, 'Fulfilled sales shipment SO2611-0001', 'SO2611-0001', actorEmail);
    insertMove.run(pr2, w1, 'in', 64, 'Supplier receipt from Kestrel Precision', 'PO2611-0001', actorEmail);
    insertMove.run(pr3, w1, 'out', -12, 'Field replacement batch', 'SO2611-0001', actorEmail);

    const insertProposal = db.prepare(
      `INSERT INTO proposals (ref, third_party_id, title, issue_date, valid_until, status, lines_json, subtotal_ht, tax_total, total_ttc, notes, signed_by, signed_at, signature_name, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertProposal.run(
      'PR2611-0001',
      p1,
      'Chicago Plant Line-4 Telemetry Upgrade',
      '2026-11-02',
      '2026-12-02',
      'signed',
      JSON.stringify([
        { productId: pr1, ref: 'PRD-1001', label: 'Industrial IoT Edge Gateway X4', qty: 8, unitPrice: 640, discountPct: 5, taxRate: 20 },
        { productId: pr5, ref: 'SRV-2001', label: 'On-Site Commissioning & Calibration', qty: 2, unitPrice: 1250, discountPct: 0, taxRate: 20 },
      ]),
      7364,
      1472.8,
      8836.8,
      'Includes 5% volume discount on Edge Gateways.',
      'c.hendricks@northwind-mfg.example',
      '2026-11-04T16:30:00Z',
      'Claire Hendricks',
      actorEmail
    );
    insertProposal.run(
      'PR2611-0002',
      p3,
      'Oakland Cold-Chain Pilot Rollout',
      '2026-11-18',
      '2026-12-18',
      'validated',
      JSON.stringify([
        { productId: pr4, ref: 'PRD-1004', label: 'Thermal Probe Kit (3-Pack)', qty: 20, unitPrice: 120, discountPct: 0, taxRate: 20 },
        { productId: pr6, ref: 'SRV-2002', label: 'Annual Telemetry Cloud License', qty: 3, unitPrice: 960, discountPct: 0, taxRate: 20 },
      ]),
      5280,
      1056,
      6336,
      'Awaiting customer signature on SLA addendum.',
      '',
      '',
      '',
      actorEmail
    );
    insertProposal.run(
      'PR2611-0003',
      p2,
      'Munich Hub Conveyor Sensor Expansion',
      '2026-11-21',
      '2026-12-21',
      'draft',
      JSON.stringify([
        { productId: pr2, ref: 'PRD-1002', label: 'Optical Flow Conveyor Sensor', qty: 30, unitPrice: 245, discountPct: 10, taxRate: 20 },
      ]),
      6615,
      1323,
      7938,
      'Draft quote pending logistics confirmation.',
      '',
      '',
      '',
      actorEmail
    );

    const insertSO = db.prepare(
      `INSERT INTO sales_orders (ref, third_party_id, proposal_ref, order_date, delivery_date, warehouse_id, incoterm, status, lines_json, subtotal_ht, tax_total, total_ttc, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertSO.run(
      'SO2611-0001',
      p1,
      'PR2611-0001',
      '2026-11-05',
      '2026-11-12',
      w1,
      'DDP',
      'billed',
      JSON.stringify([
        { productId: pr1, ref: 'PRD-1001', label: 'Industrial IoT Edge Gateway X4', qty: 8, unitPrice: 640, discountPct: 5, taxRate: 20 },
        { productId: pr5, ref: 'SRV-2001', label: 'On-Site Commissioning & Calibration', qty: 2, unitPrice: 1250, discountPct: 0, taxRate: 20 },
      ]),
      7364,
      1472.8,
      8836.8,
      'Shipped and invoiced.',
      actorEmail
    );
    insertSO.run(
      'SO2611-0002',
      p2,
      '',
      '2026-11-19',
      '2026-11-29',
      w3,
      'DAP',
      'validated',
      JSON.stringify([
        { productId: pr1, ref: 'PRD-1001', label: 'Industrial IoT Edge Gateway X4', qty: 5, unitPrice: 640, discountPct: 0, taxRate: 20 },
        { productId: pr6, ref: 'SRV-2002', label: 'Annual Telemetry Cloud License', qty: 5, unitPrice: 960, discountPct: 0, taxRate: 20 },
      ]),
      8000,
      1600,
      9600,
      'Ready for dispatch from Munich depot.',
      actorEmail
    );

    const insertPO = db.prepare(
      `INSERT INTO purchase_orders (ref, third_party_id, order_date, expected_date, warehouse_id, incoterm, status, lines_json, subtotal_ht, tax_total, total_ttc, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertPO.run(
      'PO2611-0001',
      p4,
      '2026-11-04',
      '2026-11-14',
      w1,
      'FOB',
      'received',
      JSON.stringify([
        { productId: pr2, ref: 'PRD-1002', label: 'Optical Flow Conveyor Sensor', qty: 64, unitPrice: 110, discountPct: 0, taxRate: 20 },
      ]),
      7040,
      1408,
      8448,
      'Received in full at Main Distribution Center.',
      actorEmail
    );
    insertPO.run(
      'PO2611-0002',
      p4,
      '2026-11-20',
      '2026-11-30',
      w1,
      'CIF',
      'ordered',
      JSON.stringify([
        { productId: pr3, ref: 'PRD-1003', label: '48V Redundant Power Module', qty: 40, unitPrice: 75, discountPct: 0, taxRate: 20 },
        { productId: pr4, ref: 'PRD-1004', label: 'Thermal Probe Kit (3-Pack)', qty: 35, unitPrice: 48, discountPct: 0, taxRate: 20 },
      ]),
      4680,
      936,
      5616,
      'Replenishment order for low-stock SKUs.',
      actorEmail
    );

    const insertInv = db.prepare(
      `INSERT INTO invoices (ref, invoice_type, invoice_kind, third_party_id, source_ref, issue_date, due_date, status, lines_json, subtotal_ht, tax_total, total_ttc, amount_paid, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertInv.run(
      'IN2611-0001',
      'customer',
      'standard',
      p1,
      'SO2611-0001',
      '2026-11-12',
      '2026-12-12',
      'paid',
      JSON.stringify([
        { productId: pr1, ref: 'PRD-1001', label: 'Industrial IoT Edge Gateway X4', qty: 8, unitPrice: 640, discountPct: 5, taxRate: 20 },
        { productId: pr5, ref: 'SRV-2001', label: 'On-Site Commissioning & Calibration', qty: 2, unitPrice: 1250, discountPct: 0, taxRate: 20 },
      ]),
      7364,
      1472.8,
      8836.8,
      8836.8,
      'Paid via ACH wire.',
      actorEmail
    );
    insertInv.run(
      'IN2611-0002',
      'customer',
      'standard',
      p5,
      '',
      '2026-10-15',
      '2026-10-30',
      'partial',
      JSON.stringify([
        { productId: pr6, ref: 'SRV-2002', label: 'Annual Telemetry Cloud License', qty: 6, unitPrice: 960, discountPct: 0, taxRate: 20 },
      ]),
      5760,
      1152,
      6912,
      3500,
      '50% deposit received; remaining balance overdue.',
      actorEmail
    );
    insertInv.run(
      'IN2611-0003',
      'customer',
      'standard',
      p2,
      '',
      '2026-11-16',
      '2026-12-31',
      'validated',
      JSON.stringify([
        { productId: pr2, ref: 'PRD-1002', label: 'Optical Flow Conveyor Sensor', qty: 20, unitPrice: 245, discountPct: 0, taxRate: 20 },
      ]),
      4900,
      980,
      5880,
      0,
      'Awaiting Net 45 settlement.',
      actorEmail
    );
    insertInv.run(
      'SI2611-0001',
      'supplier',
      'standard',
      p4,
      'PO2611-0001',
      '2026-11-14',
      '2026-12-14',
      'validated',
      JSON.stringify([
        { productId: pr2, ref: 'PRD-1002', label: 'Optical Flow Conveyor Sensor', qty: 64, unitPrice: 110, discountPct: 0, taxRate: 20 },
      ]),
      7040,
      1408,
      8448,
      0,
      'Supplier invoice verified against warehouse receipt.',
      actorEmail
    );

    const insertBank = db.prepare(
      `INSERT INTO bank_accounts (ref, name, bank_name, account_number, currency, balance, account_type, status)
       VALUES (?, ?, ?, ?, 'USD', ?, ?, 'active')`
    );
    const b1 = Number(insertBank.run('BNK-OPS', 'Corporate Operating Checking', 'JPMorgan Chase', '•••• 4821', 148920.8, 'checking').lastInsertRowid);
    const b2 = Number(insertBank.run('BNK-RES', 'Treasury Reserve Savings', 'Silicon Valley Commercial', '•••• 9014', 215000.0, 'savings').lastInsertRowid);
    insertBank.run('CSH-HQ', 'Chicago HQ Petty Cash', 'Internal Cash Box', 'HQ-SAFE-01', 2450.0, 'cash');

    const insertTx = db.prepare(
      `INSERT INTO bank_transactions (bank_account_id, tx_date, label, category, amount, direction, invoice_ref, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertTx.run(b1, '2026-11-14', 'Payment IN2611-0001 — Northwind Manufacturing Co.', 'Customer Payment', 8836.8, 'credit', 'IN2611-0001', actorEmail);
    insertTx.run(b1, '2026-10-20', 'Deposit IN2611-0002 — Boreal Maritime Freight', 'Customer Payment', 3500.0, 'credit', 'IN2611-0002', actorEmail);
    insertTx.run(b1, '2026-11-01', 'Warehouse Lease — Chicago Distribution Center', 'Facilities', 6800.0, 'debit', '', actorEmail);
    insertTx.run(b2, '2026-11-05', 'Quarterly Capital Allocation Transfer', 'Treasury Transfer', 25000.0, 'credit', '', actorEmail);

    const insertProj = db.prepare(
      `INSERT INTO projects (ref, title, third_party_id, start_date, due_date, budget_amount, status, progress, description, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const pj1 = Number(
      insertProj.run(
        'PJ2611-0001',
        'Northwind Line-4 Automation Rollout',
        p1,
        '2026-11-01',
        '2026-12-15',
        18500,
        'active',
        65,
        'End-to-end deployment of Edge Gateways and conveyor sensor telemetry.',
        actorEmail
      ).lastInsertRowid
    );
    const pj2 = Number(
      insertProj.run(
        'PJ2611-0002',
        'Vespera Munich Depot Integration',
        p2,
        '2026-11-10',
        '2027-01-20',
        24000,
        'active',
        30,
        'ERP EDI sync and regional warehouse telemetry onboarding.',
        actorEmail
      ).lastInsertRowid
    );

    const insertTask = db.prepare(
      `INSERT INTO tasks (project_id, ref, title, assignee_name, priority, status, estimated_hours, logged_hours, progress, due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertTask.run(pj1, 'TSK-101', 'Rack-mount 8x Edge Gateways & VLAN config', 'Field Engineering Team', 'high', 'done', 16, 14.5, 100, '2026-11-14');
    insertTask.run(pj1, 'TSK-102', 'Calibrate optical sensors on Conveyor B', 'Field Engineering Team', 'high', 'in_progress', 12, 7.5, 60, '2026-11-28');
    insertTask.run(pj1, 'TSK-103', 'Client UAT sign-off & handover', 'Operations Lead', 'medium', 'todo', 8, 0, 0, '2026-12-10');
    insertTask.run(pj2, 'TSK-201', 'Provision Munich EU cloud tenant & RBAC', 'Platform Ops', 'high', 'done', 10, 9.0, 100, '2026-11-18');
    insertTask.run(pj2, 'TSK-202', 'Configure automated low-stock webhook alerts', 'Platform Ops', 'medium', 'in_progress', 14, 4.0, 30, '2026-12-08');

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  seedExtendedBusinessData(actorEmail);
}

export function writeAuditLog(params: {
  userId?: number | null;
  userEmail: string;
  action: string;
  module: string;
  entityRef?: string;
  details?: string;
  ipAddress?: string;
  severity?: 'info' | 'warning' | 'critical';
}): void {
  db.prepare(
    `INSERT INTO audit_logs (user_id, user_email, action, module, entity_ref, details, ip_address, severity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.userId ?? null,
    params.userEmail,
    params.action,
    params.module,
    params.entityRef ?? '',
    params.details ?? '',
    params.ipAddress ?? '',
    params.severity ?? 'info'
  );
}

ensureDefaults();
// Idempotently populate extended modules if workspace was already bootstrapped in a prior session
const preExistingParties = db.prepare('SELECT COUNT(*) as cnt FROM third_parties').get() as { cnt: number };
if (preExistingParties.cnt > 0) {
  seedExtendedBusinessData('system-upgrade');
}

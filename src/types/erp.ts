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

export type EnabledModulesMap = Record<string, boolean>;

export interface OptionalModuleConfig {
  module_key: string;
  name: string;
  category: string;
  description: string;
  enabled: number;
  locked: number;
}

export interface UserProfile {
  id: number;
  username: string;
  email: string;
  fullName: string;
  phone?: string;
  jobTitle?: string;
  department?: string;
  timezone?: string;
  roleId: number;
  roleSlug: string;
  roleName: string;
  roleRequireMfa: boolean;
  isActive: boolean;
  mfaEnabled: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface SystemSettings {
  id: number;
  app_name: string;
  company_name: string;
  company_email: string;
  company_phone: string;
  company_address: string;
  tax_id: string;
  default_currency: string;
  default_tax_rate: number;
  default_payment_terms: string;
  default_incoterm: string;
  fiscal_year_start: number;
  date_format: string;
  updated_at?: string;
}

export interface SecurityPolicy {
  max_failed_attempts: number;
  lockout_minutes: number;
  session_ttl_hours: number;
  enforce_mfa_global: number;
  min_password_length: number;
}

export interface UserSessionInfo {
  id: number;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

export interface RoleDefinition {
  id: number;
  slug: string;
  name: string;
  description: string;
  permissions: PermissionMap;
  requireMfa: boolean;
  isSystem: boolean;
  userCount: number;
  createdAt: string;
}

export interface PermissionCatalogItem {
  module: PermissionModule;
  label: string;
  description: string;
  actions: { key: PermissionAction; label: string }[];
}

export interface AuditLogEntry {
  id: number;
  user_id: number | null;
  user_email: string;
  action: string;
  module: string;
  entity_ref: string;
  details: string;
  ip_address: string;
  severity: 'info' | 'warning' | 'critical';
  created_at: string;
}

export interface ThirdParty {
  id: number;
  ref: string;
  name: string;
  party_type: 'customer' | 'prospect' | 'supplier' | 'customer_supplier';
  email: string;
  phone: string;
  website: string;
  address: string;
  city: string;
  country: string;
  tax_id: string;
  payment_terms: string;
  credit_limit: number;
  status: 'active' | 'inactive';
  notes: string;
  social_json?: string;
  created_at: string;
}

export interface ContactPerson {
  id: number;
  third_party_id: number;
  first_name: string;
  last_name: string;
  job_title: string;
  email: string;
  phone: string;
  is_primary: number;
  company_name?: string;
  company_ref?: string;
}

export interface MemberItem {
  id: number;
  ref: string;
  full_name: string;
  organization: string;
  member_type: 'Individual' | 'Corporate' | 'Foundation Patron' | 'Student';
  email: string;
  phone: string;
  subscription_fee: number;
  start_date: string;
  expiry_date: string;
  status: 'draft' | 'active' | 'expired' | 'resiliated';
  notes: string;
}

export interface PartnershipItem {
  id: number;
  ref: string;
  third_party_id: number;
  party_name: string;
  party_ref: string;
  partner_tier: 'Referral' | 'Silver' | 'Gold' | 'Strategic';
  commission_pct: number;
  start_date: string;
  end_date: string;
  status: 'pending' | 'active' | 'paused' | 'closed';
  notes: string;
}

export interface ProductItem {
  id: number;
  ref: string;
  name: string;
  product_type: 'product' | 'service';
  category: string;
  description: string;
  cost_price: number;
  sell_price: number;
  tax_rate: number;
  min_stock: number;
  barcode: string;
  total_stock: number;
}

export interface ProductLot {
  id: number;
  product_id: number;
  warehouse_id: number;
  lot_number: string;
  serial_number: string;
  quantity: number;
  manufacture_date: string;
  expiry_date: string;
  status: 'available' | 'quarantine' | 'consumed';
  product_ref: string;
  product_name: string;
  warehouse_name: string;
}

export interface ProductVariant {
  id: number;
  product_id: number;
  sku_suffix: string;
  attribute_name: string;
  attribute_value: string;
  price_delta: number;
  stock_qty: number;
  barcode: string;
  product_ref: string;
  product_name: string;
  base_sell_price: number;
}

export interface Warehouse {
  id: number;
  ref: string;
  name: string;
  location: string;
  status: 'active' | 'inactive';
}

export interface StockLevel {
  product_id: number;
  warehouse_id: number;
  quantity: number;
  warehouse_ref: string;
  warehouse_name: string;
}

export interface StockMovement {
  id: number;
  product_id: number;
  warehouse_id: number;
  movement_type: 'in' | 'out' | 'transfer' | 'adjustment';
  quantity_delta: number;
  reason: string;
  doc_ref: string;
  created_by: string;
  created_at: string;
  product_ref: string;
  product_name: string;
  warehouse_name: string;
}

export interface WorkstationItem {
  id: number;
  ref: string;
  name: string;
  location: string;
  hourly_cost: number;
  capacity_per_day: number;
  status: 'operational' | 'maintenance' | 'offline';
}

export interface BomItem {
  id: number;
  ref: string;
  product_id: number;
  product_ref: string;
  product_name: string;
  workstation_id: number | null;
  workstation_name: string | null;
  label: string;
  output_qty: number;
  components_json: string;
  estimated_minutes: number;
  status: 'draft' | 'active' | 'archived';
}

export interface ManufacturingOrder {
  id: number;
  ref: string;
  bom_id: number;
  bom_ref: string;
  bom_label: string;
  product_id: number;
  product_ref: string;
  product_name: string;
  warehouse_id: number;
  warehouse_name: string;
  workstation_name: string | null;
  qty_planned: number;
  qty_produced: number;
  scheduled_date: string;
  status: 'draft' | 'validated' | 'in_progress' | 'produced' | 'cancelled';
  notes: string;
}

export interface DocumentLine {
  productId?: number | null;
  ref?: string;
  label: string;
  qty: number;
  unitPrice: number;
  discountPct: number;
  taxRate: number;
}

export interface OpportunityItem {
  id: number;
  ref: string;
  third_party_id: number;
  party_name: string;
  title: string;
  stage: 'qualification' | 'proposition' | 'negotiation' | 'won' | 'lost';
  probability: number;
  amount: number;
  close_date: string;
  owner_name: string;
  notes: string;
}

export interface Proposal {
  id: number;
  ref: string;
  third_party_id: number;
  customer_name: string;
  customer_ref: string;
  title: string;
  issue_date: string;
  valid_until: string;
  status: 'draft' | 'validated' | 'signed' | 'declined' | 'billed';
  lines_json: string;
  subtotal_ht: number;
  tax_total: number;
  total_ttc: number;
  notes: string;
  signed_by?: string;
  signed_at?: string;
  signature_name?: string;
  created_by: string;
}

export interface SalesOrder {
  id: number;
  ref: string;
  third_party_id: number;
  customer_name: string;
  warehouse_name: string;
  warehouse_id: number;
  incoterm?: string;
  proposal_ref: string;
  order_date: string;
  delivery_date: string;
  status: 'draft' | 'validated' | 'shipped' | 'billed' | 'cancelled';
  lines_json: string;
  subtotal_ht: number;
  tax_total: number;
  total_ttc: number;
  notes: string;
}

export interface ShipmentItem {
  id: number;
  ref: string;
  sales_order_id: number;
  order_ref: string;
  customer_name: string;
  warehouse_name: string;
  carrier: string;
  tracking_number: string;
  ship_date: string;
  weight_kg: number;
  status: 'draft' | 'packed' | 'in_transit' | 'delivered';
  notes: string;
}

export interface ContractItem {
  id: number;
  ref: string;
  third_party_id: number;
  customer_name: string;
  title: string;
  billing_cycle: 'monthly' | 'quarterly' | 'annual';
  recurring_amount: number;
  start_date: string;
  next_billing_date: string;
  status: 'draft' | 'active' | 'suspended' | 'closed';
  notes: string;
}

export interface InterventionItem {
  id: number;
  ref: string;
  third_party_id: number;
  customer_name: string;
  title: string;
  technician_name: string;
  scheduled_date: string;
  duration_hours: number;
  status: 'planned' | 'in_progress' | 'completed' | 'billed';
  notes: string;
}

export interface SupplierRfq {
  id: number;
  ref: string;
  third_party_id: number;
  supplier_name: string;
  title: string;
  request_date: string;
  deadline_date: string;
  incoterm: string;
  estimated_total: number;
  status: 'draft' | 'open' | 'quoted' | 'accepted' | 'declined';
  notes: string;
}

export interface PurchaseOrder {
  id: number;
  ref: string;
  third_party_id: number;
  supplier_name: string;
  warehouse_name: string;
  warehouse_id: number;
  incoterm?: string;
  order_date: string;
  expected_date: string;
  status: 'draft' | 'ordered' | 'received' | 'billed' | 'cancelled';
  lines_json: string;
  subtotal_ht: number;
  tax_total: number;
  total_ttc: number;
  notes: string;
}

export interface Invoice {
  id: number;
  ref: string;
  invoice_type: 'customer' | 'supplier';
  invoice_kind?: 'standard' | 'credit_note';
  third_party_id: number;
  party_name: string;
  party_ref: string;
  source_ref: string;
  issue_date: string;
  due_date: string;
  status: 'draft' | 'validated' | 'partial' | 'paid' | 'cancelled';
  lines_json: string;
  subtotal_ht: number;
  tax_total: number;
  total_ttc: number;
  amount_paid: number;
  notes: string;
}

export interface BankAccount {
  id: number;
  ref: string;
  name: string;
  bank_name: string;
  account_number: string;
  currency: string;
  balance: number;
  account_type: 'checking' | 'savings' | 'cash';
  status: 'active' | 'closed';
}

export interface BankTransaction {
  id: number;
  bank_account_id: number;
  account_name: string;
  account_ref: string;
  tx_date: string;
  label: string;
  category: string;
  amount: number;
  direction: 'credit' | 'debit';
  invoice_ref: string;
  created_by: string;
}

export interface SepaBatch {
  id: number;
  ref: string;
  batch_type: 'direct_debit' | 'credit_transfer';
  bank_account_id: number;
  bank_name: string;
  bank_ref: string;
  execution_date: string;
  total_amount: number;
  items_json: string;
  status: 'prepared' | 'transmitted' | 'settled';
}

export interface AccountingAccount {
  id: number;
  code: string;
  label: string;
  account_class: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  balance: number;
}

export interface JournalEntry {
  id: number;
  ref: string;
  entry_date: string;
  journal_code: string;
  description: string;
  debit_account_code: string;
  credit_account_code: string;
  amount: number;
  source_ref: string;
  created_by: string;
}

export interface DonationItem {
  id: number;
  ref: string;
  donor_name: string;
  donor_email: string;
  amount: number;
  donation_date: string;
  payment_mode: string;
  status: 'promised' | 'received' | 'cancelled';
  notes: string;
}

export interface LoanItem {
  id: number;
  ref: string;
  label: string;
  lender_name: string;
  principal_amount: number;
  remaining_principal: number;
  interest_rate: number;
  term_months: number;
  start_date: string;
  status: 'active' | 'paid_off';
}

export interface TicketItem {
  id: number;
  ref: string;
  third_party_id: number | null;
  customer_name: string | null;
  subject: string;
  category: string;
  severity: 'low' | 'normal' | 'high' | 'critical';
  status: 'open' | 'in_progress' | 'waiting_customer' | 'closed';
  assignee_name: string;
  message: string;
  replies_json: string;
  created_at: string;
}

export interface KbArticle {
  id: number;
  ref: string;
  title: string;
  category: string;
  content: string;
  is_public: number;
  views: number;
  updated_at: string;
}

export interface Project {
  id: number;
  ref: string;
  title: string;
  third_party_id: number | null;
  customer_name: string | null;
  start_date: string;
  due_date: string;
  budget_amount: number;
  status: 'draft' | 'active' | 'on_hold' | 'completed';
  progress: number;
  description: string;
}

export interface ProjectTask {
  id: number;
  project_id: number;
  ref: string;
  title: string;
  assignee_name: string;
  priority: 'low' | 'medium' | 'high';
  status: 'todo' | 'in_progress' | 'review' | 'done';
  estimated_hours: number;
  logged_hours: number;
  progress: number;
  due_date: string;
}

export interface AgendaEvent {
  id: number;
  uid: string;
  title: string;
  event_type: 'meeting' | 'call' | 'deadline' | 'intervention' | 'holiday';
  start_at: string;
  end_at: string;
  location: string;
  organizer: string;
  description: string;
}

export interface OrgEvent {
  id: number;
  ref: string;
  title: string;
  event_date: string;
  venue: string;
  capacity: number;
  registered_count: number;
  status: 'draft' | 'open' | 'full' | 'completed';
  description: string;
}

export interface SurveyItem {
  id: number;
  ref: string;
  title: string;
  question: string;
  options_json: string;
  votes_json: string;
  status: 'open' | 'closed';
}

export interface EmployeeItem {
  id: number;
  ref: string;
  full_name: string;
  email: string;
  phone: string;
  department: string;
  job_title: string;
  hire_date: string;
  annual_salary: number;
  leave_balance_days: number;
  status: 'active' | 'on_leave' | 'terminated';
}

export interface LeaveRequestItem {
  id: number;
  ref: string;
  employee_id: number;
  employee_name: string;
  department: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string;
}

export interface ExpenseReportItem {
  id: number;
  ref: string;
  employee_id: number;
  employee_name: string;
  department: string;
  category: string;
  expense_date: string;
  amount: number;
  tax_amount: number;
  description: string;
  status: 'draft' | 'submitted' | 'approved' | 'paid' | 'rejected';
  approved_by: string;
}

export interface JobPosting {
  id: number;
  ref: string;
  title: string;
  department: string;
  location: string;
  contract_type: string;
  status: 'draft' | 'open' | 'closed';
  description: string;
}

export interface CandidateItem {
  id: number;
  job_id: number;
  job_title: string;
  job_ref: string;
  full_name: string;
  email: string;
  phone: string;
  stage: 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected';
  notes: string;
}

export interface TimesheetItem {
  id: number;
  employee_id: number;
  employee_name: string;
  project_id: number | null;
  project_ref: string | null;
  project_title: string | null;
  work_date: string;
  hours: number;
  task_label: string;
  billable: number;
}

export interface EdmDocument {
  id: number;
  ref: string;
  title: string;
  folder: string;
  mime_type: string;
  size_bytes: number;
  tags: string;
  content_text: string;
  uploaded_by: string;
  created_at: string;
}

export interface BookmarkItem {
  id: number;
  title: string;
  url: string;
  category: string;
  created_by: string;
}

export interface EmailCampaign {
  id: number;
  ref: string;
  subject: string;
  target_segment: string;
  body_text: string;
  recipient_count: number;
  status: 'draft' | 'sent';
  sent_at: string;
}

export interface CollectedEmail {
  id: number;
  sender_email: string;
  subject: string;
  snippet: string;
  matched_party: string;
  status: 'unprocessed' | 'converted_ticket' | 'archived';
  received_at: string;
}

export interface DashboardPayload {
  kpis: {
    totalBilled: number;
    openReceivables: number;
    openPayables: number;
    openProposalsCount: number;
    openProposalsValue: number;
    cashBalance: number;
  };
  lowStock: Array<{ id: number; ref: string; name: string; min_stock: number; total_stock: number }>;
  openProposals: Array<{
    id: number;
    ref: string;
    title: string;
    total_ttc: number;
    status: string;
    valid_until: string;
    customer_name: string;
  }>;
  pendingInvoices: Array<{
    id: number;
    ref: string;
    invoice_type: string;
    total_ttc: number;
    amount_paid: number;
    due_date: string;
    status: string;
    party_name: string;
  }>;
  activeProjects: Array<{
    id: number;
    ref: string;
    title: string;
    progress: number;
    due_date: string;
    status: string;
    customer_name: string | null;
  }>;
  recentLogs: AuditLogEntry[];
  cashflowSeries: Array<{ month: string; inflow: number; outflow: number }>;
}

export interface GlobalSearchResult {
  uid: string;
  id: number;
  ref: string;
  title: string;
  subtitle: string;
  category: string;
  moduleKey: string;
  subTab?: string;
  status?: string;
  amount?: number | null;
}

export interface SearchFocusHint {
  moduleKey: string;
  subTab?: string;
  recordId: number;
  ref: string;
  title: string;
  ts: number;
}

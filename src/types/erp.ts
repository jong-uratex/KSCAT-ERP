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
  project_id?: number | null;
  project_ref?: string | null;
  project_title?: string | null;
  currency?: string;
  exchange_rate?: number;
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
  reconciled?: number;
  reconciled_at?: string;
  statement_ref?: string;
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
  is_active?: number;
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
  currency?: string;
  exchange_rate?: number;
  original_amount?: number;
  source_ref: string;
  project_id?: number | null;
  project_ref?: string | null;
  project_title?: string | null;
  is_reversal?: number;
  reversed_entry_ref?: string;
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

export interface FiscalPeriodItem {
  id: number;
  code: string;
  name: string;
  start_date: string;
  end_date: string;
  status: 'open' | 'closed';
  closed_by: string;
  closed_at: string;
}

export interface CurrencyRateItem {
  id: number;
  code: string;
  name: string;
  symbol: string;
  exchange_rate: number;
  is_base: number;
  updated_at?: string;
}

export interface TaxRateItem {
  id: number;
  code: string;
  name: string;
  rate: number;
  tax_type: 'sales' | 'purchase' | 'both';
  applies_to: string;
  is_active: number;
  notes: string;
}

export interface ProjectBudgetItem {
  id: number;
  project_id: number;
  project_ref: string;
  project_title: string;
  project_status: string;
  cost_code: string;
  category: string;
  description: string;
  planned_budget: number;
  committed_amount: number;
  hourly_cost_rate: number;
  hourly_bill_rate: number;
}

export interface ProjectProfitabilityRow {
  project_id: number;
  project_ref: string;
  project_title: string;
  customer_name: string;
  status: string;
  progress: number;
  planned_budget: number;
  committed_cost: number;
  invoiced_revenue: number;
  billable_hours: number;
  non_billable_hours: number;
  labor_cost: number;
  billable_labor_value: number;
  supplier_costs: number;
  gl_direct_costs: number;
  total_actual_cost: number;
  effective_revenue: number;
  gross_profit: number;
  margin_pct: number;
  budget_utilization_pct: number;
}

export interface FixedAssetItem {
  id: number;
  ref: string;
  name: string;
  category: string;
  acquisition_date: string;
  purchase_cost: number;
  salvage_value: number;
  useful_life_months: number;
  depreciation_method: 'straight_line' | 'declining_balance';
  accumulated_depreciation: number;
  last_depreciation_date: string;
  location: string;
  status: 'active' | 'fully_depreciated' | 'disposed';
  notes: string;
  net_book_value: number;
  monthly_depreciation: number;
}

export interface RecurringInvoiceItem {
  id: number;
  ref: string;
  invoice_type: 'customer' | 'supplier';
  third_party_id: number;
  party_name: string;
  party_ref: string;
  project_id: number | null;
  project_ref: string | null;
  project_title: string | null;
  title: string;
  frequency: 'monthly' | 'quarterly' | 'annual';
  next_run_date: string;
  currency: string;
  lines_json: string;
  total_ttc: number;
  status: 'active' | 'paused' | 'ended';
  last_generated_ref: string;
  notes: string;
}

export interface AgingBuckets {
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_plus: number;
  total: number;
}

export interface AgingBucketSummary {
  ar: AgingBuckets;
  ap: AgingBuckets;
}

export interface FinancialStatementsPayload {
  trialBalance: {
    rows: Array<{
      code: string;
      label: string;
      account_class: AccountingAccount['account_class'];
      debit: number;
      credit: number;
    }>;
    totalDebits: number;
    totalCredits: number;
    isBalanced: boolean;
  };
  profitAndLoss: {
    revenueItems: Array<{ code: string; label: string; amount: number }>;
    expenseItems: Array<{ code: string; label: string; amount: number }>;
    totalRevenue: number;
    totalExpenses: number;
    netIncome: number;
    netMarginPct: number;
  };
  balanceSheet: {
    assetItems: Array<{ code: string; label: string; amount: number }>;
    liabilityItems: Array<{ code: string; label: string; amount: number }>;
    equityItems: Array<{ code: string; label: string; amount: number }>;
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    netIncome: number;
    totalLiabilitiesAndEquity: number;
    isBalanced: boolean;
  };
}

export type GeneralLedgerEntryStatus = 'posted' | 'reversal' | 'reversed' | 'locked';

export interface GeneralLedgerEntryRow extends JournalEntry {
  debit_account_label: string;
  debit_account_class: AccountingAccount['account_class'];
  credit_account_label: string;
  credit_account_class: AccountingAccount['account_class'];
  entry_status: GeneralLedgerEntryStatus;
  fiscal_period_code: string;
  fiscal_period_status: 'open' | 'closed';
}

export interface GeneralLedgerLineRow {
  line_id: string;
  entry_id: number;
  ref: string;
  entry_date: string;
  journal_code: string;
  account_code: string;
  account_label: string;
  account_class: AccountingAccount['account_class'];
  counterpart_code: string;
  counterpart_label: string;
  description: string;
  source_ref: string;
  project_ref: string | null;
  debit: number;
  credit: number;
  entry_status: GeneralLedgerEntryStatus;
  fiscal_period_code: string;
  reversed_entry_ref: string;
  created_by: string;
}

export interface GeneralLedgerAccountSummary {
  code: string;
  label: string;
  account_class: AccountingAccount['account_class'];
  current_balance: number;
  period_debits: number;
  period_credits: number;
  net_change: number;
  tx_count: number;
}

export interface GeneralLedgerReportPayload {
  entries: GeneralLedgerEntryRow[];
  lines: GeneralLedgerLineRow[];
  accountSummary: GeneralLedgerAccountSummary[];
  accounts: AccountingAccount[];
  fiscalPeriods: FiscalPeriodItem[];
  summary: {
    entryCount: number;
    lineCount: number;
    totalDebits: number;
    totalCredits: number;
    netMovement: number;
    isBalanced: boolean;
  };
}

export interface BankStatementItem {
  id: number;
  ref: string;
  bank_account_id: number;
  statement_name: string;
  statement_date: string;
  period_start: string;
  period_end: string;
  opening_balance: number;
  closing_balance: number;
  currency: string;
  source_type: 'manual' | 'csv';
  status: 'open' | 'in_progress' | 'reconciled';
  notes: string;
  created_by: string;
  created_at: string;
  account_ref: string;
  account_name: string;
  bank_name: string;
  account_book_balance: number;
  line_count: number;
  matched_count: number;
  unmatched_count: number;
  ignored_count: number;
  matched_net: number;
  unmatched_volume: number;
}

export interface BankStatementLineItem {
  id: number;
  statement_id: number;
  tx_date: string;
  description: string;
  reference: string;
  direction: 'credit' | 'debit';
  amount: number;
  running_balance: number | null;
  match_status: 'unmatched' | 'matched' | 'ignored';
  matched_journal_entry_id: number | null;
  matched_journal_ref: string;
  matched_at: string;
  matched_by: string;
  match_note: string;
  journal_date?: string | null;
  journal_code?: string | null;
  journal_description?: string | null;
  debit_account_code?: string | null;
  credit_account_code?: string | null;
  journal_amount?: number | null;
  journal_source_ref?: string | null;
}

export interface ReconcilableJournalEntry extends JournalEntry {
  debit_account_label: string;
  credit_account_label: string;
  is_matched: boolean;
  matched_line_id: number | null;
  matched_statement_ref: string;
}

export interface BankReconciliationSummary {
  totalStatements: number;
  totalLines: number;
  matchedCount: number;
  unmatchedCount: number;
  ignoredCount: number;
  totalInflows: number;
  totalOutflows: number;
  statementNetFlow: number;
  matchedNet: number;
  unmatchedVolume: number;
  openingBalance: number;
  closingBalance: number;
  computedEndingBalance: number;
  reconciledEndingBalance: number;
  reconciliationGap: number;
}

export interface BankReconciliationPayload {
  bankAccounts: BankAccount[];
  statements: BankStatementItem[];
  activeStatement: BankStatementItem | null;
  lines: BankStatementLineItem[];
  journalEntries: ReconcilableJournalEntry[];
  accounts: AccountingAccount[];
  summary: BankReconciliationSummary;
}

export type TaxComplianceBucket = 'output' | 'input_recognized' | 'input_pending_po';

export interface TaxComplianceDocumentLineDetail {
  label: string;
  ref: string;
  qty: number;
  netBaseUsd: number;
  taxRate: number;
  taxAmountUsd: number;
}

export interface TaxComplianceDocumentRow {
  uid: string;
  id: number;
  source: 'invoice' | 'purchase_order';
  doc_type_label: string;
  ref: string;
  source_ref: string;
  party_name: string;
  party_tax_id: string;
  doc_date: string;
  due_or_expected_date: string;
  status: string;
  currency: string;
  exchange_rate: number;
  taxable_base_usd: number;
  tax_amount_usd: number;
  signed_tax_usd: number;
  liability_impact_usd: number;
  vat_bucket: TaxComplianceBucket;
  effective_rate_pct: number;
  line_details: TaxComplianceDocumentLineDetail[];
}

export interface TaxComplianceRateBucket {
  rate: number;
  tax_code: string;
  tax_name: string;
  tax_type: string;
  sales_base_usd: number;
  output_vat_usd: number;
  purchases_base_usd: number;
  recognized_input_vat_usd: number;
  pending_po_base_usd: number;
  pending_po_input_vat_usd: number;
  net_vat_usd: number;
  projected_net_vat_usd: number;
  doc_count: number;
}

export interface TaxCompliancePeriodRow {
  period_month: string;
  output_vat_usd: number;
  recognized_input_vat_usd: number;
  pending_po_input_vat_usd: number;
  net_payable_usd: number;
  projected_payable_usd: number;
  doc_count: number;
}

export interface TaxComplianceSummary {
  baseCurrency: string;
  grossOutputVat: number;
  creditNoteOutputOffset: number;
  netOutputVat: number;
  recognizedInputVat: number;
  pendingPoInputVat: number;
  totalPotentialInputVat: number;
  netStatutoryPayable: number;
  projectedNetLiability: number;
  glVatPayableBalance: number;
  glVariance: number;
  taxableSalesBase: number;
  taxablePurchasesBase: number;
  pendingPoBase: number;
  customerInvoiceCount: number;
  supplierBillCount: number;
  openPoCount: number;
  billedPoExcludedCount: number;
  draftExcludedCount: number;
}

export interface TaxCompliancePayload {
  summary: TaxComplianceSummary;
  documents: TaxComplianceDocumentRow[];
  rateBreakdown: TaxComplianceRateBucket[];
  monthlyTimeline: TaxCompliancePeriodRow[];
  fiscalPeriods: FiscalPeriodItem[];
  taxRates: TaxRateItem[];
}

export type FiscalBudgetAlertStatus = 'on_track' | 'warning' | 'over_budget';
export type FiscalBudgetSpendSource =
  | 'auto'
  | 'gl_account'
  | 'supplier_bills'
  | 'payroll'
  | 'bank_debits'
  | 'expenses'
  | 'manual';

export interface FiscalBudgetSpendLine {
  sourceLabel: string;
  ref: string;
  date: string;
  description: string;
  amount: number;
}

export interface FiscalBudgetItem {
  id: number;
  ref: string;
  fiscal_period_id: number;
  period_code: string;
  period_name: string;
  period_start: string;
  period_end: string;
  period_status: 'open' | 'closed';
  name: string;
  category: string;
  department: string;
  account_code: string;
  account_label: string;
  planned_amount: number;
  warning_threshold_pct: number;
  critical_threshold_pct: number;
  spend_source: FiscalBudgetSpendSource;
  manual_actual_amount: number;
  actual_amount: number;
  remaining_amount: number;
  variance_amount: number;
  utilization_pct: number;
  alert_status: FiscalBudgetAlertStatus;
  actual_breakdown: FiscalBudgetSpendLine[];
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface FiscalBudgetsSummary {
  totalBudgets: number;
  totalPlanned: number;
  totalActual: number;
  totalRemaining: number;
  totalVariance: number;
  overallUtilizationPct: number;
  overBudgetCount: number;
  warningCount: number;
  onTrackCount: number;
  alertCount: number;
}

export interface FiscalBudgetsPayload {
  budgets: FiscalBudgetItem[];
  alerts: FiscalBudgetItem[];
  summary: FiscalBudgetsSummary;
  fiscalPeriods: FiscalPeriodItem[];
  accounts: AccountingAccount[];
  categories: string[];
}

export interface CurrencyPeriodRateItem {
  id: number;
  currency_code: string;
  currency_name?: string;
  currency_symbol?: string;
  fiscal_period_id: number | null;
  period_code: string;
  period_name?: string;
  period_status?: 'open' | 'closed';
  effective_from: string;
  effective_to: string;
  exchange_rate: number;
  closing_rate: number;
  inverse_rate: number;
  rate_source: string;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CurrencyConversionResult {
  originalAmount: number;
  fromCurrency: string;
  toCurrency: string;
  baseCurrencyCode: string;
  baseAmount: number;
  convertedAmount: number;
  fromRate: number;
  toRate: number;
  crossRate: number;
  inverseCrossRate: number;
  rateSource: 'base' | 'period_rate' | 'spot_fallback' | 'explicit_override';
  periodCode: string;
  effectiveFrom: string;
  effectiveTo: string;
  txDate: string;
}

export interface FxExposureRow {
  docType: 'customer_invoice' | 'supplier_bill' | 'bank_account';
  id: number;
  ref: string;
  partyOrBank: string;
  currency: string;
  issueDate: string;
  foreignBalance: number;
  bookedRate: number;
  bookedBaseAmount: number;
  closingRate: number;
  revaluedBaseAmount: number;
  unrealizedFxGainLoss: number;
  rateSource: 'base' | 'period_rate' | 'spot_fallback' | 'explicit_override';
  periodCode: string;
}

export interface MultiCurrencyWorkspacePayload {
  baseCurrency: CurrencyRateItem;
  currencies: CurrencyRateItem[];
  fiscalPeriods: FiscalPeriodItem[];
  periodRates: CurrencyPeriodRateItem[];
  revaluationPeriod: FiscalPeriodItem | null;
  exposures: FxExposureRow[];
  summary: {
    totalCurrencies: number;
    periodRatesCount: number;
    foreignExposureBaseTotal: number;
    netUnrealizedFxGainLoss: number;
    activeForeignInvoicesCount: number;
    foreignJournalEntriesCount: number;
    foreignJournalEntriesBaseTotal: number;
  };
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

export interface JobHistoryEntry {
  role: string;
  department: string;
  startDate: string;
  endDate: string;
  notes?: string;
}

export interface TaxDocumentEntry {
  title: string;
  year: string;
  formType: string;
  status: string;
  uploadedAt: string;
}

export interface EmployeeItem {
  id: number;
  ref: string;
  full_name: string;
  email: string;
  phone: string;
  department: string;
  job_title: string;
  employment_type?: string;
  hire_date: string;
  annual_salary: number;
  leave_balance_days: number;
  tax_id?: string;
  bank_account?: string;
  emergency_contact?: string;
  job_history_json?: string;
  tax_documents_json?: string;
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

export interface AttendanceLogItem {
  id: number;
  employee_id: number;
  employee_name: string;
  department: string;
  work_date: string;
  clock_in: string;
  clock_out: string;
  shift_name: string;
  regular_hours: number;
  overtime_hours: number;
  status: 'present' | 'late' | 'remote' | 'absent' | 'approved';
  notes: string;
  approved_by: string;
}

export interface ShiftScheduleItem {
  id: number;
  ref: string;
  employee_id: number;
  employee_name: string;
  department: string;
  shift_name: string;
  start_time: string;
  end_time: string;
  work_days: string;
  location: string;
  status: 'active' | 'inactive';
}

export interface PayrollRunItem {
  id: number;
  ref: string;
  pay_period: string;
  pay_date: string;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  employee_count: number;
  status: 'draft' | 'processed' | 'paid';
  created_by: string;
}

export interface PayslipItem {
  id: number;
  ref: string;
  payroll_run_id: number;
  employee_id: number;
  employee_name: string;
  employee_ref?: string;
  department?: string;
  job_title?: string;
  tax_id?: string;
  bank_account?: string;
  pay_period: string;
  gross_pay: number;
  tax_deduction: number;
  social_deduction: number;
  health_deduction: number;
  other_deductions: number;
  net_pay: number;
  direct_deposit_ref: string;
  payment_method: string;
  status: 'generated' | 'paid';
}

export interface BenefitPlanItem {
  id: number;
  ref: string;
  name: string;
  provider: string;
  category: string;
  employer_contribution: number;
  employee_contribution: number;
  description: string;
  status: 'active' | 'archived';
}

export interface BenefitEnrollmentItem {
  id: number;
  employee_id: number;
  employee_name: string;
  department: string;
  plan_id: number;
  plan_name: string;
  plan_ref: string;
  plan_category: string;
  employee_contribution: number;
  employer_contribution: number;
  coverage_tier: string;
  enrollment_date: string;
  status: 'pending' | 'active' | 'cancelled';
  notes: string;
}

export interface OnboardingTaskItem {
  id: number;
  ref: string;
  employee_id: number | null;
  employee_name: string | null;
  candidate_id: number | null;
  candidate_name: string | null;
  task_title: string;
  category: string;
  due_date: string;
  assignee_name: string;
  status: 'pending' | 'in_progress' | 'completed';
  notes: string;
}

export interface KpiMetricItem {
  id: string;
  kpiName: string;
  category: string;
  weightPct: number;
  targetValue: string;
  actualValue: string;
  unit: string;
  score: number;
}

export interface KpiEvaluationItem {
  id: number;
  ref: string;
  employee_id: number;
  employee_name: string;
  department: string;
  job_title: string;
  evaluator_name: string;
  review_period: string;
  period_start: string;
  period_end: string;
  metrics_json: string;
  overall_score: number;
  rating_label: string;
  strengths: string;
  improvement_plan: string;
  employee_comments: string;
  status: 'draft' | 'self_review' | 'submitted' | 'approved';
  reviewed_by: string;
  created_at: string;
  updated_at: string;
}

export interface HrComplianceItem {
  id: number;
  ref: string;
  title: string;
  category: string;
  jurisdiction: string;
  due_date: string;
  owner_name: string;
  compliance_rate: number;
  status: 'compliant' | 'due_soon' | 'action_required';
  notes: string;
}

export interface HrAnalyticsSummary {
  totalHeadcount: number;
  activeHeadcount: number;
  onLeaveCount: number;
  terminatedCount: number;
  turnoverRatePct: number;
  totalAnnualPayroll: number;
  monthlyPayrollEstimate: number;
  latestPayrollNet: number;
  totalOvertimeHours: number;
  pendingLeaveCount: number;
  onboardingCompletionPct: number;
  avgKpiScore: number;
  complianceRatePct: number;
  departmentBreakdown: Array<{ department: string; headcount: number; payroll: number }>;
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

import { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  BookOpen,
  Briefcase,
  Building2,
  Coins,
  FileSpreadsheet,
  HeartHandshake,
  Landmark,
  Receipt,
  Scale,
  Target,
  Wallet,
} from 'lucide-react';
import { apiRequest, can } from '../lib/api';
import type {
  AccountingAccount,
  AgingBucketSummary,
  BankAccount,
  BankTransaction,
  CurrencyRateItem,
  DonationItem,
  EnabledModulesMap,
  FinancialStatementsPayload,
  FiscalPeriodItem,
  FixedAssetItem,
  Invoice,
  JournalEntry,
  LoanItem,
  PermissionMap,
  ProductItem,
  Project,
  ProjectBudgetItem,
  ProjectProfitabilityRow,
  RecurringInvoiceItem,
  SearchFocusHint,
  SepaBatch,
  TaxRateItem,
  ThirdParty,
} from '../types/erp';
import { ConfirmDeleteModal } from './Modal';
import { FinanceAccountingSection } from './finance/FinanceAccountingSection';
import { FinanceBankReconciliation } from './finance/FinanceBankReconciliation';
import { FinanceBudgetsTab } from './finance/FinanceBudgetsTab';
import { FinanceDonationsLoansTab } from './finance/FinanceDonationsLoansTab';
import { FinanceFixedAssetsTab } from './finance/FinanceFixedAssetsTab';
import { FinanceGeneralLedgerReport } from './finance/FinanceGeneralLedgerReport';
import { FinanceInvoicesSection } from './finance/FinanceInvoicesSection';
import { FinanceProjectAccountingSection } from './finance/FinanceProjectAccountingSection';
import { FinanceTaxComplianceTab } from './finance/FinanceTaxComplianceTab';
import { FinanceTaxCurrencySection } from './finance/FinanceTaxCurrencySection';
import { FinanceTreasurySection } from './finance/FinanceTreasurySection';

interface BillingViewProps {
  permissions: PermissionMap;
  enabledModules: EnabledModulesMap;
  focusHint?: SearchFocusHint | null;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

interface MarginStats {
  revenue_ht: number;
  credit_notes_ht: number;
  purchases_ht: number;
  vat_collected: number;
  vat_deductible: number;
}

type BillingTab =
  | 'customer_invoices'
  | 'supplier_bills'
  | 'project_accounting'
  | 'treasury'
  | 'bank_reconciliation'
  | 'general_ledger'
  | 'accounting'
  | 'budgets'
  | 'fixed_assets'
  | 'tax_compliance'
  | 'tax_fx'
  | 'donations_loans';

const EMPTY_AGING: AgingBucketSummary = {
  ar: { current: 0, days_1_30: 0, days_31_60: 0, days_61_plus: 0, total: 0 },
  ap: { current: 0, days_1_30: 0, days_31_60: 0, days_61_plus: 0, total: 0 },
};

const EMPTY_STATEMENTS: FinancialStatementsPayload = {
  trialBalance: { rows: [], totalDebits: 0, totalCredits: 0, isBalanced: true },
  profitAndLoss: { revenueItems: [], expenseItems: [], totalRevenue: 0, totalExpenses: 0, netIncome: 0, netMarginPct: 0 },
  balanceSheet: {
    assetItems: [],
    liabilityItems: [],
    equityItems: [],
    totalAssets: 0,
    totalLiabilities: 0,
    totalEquity: 0,
    netIncome: 0,
    totalLiabilitiesAndEquity: 0,
    isBalanced: true,
  },
};

export function BillingView({ permissions, enabledModules, focusHint, onNotify }: BillingViewProps) {
  const [tab, setTab] = useState<BillingTab>('customer_invoices');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [thirdParties, setThirdParties] = useState<ThirdParty[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const [sepaBatches, setSepaBatches] = useState<SepaBatch[]>([]);
  const [glAccounts, setGlAccounts] = useState<AccountingAccount[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [donations, setDonations] = useState<DonationItem[]>([]);
  const [loans, setLoans] = useState<LoanItem[]>([]);
  const [fiscalPeriods, setFiscalPeriods] = useState<FiscalPeriodItem[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyRateItem[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRateItem[]>([]);
  const [projectBudgets, setProjectBudgets] = useState<ProjectBudgetItem[]>([]);
  const [projectProfitability, setProjectProfitability] = useState<ProjectProfitabilityRow[]>([]);
  const [fixedAssets, setFixedAssets] = useState<FixedAssetItem[]>([]);
  const [recurringInvoices, setRecurringInvoices] = useState<RecurringInvoiceItem[]>([]);
  const [agingSummary, setAgingSummary] = useState<AgingBucketSummary>(EMPTY_AGING);
  const [financialStatements, setFinancialStatements] = useState<FinancialStatementsPayload>(EMPTY_STATEMENTS);
  const [marginStats, setMarginStats] = useState<MarginStats>({
    revenue_ht: 0,
    credit_notes_ht: 0,
    purchases_ht: 0,
    vat_collected: 0,
    vat_deductible: 0,
  });
  const [loading, setLoading] = useState(true);

  const [deleteTarget, setDeleteTarget] = useState<{
    url: string;
    title: string;
    itemLabel: string;
    warning?: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [reconRefreshTick, setReconRefreshTick] = useState(0);

  const canWrite = can(permissions, 'billing', 'write');
  const canValidate = can(permissions, 'billing', 'validate');
  const canRecordPay = can(permissions, 'billing', 'record_payment');
  const canDelete = can(permissions, 'billing', 'delete');
  const showAccounting = enabledModules.accounting !== false;

  async function loadBilling() {
    setLoading(true);
    try {
      const [invRes, bankRes, tpRes, prodRes, projRes, finRes] = await Promise.all([
        apiRequest<{ invoices: Invoice[] }>('/api/invoices'),
        apiRequest<{ accounts: BankAccount[]; transactions: BankTransaction[] }>('/api/bank-accounts'),
        apiRequest<{ thirdParties: ThirdParty[] }>('/api/third-parties'),
        apiRequest<{ products: ProductItem[] }>('/api/products'),
        apiRequest<{ projects: Project[] }>('/api/projects').catch(() => ({ projects: [] as Project[] })),
        apiRequest<{
          sepaBatches: SepaBatch[];
          accounts: AccountingAccount[];
          journalEntries: JournalEntry[];
          donations: DonationItem[];
          loans: LoanItem[];
          marginStats: MarginStats;
          fiscalPeriods: FiscalPeriodItem[];
          currencies: CurrencyRateItem[];
          taxRates: TaxRateItem[];
          projectBudgets: ProjectBudgetItem[];
          projectProfitability: ProjectProfitabilityRow[];
          fixedAssets: FixedAssetItem[];
          recurringInvoices: RecurringInvoiceItem[];
          agingSummary: AgingBucketSummary;
          financialStatements: FinancialStatementsPayload;
        }>('/api/finance-extensions'),
      ]);
      setInvoices(invRes.invoices);
      setAccounts(bankRes.accounts);
      setTransactions(bankRes.transactions);
      setThirdParties(tpRes.thirdParties);
      setProducts(prodRes.products);
      setProjects(projRes.projects || []);
      setSepaBatches(finRes.sepaBatches);
      setGlAccounts(finRes.accounts);
      setJournalEntries(finRes.journalEntries);
      setDonations(finRes.donations);
      setLoans(finRes.loans);
      if (finRes.marginStats) setMarginStats(finRes.marginStats);
      setFiscalPeriods(finRes.fiscalPeriods || []);
      setCurrencies(finRes.currencies || []);
      setTaxRates(finRes.taxRates || []);
      setProjectBudgets(finRes.projectBudgets || []);
      setProjectProfitability(finRes.projectProfitability || []);
      setFixedAssets(finRes.fixedAssets || []);
      setRecurringInvoices(finRes.recurringInvoices || []);
      if (finRes.agingSummary) setAgingSummary(finRes.agingSummary);
      if (finRes.financialStatements) setFinancialStatements(finRes.financialStatements);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to load billing data.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBilling();
  }, []);

  useEffect(() => {
    if (!focusHint?.subTab) return;
    if (
      focusHint.subTab === 'customer_invoices' ||
      focusHint.subTab === 'supplier_bills' ||
      focusHint.subTab === 'project_accounting' ||
      focusHint.subTab === 'treasury' ||
      focusHint.subTab === 'bank_reconciliation' ||
      focusHint.subTab === 'general_ledger' ||
      focusHint.subTab === 'accounting' ||
      focusHint.subTab === 'budgets' ||
      focusHint.subTab === 'fixed_assets' ||
      focusHint.subTab === 'tax_compliance' ||
      focusHint.subTab === 'tax_fx'
    ) {
      setTab(focusHint.subTab);
    }
  }, [focusHint?.ts]);

  function promptDelete(url: string, title: string, itemLabel: string, warning?: string) {
    setDeleteError('');
    setDeleteTarget({ url, title, itemLabel, warning });
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await apiRequest(deleteTarget.url, { method: 'DELETE' });
      onNotify(`${deleteTarget.itemLabel} deleted.`);
      setDeleteTarget(null);
      setReconRefreshTick((t) => t + 1);
      await loadBilling();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unable to delete record.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Finance, Project Accounting &amp; Treasury
          </h1>
          <p className="text-sm text-zinc-500">
            AR/AP aging, project job costing &amp; P&amp;L, automated financial statements, fiscal locks, bank reconciliation, fixed assets, tax codes, and multi-currency FX.
          </p>
        </div>
      </div>

      {/* Single-line Horizontal Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-800 overflow-x-auto">
        {(
          [
            ['customer_invoices', `Invoices & AR (${invoices.filter((i) => i.invoice_type === 'customer').length})`, Receipt],
            ['supplier_bills', `Supplier Bills & AP (${invoices.filter((i) => i.invoice_type === 'supplier').length})`, Wallet],
            ['project_accounting', `Project Accounting (${projectProfitability.length})`, Briefcase],
            ['treasury', `Treasury & SEPA (${accounts.length})`, Landmark],
            ...(showAccounting
              ? ([
                  ['bank_reconciliation', 'Bank Reconciliation', ArrowLeftRight],
                  ['general_ledger', 'General Ledger', FileSpreadsheet],
                  ['accounting', 'GL & Statements', BookOpen],
                ] as const)
              : []),
            ['budgets', 'Budgets', Target],
            ['fixed_assets', `Fixed Assets (${fixedAssets.length})`, Building2],
            ['tax_compliance', 'Tax Compliance', Scale],
            ['tax_fx', 'Tax, FX & Margins', Coins],
            ['donations_loans', `Grants & Loans (${donations.length + loans.length})`, HeartHandshake],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              tab === key
                ? 'border-orange-700 text-orange-700 dark:text-orange-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-zinc-500">Loading finance &amp; project accounting workspace...</div>
      ) : tab === 'customer_invoices' || tab === 'supplier_bills' ? (
        <FinanceInvoicesSection
          mode={tab === 'customer_invoices' ? 'customer' : 'supplier'}
          invoices={invoices}
          recurringInvoices={recurringInvoices}
          agingSummary={agingSummary}
          bankAccounts={accounts}
          thirdParties={thirdParties}
          products={products}
          projects={projects}
          currencies={currencies}
          taxRates={taxRates}
          canWrite={canWrite}
          canValidate={canValidate}
          canRecordPay={canRecordPay}
          canDelete={canDelete}
          onReload={loadBilling}
          onNotify={onNotify}
          onPromptDelete={promptDelete}
        />
      ) : tab === 'project_accounting' ? (
        <FinanceProjectAccountingSection
          profitability={projectProfitability}
          budgets={projectBudgets}
          projects={projects}
          canWrite={canWrite}
          canDelete={canDelete}
          onReload={loadBilling}
          onNotify={onNotify}
          onPromptDelete={promptDelete}
        />
      ) : tab === 'treasury' ? (
        <FinanceTreasurySection
          accounts={accounts}
          transactions={transactions}
          sepaBatches={sepaBatches}
          canWrite={canWrite}
          canRecordPay={canRecordPay}
          canDelete={canDelete}
          onReload={loadBilling}
          onNotify={onNotify}
          onPromptDelete={promptDelete}
        />
      ) : tab === 'bank_reconciliation' ? (
        <FinanceBankReconciliation
          canWrite={canWrite}
          canRecordPay={canRecordPay}
          canDelete={canDelete}
          refreshTick={reconRefreshTick}
          onReload={loadBilling}
          onNotify={onNotify}
          onPromptDelete={promptDelete}
        />
      ) : tab === 'general_ledger' ? (
        <FinanceGeneralLedgerReport
          canWrite={canWrite}
          onReload={loadBilling}
          onNotify={onNotify}
        />
      ) : tab === 'accounting' ? (
        <FinanceAccountingSection
          accounts={glAccounts}
          journalEntries={journalEntries}
          fiscalPeriods={fiscalPeriods}
          fixedAssets={fixedAssets}
          financialStatements={financialStatements}
          projects={projects}
          canWrite={canWrite}
          canValidate={canValidate}
          canDelete={canDelete}
          onReload={loadBilling}
          onNotify={onNotify}
          onPromptDelete={promptDelete}
        />
      ) : tab === 'budgets' ? (
        <FinanceBudgetsTab
          canWrite={canWrite}
          canDelete={canDelete}
          refreshTick={reconRefreshTick}
          onNotify={onNotify}
          onPromptDelete={promptDelete}
        />
      ) : tab === 'fixed_assets' ? (
        <FinanceFixedAssetsTab
          fixedAssets={fixedAssets}
          fiscalPeriods={fiscalPeriods}
          canWrite={canWrite}
          canDelete={canDelete}
          onReload={loadBilling}
          onNotify={onNotify}
          onPromptDelete={promptDelete}
        />
      ) : tab === 'tax_compliance' ? (
        <FinanceTaxComplianceTab onNotify={onNotify} />
      ) : tab === 'tax_fx' ? (
        <FinanceTaxCurrencySection
          currencies={currencies}
          taxRates={taxRates}
          marginStats={marginStats}
          canWrite={canWrite}
          canDelete={canDelete}
          onReload={loadBilling}
          onNotify={onNotify}
          onPromptDelete={promptDelete}
        />
      ) : (
        <FinanceDonationsLoansTab
          donations={donations}
          loans={loans}
          canWrite={canWrite}
          canRecordPay={canRecordPay}
          canDelete={canDelete}
          onReload={loadBilling}
          onNotify={onNotify}
          onPromptDelete={promptDelete}
        />
      )}

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title={deleteTarget?.title || 'Delete Record'}
        itemLabel={deleteTarget?.itemLabel || ''}
        warning={deleteTarget?.warning}
        error={deleteError}
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

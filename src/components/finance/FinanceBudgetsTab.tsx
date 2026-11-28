import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Download,
  Eye,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import type {
  FiscalBudgetItem,
  FiscalBudgetSpendSource,
  FiscalBudgetsPayload,
} from '../../types/erp';
import { Modal } from '../Modal';
import { StatusText } from '../StatusText';
import { downloadCsvBlob } from './financeHelpers';

interface FinanceBudgetsTabProps {
  canWrite: boolean;
  canDelete: boolean;
  refreshTick?: number;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPromptDelete: (url: string, title: string, itemLabel: string, warning?: string) => void;
}

const SPEND_SOURCE_LABELS: Record<FiscalBudgetSpendSource, string> = {
  auto: 'Auto-Matched (GL + Subledgers)',
  gl_account: 'GL Account Journal Entries',
  supplier_bills: 'Supplier Bills (Excl. Tax)',
  payroll: 'Payroll Runs (Gross)',
  bank_debits: 'Direct Bank Outflows',
  expenses: 'Approved Employee Expenses',
  manual: 'Manual Actual Entry',
};

const BUDGET_CATEGORIES = [
  'Cost of Goods Sold',
  'Facilities',
  'Payroll & Benefits',
  'Depreciation & Amortization',
  'Travel & Expenses',
  'Cloud & Software',
  'Marketing & Sales',
  'Operating Expenses',
];

export function FinanceBudgetsTab({
  canWrite,
  canDelete,
  refreshTick = 0,
  onNotify,
  onPromptDelete,
}: FinanceBudgetsTabProps) {
  const [payload, setPayload] = useState<FiscalBudgetsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  // Filters
  const [fiscalPeriodId, setFiscalPeriodId] = useState('all');
  const [alertStatus, setAlertStatus] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [search, setSearch] = useState('');

  // Create / Edit modal state
  const [budgetModal, setBudgetModal] = useState(false);
  const [editingBudget, setEditingBudget] = useState<FiscalBudgetItem | null>(null);
  const [bPeriodId, setBPeriodId] = useState('');
  const [bName, setBName] = useState('');
  const [bCategory, setBCategory] = useState('Operating Expenses');
  const [bDepartment, setBDepartment] = useState('Operations');
  const [bAccountCode, setBAccountCode] = useState('');
  const [bPlanned, setBPlanned] = useState('10000');
  const [bWarnPct, setBWarnPct] = useState('85');
  const [bCritPct, setBCritPct] = useState('100');
  const [bSource, setBSource] = useState<FiscalBudgetSpendSource>('auto');
  const [bManualActual, setBManualActual] = useState('0');
  const [bNotes, setBNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Inspect breakdown modal
  const [inspectedBudget, setInspectedBudget] = useState<FiscalBudgetItem | null>(null);

  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams();
    if (fiscalPeriodId !== 'all') params.set('fiscalPeriodId', fiscalPeriodId);
    if (alertStatus !== 'all') params.set('alertStatus', alertStatus);
    if (categoryFilter !== 'all') params.set('category', categoryFilter);
    if (search.trim()) params.set('search', search.trim());
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [fiscalPeriodId, alertStatus, categoryFilter, search]);

  const loadBudgets = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest<FiscalBudgetsPayload>(
        `/api/finance/budgets${buildQueryString()}`
      );
      setPayload(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load fiscal budgets.');
    } finally {
      setLoading(false);
    }
  }, [buildQueryString]);

  useEffect(() => {
    loadBudgets();
  }, [loadBudgets, refreshTick]);

  function openCreateBudget() {
    const openPeriod =
      payload?.fiscalPeriods.find((fp) => fp.status === 'open') ?? payload?.fiscalPeriods[0];
    setEditingBudget(null);
    setBPeriodId(openPeriod ? String(openPeriod.id) : '');
    setBName('');
    setBCategory('Operating Expenses');
    setBDepartment('Operations');
    setBAccountCode('');
    setBPlanned('10000');
    setBWarnPct('85');
    setBCritPct('100');
    setBSource('auto');
    setBManualActual('0');
    setBNotes('');
    setBudgetModal(true);
  }

  function openEditBudget(b: FiscalBudgetItem) {
    setEditingBudget(b);
    setBPeriodId(String(b.fiscal_period_id));
    setBName(b.name);
    setBCategory(b.category);
    setBDepartment(b.department);
    setBAccountCode(b.account_code);
    setBPlanned(String(b.planned_amount));
    setBWarnPct(String(b.warning_threshold_pct));
    setBCritPct(String(b.critical_threshold_pct));
    setBSource(b.spend_source);
    setBManualActual(String(b.manual_actual_amount));
    setBNotes(b.notes || '');
    setBudgetModal(true);
  }

  async function handleSaveBudget(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        fiscalPeriodId: Number(bPeriodId),
        name: bName,
        category: bCategory,
        department: bDepartment,
        accountCode: bAccountCode,
        plannedAmount: Number(bPlanned) || 0,
        warningThresholdPct: Number(bWarnPct) || 85,
        criticalThresholdPct: Number(bCritPct) || 100,
        spendSource: bSource,
        manualActualAmount: Number(bManualActual) || 0,
        notes: bNotes,
      };
      if (editingBudget) {
        await apiRequest(`/api/finance/budgets/${editingBudget.id}`, {
          method: 'PUT',
          body,
        });
        onNotify(`Budget ${editingBudget.ref} updated.`);
      } else {
        await apiRequest('/api/finance/budgets', {
          method: 'POST',
          body,
        });
        onNotify('Fiscal period budget created.');
      }
      setBudgetModal(false);
      await loadBudgets();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save fiscal budget.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleExportCsv() {
    setExporting(true);
    try {
      const res = await apiRequest<{ filename: string; csv: string }>(
        `/api/finance/budgets/export${buildQueryString()}`
      );
      downloadCsvBlob(res.filename, res.csv);
      onNotify('Fiscal budgets CSV downloaded.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to export budgets CSV.', 'error');
    } finally {
      setExporting(false);
    }
  }

  function resetFilters() {
    setFiscalPeriodId('all');
    setAlertStatus('all');
    setCategoryFilter('all');
    setSearch('');
  }

  const summary = payload?.summary;
  const hasFilters =
    fiscalPeriodId !== 'all' ||
    alertStatus !== 'all' ||
    categoryFilter !== 'all' ||
    Boolean(search.trim());

  const expenseAccounts = (payload?.accounts ?? []).filter(
    (a) => a.account_class === 'expense' || a.account_class === 'asset'
  );

  return (
    <div className="space-y-5">
      {/* 4-Column KPI Summary Strip */}
      {loading && !payload ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 animate-pulse space-y-2"
            >
              <div className="h-3 w-28 rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-7 w-36 rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-3 w-40 rounded bg-zinc-100 dark:bg-zinc-800/70" />
            </div>
          ))}
        </div>
      ) : error && !payload ? (
        <div className="rounded-xl border border-red-200 dark:border-red-900/60 bg-white dark:bg-zinc-900 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Fiscal Budgets Unavailable
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">{error}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={loadBudgets}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      ) : summary ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <div className="text-xs text-zinc-500">Total Planned Budget</div>
            <div className="text-2xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100 mt-1">
              {formatCurrency(summary.totalPlanned)}
            </div>
            <div className="text-xs text-zinc-500 mt-1.5">
              {summary.totalBudgets} allocation(s) in scope
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <div className="text-xs text-zinc-500">Actual Spend to Date</div>
            <div className="text-2xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100 mt-1">
              {formatCurrency(summary.totalActual)}
            </div>
            <div className="text-xs text-zinc-500 mt-1.5 font-mono tabular-nums">
              {summary.overallUtilizationPct.toFixed(1)}% of planned budget
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-zinc-500">Remaining Headroom</span>
              <span
                className={`text-[11px] font-medium whitespace-nowrap ${
                  summary.totalRemaining >= 0
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-red-700 dark:text-red-400'
                }`}
              >
                {summary.totalRemaining >= 0 ? 'Under Budget' : 'Over Budget'}
              </span>
            </div>
            <div
              className={`text-2xl font-semibold font-mono tabular-nums mt-1 ${
                summary.totalRemaining >= 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-red-700 dark:text-red-400'
              }`}
            >
              {formatCurrency(summary.totalRemaining)}
            </div>
            <div className="text-xs text-zinc-500 mt-1.5 font-mono tabular-nums">
              Net variance: {summary.totalVariance > 0 ? '+' : ''}
              {formatCurrency(summary.totalVariance)}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-zinc-500">Variance Alerts</span>
              <span
                className={`text-[11px] font-medium whitespace-nowrap ${
                  summary.overBudgetCount > 0
                    ? 'text-red-700 dark:text-red-400'
                    : summary.warningCount > 0
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {summary.overBudgetCount > 0
                  ? 'Action Required'
                  : summary.warningCount > 0
                    ? 'Monitor Spend'
                    : 'All Nominal'}
              </span>
            </div>
            <div className="text-2xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100 mt-1">
              {summary.alertCount}
            </div>
            <div className="text-xs text-zinc-500 mt-1.5">
              {summary.overBudgetCount} over budget · {summary.warningCount} warning · {summary.onTrackCount} on track
            </div>
          </div>
        </div>
      ) : null}

      {/* Active Variance Alerts Panel */}
      {payload && payload.alerts.length > 0 && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <h2 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                Active Budget Variance Alerts ({payload.alerts.length})
              </h2>
            </div>
            <span className="text-xs text-zinc-500">
              Thresholds checked continuously against live ledger and operational spend
            </span>
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
            {payload.alerts.map((alertItem) => {
              const isCritical = alertItem.alert_status === 'over_budget';
              return (
                <div
                  key={`alert-${alertItem.id}`}
                  className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    {isCritical ? (
                      <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                          {alertItem.ref}
                        </span>
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {alertItem.name}
                        </span>
                        <span
                          className={`font-medium ${
                            isCritical
                              ? 'text-red-700 dark:text-red-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          · {isCritical ? 'Exceeded Budget Cap' : `Reached ${alertItem.warning_threshold_pct}% Warning Threshold`}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">
                        {alertItem.period_code} · Actual{' '}
                        <span className="font-mono text-zinc-700 dark:text-zinc-300">
                          {formatCurrency(alertItem.actual_amount)}
                        </span>{' '}
                        vs Planned{' '}
                        <span className="font-mono text-zinc-700 dark:text-zinc-300">
                          {formatCurrency(alertItem.planned_amount)}
                        </span>{' '}
                        ({alertItem.utilization_pct.toFixed(1)}% utilized
                        {alertItem.variance_amount > 0
                          ? `, +${formatCurrency(alertItem.variance_amount)} over`
                          : `, ${formatCurrency(alertItem.remaining_amount)} remaining`}
                        )
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setInspectedBudget(alertItem)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap"
                    >
                      <Eye className="w-3 h-3" />
                      Inspect Spend
                    </button>
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => openEditBudget(alertItem)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-orange-700 dark:text-orange-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap"
                      >
                        <Pencil className="w-3 h-3" />
                        Adjust Cap
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter & Actions Toolbar */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Fiscal Period Budgets &amp; Variance Tracking
            </h2>
            <p className="text-xs text-zinc-500">
              Allocate spending ceilings per fiscal period, track live GL and subledger outflows, and flag threshold breaches.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
              >
                Reset
              </button>
            )}
            <button
              type="button"
              onClick={loadBudgets}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={exporting || !payload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              {exporting ? 'Exporting...' : 'Export CSV'}
            </button>
            {canWrite && (
              <button
                type="button"
                onClick={openCreateBudget}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                New Budget
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ref, budget, dept, GL code..."
              aria-label="Search fiscal budgets"
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100"
            />
          </div>

          <select
            value={fiscalPeriodId}
            onChange={(e) => setFiscalPeriodId(e.target.value)}
            aria-label="Filter by fiscal period"
            className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100"
          >
            <option value="all">All Fiscal Periods</option>
            {(payload?.fiscalPeriods ?? []).map((fp) => (
              <option key={fp.id} value={fp.id}>
                {fp.code} — {fp.name} ({fp.status})
              </option>
            ))}
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter by budget category"
            className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100"
          >
            <option value="all">All Categories</option>
            {(payload?.categories ?? []).map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <select
            value={alertStatus}
            onChange={(e) => setAlertStatus(e.target.value)}
            aria-label="Filter by alert status"
            className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100"
          >
            <option value="all">All Alert States</option>
            <option value="alerts_only">Active Alerts Only (Over &amp; Warning)</option>
            <option value="over_budget">Over Budget</option>
            <option value="warning">Approaching Cap (Warning)</option>
            <option value="on_track">On Track</option>
          </select>
        </div>
      </div>

      {/* Budgets Table */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-950/60 border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Budget Line</th>
              <th className="text-left px-4 py-2.5 font-medium whitespace-nowrap">Fiscal Period</th>
              <th className="text-left px-4 py-2.5 font-medium">Account · Spend Source</th>
              <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">Planned</th>
              <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">Actual Spend</th>
              <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">Remaining / Var.</th>
              <th className="text-left px-4 py-2.5 font-medium whitespace-nowrap">Utilization</th>
              <th className="text-left px-4 py-2.5 font-medium whitespace-nowrap">Alert Status</th>
              <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
            {!payload || payload.budgets.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center">
                  <div className="inline-flex flex-col items-center gap-2 text-zinc-500">
                    <span className="text-xs">
                      {hasFilters
                        ? 'No budgets match the selected fiscal period or alert filters.'
                        : 'No fiscal period budgets configured yet. Set your first budget cap to begin variance monitoring.'}
                    </span>
                    {hasFilters ? (
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                      >
                        Clear Filters
                      </button>
                    ) : canWrite ? (
                      <button
                        type="button"
                        onClick={openCreateBudget}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Create First Budget
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ) : (
              payload.budgets.map((b) => {
                const barWidth = Math.min(100, Math.max(0, b.utilization_pct));
                const barColor =
                  b.alert_status === 'over_budget'
                    ? 'bg-red-600 dark:bg-red-500'
                    : b.alert_status === 'warning'
                      ? 'bg-amber-500 dark:bg-amber-400'
                      : 'bg-emerald-600 dark:bg-emerald-500';
                return (
                  <tr
                    key={b.id}
                    className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40 transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-mono text-xs font-semibold text-orange-700 dark:text-orange-400">
                        {b.ref}
                      </div>
                      <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                        {b.name}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {b.category} · {b.department}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="font-mono text-xs font-medium text-zinc-800 dark:text-zinc-200">
                        {b.period_code}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {formatDate(b.period_start)} – {formatDate(b.period_end)}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-xs text-zinc-800 dark:text-zinc-200">
                        {b.account_code
                          ? `${b.account_code}${b.account_label ? ` — ${b.account_label}` : ''}`
                          : 'General Category'}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {SPEND_SOURCE_LABELS[b.spend_source]} · Warn {b.warning_threshold_pct}% / Cap{' '}
                        {b.critical_threshold_pct}%
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-xs text-zinc-800 dark:text-zinc-200 whitespace-nowrap">
                      {formatCurrency(b.planned_amount)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-xs font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                      {formatCurrency(b.actual_amount)}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div
                        className={`font-mono tabular-nums text-xs font-semibold ${
                          b.remaining_amount >= 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-red-700 dark:text-red-400'
                        }`}
                      >
                        {formatCurrency(b.remaining_amount)}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-zinc-500">
                        {b.variance_amount > 0 ? '+' : ''}
                        {formatCurrency(b.variance_amount)} var.
                      </div>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap min-w-[130px]">
                      <div className="flex items-center justify-between gap-2 text-xs font-mono tabular-nums mb-1">
                        <span className="text-zinc-700 dark:text-zinc-300">
                          {b.utilization_pct.toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${barColor}`}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <StatusText status={b.alert_status} />
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap space-x-2">
                      <button
                        type="button"
                        onClick={() => setInspectedBudget(b)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 align-middle"
                      >
                        <Eye className="w-3 h-3" />
                        Inspect
                      </button>
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => openEditBudget(b)}
                          title="Edit budget"
                          aria-label={`Edit ${b.ref}`}
                          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center align-middle"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() =>
                            onPromptDelete(
                              `/api/finance/budgets/${b.id}`,
                              'Delete Fiscal Budget',
                              `${b.ref} — ${b.name}`
                            )
                          }
                          title="Delete budget"
                          aria-label={`Delete ${b.ref}`}
                          className="text-zinc-400 hover:text-red-600 inline-flex items-center align-middle"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Create / Edit Fiscal Budget Modal */}
      <Modal
        open={budgetModal}
        onClose={() => setBudgetModal(false)}
        title={editingBudget ? `Edit Budget ${editingBudget.ref}` : 'Create Fiscal Period Budget'}
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handleSaveBudget} className="space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Fiscal Period
              </label>
              <select
                value={bPeriodId}
                onChange={(e) => setBPeriodId(e.target.value)}
                required
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              >
                <option value="">Select period...</option>
                {(payload?.fiscalPeriods ?? []).map((fp) => (
                  <option key={fp.id} value={fp.id}>
                    {fp.code} — {fp.name} ({fp.status})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Department / Cost Center
              </label>
              <input
                type="text"
                value={bDepartment}
                onChange={(e) => setBDepartment(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Budget Allocation Name
            </label>
            <input
              type="text"
              value={bName}
              onChange={(e) => setBName(e.target.value)}
              required
              placeholder="e.g., Q4 Cloud Infrastructure & Hosting"
              className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Category
              </label>
              <input
                type="text"
                list="fiscal-budget-categories"
                value={bCategory}
                onChange={(e) => setBCategory(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              />
              <datalist id="fiscal-budget-categories">
                {BUDGET_CATEGORIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Linked GL Account (Optional)
              </label>
              <select
                value={bAccountCode}
                onChange={(e) => setBAccountCode(e.target.value)}
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              >
                <option value="">None (Match by Spend Source)</option>
                {expenseAccounts.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} — {a.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Actual Spend Tracking Source
              </label>
              <select
                value={bSource}
                onChange={(e) => setBSource(e.target.value as FiscalBudgetSpendSource)}
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              >
                {Object.entries(SPEND_SOURCE_LABELS).map(([k, lbl]) => (
                  <option key={k} value={k}>
                    {lbl}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Planned Budget Ceiling ($)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={bPlanned}
                onChange={(e) => setBPlanned(e.target.value)}
                required
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Warning Alert (%)
              </label>
              <input
                type="number"
                step="1"
                min="1"
                max="500"
                value={bWarnPct}
                onChange={(e) => setBWarnPct(e.target.value)}
                required
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Critical Cap (%)
              </label>
              <input
                type="number"
                step="1"
                min="1"
                max="500"
                value={bCritPct}
                onChange={(e) => setBCritPct(e.target.value)}
                required
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Manual Adj. ($)
              </label>
              <input
                type="number"
                step="0.01"
                value={bManualActual}
                onChange={(e) => setBManualActual(e.target.value)}
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Notes
            </label>
            <input
              type="text"
              value={bNotes}
              onChange={(e) => setBNotes(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setBudgetModal(false)}
              className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Budget'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Inspect Spend Breakdown Modal */}
      <Modal
        open={Boolean(inspectedBudget)}
        onClose={() => setInspectedBudget(null)}
        title={inspectedBudget ? `${inspectedBudget.ref} — Actual Spend Breakdown` : 'Budget Breakdown'}
        maxWidthClass="max-w-2xl"
      >
        {inspectedBudget && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <div className="text-zinc-500">Fiscal Period</div>
                <div className="font-mono font-medium text-zinc-900 dark:text-zinc-100 mt-0.5">
                  {inspectedBudget.period_code}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Planned Ceiling</div>
                <div className="font-mono font-medium text-zinc-900 dark:text-zinc-100 mt-0.5">
                  {formatCurrency(inspectedBudget.planned_amount)}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Actual Spend</div>
                <div className="font-mono font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5">
                  {formatCurrency(inspectedBudget.actual_amount)}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Variance</div>
                <div
                  className={`font-mono font-semibold mt-0.5 ${
                    inspectedBudget.variance_amount > 0
                      ? 'text-red-700 dark:text-red-400'
                      : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                >
                  {inspectedBudget.variance_amount > 0 ? '+' : ''}
                  {formatCurrency(inspectedBudget.variance_amount)} ({inspectedBudget.utilization_pct.toFixed(1)}%)
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50 dark:bg-zinc-950/60 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Source</th>
                    <th className="text-left px-3 py-2 font-medium">Ref</th>
                    <th className="text-left px-3 py-2 font-medium">Date</th>
                    <th className="text-left px-3 py-2 font-medium">Description</th>
                    <th className="text-right px-3 py-2 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {inspectedBudget.actual_breakdown.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                        No transactions or accruals recorded against this budget in {inspectedBudget.period_code} yet.
                      </td>
                    </tr>
                  ) : (
                    inspectedBudget.actual_breakdown.map((line, idx) => (
                      <tr key={`${line.ref}-${idx}`}>
                        <td className="px-3 py-2 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                          {line.sourceLabel}
                        </td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap text-zinc-900 dark:text-zinc-100">
                          {line.ref}
                        </td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                          {formatDate(line.date)}
                        </td>
                        <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                          {line.description}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                          {formatCurrency(line.amount)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setInspectedBudget(null)}
                className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs"
              >
                Close
              </button>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => {
                    const target = inspectedBudget;
                    setInspectedBudget(null);
                    openEditBudget(target);
                  }}
                  className="h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
                >
                  Edit Budget Cap
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

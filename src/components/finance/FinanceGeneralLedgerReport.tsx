import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, Download, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import type {
  AccountingAccount,
  GeneralLedgerEntryRow,
  GeneralLedgerEntryStatus,
  GeneralLedgerReportPayload,
} from '../../types/erp';
import { Modal } from '../Modal';
import { StatusText } from '../StatusText';
import { downloadCsvBlob } from './financeHelpers';

interface FinanceGeneralLedgerReportProps {
  canWrite: boolean;
  onReload: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

type AccountTypeFilter = 'all' | AccountingAccount['account_class'];
type EntryStatusFilter = 'all' | GeneralLedgerEntryStatus;
type ReportViewMode = 'lines' | 'entries' | 'accounts';

export function FinanceGeneralLedgerReport({
  canWrite,
  onReload,
  onNotify,
}: FinanceGeneralLedgerReportProps) {
  const [report, setReport] = useState<GeneralLedgerReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [exporting, setExporting] = useState(false);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [accountType, setAccountType] = useState<AccountTypeFilter>('all');
  const [accountCode, setAccountCode] = useState('all');
  const [entryStatus, setEntryStatus] = useState<EntryStatusFilter>('all');
  const [search, setSearch] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [viewMode, setViewMode] = useState<ReportViewMode>('lines');
  const [selectedEntry, setSelectedEntry] = useState<GeneralLedgerEntryRow | null>(null);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const qs = new URLSearchParams({
        dateFrom,
        dateTo,
        accountType,
        accountCode,
        entryStatus,
        search: search.trim(),
        sort: sortOrder,
      });
      const res = await apiRequest<GeneralLedgerReportPayload>(
        `/api/accounting/general-ledger?${qs.toString()}`
      );
      setReport(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to load General Ledger report.';
      setLoadError(msg);
      onNotify(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, accountType, accountCode, entryStatus, search, sortOrder, onNotify]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchReport();
    }, 150);
    return () => window.clearTimeout(timer);
  }, [fetchReport]);

  const availableAccounts = useMemo(() => {
    const list = report?.accounts ?? [];
    if (accountType === 'all') return list;
    return list.filter((a) => a.account_class === accountType);
  }, [report?.accounts, accountType]);

  function handleAccountTypeChange(nextType: AccountTypeFilter) {
    setAccountType(nextType);
    if (nextType !== 'all' && accountCode !== 'all') {
      const currentAcct = (report?.accounts ?? []).find((a) => a.code === accountCode);
      if (currentAcct && currentAcct.account_class !== nextType) {
        setAccountCode('all');
      }
    }
  }

  function resetFilters() {
    setDateFrom('');
    setDateTo('');
    setAccountType('all');
    setAccountCode('all');
    setEntryStatus('all');
    setSearch('');
  }

  async function handleExportCsv() {
    setExporting(true);
    try {
      const qs = new URLSearchParams({
        dateFrom,
        dateTo,
        accountType,
        accountCode,
        entryStatus,
        search: search.trim(),
        sort: sortOrder,
      });
      const res = await apiRequest<{ count: number; filename: string; csv: string }>(
        `/api/accounting/general-ledger/export?${qs.toString()}`
      );
      downloadCsvBlob(res.filename, res.csv);
      onNotify(`Exported ${res.count} General Ledger line(s) to CSV.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'General Ledger export failed.', 'error');
    } finally {
      setExporting(false);
    }
  }

  async function handleReverseEntry(entry: GeneralLedgerEntryRow) {
    try {
      await apiRequest(`/api/accounting/journal/${entry.id}/reverse`, { method: 'POST', body: {} });
      onNotify(`Reversal entry posted for ${entry.ref}.`);
      setSelectedEntry(null);
      await Promise.all([fetchReport(), onReload()]);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to reverse journal entry.', 'error');
    }
  }

  const summary = report?.summary ?? {
    entryCount: 0,
    lineCount: 0,
    totalDebits: 0,
    totalCredits: 0,
    netMovement: 0,
    isBalanced: true,
  };
  const entries = report?.entries ?? [];
  const lines = report?.lines ?? [];
  const accountSummary = report?.accountSummary ?? [];
  const entryById = useMemo(() => {
    const map = new Map<number, GeneralLedgerEntryRow>();
    for (const e of entries) map.set(e.id, e);
    return map;
  }, [entries]);

  const hasActiveFilters =
    Boolean(dateFrom) ||
    Boolean(dateTo) ||
    accountType !== 'all' ||
    accountCode !== 'all' ||
    entryStatus !== 'all' ||
    Boolean(search.trim());

  return (
    <div className="space-y-5">
      {/* 4-Column Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Matching Transactions
          </div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {summary.entryCount} · {summary.lineCount}
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Journal entries · GL posting lines
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Filtered Period Debits
          </div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatCurrency(summary.totalDebits)}
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Debit postings in current view
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Filtered Period Credits
          </div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatCurrency(summary.totalCredits)}
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Credit postings in current view
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Net Ledger Movement
          </div>
          <div
            className={`mt-1.5 text-2xl font-semibold font-mono tabular-nums ${
              summary.isBalanced
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-zinc-900 dark:text-zinc-100'
            }`}
          >
            {formatCurrency(summary.netMovement)}
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {accountType === 'all' && accountCode === 'all'
              ? summary.isBalanced
                ? 'Debits equal credits'
                : 'Unbalanced slice'
              : 'Net DR minus CR for filter'}
          </div>
        </div>
      </div>

      {/* Filter & View Mode Toolbar */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center p-1 rounded-lg bg-zinc-100 dark:bg-zinc-800/80">
            {(
              [
                { key: 'lines', label: `Ledger Lines (${lines.length})` },
                { key: 'entries', label: `Journal Entries (${entries.length})` },
                { key: 'accounts', label: `Account Rollup (${accountSummary.length})` },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setViewMode(item.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  viewMode === item.key
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
              >
                Clear Filters
              </button>
            )}

            <button
              type="button"
              onClick={() => setSortOrder((s) => (s === 'desc' ? 'asc' : 'desc'))}
              className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <ArrowDownUp className="w-3.5 h-3.5 shrink-0" />
              <span>{sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}</span>
            </button>

            <button
              type="button"
              onClick={fetchReport}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>

            <button
              type="button"
              disabled={exporting || lines.length === 0}
              onClick={handleExportCsv}
              className="px-3.5 py-1.5 rounded-lg bg-orange-700 hover:bg-orange-800 disabled:opacity-50 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span>{exporting ? 'Exporting...' : 'Export CSV'}</span>
            </button>
          </div>
        </div>

        {/* Date, Account Type, Account, Entry Status & Search Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <div>
            <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              From Date
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="Filter from date"
              className="w-full h-8 px-2.5 text-xs font-mono tabular-nums rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              To Date
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="Filter to date"
              className="w-full h-8 px-2.5 text-xs font-mono tabular-nums rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              Account Type
            </label>
            <select
              value={accountType}
              onChange={(e) => handleAccountTypeChange(e.target.value as AccountTypeFilter)}
              aria-label="Filter by account type"
              className="w-full h-8 px-2.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
            >
              <option value="all">All Account Types</option>
              <option value="asset">Asset</option>
              <option value="liability">Liability</option>
              <option value="equity">Equity</option>
              <option value="revenue">Revenue</option>
              <option value="expense">Expense</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              GL Account
            </label>
            <select
              value={accountCode}
              onChange={(e) => setAccountCode(e.target.value)}
              aria-label="Filter by GL account"
              className="w-full h-8 px-2.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
            >
              <option value="all">All GL Accounts</option>
              {availableAccounts.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} · {a.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              Entry Status
            </label>
            <select
              value={entryStatus}
              onChange={(e) => setEntryStatus(e.target.value as EntryStatusFilter)}
              aria-label="Filter by entry status"
              className="w-full h-8 px-2.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
            >
              <option value="all">All Entry Statuses</option>
              <option value="posted">Posted</option>
              <option value="reversal">Reversal</option>
              <option value="reversed">Reversed</option>
              <option value="locked">Locked (Closed Period)</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              Search Ledger
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-2.5 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ref, memo, source, project..."
                className="w-full h-8 pl-8 pr-2.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Report Data Table */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        {loadError && !loading ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-red-700 dark:text-red-400">{loadError}</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Unable to retrieve General Ledger transactions from the server.
            </p>
            <button
              type="button"
              onClick={fetchReport}
              className="mt-4 px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium whitespace-nowrap shrink-0"
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-11 px-4 flex items-center gap-4 animate-pulse">
                <div className="h-3 w-24 bg-zinc-200 dark:bg-zinc-800 rounded" />
                <div className="h-3 w-36 bg-zinc-200 dark:bg-zinc-800 rounded" />
                <div className="h-3 flex-1 bg-zinc-100 dark:bg-zinc-800/70 rounded" />
                <div className="h-3 w-20 bg-zinc-200 dark:bg-zinc-800 rounded" />
              </div>
            ))}
          </div>
        ) : viewMode === 'accounts' ? (
          accountSummary.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                No GL accounts match the selected filters
              </p>
              <button
                type="button"
                onClick={resetFilters}
                className="mt-4 px-3.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500 dark:text-zinc-400">
                    <th className="py-2.5 px-4 font-medium">Account</th>
                    <th className="py-2.5 px-4 font-medium">Type</th>
                    <th className="py-2.5 px-4 font-medium text-right">Entries</th>
                    <th className="py-2.5 px-4 font-medium text-right">Period Debits</th>
                    <th className="py-2.5 px-4 font-medium text-right">Period Credits</th>
                    <th className="py-2.5 px-4 font-medium text-right">Net Activity</th>
                    <th className="py-2.5 px-4 font-medium text-right">Current Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {accountSummary.map((a) => (
                    <tr
                      key={a.code}
                      onClick={() => {
                        setAccountCode(a.code);
                        setViewMode('lines');
                      }}
                      className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
                    >
                      <td className="py-2.5 px-4">
                        <span className="font-mono font-medium text-orange-700 dark:text-orange-400 mr-2">
                          {a.code}
                        </span>
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">{a.label}</span>
                      </td>
                      <td className="py-2.5 px-4 capitalize text-zinc-600 dark:text-zinc-400">
                        {a.account_class}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-right text-zinc-600 dark:text-zinc-400">
                        {a.tx_count}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-right">
                        {a.period_debits > 0 ? formatCurrency(a.period_debits) : '—'}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-right">
                        {a.period_credits > 0 ? formatCurrency(a.period_credits) : '—'}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-right font-medium">
                        {formatCurrency(a.net_change)}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-right font-semibold text-zinc-900 dark:text-zinc-100">
                        {formatCurrency(a.current_balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (viewMode === 'lines' ? lines.length === 0 : entries.length === 0) ? (
          <div className="p-12 text-center">
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              No General Ledger transactions match the active filters
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Adjust your date range, account type, or entry status filter to view ledger activity.
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="mt-4 px-3.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
            >
              Reset Filters
            </button>
          </div>
        ) : viewMode === 'lines' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500 dark:text-zinc-400">
                  <th className="py-2.5 px-4 font-medium">Date · Ref</th>
                  <th className="py-2.5 px-4 font-medium">GL Account · Type</th>
                  <th className="py-2.5 px-4 font-medium">Description · Counterpart</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium text-right">Debit</th>
                  <th className="py-2.5 px-4 font-medium text-right">Credit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {lines.map((line) => (
                  <tr
                    key={line.line_id}
                    onClick={() => setSelectedEntry(entryById.get(line.entry_id) ?? null)}
                    className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
                  >
                    <td className="py-2.5 px-4 font-mono tabular-nums whitespace-nowrap">
                      <div className="text-zinc-900 dark:text-zinc-100">{formatDate(line.entry_date)}</div>
                      <div className="text-[11px] text-orange-700 dark:text-orange-400">
                        {line.ref} · {line.journal_code}
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">
                        <span className="font-mono text-orange-700 dark:text-orange-400 mr-1.5">
                          {line.account_code}
                        </span>
                        {line.account_label}
                      </div>
                      <div className="text-[11px] capitalize text-zinc-500 dark:text-zinc-400">
                        {line.account_class}
                        {line.fiscal_period_code ? ` · ${line.fiscal_period_code}` : ''}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 max-w-md">
                      <div className="text-zinc-800 dark:text-zinc-200 truncate">{line.description}</div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                        Offset {line.counterpart_code} {line.counterpart_label}
                        {line.project_ref ? ` · ${line.project_ref}` : ''}
                        {line.source_ref ? ` · ${line.source_ref}` : ''}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <StatusText status={line.entry_status} />
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                      {line.debit > 0 ? formatCurrency(line.debit) : '—'}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                      {line.credit > 0 ? formatCurrency(line.credit) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-semibold">
                  <td colSpan={4} className="py-2.5 px-4 text-zinc-700 dark:text-zinc-300">
                    Filtered Ledger Totals ({lines.length} lines)
                  </td>
                  <td className="py-2.5 px-4 font-mono tabular-nums text-right">
                    {formatCurrency(summary.totalDebits)}
                  </td>
                  <td className="py-2.5 px-4 font-mono tabular-nums text-right">
                    {formatCurrency(summary.totalCredits)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500 dark:text-zinc-400">
                  <th className="py-2.5 px-4 font-medium">Date · Ref</th>
                  <th className="py-2.5 px-4 font-medium">Description · Source</th>
                  <th className="py-2.5 px-4 font-medium">Debit Account</th>
                  <th className="py-2.5 px-4 font-medium">Credit Account</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {entries.map((e) => (
                  <tr
                    key={e.id}
                    onClick={() => setSelectedEntry(e)}
                    className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
                  >
                    <td className="py-2.5 px-4 font-mono tabular-nums whitespace-nowrap">
                      <div className="text-zinc-900 dark:text-zinc-100">{formatDate(e.entry_date)}</div>
                      <div className="text-[11px] text-orange-700 dark:text-orange-400">
                        {e.ref} · {e.journal_code}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 max-w-sm">
                      <div className="text-zinc-900 dark:text-zinc-100 truncate">{e.description}</div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                        {e.project_ref ? `${e.project_ref} · ` : ''}
                        {e.source_ref || e.created_by || 'Manual journal'}
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-mono text-zinc-900 dark:text-zinc-100">
                        {e.debit_account_code} · {e.debit_account_label}
                      </div>
                      <div className="text-[11px] capitalize text-zinc-500">{e.debit_account_class}</div>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-mono text-zinc-900 dark:text-zinc-100">
                        {e.credit_account_code} · {e.credit_account_label}
                      </div>
                      <div className="text-[11px] capitalize text-zinc-500">{e.credit_account_class}</div>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <StatusText status={e.entry_status} />
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right font-semibold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                      {formatCurrency(e.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Journal Transaction Inspection Modal */}
      <Modal
        open={Boolean(selectedEntry)}
        onClose={() => setSelectedEntry(null)}
        title={selectedEntry ? `Journal Entry ${selectedEntry.ref}` : ''}
        subtitle={
          selectedEntry
            ? `${formatDate(selectedEntry.entry_date)} · ${selectedEntry.journal_code}${
                selectedEntry.fiscal_period_code ? ` · ${selectedEntry.fiscal_period_code}` : ''
              }`
            : ''
        }
      >
        {selectedEntry && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-4 pb-4 border-b border-zinc-200 dark:border-zinc-800">
              <div>
                <div className="text-zinc-500 dark:text-zinc-400">Entry Status</div>
                <div className="mt-1">
                  <StatusText status={selectedEntry.entry_status} />
                </div>
              </div>
              <div>
                <div className="text-zinc-500 dark:text-zinc-400">Transaction Amount</div>
                <div className="mt-1 text-sm font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatCurrency(selectedEntry.amount)}
                </div>
              </div>
              <div>
                <div className="text-zinc-500 dark:text-zinc-400">Debit Account</div>
                <div className="mt-0.5 font-medium text-zinc-900 dark:text-zinc-100">
                  <span className="font-mono text-orange-700 dark:text-orange-400 mr-1">
                    {selectedEntry.debit_account_code}
                  </span>
                  {selectedEntry.debit_account_label}
                </div>
                <div className="text-[11px] capitalize text-zinc-500">
                  {selectedEntry.debit_account_class}
                </div>
              </div>
              <div>
                <div className="text-zinc-500 dark:text-zinc-400">Credit Account</div>
                <div className="mt-0.5 font-medium text-zinc-900 dark:text-zinc-100">
                  <span className="font-mono text-orange-700 dark:text-orange-400 mr-1">
                    {selectedEntry.credit_account_code}
                  </span>
                  {selectedEntry.credit_account_label}
                </div>
                <div className="text-[11px] capitalize text-zinc-500">
                  {selectedEntry.credit_account_class}
                </div>
              </div>
            </div>

            <div>
              <div className="text-zinc-500 dark:text-zinc-400 mb-1">Description</div>
              <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200">
                {selectedEntry.description}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">
              <div>Source: {selectedEntry.source_ref || 'Manual posting'}</div>
              <div>Project: {selectedEntry.project_ref || 'Unassigned'}</div>
              <div>Posted by: {selectedEntry.created_by || 'system'}</div>
              <div>
                {selectedEntry.reversed_entry_ref
                  ? `Reverses: ${selectedEntry.reversed_entry_ref}`
                  : `Period: ${selectedEntry.fiscal_period_status}`}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              {canWrite && selectedEntry.entry_status === 'posted' && (
                <button
                  type="button"
                  onClick={() => handleReverseEntry(selectedEntry)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs font-medium hover:bg-amber-50 dark:hover:bg-amber-950/40 whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                  <span>Post Reversal</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedEntry(null)}
                className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium whitespace-nowrap shrink-0"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

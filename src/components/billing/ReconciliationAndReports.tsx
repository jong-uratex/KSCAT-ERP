import { useMemo, useState } from 'react';
import { CheckCircle2, Download, Link2, Pencil, RotateCcw, Search, Trash2 } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import type {
  AccountingAccount,
  AccountingReports,
  BankAccount,
  BankTransaction,
  Invoice,
} from '../../types/erp';
import { StatusText } from '../StatusText';

interface ReconciliationPanelProps {
  accounts: BankAccount[];
  transactions: BankTransaction[];
  invoices: Invoice[];
  glAccounts: AccountingAccount[];
  canRecordPay: boolean;
  canDelete: boolean;
  onEditTx: (tx: BankTransaction) => void;
  onPromptDeleteTx: (tx: BankTransaction) => void;
  onReload: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export function BankReconciliationPanel({
  accounts,
  transactions,
  invoices,
  glAccounts,
  canRecordPay,
  canDelete,
  onEditTx,
  onPromptDeleteTx,
  onReload,
  onNotify,
}: ReconciliationPanelProps) {
  const [filter, setFilter] = useState<'unreconciled' | 'reconciled' | 'all'>('unreconciled');
  const [query, setQuery] = useState('');
  const [matchSelections, setMatchSelections] = useState<Record<number, { mode: 'invoice' | 'gl'; value: string }>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  const openInvoices = useMemo(
    () => invoices.filter((i) => i.status === 'validated' || i.status === 'partial'),
    [invoices]
  );

  const unreconciledList = transactions.filter((t) => !t.reconciled);
  const reconciledList = transactions.filter((t) => Boolean(t.reconciled));
  const totalCash = accounts.filter((a) => a.status === 'active').reduce((s, a) => s + a.balance, 0);

  const visibleTransactions = useMemo(() => {
    const base =
      filter === 'unreconciled'
        ? unreconciledList
        : filter === 'reconciled'
          ? reconciledList
          : transactions;
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (t) =>
        t.label.toLowerCase().includes(q) ||
        t.account_name.toLowerCase().includes(q) ||
        (t.invoice_ref || '').toLowerCase().includes(q) ||
        (t.category || '').toLowerCase().includes(q)
    );
  }, [filter, query, reconciledList, transactions, unreconciledList]);

  function findSuggestedInvoice(tx: BankTransaction): Invoice | undefined {
    const targetType = tx.direction === 'credit' ? 'customer' : 'supplier';
    const candidates = openInvoices.filter((i) => i.invoice_type === targetType);
    const byRef = candidates.find((i) => tx.label.toUpperCase().includes(i.ref.toUpperCase()));
    if (byRef) return byRef;
    return candidates.find((i) => {
      const rem = Math.round((i.total_ttc - i.amount_paid) * 100) / 100;
      return Math.abs(rem - tx.amount) < 0.05;
    });
  }

  function getSelection(tx: BankTransaction): { mode: 'invoice' | 'gl'; value: string } {
    if (matchSelections[tx.id]) return matchSelections[tx.id];
    const suggested = findSuggestedInvoice(tx);
    if (suggested) return { mode: 'invoice', value: String(suggested.id) };
    const defaultGl = glAccounts.find((g) => g.code !== '1010')?.code ?? glAccounts[0]?.code ?? '';
    return { mode: 'gl', value: defaultGl };
  }

  function setSelection(txId: number, next: { mode: 'invoice' | 'gl'; value: string }) {
    setMatchSelections((prev) => ({ ...prev, [txId]: next }));
  }

  async function handleReconcile(tx: BankTransaction) {
    const sel = getSelection(tx);
    if (!sel.value) {
      onNotify('Select an invoice, bill, or GL account before reconciling.', 'error');
      return;
    }
    setBusyId(tx.id);
    try {
      await apiRequest(`/api/bank-transactions/${tx.id}/reconcile`, {
        method: 'POST',
        body:
          sel.mode === 'invoice'
            ? { invoiceId: Number(sel.value) }
            : { glAccountCode: sel.value, memo: tx.label },
      });
      onNotify(`Reconciled "${tx.label}".`);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to reconcile transaction.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleUnreconcile(tx: BankTransaction) {
    setBusyId(tx.id);
    try {
      await apiRequest(`/api/bank-transactions/${tx.id}/unreconcile`, {
        method: 'POST',
        body: {},
      });
      onNotify(`Moved "${tx.label}" back to Needs Review.`);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to unreconcile transaction.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">Total Treasury Cash</div>
          <div className="mt-1.5 text-xl font-mono tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
            {formatCurrency(totalCash)}
          </div>
          <div className="mt-1 text-xs text-zinc-500">{accounts.length} linked account(s)</div>
        </div>
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">Items to Reconcile</div>
          <div className="mt-1.5 text-xl font-mono tabular-nums font-semibold text-amber-700 dark:text-amber-400">
            {unreconciledList.length}
          </div>
          <div className="mt-1 text-xs text-zinc-500">Unmatched bank statement lines</div>
        </div>
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">Reconciled Entries</div>
          <div className="mt-1.5 text-xl font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
            {reconciledList.length}
          </div>
          <div className="mt-1 text-xs text-zinc-500">Matched to invoices or GL</div>
        </div>
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">Open AR/AP Candidates</div>
          <div className="mt-1.5 text-xl font-mono tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
            {openInvoices.length}
          </div>
          <div className="mt-1 text-xs text-zinc-500">Awaiting statement match</div>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mr-2">
              Bank Feed Reconciliation
            </h3>
            {(['unreconciled', 'reconciled', 'all'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap ${
                  filter === key
                    ? 'bg-orange-700 text-white'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                }`}
              >
                {key === 'unreconciled'
                  ? `Needs Review (${unreconciledList.length})`
                  : key === 'reconciled'
                    ? `Reconciled (${reconciledList.length})`
                    : `All Lines (${transactions.length})`}
              </button>
            ))}
          </div>

          <div className="relative w-full md:w-64">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search statement lines..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
        </div>

        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {visibleTransactions.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500">
              {filter === 'unreconciled'
                ? 'All bank feed transactions are reconciled.'
                : 'No bank statement lines match your filter.'}
            </div>
          ) : (
            visibleTransactions.map((tx) => {
              const isReconciled = Boolean(tx.reconciled);
              const targetType = tx.direction === 'credit' ? 'customer' : 'supplier';
              const compatibleDocs = openInvoices.filter((i) => i.invoice_type === targetType);
              const suggested = !isReconciled ? findSuggestedInvoice(tx) : undefined;
              const sel = getSelection(tx);

              return (
                <div
                  key={tx.id}
                  className="p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4 hover:bg-zinc-50/70 dark:hover:bg-zinc-800/30"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="font-mono text-xs text-zinc-500">{formatDate(tx.tx_date)}</span>
                      <span className="font-mono text-xs font-medium text-orange-700 dark:text-orange-400">
                        {tx.account_ref}
                      </span>
                      <StatusText status={isReconciled ? 'reconciled' : 'unreconciled'} />
                      {tx.invoice_ref && (
                        <span className="text-xs font-mono text-emerald-700 dark:text-emerald-400">
                          Matched: {tx.invoice_ref}
                        </span>
                      )}
                      {tx.gl_account_code && (
                        <span className="text-xs font-mono text-zinc-500">GL {tx.gl_account_code}</span>
                      )}
                    </div>
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{tx.label}</div>
                    <div className="text-xs text-zinc-500">
                      {tx.account_name} · {tx.category}
                      {suggested && !isReconciled && (
                        <span className="ml-2 text-emerald-700 dark:text-emerald-400 font-medium">
                          Suggested match: {suggested.ref} ({suggested.party_name})
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 shrink-0">
                    <div
                      className={`text-sm font-mono tabular-nums font-semibold w-28 text-right ${
                        tx.direction === 'credit'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-red-700 dark:text-red-400'
                      }`}
                    >
                      {tx.direction === 'credit' ? '+' : '-'}
                      {formatCurrency(tx.amount)}
                    </div>

                    {!isReconciled && canRecordPay && (
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          aria-label={`Reconciliation mode for ${tx.label}`}
                          value={sel.mode}
                          onChange={(e) => {
                            const nextMode = e.target.value as 'invoice' | 'gl';
                            const nextVal =
                              nextMode === 'invoice'
                                ? compatibleDocs[0]
                                  ? String(compatibleDocs[0].id)
                                  : ''
                                : glAccounts.find((g) => g.code !== '1010')?.code ?? '';
                            setSelection(tx.id, { mode: nextMode, value: nextVal });
                          }}
                          className="px-2.5 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                        >
                          <option value="invoice">
                            Match {tx.direction === 'credit' ? 'Invoice' : 'Bill'}
                          </option>
                          <option value="gl">Categorize to GL</option>
                        </select>

                        {sel.mode === 'invoice' ? (
                          <select
                            aria-label={`Select document for ${tx.label}`}
                            value={sel.value}
                            onChange={(e) => setSelection(tx.id, { mode: 'invoice', value: e.target.value })}
                            className="px-2.5 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 max-w-[230px]"
                          >
                            {compatibleDocs.length === 0 ? (
                              <option value="">No open {targetType === 'customer' ? 'invoices' : 'bills'}</option>
                            ) : (
                              compatibleDocs.map((doc) => {
                                const rem = Math.max(0, doc.total_ttc - doc.amount_paid);
                                return (
                                  <option key={doc.id} value={doc.id}>
                                    {doc.ref} · {doc.party_name} ({formatCurrency(rem)})
                                  </option>
                                );
                              })
                            )}
                          </select>
                        ) : (
                          <select
                            aria-label={`Select GL account for ${tx.label}`}
                            value={sel.value}
                            onChange={(e) => setSelection(tx.id, { mode: 'gl', value: e.target.value })}
                            className="px-2.5 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 max-w-[230px]"
                          >
                            {glAccounts
                              .filter((g) => g.code !== '1010')
                              .map((g) => (
                                <option key={g.id} value={g.code}>
                                  {g.code} — {g.label}
                                </option>
                              ))}
                          </select>
                        )}

                        <button
                          type="button"
                          disabled={busyId === tx.id || !sel.value}
                          onClick={() => handleReconcile(tx)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                          <span>{busyId === tx.id ? 'Posting...' : 'Reconcile'}</span>
                        </button>
                      </div>
                    )}

                    {isReconciled && canRecordPay && (
                      <button
                        type="button"
                        disabled={busyId === tx.id}
                        onClick={() => handleUnreconcile(tx)}
                        className="px-2.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Unmatch</span>
                      </button>
                    )}

                    <div className="flex items-center gap-2">
                      {canRecordPay && (
                        <button
                          type="button"
                          onClick={() => onEditTx(tx)}
                          title="Edit bank transaction"
                          aria-label={`Edit ${tx.label}`}
                          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => onPromptDeleteTx(tx)}
                          title="Delete bank transaction"
                          aria-label={`Delete ${tx.label}`}
                          className="text-zinc-400 hover:text-red-600"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

interface FinancialReportsPanelProps {
  reports: AccountingReports | null;
  marginStats: {
    revenue_ht: number;
    credit_notes_ht: number;
    purchases_ht: number;
    vat_collected: number;
    vat_deductible: number;
  };
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export function FinancialReportsPanel({ reports, marginStats, onNotify }: FinancialReportsPanelProps) {
  const [reportTab, setReportTab] = useState<'pnl' | 'balance_sheet' | 'trial_balance' | 'aging' | 'vat'>('pnl');
  const [exporting, setExporting] = useState(false);

  const netSalesHt = marginStats.revenue_ht - marginStats.credit_notes_ht;
  const grossMargin = netSalesHt - marginStats.purchases_ht;
  const marginPct = netSalesHt > 0 ? Math.round((grossMargin / netSalesHt) * 1000) / 10 : 0;

  async function handleExport(type: 'pnl' | 'balance_sheet' | 'trial_balance' | 'aging') {
    setExporting(true);
    try {
      const res = await apiRequest<{ type: string; csv: string }>(`/api/accounting/reports/export?type=${type}`);
      const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kscat-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      onNotify(`Exported ${type.replace('_', ' ')} CSV report.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to export report.', 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-zinc-200/70 dark:bg-zinc-800 self-start">
          {[
            { key: 'pnl', label: 'Profit & Loss' },
            { key: 'balance_sheet', label: 'Balance Sheet' },
            { key: 'trial_balance', label: 'Trial Balance' },
            { key: 'aging', label: 'Aged AR & AP' },
            { key: 'vat', label: 'Tax & Margins' },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setReportTab(item.key as typeof reportTab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
                reportTab === item.key
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {reportTab !== 'vat' && (
          <button
            type="button"
            disabled={exporting || !reports}
            onClick={() => handleExport(reportTab)}
            className="px-3.5 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{exporting ? 'Exporting...' : 'Export CSV'}</span>
          </button>
        )}
      </div>

      {!reports ? (
        <div className="p-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-center text-xs text-zinc-500">
          Computing financial statements from General Ledger...
        </div>
      ) : reportTab === 'pnl' ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Profit & Loss (Income Statement)
              </h3>
              <p className="text-xs text-zinc-500">Live General Ledger operating performance</p>
            </div>
            <div className="text-right">
              <div className="text-xs text-zinc-500">Net Profit / (Loss)</div>
              <div
                className={`text-lg font-mono tabular-nums font-semibold ${
                  reports.pnl.netIncome >= 0
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-red-700 dark:text-red-400'
                }`}
              >
                {formatCurrency(reports.pnl.netIncome)}
              </div>
            </div>
          </div>

          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            <div className="p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-3">
                Operating Revenue & Income
              </div>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {reports.pnl.revenueAccounts.map((a) => (
                    <tr key={a.id}>
                      <td className="py-2 font-mono text-orange-700 dark:text-orange-400 w-24">{a.code}</td>
                      <td className="py-2 text-zinc-800 dark:text-zinc-200">{a.label}</td>
                      <td className="py-2 font-mono tabular-nums text-right font-medium">
                        {formatCurrency(a.balance)}
                      </td>
                    </tr>
                  ))}
                  <tr className="font-semibold text-zinc-900 dark:text-zinc-100">
                    <td className="pt-3" colSpan={2}>
                      Total Income
                    </td>
                    <td className="pt-3 font-mono tabular-nums text-right">
                      {formatCurrency(reports.pnl.totalRevenue)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-3">
                Cost of Sales & Operating Expenses
              </div>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {reports.pnl.expenseAccounts.map((a) => (
                    <tr key={a.id}>
                      <td className="py-2 font-mono text-orange-700 dark:text-orange-400 w-24">{a.code}</td>
                      <td className="py-2 text-zinc-800 dark:text-zinc-200">{a.label}</td>
                      <td className="py-2 font-mono tabular-nums text-right font-medium">
                        {formatCurrency(a.balance)}
                      </td>
                    </tr>
                  ))}
                  <tr className="font-semibold text-zinc-900 dark:text-zinc-100">
                    <td className="pt-3" colSpan={2}>
                      Total Expenses
                    </td>
                    <td className="pt-3 font-mono tabular-nums text-right">
                      {formatCurrency(reports.pnl.totalExpenses)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : reportTab === 'balance_sheet' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Assets</h3>
              <span className="font-mono tabular-nums text-sm font-semibold">
                {formatCurrency(reports.balanceSheet.totalAssets)}
              </span>
            </div>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {reports.balanceSheet.assetAccounts.map((a) => (
                  <tr key={a.id}>
                    <td className="py-2.5 px-4 font-mono text-orange-700 dark:text-orange-400 w-24">{a.code}</td>
                    <td className="py-2.5 px-4 text-zinc-800 dark:text-zinc-200">{a.label}</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right font-medium">
                      {formatCurrency(a.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Liabilities & Equity</h3>
              <span className="font-mono tabular-nums text-sm font-semibold">
                {formatCurrency(
                  reports.balanceSheet.totalLiabilities +
                    reports.balanceSheet.totalEquity +
                    reports.balanceSheet.currentYearNetIncome
                )}
              </span>
            </div>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {reports.balanceSheet.liabilityAccounts.map((a) => (
                  <tr key={a.id}>
                    <td className="py-2.5 px-4 font-mono text-orange-700 dark:text-orange-400 w-24">{a.code}</td>
                    <td className="py-2.5 px-4 text-zinc-800 dark:text-zinc-200">{a.label}</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right font-medium">
                      {formatCurrency(a.balance)}
                    </td>
                  </tr>
                ))}
                {reports.balanceSheet.equityAccounts.map((a) => (
                  <tr key={a.id}>
                    <td className="py-2.5 px-4 font-mono text-orange-700 dark:text-orange-400 w-24">{a.code}</td>
                    <td className="py-2.5 px-4 text-zinc-800 dark:text-zinc-200">{a.label}</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right font-medium">
                      {formatCurrency(a.balance)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-zinc-50/70 dark:bg-zinc-950/40 font-medium">
                  <td className="py-2.5 px-4 font-mono text-zinc-500">NET</td>
                  <td className="py-2.5 px-4 text-zinc-900 dark:text-zinc-100">Current Period Earnings</td>
                  <td className="py-2.5 px-4 font-mono tabular-nums text-right">
                    {formatCurrency(reports.balanceSheet.currentYearNetIncome)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : reportTab === 'trial_balance' ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Trial Balance</h3>
            <div className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Double-entry GL verified</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                  <th className="py-2.5 px-4 font-medium">Code</th>
                  <th className="py-2.5 px-4 font-medium">Account</th>
                  <th className="py-2.5 px-4 font-medium">Class</th>
                  <th className="py-2.5 px-4 font-medium text-right">Debit</th>
                  <th className="py-2.5 px-4 font-medium text-right">Credit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {reports.trialBalance.rows.map((r) => (
                  <tr key={r.code}>
                    <td className="py-2.5 px-4 font-mono text-orange-700 dark:text-orange-400">{r.code}</td>
                    <td className="py-2.5 px-4 font-medium text-zinc-900 dark:text-zinc-100">{r.label}</td>
                    <td className="py-2.5 px-4 capitalize text-zinc-500">{r.account_class}</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right">
                      {r.debit > 0 ? formatCurrency(r.debit) : '—'}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right">
                      {r.credit > 0 ? formatCurrency(r.credit) : '—'}
                    </td>
                  </tr>
                ))}
                <tr className="bg-zinc-50/80 dark:bg-zinc-950/50 font-semibold text-zinc-900 dark:text-zinc-100">
                  <td className="py-3 px-4" colSpan={3}>
                    Totals
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-right">
                    {formatCurrency(reports.trialBalance.totalDebits)}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-right">
                    {formatCurrency(reports.trialBalance.totalCredits)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : reportTab === 'aging' ? (
        <div className="space-y-5">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Aged Receivables & Payables Summary
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-2.5 px-4 font-medium">Ledger</th>
                    <th className="py-2.5 px-4 font-medium text-right">Current</th>
                    <th className="py-2.5 px-4 font-medium text-right">1–30 Days</th>
                    <th className="py-2.5 px-4 font-medium text-right">31–60 Days</th>
                    <th className="py-2.5 px-4 font-medium text-right">61+ Days</th>
                    <th className="py-2.5 px-4 font-medium text-right">Total Open</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {[
                    { label: 'Accounts Receivable (Customer Invoices)', b: reports.aging.receivables },
                    { label: 'Accounts Payable (Supplier Bills)', b: reports.aging.payables },
                  ].map((row) => (
                    <tr key={row.label}>
                      <td className="py-3 px-4 font-medium text-zinc-900 dark:text-zinc-100">{row.label}</td>
                      <td className="py-3 px-4 font-mono tabular-nums text-right">{formatCurrency(row.b.current)}</td>
                      <td className="py-3 px-4 font-mono tabular-nums text-right">{formatCurrency(row.b.d1_30)}</td>
                      <td className="py-3 px-4 font-mono tabular-nums text-right">{formatCurrency(row.b.d31_60)}</td>
                      <td className="py-3 px-4 font-mono tabular-nums text-right text-red-700 dark:text-red-400">
                        {formatCurrency(row.b.d61_plus)}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-right font-semibold">
                        {formatCurrency(row.b.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Overdue Items</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-2.5 px-4 font-medium">Ref</th>
                    <th className="py-2.5 px-4 font-medium">Counterparty</th>
                    <th className="py-2.5 px-4 font-medium">Type</th>
                    <th className="py-2.5 px-4 font-medium">Due Date</th>
                    <th className="py-2.5 px-4 font-medium text-right">Days Overdue</th>
                    <th className="py-2.5 px-4 font-medium text-right">Balance Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {reports.aging.overdueItems.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-zinc-500">
                        No overdue invoices or bills.
                      </td>
                    </tr>
                  ) : (
                    reports.aging.overdueItems.map((item) => (
                      <tr key={item.id}>
                        <td className="py-2.5 px-4 font-mono text-orange-700 dark:text-orange-400">{item.ref}</td>
                        <td className="py-2.5 px-4 font-medium text-zinc-900 dark:text-zinc-100">{item.party_name}</td>
                        <td className="py-2.5 px-4 capitalize text-zinc-500">{item.invoice_type}</td>
                        <td className="py-2.5 px-4 font-mono text-zinc-500">{formatDate(item.due_date)}</td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-right text-red-700 dark:text-red-400">
                          {item.days_overdue}d
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-right font-semibold">
                          {formatCurrency(item.balance_due)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <div className="text-xs text-zinc-500">Net Sales Revenue (HT)</div>
            <div className="mt-2 text-2xl font-mono tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
              {formatCurrency(netSalesHt)}
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              Credit Notes deducted: {formatCurrency(marginStats.credit_notes_ht)}
            </div>
          </div>
          <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <div className="text-xs text-zinc-500">Supplier Purchases (HT)</div>
            <div className="mt-2 text-2xl font-mono tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
              {formatCurrency(marginStats.purchases_ht)}
            </div>
            <div className="mt-1 text-xs text-zinc-500">Direct procurement cost</div>
          </div>
          <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <div className="text-xs text-zinc-500">Commercial Gross Margin</div>
            <div
              className={`mt-2 text-2xl font-mono tabular-nums font-semibold ${
                grossMargin >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
              }`}
            >
              {formatCurrency(grossMargin)}
            </div>
            <div className="mt-1 text-xs font-mono text-zinc-500">Margin Rate: {marginPct}%</div>
          </div>
          <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <div className="text-xs text-zinc-500">Net VAT / Sales Tax Position</div>
            <div className="mt-2 text-2xl font-mono tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
              {formatCurrency(reports.vatSummary.netVatPayable)}
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              Collected {formatCurrency(reports.vatSummary.vatCollected)} − Deductible{' '}
              {formatCurrency(reports.vatSummary.vatDeductible)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

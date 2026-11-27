import { useMemo, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  CreditCard,
  FileText,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import type {
  AgingBucketSummary,
  BankAccount,
  CurrencyRateItem,
  DocumentLine,
  Invoice,
  ProductItem,
  Project,
  RecurringInvoiceItem,
  TaxRateItem,
  ThirdParty,
} from '../../types/erp';
import { Modal } from '../Modal';
import { StatusText } from '../StatusText';
import { downloadInvoiceStatement, formatMoneyWithCode, parseDocumentLines } from './financeHelpers';

interface FinanceInvoicesSectionProps {
  mode: 'customer' | 'supplier';
  invoices: Invoice[];
  recurringInvoices: RecurringInvoiceItem[];
  agingSummary: AgingBucketSummary;
  bankAccounts: BankAccount[];
  thirdParties: ThirdParty[];
  products: ProductItem[];
  projects: Project[];
  currencies: CurrencyRateItem[];
  taxRates: TaxRateItem[];
  canWrite: boolean;
  canValidate: boolean;
  canRecordPay: boolean;
  canDelete: boolean;
  onReload: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPromptDelete: (url: string, title: string, itemLabel: string, warning?: string) => void;
}

export function FinanceInvoicesSection({
  mode,
  invoices,
  recurringInvoices,
  agingSummary,
  bankAccounts,
  thirdParties,
  products,
  projects,
  currencies,
  taxRates,
  canWrite,
  canValidate,
  canRecordPay,
  canDelete,
  onReload,
  onNotify,
  onPromptDelete,
}: FinanceInvoicesSectionProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [showRecurring, setShowRecurring] = useState(false);

  // Payment modal
  const [paymentModal, setPaymentModal] = useState<Invoice | null>(null);
  const [payAccountId, setPayAccountId] = useState(bankAccounts[0] ? String(bankAccounts[0].id) : '');
  const [payAmount, setPayAmount] = useState('');
  const [payLabel, setPayLabel] = useState('');

  // Invoice Create / Edit modal
  const [invoiceModal, setInvoiceModal] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [invKind, setInvKind] = useState<'standard' | 'credit_note'>('standard');
  const [invPartyId, setInvPartyId] = useState('');
  const [invProjectId, setInvProjectId] = useState('');
  const [invCurrency, setInvCurrency] = useState('USD');
  const [invFxRate, setInvFxRate] = useState('1');
  const [invIssueDate, setInvIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [invDueDate, setInvDueDate] = useState(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  const [invStatus, setInvStatus] = useState<Invoice['status']>('draft');
  const [invLines, setInvLines] = useState<DocumentLine[]>([
    { productId: null, ref: '', label: '', qty: 1, unitPrice: 0, discountPct: 0, taxRate: 20 },
  ]);
  const [invNotes, setInvNotes] = useState('');

  // Recurring template modal
  const [recModal, setRecModal] = useState(false);
  const [editingRec, setEditingRec] = useState<RecurringInvoiceItem | null>(null);
  const [recTitle, setRecTitle] = useState('');
  const [recPartyId, setRecPartyId] = useState('');
  const [recProjectId, setRecProjectId] = useState('');
  const [recFreq, setRecFreq] = useState<'monthly' | 'quarterly' | 'annual'>('monthly');
  const [recNextDate, setRecNextDate] = useState(new Date().toISOString().slice(0, 10));
  const [recCurrency, setRecCurrency] = useState('USD');
  const [recStatus, setRecStatus] = useState<RecurringInvoiceItem['status']>('active');
  const [recLineLabel, setRecLineLabel] = useState('');
  const [recLineAmount, setRecLineAmount] = useState('960');
  const [recLineTax, setRecLineTax] = useState('20');
  const [recNotes, setRecNotes] = useState('');

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices
      .filter((i) => i.invoice_type === mode)
      .filter((i) => (statusFilter === 'all' ? true : i.status === statusFilter))
      .filter((i) => (projectFilter === 'all' ? true : String(i.project_id ?? '') === projectFilter))
      .filter(
        (i) =>
          !q ||
          i.ref.toLowerCase().includes(q) ||
          i.party_name.toLowerCase().includes(q) ||
          (i.project_ref || '').toLowerCase().includes(q) ||
          (i.notes || '').toLowerCase().includes(q)
      );
  }, [invoices, mode, statusFilter, projectFilter, search]);

  const filteredRecurring = useMemo(
    () => recurringInvoices.filter((r) => r.invoice_type === mode),
    [recurringInvoices, mode]
  );

  const aging = mode === 'customer' ? agingSummary.ar : agingSummary.ap;

  function openCreateInvoice() {
    setEditingInvoice(null);
    setInvKind('standard');
    setInvPartyId(thirdParties[0] ? String(thirdParties[0].id) : '');
    setInvProjectId('');
    setInvCurrency('USD');
    setInvFxRate('1');
    setInvIssueDate(new Date().toISOString().slice(0, 10));
    setInvDueDate(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
    setInvStatus('draft');
    const firstProd = products[0];
    setInvLines(
      firstProd
        ? [
            {
              productId: firstProd.id,
              ref: firstProd.ref,
              label: firstProd.name,
              qty: 1,
              unitPrice: mode === 'supplier' ? firstProd.cost_price : firstProd.sell_price,
              discountPct: 0,
              taxRate: firstProd.tax_rate,
            },
          ]
        : [{ productId: null, ref: '', label: '', qty: 1, unitPrice: 0, discountPct: 0, taxRate: 20 }]
    );
    setInvNotes('');
    setInvoiceModal(true);
  }

  function openEditInvoice(inv: Invoice) {
    const parsed = parseDocumentLines(inv.lines_json);
    setEditingInvoice(inv);
    setInvKind(inv.invoice_kind ?? 'standard');
    setInvPartyId(String(inv.third_party_id));
    setInvProjectId(inv.project_id ? String(inv.project_id) : '');
    setInvCurrency(inv.currency || 'USD');
    setInvFxRate(String(inv.exchange_rate || 1));
    setInvIssueDate(inv.issue_date);
    setInvDueDate(inv.due_date);
    setInvStatus(inv.status);
    setInvLines(
      parsed.length > 0
        ? parsed
        : [{ productId: null, ref: '', label: '', qty: 1, unitPrice: 0, discountPct: 0, taxRate: 20 }]
    );
    setInvNotes(inv.notes || '');
    setInvoiceModal(true);
  }

  function handleSelectInvLineProduct(idx: number, prodIdStr: string) {
    const prod = products.find((p) => p.id === Number(prodIdStr));
    setInvLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        if (!prod) return { ...l, productId: null };
        return {
          ...l,
          productId: prod.id,
          ref: prod.ref,
          label: prod.name,
          unitPrice: mode === 'supplier' ? prod.cost_price : prod.sell_price,
          taxRate: prod.tax_rate,
        };
      })
    );
  }

  function handleInvCurrencyChange(code: string) {
    setInvCurrency(code);
    const match = currencies.find((c) => c.code === code);
    if (match) setInvFxRate(String(match.exchange_rate));
  }

  async function handleSaveInvoice(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        invoiceType: mode,
        invoiceKind: invKind,
        thirdPartyId: Number(invPartyId),
        projectId: invProjectId ? Number(invProjectId) : null,
        currency: invCurrency,
        exchangeRate: Number(invFxRate) || 1,
        issueDate: invIssueDate,
        dueDate: invDueDate,
        status: invStatus,
        lines: invLines,
        notes: invNotes,
      };
      if (editingInvoice) {
        await apiRequest(`/api/invoices/${editingInvoice.id}`, { method: 'PUT', body: payload });
        onNotify(`${editingInvoice.ref} updated.`);
      } else {
        await apiRequest('/api/invoices', { method: 'POST', body: payload });
        onNotify(invKind === 'credit_note' ? 'Credit note created.' : 'Invoice draft created.');
      }
      setInvoiceModal(false);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save invoice.', 'error');
    }
  }

  async function handleValidateInvoice(id: number) {
    try {
      await apiRequest(`/api/invoices/${id}/validate`, { method: 'POST', body: {} });
      onNotify('Document validated and ready for settlement.');
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Validation failed.', 'error');
    }
  }

  async function handleRecordPayment(e: FormEvent) {
    e.preventDefault();
    if (!paymentModal) return;
    try {
      await apiRequest(`/api/invoices/${paymentModal.id}/payments`, {
        method: 'POST',
        body: {
          bankAccountId: Number(payAccountId || bankAccounts[0]?.id),
          amount: Number(payAmount),
          label: payLabel,
        },
      });
      setPaymentModal(null);
      setPayLabel('');
      onNotify('Payment recorded and bank ledger updated.');
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Payment failed.', 'error');
    }
  }

  function openCreateRecurring() {
    setEditingRec(null);
    setRecTitle('');
    setRecPartyId(thirdParties[0] ? String(thirdParties[0].id) : '');
    setRecProjectId('');
    setRecFreq('monthly');
    setRecNextDate(new Date().toISOString().slice(0, 10));
    setRecCurrency('USD');
    setRecStatus('active');
    setRecLineLabel(mode === 'customer' ? 'Monthly Managed SLA Retainer' : 'Recurring Infrastructure Lease');
    setRecLineAmount('960');
    setRecLineTax('20');
    setRecNotes('');
    setRecModal(true);
  }

  function openEditRecurring(item: RecurringInvoiceItem) {
    const first = parseDocumentLines(item.lines_json)[0];
    setEditingRec(item);
    setRecTitle(item.title);
    setRecPartyId(String(item.third_party_id));
    setRecProjectId(item.project_id ? String(item.project_id) : '');
    setRecFreq(item.frequency);
    setRecNextDate(item.next_run_date);
    setRecCurrency(item.currency || 'USD');
    setRecStatus(item.status);
    setRecLineLabel(first?.label || item.title);
    setRecLineAmount(String(first?.unitPrice ?? item.total_ttc));
    setRecLineTax(String(first?.taxRate ?? 20));
    setRecNotes(item.notes || '');
    setRecModal(true);
  }

  async function handleSaveRecurring(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        invoiceType: mode,
        thirdPartyId: Number(recPartyId),
        projectId: recProjectId ? Number(recProjectId) : null,
        title: recTitle,
        frequency: recFreq,
        nextRunDate: recNextDate,
        currency: recCurrency,
        status: recStatus,
        lines: [
          {
            productId: null,
            ref: '',
            label: recLineLabel || recTitle,
            qty: 1,
            unitPrice: Number(recLineAmount) || 0,
            discountPct: 0,
            taxRate: Number(recLineTax) || 0,
          },
        ],
        notes: recNotes,
      };
      if (editingRec) {
        await apiRequest(`/api/finance/recurring-invoices/${editingRec.id}`, { method: 'PUT', body: payload });
        onNotify(`Recurring schedule ${editingRec.ref} updated.`);
      } else {
        await apiRequest('/api/finance/recurring-invoices', { method: 'POST', body: payload });
        onNotify('Recurring billing template created.');
      }
      setRecModal(false);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save recurring template.', 'error');
    }
  }

  async function handleGenerateFromRecurring(id: number) {
    try {
      const res = await apiRequest<{ invoice: Invoice; nextRunDate: string }>(
        `/api/finance/recurring-invoices/${id}/generate`,
        { method: 'POST', body: {} }
      );
      onNotify(`Generated draft ${res.invoice.ref}. Next cycle scheduled for ${formatDate(res.nextRunDate)}.`);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to generate invoice.', 'error');
    }
  }

  async function handleToggleRecurringStatus(item: RecurringInvoiceItem) {
    const nextStatus = item.status === 'active' ? 'paused' : 'active';
    try {
      await apiRequest(`/api/finance/recurring-invoices/${item.id}`, {
        method: 'PUT',
        body: { status: nextStatus },
      });
      onNotify(`Schedule ${item.ref} marked ${nextStatus}.`);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Status update failed.', 'error');
    }
  }

  return (
    <div className="space-y-5">
      {/* AR / AP Aging Schedule Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            {mode === 'customer' ? 'Total Open AR' : 'Total Open AP'}
          </div>
          <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatCurrency(aging.total)}
          </div>
          <div className="text-[11px] text-zinc-500">Base USD equivalent</div>
        </div>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
            Current (Not Due)
          </div>
          <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatCurrency(aging.current)}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
            1–30 Days Overdue
          </div>
          <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatCurrency(aging.days_1_30)}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-orange-700 dark:text-orange-400">
            31–60 Days Overdue
          </div>
          <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatCurrency(aging.days_31_60)}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-red-700 dark:text-red-400">
            61+ Days Overdue
          </div>
          <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatCurrency(aging.days_61_plus)}
          </div>
        </div>
      </div>

      {/* Filter & Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[260px]">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${mode === 'customer' ? 'invoices' : 'bills'}, party, project...`}
              className="w-full h-9 pl-8 pr-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500/30"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
            className="h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-800 dark:text-zinc-200"
          >
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="validated">Validated</option>
            <option value="partial">Partial</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            aria-label="Filter by project"
            className="h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-800 dark:text-zinc-200"
          >
            <option value="all">All Projects</option>
            {projects.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.ref} — {p.title}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRecurring((v) => !v)}
            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              showRecurring
                ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400'
                : 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5 shrink-0" />
            <span>Recurring ({filteredRecurring.length})</span>
          </button>
          {canWrite && (
            <button
              type="button"
              onClick={openCreateInvoice}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span>{mode === 'customer' ? 'New Invoice / Credit' : 'Record Supplier Bill'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Optional Recurring Schedules Drawer */}
      {showRecurring && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Recurring {mode === 'customer' ? 'Billing' : 'Payable'} Schedules
              </h3>
              <p className="text-xs text-zinc-500">Automate contract invoices and advance billing cycles in one click.</p>
            </div>
            {canWrite && (
              <button
                type="button"
                onClick={openCreateRecurring}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>New Template</span>
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                  <th className="py-2.5 px-4 font-medium">Ref · Schedule</th>
                  <th className="py-2.5 px-4 font-medium">Counterparty &amp; Project</th>
                  <th className="py-2.5 px-4 font-medium">Cycle · Next Run</th>
                  <th className="py-2.5 px-4 font-medium text-right">Amount</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filteredRecurring.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2.5 px-4">
                      <div className="font-mono font-medium text-orange-700 dark:text-orange-400">{r.ref}</div>
                      <div className="text-zinc-900 dark:text-zinc-100 font-medium">{r.title}</div>
                      {r.last_generated_ref && (
                        <div className="text-[11px] font-mono text-zinc-500">Last: {r.last_generated_ref}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="text-zinc-900 dark:text-zinc-100">{r.party_name}</div>
                      {r.project_ref && (
                        <div className="text-[11px] font-mono text-zinc-500">{r.project_ref}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="capitalize font-medium text-zinc-800 dark:text-zinc-200">{r.frequency}</div>
                      <div className="font-mono text-[11px] text-zinc-500">{formatDate(r.next_run_date)}</div>
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right font-semibold">
                      {formatMoneyWithCode(r.total_ttc, r.currency)}
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusText status={r.status} />
                    </td>
                    <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
                      {canWrite && r.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => handleGenerateFromRecurring(r.id)}
                          className="font-medium text-orange-700 dark:text-orange-400 hover:underline"
                        >
                          Generate Now
                        </button>
                      )}
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => handleToggleRecurringStatus(r)}
                          title={r.status === 'active' ? 'Pause schedule' : 'Activate schedule'}
                          aria-label={`Toggle ${r.ref}`}
                          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center align-middle"
                        >
                          {r.status === 'active' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                        </button>
                      )}
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => openEditRecurring(r)}
                          title="Edit template"
                          aria-label={`Edit ${r.ref}`}
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
                              `/api/finance/recurring-invoices/${r.id}`,
                              'Delete Recurring Schedule',
                              `${r.ref} — ${r.title}`
                            )
                          }
                          title="Delete template"
                          aria-label={`Delete ${r.ref}`}
                          className="text-zinc-400 hover:text-red-600 inline-flex items-center align-middle"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredRecurring.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-zinc-500">
                      No recurring templates configured for this ledger yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Main Invoices / Bills Table */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                <th className="py-3 px-4 font-medium">Reference</th>
                <th className="py-3 px-4 font-medium">{mode === 'customer' ? 'Customer' : 'Supplier'} &amp; Project</th>
                <th className="py-3 px-4 font-medium">Issue / Due</th>
                <th className="py-3 px-4 font-medium text-right">Total</th>
                <th className="py-3 px-4 font-medium text-right">Paid</th>
                <th className="py-3 px-4 font-medium text-right">Balance</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {filteredInvoices.map((inv) => {
                const remaining = Math.max(0, inv.total_ttc - inv.amount_paid);
                const ccy = inv.currency || 'USD';
                const canBeDeleted = inv.status !== 'paid' && inv.status !== 'partial';
                return (
                  <tr key={inv.id} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/30">
                    <td className="py-3 px-4 font-mono">
                      <div className="font-medium text-orange-700 dark:text-orange-400">{inv.ref}</div>
                      {inv.invoice_kind === 'credit_note' && (
                        <div className="text-[11px] font-sans text-amber-700 dark:text-amber-400">Credit Note</div>
                      )}
                      {inv.source_ref && <div className="text-[11px] text-zinc-400">From {inv.source_ref}</div>}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{inv.party_name}</div>
                      <div className="text-[11px] font-mono text-zinc-500">
                        {inv.party_ref}
                        {inv.project_ref ? ` · ${inv.project_ref}` : ''}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-zinc-500">
                      <div>{formatDate(inv.issue_date)}</div>
                      <div className="text-[11px]">Due {formatDate(inv.due_date)}</div>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-right font-semibold text-zinc-900 dark:text-zinc-100">
                      <div>{formatMoneyWithCode(inv.total_ttc, ccy)}</div>
                      {ccy !== 'USD' && inv.exchange_rate && inv.exchange_rate !== 1 && (
                        <div className="text-[11px] font-normal text-zinc-500">
                          ≈ {formatCurrency(inv.total_ttc / inv.exchange_rate)}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-right text-emerald-700 dark:text-emerald-400">
                      {formatMoneyWithCode(inv.amount_paid, ccy)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-right font-medium text-zinc-800 dark:text-zinc-200">
                      {formatMoneyWithCode(remaining, ccy)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusText status={inv.status} />
                    </td>
                    <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => downloadInvoiceStatement(inv)}
                        title="Download printable statement"
                        aria-label={`Statement ${inv.ref}`}
                        className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center align-middle"
                      >
                        <FileText className="w-3.5 h-3.5" />
                      </button>
                      {canValidate && inv.status === 'draft' && (
                        <button
                          type="button"
                          onClick={() => handleValidateInvoice(inv.id)}
                          className="inline-flex items-center gap-1 font-medium text-orange-700 dark:text-orange-400 hover:underline align-middle"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Validate
                        </button>
                      )}
                      {canRecordPay && (inv.status === 'validated' || inv.status === 'partial') && remaining > 0.01 && (
                        <button
                          type="button"
                          onClick={() => {
                            setPaymentModal(inv);
                            setPayAmount(remaining.toFixed(2));
                            setPayAccountId(bankAccounts[0] ? String(bankAccounts[0].id) : '');
                            setPayLabel('');
                          }}
                          className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400 hover:underline align-middle"
                        >
                          <CreditCard className="w-3.5 h-3.5" /> Pay
                        </button>
                      )}
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => openEditInvoice(inv)}
                          title="Edit document"
                          aria-label={`Edit ${inv.ref}`}
                          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center align-middle"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          disabled={!canBeDeleted}
                          onClick={() =>
                            onPromptDelete(
                              `/api/invoices/${inv.id}`,
                              'Delete Document',
                              `${inv.ref} — ${inv.party_name}`,
                              'Only unpaid draft, validated, or cancelled documents may be deleted.'
                            )
                          }
                          title={canBeDeleted ? 'Delete document' : 'Paid/partial documents cannot be deleted'}
                          aria-label={`Delete ${inv.ref}`}
                          className={`inline-flex items-center align-middle ${
                            canBeDeleted ? 'text-zinc-400 hover:text-red-600' : 'text-zinc-300 dark:text-zinc-700 cursor-not-allowed'
                          }`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredInvoices.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-zinc-500">
                    No matching {mode === 'customer' ? 'customer invoices' : 'supplier bills'} found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record Payment Modal */}
      <Modal
        open={Boolean(paymentModal)}
        onClose={() => setPaymentModal(null)}
        title={paymentModal ? `Record Settlement — ${paymentModal.ref}` : 'Record Payment'}
        subtitle={paymentModal ? `${paymentModal.party_name} · Total ${formatMoneyWithCode(paymentModal.total_ttc, paymentModal.currency)}` : undefined}
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleRecordPayment} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Bank / Cash Account</label>
            <select
              value={payAccountId}
              onChange={(e) => setPayAccountId(e.target.value)}
              required
              className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
            >
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.ref} · {a.name} ({formatCurrency(a.balance)})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Settlement Amount ({paymentModal?.currency || 'USD'})
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              required
              className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Payment Reference / Memo</label>
            <input
              type="text"
              value={payLabel}
              onChange={(e) => setPayLabel(e.target.value)}
              placeholder="ACH Wire / Check Ref"
              className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setPaymentModal(null)}
              className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button type="submit" className="h-9 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium">
              Post Settlement
            </button>
          </div>
        </form>
      </Modal>

      {/* Invoice / Bill Create & Edit Modal */}
      <Modal
        open={invoiceModal}
        onClose={() => setInvoiceModal(false)}
        title={editingInvoice ? `Edit ${editingInvoice.ref}` : mode === 'customer' ? 'New Customer Invoice' : 'New Supplier Bill'}
        subtitle="Supports project cost allocation, multi-currency FX conversion, and custom tax schedules."
        maxWidthClass="max-w-3xl"
      >
        <form onSubmit={handleSaveInvoice} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Document Kind</label>
              <select
                value={invKind}
                disabled={Boolean(editingInvoice)}
                onChange={(e) => setInvKind(e.target.value as 'standard' | 'credit_note')}
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs disabled:opacity-60"
              >
                <option value="standard">Standard Invoice / Bill</option>
                <option value="credit_note">Credit Note / Refund</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                {mode === 'customer' ? 'Customer' : 'Supplier'}
              </label>
              <select
                value={invPartyId}
                disabled={Boolean(editingInvoice && editingInvoice.status !== 'draft')}
                onChange={(e) => setInvPartyId(e.target.value)}
                required
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs disabled:opacity-60"
              >
                {thirdParties.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.name} ({tp.ref})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Project / Cost Center</label>
              <select
                value={invProjectId}
                onChange={(e) => setInvProjectId(e.target.value)}
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              >
                <option value="">General Operating (None)</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.ref} — {p.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Currency</label>
              <select
                value={invCurrency}
                disabled={Boolean(editingInvoice && editingInvoice.status !== 'draft')}
                onChange={(e) => handleInvCurrencyChange(e.target.value)}
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs disabled:opacity-60"
              >
                {currencies.length > 0 ? (
                  currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} ({c.symbol})
                    </option>
                  ))
                ) : (
                  <option value="USD">USD ($)</option>
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">FX Rate (per 1 USD)</label>
              <input
                type="number"
                step="0.0001"
                min="0.0001"
                disabled={Boolean(editingInvoice && editingInvoice.status !== 'draft')}
                value={invFxRate}
                onChange={(e) => setInvFxRate(e.target.value)}
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Issue Date</label>
              <input
                type="date"
                value={invIssueDate}
                disabled={Boolean(editingInvoice && editingInvoice.status !== 'draft')}
                onChange={(e) => setInvIssueDate(e.target.value)}
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Due Date</label>
              <input
                type="date"
                value={invDueDate}
                onChange={(e) => setInvDueDate(e.target.value)}
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              />
            </div>
          </div>

          {(!editingInvoice || editingInvoice.status === 'draft') && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Line Items</label>
                <button
                  type="button"
                  onClick={() =>
                    setInvLines((prev) => [
                      ...prev,
                      { productId: null, ref: '', label: '', qty: 1, unitPrice: 0, discountPct: 0, taxRate: taxRates[0]?.rate ?? 20 },
                    ])
                  }
                  className="text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline"
                >
                  + Add Line
                </button>
              </div>
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {invLines.map((line, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-zinc-50 dark:bg-zinc-950/60 p-2 rounded-lg border border-zinc-200 dark:border-zinc-800">
                    <select
                      value={line.productId ?? ''}
                      onChange={(e) => handleSelectInvLineProduct(idx, e.target.value)}
                      className="col-span-3 h-8 px-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[11px]"
                    >
                      <option value="">Custom Item</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.ref} · {p.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={line.label}
                      onChange={(e) => setInvLines((p) => p.map((l, i) => (i === idx ? { ...l, label: e.target.value } : l)))}
                      placeholder="Description"
                      required
                      className="col-span-3 h-8 px-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[11px]"
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={line.qty}
                      onChange={(e) => setInvLines((p) => p.map((l, i) => (i === idx ? { ...l, qty: Number(e.target.value) } : l)))}
                      placeholder="Qty"
                      className="col-span-2 h-8 px-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[11px] font-mono"
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={line.unitPrice}
                      onChange={(e) =>
                        setInvLines((p) => p.map((l, i) => (i === idx ? { ...l, unitPrice: Number(e.target.value) } : l)))
                      }
                      placeholder="Price"
                      className="col-span-2 h-8 px-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[11px] font-mono"
                    />
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      value={line.taxRate}
                      onChange={(e) =>
                        setInvLines((p) => p.map((l, i) => (i === idx ? { ...l, taxRate: Number(e.target.value) } : l)))
                      }
                      title="Tax %"
                      className="col-span-1 h-8 px-1.5 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[11px] font-mono"
                    />
                    <button
                      type="button"
                      disabled={invLines.length <= 1}
                      onClick={() => setInvLines((p) => p.filter((_, i) => i !== idx))}
                      className="col-span-1 text-zinc-400 hover:text-red-600 disabled:opacity-30 flex justify-center"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Notes</label>
              <input
                type="text"
                value={invNotes}
                onChange={(e) => setInvNotes(e.target.value)}
                placeholder="Payment terms, PO reference, or internal note"
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              />
            </div>
            {editingInvoice && editingInvoice.status !== 'paid' && editingInvoice.status !== 'partial' && (
              <div>
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Status</label>
                <select
                  value={invStatus}
                  onChange={(e) => setInvStatus(e.target.value as Invoice['status'])}
                  className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
                >
                  <option value="draft">Draft</option>
                  <option value="validated">Validated</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setInvoiceModal(false)}
              className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button type="submit" className="h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">
              {editingInvoice ? 'Save Changes' : 'Create Draft'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Recurring Schedule Modal */}
      <Modal
        open={recModal}
        onClose={() => setRecModal(false)}
        title={editingRec ? `Edit ${editingRec.ref}` : 'New Recurring Billing Template'}
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handleSaveRecurring} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Schedule Title</label>
            <input
              type="text"
              value={recTitle}
              onChange={(e) => setRecTitle(e.target.value)}
              required
              placeholder="e.g. Annual Telemetry SLA Retainer"
              className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Counterparty</label>
              <select
                value={recPartyId}
                onChange={(e) => setRecPartyId(e.target.value)}
                required
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              >
                {thirdParties.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Project (Optional)</label>
              <select
                value={recProjectId}
                onChange={(e) => setRecProjectId(e.target.value)}
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              >
                <option value="">None</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.ref} — {p.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Frequency</label>
              <select
                value={recFreq}
                onChange={(e) => setRecFreq(e.target.value as 'monthly' | 'quarterly' | 'annual')}
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Next Run Date</label>
              <input
                type="date"
                value={recNextDate}
                onChange={(e) => setRecNextDate(e.target.value)}
                required
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Currency</label>
              <select
                value={recCurrency}
                onChange={(e) => setRecCurrency(e.target.value)}
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              >
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Net Amount</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={recLineAmount}
                onChange={(e) => setRecLineAmount(e.target.value)}
                required
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Tax %</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={recLineTax}
                onChange={(e) => setRecLineTax(e.target.value)}
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Status</label>
              <select
                value={recStatus}
                onChange={(e) => setRecStatus(e.target.value as RecurringInvoiceItem['status'])}
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="ended">Ended</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Line Description</label>
            <input
              type="text"
              value={recLineLabel}
              onChange={(e) => setRecLineLabel(e.target.value)}
              required
              className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setRecModal(false)}
              className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button type="submit" className="h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">
              {editingRec ? 'Save Template' : 'Create Template'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

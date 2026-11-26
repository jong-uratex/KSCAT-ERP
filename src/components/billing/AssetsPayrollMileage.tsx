import { Fragment, useState, type FormEvent } from 'react';
import {
  Calculator,
  Car,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Landmark,
  Pencil,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import type {
  BankAccount,
  FixedAssetItem,
  MileageClaimItem,
  PayrollLineItem,
  PayrollRunItem,
} from '../../types/erp';
import { Modal } from '../Modal';
import { StatusText } from '../StatusText';

interface EmployeeBrief {
  id: number;
  ref: string;
  full_name: string;
  department: string;
  annual_salary: number;
  status: string;
}

interface FixedAssetsPanelProps {
  assets: FixedAssetItem[];
  canWrite: boolean;
  canDelete: boolean;
  onPromptDelete: (url: string, title: string, itemLabel: string, warning?: string) => void;
  onReload: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export function FixedAssetsPanel({
  assets,
  canWrite,
  canDelete,
  onPromptDelete,
  onReload,
  onNotify,
}: FixedAssetsPanelProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FixedAssetItem | null>(null);
  const [ref, setRef] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Machinery & Lab');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [purchaseCost, setPurchaseCost] = useState('10000');
  const [salvageValue, setSalvageValue] = useState('1000');
  const [usefulLifeMonths, setUsefulLifeMonths] = useState('36');
  const [method, setMethod] = useState<'straight_line' | 'declining_balance'>('straight_line');
  const [accumDepr, setAccumDepr] = useState('0');
  const [status, setStatus] = useState<'active' | 'disposed'>('active');
  const [notes, setNotes] = useState('');
  const [runningDep, setRunningDep] = useState(false);

  const activeAssets = assets.filter((a) => a.status === 'active');
  const totalCost = activeAssets.reduce((s, a) => s + a.purchase_cost, 0);
  const totalAccum = activeAssets.reduce((s, a) => s + a.accumulated_depreciation, 0);
  const totalNbv = Math.max(0, totalCost - totalAccum);

  function openCreate() {
    setEditing(null);
    setRef('');
    setName('');
    setCategory('Machinery & Lab');
    setPurchaseDate(new Date().toISOString().slice(0, 10));
    setPurchaseCost('12000');
    setSalvageValue('1200');
    setUsefulLifeMonths('48');
    setMethod('straight_line');
    setAccumDepr('0');
    setStatus('active');
    setNotes('');
    setModalOpen(true);
  }

  function openEdit(a: FixedAssetItem) {
    setEditing(a);
    setRef(a.ref);
    setName(a.name);
    setCategory(a.category);
    setPurchaseDate(a.purchase_date);
    setPurchaseCost(String(a.purchase_cost));
    setSalvageValue(String(a.salvage_value));
    setUsefulLifeMonths(String(a.useful_life_months));
    setMethod(a.depreciation_method);
    setAccumDepr(String(a.accumulated_depreciation));
    setStatus(a.status);
    setNotes(a.notes || '');
    setModalOpen(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    try {
      if (editing) {
        await apiRequest(`/api/fixed-assets/${editing.id}`, {
          method: 'PUT',
          body: {
            name,
            category,
            purchaseDate,
            purchaseCost: Number(purchaseCost),
            salvageValue: Number(salvageValue) || 0,
            usefulLifeMonths: Number(usefulLifeMonths) || 36,
            depreciationMethod: method,
            accumulatedDepreciation: Number(accumDepr) || 0,
            status,
            notes,
          },
        });
        onNotify(`Fixed asset ${editing.ref} updated.`);
      } else {
        await apiRequest('/api/fixed-assets', {
          method: 'POST',
          body: {
            ref,
            name,
            category,
            purchaseDate,
            purchaseCost: Number(purchaseCost),
            salvageValue: Number(salvageValue) || 0,
            usefulLifeMonths: Number(usefulLifeMonths) || 36,
            depreciationMethod: method,
            accumulatedDepreciation: Number(accumDepr) || 0,
            notes,
          },
        });
        onNotify('Fixed asset registered.');
      }
      setModalOpen(false);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save fixed asset.', 'error');
    }
  }

  async function handleRunDepreciation() {
    setRunningDep(true);
    try {
      const res = await apiRequest<{ assetsUpdated: number; totalDepreciation: number; journalRef: string | null }>(
        '/api/fixed-assets/run-depreciation',
        { method: 'POST', body: {} }
      );
      if (res.assetsUpdated === 0) {
        onNotify('All active fixed assets are already fully depreciated.');
      } else {
        onNotify(
          `Posted ${formatCurrency(res.totalDepreciation)} monthly depreciation across ${res.assetsUpdated} asset(s)${
            res.journalRef ? ` (${res.journalRef})` : ''
          }.`
        );
      }
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Depreciation run failed.', 'error');
    } finally {
      setRunningDep(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 flex-1">
          <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <div className="text-xs text-zinc-500">Gross Asset Cost</div>
            <div className="mt-1 text-lg font-mono tabular-nums font-semibold">{formatCurrency(totalCost)}</div>
          </div>
          <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <div className="text-xs text-zinc-500">Accumulated Depreciation</div>
            <div className="mt-1 text-lg font-mono tabular-nums font-semibold text-amber-700 dark:text-amber-400">
              {formatCurrency(totalAccum)}
            </div>
          </div>
          <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <div className="text-xs text-zinc-500">Net Book Value</div>
            <div className="mt-1 text-lg font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
              {formatCurrency(totalNbv)}
            </div>
          </div>
        </div>

        {canWrite && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={runningDep || activeAssets.length === 0}
              onClick={handleRunDepreciation}
              className="px-3.5 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Calculator className="w-3.5 h-3.5" />
              <span>{runningDep ? 'Posting...' : 'Run Monthly Depreciation'}</span>
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Register Asset</span>
            </button>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                <th className="py-3 px-4 font-medium">Asset Ref</th>
                <th className="py-3 px-4 font-medium">Asset & Category</th>
                <th className="py-3 px-4 font-medium">Acquired · Life</th>
                <th className="py-3 px-4 font-medium text-right">Purchase Cost</th>
                <th className="py-3 px-4 font-medium text-right">Accum. Depr.</th>
                <th className="py-3 px-4 font-medium text-right">Book Value</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {assets.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-zinc-500">
                    No fixed assets registered yet.
                  </td>
                </tr>
              ) : (
                assets.map((a) => {
                  const nbv = Math.max(0, Math.round((a.purchase_cost - a.accumulated_depreciation) * 100) / 100);
                  return (
                    <tr key={a.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <td className="py-3 px-4 font-mono font-medium text-orange-700 dark:text-orange-400">{a.ref}</td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">{a.name}</div>
                        <div className="text-[11px] text-zinc-500">
                          {a.category} · {a.depreciation_method === 'declining_balance' ? '200% Declining Balance' : 'Straight-Line'}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-zinc-500">
                        {formatDate(a.purchase_date)} · {a.useful_life_months}m
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-right">
                        {formatCurrency(a.purchase_cost)}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-right text-amber-700 dark:text-amber-400">
                        {formatCurrency(a.accumulated_depreciation)}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-right font-semibold text-zinc-900 dark:text-zinc-100">
                        {formatCurrency(nbv)}
                      </td>
                      <td className="py-3 px-4">
                        <StatusText status={a.status} />
                      </td>
                      <td className="py-3 px-4 text-right space-x-2.5 whitespace-nowrap">
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => openEdit(a)}
                            title="Edit fixed asset"
                            aria-label={`Edit ${a.ref}`}
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
                                `/api/fixed-assets/${a.id}`,
                                'Delete Fixed Asset',
                                `${a.ref} — ${a.name}`
                              )
                            }
                            title="Delete fixed asset"
                            aria-label={`Delete ${a.ref}`}
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
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit Asset ${editing.ref}` : 'Register Fixed Asset'}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Asset Tag / Ref</label>
              <input
                type="text"
                disabled={Boolean(editing)}
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="Auto (FA-xxxx)"
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-60"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium mb-1">Asset Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. SMT Pick & Place Line"
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Category</label>
              <input
                type="text"
                required
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Purchase Date</label>
              <input
                type="date"
                required
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Method</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as 'straight_line' | 'declining_balance')}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="straight_line">Straight-Line</option>
                <option value="declining_balance">Declining Balance</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Cost ($)</label>
              <input
                type="number"
                step="0.01"
                min="1"
                required
                value={purchaseCost}
                onChange={(e) => setPurchaseCost(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Salvage ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={salvageValue}
                onChange={(e) => setSalvageValue(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Life (Months)</label>
              <input
                type="number"
                min="1"
                required
                value={usefulLifeMonths}
                onChange={(e) => setUsefulLifeMonths(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Accum. Depr.</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={accumDepr}
                onChange={(e) => setAccumDepr(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>

          {editing && (
            <div>
              <label className="block text-xs font-medium mb-1">Asset Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'active' | 'disposed')}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="active">Active</option>
                <option value="disposed">Disposed / Retired</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">
              {editing ? 'Save Asset' : 'Register Asset'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

interface PayrollPanelProps {
  runs: PayrollRunItem[];
  employees: EmployeeBrief[];
  accounts: BankAccount[];
  canWrite: boolean;
  canRecordPay: boolean;
  canDelete: boolean;
  onPromptDelete: (url: string, title: string, itemLabel: string, warning?: string) => void;
  onReload: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export function PayrollPanel({
  runs,
  employees,
  accounts,
  canWrite,
  canRecordPay,
  canDelete,
  onPromptDelete,
  onReload,
  onNotify,
}: PayrollPanelProps) {
  const [expandedId, setExpandedId] = useState<number | null>(runs[0]?.id ?? null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PayrollRunItem | null>(null);
  const [periodStart, setPeriodStart] = useState(new Date().toISOString().slice(0, 8) + '01');
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().slice(0, 10));
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [bankId, setBankId] = useState(accounts[0] ? String(accounts[0].id) : '');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'draft' | 'approved' | 'paid'>('draft');
  const [lines, setLines] = useState<PayrollLineItem[]>([]);

  const [postModalRun, setPostModalRun] = useState<PayrollRunItem | null>(null);
  const [postBankId, setPostBankId] = useState(accounts[0] ? String(accounts[0].id) : '');

  function buildDefaultLines(): PayrollLineItem[] {
    return employees
      .filter((e) => e.status !== 'terminated')
      .map((e) => {
        const base = Math.round((e.annual_salary / 12) * 100) / 100;
        const tax = Math.round(base * 0.22 * 100) / 100;
        return {
          employee_id: e.id,
          employee_name: e.full_name,
          base_salary: base,
          overtime_allowances: 0,
          tax_deductions: tax,
          net_pay: Math.round((base - tax) * 100) / 100,
        };
      });
  }

  function openCreate() {
    setEditing(null);
    setPeriodStart(new Date().toISOString().slice(0, 8) + '01');
    setPeriodEnd(new Date().toISOString().slice(0, 10));
    setPayDate(new Date().toISOString().slice(0, 10));
    setBankId(accounts[0] ? String(accounts[0].id) : '');
    setNotes('');
    setStatus('draft');
    setLines(buildDefaultLines());
    setModalOpen(true);
  }

  function openEdit(r: PayrollRunItem) {
    setEditing(r);
    setPeriodStart(r.pay_period_start);
    setPeriodEnd(r.pay_period_end);
    setPayDate(r.pay_date);
    setBankId(r.bank_account_id ? String(r.bank_account_id) : accounts[0] ? String(accounts[0].id) : '');
    setNotes(r.notes || '');
    setStatus(r.status);
    setLines(r.lines.map((l) => ({ ...l })));
    setModalOpen(true);
  }

  function updateLine(idx: number, patch: Partial<PayrollLineItem>) {
    setLines((prev) =>
      prev.map((ln, i) => {
        if (i !== idx) return ln;
        const next = { ...ln, ...patch };
        next.net_pay = Math.max(
          0,
          Math.round((Number(next.base_salary) + Number(next.overtime_allowances) - Number(next.tax_deductions)) * 100) / 100
        );
        return next;
      })
    );
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    try {
      const payloadLines = lines.map((l) => ({
        employeeId: l.employee_id,
        employeeName: l.employee_name,
        baseSalary: Number(l.base_salary) || 0,
        overtimeAllowances: Number(l.overtime_allowances) || 0,
        taxDeductions: Number(l.tax_deductions) || 0,
      }));
      if (editing) {
        await apiRequest(`/api/payroll-runs/${editing.id}`, {
          method: 'PUT',
          body: {
            payPeriodStart: periodStart,
            payPeriodEnd: periodEnd,
            payDate,
            bankAccountId: bankId ? Number(bankId) : null,
            notes,
            status: editing.status !== 'paid' ? status : undefined,
            lines: editing.status !== 'paid' ? payloadLines : undefined,
          },
        });
        onNotify(`Payroll run ${editing.ref} updated.`);
      } else {
        await apiRequest('/api/payroll-runs', {
          method: 'POST',
          body: {
            payPeriodStart: periodStart,
            payPeriodEnd: periodEnd,
            payDate,
            bankAccountId: bankId ? Number(bankId) : null,
            notes,
            lines: payloadLines,
          },
        });
        onNotify('Payroll run created.');
      }
      setModalOpen(false);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save payroll run.', 'error');
    }
  }

  async function handlePostPayroll(e: FormEvent) {
    e.preventDefault();
    if (!postModalRun) return;
    try {
      await apiRequest(`/api/payroll-runs/${postModalRun.id}/post`, {
        method: 'POST',
        body: { bankAccountId: Number(postBankId) },
      });
      onNotify(`Payroll ${postModalRun.ref} paid and posted to Bank & General Ledger.`);
      setPostModalRun(null);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to post payroll.', 'error');
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 inline-flex items-center gap-2">
            <Users className="w-4 h-4 text-orange-700 dark:text-orange-400" />
            <span>Payroll Runs & Employee Payslips</span>
          </h3>
          <p className="text-xs text-zinc-500">
            Generate monthly pay runs from HR employee salaries and post net disbursements to Bank & GL 6200.
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={openCreate}
            className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Pay Run</span>
          </button>
        )}
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                <th className="py-3 px-4 font-medium">Run Ref</th>
                <th className="py-3 px-4 font-medium">Pay Period · Pay Date</th>
                <th className="py-3 px-4 font-medium text-right">Employees</th>
                <th className="py-3 px-4 font-medium text-right">Gross</th>
                <th className="py-3 px-4 font-medium text-right">Deductions</th>
                <th className="py-3 px-4 font-medium text-right">Net Pay</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-zinc-500">
                    No payroll runs created yet.
                  </td>
                </tr>
              ) : (
                runs.map((r) => {
                  const isOpen = expandedId === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                        <td className="py-3 px-4">
                          <button
                            type="button"
                            onClick={() => setExpandedId(isOpen ? null : r.id)}
                            className="inline-flex items-center gap-1.5 font-mono font-medium text-orange-700 dark:text-orange-400"
                          >
                            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                            <span>{r.ref}</span>
                          </button>
                        </td>
                        <td className="py-3 px-4 font-mono text-zinc-500">
                          {formatDate(r.pay_period_start)} – {formatDate(r.pay_period_end)} · Pay {formatDate(r.pay_date)}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-right">{r.employee_count}</td>
                        <td className="py-3 px-4 font-mono tabular-nums text-right">{formatCurrency(r.total_gross)}</td>
                        <td className="py-3 px-4 font-mono tabular-nums text-right text-zinc-500">
                          {formatCurrency(r.total_deductions)}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-right font-semibold text-zinc-900 dark:text-zinc-100">
                          {formatCurrency(r.total_net)}
                        </td>
                        <td className="py-3 px-4">
                          <StatusText status={r.status} />
                        </td>
                        <td className="py-3 px-4 text-right space-x-2.5 whitespace-nowrap">
                          {canRecordPay && r.status !== 'paid' && (
                            <button
                              type="button"
                              onClick={() => {
                                setPostModalRun(r);
                                setPostBankId(
                                  r.bank_account_id
                                    ? String(r.bank_account_id)
                                    : accounts[0]
                                      ? String(accounts[0].id)
                                      : ''
                                );
                              }}
                              className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
                            >
                              <Landmark className="w-3.5 h-3.5" />
                              <span>Pay & Post GL</span>
                            </button>
                          )}
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => openEdit(r)}
                              title="Edit payroll run"
                              aria-label={`Edit ${r.ref}`}
                              className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center align-middle"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDelete && r.status !== 'paid' && (
                            <button
                              type="button"
                              onClick={() =>
                                onPromptDelete(
                                  `/api/payroll-runs/${r.id}`,
                                  'Delete Payroll Run',
                                  r.ref
                                )
                              }
                              title="Delete payroll run"
                              aria-label={`Delete ${r.ref}`}
                              className="text-zinc-400 hover:text-red-600 inline-flex items-center align-middle"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`${r.id}-lines`} className="bg-zinc-50/70 dark:bg-zinc-950/50">
                          <td colSpan={8} className="p-4">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 mb-2">
                              Payslip Breakdown — {r.ref}
                            </div>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                                  <th className="py-1.5 text-left font-medium">Employee</th>
                                  <th className="py-1.5 text-right font-medium">Base Salary</th>
                                  <th className="py-1.5 text-right font-medium">Overtime / Bonus</th>
                                  <th className="py-1.5 text-right font-medium">Tax & Withholdings</th>
                                  <th className="py-1.5 text-right font-medium">Net Pay</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-zinc-200/70 dark:divide-zinc-800">
                                {r.lines.map((ln, idx) => (
                                  <tr key={ln.id ?? idx}>
                                    <td className="py-1.5 font-medium text-zinc-800 dark:text-zinc-200">
                                      {ln.employee_name}
                                    </td>
                                    <td className="py-1.5 font-mono tabular-nums text-right">
                                      {formatCurrency(ln.base_salary)}
                                    </td>
                                    <td className="py-1.5 font-mono tabular-nums text-right">
                                      {formatCurrency(ln.overtime_allowances)}
                                    </td>
                                    <td className="py-1.5 font-mono tabular-nums text-right text-zinc-500">
                                      {formatCurrency(ln.tax_deductions)}
                                    </td>
                                    <td className="py-1.5 font-mono tabular-nums text-right font-semibold">
                                      {formatCurrency(ln.net_pay)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit Payroll Run ${editing.ref}` : 'Create Payroll Run'}
        maxWidthClass="max-w-3xl"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Period Start</label>
              <input
                type="date"
                required
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Period End</label>
              <input
                type="date"
                required
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Pay Date</label>
              <input
                type="date"
                required
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Disbursement Bank Account</label>
              <select
                value={bankId}
                onChange={(e) => setBankId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.ref} — {a.name}
                  </option>
                ))}
              </select>
            </div>
            {editing && editing.status !== 'paid' && (
              <div>
                <label className="block text-xs font-medium mb-1">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'draft' | 'approved' | 'paid')}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  <option value="draft">Draft</option>
                  <option value="approved">Approved</option>
                </select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">Employee Payslips</span>
              {(!editing || editing.status !== 'paid') && (
                <button
                  type="button"
                  onClick={() =>
                    setLines((prev) => [
                      ...prev,
                      {
                        employee_id: null,
                        employee_name: '',
                        base_salary: 4000,
                        overtime_allowances: 0,
                        tax_deductions: 880,
                        net_pay: 3120,
                      },
                    ])
                  }
                  className="text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline"
                >
                  + Add Staff Line
                </button>
              )}
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {lines.map((ln, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-12 gap-2 items-center p-2 rounded-lg border border-zinc-200 dark:border-zinc-800"
                >
                  <input
                    type="text"
                    required
                    disabled={editing?.status === 'paid'}
                    value={ln.employee_name}
                    onChange={(e) => updateLine(idx, { employee_name: e.target.value })}
                    placeholder="Employee name"
                    className="col-span-4 px-2 py-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    disabled={editing?.status === 'paid'}
                    value={ln.base_salary}
                    onChange={(e) => updateLine(idx, { base_salary: Number(e.target.value) })}
                    title="Base salary"
                    className="col-span-2 px-2 py-1.5 text-xs font-mono rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    disabled={editing?.status === 'paid'}
                    value={ln.overtime_allowances}
                    onChange={(e) => updateLine(idx, { overtime_allowances: Number(e.target.value) })}
                    title="Overtime / Allowances"
                    className="col-span-2 px-2 py-1.5 text-xs font-mono rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    disabled={editing?.status === 'paid'}
                    value={ln.tax_deductions}
                    onChange={(e) => updateLine(idx, { tax_deductions: Number(e.target.value) })}
                    title="Tax deductions"
                    className="col-span-2 px-2 py-1.5 text-xs font-mono rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                  />
                  <div className="col-span-2 flex items-center justify-end gap-1.5">
                    <span className="text-xs font-mono tabular-nums font-semibold">
                      {formatCurrency(ln.net_pay)}
                    </span>
                    {lines.length > 1 && editing?.status !== 'paid' && (
                      <button
                        type="button"
                        onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-zinc-400 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Run Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">
              {editing ? 'Save Pay Run' : 'Create Pay Run'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(postModalRun)}
        onClose={() => setPostModalRun(null)}
        title={postModalRun ? `Pay & Post Payroll — ${postModalRun.ref}` : ''}
        subtitle={
          postModalRun
            ? `Disburse ${formatCurrency(postModalRun.total_net)} net across ${postModalRun.employee_count} staff member(s)`
            : ''
        }
      >
        {postModalRun && (
          <form onSubmit={handlePostPayroll} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1">Source Treasury Account</label>
              <select
                required
                value={postBankId}
                onChange={(e) => setPostBankId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.ref} — {a.name} ({formatCurrency(a.balance)})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPostModalRun(null)}
                className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium"
              >
                Confirm Payment & Post GL
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

interface MileagePanelProps {
  claims: MileageClaimItem[];
  employees: EmployeeBrief[];
  accounts: BankAccount[];
  canWrite: boolean;
  canRecordPay: boolean;
  canDelete: boolean;
  onPromptDelete: (url: string, title: string, itemLabel: string, warning?: string) => void;
  onReload: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export function MileagePanel({
  claims,
  employees,
  accounts,
  canWrite,
  canRecordPay,
  canDelete,
  onPromptDelete,
  onReload,
  onNotify,
}: MileagePanelProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MileageClaimItem | null>(null);
  const [empId, setEmpId] = useState(employees[0] ? String(employees[0].id) : '');
  const [empName, setEmpName] = useState(employees[0]?.full_name ?? '');
  const [claimDate, setClaimDate] = useState(new Date().toISOString().slice(0, 10));
  const [origin, setOrigin] = useState('Chicago HQ');
  const [destination, setDestination] = useState('');
  const [distanceKm, setDistanceKm] = useState('45');
  const [ratePerKm, setRatePerKm] = useState('0.67');
  const [vehicle, setVehicle] = useState('Personal / Fleet');
  const [projectRef, setProjectRef] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<MileageClaimItem['status']>('submitted');

  const [reimburseClaim, setReimburseClaim] = useState<MileageClaimItem | null>(null);
  const [reimburseBankId, setReimburseBankId] = useState(accounts[0] ? String(accounts[0].id) : '');

  const computedTotal = Math.round((Number(distanceKm) || 0) * (Number(ratePerKm) || 0) * 100) / 100;

  function openCreate() {
    setEditing(null);
    setEmpId(employees[0] ? String(employees[0].id) : '');
    setEmpName(employees[0]?.full_name ?? '');
    setClaimDate(new Date().toISOString().slice(0, 10));
    setOrigin('Chicago HQ');
    setDestination('');
    setDistanceKm('45');
    setRatePerKm('0.67');
    setVehicle('Company Fleet');
    setProjectRef('');
    setNotes('');
    setStatus('submitted');
    setModalOpen(true);
  }

  function openEdit(c: MileageClaimItem) {
    setEditing(c);
    setEmpId(c.employee_id ? String(c.employee_id) : '');
    setEmpName(c.employee_name);
    setClaimDate(c.claim_date);
    setOrigin(c.origin);
    setDestination(c.destination);
    setDistanceKm(String(c.distance_km));
    setRatePerKm(String(c.rate_per_km));
    setVehicle(c.vehicle || '');
    setProjectRef(c.project_ref || '');
    setNotes(c.notes || '');
    setStatus(c.status);
    setModalOpen(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    try {
      if (editing) {
        await apiRequest(`/api/mileage-claims/${editing.id}`, {
          method: 'PUT',
          body: {
            employeeId: empId ? Number(empId) : null,
            employeeName: empName,
            claimDate,
            origin,
            destination,
            distanceKm: Number(distanceKm),
            ratePerKm: Number(ratePerKm),
            vehicle,
            projectRef,
            notes,
            status: editing.status !== 'paid' ? status : undefined,
          },
        });
        onNotify(`Mileage claim ${editing.ref} updated.`);
      } else {
        await apiRequest('/api/mileage-claims', {
          method: 'POST',
          body: {
            employeeId: empId ? Number(empId) : null,
            employeeName: empName,
            claimDate,
            origin,
            destination,
            distanceKm: Number(distanceKm),
            ratePerKm: Number(ratePerKm),
            vehicle,
            projectRef,
            notes,
          },
        });
        onNotify('Mileage claim logged.');
      }
      setModalOpen(false);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save mileage claim.', 'error');
    }
  }

  async function handleReimburse(e: FormEvent) {
    e.preventDefault();
    if (!reimburseClaim) return;
    try {
      await apiRequest(`/api/mileage-claims/${reimburseClaim.id}/reimburse`, {
        method: 'POST',
        body: { bankAccountId: Number(reimburseBankId) },
      });
      onNotify(`Mileage claim ${reimburseClaim.ref} reimbursed and posted to GL 6400.`);
      setReimburseClaim(null);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to reimburse mileage.', 'error');
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 inline-flex items-center gap-2">
            <Car className="w-4 h-4 text-orange-700 dark:text-orange-400" />
            <span>Business Mileage Tracking</span>
          </h3>
          <p className="text-xs text-zinc-500">
            Track field service trips, auto-calculate per-km reimbursements, and post to Travel Expense GL 6400.
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={openCreate}
            className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Log Mileage</span>
          </button>
        )}
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                <th className="py-3 px-4 font-medium">Ref · Date</th>
                <th className="py-3 px-4 font-medium">Employee & Vehicle</th>
                <th className="py-3 px-4 font-medium">Route</th>
                <th className="py-3 px-4 font-medium text-right">Distance × Rate</th>
                <th className="py-3 px-4 font-medium text-right">Reimbursement</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {claims.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-zinc-500">
                    No mileage claims recorded yet.
                  </td>
                </tr>
              ) : (
                claims.map((c) => (
                  <tr key={c.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="py-3 px-4 font-mono">
                      <div className="font-medium text-orange-700 dark:text-orange-400">{c.ref}</div>
                      <div className="text-[11px] text-zinc-500">{formatDate(c.claim_date)}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{c.employee_name}</div>
                      <div className="text-[11px] text-zinc-500">
                        {c.vehicle || 'Standard'} {c.project_ref ? `· ${c.project_ref}` : ''}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-zinc-700 dark:text-zinc-300">
                      {c.origin} → {c.destination}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-right text-zinc-500">
                      {c.distance_km} km × {formatCurrency(c.rate_per_km)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-right font-semibold text-zinc-900 dark:text-zinc-100">
                      {formatCurrency(c.total_amount)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusText status={c.status} />
                    </td>
                    <td className="py-3 px-4 text-right space-x-2.5 whitespace-nowrap">
                      {canRecordPay && c.status !== 'paid' && (
                        <button
                          type="button"
                          onClick={() => {
                            setReimburseClaim(c);
                            setReimburseBankId(accounts[0] ? String(accounts[0].id) : '');
                          }}
                          className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Reimburse</span>
                        </button>
                      )}
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => openEdit(c)}
                          title="Edit mileage claim"
                          aria-label={`Edit ${c.ref}`}
                          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center align-middle"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && c.status !== 'paid' && (
                        <button
                          type="button"
                          onClick={() =>
                            onPromptDelete(
                              `/api/mileage-claims/${c.id}`,
                              'Delete Mileage Claim',
                              c.ref
                            )
                          }
                          title="Delete mileage claim"
                          aria-label={`Delete ${c.ref}`}
                          className="text-zinc-400 hover:text-red-600 inline-flex items-center align-middle"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit Mileage Claim ${editing.ref}` : 'Log Mileage Claim'}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Employee</label>
              <select
                value={empId}
                onChange={(e) => {
                  const idVal = e.target.value;
                  setEmpId(idVal);
                  const found = employees.find((emp) => String(emp.id) === idVal);
                  if (found) setEmpName(found.full_name);
                }}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.full_name} ({emp.department})
                  </option>
                ))}
                <option value="">Other / External Driver</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Trip Date</label>
              <input
                type="date"
                required
                value={claimDate}
                onChange={(e) => setClaimDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Origin</label>
              <input
                type="text"
                required
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Destination</label>
              <input
                type="text"
                required
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Customer plant / site"
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Distance (km)</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                required
                value={distanceKm}
                onChange={(e) => setDistanceKm(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Rate / km ($)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={ratePerKm}
                onChange={(e) => setRatePerKm(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Total</label>
              <div className="px-3 py-2 text-sm font-mono tabular-nums font-semibold rounded-lg bg-zinc-100 dark:bg-zinc-800">
                {formatCurrency(computedTotal)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Vehicle</label>
              <input
                type="text"
                value={vehicle}
                onChange={(e) => setVehicle(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Project Ref (optional)</label>
              <input
                type="text"
                value={projectRef}
                onChange={(e) => setProjectRef(e.target.value)}
                placeholder="e.g. PJ2611-0001"
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>

          {editing && editing.status !== 'paid' && (
            <div>
              <label className="block text-xs font-medium mb-1">Claim Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as MileageClaimItem['status'])}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
                <option value="approved">Approved</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">
              {editing ? 'Save Claim' : 'Submit Mileage'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(reimburseClaim)}
        onClose={() => setReimburseClaim(null)}
        title={reimburseClaim ? `Reimburse Mileage — ${reimburseClaim.ref}` : ''}
        subtitle={
          reimburseClaim
            ? `${reimburseClaim.employee_name} · ${formatCurrency(reimburseClaim.total_amount)}`
            : ''
        }
      >
        {reimburseClaim && (
          <form onSubmit={handleReimburse} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1">Pay From Bank / Cash Account</label>
              <select
                required
                value={reimburseBankId}
                onChange={(e) => setReimburseBankId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.ref} — {a.name} ({formatCurrency(a.balance)})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setReimburseClaim(null)}
                className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium"
              >
                Reimburse & Post GL
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

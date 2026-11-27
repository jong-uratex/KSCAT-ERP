import { useMemo, useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import type { Project, ProjectBudgetItem, ProjectProfitabilityRow } from '../../types/erp';
import { Modal } from '../Modal';
import { StatusText } from '../StatusText';

interface FinanceProjectAccountingSectionProps {
  profitability: ProjectProfitabilityRow[];
  budgets: ProjectBudgetItem[];
  projects: Project[];
  canWrite: boolean;
  canDelete: boolean;
  onReload: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPromptDelete: (url: string, title: string, itemLabel: string, warning?: string) => void;
}

export function FinanceProjectAccountingSection({
  profitability,
  budgets,
  projects,
  canWrite,
  canDelete,
  onReload,
  onNotify,
  onPromptDelete,
}: FinanceProjectAccountingSectionProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectBudgetItem | null>(null);
  const [projectId, setProjectId] = useState(projects[0] ? String(projects[0].id) : '');
  const [costCode, setCostCode] = useState('LAB-100');
  const [category, setCategory] = useState('Field Engineering Labor');
  const [description, setDescription] = useState('');
  const [plannedBudget, setPlannedBudget] = useState('5000');
  const [committedAmount, setCommittedAmount] = useState('0');
  const [hourlyCostRate, setHourlyCostRate] = useState('68');
  const [hourlyBillRate, setHourlyBillRate] = useState('155');

  const totals = useMemo(() => {
    const budget = profitability.reduce((s, p) => s + p.planned_budget, 0);
    const rev = profitability.reduce((s, p) => s + p.invoiced_revenue, 0);
    const cost = profitability.reduce((s, p) => s + p.total_actual_cost, 0);
    const profit = rev - cost;
    const unbilled = profitability.reduce((s, p) => s + (p.invoiced_revenue === 0 ? p.billable_labor_value : 0), 0);
    return { budget, rev, cost, profit, unbilled };
  }, [profitability]);

  function openCreate() {
    setEditing(null);
    setProjectId(projects[0] ? String(projects[0].id) : '');
    setCostCode('ENG-100');
    setCategory('Engineering Services');
    setDescription('');
    setPlannedBudget('5000');
    setCommittedAmount('0');
    setHourlyCostRate('68');
    setHourlyBillRate('155');
    setModalOpen(true);
  }

  function openEdit(b: ProjectBudgetItem) {
    setEditing(b);
    setProjectId(String(b.project_id));
    setCostCode(b.cost_code);
    setCategory(b.category);
    setDescription(b.description);
    setPlannedBudget(String(b.planned_budget));
    setCommittedAmount(String(b.committed_amount));
    setHourlyCostRate(String(b.hourly_cost_rate));
    setHourlyBillRate(String(b.hourly_bill_rate));
    setModalOpen(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        projectId: Number(projectId),
        costCode,
        category,
        description,
        plannedBudget: Number(plannedBudget) || 0,
        committedAmount: Number(committedAmount) || 0,
        hourlyCostRate: Number(hourlyCostRate) || 0,
        hourlyBillRate: Number(hourlyBillRate) || 0,
      };
      if (editing) {
        await apiRequest(`/api/finance/project-budgets/${editing.id}`, { method: 'PUT', body: payload });
        onNotify(`Budget line ${costCode} updated.`);
      } else {
        await apiRequest('/api/finance/project-budgets', { method: 'POST', body: payload });
        onNotify('Project budget allocation added.');
      }
      setModalOpen(false);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save project budget.', 'error');
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Total Portfolio Budget</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatCurrency(totals.budget)}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Invoiced Project Revenue</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
            {formatCurrency(totals.rev)}
          </div>
          <div className="text-[11px] text-zinc-500">Unbilled WIP: {formatCurrency(totals.unbilled)}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Recognized Job Costs</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatCurrency(totals.cost)}
          </div>
          <div className="text-[11px] text-zinc-500">Labor + Supplier Bills + GL</div>
        </div>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Portfolio Gross Profit</div>
          <div
            className={`mt-1 text-xl font-semibold font-mono tabular-nums ${
              totals.profit >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
            }`}
          >
            {formatCurrency(totals.profit)}
          </div>
        </div>
      </div>

      {/* Live Project P&L & Job Costing */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Project P&amp;L &amp; Job Costing Breakdown</h3>
          <p className="text-xs text-zinc-500">
            Real-time job profitability combining project-tagged customer invoices, supplier bills, timesheet labor costs, and GL expenses.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                <th className="py-2.5 px-4 font-medium">Project</th>
                <th className="py-2.5 px-4 font-medium text-right">Budget</th>
                <th className="py-2.5 px-4 font-medium text-right">Invoiced Rev</th>
                <th className="py-2.5 px-4 font-medium text-right">Labor Cost</th>
                <th className="py-2.5 px-4 font-medium text-right">Vendor / GL</th>
                <th className="py-2.5 px-4 font-medium text-right">Gross Profit</th>
                <th className="py-2.5 px-4 font-medium text-right">Margin / Burn</th>
                <th className="py-2.5 px-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {profitability.map((row) => (
                <tr key={row.project_id}>
                  <td className="py-2.5 px-4">
                    <div className="font-mono font-medium text-orange-700 dark:text-orange-400">{row.project_ref}</div>
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">{row.project_title}</div>
                    <div className="text-[11px] text-zinc-500">{row.customer_name} · {row.billable_hours}h billable</div>
                  </td>
                  <td className="py-2.5 px-4 font-mono tabular-nums text-right">{formatCurrency(row.planned_budget)}</td>
                  <td className="py-2.5 px-4 font-mono tabular-nums text-right font-medium text-emerald-700 dark:text-emerald-400">
                    {formatCurrency(row.invoiced_revenue)}
                  </td>
                  <td className="py-2.5 px-4 font-mono tabular-nums text-right">{formatCurrency(row.labor_cost)}</td>
                  <td className="py-2.5 px-4 font-mono tabular-nums text-right">
                    {formatCurrency(row.supplier_costs + row.gl_direct_costs)}
                  </td>
                  <td
                    className={`py-2.5 px-4 font-mono tabular-nums text-right font-semibold ${
                      row.gross_profit >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                    }`}
                  >
                    {formatCurrency(row.gross_profit)}
                  </td>
                  <td className="py-2.5 px-4 font-mono tabular-nums text-right">
                    <div>{row.margin_pct.toFixed(1)}% margin</div>
                    <div className="text-[11px] text-zinc-500">{row.budget_utilization_pct.toFixed(1)}% burn</div>
                  </td>
                  <td className="py-2.5 px-4">
                    <StatusText status={row.status} />
                  </td>
                </tr>
              ))}
              {profitability.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-zinc-500">
                    No active projects found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cost Code Budget Allocations CRUD */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Cost Codes &amp; Budget Allocations</h3>
            <p className="text-xs text-zinc-500">Define cost buckets and internal labor cost / client billing rates per project.</p>
          </div>
          {canWrite && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Allocate Budget</span>
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                <th className="py-2.5 px-4 font-medium">Project · Cost Code</th>
                <th className="py-2.5 px-4 font-medium">Category &amp; Description</th>
                <th className="py-2.5 px-4 font-medium text-right">Planned Budget</th>
                <th className="py-2.5 px-4 font-medium text-right">Committed</th>
                <th className="py-2.5 px-4 font-medium text-right">Cost / Bill Rate</th>
                <th className="py-2.5 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {budgets.map((b) => (
                <tr key={b.id}>
                  <td className="py-2.5 px-4">
                    <div className="font-mono font-medium text-orange-700 dark:text-orange-400">
                      {b.project_ref} · {b.cost_code}
                    </div>
                    <div className="text-[11px] text-zinc-500">{b.project_title}</div>
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">{b.category}</div>
                    <div className="text-[11px] text-zinc-500">{b.description}</div>
                  </td>
                  <td className="py-2.5 px-4 font-mono tabular-nums text-right font-semibold">
                    {formatCurrency(b.planned_budget)}
                  </td>
                  <td className="py-2.5 px-4 font-mono tabular-nums text-right">{formatCurrency(b.committed_amount)}</td>
                  <td className="py-2.5 px-4 font-mono tabular-nums text-right text-zinc-600 dark:text-zinc-400">
                    ${b.hourly_cost_rate}/h · ${b.hourly_bill_rate}/h
                  </td>
                  <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => openEdit(b)}
                        title="Edit budget line"
                        aria-label={`Edit ${b.cost_code}`}
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
                            `/api/finance/project-budgets/${b.id}`,
                            'Delete Project Budget Line',
                            `${b.project_ref} · ${b.cost_code}`
                          )
                        }
                        title="Delete budget line"
                        aria-label={`Delete ${b.cost_code}`}
                        className="text-zinc-400 hover:text-red-600 inline-flex items-center align-middle"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {budgets.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-zinc-500">
                    No project cost codes allocated yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit Budget Line ${editing.cost_code}` : 'Allocate Project Cost Code'} maxWidthClass="max-w-lg">
        <form onSubmit={handleSave} className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Project</label>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} required className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs">
                {projects.map((p) => <option key={p.id} value={p.id}>{p.ref} — {p.title}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Cost Code</label>
              <input type="text" value={costCode} onChange={(e) => setCostCode(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Category</label>
              <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Planned Budget ($)</label>
              <input type="number" step="0.01" min="0" value={plannedBudget} onChange={(e) => setPlannedBudget(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Committed ($)</label>
              <input type="number" step="0.01" min="0" value={committedAmount} onChange={(e) => setCommittedAmount(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Cost Rate ($/h)</label>
              <input type="number" step="0.5" min="0" value={hourlyCostRate} onChange={(e) => setHourlyCostRate(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Bill Rate ($/h)</label>
              <input type="number" step="0.5" min="0" value={hourlyBillRate} onChange={(e) => setHourlyBillRate(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Description</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs">Cancel</button>
            <button type="submit" className="h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">Save Budget</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

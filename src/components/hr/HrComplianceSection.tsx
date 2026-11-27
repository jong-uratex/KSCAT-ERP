import { useState, type FormEvent } from 'react';
import { Download, Pencil, Plus, Trash2 } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import type { HrAnalyticsSummary, HrComplianceItem } from '../../types/erp';
import { Modal } from '../Modal';
import { StatusText } from '../StatusText';

interface HrComplianceSectionProps {
  analytics: HrAnalyticsSummary;
  complianceRecords: HrComplianceItem[];
  canWrite: boolean;
  canDelete: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPromptDelete: (url: string, label: string, warning?: string) => void;
}

export function HrComplianceSection({
  analytics,
  complianceRecords,
  canWrite,
  canDelete,
  onRefresh,
  onNotify,
  onPromptDelete,
}: HrComplianceSectionProps) {
  const [compModal, setCompModal] = useState(false);
  const [editingComp, setEditingComp] = useState<HrComplianceItem | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Labor Law');
  const [jurisdiction, setJurisdiction] = useState('Federal / State');
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [ownerName, setOwnerName] = useState('HR Compliance');
  const [complianceRate, setComplianceRate] = useState('100');
  const [status, setStatus] = useState<HrComplianceItem['status']>('compliant');
  const [notes, setNotes] = useState('');

  function openCreateComp() {
    setEditingComp(null);
    setTitle('');
    setCategory('Labor Law');
    setJurisdiction('Federal / State');
    setDueDate(new Date().toISOString().slice(0, 10));
    setOwnerName('HR Compliance');
    setComplianceRate('100');
    setStatus('compliant');
    setNotes('');
    setCompModal(true);
  }

  function openEditComp(c: HrComplianceItem) {
    setEditingComp(c);
    setTitle(c.title);
    setCategory(c.category);
    setJurisdiction(c.jurisdiction);
    setDueDate(c.due_date);
    setOwnerName(c.owner_name);
    setComplianceRate(String(c.compliance_rate));
    setStatus(c.status);
    setNotes(c.notes);
    setCompModal(true);
  }

  async function handleSaveComp(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        title,
        category,
        jurisdiction,
        dueDate,
        ownerName,
        complianceRate: Number(complianceRate) || 0,
        status,
        notes,
      };
      if (editingComp) {
        await apiRequest(`/api/hr/compliance/${editingComp.id}`, { method: 'PUT', body: payload });
        onNotify(`Compliance record ${editingComp.ref} updated.`);
      } else {
        await apiRequest('/api/hr/compliance', { method: 'POST', body: payload });
        onNotify('Compliance item created.');
      }
      setCompModal(false);
      setEditingComp(null);
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save compliance record.', 'error');
    }
  }

  async function handleExportCsv() {
    try {
      const data = await apiRequest<{ csv: string; filename?: string }>('/api/hr/compliance/export');
      const blob = new Blob([data.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.filename || 'hr-compliance-report.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onNotify('HR Compliance CSV report downloaded.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Export failed.', 'error');
    }
  }

  return (
    <div className="space-y-5">
      {/* Workforce & Compliance Analytics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">Active Headcount</div>
          <div className="text-xl font-semibold font-mono tabular-nums mt-1">
            {analytics.activeHeadcount}{' '}
            <span className="text-xs font-normal text-zinc-500">/ {analytics.totalHeadcount} total</span>
          </div>
        </div>
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">Workforce Turnover Rate</div>
          <div className="text-xl font-semibold font-mono tabular-nums mt-1">{analytics.turnoverRatePct}%</div>
        </div>
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">Monthly Payroll Run Rate</div>
          <div className="text-xl font-semibold font-mono tabular-nums text-orange-700 dark:text-orange-400 mt-1">
            {formatCurrency(analytics.monthlyPayrollEstimate)}
          </div>
        </div>
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">Regulatory Compliance</div>
          <div className="text-xl font-semibold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-1">
            {analytics.complianceRatePct}%
          </div>
        </div>
      </div>

      {/* Department Headcount & Cost Breakdown */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-semibold">Headcount & Compensation by Department</span>
          <span className="text-zinc-500 font-mono tabular-nums">
            Overtime Logged: {analytics.totalOvertimeHours.toFixed(2)}h · Onboarding Readiness: {analytics.onboardingCompletionPct}% · Avg KPI: {analytics.avgKpiScore}%
          </span>
        </div>
        <table className="w-full text-left text-xs">
          <thead className="bg-zinc-50 dark:bg-zinc-950 text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-3 font-medium">Department</th>
              <th className="px-4 py-3 font-medium text-right">Active Headcount</th>
              <th className="px-4 py-3 font-medium text-right">Annual Salary Base</th>
              <th className="px-4 py-3 font-medium text-right">Monthly Gross Est.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {analytics.departmentBreakdown.map((dept) => (
              <tr key={dept.department}>
                <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">{dept.department}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{dept.headcount}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{formatCurrency(dept.payroll)}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{formatCurrency(dept.payroll / 12)}</td>
              </tr>
            ))}
            {analytics.departmentBreakdown.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                  No active department staff recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Labor Law & Regulatory Compliance Register */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold">Labor Law & Statutory Compliance Register ({complianceRecords.length})</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
            {canWrite && (
              <button
                type="button"
                onClick={openCreateComp}
                className="px-3.5 py-1.5 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Compliance Item</span>
              </button>
            )}
          </div>
        </div>
        <table className="w-full text-left text-xs">
          <thead className="bg-zinc-50 dark:bg-zinc-950 text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-3 font-medium">Ref</th>
              <th className="px-4 py-3 font-medium">Compliance Obligation</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Jurisdiction</th>
              <th className="px-4 py-3 font-medium">Due Date</th>
              <th className="px-4 py-3 font-medium">Owner</th>
              <th className="px-4 py-3 font-medium text-right">Rate</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {complianceRecords.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-3 font-mono text-orange-700 dark:text-orange-400">{c.ref}</td>
                <td className="px-4 py-3">
                  <div className="font-medium text-zinc-900 dark:text-zinc-100">{c.title}</div>
                  {c.notes && <div className="text-[11px] text-zinc-500 max-w-xs truncate">{c.notes}</div>}
                </td>
                <td className="px-4 py-3">{c.category}</td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{c.jurisdiction}</td>
                <td className="px-4 py-3 font-mono">{formatDate(c.due_date)}</td>
                <td className="px-4 py-3">{c.owner_name}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{c.compliance_rate}%</td>
                <td className="px-4 py-3">
                  <StatusText status={c.status} />
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-1.5">
                    {canWrite && (
                      <button type="button" onClick={() => openEditComp(c)} title={`Edit ${c.ref}`} className="p-1 text-zinc-500 hover:text-orange-700">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {canDelete && (
                      <button type="button" onClick={() => onPromptDelete(`/api/hr/compliance/${c.id}`, `${c.ref} (${c.title})`)} title={`Delete ${c.ref}`} className="p-1 text-zinc-400 hover:text-red-600">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {complianceRecords.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-zinc-500">
                  No compliance obligations registered yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Compliance Create/Edit Modal */}
      <Modal open={compModal} onClose={() => setCompModal(false)} title={editingComp ? `Edit ${editingComp.ref}` : 'Add HR Compliance Record'}>
        <form onSubmit={handleSaveComp} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Compliance Title</label>
            <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                <option value="Labor Law">Labor Law</option>
                <option value="Tax Filing">Tax Filing</option>
                <option value="Safety & OSHA">Safety & OSHA</option>
                <option value="Data Privacy">Data Privacy</option>
                <option value="Mandatory Training">Mandatory Training</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Jurisdiction</label>
              <input type="text" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Due Date</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Owner</label>
              <input type="text" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Compliance Rate (%)</label>
              <input type="number" min="0" max="100" value={complianceRate} onChange={(e) => setComplianceRate(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as HrComplianceItem['status'])} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                <option value="compliant">Compliant</option>
                <option value="due_soon">Due Soon</option>
                <option value="action_required">Action Required</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Notes</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCompModal(false)} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium">{editingComp ? 'Save Record' : 'Create Record'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

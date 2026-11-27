import { useEffect, useState, type FormEvent } from 'react';
import { Award, CheckCircle2, Pencil, Plus, Trash2 } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import type { EmployeeItem, KpiEvaluationItem, KpiMetricItem } from '../../types/erp';
import { Modal } from '../Modal';
import { StatusText } from '../StatusText';
import { computeClientKpiScore, parseKpiMetrics } from './hrHelpers';

interface HrKpiSectionProps {
  employees: EmployeeItem[];
  kpiEvaluations: KpiEvaluationItem[];
  currentUserEmail?: string;
  canWrite: boolean;
  canValidate: boolean;
  canDelete: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPromptDelete: (url: string, label: string, warning?: string) => void;
}

const DEFAULT_KPI_ROWS: KpiMetricItem[] = [
  { id: 'm1', kpiName: 'Core Delivery & SLA Attainment', category: 'Delivery', weightPct: 40, targetValue: '95%', actualValue: '95%', unit: '%', score: 90 },
  { id: 'm2', kpiName: 'Work Quality & Error-Free Execution', category: 'Quality', weightPct: 30, targetValue: '98%', actualValue: '96%', unit: '%', score: 86 },
  { id: 'm3', kpiName: 'Cross-Team Collaboration & Compliance', category: 'Teamwork', weightPct: 30, targetValue: '100%', actualValue: '95%', unit: '%', score: 88 },
];

export function HrKpiSection({
  employees,
  kpiEvaluations,
  currentUserEmail,
  canWrite,
  canValidate,
  canDelete,
  onRefresh,
  onNotify,
  onPromptDelete,
}: HrKpiSectionProps) {
  const [periodFilter, setPeriodFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Modal state
  const [kpiModal, setKpiModal] = useState(false);
  const [editingKpi, setEditingKpi] = useState<KpiEvaluationItem | null>(null);
  const [empId, setEmpId] = useState('');
  const [evaluatorName, setEvaluatorName] = useState(currentUserEmail || 'Department Manager');
  const [reviewPeriod, setReviewPeriod] = useState('2026-Q4');
  const [periodStart, setPeriodStart] = useState('2026-10-01');
  const [periodEnd, setPeriodEnd] = useState('2026-12-31');
  const [status, setStatus] = useState<KpiEvaluationItem['status']>('draft');
  const [metrics, setMetrics] = useState<KpiMetricItem[]>(DEFAULT_KPI_ROWS);
  const [strengths, setStrengths] = useState('');
  const [improvementPlan, setImprovementPlan] = useState('');
  const [employeeComments, setEmployeeComments] = useState('');

  useEffect(() => {
    if (employees[0] && !empId) setEmpId(String(employees[0].id));
  }, [employees]);

  const periods = Array.from(new Set(kpiEvaluations.map((k) => k.review_period).filter(Boolean))).sort().reverse();
  const filtered = kpiEvaluations.filter((k) => periodFilter === 'all' || k.review_period === periodFilter);

  useEffect(() => {
    if (filtered.length > 0 && (!selectedId || !filtered.some((k) => k.id === selectedId))) {
      setSelectedId(filtered[0].id);
    } else if (filtered.length === 0) {
      setSelectedId(null);
    }
  }, [filtered, selectedId]);

  const activeCard = filtered.find((k) => k.id === selectedId) ?? null;

  const avgScore =
    filtered.length > 0
      ? (filtered.reduce((acc, k) => acc + (Number(k.overall_score) || 0), 0) / filtered.length).toFixed(1)
      : '0.0';
  const approvedCount = filtered.filter((k) => k.status === 'approved').length;
  const exceedsCount = filtered.filter((k) => k.overall_score >= 90).length;

  function openCreateKpi() {
    setEditingKpi(null);
    if (employees[0] && !empId) setEmpId(String(employees[0].id));
    setEvaluatorName(currentUserEmail || 'Department Manager');
    setReviewPeriod('2026-Q4');
    setPeriodStart('2026-10-01');
    setPeriodEnd('2026-12-31');
    setStatus('draft');
    setMetrics(DEFAULT_KPI_ROWS.map((r) => ({ ...r })));
    setStrengths('');
    setImprovementPlan('');
    setEmployeeComments('');
    setKpiModal(true);
  }

  function openEditKpi(item: KpiEvaluationItem) {
    setEditingKpi(item);
    setEmpId(String(item.employee_id));
    setEvaluatorName(item.evaluator_name);
    setReviewPeriod(item.review_period);
    setPeriodStart(item.period_start);
    setPeriodEnd(item.period_end);
    setStatus(item.status);
    const parsed = parseKpiMetrics(item.metrics_json);
    setMetrics(parsed.length > 0 ? parsed : DEFAULT_KPI_ROWS.map((r) => ({ ...r })));
    setStrengths(item.strengths);
    setImprovementPlan(item.improvement_plan);
    setEmployeeComments(item.employee_comments);
    setKpiModal(true);
  }

  function updateMetricRow(index: number, patch: Partial<KpiMetricItem>) {
    setMetrics((prev) => prev.map((row, idx) => (idx === index ? { ...row, ...patch } : row)));
  }

  function addMetricRow() {
    setMetrics((prev) => [
      ...prev,
      {
        id: `m${Date.now()}`,
        kpiName: '',
        category: 'Operations',
        weightPct: 20,
        targetValue: '100%',
        actualValue: '',
        unit: '%',
        score: 80,
      },
    ]);
  }

  function removeMetricRow(index: number) {
    setMetrics((prev) => prev.filter((_, idx) => idx !== index));
  }

  async function handleSaveKpi(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        employeeId: Number(empId),
        evaluatorName,
        reviewPeriod,
        periodStart,
        periodEnd,
        metrics,
        strengths,
        improvementPlan,
        employeeComments,
        status,
      };
      if (editingKpi) {
        await apiRequest(`/api/hr/kpi-evaluations/${editingKpi.id}`, { method: 'PUT', body: payload });
        onNotify(`KPI evaluation ${editingKpi.ref} updated.`);
      } else {
        const created = await apiRequest<KpiEvaluationItem>('/api/hr/kpi-evaluations', { method: 'POST', body: payload });
        onNotify(`KPI scorecard ${created.ref} created.`);
        setSelectedId(created.id);
      }
      setKpiModal(false);
      setEditingKpi(null);
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save KPI evaluation.', 'error');
    }
  }

  async function handleApproveKpi(item: KpiEvaluationItem) {
    try {
      await apiRequest(`/api/hr/kpi-evaluations/${item.id}/decide`, { method: 'POST', body: { status: 'approved' } });
      onNotify(`KPI scorecard ${item.ref} approved.`);
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to approve KPI scorecard.', 'error');
    }
  }

  const livePreview = computeClientKpiScore(metrics);
  const weightSum = metrics.reduce((acc, m) => acc + (Number(m.weightPct) || 0), 0);

  return (
    <div className="space-y-5">
      {/* KPI Overview Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">Evaluations Logged</div>
          <div className="text-xl font-semibold font-mono tabular-nums mt-1">{filtered.length}</div>
        </div>
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">Average Weighted KPI</div>
          <div className="text-xl font-semibold font-mono tabular-nums text-orange-700 dark:text-orange-400 mt-1">
            {avgScore}%
          </div>
        </div>
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">Exceeds Expectations (≥90%)</div>
          <div className="text-xl font-semibold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-1">
            {exceedsCount}
          </div>
        </div>
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs text-zinc-500">Finalized / Approved</div>
          <div className="text-xl font-semibold font-mono tabular-nums mt-1">{approvedCount}</div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-500">Review Cycle:</label>
          <select
            value={periodFilter}
            onChange={(e) => setPeriodFilter(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
          >
            <option value="all">All Review Periods</option>
            {periods.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        {canWrite && (
          <button
            type="button"
            onClick={openCreateKpi}
            className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap self-start sm:self-auto"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New KPI Evaluation</span>
          </button>
        )}
      </div>

      {/* Scorecards Table */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-zinc-50 dark:bg-zinc-950 text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-3 font-medium">Ref</th>
              <th className="px-4 py-3 font-medium">Employee</th>
              <th className="px-4 py-3 font-medium">Review Period</th>
              <th className="px-4 py-3 font-medium">Evaluator</th>
              <th className="px-4 py-3 font-medium text-right">Weighted Score</th>
              <th className="px-4 py-3 font-medium">Performance Tier</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {filtered.map((item) => (
              <tr
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className={`cursor-pointer ${
                  selectedId === item.id
                    ? 'bg-orange-50/50 dark:bg-orange-950/20'
                    : 'hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40'
                }`}
              >
                <td className="px-4 py-3 font-mono text-orange-700 dark:text-orange-400">{item.ref}</td>
                <td className="px-4 py-3">
                  <div className="font-medium text-zinc-900 dark:text-zinc-100">{item.employee_name}</div>
                  <div className="text-[11px] text-zinc-500">
                    {item.job_title || 'Staff'} · {item.department}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono">{item.review_period}</td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{item.evaluator_name}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold">
                  {Number(item.overall_score).toFixed(1)}%
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`font-medium ${
                      item.overall_score >= 90
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : item.overall_score >= 75
                          ? 'text-orange-700 dark:text-orange-400'
                          : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {item.rating_label}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <StatusText status={item.status} />
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <div className="inline-flex items-center gap-2">
                    {canValidate && item.status !== 'approved' && (
                      <button
                        type="button"
                        onClick={() => handleApproveKpi(item)}
                        className="text-emerald-700 dark:text-emerald-400 font-medium inline-flex items-center gap-1 hover:underline"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Approve</span>
                      </button>
                    )}
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => openEditKpi(item)}
                        title={`Edit ${item.ref}`}
                        className="p-1 text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() =>
                          onPromptDelete(
                            `/api/hr/kpi-evaluations/${item.id}`,
                            `${item.ref} (${item.employee_name} · ${item.review_period})`
                          )
                        }
                        title={`Delete ${item.ref}`}
                        className="p-1 text-zinc-400 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-zinc-500">
                  No KPI evaluations recorded for this cycle yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Detailed Selected KPI Scorecard Breakdown */}
      {activeCard && (
        <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800 pb-3">
            <div>
              <div className="text-xs text-zinc-500">
                <span className="font-mono text-orange-700 dark:text-orange-400 mr-2">{activeCard.ref}</span>
                Period {activeCard.review_period} · Evaluator: {activeCard.evaluator_name}
              </div>
              <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5 flex items-center gap-2">
                <Award className="w-4 h-4 text-orange-700 dark:text-orange-400" />
                <span>{activeCard.employee_name} — Performance Scorecard</span>
              </h3>
            </div>
            <div className="text-right">
              <div className="text-xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                {Number(activeCard.overall_score).toFixed(1)}%
              </div>
              <div className="text-xs text-zinc-500">{activeCard.rating_label}</div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className="py-2 pr-3 font-medium">KPI Metric</th>
                  <th className="py-2 px-3 font-medium">Category</th>
                  <th className="py-2 px-3 font-medium text-right">Weight</th>
                  <th className="py-2 px-3 font-medium">Target</th>
                  <th className="py-2 px-3 font-medium">Actual</th>
                  <th className="py-2 pl-3 font-medium text-right">Attainment Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {parseKpiMetrics(activeCard.metrics_json).map((m, idx) => (
                  <tr key={m.id || idx}>
                    <td className="py-2.5 pr-3 font-medium text-zinc-900 dark:text-zinc-100">{m.kpiName}</td>
                    <td className="py-2.5 px-3 text-zinc-500">{m.category}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">{m.weightPct}%</td>
                    <td className="py-2.5 px-3 font-mono">{m.targetValue || '—'}</td>
                    <td className="py-2.5 px-3 font-mono">{m.actualValue || '—'}</td>
                    <td className="py-2.5 pl-3 text-right font-mono tabular-nums font-semibold">
                      {m.score} / 100
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-zinc-100 dark:border-zinc-800 text-xs">
            <div>
              <div className="font-semibold text-zinc-800 dark:text-zinc-200 mb-1">Key Strengths</div>
              <p className="text-zinc-600 dark:text-zinc-400">{activeCard.strengths || 'No strengths noted yet.'}</p>
            </div>
            <div>
              <div className="font-semibold text-zinc-800 dark:text-zinc-200 mb-1">Development & Action Plan</div>
              <p className="text-zinc-600 dark:text-zinc-400">
                {activeCard.improvement_plan || 'No development items noted.'}
              </p>
            </div>
            <div>
              <div className="font-semibold text-zinc-800 dark:text-zinc-200 mb-1">Employee Self-Review Notes</div>
              <p className="text-zinc-600 dark:text-zinc-400">
                {activeCard.employee_comments || 'Pending employee sign-off comments.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* KPI Create / Edit Modal */}
      <Modal
        open={kpiModal}
        onClose={() => {
          setKpiModal(false);
          setEditingKpi(null);
        }}
        title={editingKpi ? `Edit KPI Scorecard ${editingKpi.ref}` : 'Create KPI Evaluation Scorecard'}
        maxWidthClass="max-w-3xl"
      >
        <form onSubmit={handleSaveKpi} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Employee</label>
              <select
                required
                value={empId}
                onChange={(e) => setEmpId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name} ({e.department})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Review Period</label>
              <input
                type="text"
                required
                value={reviewPeriod}
                onChange={(e) => setReviewPeriod(e.target.value)}
                placeholder="2026-Q4"
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Workflow Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as KpiEvaluationItem['status'])}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="draft">Draft</option>
                <option value="self_review">Self Review</option>
                <option value="submitted">Submitted</option>
                <option value="approved">Approved</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Evaluator</label>
              <input
                type="text"
                value={evaluatorName}
                onChange={(e) => setEvaluatorName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Period Start</label>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Period End</label>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>

          {/* Weighted KPI Rows */}
          <div className="space-y-2 border-t border-b border-zinc-200 dark:border-zinc-800 py-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold">
                Weighted KPI Metrics (Total Weight:{' '}
                <span className={`font-mono ${weightSum === 100 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                  {weightSum}%
                </span>{' '}
                · Live Score: <span className="font-mono text-orange-700 dark:text-orange-400">{livePreview.score}% · {livePreview.rating}</span>)
              </span>
              <button
                type="button"
                onClick={addMetricRow}
                className="px-2.5 py-1 rounded border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
              >
                + Add KPI Metric
              </button>
            </div>
            <div className="space-y-2">
              {metrics.map((row, idx) => (
                <div key={row.id || idx} className="grid grid-cols-12 gap-2 items-center text-xs">
                  <input
                    type="text"
                    placeholder="KPI name"
                    required
                    value={row.kpiName}
                    onChange={(e) => updateMetricRow(idx, { kpiName: e.target.value })}
                    className="col-span-4 px-2.5 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                  />
                  <input
                    type="text"
                    placeholder="Category"
                    value={row.category}
                    onChange={(e) => updateMetricRow(idx, { category: e.target.value })}
                    className="col-span-2 px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                  />
                  <input
                    type="number"
                    min="0"
                    max="100"
                    title="Weight %"
                    placeholder="Wt%"
                    value={row.weightPct}
                    onChange={(e) => updateMetricRow(idx, { weightPct: Number(e.target.value) || 0 })}
                    className="col-span-1 px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
                  />
                  <input
                    type="text"
                    placeholder="Target"
                    value={row.targetValue}
                    onChange={(e) => updateMetricRow(idx, { targetValue: e.target.value })}
                    className="col-span-2 px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
                  />
                  <input
                    type="text"
                    placeholder="Actual"
                    value={row.actualValue}
                    onChange={(e) => updateMetricRow(idx, { actualValue: e.target.value })}
                    className="col-span-1 px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
                  />
                  <input
                    type="number"
                    min="0"
                    max="100"
                    title="Score (0-100)"
                    placeholder="Score"
                    value={row.score}
                    onChange={(e) => updateMetricRow(idx, { score: Number(e.target.value) || 0 })}
                    className="col-span-1 px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => removeMetricRow(idx)}
                    disabled={metrics.length <= 1}
                    title="Remove metric row"
                    className="col-span-1 p-1.5 text-zinc-400 hover:text-red-600 disabled:opacity-30 justify-self-end"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Strengths & Achievements</label>
              <textarea
                rows={2}
                value={strengths}
                onChange={(e) => setStrengths(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Improvement / Development Plan</label>
              <textarea
                rows={2}
                value={improvementPlan}
                onChange={(e) => setImprovementPlan(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Employee Comments</label>
            <textarea
              rows={2}
              value={employeeComments}
              onChange={(e) => setEmployeeComments(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setKpiModal(false)} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium">
              {editingKpi ? 'Save KPI Evaluation' : 'Create Scorecard'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { Download, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import type {
  BenefitEnrollmentItem,
  BenefitPlanItem,
  EmployeeItem,
  ExpenseReportItem,
  PayrollRunItem,
  PayslipItem,
} from '../../types/erp';
import { Modal } from '../Modal';
import { StatusText } from '../StatusText';
import { downloadPayslipDocument } from './hrHelpers';

interface HrPayrollBenefitsSectionProps {
  employees: EmployeeItem[];
  payrollRuns: PayrollRunItem[];
  payslips: PayslipItem[];
  benefitPlans: BenefitPlanItem[];
  benefitEnrollments: BenefitEnrollmentItem[];
  expenseReports: ExpenseReportItem[];
  canWrite: boolean;
  canValidate: boolean;
  canDelete: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPromptDelete: (url: string, label: string, warning?: string) => void;
}

export function HrPayrollBenefitsSection({
  employees,
  payrollRuns,
  payslips,
  benefitPlans,
  benefitEnrollments,
  expenseReports,
  canWrite,
  canValidate,
  canDelete,
  onRefresh,
  onNotify,
  onPromptDelete,
}: HrPayrollBenefitsSectionProps) {
  const [subTab, setSubTab] = useState<'payroll' | 'benefits' | 'expenses'>('payroll');

  // Run Payroll Modal
  const [runModal, setRunModal] = useState(false);
  const [editingRun, setEditingRun] = useState<PayrollRunItem | null>(null);
  const [payPeriod, setPayPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [taxRatePct, setTaxRatePct] = useState('15');
  const [socialRatePct, setSocialRatePct] = useState('4.5');
  const [includeOt, setIncludeOt] = useState(true);
  const [runStatus, setRunStatus] = useState<PayrollRunItem['status']>('processed');

  // Edit Payslip Modal
  const [slipModal, setSlipModal] = useState(false);
  const [editingSlip, setEditingSlip] = useState<PayslipItem | null>(null);
  const [slGross, setSlGross] = useState('0');
  const [slTax, setSlTax] = useState('0');
  const [slSocial, setSlSocial] = useState('0');
  const [slHealth, setSlHealth] = useState('0');
  const [slOther, setSlOther] = useState('0');
  const [slDepositRef, setSlDepositRef] = useState('');
  const [slStatus, setSlStatus] = useState<'generated' | 'paid'>('generated');

  // Benefit Plan Modal
  const [planModal, setPlanModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<BenefitPlanItem | null>(null);
  const [plName, setPlName] = useState('');
  const [plProvider, setPlProvider] = useState('');
  const [plCat, setPlCat] = useState('Health Insurance');
  const [plEmployer, setPlEmployer] = useState('400');
  const [plEmployee, setPlEmployee] = useState('120');
  const [plDesc, setPlDesc] = useState('');
  const [plStatus, setPlStatus] = useState<'active' | 'archived'>('active');

  // Benefit Enrollment Modal
  const [enrModal, setEnrModal] = useState(false);
  const [editingEnr, setEditingEnr] = useState<BenefitEnrollmentItem | null>(null);
  const [enEmpId, setEnEmpId] = useState('');
  const [enPlanId, setEnPlanId] = useState('');
  const [enTier, setEnTier] = useState('Employee Only');
  const [enDate, setEnDate] = useState(new Date().toISOString().slice(0, 10));
  const [enStatus, setEnStatus] = useState<BenefitEnrollmentItem['status']>('active');
  const [enNotes, setEnNotes] = useState('');

  // Expense Modal
  const [expModal, setExpModal] = useState(false);
  const [editingExp, setEditingExp] = useState<ExpenseReportItem | null>(null);
  const [expEmpId, setExpEmpId] = useState('');
  const [expCat, setExpCat] = useState('Travel & Lodging');
  const [expDate, setExpDate] = useState(new Date().toISOString().slice(0, 10));
  const [expAmount, setExpAmount] = useState('145.00');
  const [expTax, setExpTax] = useState('24.17');
  const [expDesc, setExpDesc] = useState('');

  useEffect(() => {
    if (employees[0]) {
      const first = String(employees[0].id);
      if (!enEmpId) setEnEmpId(first);
      if (!expEmpId) setExpEmpId(first);
    }
    if (benefitPlans[0] && !enPlanId) {
      setEnPlanId(String(benefitPlans[0].id));
    }
  }, [employees, benefitPlans]);

  function openCreateRun() {
    setEditingRun(null);
    setPayPeriod(new Date().toISOString().slice(0, 7));
    setPayDate(new Date().toISOString().slice(0, 10));
    setTaxRatePct('15');
    setSocialRatePct('4.5');
    setIncludeOt(true);
    setRunModal(true);
  }

  function openEditRun(run: PayrollRunItem) {
    setEditingRun(run);
    setPayPeriod(run.pay_period);
    setPayDate(run.pay_date);
    setRunStatus(run.status);
    setRunModal(true);
  }

  async function handleSaveRun(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingRun) {
        await apiRequest(`/api/hr/payroll-runs/${editingRun.id}`, {
          method: 'PUT',
          body: { payPeriod, payDate, status: runStatus },
        });
        onNotify(`Payroll run ${editingRun.ref} updated.`);
      } else {
        const created = await apiRequest<PayrollRunItem>('/api/hr/payroll-runs', {
          method: 'POST',
          body: {
            payPeriod,
            payDate,
            taxRatePct: Number(taxRatePct) || 0,
            socialRatePct: Number(socialRatePct) || 0,
            includeOvertime: includeOt,
          },
        });
        onNotify(`Payroll ${created.ref} processed for ${created.employee_count} staff.`);
      }
      setRunModal(false);
      setEditingRun(null);
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to process payroll.', 'error');
    }
  }

  async function handleMarkPaid(id: number) {
    try {
      await apiRequest(`/api/hr/payroll-runs/${id}/mark-paid`, { method: 'POST', body: {} });
      onNotify('Direct deposits marked as disbursed.');
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to disburse payroll.', 'error');
    }
  }

  function openEditSlip(s: PayslipItem) {
    setEditingSlip(s);
    setSlGross(String(s.gross_pay));
    setSlTax(String(s.tax_deduction));
    setSlSocial(String(s.social_deduction));
    setSlHealth(String(s.health_deduction));
    setSlOther(String(s.other_deductions));
    setSlDepositRef(s.direct_deposit_ref);
    setSlStatus(s.status);
    setSlipModal(true);
  }

  async function handleSaveSlip(e: FormEvent) {
    e.preventDefault();
    if (!editingSlip) return;
    try {
      await apiRequest(`/api/hr/payslips/${editingSlip.id}`, {
        method: 'PUT',
        body: {
          grossPay: Number(slGross) || 0,
          taxDeduction: Number(slTax) || 0,
          socialDeduction: Number(slSocial) || 0,
          healthDeduction: Number(slHealth) || 0,
          otherDeductions: Number(slOther) || 0,
          directDepositRef: slDepositRef,
          status: slStatus,
        },
      });
      onNotify(`Payslip ${editingSlip.ref} recalculated.`);
      setSlipModal(false);
      setEditingSlip(null);
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update payslip.', 'error');
    }
  }

  function openCreatePlan() {
    setEditingPlan(null);
    setPlName('');
    setPlProvider('');
    setPlCat('Health Insurance');
    setPlEmployer('400');
    setPlEmployee('120');
    setPlDesc('');
    setPlStatus('active');
    setPlanModal(true);
  }

  function openEditPlan(pl: BenefitPlanItem) {
    setEditingPlan(pl);
    setPlName(pl.name);
    setPlProvider(pl.provider);
    setPlCat(pl.category);
    setPlEmployer(String(pl.employer_contribution));
    setPlEmployee(String(pl.employee_contribution));
    setPlDesc(pl.description);
    setPlStatus(pl.status);
    setPlanModal(true);
  }

  async function handleSavePlan(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        name: plName,
        provider: plProvider,
        category: plCat,
        employerContribution: Number(plEmployer) || 0,
        employeeContribution: Number(plEmployee) || 0,
        description: plDesc,
        status: plStatus,
      };
      if (editingPlan) {
        await apiRequest(`/api/hr/benefit-plans/${editingPlan.id}`, { method: 'PUT', body: payload });
        onNotify(`Benefit plan ${editingPlan.ref} updated.`);
      } else {
        await apiRequest('/api/hr/benefit-plans', { method: 'POST', body: payload });
        onNotify('Benefit plan created.');
      }
      setPlanModal(false);
      setEditingPlan(null);
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save benefit plan.', 'error');
    }
  }

  function openCreateEnr() {
    setEditingEnr(null);
    if (employees[0] && !enEmpId) setEnEmpId(String(employees[0].id));
    if (benefitPlans[0] && !enPlanId) setEnPlanId(String(benefitPlans[0].id));
    setEnTier('Employee Only');
    setEnDate(new Date().toISOString().slice(0, 10));
    setEnStatus('active');
    setEnNotes('');
    setEnrModal(true);
  }

  function openEditEnr(enr: BenefitEnrollmentItem) {
    setEditingEnr(enr);
    setEnEmpId(String(enr.employee_id));
    setEnPlanId(String(enr.plan_id));
    setEnTier(enr.coverage_tier);
    setEnDate(enr.enrollment_date);
    setEnStatus(enr.status);
    setEnNotes(enr.notes);
    setEnrModal(true);
  }

  async function handleSaveEnr(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        employeeId: Number(enEmpId),
        planId: Number(enPlanId),
        coverageTier: enTier,
        enrollmentDate: enDate,
        status: enStatus,
        notes: enNotes,
      };
      if (editingEnr) {
        await apiRequest(`/api/hr/benefit-enrollments/${editingEnr.id}`, { method: 'PUT', body: payload });
        onNotify('Benefit enrollment updated.');
      } else {
        await apiRequest('/api/hr/benefit-enrollments', { method: 'POST', body: payload });
        onNotify('Employee enrolled in benefit plan.');
      }
      setEnrModal(false);
      setEditingEnr(null);
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save enrollment.', 'error');
    }
  }

  function openCreateExp() {
    setEditingExp(null);
    if (employees[0] && !expEmpId) setExpEmpId(String(employees[0].id));
    setExpCat('Travel & Lodging');
    setExpDate(new Date().toISOString().slice(0, 10));
    setExpAmount('145.00');
    setExpTax('24.17');
    setExpDesc('');
    setExpModal(true);
  }

  function openEditExp(exp: ExpenseReportItem) {
    setEditingExp(exp);
    setExpEmpId(String(exp.employee_id));
    setExpCat(exp.category);
    setExpDate(exp.expense_date);
    setExpAmount(String(exp.amount));
    setExpTax(String(exp.tax_amount));
    setExpDesc(exp.description ?? '');
    setExpModal(true);
  }

  async function handleSaveExpense(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        employeeId: Number(expEmpId),
        category: expCat,
        expenseDate: expDate,
        amount: Number(expAmount),
        taxAmount: Number(expTax) || 0,
        description: expDesc,
      };
      if (editingExp) {
        await apiRequest(`/api/expense-reports/${editingExp.id}`, { method: 'PUT', body: payload });
        onNotify(`Expense report ${editingExp.ref} updated.`);
      } else {
        await apiRequest('/api/expense-reports', { method: 'POST', body: payload });
        onNotify('Expense report submitted.');
      }
      setExpModal(false);
      setEditingExp(null);
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save expense report.', 'error');
    }
  }

  async function handleDecideExpense(id: number, status: 'approved' | 'paid' | 'rejected') {
    try {
      await apiRequest(`/api/expense-reports/${id}/decide`, { method: 'POST', body: { status } });
      onNotify(`Expense report marked ${status}.`);
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update expense.', 'error');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 self-start">
          {[
            { key: 'payroll', label: `Payroll & Payslips (${payslips.length})` },
            { key: 'benefits', label: `Benefits & Plans (${benefitEnrollments.length})` },
            { key: 'expenses', label: `Expense Claims (${expenseReports.length})` },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setSubTab(item.key as typeof subTab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
                subTab === item.key
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            {subTab === 'payroll' && (
              <button
                type="button"
                onClick={openCreateRun}
                className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Run Payroll</span>
              </button>
            )}
            {subTab === 'benefits' && (
              <>
                <button
                  type="button"
                  onClick={openCreatePlan}
                  className="px-3.5 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Plan</span>
                </button>
                <button
                  type="button"
                  onClick={openCreateEnr}
                  disabled={benefitPlans.length === 0}
                  className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 disabled:opacity-50 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Enroll Staff</span>
                </button>
              </>
            )}
            {subTab === 'expenses' && (
              <button
                type="button"
                onClick={openCreateExp}
                className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Submit Expense</span>
              </button>
            )}
          </div>
        )}
      </div>

      {subTab === 'payroll' && (
        <div className="space-y-5">
          {/* Payroll Runs */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 text-xs font-semibold">
              Payroll Batches ({payrollRuns.length})
            </div>
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50 dark:bg-zinc-950 text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Run Ref</th>
                  <th className="px-4 py-3 font-medium">Period</th>
                  <th className="px-4 py-3 font-medium">Pay Date</th>
                  <th className="px-4 py-3 font-medium text-right">Staff</th>
                  <th className="px-4 py-3 font-medium text-right">Gross Total</th>
                  <th className="px-4 py-3 font-medium text-right">Deductions</th>
                  <th className="px-4 py-3 font-medium text-right">Net Disbursed</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {payrollRuns.map((run) => (
                  <tr key={run.id}>
                    <td className="px-4 py-3 font-mono text-orange-700 dark:text-orange-400">{run.ref}</td>
                    <td className="px-4 py-3 font-mono">{run.pay_period}</td>
                    <td className="px-4 py-3 font-mono">{formatDate(run.pay_date)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{run.employee_count}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{formatCurrency(run.total_gross)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-500">
                      -{formatCurrency(run.total_deductions)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(run.total_net)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={run.status} />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        {canValidate && run.status !== 'paid' && (
                          <button
                            type="button"
                            onClick={() => handleMarkPaid(run.id)}
                            className="text-emerald-700 dark:text-emerald-400 font-medium hover:underline"
                          >
                            Mark Paid
                          </button>
                        )}
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => openEditRun(run)}
                            title={`Edit ${run.ref}`}
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
                                `/api/hr/payroll-runs/${run.id}`,
                                `${run.ref} (${run.pay_period})`,
                                'Deleting this payroll run removes all linked payslip statements.'
                              )
                            }
                            title={`Delete ${run.ref}`}
                            className="p-1 text-zinc-400 hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {payrollRuns.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-zinc-500">
                      No payroll runs executed yet. Click Run Payroll to generate monthly statements.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Individual Payslips */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 text-xs font-semibold">
              Employee Payslips & Direct Deposits ({payslips.length})
            </div>
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50 dark:bg-zinc-950 text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Payslip Ref</th>
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Period</th>
                  <th className="px-4 py-3 font-medium text-right">Gross</th>
                  <th className="px-4 py-3 font-medium text-right">Tax</th>
                  <th className="px-4 py-3 font-medium text-right">Social</th>
                  <th className="px-4 py-3 font-medium text-right">Benefits</th>
                  <th className="px-4 py-3 font-medium text-right">Net Pay</th>
                  <th className="px-4 py-3 font-medium">Deposit Ref</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {payslips.map((slip) => (
                  <tr key={slip.id}>
                    <td className="px-4 py-3 font-mono text-orange-700 dark:text-orange-400">{slip.ref}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{slip.employee_name}</div>
                      <div className="text-[11px] text-zinc-500">{slip.department || 'Staff'}</div>
                    </td>
                    <td className="px-4 py-3 font-mono">{slip.pay_period}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{formatCurrency(slip.gross_pay)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-500">
                      -{formatCurrency(slip.tax_deduction)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-500">
                      -{formatCurrency(slip.social_deduction)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-500">
                      -{formatCurrency(slip.health_deduction)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold">
                      {formatCurrency(slip.net_pay)}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-zinc-500">{slip.direct_deposit_ref}</td>
                    <td className="px-4 py-3">
                      <StatusText status={slip.status} />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => downloadPayslipDocument(slip)}
                          title={`Download ${slip.ref}`}
                          className="p-1 text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => openEditSlip(slip)}
                            title={`Edit ${slip.ref}`}
                            className="p-1 text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => onPromptDelete(`/api/hr/payslips/${slip.id}`, `${slip.ref} (${slip.employee_name})`)}
                            title={`Delete ${slip.ref}`}
                            className="p-1 text-zinc-400 hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {payslips.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-zinc-500">
                      No payslips generated yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'benefits' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {benefitPlans.map((pl) => (
              <div key={pl.id} className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-2">
                <div className="flex items-center justify-between text-xs gap-2">
                  <span className="font-mono text-orange-700 dark:text-orange-400">{pl.ref}</span>
                  <div className="flex items-center gap-2">
                    <StatusText status={pl.status} />
                    {canWrite && (
                      <button type="button" onClick={() => openEditPlan(pl)} title={`Edit ${pl.ref}`} className="p-1 text-zinc-500 hover:text-orange-700">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => onPromptDelete(`/api/hr/benefit-plans/${pl.id}`, `${pl.ref} (${pl.name})`)}
                        title={`Delete ${pl.ref}`}
                        className="p-1 text-zinc-400 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{pl.name}</h3>
                <div className="text-xs text-zinc-500">
                  {pl.category} · {pl.provider || 'Corporate Plan'}
                </div>
                <div className="text-xs font-mono tabular-nums text-zinc-700 dark:text-zinc-300 pt-1">
                  Employer: {formatCurrency(pl.employer_contribution)}/mo · Employee: {formatCurrency(pl.employee_contribution)}/mo
                </div>
                {pl.description && <p className="text-xs text-zinc-500">{pl.description}</p>}
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 text-xs font-semibold">
              Staff Benefits Enrollments ({benefitEnrollments.length})
            </div>
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50 dark:bg-zinc-950 text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Benefit Plan</th>
                  <th className="px-4 py-3 font-medium">Coverage Tier</th>
                  <th className="px-4 py-3 font-medium">Effective</th>
                  <th className="px-4 py-3 font-medium text-right">Staff Deduction</th>
                  <th className="px-4 py-3 font-medium text-right">Employer Share</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {benefitEnrollments.map((enr) => (
                  <tr key={enr.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{enr.employee_name}</div>
                      <div className="text-[11px] text-zinc-500">{enr.department}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-orange-700 dark:text-orange-400 mr-1.5">{enr.plan_ref}</span>
                      <span>{enr.plan_name}</span>
                    </td>
                    <td className="px-4 py-3">{enr.coverage_tier}</td>
                    <td className="px-4 py-3 font-mono">{formatDate(enr.enrollment_date)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{formatCurrency(enr.employee_contribution)}/mo</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(enr.employer_contribution)}/mo
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={enr.status} />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {canWrite && (
                          <button type="button" onClick={() => openEditEnr(enr)} title="Edit enrollment" className="p-1 text-zinc-500 hover:text-orange-700">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => onPromptDelete(`/api/hr/benefit-enrollments/${enr.id}`, `${enr.employee_name} · ${enr.plan_name}`)}
                            title="Delete enrollment"
                            className="p-1 text-zinc-400 hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {benefitEnrollments.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-zinc-500">
                      No staff benefit enrollments yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'expenses' && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-50 dark:bg-zinc-950 text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-3 font-medium">Ref</th>
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium text-right">Amount</th>
                <th className="px-4 py-3 font-medium text-right">VAT</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {expenseReports.map((exp) => (
                <tr key={exp.id}>
                  <td className="px-4 py-3 font-mono text-orange-700 dark:text-orange-400">{exp.ref}</td>
                  <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">{exp.employee_name}</td>
                  <td className="px-4 py-3">{exp.category}</td>
                  <td className="px-4 py-3 font-mono">{formatDate(exp.expense_date)}</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400 max-w-xs truncate">{exp.description || '—'}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums font-medium">{formatCurrency(exp.amount)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-500">{formatCurrency(exp.tax_amount)}</td>
                  <td className="px-4 py-3">
                    <StatusText status={exp.status} />
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-2">
                      {canValidate && (exp.status === 'submitted' || exp.status === 'draft') && (
                        <>
                          <button type="button" onClick={() => handleDecideExpense(exp.id, 'approved')} className="text-orange-700 dark:text-orange-400 font-medium hover:underline">
                            Approve
                          </button>
                          <button type="button" onClick={() => handleDecideExpense(exp.id, 'rejected')} className="text-red-700 dark:text-red-400 font-medium hover:underline">
                            Reject
                          </button>
                        </>
                      )}
                      {canValidate && exp.status === 'approved' && (
                        <button type="button" onClick={() => handleDecideExpense(exp.id, 'paid')} className="text-emerald-700 dark:text-emerald-400 font-medium hover:underline">
                          Mark Reimbursed
                        </button>
                      )}
                      {canWrite && (
                        <button type="button" onClick={() => openEditExp(exp)} title={`Edit ${exp.ref}`} className="p-1 text-zinc-500 hover:text-orange-700">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => onPromptDelete(`/api/expense-reports/${exp.id}`, `${exp.ref} (${exp.employee_name})`)}
                          title={`Delete ${exp.ref}`}
                          className="p-1 text-zinc-400 hover:text-red-600"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {expenseReports.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-zinc-500">
                    No expense reports submitted.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Run/Edit Payroll Modal */}
      <Modal
        open={runModal}
        onClose={() => {
          setRunModal(false);
          setEditingRun(null);
        }}
        title={editingRun ? `Edit ${editingRun.ref}` : 'Run Automated Monthly Payroll'}
      >
        <form onSubmit={handleSaveRun} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Pay Period (YYYY-MM)</label>
              <input
                type="month"
                required
                value={payPeriod}
                onChange={(e) => setPayPeriod(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Disbursement Date</label>
              <input
                type="date"
                required
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          {!editingRun ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Statutory Tax Withholding (%)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={taxRatePct}
                    onChange={(e) => setTaxRatePct(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Social Security / Statutory (%)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={socialRatePct}
                    onChange={(e) => setSocialRatePct(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeOt}
                  onChange={(e) => setIncludeOt(e.target.checked)}
                  className="rounded border-zinc-300 text-orange-600"
                />
                <span>Include approved attendance overtime at 1.5x hourly rate & deduct enrolled benefits</span>
              </label>
            </>
          ) : (
            <div>
              <label className="block text-xs font-medium mb-1">Payroll Batch Status</label>
              <select
                value={runStatus}
                onChange={(e) => setRunStatus(e.target.value as PayrollRunItem['status'])}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="draft">Draft</option>
                <option value="processed">Processed</option>
                <option value="paid">Paid</option>
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setRunModal(false)} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium">
              {editingRun ? 'Save Payroll Run' : 'Calculate & Issue Payslips'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Payslip Modal */}
      <Modal
        open={slipModal}
        onClose={() => {
          setSlipModal(false);
          setEditingSlip(null);
        }}
        title={editingSlip ? `Edit Payslip ${editingSlip.ref}` : 'Edit Payslip'}
      >
        <form onSubmit={handleSaveSlip} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Gross Pay</label>
              <input type="number" step="0.01" value={slGross} onChange={(e) => setSlGross(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Tax Deduction</label>
              <input type="number" step="0.01" value={slTax} onChange={(e) => setSlTax(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Social Deduction</label>
              <input type="number" step="0.01" value={slSocial} onChange={(e) => setSlSocial(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Health / Benefits</label>
              <input type="number" step="0.01" value={slHealth} onChange={(e) => setSlHealth(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Other Deductions</label>
              <input type="number" step="0.01" value={slOther} onChange={(e) => setSlOther(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Status</label>
              <select value={slStatus} onChange={(e) => setSlStatus(e.target.value as 'generated' | 'paid')} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                <option value="generated">Generated</option>
                <option value="paid">Paid</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Direct Deposit Reference</label>
            <input type="text" value={slDepositRef} onChange={(e) => setSlDepositRef(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setSlipModal(false)} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium">
              Recalculate & Save
            </button>
          </div>
        </form>
      </Modal>

      {/* Benefit Plan Modal */}
      <Modal
        open={planModal}
        onClose={() => {
          setPlanModal(false);
          setEditingPlan(null);
        }}
        title={editingPlan ? `Edit ${editingPlan.ref}` : 'Create Benefit Plan'}
      >
        <form onSubmit={handleSavePlan} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Plan Name</label>
              <input type="text" required value={plName} onChange={(e) => setPlName(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Provider</label>
              <input type="text" value={plProvider} onChange={(e) => setPlProvider(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Category</label>
              <select value={plCat} onChange={(e) => setPlCat(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                <option value="Health Insurance">Health Insurance</option>
                <option value="Dental & Vision">Dental & Vision</option>
                <option value="Retirement / 401k">Retirement / 401k</option>
                <option value="Life & Disability">Life & Disability</option>
                <option value="Wellness">Wellness</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Employer / mo</label>
              <input type="number" step="0.01" value={plEmployer} onChange={(e) => setPlEmployer(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Employee / mo</label>
              <input type="number" step="0.01" value={plEmployee} onChange={(e) => setPlEmployee(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Description</label>
            <textarea rows={2} value={plDesc} onChange={(e) => setPlDesc(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setPlanModal(false)} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium">
              {editingPlan ? 'Save Plan' : 'Create Plan'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Benefit Enrollment Modal */}
      <Modal
        open={enrModal}
        onClose={() => {
          setEnrModal(false);
          setEditingEnr(null);
        }}
        title={editingEnr ? 'Edit Benefit Enrollment' : 'Enroll Staff in Benefits'}
      >
        <form onSubmit={handleSaveEnr} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Employee</label>
              <select required value={enEmpId} onChange={(e) => setEnEmpId(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Benefit Plan</label>
              <select required value={enPlanId} onChange={(e) => setEnPlanId(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                {benefitPlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.ref} — {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Coverage Tier</label>
              <select value={enTier} onChange={(e) => setEnTier(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                <option value="Employee Only">Employee Only</option>
                <option value="Employee + Spouse">Employee + Spouse</option>
                <option value="Family">Family</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Effective Date</label>
              <input type="date" value={enDate} onChange={(e) => setEnDate(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Status</label>
              <select value={enStatus} onChange={(e) => setEnStatus(e.target.value as BenefitEnrollmentItem['status'])} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Notes</label>
            <input type="text" value={enNotes} onChange={(e) => setEnNotes(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEnrModal(false)} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium">
              {editingEnr ? 'Save Enrollment' : 'Enroll Employee'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Expense Report Modal */}
      <Modal
        open={expModal}
        onClose={() => {
          setExpModal(false);
          setEditingExp(null);
        }}
        title={editingExp ? `Edit ${editingExp.ref}` : 'Submit Expense Report'}
      >
        <form onSubmit={handleSaveExpense} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Employee</label>
              <select required value={expEmpId} onChange={(e) => setExpEmpId(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Category</label>
              <input type="text" required value={expCat} onChange={(e) => setExpCat(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Expense Date</label>
              <input type="date" required value={expDate} onChange={(e) => setExpDate(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Total Amount</label>
              <input type="number" step="0.01" required value={expAmount} onChange={(e) => setExpAmount(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">VAT Included</label>
              <input type="number" step="0.01" value={expTax} onChange={(e) => setExpTax(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Description</label>
            <input type="text" value={expDesc} onChange={(e) => setExpDesc(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setExpModal(false)} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium">
              {editingExp ? 'Save Expense' : 'Submit Expense'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

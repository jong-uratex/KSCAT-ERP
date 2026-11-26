import { useEffect, useState, type FormEvent } from 'react';
import { Briefcase, CalendarClock, Clock, Pencil, Plus, Receipt, Trash2, Users } from 'lucide-react';
import { apiRequest, can } from '../lib/api';
import { formatCurrency, formatDate } from '../lib/format';
import type {
  CandidateItem,
  EmployeeItem,
  ExpenseReportItem,
  JobPosting,
  LeaveRequestItem,
  PermissionMap,
  Project,
  TimesheetItem,
} from '../types/erp';
import { ConfirmDeleteModal, Modal } from './Modal';
import { StatusText } from './StatusText';

interface HrViewProps {
  permissions: PermissionMap;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

type HrTab = 'employees' | 'leave' | 'expenses' | 'recruitment' | 'timesheets';

export function HrView({ permissions, onNotify }: HrViewProps) {
  const [tab, setTab] = useState<HrTab>('employees');
  const [employees, setEmployees] = useState<EmployeeItem[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequestItem[]>([]);
  const [expenseReports, setExpenseReports] = useState<ExpenseReportItem[]>([]);
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [candidates, setCandidates] = useState<CandidateItem[]>([]);
  const [timesheets, setTimesheets] = useState<TimesheetItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const canWrite = can(permissions, 'hr', 'write');
  const canValidate = can(permissions, 'hr', 'validate');
  const canDelete = can(permissions, 'hr', 'delete');

  const [deleteTarget, setDeleteTarget] = useState<{ url: string; label: string; warning?: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Employee Modal
  const [empModal, setEmpModal] = useState(false);
  const [editingEmp, setEditingEmp] = useState<EmployeeItem | null>(null);
  const [empName, setEmpName] = useState('');
  const [empEmail, setEmpEmail] = useState('');
  const [empPhone, setEmpPhone] = useState('');
  const [empDept, setEmpDept] = useState('Operations');
  const [empTitle, setEmpTitle] = useState('');
  const [empHire, setEmpHire] = useState(new Date().toISOString().slice(0, 10));
  const [empSalary, setEmpSalary] = useState('78000');
  const [empLeave, setEmpLeave] = useState('22');
  const [empStatus, setEmpStatus] = useState<EmployeeItem['status']>('active');

  // Leave Modal
  const [leaveModal, setLeaveModal] = useState(false);
  const [editingLeave, setEditingLeave] = useState<LeaveRequestItem | null>(null);
  const [lrEmpId, setLrEmpId] = useState('');
  const [lrType, setLrType] = useState('Paid Time Off');
  const [lrStart, setLrStart] = useState(new Date().toISOString().slice(0, 10));
  const [lrEnd, setLrEnd] = useState(new Date().toISOString().slice(0, 10));
  const [lrDays, setLrDays] = useState('2');
  const [lrReason, setLrReason] = useState('');

  // Expense Modal
  const [expModal, setExpModal] = useState(false);
  const [editingExp, setEditingExp] = useState<ExpenseReportItem | null>(null);
  const [expEmpId, setExpEmpId] = useState('');
  const [expCat, setExpCat] = useState('Travel & Lodging');
  const [expDate, setExpDate] = useState(new Date().toISOString().slice(0, 10));
  const [expAmount, setExpAmount] = useState('145.00');
  const [expTax, setExpTax] = useState('24.17');
  const [expDesc, setExpDesc] = useState('');

  // Job Modal
  const [jobModal, setJobModal] = useState(false);
  const [editingJob, setEditingJob] = useState<JobPosting | null>(null);
  const [jobTitle, setJobTitle] = useState('');
  const [jobDept, setJobDept] = useState('Engineering');
  const [jobLoc, setJobLoc] = useState('Hybrid / HQ');
  const [jobType, setJobType] = useState('Full-Time');
  const [jobStatus, setJobStatus] = useState<JobPosting['status']>('open');
  const [jobDesc, setJobDesc] = useState('');

  // Candidate Modal
  const [candModal, setCandModal] = useState(false);
  const [editingCand, setEditingCand] = useState<CandidateItem | null>(null);
  const [candJobId, setCandJobId] = useState('');
  const [candName, setCandName] = useState('');
  const [candEmail, setCandEmail] = useState('');
  const [candPhone, setCandPhone] = useState('');
  const [candStage, setCandStage] = useState<CandidateItem['stage']>('applied');
  const [candNotes, setCandNotes] = useState('');

  // Timesheet Modal
  const [tsModal, setTsModal] = useState(false);
  const [editingTs, setEditingTs] = useState<TimesheetItem | null>(null);
  const [tsEmpId, setTsEmpId] = useState('');
  const [tsProjId, setTsProjId] = useState('');
  const [tsDate, setTsDate] = useState(new Date().toISOString().slice(0, 10));
  const [tsHours, setTsHours] = useState('7.5');
  const [tsLabel, setTsLabel] = useState('');
  const [tsBillable, setTsBillable] = useState(true);

  async function loadHr() {
    setLoading(true);
    try {
      const [hrRes, projRes] = await Promise.all([
        apiRequest<{
          employees: EmployeeItem[];
          leaveRequests: LeaveRequestItem[];
          expenseReports: ExpenseReportItem[];
          jobs: JobPosting[];
          candidates: CandidateItem[];
          timesheets: TimesheetItem[];
        }>('/api/hr'),
        apiRequest<{ projects: Project[] }>('/api/projects').catch(() => ({ projects: [] })),
      ]);
      setEmployees(hrRes.employees);
      setLeaveRequests(hrRes.leaveRequests);
      setExpenseReports(hrRes.expenseReports);
      setJobs(hrRes.jobs);
      setCandidates(hrRes.candidates);
      setTimesheets(hrRes.timesheets);
      setProjects(projRes.projects);
      if (hrRes.employees[0]) {
        const firstId = String(hrRes.employees[0].id);
        if (!lrEmpId) setLrEmpId(firstId);
        if (!expEmpId) setExpEmpId(firstId);
        if (!tsEmpId) setTsEmpId(firstId);
      }
      if (hrRes.jobs[0] && !candJobId) {
        setCandJobId(String(hrRes.jobs[0].id));
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to load HR data.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHr();
  }, []);

  function promptDelete(url: string, label: string, warning?: string) {
    setDeleteError('');
    setDeleteTarget({ url, label, warning });
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await apiRequest(deleteTarget.url, { method: 'DELETE' });
      onNotify(`Deleted ${deleteTarget.label}.`);
      setDeleteTarget(null);
      await loadHr();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unable to delete record.');
    } finally {
      setDeleting(false);
    }
  }

  function openCreateEmp() {
    setEditingEmp(null);
    setEmpName('');
    setEmpEmail('');
    setEmpPhone('');
    setEmpDept('Operations');
    setEmpTitle('');
    setEmpHire(new Date().toISOString().slice(0, 10));
    setEmpSalary('78000');
    setEmpLeave('22');
    setEmpStatus('active');
    setEmpModal(true);
  }

  function openEditEmp(emp: EmployeeItem) {
    setEditingEmp(emp);
    setEmpName(emp.full_name);
    setEmpEmail(emp.email);
    setEmpPhone(emp.phone ?? '');
    setEmpDept(emp.department);
    setEmpTitle(emp.job_title ?? '');
    setEmpHire(emp.hire_date || new Date().toISOString().slice(0, 10));
    setEmpSalary(String(emp.annual_salary ?? 0));
    setEmpLeave(String(emp.leave_balance_days ?? 20));
    setEmpStatus(emp.status);
    setEmpModal(true);
  }

  async function handleSaveEmployee(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        fullName: empName,
        email: empEmail,
        phone: empPhone,
        department: empDept,
        jobTitle: empTitle,
        hireDate: empHire,
        annualSalary: Number(empSalary) || 0,
        leaveBalanceDays: Number(empLeave) || 20,
        ...(editingEmp ? { status: empStatus } : {}),
      };
      if (editingEmp) {
        await apiRequest(`/api/employees/${editingEmp.id}`, { method: 'PUT', body: payload });
        onNotify(`Employee ${editingEmp.ref} updated.`);
      } else {
        const created = await apiRequest<EmployeeItem>('/api/employees', { method: 'POST', body: payload });
        onNotify(`Employee ${created.ref} (${created.full_name}) added.`);
      }
      setEmpModal(false);
      setEditingEmp(null);
      await loadHr();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save employee.', 'error');
    }
  }

  function openCreateLeave() {
    setEditingLeave(null);
    if (employees[0] && !lrEmpId) setLrEmpId(String(employees[0].id));
    setLrType('Paid Time Off');
    const today = new Date().toISOString().slice(0, 10);
    setLrStart(today);
    setLrEnd(today);
    setLrDays('2');
    setLrReason('');
    setLeaveModal(true);
  }

  function openEditLeave(lr: LeaveRequestItem) {
    setEditingLeave(lr);
    setLrEmpId(String(lr.employee_id));
    setLrType(lr.leave_type);
    setLrStart(lr.start_date);
    setLrEnd(lr.end_date);
    setLrDays(String(lr.days));
    setLrReason(lr.reason ?? '');
    setLeaveModal(true);
  }

  async function handleSaveLeave(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        employeeId: Number(lrEmpId),
        leaveType: lrType,
        startDate: lrStart,
        endDate: lrEnd,
        days: Number(lrDays) || 1,
        reason: lrReason,
      };
      if (editingLeave) {
        await apiRequest(`/api/leave-requests/${editingLeave.id}`, { method: 'PUT', body: payload });
        onNotify(`Leave request ${editingLeave.ref} updated.`);
      } else {
        await apiRequest('/api/leave-requests', { method: 'POST', body: payload });
        onNotify('Leave request submitted.');
      }
      setLeaveModal(false);
      setEditingLeave(null);
      await loadHr();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save leave request.', 'error');
    }
  }

  async function handleDecideLeave(id: number, decision: 'approved' | 'rejected') {
    try {
      await apiRequest(`/api/leave-requests/${id}/decide`, {
        method: 'POST',
        body: { decision },
      });
      onNotify(`Leave request ${decision}.`);
      await loadHr();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update leave request.', 'error');
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
      await loadHr();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save expense report.', 'error');
    }
  }

  async function handleDecideExpense(id: number, status: 'approved' | 'paid' | 'rejected') {
    try {
      await apiRequest(`/api/expense-reports/${id}/decide`, {
        method: 'POST',
        body: { status },
      });
      onNotify(`Expense report marked ${status}.`);
      await loadHr();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update expense report.', 'error');
    }
  }

  function openCreateJob() {
    setEditingJob(null);
    setJobTitle('');
    setJobDept('Engineering');
    setJobLoc('Hybrid / HQ');
    setJobType('Full-Time');
    setJobStatus('open');
    setJobDesc('');
    setJobModal(true);
  }

  function openEditJob(job: JobPosting) {
    setEditingJob(job);
    setJobTitle(job.title);
    setJobDept(job.department);
    setJobLoc(job.location);
    setJobType(job.contract_type);
    setJobStatus(job.status);
    setJobDesc(job.description ?? '');
    setJobModal(true);
  }

  async function handleSaveJob(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        title: jobTitle,
        department: jobDept,
        location: jobLoc,
        contractType: jobType,
        description: jobDesc,
        ...(editingJob ? { status: jobStatus } : {}),
      };
      if (editingJob) {
        await apiRequest(`/api/recruitment/jobs/${editingJob.id}`, { method: 'PUT', body: payload });
        onNotify(`Job posting ${editingJob.ref} updated.`);
      } else {
        await apiRequest('/api/recruitment/jobs', { method: 'POST', body: payload });
        onNotify('Job posting published.');
      }
      setJobModal(false);
      setEditingJob(null);
      await loadHr();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save job posting.', 'error');
    }
  }

  function openCreateCand() {
    setEditingCand(null);
    if (jobs[0] && !candJobId) setCandJobId(String(jobs[0].id));
    setCandName('');
    setCandEmail('');
    setCandPhone('');
    setCandStage('applied');
    setCandNotes('');
    setCandModal(true);
  }

  function openEditCand(c: CandidateItem) {
    setEditingCand(c);
    setCandJobId(String(c.job_id));
    setCandName(c.full_name);
    setCandEmail(c.email);
    setCandPhone(c.phone ?? '');
    setCandStage(c.stage);
    setCandNotes(c.notes ?? '');
    setCandModal(true);
  }

  async function handleSaveCandidate(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        jobId: Number(candJobId),
        fullName: candName,
        email: candEmail,
        phone: candPhone,
        notes: candNotes,
        ...(editingCand ? { stage: candStage } : {}),
      };
      if (editingCand) {
        await apiRequest(`/api/recruitment/candidates/${editingCand.id}`, { method: 'PUT', body: payload });
        onNotify(`Candidate ${candName} updated.`);
      } else {
        await apiRequest('/api/recruitment/candidates', { method: 'POST', body: payload });
        onNotify('Candidate added to recruitment pipeline.');
      }
      setCandModal(false);
      setEditingCand(null);
      await loadHr();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save candidate.', 'error');
    }
  }

  async function handleUpdateCandidateStage(id: number, stage: CandidateItem['stage']) {
    try {
      await apiRequest(`/api/recruitment/candidates/${id}`, {
        method: 'PUT',
        body: { stage },
      });
      onNotify('Candidate stage updated.');
      await loadHr();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update stage.', 'error');
    }
  }

  function openCreateTs() {
    setEditingTs(null);
    if (employees[0] && !tsEmpId) setTsEmpId(String(employees[0].id));
    setTsProjId('');
    setTsDate(new Date().toISOString().slice(0, 10));
    setTsHours('7.5');
    setTsLabel('');
    setTsBillable(true);
    setTsModal(true);
  }

  function openEditTs(ts: TimesheetItem) {
    setEditingTs(ts);
    setTsEmpId(String(ts.employee_id));
    setTsProjId(ts.project_id ? String(ts.project_id) : '');
    setTsDate(ts.work_date);
    setTsHours(String(ts.hours));
    setTsLabel(ts.task_label ?? '');
    setTsBillable(Boolean(ts.billable));
    setTsModal(true);
  }

  async function handleSaveTimesheet(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        employeeId: Number(tsEmpId),
        projectId: tsProjId ? Number(tsProjId) : null,
        workDate: tsDate,
        hours: Number(tsHours),
        taskLabel: tsLabel,
        billable: tsBillable,
      };
      if (editingTs) {
        await apiRequest(`/api/timesheets/${editingTs.id}`, { method: 'PUT', body: payload });
        onNotify('Timesheet entry updated.');
      } else {
        await apiRequest('/api/timesheets', { method: 'POST', body: payload });
        onNotify('Timesheet entry recorded.');
      }
      setTsModal(false);
      setEditingTs(null);
      await loadHr();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save timesheet.', 'error');
    }
  }

  const tabs: Array<{ key: HrTab; label: string; Icon: typeof Users }> = [
    { key: 'employees', label: `Staff (${employees.length})`, Icon: Users },
    { key: 'leave', label: `Leave (${leaveRequests.length})`, Icon: CalendarClock },
    { key: 'expenses', label: `Expenses (${expenseReports.length})`, Icon: Receipt },
    { key: 'recruitment', label: `Recruitment (${jobs.length})`, Icon: Briefcase },
    { key: 'timesheets', label: `Timesheets (${timesheets.length})`, Icon: Clock },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-zinc-200/70 dark:bg-zinc-800 self-start">
          {tabs.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                tab === key
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            {tab === 'employees' && (
              <button
                type="button"
                onClick={openCreateEmp}
                className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Employee</span>
              </button>
            )}
            {tab === 'leave' && (
              <button
                type="button"
                onClick={openCreateLeave}
                className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Request Leave</span>
              </button>
            )}
            {tab === 'expenses' && (
              <button
                type="button"
                onClick={openCreateExp}
                className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Submit Expense</span>
              </button>
            )}
            {tab === 'recruitment' && (
              <>
                <button
                  type="button"
                  onClick={openCreateJob}
                  className="px-3.5 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Job Posting</span>
                </button>
                <button
                  type="button"
                  onClick={openCreateCand}
                  disabled={jobs.length === 0}
                  className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 disabled:opacity-50 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Candidate</span>
                </button>
              </>
            )}
            {tab === 'timesheets' && (
              <button
                type="button"
                onClick={openCreateTs}
                className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Log Hours</span>
              </button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="p-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-center text-sm text-zinc-500">
          Loading human resources records...
        </div>
      ) : (
        <>
          {tab === 'employees' && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-50 dark:bg-zinc-950 text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                  <tr>
                    <th className="px-4 py-3 font-medium">Ref</th>
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Department & Role</th>
                    <th className="px-4 py-3 font-medium">Contact</th>
                    <th className="px-4 py-3 font-medium">Hired</th>
                    <th className="px-4 py-3 font-medium text-right">Annual Salary</th>
                    <th className="px-4 py-3 font-medium text-right">Leave Balance</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {employees.map((emp) => (
                    <tr key={emp.id} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40">
                      <td className="px-4 py-3 font-mono text-orange-700 dark:text-orange-400">{emp.ref}</td>
                      <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">{emp.full_name}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-zinc-800 dark:text-zinc-200">{emp.job_title || 'Staff'}</div>
                        <div className="text-[11px] text-zinc-500">{emp.department}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{emp.email}</div>
                        {emp.phone && <div className="text-[11px] font-mono text-zinc-500">{emp.phone}</div>}
                      </td>
                      <td className="px-4 py-3 font-mono">{formatDate(emp.hire_date)}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{formatCurrency(emp.annual_salary)}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{emp.leave_balance_days} d</td>
                      <td className="px-4 py-3"><StatusText status={emp.status} /></td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => openEditEmp(emp)}
                              title={`Edit ${emp.full_name}`}
                              className="p-1 text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() =>
                                promptDelete(
                                  `/api/employees/${emp.id}`,
                                  `${emp.ref} (${emp.full_name})`,
                                  'Deleting this employee also removes linked leave requests, expense reports, and timesheet entries.'
                                )
                              }
                              title={`Delete ${emp.full_name}`}
                              className="p-1 text-zinc-400 hover:text-red-600"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {employees.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-zinc-500">
                        No employees onboarded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'leave' && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-50 dark:bg-zinc-950 text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                  <tr>
                    <th className="px-4 py-3 font-medium">Ref</th>
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Dates</th>
                    <th className="px-4 py-3 font-medium text-right">Days</th>
                    <th className="px-4 py-3 font-medium">Reason</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {leaveRequests.map((lr) => (
                    <tr key={lr.id}>
                      <td className="px-4 py-3 font-mono text-orange-700 dark:text-orange-400">{lr.ref}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">{lr.employee_name}</div>
                        <div className="text-[11px] text-zinc-500">{lr.department}</div>
                      </td>
                      <td className="px-4 py-3">{lr.leave_type}</td>
                      <td className="px-4 py-3 font-mono">
                        {formatDate(lr.start_date)} → {formatDate(lr.end_date)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{lr.days}</td>
                      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400 max-w-xs truncate">{lr.reason || '—'}</td>
                      <td className="px-4 py-3"><StatusText status={lr.status} /></td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {lr.status === 'pending' && canValidate ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleDecideLeave(lr.id, 'approved')}
                                className="text-emerald-700 dark:text-emerald-400 font-medium hover:underline"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDecideLeave(lr.id, 'rejected')}
                                className="text-red-700 dark:text-red-400 font-medium hover:underline"
                              >
                                Reject
                              </button>
                            </>
                          ) : (
                            lr.reviewed_by && <span className="text-[11px] text-zinc-400">{lr.reviewed_by}</span>
                          )}
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => openEditLeave(lr)}
                              title={`Edit ${lr.ref}`}
                              className="p-1 text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => promptDelete(`/api/leave-requests/${lr.id}`, `${lr.ref} (${lr.employee_name})`)}
                              title={`Delete ${lr.ref}`}
                              className="p-1 text-zinc-400 hover:text-red-600"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {leaveRequests.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-zinc-500">
                        No leave requests recorded.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'expenses' && (
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
                      <td className="px-4 py-3"><StatusText status={exp.status} /></td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {canValidate && (exp.status === 'submitted' || exp.status === 'draft') && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleDecideExpense(exp.id, 'approved')}
                                className="text-orange-700 dark:text-orange-400 font-medium hover:underline"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDecideExpense(exp.id, 'rejected')}
                                className="text-red-700 dark:text-red-400 font-medium hover:underline"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {canValidate && exp.status === 'approved' && (
                            <button
                              type="button"
                              onClick={() => handleDecideExpense(exp.id, 'paid')}
                              className="text-emerald-700 dark:text-emerald-400 font-medium hover:underline"
                            >
                              Mark Reimbursed
                            </button>
                          )}
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => openEditExp(exp)}
                              title={`Edit ${exp.ref}`}
                              className="p-1 text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => promptDelete(`/api/expense-reports/${exp.id}`, `${exp.ref} (${exp.employee_name})`)}
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

          {tab === 'recruitment' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {jobs.map((job) => (
                  <div
                    key={job.id}
                    className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs gap-2">
                      <span className="font-mono text-orange-700 dark:text-orange-400">{job.ref}</span>
                      <div className="flex items-center gap-2">
                        <StatusText status={job.status} />
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => openEditJob(job)}
                            title={`Edit ${job.ref}`}
                            className="p-1 text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() =>
                              promptDelete(
                                `/api/recruitment/jobs/${job.id}`,
                                `${job.ref} (${job.title})`,
                                'Deleting this job posting also removes its linked candidates.'
                              )
                            }
                            title={`Delete ${job.ref}`}
                            className="p-1 text-zinc-400 hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{job.title}</h3>
                    <div className="text-xs text-zinc-500">
                      {job.department} · {job.location} · {job.contract_type}
                    </div>
                    {job.description && (
                      <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">{job.description}</p>
                    )}
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
                <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 text-xs font-semibold">
                  Candidate Pipeline ({candidates.length})
                </div>
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-50 dark:bg-zinc-950 text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                    <tr>
                      <th className="px-4 py-3 font-medium">Candidate</th>
                      <th className="px-4 py-3 font-medium">Position</th>
                      <th className="px-4 py-3 font-medium">Contact</th>
                      <th className="px-4 py-3 font-medium">Notes</th>
                      <th className="px-4 py-3 font-medium">Pipeline Stage</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {candidates.map((c) => (
                      <tr key={c.id}>
                        <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">{c.full_name}</td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-orange-700 dark:text-orange-400 mr-1.5">{c.job_ref}</span>
                          <span>{c.job_title}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div>{c.email}</div>
                          {c.phone && <div className="text-[11px] font-mono text-zinc-500">{c.phone}</div>}
                        </td>
                        <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400 max-w-xs truncate">{c.notes || '—'}</td>
                        <td className="px-4 py-3">
                          {canValidate ? (
                            <select
                              value={c.stage}
                              onChange={(e) => handleUpdateCandidateStage(c.id, e.target.value as CandidateItem['stage'])}
                              className="px-2.5 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                            >
                              <option value="applied">Applied</option>
                              <option value="screening">Screening</option>
                              <option value="interview">Interview</option>
                              <option value="offer">Offer</option>
                              <option value="hired">Hired</option>
                              <option value="rejected">Rejected</option>
                            </select>
                          ) : (
                            <StatusText status={c.stage} />
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {(canWrite || canValidate) && (
                              <button
                                type="button"
                                onClick={() => openEditCand(c)}
                                title={`Edit ${c.full_name}`}
                                className="p-1 text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() => promptDelete(`/api/recruitment/candidates/${c.id}`, c.full_name)}
                                title={`Delete ${c.full_name}`}
                                className="p-1 text-zinc-400 hover:text-red-600"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {candidates.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                          No candidates in pipeline.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'timesheets' && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-50 dark:bg-zinc-950 text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                  <tr>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Project</th>
                    <th className="px-4 py-3 font-medium">Task Description</th>
                    <th className="px-4 py-3 font-medium text-right">Hours</th>
                    <th className="px-4 py-3 font-medium">Billable</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {timesheets.map((ts) => (
                    <tr key={ts.id}>
                      <td className="px-4 py-3 font-mono">{formatDate(ts.work_date)}</td>
                      <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">{ts.employee_name}</td>
                      <td className="px-4 py-3">
                        {ts.project_ref ? (
                          <span>
                            <span className="font-mono text-orange-700 dark:text-orange-400 mr-1.5">{ts.project_ref}</span>
                            {ts.project_title}
                          </span>
                        ) : (
                          'Internal'
                        )}
                      </td>
                      <td className="px-4 py-3">{ts.task_label || '—'}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums font-medium">{ts.hours.toFixed(2)} h</td>
                      <td className="px-4 py-3">
                        <span className={ts.billable ? 'text-emerald-700 dark:text-emerald-400 font-medium' : 'text-zinc-500'}>
                          {ts.billable ? 'Billable' : 'Non-billable'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => openEditTs(ts)}
                              title="Edit timesheet entry"
                              className="p-1 text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() =>
                                promptDelete(
                                  `/api/timesheets/${ts.id}`,
                                  `${ts.employee_name} · ${ts.hours}h (${formatDate(ts.work_date)})`
                                )
                              }
                              title="Delete timesheet entry"
                              className="p-1 text-zinc-400 hover:text-red-600"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {timesheets.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                        No timesheet entries logged.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Employee Modal */}
      <Modal
        open={empModal}
        onClose={() => {
          setEmpModal(false);
          setEditingEmp(null);
        }}
        title={editingEmp ? `Edit ${editingEmp.ref}` : 'Onboard Employee'}
      >
        <form onSubmit={handleSaveEmployee} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Full Name</label>
              <input
                type="text"
                required
                value={empName}
                onChange={(e) => setEmpName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Work Email</label>
              <input
                type="email"
                required
                value={empEmail}
                onChange={(e) => setEmpEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Department</label>
              <input
                type="text"
                value={empDept}
                onChange={(e) => setEmpDept(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Job Title</label>
              <input
                type="text"
                value={empTitle}
                onChange={(e) => setEmpTitle(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Hire Date</label>
              <input
                type="date"
                value={empHire}
                onChange={(e) => setEmpHire(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Annual Salary</label>
              <input
                type="number"
                value={empSalary}
                onChange={(e) => setEmpSalary(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Leave Days</label>
              <input
                type="number"
                value={empLeave}
                onChange={(e) => setEmpLeave(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
              />
            </div>
          </div>
          <div className={editingEmp ? 'grid grid-cols-2 gap-3' : ''}>
            <div>
              <label className="block text-xs font-medium mb-1">Phone</label>
              <input
                type="text"
                value={empPhone}
                onChange={(e) => setEmpPhone(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            {editingEmp && (
              <div>
                <label className="block text-xs font-medium mb-1">Employment Status</label>
                <select
                  value={empStatus}
                  onChange={(e) => setEmpStatus(e.target.value as EmployeeItem['status'])}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  <option value="active">Active</option>
                  <option value="on_leave">On Leave</option>
                  <option value="terminated">Terminated</option>
                </select>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setEmpModal(false);
                setEditingEmp(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium">
              {editingEmp ? 'Save Employee' : 'Create Employee'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Request Leave Modal */}
      <Modal
        open={leaveModal}
        onClose={() => {
          setLeaveModal(false);
          setEditingLeave(null);
        }}
        title={editingLeave ? `Edit ${editingLeave.ref}` : 'Submit Leave Request'}
      >
        <form onSubmit={handleSaveLeave} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Employee</label>
              <select
                required
                value={lrEmpId}
                onChange={(e) => setLrEmpId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name} ({e.leave_balance_days}d left)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Leave Type</label>
              <select
                value={lrType}
                onChange={(e) => setLrType(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="Paid Time Off">Paid Time Off</option>
                <option value="Sick Leave">Sick Leave</option>
                <option value="Parental Leave">Parental Leave</option>
                <option value="Unpaid Leave">Unpaid Leave</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Start Date</label>
              <input
                type="date"
                required
                value={lrStart}
                onChange={(e) => setLrStart(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">End Date</label>
              <input
                type="date"
                required
                value={lrEnd}
                onChange={(e) => setLrEnd(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Days</label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                required
                value={lrDays}
                onChange={(e) => setLrDays(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Reason / Coverage Notes</label>
            <textarea
              rows={2}
              value={lrReason}
              onChange={(e) => setLrReason(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setLeaveModal(false);
                setEditingLeave(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium">
              {editingLeave ? 'Save Request' : 'Submit Request'}
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
              <select
                required
                value={expEmpId}
                onChange={(e) => setExpEmpId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Category</label>
              <input
                type="text"
                required
                value={expCat}
                onChange={(e) => setExpCat(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Expense Date</label>
              <input
                type="date"
                required
                value={expDate}
                onChange={(e) => setExpDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Total Amount</label>
              <input
                type="number"
                step="0.01"
                required
                value={expAmount}
                onChange={(e) => setExpAmount(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">VAT Included</label>
              <input
                type="number"
                step="0.01"
                value={expTax}
                onChange={(e) => setExpTax(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Description</label>
            <input
              type="text"
              value={expDesc}
              onChange={(e) => setExpDesc(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setExpModal(false);
                setEditingExp(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium">
              {editingExp ? 'Save Expense' : 'Submit Expense'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Job Posting Modal */}
      <Modal
        open={jobModal}
        onClose={() => {
          setJobModal(false);
          setEditingJob(null);
        }}
        title={editingJob ? `Edit ${editingJob.ref}` : 'Create Job Posting'}
      >
        <form onSubmit={handleSaveJob} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Job Title</label>
            <input
              type="text"
              required
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Department</label>
              <input
                type="text"
                value={jobDept}
                onChange={(e) => setJobDept(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Location</label>
              <input
                type="text"
                value={jobLoc}
                onChange={(e) => setJobLoc(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Contract Type</label>
              <input
                type="text"
                value={jobType}
                onChange={(e) => setJobType(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          {editingJob && (
            <div>
              <label className="block text-xs font-medium mb-1">Posting Status</label>
              <select
                value={jobStatus}
                onChange={(e) => setJobStatus(e.target.value as JobPosting['status'])}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="draft">Draft</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium mb-1">Description</label>
            <textarea
              rows={3}
              value={jobDesc}
              onChange={(e) => setJobDesc(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setJobModal(false);
                setEditingJob(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium">
              {editingJob ? 'Save Role' : 'Publish Role'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Candidate Modal */}
      <Modal
        open={candModal}
        onClose={() => {
          setCandModal(false);
          setEditingCand(null);
        }}
        title={editingCand ? `Edit ${editingCand.full_name}` : 'Add Recruitment Candidate'}
      >
        <form onSubmit={handleSaveCandidate} className="space-y-4">
          <div className={editingCand ? 'grid grid-cols-2 gap-3' : ''}>
            <div>
              <label className="block text-xs font-medium mb-1">Job Posting</label>
              <select
                required
                value={candJobId}
                onChange={(e) => setCandJobId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.ref} — {j.title}
                  </option>
                ))}
              </select>
            </div>
            {editingCand && (
              <div>
                <label className="block text-xs font-medium mb-1">Pipeline Stage</label>
                <select
                  value={candStage}
                  onChange={(e) => setCandStage(e.target.value as CandidateItem['stage'])}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  <option value="applied">Applied</option>
                  <option value="screening">Screening</option>
                  <option value="interview">Interview</option>
                  <option value="offer">Offer</option>
                  <option value="hired">Hired</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Candidate Full Name</label>
              <input
                type="text"
                required
                value={candName}
                onChange={(e) => setCandName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Email</label>
              <input
                type="email"
                required
                value={candEmail}
                onChange={(e) => setCandEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Phone</label>
            <input
              type="text"
              value={candPhone}
              onChange={(e) => setCandPhone(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Recruiter Notes</label>
            <textarea
              rows={2}
              value={candNotes}
              onChange={(e) => setCandNotes(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setCandModal(false);
                setEditingCand(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium">
              {editingCand ? 'Save Candidate' : 'Add Candidate'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Log Timesheet Modal */}
      <Modal
        open={tsModal}
        onClose={() => {
          setTsModal(false);
          setEditingTs(null);
        }}
        title={editingTs ? 'Edit Timesheet Entry' : 'Log Employee Timesheet'}
      >
        <form onSubmit={handleSaveTimesheet} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Employee</label>
              <select
                required
                value={tsEmpId}
                onChange={(e) => setTsEmpId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Project (Optional)</label>
              <select
                value={tsProjId}
                onChange={(e) => setTsProjId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="">Internal / Overhead</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.ref} — {p.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Work Date</label>
              <input
                type="date"
                required
                value={tsDate}
                onChange={(e) => setTsDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Hours</label>
              <input
                type="number"
                step="0.25"
                min="0.25"
                required
                value={tsHours}
                onChange={(e) => setTsHours(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Activity / Task Label</label>
            <input
              type="text"
              required
              value={tsLabel}
              onChange={(e) => setTsLabel(e.target.value)}
              placeholder="On-site commissioning and rack inspection"
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={tsBillable}
              onChange={(e) => setTsBillable(e.target.checked)}
              className="rounded border-zinc-300 text-orange-600"
            />
            <span>Billable to client project</span>
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setTsModal(false);
                setEditingTs(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium">
              {editingTs ? 'Save Entry' : 'Save Entry'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        itemLabel={deleteTarget?.label ?? ''}
        warning={deleteTarget?.warning}
        loading={deleting}
        error={deleteError}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError('');
        }}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

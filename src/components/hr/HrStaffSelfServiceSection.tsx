import { useEffect, useState, type FormEvent } from 'react';
import { Download, FileText, Pencil, Plus, Search, Trash2, UserCheck } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import type { EmployeeItem, JobHistoryEntry, PayslipItem, TaxDocumentEntry } from '../../types/erp';
import { Modal } from '../Modal';
import { StatusText } from '../StatusText';
import { downloadPayslipDocument, parseJobHistory, parseTaxDocuments } from './hrHelpers';

interface HrStaffSelfServiceSectionProps {
  employees: EmployeeItem[];
  payslips: PayslipItem[];
  currentUserEmail?: string;
  canWrite: boolean;
  canDelete: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPromptDelete: (url: string, label: string, warning?: string) => void;
}

export function HrStaffSelfServiceSection({
  employees,
  payslips,
  currentUserEmail,
  canWrite,
  canDelete,
  onRefresh,
  onNotify,
  onPromptDelete,
}: HrStaffSelfServiceSectionProps) {
  const [subView, setSubView] = useState<'directory' | 'self_service'>('directory');
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');

  // Employee Modal
  const [empModal, setEmpModal] = useState(false);
  const [editingEmp, setEditingEmp] = useState<EmployeeItem | null>(null);
  const [empName, setEmpName] = useState('');
  const [empEmail, setEmpEmail] = useState('');
  const [empPhone, setEmpPhone] = useState('');
  const [empDept, setEmpDept] = useState('Operations');
  const [empTitle, setEmpTitle] = useState('');
  const [empType, setEmpType] = useState('Full-Time');
  const [empHire, setEmpHire] = useState(new Date().toISOString().slice(0, 10));
  const [empSalary, setEmpSalary] = useState('78000');
  const [empLeave, setEmpLeave] = useState('22');
  const [empTaxId, setEmpTaxId] = useState('');
  const [empBank, setEmpBank] = useState('');
  const [empEmergency, setEmpEmergency] = useState('');
  const [empStatus, setEmpStatus] = useState<EmployeeItem['status']>('active');

  // Self-service selected employee
  const [selfEmpId, setSelfEmpId] = useState<string>('');
  const [selfPhone, setSelfPhone] = useState('');
  const [selfEmergency, setSelfEmergency] = useState('');
  const [selfBank, setSelfBank] = useState('');
  const [selfTaxId, setSelfTaxId] = useState('');
  const [jobHistory, setJobHistory] = useState<JobHistoryEntry[]>([]);
  const [taxDocs, setTaxDocs] = useState<TaxDocumentEntry[]>([]);
  const [savingSelf, setSavingSelf] = useState(false);

  // Add Job History / Tax Doc mini inputs
  const [newRole, setNewRole] = useState('');
  const [newRoleDept, setNewRoleDept] = useState('');
  const [newRoleStart, setNewRoleStart] = useState('');
  const [newRoleEnd, setNewRoleEnd] = useState('Present');
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocForm, setNewDocForm] = useState('W-2');
  const [newDocYear, setNewDocYear] = useState('2026');

  const departments = Array.from(new Set(employees.map((e) => e.department).filter(Boolean))).sort();

  const filteredEmployees = employees.filter((emp) => {
    if (deptFilter !== 'all' && emp.department !== deptFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      emp.full_name.toLowerCase().includes(q) ||
      emp.ref.toLowerCase().includes(q) ||
      emp.email.toLowerCase().includes(q) ||
      emp.job_title.toLowerCase().includes(q) ||
      emp.department.toLowerCase().includes(q)
    );
  });

  useEffect(() => {
    if (employees.length === 0) return;
    if (!selfEmpId || !employees.some((e) => String(e.id) === selfEmpId)) {
      const matched = currentUserEmail
        ? employees.find((e) => e.email.trim().toLowerCase() === currentUserEmail.trim().toLowerCase())
        : undefined;
      const chosen = matched ?? employees[0];
      setSelfEmpId(String(chosen.id));
    }
  }, [employees, currentUserEmail, selfEmpId]);

  const selectedSelfEmployee = employees.find((e) => String(e.id) === selfEmpId) ?? null;

  useEffect(() => {
    if (!selectedSelfEmployee) return;
    setSelfPhone(selectedSelfEmployee.phone ?? '');
    setSelfEmergency(selectedSelfEmployee.emergency_contact ?? '');
    setSelfBank(selectedSelfEmployee.bank_account ?? '');
    setSelfTaxId(selectedSelfEmployee.tax_id ?? '');
    setJobHistory(parseJobHistory(selectedSelfEmployee.job_history_json));
    setTaxDocs(parseTaxDocuments(selectedSelfEmployee.tax_documents_json));
  }, [selectedSelfEmployee]);

  function openCreateEmp() {
    setEditingEmp(null);
    setEmpName('');
    setEmpEmail('');
    setEmpPhone('');
    setEmpDept('Operations');
    setEmpTitle('');
    setEmpType('Full-Time');
    setEmpHire(new Date().toISOString().slice(0, 10));
    setEmpSalary('78000');
    setEmpLeave('22');
    setEmpTaxId('');
    setEmpBank('');
    setEmpEmergency('');
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
    setEmpType(emp.employment_type ?? 'Full-Time');
    setEmpHire(emp.hire_date || new Date().toISOString().slice(0, 10));
    setEmpSalary(String(emp.annual_salary ?? 0));
    setEmpLeave(String(emp.leave_balance_days ?? 20));
    setEmpTaxId(emp.tax_id ?? '');
    setEmpBank(emp.bank_account ?? '');
    setEmpEmergency(emp.emergency_contact ?? '');
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
        employmentType: empType,
        hireDate: empHire,
        annualSalary: Number(empSalary) || 0,
        leaveBalanceDays: Number(empLeave) || 20,
        taxId: empTaxId,
        bankAccount: empBank,
        emergencyContact: empEmergency,
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
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save employee.', 'error');
    }
  }

  async function saveSelfService(nextHistory = jobHistory, nextDocs = taxDocs) {
    if (!selectedSelfEmployee) return;
    setSavingSelf(true);
    try {
      await apiRequest(`/api/hr/self-service/${selectedSelfEmployee.id}`, {
        method: 'PUT',
        body: {
          phone: selfPhone,
          emergencyContact: selfEmergency,
          bankAccount: selfBank,
          taxId: selfTaxId,
          jobHistoryJson: nextHistory,
          taxDocumentsJson: nextDocs,
        },
      });
      onNotify(`Self-service profile updated for ${selectedSelfEmployee.full_name}.`);
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save self-service profile.', 'error');
    } finally {
      setSavingSelf(false);
    }
  }

  async function handleAddJobHistory(e: FormEvent) {
    e.preventDefault();
    if (!newRole.trim()) return;
    const updated = [
      ...jobHistory,
      {
        role: newRole.trim(),
        department: newRoleDept.trim() || selectedSelfEmployee?.department || 'Operations',
        startDate: newRoleStart || new Date().toISOString().slice(0, 10),
        endDate: newRoleEnd.trim() || 'Present',
      },
    ];
    setJobHistory(updated);
    setNewRole('');
    setNewRoleDept('');
    setNewRoleStart('');
    await saveSelfService(updated, taxDocs);
  }

  async function handleAddTaxDoc(e: FormEvent) {
    e.preventDefault();
    if (!newDocTitle.trim()) return;
    const updated = [
      ...taxDocs,
      {
        title: newDocTitle.trim(),
        formType: newDocForm.trim() || 'W-2',
        year: newDocYear.trim() || '2026',
        status: 'On File',
        uploadedAt: new Date().toISOString().slice(0, 10),
      },
    ];
    setTaxDocs(updated);
    setNewDocTitle('');
    await saveSelfService(jobHistory, updated);
  }

  const selfPayslips = selectedSelfEmployee
    ? payslips.filter((p) => p.employee_id === selectedSelfEmployee.id)
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 self-start">
          <button
            type="button"
            onClick={() => setSubView('directory')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              subView === 'directory'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            Employee Directory ({employees.length})
          </button>
          <button
            type="button"
            onClick={() => setSubView('self_service')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap inline-flex items-center gap-1.5 ${
              subView === 'self_service'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Self-Service Portal</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {subView === 'directory' && (
            <>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter staff, ref, role..."
                  className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 w-48"
                />
              </div>
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
              >
                <option value="all">All Departments</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </>
          )}
          {canWrite && (
            <button
              type="button"
              onClick={openCreateEmp}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Employee</span>
            </button>
          )}
        </div>
      </div>

      {subView === 'directory' && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-50 dark:bg-zinc-950 text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-3 font-medium">Ref</th>
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Department & Role</th>
                <th className="px-4 py-3 font-medium">Tax ID & Deposit</th>
                <th className="px-4 py-3 font-medium">Hired</th>
                <th className="px-4 py-3 font-medium text-right">Annual Salary</th>
                <th className="px-4 py-3 font-medium text-right">Leave</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {filteredEmployees.map((emp) => (
                <tr key={emp.id} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40">
                  <td className="px-4 py-3 font-mono text-orange-700 dark:text-orange-400">{emp.ref}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">{emp.full_name}</div>
                    <div className="text-[11px] text-zinc-500">
                      {emp.email}
                      {emp.phone ? ` · ${emp.phone}` : ''}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-zinc-800 dark:text-zinc-200">{emp.job_title || 'Staff'}</div>
                    <div className="text-[11px] text-zinc-500">
                      {emp.department} · {emp.employment_type || 'Full-Time'}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300">{emp.tax_id || 'Pending TIN'}</div>
                    <div className="text-[11px] text-zinc-500">{emp.bank_account || 'No bank on file'}</div>
                  </td>
                  <td className="px-4 py-3 font-mono">{formatDate(emp.hire_date)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{formatCurrency(emp.annual_salary)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{emp.leave_balance_days} d</td>
                  <td className="px-4 py-3">
                    <StatusText status={emp.status} />
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setSelfEmpId(String(emp.id));
                          setSubView('self_service');
                        }}
                        title={`Open Self-Service for ${emp.full_name}`}
                        className="px-2 py-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 hover:text-orange-700 dark:hover:text-orange-400"
                      >
                        Profile
                      </button>
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
                            onPromptDelete(
                              `/api/employees/${emp.id}`,
                              `${emp.ref} (${emp.full_name})`,
                              'Deleting this employee also removes linked attendance, leave, payslips, and KPI records.'
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
              {filteredEmployees.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-zinc-500">
                    No matching employee profiles found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {subView === 'self_service' && selectedSelfEmployee && (
        <div className="space-y-5">
          <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="text-xs text-zinc-500">
                {selectedSelfEmployee.ref} · {selectedSelfEmployee.department} · {selectedSelfEmployee.employment_type || 'Full-Time'}
              </div>
              <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5">
                {selectedSelfEmployee.full_name} — {selectedSelfEmployee.job_title || 'Staff Member'}
              </h3>
              <div className="text-xs text-zinc-500 mt-0.5">
                Hired {formatDate(selectedSelfEmployee.hire_date)} · Leave Balance{' '}
                <span className="font-mono tabular-nums font-medium text-zinc-800 dark:text-zinc-200">
                  {selectedSelfEmployee.leave_balance_days} days
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-500 whitespace-nowrap">Viewing Staff Profile:</label>
              <select
                value={selfEmpId}
                onChange={(e) => setSelfEmpId(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.ref} — {emp.full_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Personal & Direct Deposit Self-Service */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveSelfService();
              }}
              className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
                <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Personal Details & Payroll Deposit
                </h4>
                <StatusText status={selectedSelfEmployee.status} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={selfPhone}
                    onChange={(e) => setSelfPhone(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Tax Identification (TIN / SSN)</label>
                  <input
                    type="text"
                    value={selfTaxId}
                    onChange={(e) => setSelfTaxId(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Direct Deposit Account (Masked / Routing)</label>
                <input
                  type="text"
                  value={selfBank}
                  onChange={(e) => setSelfBank(e.target.value)}
                  placeholder="Chase Checking •••• 6190"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Emergency Contact</label>
                <input
                  type="text"
                  value={selfEmergency}
                  onChange={(e) => setSelfEmergency(e.target.value)}
                  placeholder="Name · Phone · Relationship"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={savingSelf}
                  className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 disabled:opacity-50 text-white text-xs font-medium"
                >
                  {savingSelf ? 'Saving...' : 'Save Personal Details'}
                </button>
              </div>
            </form>

            {/* Downloadable Payslips */}
            <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-3">
              <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
                <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Downloadable Payslips ({selfPayslips.length})
                </h4>
              </div>
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {selfPayslips.map((slip) => (
                  <div key={slip.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">
                        <span className="font-mono text-orange-700 dark:text-orange-400 mr-2">{slip.ref}</span>
                        Period {slip.pay_period}
                      </div>
                      <div className="text-[11px] text-zinc-500 font-mono tabular-nums">
                        Gross {formatCurrency(slip.gross_pay)} · Net {formatCurrency(slip.net_pay)} · {slip.direct_deposit_ref}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusText status={slip.status} />
                      <button
                        type="button"
                        onClick={() => downloadPayslipDocument(slip)}
                        className="px-2.5 py-1 rounded border border-zinc-300 dark:border-zinc-700 text-xs font-medium inline-flex items-center gap-1 hover:border-orange-600"
                      >
                        <Download className="w-3 h-3" />
                        <span>Download</span>
                      </button>
                    </div>
                  </div>
                ))}
                {selfPayslips.length === 0 && (
                  <p className="py-6 text-center text-xs text-zinc-500">
                    No payslips issued for this staff member yet. Run Payroll under Payroll & Benefits to generate statements.
                  </p>
                )}
              </div>
            </div>

            {/* Job History Timeline */}
            <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-3">
              <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 border-b border-zinc-100 dark:border-zinc-800 pb-3">
                Job History & Promotions ({jobHistory.length})
              </h4>
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {jobHistory.map((item, idx) => (
                  <div key={idx} className="py-2.5 flex items-start justify-between gap-3 text-xs">
                    <div>
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{item.role}</div>
                      <div className="text-[11px] text-zinc-500">
                        {item.department} · {item.startDate} → {item.endDate}
                      </div>
                      {item.notes && <div className="text-[11px] text-zinc-600 dark:text-zinc-400 mt-0.5">{item.notes}</div>}
                    </div>
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => {
                          const updated = jobHistory.filter((_, i) => i !== idx);
                          setJobHistory(updated);
                          void saveSelfService(updated, taxDocs);
                        }}
                        title="Remove job history entry"
                        className="p-1 text-zinc-400 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                {jobHistory.length === 0 && (
                  <p className="py-4 text-xs text-zinc-500">No historical roles recorded yet.</p>
                )}
              </div>
              {canWrite && (
                <form onSubmit={handleAddJobHistory} className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                  <input
                    type="text"
                    placeholder="Role title"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    className="px-2.5 py-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                  />
                  <input
                    type="text"
                    placeholder="Department"
                    value={newRoleDept}
                    onChange={(e) => setNewRoleDept(e.target.value)}
                    className="px-2.5 py-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                  />
                  <input
                    type="date"
                    value={newRoleStart}
                    onChange={(e) => setNewRoleStart(e.target.value)}
                    className="px-2.5 py-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium"
                  >
                    + Add Role
                  </button>
                </form>
              )}
            </div>

            {/* Tax & Eligibility Documents */}
            <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-3">
              <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 border-b border-zinc-100 dark:border-zinc-800 pb-3">
                Tax & Compliance Documents ({taxDocs.length})
              </h4>
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {taxDocs.map((doc, idx) => (
                  <div key={idx} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-start gap-2">
                      <FileText className="w-4 h-4 text-orange-700 dark:text-orange-400 mt-0.5 shrink-0" />
                      <div>
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">{doc.title}</div>
                        <div className="text-[11px] text-zinc-500">
                          {doc.formType} · Tax Year {doc.year} · {doc.status} · {doc.uploadedAt}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const updated = taxDocs.filter((_, i) => i !== idx);
                        setTaxDocs(updated);
                        void saveSelfService(jobHistory, updated);
                      }}
                      title="Remove document record"
                      className="p-1 text-zinc-400 hover:text-red-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {taxDocs.length === 0 && <p className="py-4 text-xs text-zinc-500">No tax documents registered yet.</p>}
              </div>
              <form onSubmit={handleAddTaxDoc} className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <input
                  type="text"
                  placeholder="Document title (e.g. Form 2316 / W-2)"
                  value={newDocTitle}
                  onChange={(e) => setNewDocTitle(e.target.value)}
                  className="sm:col-span-2 px-2.5 py-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
                <input
                  type="text"
                  placeholder="Form (W-2, BIR)"
                  value={newDocForm}
                  onChange={(e) => setNewDocForm(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="Year"
                    value={newDocYear}
                    onChange={(e) => setNewDocYear(e.target.value)}
                    className="w-16 px-2 py-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
                  />
                  <button
                    type="submit"
                    className="flex-1 px-2.5 py-1.5 rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium whitespace-nowrap"
                  >
                    + Add Doc
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Employee Create/Edit Modal */}
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
          <div className="grid grid-cols-3 gap-3">
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
            <div>
              <label className="block text-xs font-medium mb-1">Employment Type</label>
              <select
                value={empType}
                onChange={(e) => setEmpType(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="Full-Time">Full-Time</option>
                <option value="Part-Time">Part-Time</option>
                <option value="Contractor">Contractor</option>
              </select>
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
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Phone</label>
              <input
                type="text"
                value={empPhone}
                onChange={(e) => setEmpPhone(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Tax ID (TIN/SSN)</label>
              <input
                type="text"
                value={empTaxId}
                onChange={(e) => setEmpTaxId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Direct Deposit</label>
              <input
                type="text"
                value={empBank}
                onChange={(e) => setEmpBank(e.target.value)}
                placeholder="Bank •••• 1234"
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          <div className={editingEmp ? 'grid grid-cols-2 gap-3' : ''}>
            <div>
              <label className="block text-xs font-medium mb-1">Emergency Contact</label>
              <input
                type="text"
                value={empEmergency}
                onChange={(e) => setEmpEmergency(e.target.value)}
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
    </div>
  );
}

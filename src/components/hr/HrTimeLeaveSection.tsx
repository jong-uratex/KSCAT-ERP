import { useEffect, useState, type FormEvent } from 'react';
import { LogIn, LogOut, Pencil, Plus, Trash2 } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatDate } from '../../lib/format';
import type {
  AttendanceLogItem,
  EmployeeItem,
  LeaveRequestItem,
  Project,
  ShiftScheduleItem,
  TimesheetItem,
} from '../../types/erp';
import { Modal } from '../Modal';
import { StatusText } from '../StatusText';

interface HrTimeLeaveSectionProps {
  employees: EmployeeItem[];
  attendanceLogs: AttendanceLogItem[];
  shiftSchedules: ShiftScheduleItem[];
  leaveRequests: LeaveRequestItem[];
  timesheets: TimesheetItem[];
  projects: Project[];
  canWrite: boolean;
  canValidate: boolean;
  canDelete: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPromptDelete: (url: string, label: string, warning?: string) => void;
}

export function HrTimeLeaveSection({
  employees,
  attendanceLogs,
  shiftSchedules,
  leaveRequests,
  timesheets,
  projects,
  canWrite,
  canValidate,
  canDelete,
  onRefresh,
  onNotify,
  onPromptDelete,
}: HrTimeLeaveSectionProps) {
  const [subTab, setSubTab] = useState<'attendance' | 'shifts' | 'leave' | 'timesheets'>('attendance');

  // Quick Clock-in bar
  const [clockEmpId, setClockEmpId] = useState('');
  const [clockShift, setClockShift] = useState('Standard Day Shift');
  const [clockStatus, setClockStatus] = useState<'present' | 'remote' | 'late'>('present');

  // Attendance Modal
  const [attModal, setAttModal] = useState(false);
  const [editingAtt, setEditingAtt] = useState<AttendanceLogItem | null>(null);
  const [attEmpId, setAttEmpId] = useState('');
  const [attDate, setAttDate] = useState(new Date().toISOString().slice(0, 10));
  const [attIn, setAttIn] = useState('09:00');
  const [attOut, setAttOut] = useState('17:30');
  const [attShift, setAttShift] = useState('Standard Day Shift');
  const [attReg, setAttReg] = useState('8');
  const [attOt, setAttOt] = useState('0');
  const [attStatus, setAttStatus] = useState<AttendanceLogItem['status']>('present');
  const [attNotes, setAttNotes] = useState('');

  // Shift Modal
  const [shiftModal, setShiftModal] = useState(false);
  const [editingShift, setEditingShift] = useState<ShiftScheduleItem | null>(null);
  const [shEmpId, setShEmpId] = useState('');
  const [shName, setShName] = useState('Standard Day Shift');
  const [shStart, setShStart] = useState('09:00');
  const [shEnd, setShEnd] = useState('17:30');
  const [shDays, setShDays] = useState('Mon–Fri');
  const [shLoc, setShLoc] = useState('HQ / Hybrid');
  const [shStatus, setShStatus] = useState<'active' | 'inactive'>('active');

  // Leave Modal
  const [leaveModal, setLeaveModal] = useState(false);
  const [editingLeave, setEditingLeave] = useState<LeaveRequestItem | null>(null);
  const [lrEmpId, setLrEmpId] = useState('');
  const [lrType, setLrType] = useState('Paid Time Off');
  const [lrStart, setLrStart] = useState(new Date().toISOString().slice(0, 10));
  const [lrEnd, setLrEnd] = useState(new Date().toISOString().slice(0, 10));
  const [lrDays, setLrDays] = useState('2');
  const [lrReason, setLrReason] = useState('');

  // Timesheet Modal
  const [tsModal, setTsModal] = useState(false);
  const [editingTs, setEditingTs] = useState<TimesheetItem | null>(null);
  const [tsEmpId, setTsEmpId] = useState('');
  const [tsProjId, setTsProjId] = useState('');
  const [tsDate, setTsDate] = useState(new Date().toISOString().slice(0, 10));
  const [tsHours, setTsHours] = useState('7.5');
  const [tsLabel, setTsLabel] = useState('');
  const [tsBillable, setTsBillable] = useState(true);

  useEffect(() => {
    if (employees[0]) {
      const first = String(employees[0].id);
      if (!clockEmpId) setClockEmpId(first);
      if (!attEmpId) setAttEmpId(first);
      if (!shEmpId) setShEmpId(first);
      if (!lrEmpId) setLrEmpId(first);
      if (!tsEmpId) setTsEmpId(first);
    }
  }, [employees]);

  async function handleClockIn() {
    if (!clockEmpId) return;
    try {
      await apiRequest('/api/hr/attendance/clock-in', {
        method: 'POST',
        body: { employeeId: Number(clockEmpId), shiftName: clockShift, status: clockStatus },
      });
      onNotify('Clock-in recorded.');
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to clock in.', 'error');
    }
  }

  async function handleClockOut(id: number) {
    try {
      await apiRequest(`/api/hr/attendance/${id}/clock-out`, { method: 'POST', body: {} });
      onNotify('Clock-out recorded and overtime calculated.');
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to clock out.', 'error');
    }
  }

  async function handleApproveAttendance(id: number) {
    try {
      await apiRequest(`/api/hr/attendance/${id}/approve`, { method: 'POST', body: {} });
      onNotify('Attendance & overtime approved.');
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to approve attendance.', 'error');
    }
  }

  function openCreateAtt() {
    setEditingAtt(null);
    if (employees[0] && !attEmpId) setAttEmpId(String(employees[0].id));
    setAttDate(new Date().toISOString().slice(0, 10));
    setAttIn('09:00');
    setAttOut('17:30');
    setAttShift('Standard Day Shift');
    setAttReg('8');
    setAttOt('0');
    setAttStatus('present');
    setAttNotes('');
    setAttModal(true);
  }

  function openEditAtt(a: AttendanceLogItem) {
    setEditingAtt(a);
    setAttEmpId(String(a.employee_id));
    setAttDate(a.work_date);
    setAttIn(a.clock_in);
    setAttOut(a.clock_out);
    setAttShift(a.shift_name);
    setAttReg(String(a.regular_hours));
    setAttOt(String(a.overtime_hours));
    setAttStatus(a.status);
    setAttNotes(a.notes ?? '');
    setAttModal(true);
  }

  async function handleSaveAtt(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        employeeId: Number(attEmpId),
        workDate: attDate,
        clockIn: attIn,
        clockOut: attOut,
        shiftName: attShift,
        regularHours: Number(attReg) || 0,
        overtimeHours: Number(attOt) || 0,
        status: attStatus,
        notes: attNotes,
      };
      if (editingAtt) {
        await apiRequest(`/api/hr/attendance/${editingAtt.id}`, { method: 'PUT', body: payload });
        onNotify('Attendance log updated.');
      } else {
        await apiRequest('/api/hr/attendance', { method: 'POST', body: payload });
        onNotify('Attendance log recorded.');
      }
      setAttModal(false);
      setEditingAtt(null);
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save attendance.', 'error');
    }
  }

  function openCreateShift() {
    setEditingShift(null);
    if (employees[0] && !shEmpId) setShEmpId(String(employees[0].id));
    setShName('Standard Day Shift');
    setShStart('09:00');
    setShEnd('17:30');
    setShDays('Mon–Fri');
    setShLoc('HQ / Hybrid');
    setShStatus('active');
    setShiftModal(true);
  }

  function openEditShift(s: ShiftScheduleItem) {
    setEditingShift(s);
    setShEmpId(String(s.employee_id));
    setShName(s.shift_name);
    setShStart(s.start_time);
    setShEnd(s.end_time);
    setShDays(s.work_days);
    setShLoc(s.location);
    setShStatus(s.status);
    setShiftModal(true);
  }

  async function handleSaveShift(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        employeeId: Number(shEmpId),
        shiftName: shName,
        startTime: shStart,
        endTime: shEnd,
        workDays: shDays,
        location: shLoc,
        status: shStatus,
      };
      if (editingShift) {
        await apiRequest(`/api/hr/shifts/${editingShift.id}`, { method: 'PUT', body: payload });
        onNotify(`Shift ${editingShift.ref} updated.`);
      } else {
        await apiRequest('/api/hr/shifts', { method: 'POST', body: payload });
        onNotify('Shift schedule assigned.');
      }
      setShiftModal(false);
      setEditingShift(null);
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save shift schedule.', 'error');
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
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save leave request.', 'error');
    }
  }

  async function handleDecideLeave(id: number, decision: 'approved' | 'rejected') {
    try {
      await apiRequest(`/api/leave-requests/${id}/decide`, { method: 'POST', body: { decision } });
      onNotify(`Leave request ${decision}.`);
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to decide leave request.', 'error');
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
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save timesheet.', 'error');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 self-start">
          {[
            { key: 'attendance', label: `Clock & Overtime (${attendanceLogs.length})` },
            { key: 'shifts', label: `Shift Schedules (${shiftSchedules.length})` },
            { key: 'leave', label: `Leave Requests (${leaveRequests.length})` },
            { key: 'timesheets', label: `Project Timesheets (${timesheets.length})` },
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
          <div className="flex items-center gap-2">
            {subTab === 'attendance' && (
              <button
                type="button"
                onClick={openCreateAtt}
                className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Log Attendance</span>
              </button>
            )}
            {subTab === 'shifts' && (
              <button
                type="button"
                onClick={openCreateShift}
                className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Assign Shift</span>
              </button>
            )}
            {subTab === 'leave' && (
              <button
                type="button"
                onClick={openCreateLeave}
                className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Request Leave</span>
              </button>
            )}
            {subTab === 'timesheets' && (
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

      {subTab === 'attendance' && (
        <div className="space-y-4">
          {canWrite && employees.length > 0 && (
            <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Quick Shift Clock-In</div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={clockEmpId}
                  onChange={(e) => setClockEmpId(e.target.value)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={clockShift}
                  onChange={(e) => setClockShift(e.target.value)}
                  placeholder="Shift label"
                  className="px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 w-44"
                />
                <select
                  value={clockStatus}
                  onChange={(e) => setClockStatus(e.target.value as 'present' | 'remote' | 'late')}
                  className="px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  <option value="present">On-Site Present</option>
                  <option value="remote">Remote</option>
                  <option value="late">Late Arrival</option>
                </select>
                <button
                  type="button"
                  onClick={handleClockIn}
                  className="px-3.5 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium inline-flex items-center gap-1.5"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Clock In Now</span>
                </button>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50 dark:bg-zinc-950 text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Shift</th>
                  <th className="px-4 py-3 font-medium">Clock In / Out</th>
                  <th className="px-4 py-3 font-medium text-right">Regular</th>
                  <th className="px-4 py-3 font-medium text-right">Overtime</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {attendanceLogs.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-3 font-mono">{formatDate(a.work_date)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{a.employee_name}</div>
                      <div className="text-[11px] text-zinc-500">{a.department}</div>
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{a.shift_name}</td>
                    <td className="px-4 py-3 font-mono tabular-nums">
                      {a.clock_in} → {a.clock_out || 'Active'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{a.regular_hours.toFixed(2)} h</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-amber-700 dark:text-amber-400">
                      {a.overtime_hours > 0 ? `+${a.overtime_hours.toFixed(2)} h` : '0.00 h'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={a.status} />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        {canWrite && !a.clock_out && (
                          <button
                            type="button"
                            onClick={() => handleClockOut(a.id)}
                            className="text-orange-700 dark:text-orange-400 font-medium inline-flex items-center gap-1 hover:underline"
                          >
                            <LogOut className="w-3 h-3" />
                            <span>Clock Out</span>
                          </button>
                        )}
                        {canValidate && a.status !== 'approved' && (
                          <button
                            type="button"
                            onClick={() => handleApproveAttendance(a.id)}
                            className="text-emerald-700 dark:text-emerald-400 font-medium hover:underline"
                          >
                            Approve
                          </button>
                        )}
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => openEditAtt(a)}
                            title="Edit attendance"
                            className="p-1 text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => onPromptDelete(`/api/hr/attendance/${a.id}`, `${a.employee_name} (${formatDate(a.work_date)})`)}
                            title="Delete attendance log"
                            className="p-1 text-zinc-400 hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {attendanceLogs.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-zinc-500">
                      No attendance clock logs recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'shifts' && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-50 dark:bg-zinc-950 text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-3 font-medium">Ref</th>
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Shift Name</th>
                <th className="px-4 py-3 font-medium">Window</th>
                <th className="px-4 py-3 font-medium">Days</th>
                <th className="px-4 py-3 font-medium">Location</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {shiftSchedules.map((sh) => (
                <tr key={sh.id}>
                  <td className="px-4 py-3 font-mono text-orange-700 dark:text-orange-400">{sh.ref}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">{sh.employee_name}</div>
                    <div className="text-[11px] text-zinc-500">{sh.department}</div>
                  </td>
                  <td className="px-4 py-3 font-medium">{sh.shift_name}</td>
                  <td className="px-4 py-3 font-mono tabular-nums">
                    {sh.start_time} – {sh.end_time}
                  </td>
                  <td className="px-4 py-3">{sh.work_days}</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{sh.location}</td>
                  <td className="px-4 py-3">
                    <StatusText status={sh.status} />
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => openEditShift(sh)}
                          title={`Edit ${sh.ref}`}
                          className="p-1 text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => onPromptDelete(`/api/hr/shifts/${sh.id}`, `${sh.ref} (${sh.shift_name})`)}
                          title={`Delete ${sh.ref}`}
                          className="p-1 text-zinc-400 hover:text-red-600"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {shiftSchedules.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-zinc-500">
                    No shift schedules assigned yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'leave' && (
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
                  <td className="px-4 py-3">
                    <StatusText status={lr.status} />
                  </td>
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
                          onClick={() => onPromptDelete(`/api/leave-requests/${lr.id}`, `${lr.ref} (${lr.employee_name})`)}
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

      {subTab === 'timesheets' && (
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
                            onPromptDelete(`/api/timesheets/${ts.id}`, `${ts.employee_name} · ${ts.hours}h (${formatDate(ts.work_date)})`)
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

      {/* Attendance Modal */}
      <Modal
        open={attModal}
        onClose={() => {
          setAttModal(false);
          setEditingAtt(null);
        }}
        title={editingAtt ? `Edit Attendance (${editingAtt.employee_name})` : 'Log Employee Attendance'}
      >
        <form onSubmit={handleSaveAtt} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Employee</label>
              <select
                required
                value={attEmpId}
                onChange={(e) => setAttEmpId(e.target.value)}
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
              <label className="block text-xs font-medium mb-1">Work Date</label>
              <input
                type="date"
                required
                value={attDate}
                onChange={(e) => setAttDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Clock In</label>
              <input
                type="time"
                value={attIn}
                onChange={(e) => setAttIn(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Clock Out</label>
              <input
                type="time"
                value={attOut}
                onChange={(e) => setAttOut(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Regular Hrs</label>
              <input
                type="number"
                step="0.25"
                value={attReg}
                onChange={(e) => setAttReg(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Overtime Hrs</label>
              <input
                type="number"
                step="0.25"
                value={attOt}
                onChange={(e) => setAttOt(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Shift Name</label>
              <input
                type="text"
                value={attShift}
                onChange={(e) => setAttShift(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Status</label>
              <select
                value={attStatus}
                onChange={(e) => setAttStatus(e.target.value as AttendanceLogItem['status'])}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="present">Present</option>
                <option value="remote">Remote</option>
                <option value="late">Late</option>
                <option value="absent">Absent</option>
                <option value="approved">Approved</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Notes</label>
            <input
              type="text"
              value={attNotes}
              onChange={(e) => setAttNotes(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAttModal(false)} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium">
              {editingAtt ? 'Save Attendance' : 'Record Attendance'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Shift Schedule Modal */}
      <Modal
        open={shiftModal}
        onClose={() => {
          setShiftModal(false);
          setEditingShift(null);
        }}
        title={editingShift ? `Edit ${editingShift.ref}` : 'Assign Shift Schedule'}
      >
        <form onSubmit={handleSaveShift} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Employee</label>
              <select
                required
                value={shEmpId}
                onChange={(e) => setShEmpId(e.target.value)}
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
              <label className="block text-xs font-medium mb-1">Shift Name</label>
              <input
                type="text"
                required
                value={shName}
                onChange={(e) => setShName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Start Time</label>
              <input
                type="time"
                value={shStart}
                onChange={(e) => setShStart(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">End Time</label>
              <input
                type="time"
                value={shEnd}
                onChange={(e) => setShEnd(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Work Days</label>
              <input
                type="text"
                value={shDays}
                onChange={(e) => setShDays(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Location</label>
              <input
                type="text"
                value={shLoc}
                onChange={(e) => setShLoc(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Status</label>
              <select
                value={shStatus}
                onChange={(e) => setShStatus(e.target.value as 'active' | 'inactive')}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShiftModal(false)} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium">
              {editingShift ? 'Save Shift' : 'Assign Shift'}
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
                <option value="Parental">Parental</option>
                <option value="Unpaid">Unpaid</option>
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
            <button type="button" onClick={() => setLeaveModal(false)} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium">
              {editingLeave ? 'Save Request' : 'Submit Request'}
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
            <button type="button" onClick={() => setTsModal(false)} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium">
              Save Entry
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

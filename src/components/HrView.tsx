import { useEffect, useState } from 'react';
import { Award, Briefcase, CalendarClock, ShieldCheck, Users, Wallet } from 'lucide-react';
import { apiRequest, can } from '../lib/api';
import type {
  AttendanceLogItem,
  BenefitEnrollmentItem,
  BenefitPlanItem,
  CandidateItem,
  EmployeeItem,
  ExpenseReportItem,
  HrAnalyticsSummary,
  HrComplianceItem,
  JobPosting,
  KpiEvaluationItem,
  LeaveRequestItem,
  OnboardingTaskItem,
  PayrollRunItem,
  PayslipItem,
  PermissionMap,
  Project,
  ShiftScheduleItem,
  TimesheetItem,
} from '../types/erp';
import { ConfirmDeleteModal } from './Modal';
import { HrComplianceSection } from './hr/HrComplianceSection';
import { HrKpiSection } from './hr/HrKpiSection';
import { HrPayrollBenefitsSection } from './hr/HrPayrollBenefitsSection';
import { HrRecruitmentOnboardingSection } from './hr/HrRecruitmentOnboardingSection';
import { HrStaffSelfServiceSection } from './hr/HrStaffSelfServiceSection';
import { HrTimeLeaveSection } from './hr/HrTimeLeaveSection';

interface HrViewProps {
  permissions: PermissionMap;
  currentUserEmail?: string;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

type HrTab = 'staff' | 'time_leave' | 'payroll' | 'recruitment' | 'kpi' | 'compliance';

const EMPTY_ANALYTICS: HrAnalyticsSummary = {
  totalHeadcount: 0,
  activeHeadcount: 0,
  onLeaveCount: 0,
  terminatedCount: 0,
  turnoverRatePct: 0,
  totalAnnualPayroll: 0,
  monthlyPayrollEstimate: 0,
  latestPayrollNet: 0,
  totalOvertimeHours: 0,
  pendingLeaveCount: 0,
  onboardingCompletionPct: 100,
  avgKpiScore: 0,
  complianceRatePct: 100,
  departmentBreakdown: [],
};

export function HrView({ permissions, currentUserEmail, onNotify }: HrViewProps) {
  const [tab, setTab] = useState<HrTab>('staff');
  const [employees, setEmployees] = useState<EmployeeItem[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequestItem[]>([]);
  const [expenseReports, setExpenseReports] = useState<ExpenseReportItem[]>([]);
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [candidates, setCandidates] = useState<CandidateItem[]>([]);
  const [timesheets, setTimesheets] = useState<TimesheetItem[]>([]);
  const [attendanceLogs, setAttendanceLogs] = useState<AttendanceLogItem[]>([]);
  const [shiftSchedules, setShiftSchedules] = useState<ShiftScheduleItem[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRunItem[]>([]);
  const [payslips, setPayslips] = useState<PayslipItem[]>([]);
  const [benefitPlans, setBenefitPlans] = useState<BenefitPlanItem[]>([]);
  const [benefitEnrollments, setBenefitEnrollments] = useState<BenefitEnrollmentItem[]>([]);
  const [onboardingTasks, setOnboardingTasks] = useState<OnboardingTaskItem[]>([]);
  const [kpiEvaluations, setKpiEvaluations] = useState<KpiEvaluationItem[]>([]);
  const [complianceRecords, setComplianceRecords] = useState<HrComplianceItem[]>([]);
  const [analytics, setAnalytics] = useState<HrAnalyticsSummary>(EMPTY_ANALYTICS);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const canWrite = can(permissions, 'hr', 'write');
  const canValidate = can(permissions, 'hr', 'validate');
  const canDelete = can(permissions, 'hr', 'delete');

  const [deleteTarget, setDeleteTarget] = useState<{ url: string; label: string; warning?: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

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
          attendanceLogs?: AttendanceLogItem[];
          shiftSchedules?: ShiftScheduleItem[];
          payrollRuns?: PayrollRunItem[];
          payslips?: PayslipItem[];
          benefitPlans?: BenefitPlanItem[];
          benefitEnrollments?: BenefitEnrollmentItem[];
          onboardingTasks?: OnboardingTaskItem[];
          kpiEvaluations?: KpiEvaluationItem[];
          complianceRecords?: HrComplianceItem[];
          analytics?: HrAnalyticsSummary;
        }>('/api/hr'),
        apiRequest<{ projects: Project[] }>('/api/projects').catch(() => ({ projects: [] })),
      ]);
      setEmployees(hrRes.employees ?? []);
      setLeaveRequests(hrRes.leaveRequests ?? []);
      setExpenseReports(hrRes.expenseReports ?? []);
      setJobs(hrRes.jobs ?? []);
      setCandidates(hrRes.candidates ?? []);
      setTimesheets(hrRes.timesheets ?? []);
      setAttendanceLogs(hrRes.attendanceLogs ?? []);
      setShiftSchedules(hrRes.shiftSchedules ?? []);
      setPayrollRuns(hrRes.payrollRuns ?? []);
      setPayslips(hrRes.payslips ?? []);
      setBenefitPlans(hrRes.benefitPlans ?? []);
      setBenefitEnrollments(hrRes.benefitEnrollments ?? []);
      setOnboardingTasks(hrRes.onboardingTasks ?? []);
      setKpiEvaluations(hrRes.kpiEvaluations ?? []);
      setComplianceRecords(hrRes.complianceRecords ?? []);
      setAnalytics(hrRes.analytics ?? EMPTY_ANALYTICS);
      setProjects(projRes.projects ?? []);
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

  const tabs: Array<{ key: HrTab; label: string; Icon: typeof Users }> = [
    { key: 'staff', label: `Staff & Self-Service (${employees.length})`, Icon: Users },
    { key: 'time_leave', label: `Time, Attendance & Leave`, Icon: CalendarClock },
    { key: 'payroll', label: `Payroll & Benefits`, Icon: Wallet },
    { key: 'recruitment', label: `Recruitment & Onboarding`, Icon: Briefcase },
    { key: 'kpi', label: `KPI Evaluation (${kpiEvaluations.length})`, Icon: Award },
    { key: 'compliance', label: `Compliance & Reporting`, Icon: ShieldCheck },
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
              className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                tab === key
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="p-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-center text-sm text-zinc-500">
          Loading human resources records...
        </div>
      ) : (
        <>
          {tab === 'staff' && (
            <HrStaffSelfServiceSection
              employees={employees}
              payslips={payslips}
              currentUserEmail={currentUserEmail}
              canWrite={canWrite}
              canDelete={canDelete}
              onRefresh={loadHr}
              onNotify={onNotify}
              onPromptDelete={promptDelete}
            />
          )}

          {tab === 'time_leave' && (
            <HrTimeLeaveSection
              employees={employees}
              attendanceLogs={attendanceLogs}
              shiftSchedules={shiftSchedules}
              leaveRequests={leaveRequests}
              timesheets={timesheets}
              projects={projects}
              canWrite={canWrite}
              canValidate={canValidate}
              canDelete={canDelete}
              onRefresh={loadHr}
              onNotify={onNotify}
              onPromptDelete={promptDelete}
            />
          )}

          {tab === 'payroll' && (
            <HrPayrollBenefitsSection
              employees={employees}
              payrollRuns={payrollRuns}
              payslips={payslips}
              benefitPlans={benefitPlans}
              benefitEnrollments={benefitEnrollments}
              expenseReports={expenseReports}
              canWrite={canWrite}
              canValidate={canValidate}
              canDelete={canDelete}
              onRefresh={loadHr}
              onNotify={onNotify}
              onPromptDelete={promptDelete}
            />
          )}

          {tab === 'recruitment' && (
            <HrRecruitmentOnboardingSection
              employees={employees}
              jobs={jobs}
              candidates={candidates}
              onboardingTasks={onboardingTasks}
              canWrite={canWrite}
              canValidate={canValidate}
              canDelete={canDelete}
              onRefresh={loadHr}
              onNotify={onNotify}
              onPromptDelete={promptDelete}
            />
          )}

          {tab === 'kpi' && (
            <HrKpiSection
              employees={employees}
              kpiEvaluations={kpiEvaluations}
              currentUserEmail={currentUserEmail}
              canWrite={canWrite}
              canValidate={canValidate}
              canDelete={canDelete}
              onRefresh={loadHr}
              onNotify={onNotify}
              onPromptDelete={promptDelete}
            />
          )}

          {tab === 'compliance' && (
            <HrComplianceSection
              analytics={analytics}
              complianceRecords={complianceRecords}
              canWrite={canWrite}
              canDelete={canDelete}
              onRefresh={loadHr}
              onNotify={onNotify}
              onPromptDelete={promptDelete}
            />
          )}
        </>
      )}

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

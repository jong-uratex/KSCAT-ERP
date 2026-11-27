import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Pencil, Plus, Trash2 } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatDate } from '../../lib/format';
import type { CandidateItem, EmployeeItem, JobPosting, OnboardingTaskItem } from '../../types/erp';
import { Modal } from '../Modal';
import { StatusText } from '../StatusText';

interface HrRecruitmentOnboardingSectionProps {
  employees: EmployeeItem[];
  jobs: JobPosting[];
  candidates: CandidateItem[];
  onboardingTasks: OnboardingTaskItem[];
  canWrite: boolean;
  canValidate: boolean;
  canDelete: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPromptDelete: (url: string, label: string, warning?: string) => void;
}

export function HrRecruitmentOnboardingSection({
  employees,
  jobs,
  candidates,
  onboardingTasks,
  canWrite,
  canValidate,
  canDelete,
  onRefresh,
  onNotify,
  onPromptDelete,
}: HrRecruitmentOnboardingSectionProps) {
  const [subTab, setSubTab] = useState<'recruitment' | 'onboarding'>('recruitment');

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

  // Onboarding Task Modal
  const [onbModal, setOnbModal] = useState(false);
  const [editingOnb, setEditingOnb] = useState<OnboardingTaskItem | null>(null);
  const [onbEmpId, setOnbEmpId] = useState('');
  const [onbCandId, setOnbCandId] = useState('');
  const [onbTitle, setOnbTitle] = useState('');
  const [onbCategory, setOnbCategory] = useState('Identity & Tax Forms');
  const [onbDue, setOnbDue] = useState(new Date().toISOString().slice(0, 10));
  const [onbAssignee, setOnbAssignee] = useState('HR Operations');
  const [onbStatus, setOnbStatus] = useState<OnboardingTaskItem['status']>('pending');
  const [onbNotes, setOnbNotes] = useState('');

  useEffect(() => {
    if (jobs[0] && !candJobId) setCandJobId(String(jobs[0].id));
  }, [jobs]);

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
      await onRefresh();
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
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save candidate.', 'error');
    }
  }

  async function handleUpdateCandidateStage(id: number, stage: CandidateItem['stage']) {
    try {
      await apiRequest(`/api/recruitment/candidates/${id}`, { method: 'PUT', body: { stage } });
      onNotify('Candidate stage updated.');
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update stage.', 'error');
    }
  }

  function openCreateOnb() {
    setEditingOnb(null);
    setOnbEmpId(employees[0] ? String(employees[0].id) : '');
    setOnbCandId('');
    setOnbTitle('');
    setOnbCategory('Identity & Tax Forms');
    setOnbDue(new Date().toISOString().slice(0, 10));
    setOnbAssignee('HR Operations');
    setOnbStatus('pending');
    setOnbNotes('');
    setOnbModal(true);
  }

  function openEditOnb(task: OnboardingTaskItem) {
    setEditingOnb(task);
    setOnbEmpId(task.employee_id ? String(task.employee_id) : '');
    setOnbCandId(task.candidate_id ? String(task.candidate_id) : '');
    setOnbTitle(task.task_title);
    setOnbCategory(task.category);
    setOnbDue(task.due_date);
    setOnbAssignee(task.assignee_name);
    setOnbStatus(task.status);
    setOnbNotes(task.notes);
    setOnbModal(true);
  }

  async function handleSaveOnb(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        employeeId: onbEmpId ? Number(onbEmpId) : null,
        candidateId: onbCandId ? Number(onbCandId) : null,
        taskTitle: onbTitle,
        category: onbCategory,
        dueDate: onbDue,
        assigneeName: onbAssignee,
        status: onbStatus,
        notes: onbNotes,
      };
      if (editingOnb) {
        await apiRequest(`/api/hr/onboarding/${editingOnb.id}`, { method: 'PUT', body: payload });
        onNotify(`Onboarding task ${editingOnb.ref} updated.`);
      } else {
        await apiRequest('/api/hr/onboarding', { method: 'POST', body: payload });
        onNotify('Onboarding checklist item added.');
      }
      setOnbModal(false);
      setEditingOnb(null);
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save onboarding item.', 'error');
    }
  }

  async function handleToggleOnbStatus(task: OnboardingTaskItem) {
    const nextStatus = task.status === 'completed' ? 'in_progress' : 'completed';
    try {
      await apiRequest(`/api/hr/onboarding/${task.id}`, { method: 'PUT', body: { status: nextStatus } });
      onNotify(`Onboarding task marked ${nextStatus.replace('_', ' ')}.`);
      await onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update onboarding task.', 'error');
    }
  }

  const completedCount = onboardingTasks.filter((t) => t.status === 'completed').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 self-start">
          <button
            type="button"
            onClick={() => setSubTab('recruitment')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              subTab === 'recruitment'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            Job Postings & Pipeline ({candidates.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('onboarding')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              subTab === 'onboarding'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            Digital Onboarding ({completedCount}/{onboardingTasks.length})
          </button>
        </div>

        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            {subTab === 'recruitment' ? (
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
            ) : (
              <button
                type="button"
                onClick={openCreateOnb}
                className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Onboarding Task</span>
              </button>
            )}
          </div>
        )}
      </div>

      {subTab === 'recruitment' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {jobs.map((job) => (
              <div key={job.id} className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-2">
                <div className="flex items-center justify-between text-xs gap-2">
                  <span className="font-mono text-orange-700 dark:text-orange-400">{job.ref}</span>
                  <div className="flex items-center gap-2">
                    <StatusText status={job.status} />
                    {canWrite && (
                      <button type="button" onClick={() => openEditJob(job)} title={`Edit ${job.ref}`} className="p-1 text-zinc-500 hover:text-orange-700">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() =>
                          onPromptDelete(
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
                {job.description && <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">{job.description}</p>}
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 text-xs font-semibold">
              Applicant Tracking Pipeline ({candidates.length})
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
                          <button type="button" onClick={() => openEditCand(c)} title={`Edit ${c.full_name}`} className="p-1 text-zinc-500 hover:text-orange-700">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button type="button" onClick={() => onPromptDelete(`/api/recruitment/candidates/${c.id}`, c.full_name)} title={`Delete ${c.full_name}`} className="p-1 text-zinc-400 hover:text-red-600">
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

      {subTab === 'onboarding' && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs">
            <span className="font-semibold">Pre-Start Digital Paperwork & Day-1 Readiness ({onboardingTasks.length})</span>
            <span className="font-mono tabular-nums text-zinc-500">
              {onboardingTasks.length > 0 ? Math.round((completedCount / onboardingTasks.length) * 100) : 100}% Complete
            </span>
          </div>
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-50 dark:bg-zinc-950 text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-3 font-medium">Ref</th>
                <th className="px-4 py-3 font-medium">Checklist Task</th>
                <th className="px-4 py-3 font-medium">New Hire / Candidate</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Due Date</th>
                <th className="px-4 py-3 font-medium">Assignee</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {onboardingTasks.map((task) => (
                <tr key={task.id}>
                  <td className="px-4 py-3 font-mono text-orange-700 dark:text-orange-400">{task.ref}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">{task.task_title}</div>
                    {task.notes && <div className="text-[11px] text-zinc-500 max-w-xs truncate">{task.notes}</div>}
                  </td>
                  <td className="px-4 py-3">{task.employee_name || task.candidate_name || 'Unassigned'}</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{task.category}</td>
                  <td className="px-4 py-3 font-mono">{formatDate(task.due_date)}</td>
                  <td className="px-4 py-3">{task.assignee_name}</td>
                  <td className="px-4 py-3">
                    <StatusText status={task.status} />
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => handleToggleOnbStatus(task)}
                          title={task.status === 'completed' ? 'Reopen task' : 'Mark completed'}
                          className="p-1 text-zinc-500 hover:text-emerald-700"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canWrite && (
                        <button type="button" onClick={() => openEditOnb(task)} title={`Edit ${task.ref}`} className="p-1 text-zinc-500 hover:text-orange-700">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button type="button" onClick={() => onPromptDelete(`/api/hr/onboarding/${task.id}`, `${task.ref} (${task.task_title})`)} title={`Delete ${task.ref}`} className="p-1 text-zinc-400 hover:text-red-600">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {onboardingTasks.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-zinc-500">
                    No onboarding checklist tasks created yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Job Posting Modal */}
      <Modal open={jobModal} onClose={() => setJobModal(false)} title={editingJob ? `Edit ${editingJob.ref}` : 'Create Job Posting'}>
        <form onSubmit={handleSaveJob} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Job Title</label>
            <input type="text" required value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Department</label>
              <input type="text" value={jobDept} onChange={(e) => setJobDept(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Location</label>
              <input type="text" value={jobLoc} onChange={(e) => setJobLoc(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Contract Type</label>
              <input type="text" value={jobType} onChange={(e) => setJobType(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
          </div>
          {editingJob && (
            <div>
              <label className="block text-xs font-medium mb-1">Posting Status</label>
              <select value={jobStatus} onChange={(e) => setJobStatus(e.target.value as JobPosting['status'])} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                <option value="draft">Draft</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium mb-1">Description</label>
            <textarea rows={3} value={jobDesc} onChange={(e) => setJobDesc(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setJobModal(false)} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium">{editingJob ? 'Save Role' : 'Publish Role'}</button>
          </div>
        </form>
      </Modal>

      {/* Candidate Modal */}
      <Modal open={candModal} onClose={() => setCandModal(false)} title={editingCand ? `Edit ${editingCand.full_name}` : 'Add Recruitment Candidate'}>
        <form onSubmit={handleSaveCandidate} className="space-y-4">
          <div className={editingCand ? 'grid grid-cols-2 gap-3' : ''}>
            <div>
              <label className="block text-xs font-medium mb-1">Job Posting</label>
              <select required value={candJobId} onChange={(e) => setCandJobId(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
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
                <select value={candStage} onChange={(e) => setCandStage(e.target.value as CandidateItem['stage'])} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
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
              <input type="text" required value={candName} onChange={(e) => setCandName(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Email</label>
              <input type="email" required value={candEmail} onChange={(e) => setCandEmail(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Phone</label>
            <input type="text" value={candPhone} onChange={(e) => setCandPhone(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Recruiter Notes</label>
            <textarea rows={2} value={candNotes} onChange={(e) => setCandNotes(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCandModal(false)} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium">{editingCand ? 'Save Candidate' : 'Add Candidate'}</button>
          </div>
        </form>
      </Modal>

      {/* Onboarding Task Modal */}
      <Modal open={onbModal} onClose={() => setOnbModal(false)} title={editingOnb ? `Edit ${editingOnb.ref}` : 'Create Onboarding Checklist Item'}>
        <form onSubmit={handleSaveOnb} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Task Title</label>
            <input type="text" required value={onbTitle} onChange={(e) => setOnbTitle(e.target.value)} placeholder="Collect Tax W-4 & NDA e-Signature" className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Employee (Optional)</label>
              <select value={onbEmpId} onChange={(e) => setOnbEmpId(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                <option value="">None / Pre-Hire Only</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Candidate (Optional)</label>
              <select value={onbCandId} onChange={(e) => setOnbCandId(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                <option value="">None</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>{c.full_name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Category</label>
              <select value={onbCategory} onChange={(e) => setOnbCategory(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                <option value="Identity & Tax Forms">Identity & Tax Forms</option>
                <option value="Contract & NDA">Contract & NDA</option>
                <option value="IT Provisioning">IT Provisioning</option>
                <option value="Orientation & Training">Orientation & Training</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Due Date</label>
              <input type="date" value={onbDue} onChange={(e) => setOnbDue(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Status</label>
              <select value={onbStatus} onChange={(e) => setOnbStatus(e.target.value as OnboardingTaskItem['status'])} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Assignee / Coordinator</label>
            <input type="text" value={onbAssignee} onChange={(e) => setOnbAssignee(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Notes</label>
            <textarea rows={2} value={onbNotes} onChange={(e) => setOnbNotes(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOnbModal(false)} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium">{editingOnb ? 'Save Task' : 'Create Task'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

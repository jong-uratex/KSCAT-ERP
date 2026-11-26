import { useEffect, useState, type FormEvent } from 'react';
import { BarChart3, Calendar, Clock, Download, FolderKanban, Pencil, Plus, TicketCheck, Trash2, Upload } from 'lucide-react';
import { apiRequest, can } from '../lib/api';
import { formatCurrency, formatDate } from '../lib/format';
import type {
  AgendaEvent,
  EnabledModulesMap,
  OrgEvent,
  PermissionMap,
  Project,
  ProjectTask,
  SearchFocusHint,
  SurveyItem,
  ThirdParty,
} from '../types/erp';
import { ConfirmDeleteModal, Modal } from './Modal';
import { StatusText } from './StatusText';

interface ProjectsViewProps {
  permissions: PermissionMap;
  enabledModules: EnabledModulesMap;
  focusHint?: SearchFocusHint | null;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export function ProjectsView({ permissions, enabledModules, focusHint, onNotify }: ProjectsViewProps) {
  const showCollab = enabledModules.collaboration !== false;
  const [tab, setTab] = useState<'projects' | 'agenda' | 'events' | 'surveys'>('projects');
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [thirdParties, setThirdParties] = useState<ThirdParty[]>([]);
  const [agendaEvents, setAgendaEvents] = useState<AgendaEvent[]>([]);
  const [orgEvents, setOrgEvents] = useState<OrgEvent[]>([]);
  const [surveys, setSurveys] = useState<SurveyItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const [projModal, setProjModal] = useState(false);
  const [editingProj, setEditingProj] = useState<Project | null>(null);
  const [pTitle, setPTitle] = useState('');
  const [pPartyId, setPPartyId] = useState('');
  const [pBudget, setPBudget] = useState('15000');
  const [pDue, setPDue] = useState('');
  const [pStatus, setPStatus] = useState<Project['status']>('active');
  const [pDesc, setPDesc] = useState('');

  const [taskModal, setTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
  const [tTitle, setTTitle] = useState('');
  const [tAssignee, setTAssignee] = useState('');
  const [tPriority, setTPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [tStatus, setTStatus] = useState<ProjectTask['status']>('todo');
  const [tEstHours, setTEstHours] = useState('8');
  const [tProgress, setTProgress] = useState('0');
  const [tDue, setTDue] = useState('');

  const [agendaModal, setAgendaModal] = useState(false);
  const [editingAgenda, setEditingAgenda] = useState<AgendaEvent | null>(null);
  const [agTitle, setAgTitle] = useState('');
  const [agType, setAgType] = useState<AgendaEvent['event_type']>('meeting');
  const [agStart, setAgStart] = useState(new Date().toISOString().slice(0, 16));
  const [agLocation, setAgLocation] = useState('');
  const [agDesc, setAgDesc] = useState('');

  const [icsImportModal, setIcsImportModal] = useState(false);
  const [icsContent, setIcsContent] = useState('');

  const [orgModal, setOrgModal] = useState(false);
  const [editingOrg, setEditingOrg] = useState<OrgEvent | null>(null);
  const [evTitle, setEvTitle] = useState('');
  const [evDate, setEvDate] = useState(new Date().toISOString().slice(0, 10));
  const [evVenue, setEvVenue] = useState('');
  const [evCapacity, setEvCapacity] = useState('80');
  const [evStatus, setEvStatus] = useState<OrgEvent['status']>('open');

  const [surveyModal, setSurveyModal] = useState(false);
  const [editingSurvey, setEditingSurvey] = useState<SurveyItem | null>(null);
  const [srvTitle, setSrvTitle] = useState('');
  const [srvQuestion, setSrvQuestion] = useState('');
  const [srvOptions, setSrvOptions] = useState('Option A, Option B, Option C');
  const [srvStatus, setSrvStatus] = useState<SurveyItem['status']>('open');

  const [deleteTarget, setDeleteTarget] = useState<{
    endpoint: string;
    label: string;
    warning?: string;
    onAfterDelete?: () => void;
  } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const canWrite = can(permissions, 'projects', 'write');
  const canDelete = can(permissions, 'projects', 'delete');
  const canLogTime = can(permissions, 'projects', 'log_time') || canWrite;

  async function loadProjects() {
    setLoading(true);
    try {
      const [prRes, tpRes, colRes] = await Promise.all([
        apiRequest<{ projects: Project[]; tasks: ProjectTask[] }>('/api/projects'),
        apiRequest<{ thirdParties: ThirdParty[] }>('/api/third-parties'),
        showCollab
          ? apiRequest<{ agendaEvents: AgendaEvent[]; orgEvents: OrgEvent[]; surveys: SurveyItem[] }>(
              '/api/collaboration'
            )
          : Promise.resolve({ agendaEvents: [], orgEvents: [], surveys: [] }),
      ]);
      setProjects(prRes.projects);
      setTasks(prRes.tasks);
      setThirdParties(tpRes.thirdParties);
      setAgendaEvents(colRes.agendaEvents);
      setOrgEvents(colRes.orgEvents);
      setSurveys(colRes.surveys);
      if (prRes.projects[0] && !selectedProjectId) {
        setSelectedProjectId(prRes.projects[0].id);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to load projects & collaboration.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (!focusHint) return;
    setTab('projects');
    setSelectedProjectId(focusHint.recordId);
  }, [focusHint?.ts]);

  function openCreateProject() {
    setEditingProj(null);
    setPTitle('');
    setPPartyId('');
    setPBudget('15000');
    setPDue('');
    setPStatus('active');
    setPDesc('');
    setProjModal(true);
  }

  function openEditProject(pr: Project) {
    setEditingProj(pr);
    setPTitle(pr.title);
    setPPartyId(pr.third_party_id ? String(pr.third_party_id) : '');
    setPBudget(String(pr.budget_amount));
    setPDue(pr.due_date);
    setPStatus(pr.status);
    setPDesc(pr.description);
    setProjModal(true);
  }

  async function handleSaveProject(e: FormEvent) {
    e.preventDefault();
    try {
      const body = {
        title: pTitle,
        thirdPartyId: pPartyId ? Number(pPartyId) : null,
        budgetAmount: Number(pBudget) || 0,
        dueDate: pDue || undefined,
        status: editingProj ? pStatus : undefined,
        description: pDesc,
      };
      if (editingProj) {
        await apiRequest(`/api/projects/${editingProj.id}`, { method: 'PUT', body });
        onNotify(`Updated project ${editingProj.ref}.`);
      } else {
        const created = await apiRequest<Project>('/api/projects', { method: 'POST', body });
        setSelectedProjectId(created.id);
        onNotify('Project created.');
      }
      setProjModal(false);
      setEditingProj(null);
      await loadProjects();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save project.', 'error');
    }
  }

  function openCreateTask() {
    setEditingTask(null);
    setTTitle('');
    setTAssignee('');
    setTPriority('medium');
    setTStatus('todo');
    setTEstHours('8');
    setTProgress('0');
    setTDue('');
    setTaskModal(true);
  }

  function openEditTask(t: ProjectTask) {
    setEditingTask(t);
    setTTitle(t.title);
    setTAssignee(t.assignee_name);
    setTPriority(t.priority);
    setTStatus(t.status);
    setTEstHours(String(t.estimated_hours));
    setTProgress(String(t.progress));
    setTDue(t.due_date);
    setTaskModal(true);
  }

  async function handleSaveTask(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingTask) {
        await apiRequest(`/api/tasks/${editingTask.id}`, {
          method: 'PUT',
          body: {
            title: tTitle,
            assigneeName: tAssignee,
            priority: tPriority,
            estimatedHours: Number(tEstHours) || 8,
            dueDate: tDue,
            status: tStatus,
            progress: Number(tProgress) || 0,
          },
        });
        onNotify(`Updated task ${editingTask.ref}.`);
      } else {
        if (!selectedProjectId) return;
        await apiRequest(`/api/projects/${selectedProjectId}/tasks`, {
          method: 'POST',
          body: {
            title: tTitle,
            assigneeName: tAssignee,
            priority: tPriority,
            estimatedHours: Number(tEstHours) || 8,
            dueDate: tDue,
          },
        });
        onNotify('Task added.');
      }
      setTaskModal(false);
      setEditingTask(null);
      await loadProjects();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save task.', 'error');
    }
  }

  async function handleLogTime(task: ProjectTask, addHours: number, nextProgress?: number) {
    try {
      await apiRequest(`/api/tasks/${task.id}`, {
        method: 'PUT',
        body: {
          addHours,
          progress: nextProgress ?? Math.min(100, task.progress + 25),
          status: (nextProgress ?? task.progress + 25) >= 100 ? 'done' : 'in_progress',
        },
      });
      onNotify(`Logged +${addHours}h on ${task.ref}.`);
      await loadProjects();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update task.', 'error');
    }
  }

  function openCreateAgenda() {
    setEditingAgenda(null);
    setAgTitle('');
    setAgType('meeting');
    setAgStart(new Date().toISOString().slice(0, 16));
    setAgLocation('');
    setAgDesc('');
    setAgendaModal(true);
  }

  function openEditAgenda(ev: AgendaEvent) {
    setEditingAgenda(ev);
    setAgTitle(ev.title);
    setAgType(ev.event_type);
    setAgStart(ev.start_at.slice(0, 16));
    setAgLocation(ev.location);
    setAgDesc(ev.description);
    setAgendaModal(true);
  }

  async function handleSaveAgenda(e: FormEvent) {
    e.preventDefault();
    try {
      const body = {
        title: agTitle,
        eventType: agType,
        startAt: agStart,
        endAt: agStart,
        location: agLocation,
        description: agDesc,
      };
      if (editingAgenda) {
        await apiRequest(`/api/agenda-events/${editingAgenda.id}`, { method: 'PUT', body });
        onNotify('Calendar event updated.');
      } else {
        await apiRequest('/api/agenda-events', { method: 'POST', body });
        onNotify('Calendar event added to shared agenda.');
      }
      setAgendaModal(false);
      setEditingAgenda(null);
      await loadProjects();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save event.', 'error');
    }
  }

  async function handleExportCalendar(format: 'ical' | 'vcal') {
    try {
      const res = await apiRequest<{ content: string; count: number }>(
        `/api/agenda-events/export.ics?format=${format}`
      );
      const blob = new Blob([res.content], { type: 'text/calendar' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = format === 'vcal' ? 'kscat-agenda.vcs' : 'kscat-agenda.ics';
      a.click();
      URL.revokeObjectURL(url);
      onNotify(`Exported ${res.count} calendar event(s) in ${format.toUpperCase()} format.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Calendar export failed.', 'error');
    }
  }

  async function handleImportIcs(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await apiRequest<{ imported: number }>('/api/agenda-events/import-ics', {
        method: 'POST',
        body: { content: icsContent },
      });
      setIcsImportModal(false);
      setIcsContent('');
      onNotify(`Imported ${res.imported} calendar event(s).`);
      await loadProjects();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'iCal/vCal import failed.', 'error');
    }
  }

  function openCreateOrgEvent() {
    setEditingOrg(null);
    setEvTitle('');
    setEvDate(new Date().toISOString().slice(0, 10));
    setEvVenue('');
    setEvCapacity('80');
    setEvStatus('open');
    setOrgModal(true);
  }

  function openEditOrgEvent(ev: OrgEvent) {
    setEditingOrg(ev);
    setEvTitle(ev.title);
    setEvDate(ev.event_date);
    setEvVenue(ev.venue);
    setEvCapacity(String(ev.capacity));
    setEvStatus(ev.status);
    setOrgModal(true);
  }

  async function handleSaveOrgEvent(e: FormEvent) {
    e.preventDefault();
    try {
      const body = {
        title: evTitle,
        eventDate: evDate,
        venue: evVenue,
        capacity: Number(evCapacity) || 50,
        status: editingOrg ? evStatus : undefined,
      };
      if (editingOrg) {
        await apiRequest(`/api/org-events/${editingOrg.id}`, { method: 'PUT', body });
        onNotify(`Updated event ${editingOrg.ref}.`);
      } else {
        await apiRequest('/api/org-events', { method: 'POST', body });
        onNotify('Organization event published.');
      }
      setOrgModal(false);
      setEditingOrg(null);
      await loadProjects();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save event.', 'error');
    }
  }

  async function handleRegisterEvent(id: number) {
    try {
      await apiRequest(`/api/org-events/${id}/register`, { method: 'POST', body: {} });
      onNotify('Attendee registration recorded.');
      await loadProjects();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Registration failed.', 'error');
    }
  }

  function openCreateSurvey() {
    setEditingSurvey(null);
    setSrvTitle('');
    setSrvQuestion('');
    setSrvOptions('Option A, Option B, Option C');
    setSrvStatus('open');
    setSurveyModal(true);
  }

  function openEditSurvey(s: SurveyItem) {
    let parsedOpts: string[] = [];
    try {
      parsedOpts = JSON.parse(s.options_json || '[]');
    } catch {
      parsedOpts = [];
    }
    setEditingSurvey(s);
    setSrvTitle(s.title);
    setSrvQuestion(s.question);
    setSrvOptions(parsedOpts.join(', '));
    setSrvStatus(s.status);
    setSurveyModal(true);
  }

  async function handleSaveSurvey(e: FormEvent) {
    e.preventDefault();
    const opts = srvOptions
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      if (editingSurvey) {
        await apiRequest(`/api/surveys/${editingSurvey.id}`, {
          method: 'PUT',
          body: { title: srvTitle, question: srvQuestion, options: opts, status: srvStatus },
        });
        onNotify(`Updated survey ${editingSurvey.ref}.`);
      } else {
        await apiRequest('/api/surveys', {
          method: 'POST',
          body: { title: srvTitle, question: srvQuestion, options: opts },
        });
        onNotify('Survey published.');
      }
      setSurveyModal(false);
      setEditingSurvey(null);
      await loadProjects();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save survey.', 'error');
    }
  }

  async function handleVoteSurvey(id: number, option: string) {
    try {
      await apiRequest(`/api/surveys/${id}/respond`, { method: 'POST', body: { option } });
      onNotify('Response recorded.');
      await loadProjects();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Vote failed.', 'error');
    }
  }

  function promptDelete(endpoint: string, label: string, warning?: string, onAfterDelete?: () => void) {
    setDeleteError('');
    setDeleteTarget({ endpoint, label, warning, onAfterDelete });
  }

  async function executeDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setDeleteError('');
    try {
      await apiRequest(deleteTarget.endpoint, { method: 'DELETE' });
      onNotify(`${deleteTarget.label} deleted.`);
      deleteTarget.onAfterDelete?.();
      setDeleteTarget(null);
      await loadProjects();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setDeleteLoading(false);
    }
  }

  const activeProject = projects.find((p) => p.id === selectedProjectId) ?? projects[0] ?? null;
  const projectTasks = activeProject ? tasks.filter((t) => t.project_id === activeProject.id) : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-zinc-200/70 dark:bg-zinc-800 self-start">
          <button
            type="button"
            onClick={() => setTab('projects')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
              tab === 'projects'
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <FolderKanban className="w-3.5 h-3.5" />
            <span>Projects & Tasks ({projects.length})</span>
          </button>
          {showCollab && (
            <>
              <button
                type="button"
                onClick={() => setTab('agenda')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'agenda'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Shared Agenda ({agendaEvents.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('events')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'events'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <TicketCheck className="w-3.5 h-3.5" />
                <span>Events ({orgEvents.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('surveys')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'surveys'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                <span>Surveys ({surveys.length})</span>
              </button>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {tab === 'projects' && canWrite && (
            <button
              type="button"
              onClick={openCreateProject}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Project</span>
            </button>
          )}
          {tab === 'agenda' && (
            <>
              <button
                type="button"
                onClick={() => handleExportCalendar('ical')}
                className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export .ics (iCal)</span>
              </button>
              <button
                type="button"
                onClick={() => handleExportCalendar('vcal')}
                className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export .vcs (vCal)</span>
              </button>
              {canWrite && (
                <>
                  <button
                    type="button"
                    onClick={() => setIcsImportModal(true)}
                    className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Import .ics/.vcs</span>
                  </button>
                  <button
                    type="button"
                    onClick={openCreateAgenda}
                    className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Event</span>
                  </button>
                </>
              )}
            </>
          )}
          {tab === 'events' && canWrite && (
            <button
              type="button"
              onClick={openCreateOrgEvent}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Organize Event</span>
            </button>
          )}
          {tab === 'surveys' && canWrite && (
            <button
              type="button"
              onClick={openCreateSurvey}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Survey</span>
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="p-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-center text-sm text-zinc-500">
          Loading workspace...
        </div>
      ) : tab === 'projects' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-3">
            {projects.map((pr) => {
              const selected = activeProject?.id === pr.id;
              return (
                <div
                  key={pr.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedProjectId(pr.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedProjectId(pr.id);
                    }
                  }}
                  className={`w-full text-left p-4 rounded-xl border transition-colors cursor-pointer ${
                    selected
                      ? 'border-orange-600 bg-white dark:bg-zinc-900 ring-1 ring-orange-600/20'
                      : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-orange-700 dark:text-orange-400">{pr.ref}</span>
                    <StatusText status={pr.status} />
                  </div>
                  <div className="mt-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{pr.title}</div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    {pr.customer_name || 'Internal Initiative'} · Due {formatDate(pr.due_date)}
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between text-[11px] font-mono text-zinc-500 mb-1">
                      <span>Progress</span>
                      <span>{pr.progress}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                      <div style={{ width: `${pr.progress}%` }} className="h-full bg-orange-600 rounded-full" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="lg:col-span-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
            {!activeProject ? (
              <div className="py-12 text-center text-sm text-zinc-500">
                Select or create a project to manage tasks.
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-zinc-200 dark:border-zinc-800">
                  <div>
                    <div className="text-xs font-mono text-orange-700 dark:text-orange-400">
                      {activeProject.ref} · Budget {formatCurrency(activeProject.budget_amount)}
                    </div>
                    <h3 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                      {activeProject.title}
                    </h3>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {activeProject.description || 'No project brief provided.'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => openEditProject(activeProject)}
                        className="p-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:text-orange-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                        title="Edit project"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() =>
                          promptDelete(
                            `/api/projects/${activeProject.id}`,
                            `${activeProject.ref} (${activeProject.title})`,
                            'Deleting this project will remove all of its tasks and unlink associated timesheets.',
                            () => setSelectedProjectId(null)
                          )
                        }
                        className="p-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                        title="Delete project"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {canWrite && (
                      <button
                        type="button"
                        onClick={openCreateTask}
                        className="px-3.5 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Task</span>
                      </button>
                    )}
                  </div>
                </div>

                {projectTasks.length === 0 ? (
                  <div className="py-10 text-center text-xs text-zinc-500">No tasks added to this project yet.</div>
                ) : (
                  <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {projectTasks.map((t) => (
                      <div key={t.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-mono text-zinc-500">{t.ref}</span>
                            <span className="text-zinc-400">·</span>
                            <StatusText status={t.status} />
                            <span className="text-zinc-400">·</span>
                            <span className="capitalize text-zinc-500">{t.priority} priority</span>
                          </div>
                          <div className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">{t.title}</div>
                          <div className="mt-0.5 text-xs text-zinc-500">
                            {t.assignee_name} · <span className="font-mono">{t.logged_hours}h / {t.estimated_hours}h</span> logged · {t.progress}% complete
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {canLogTime && t.status !== 'done' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleLogTime(t, 2)}
                                className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 inline-flex items-center gap-1"
                              >
                                <Clock className="w-3 h-3" />
                                <span>+2h</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleLogTime(t, 0, 100)}
                                className="px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100"
                              >
                                Complete
                              </button>
                            </>
                          )}
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => openEditTask(t)}
                              className="p-1.5 rounded-md text-zinc-500 hover:text-orange-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                              title="Edit task"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => promptDelete(`/api/tasks/${t.id}`, `${t.ref} (${t.title})`)}
                              className="p-1.5 rounded-md text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                              title="Delete task"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : tab === 'agenda' ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-xs text-zinc-500">
                  <th className="py-3 px-4 font-medium">When</th>
                  <th className="py-3 px-4 font-medium">Event Title</th>
                  <th className="py-3 px-4 font-medium">Type</th>
                  <th className="py-3 px-4 font-medium">Location</th>
                  <th className="py-3 px-4 font-medium">Organizer</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {agendaEvents.map((ev) => (
                  <tr key={ev.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="py-3 px-4 font-mono text-xs text-zinc-500 whitespace-nowrap">
                      {ev.start_at.replace('T', ' ').slice(0, 16)}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-xs text-zinc-900 dark:text-zinc-100">{ev.title}</div>
                      {ev.description && <div className="text-[11px] text-zinc-500">{ev.description}</div>}
                    </td>
                    <td className="py-3 px-4 text-xs capitalize text-orange-700 dark:text-orange-400">{ev.event_type}</td>
                    <td className="py-3 px-4 text-xs text-zinc-600 dark:text-zinc-400">{ev.location || '—'}</td>
                    <td className="py-3 px-4 text-xs text-zinc-600 dark:text-zinc-400">{ev.organizer}</td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => openEditAgenda(ev)}
                            className="p-1.5 rounded-md text-zinc-500 hover:text-orange-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            title="Edit agenda event"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => promptDelete(`/api/agenda-events/${ev.id}`, ev.title)}
                            className="p-1.5 rounded-md text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                            title="Delete agenda event"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === 'events' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {orgEvents.map((ev) => (
            <div
              key={ev.id}
              className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col justify-between gap-4"
            >
              <div>
                <div className="flex items-center justify-between text-xs gap-2">
                  <span className="font-mono text-orange-700 dark:text-orange-400">{ev.ref}</span>
                  <div className="flex items-center gap-1.5">
                    <StatusText status={ev.status} />
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => openEditOrgEvent(ev)}
                        className="p-1 rounded text-zinc-500 hover:text-orange-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        title="Edit event"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => promptDelete(`/api/org-events/${ev.id}`, `${ev.ref} (${ev.title})`)}
                        className="p-1 rounded text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                        title="Delete event"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <h3 className="mt-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{ev.title}</h3>
                <div className="mt-1 text-xs text-zinc-500">
                  {formatDate(ev.event_date)} · {ev.venue || 'TBD'}
                </div>
                <div className="mt-3 font-mono text-xs text-zinc-600 dark:text-zinc-300">
                  Registered: {ev.registered_count} / {ev.capacity}
                </div>
              </div>
              {canWrite && ev.status === 'open' && (
                <button
                  type="button"
                  onClick={() => handleRegisterEvent(ev.id)}
                  className="w-full py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  +1 Register Attendee
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {surveys.map((s) => {
            const opts = JSON.parse(s.options_json || '[]') as string[];
            const votes = JSON.parse(s.votes_json || '{}') as Record<string, number>;
            const totalVotes = Object.values(votes).reduce((acc, v) => acc + v, 0);
            return (
              <div
                key={s.id}
                className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-4"
              >
                <div>
                  <div className="flex items-center justify-between text-xs gap-2">
                    <span className="font-mono text-orange-700 dark:text-orange-400">{s.ref}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-zinc-500">{totalVotes} vote(s)</span>
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => openEditSurvey(s)}
                          className="p-1 rounded text-zinc-500 hover:text-orange-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          title="Edit survey"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => promptDelete(`/api/surveys/${s.id}`, `${s.ref} (${s.title})`)}
                          className="p-1 rounded text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                          title="Delete survey"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <h3 className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{s.title}</h3>
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{s.question}</p>
                </div>
                <div className="space-y-2.5">
                  {opts.map((opt) => {
                    const count = votes[opt] ?? 0;
                    const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => handleVoteSurvey(s.id, opt)}
                        className="w-full text-left p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-orange-500 transition-colors"
                      >
                        <div className="flex items-center justify-between text-xs font-medium">
                          <span>{opt}</span>
                          <span className="font-mono text-zinc-500">
                            {count} ({pct}%)
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full rounded bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                          <div style={{ width: `${pct}%` }} className="h-full bg-orange-600" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Project Modal */}
      <Modal
        open={projModal}
        onClose={() => {
          setProjModal(false);
          setEditingProj(null);
        }}
        title={editingProj ? `Edit Project — ${editingProj.ref}` : 'New Client Project'}
      >
        <form onSubmit={handleSaveProject} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Project Title</label>
            <input
              type="text"
              required
              value={pTitle}
              onChange={(e) => setPTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Third Party (Optional)
              </label>
              <select
                value={pPartyId}
                onChange={(e) => setPPartyId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="">Internal Project</option>
                {thirdParties.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Budget (USD)</label>
              <input
                type="number"
                value={pBudget}
                onChange={(e) => setPBudget(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          {editingProj && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Due Date</label>
                <input
                  type="date"
                  value={pDue}
                  onChange={(e) => setPDue(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Status</label>
                <select
                  value={pStatus}
                  onChange={(e) => setPStatus(e.target.value as Project['status'])}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  <option value="planned">Planned</option>
                  <option value="active">Active</option>
                  <option value="on_hold">On Hold</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Description</label>
            <textarea
              rows={2}
              value={pDesc}
              onChange={(e) => setPDesc(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setProjModal(false);
                setEditingProj(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              {editingProj ? 'Save Changes' : 'Create Project'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Add / Edit Task Modal */}
      <Modal
        open={taskModal}
        onClose={() => {
          setTaskModal(false);
          setEditingTask(null);
        }}
        title={editingTask ? `Edit Task — ${editingTask.ref}` : 'Add Project Task'}
      >
        <form onSubmit={handleSaveTask} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Task Title</label>
            <input
              type="text"
              required
              value={tTitle}
              onChange={(e) => setTTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Assignee</label>
              <input
                type="text"
                value={tAssignee}
                onChange={(e) => setTAssignee(e.target.value)}
                placeholder="Team Lead"
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Priority</label>
              <select
                value={tPriority}
                onChange={(e) => setTPriority(e.target.value as typeof tPriority)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Est. Hours</label>
              <input
                type="number"
                min={1}
                value={tEstHours}
                onChange={(e) => setTEstHours(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          {editingTask && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Status</label>
                <select
                  value={tStatus}
                  onChange={(e) => setTStatus(e.target.value as ProjectTask['status'])}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  <option value="todo">To Do</option>
                  <option value="in_progress">In Progress</option>
                  <option value="done">Done</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Progress %</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={tProgress}
                  onChange={(e) => setTProgress(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Due Date</label>
                <input
                  type="date"
                  value={tDue}
                  onChange={(e) => setTDue(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setTaskModal(false);
                setEditingTask(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              {editingTask ? 'Save Changes' : 'Add Task'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Add / Edit Agenda Event Modal */}
      <Modal
        open={agendaModal}
        onClose={() => {
          setAgendaModal(false);
          setEditingAgenda(null);
        }}
        title={editingAgenda ? 'Edit Shared Agenda Event' : 'Add Shared Agenda Event'}
      >
        <form onSubmit={handleSaveAgenda} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Title</label>
            <input
              type="text"
              required
              value={agTitle}
              onChange={(e) => setAgTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Category</label>
              <select
                value={agType}
                onChange={(e) => setAgType(e.target.value as AgendaEvent['event_type'])}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="meeting">Meeting</option>
                <option value="call">Customer Call</option>
                <option value="deadline">Deadline</option>
                <option value="intervention">Intervention</option>
                <option value="holiday">Company Holiday</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Date & Time</label>
              <input
                type="datetime-local"
                required
                value={agStart}
                onChange={(e) => setAgStart(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Location / Room</label>
            <input
              type="text"
              value={agLocation}
              onChange={(e) => setAgLocation(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Description</label>
            <input
              type="text"
              value={agDesc}
              onChange={(e) => setAgDesc(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setAgendaModal(false);
                setEditingAgenda(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              {editingAgenda ? 'Save Changes' : 'Add Event'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Import ICS/VCS Modal */}
      <Modal
        open={icsImportModal}
        onClose={() => setIcsImportModal(false)}
        title="Import iCal (.ics) or vCal (.vcs)"
        subtitle="Paste calendar VCALENDAR/VEVENT payload to synchronize external calendars."
      >
        <form onSubmit={handleImportIcs} className="space-y-4">
          <textarea
            rows={7}
            required
            value={icsContent}
            onChange={(e) => setIcsContent(e.target.value)}
            placeholder={`BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Quarterly Sync\nDTSTART:20261201T100000Z\nLOCATION:Boardroom B\nEND:VEVENT\nEND:VCALENDAR`}
            className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIcsImportModal(false)}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              Import Events
            </button>
          </div>
        </form>
      </Modal>

      {/* Org Event Modal */}
      <Modal
        open={orgModal}
        onClose={() => {
          setOrgModal(false);
          setEditingOrg(null);
        }}
        title={editingOrg ? `Edit Event — ${editingOrg.ref}` : 'Publish Organization Event'}
      >
        <form onSubmit={handleSaveOrgEvent} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Event Name</label>
            <input
              type="text"
              required
              value={evTitle}
              onChange={(e) => setEvTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className={`grid gap-3 ${editingOrg ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Date</label>
              <input
                type="date"
                value={evDate}
                onChange={(e) => setEvDate(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Venue</label>
              <input
                type="text"
                value={evVenue}
                onChange={(e) => setEvVenue(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Capacity</label>
              <input
                type="number"
                min={1}
                value={evCapacity}
                onChange={(e) => setEvCapacity(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            {editingOrg && (
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Status</label>
                <select
                  value={evStatus}
                  onChange={(e) => setEvStatus(e.target.value as OrgEvent['status'])}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  <option value="planned">Planned</option>
                  <option value="open">Open</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOrgModal(false);
                setEditingOrg(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              {editingOrg ? 'Save Changes' : 'Publish Event'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Survey Modal */}
      <Modal
        open={surveyModal}
        onClose={() => {
          setSurveyModal(false);
          setEditingSurvey(null);
        }}
        title={editingSurvey ? `Edit Survey — ${editingSurvey.ref}` : 'Create Poll / Survey'}
      >
        <form onSubmit={handleSaveSurvey} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Survey Title</label>
            <input
              type="text"
              required
              value={srvTitle}
              onChange={(e) => setSrvTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Question</label>
            <input
              type="text"
              required
              value={srvQuestion}
              onChange={(e) => setSrvQuestion(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className={`grid gap-3 ${editingSurvey ? 'grid-cols-3' : 'grid-cols-1'}`}>
            <div className={editingSurvey ? 'col-span-2' : ''}>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Options (comma-separated)
              </label>
              <input
                type="text"
                required
                value={srvOptions}
                onChange={(e) => setSrvOptions(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            {editingSurvey && (
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Status</label>
                <select
                  value={srvStatus}
                  onChange={(e) => setSrvStatus(e.target.value as SurveyItem['status'])}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setSurveyModal(false);
                setEditingSurvey(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              {editingSurvey ? 'Save Changes' : 'Publish Survey'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title="Delete Collaboration Record"
        itemLabel={deleteTarget?.label ?? ''}
        warning={deleteTarget?.warning}
        loading={deleteLoading}
        error={deleteError}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError('');
        }}
        onConfirm={executeDelete}
      />
    </div>
  );
}

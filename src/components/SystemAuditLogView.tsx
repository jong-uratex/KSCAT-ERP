import { useEffect, useState } from 'react';
import { ArrowDownUp, Download, RefreshCw, Search } from 'lucide-react';
import { apiRequest, can } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { AuditLogEntry, PermissionMap } from '../types/erp';
import { Modal } from './Modal';
import { StatusText } from './StatusText';

interface AuditSummary {
  total: number;
  auth_count: number;
  permission_count: number;
  deletion_count: number;
  alert_count: number;
}

interface SystemAuditLogViewProps {
  permissions: PermissionMap;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

type AuditCategory = 'all' | 'authentication' | 'permissions' | 'deletions' | 'operations';
type AuditSeverity = 'all' | 'info' | 'warning' | 'critical';

const AUTH_ACTIONS = new Set([
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGIN_MFA_SUCCESS',
  'MFA_FAILED',
  'MFA_RECOVERY_USED',
  'MFA_RECOVERY_FAILED',
  'MFA_ENROLLED',
  'MFA_DISABLED',
  'ACCOUNT_LOCKED',
  'LOGOUT',
  'SESSION_REVOKED',
]);

const PERMISSION_ACTIONS = new Set([
  'CREATE_ROLE',
  'UPDATE_ROLE_PERMISSIONS',
  'DELETE_ROLE',
  'UPDATE_SECURITY_POLICY',
  'PERMISSION_DENIED',
  'CREATE_USER',
  'UPDATE_USER',
  'ADMIN_UNLOCK_USER',
  'ADMIN_RESET_MFA',
  'WORKSPACE_BOOTSTRAP',
]);

function classifyEvent(action: string): string {
  if (action.startsWith('DELETE_')) return 'Deletion';
  if (AUTH_ACTIONS.has(action)) return 'Authentication';
  if (PERMISSION_ACTIONS.has(action)) return 'Permissions & Access';
  return 'ERP Operation';
}

export function SystemAuditLogView({ permissions, onNotify }: SystemAuditLogViewProps) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [summary, setSummary] = useState<AuditSummary>({
    total: 0,
    auth_count: 0,
    permission_count: 0,
    deletion_count: 0,
    alert_count: 0,
  });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const [category, setCategory] = useState<AuditCategory>('all');
  const [severity, setSeverity] = useState<AuditSeverity>('all');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [search, setSearch] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<AuditLogEntry | null>(null);

  const canExport = can(permissions, 'audit', 'export');

  async function loadLogs() {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        category,
        severity,
        sort: sortOrder,
        search: search.trim(),
        limit: '250',
      });
      const res = await apiRequest<{ logs: AuditLogEntry[]; summary: AuditSummary }>(
        `/api/admin/audit-logs?${qs.toString()}`
      );
      setLogs(res.logs);
      if (res.summary) setSummary(res.summary);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to load system audit log.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadLogs();
    }, 150);
    return () => window.clearTimeout(timer);
  }, [category, severity, sortOrder, search]);

  async function handleExportCsv() {
    setExporting(true);
    try {
      const qs = new URLSearchParams({
        category,
        severity,
        sort: sortOrder,
        search: search.trim(),
      });
      const res = await apiRequest<{ csv: string; count: number }>(
        `/api/admin/audit-logs/export?${qs.toString()}`
      );
      const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kscat-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onNotify(`Exported ${res.count} audit record(s) to CSV.`);
      await loadLogs();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Audit log export failed.', 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* 4-Column Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Total Audit Events
          </div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {summary.total}
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Immutable server event log
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Logins & MFA Activity
          </div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {summary.auth_count}
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Sign-ins, lockouts, sessions
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Permissions & Role Changes
          </div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {summary.permission_count}
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            RBAC matrix, users, policies
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Deletions & Warnings
          </div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {summary.deletion_count} · {summary.alert_count}
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Deletions · Warning/Critical alerts
          </div>
        </div>
      </div>

      {/* Filter & Controls Toolbar */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="inline-flex flex-wrap items-center p-1 rounded-lg bg-zinc-100 dark:bg-zinc-800/80 self-start">
          {(
            [
              { key: 'all', label: 'All Events' },
              { key: 'authentication', label: 'Authentication' },
              { key: 'permissions', label: 'Permissions & Users' },
              { key: 'deletions', label: 'Deletions' },
              { key: 'operations', label: 'ERP Operations' },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setCategory(item.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                category === item.key
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 sm:w-60">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search actor, action, ref, IP..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-600"
            />
          </div>

          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as AuditSeverity)}
            aria-label="Filter by severity"
            className="px-2.5 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200"
          >
            <option value="all">All Severities</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>

          <button
            type="button"
            onClick={() => setSortOrder((s) => (s === 'desc' ? 'asc' : 'desc'))}
            className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <ArrowDownUp className="w-3.5 h-3.5" />
            <span>{sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}</span>
          </button>

          <button
            type="button"
            onClick={loadLogs}
            className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            aria-label="Refresh audit log"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          {canExport && (
            <button
              type="button"
              disabled={exporting || logs.length === 0}
              onClick={handleExportCsv}
              className="px-3 py-1.5 rounded-lg bg-orange-700 hover:bg-orange-800 disabled:opacity-50 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{exporting ? 'Exporting...' : 'Export CSV'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Chronological Audit Table */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        {loading ? (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 px-4 flex items-center gap-4 animate-pulse">
                <div className="h-3 w-28 bg-zinc-200 dark:bg-zinc-800 rounded" />
                <div className="h-3 w-36 bg-zinc-200 dark:bg-zinc-800 rounded" />
                <div className="h-3 flex-1 bg-zinc-100 dark:bg-zinc-800/70 rounded" />
              </div>
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              No audit log entries match the current filters
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Try clearing your search query or switching category and severity filters.
            </p>
            <button
              type="button"
              onClick={() => {
                setCategory('all');
                setSeverity('all');
                setSearch('');
              }}
              className="mt-4 px-3.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500 dark:text-zinc-400">
                  <th className="py-2.5 px-4 font-medium">Timestamp</th>
                  <th className="py-2.5 px-4 font-medium">Category</th>
                  <th className="py-2.5 px-4 font-medium">Actor · Source IP</th>
                  <th className="py-2.5 px-4 font-medium">Action · Module</th>
                  <th className="py-2.5 px-4 font-medium">Details</th>
                  <th className="py-2.5 px-4 font-medium text-right">Severity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {logs.map((log) => (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedEvent(log)}
                    className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
                  >
                    <td className="py-2.5 px-4 font-mono text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                      {formatDateTime(log.created_at)}
                    </td>
                    <td className="py-2.5 px-4 text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                      {classifyEvent(log.action)}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">
                        {log.user_email}
                      </div>
                      <div className="text-[11px] font-mono text-zinc-400">
                        {log.ip_address || 'internal'}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <div className="font-mono font-medium text-zinc-800 dark:text-zinc-200">
                        {log.action}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {log.module}
                        {log.entity_ref ? ` · ${log.entity_ref}` : ''}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-zinc-600 dark:text-zinc-400 max-w-md truncate">
                      {log.details || '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <StatusText status={log.severity} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Audit Event Inspection Modal */}
      <Modal
        open={Boolean(selectedEvent)}
        onClose={() => setSelectedEvent(null)}
        title={selectedEvent ? `Audit Event #${selectedEvent.id} — ${selectedEvent.action}` : ''}
        subtitle={selectedEvent ? `${classifyEvent(selectedEvent.action)} · ${formatDateTime(selectedEvent.created_at)}` : ''}
      >
        {selectedEvent && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-4 pb-4 border-b border-zinc-200 dark:border-zinc-800">
              <div>
                <div className="text-zinc-500">Actor Email</div>
                <div className="mt-0.5 font-medium text-zinc-900 dark:text-zinc-100">
                  {selectedEvent.user_email}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Source IP Address</div>
                <div className="mt-0.5 font-mono text-zinc-900 dark:text-zinc-100">
                  {selectedEvent.ip_address || 'internal'}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Module · Entity Ref</div>
                <div className="mt-0.5 font-mono text-zinc-900 dark:text-zinc-100">
                  {selectedEvent.module}
                  {selectedEvent.entity_ref ? ` · ${selectedEvent.entity_ref}` : ''}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Severity</div>
                <div className="mt-0.5">
                  <StatusText status={selectedEvent.severity} />
                </div>
              </div>
            </div>
            <div>
              <div className="text-zinc-500 mb-1">Recorded Event Details</div>
              <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 leading-relaxed">
                {selectedEvent.details || 'No additional event metadata.'}
              </div>
            </div>
            <div className="text-[11px] font-mono text-zinc-400">
              UTC Timestamp: {selectedEvent.created_at}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

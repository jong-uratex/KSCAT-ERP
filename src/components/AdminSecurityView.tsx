import { useEffect, useState, type FormEvent } from 'react';
import {
  Boxes,
  Lock,
  Pencil,
  Plug,
  Plus,
  ScrollText,
  Shield,
  Sliders,
  Trash2,
  Unlock,
  UserPlus,
  Users,
} from 'lucide-react';
import { apiRequest, can } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type {
  OptionalModuleConfig,
  PermissionAction,
  PermissionCatalogItem,
  PermissionMap,
  PermissionModule,
  RoleDefinition,
  SecurityPolicy,
  SystemSettings,
  UserProfile,
} from '../types/erp';
import { ConfirmDeleteModal, Modal } from './Modal';
import { StatusText } from './StatusText';
import { SystemAuditLogView } from './SystemAuditLogView';

interface AdminSecurityViewProps {
  currentUser: UserProfile;
  permissions: PermissionMap;
  onUserUpdated: () => Promise<void>;
  onModulesChanged: () => Promise<void>;
  onSettingsChanged: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export function AdminSecurityView({
  currentUser,
  permissions,
  onUserUpdated,
  onModulesChanged,
  onSettingsChanged,
  onNotify,
}: AdminSecurityViewProps) {
  const canAdminRead = can(permissions, 'admin', 'read');
  const canAdminWrite = can(permissions, 'admin', 'write');
  const canManageRoles = can(permissions, 'admin', 'manage_roles');
  const canUnlock = can(permissions, 'admin', 'unlock_users');
  const canAuditRead = can(permissions, 'audit', 'read');

  const [tab, setTab] = useState<
    'users' | 'system' | 'roles' | 'policy' | 'modules' | 'integrations' | 'audit'
  >('users');

  // Admin state
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [catalog, setCatalog] = useState<PermissionCatalogItem[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [policy, setPolicy] = useState<SecurityPolicy | null>(null);
  const [sysSettings, setSysSettings] = useState<SystemSettings | null>(null);
  const [modules, setModules] = useState<OptionalModuleConfig[]>([]);
  const [ldapCfg, setLdapCfg] = useState({
    enabled: false,
    host: 'ldap.internal.corp',
    port: 636,
    baseDn: 'dc=kscat,dc=corp',
    bindDn: 'cn=readonly,dc=kscat,dc=corp',
    bindPassword: '',
    hasBindSecret: false,
  });
  const [dialCfg, setDialCfg] = useState({ enabled: true, scheme: 'tel:', prefix: '' });
  const [payCfg, setPayCfg] = useState({
    stripeEnabled: true,
    stripeMode: 'sandbox',
    paypalEnabled: true,
    payboxEnabled: false,
  });
  const [socialCfg, setSocialCfg] = useState({
    linkedin: 'https://www.linkedin.com',
    x: 'https://x.com',
    github: 'https://github.com/Dolibarr/dolibarr',
  });
  const [collectorCfg, setCollectorCfg] = useState({
    enabled: true,
    imapHost: 'imap.kscat-erp.example',
    mailbox: 'INBOX/Support',
    autoCreateTicket: false,
  });

  // Delete Confirmation
  const [deleteTarget, setDeleteTarget] = useState<{
    url: string;
    label: string;
    warning?: string;
    afterDelete?: () => void;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Create / Edit User Modal
  const [userModal, setUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [uFullName, setUFullName] = useState('');
  const [uUsername, setUUsername] = useState('');
  const [uEmail, setUEmail] = useState('');
  const [uPassword, setUPassword] = useState('');
  const [uRoleId, setURoleId] = useState('');
  const [uIsActive, setUIsActive] = useState(true);

  // Create / Edit Role Modal
  const [roleModal, setRoleModal] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleDefinition | null>(null);
  const [rName, setRName] = useState('');
  const [rDesc, setRDesc] = useState('');
  const [rMfa, setRMfa] = useState(false);

  async function loadAll() {
    try {
      if (canAdminRead) {
        const [uRes, rRes, cRes, pRes, sRes, modRes, intRes] = await Promise.all([
          apiRequest<{ users: UserProfile[] }>('/api/admin/users'),
          apiRequest<{ roles: RoleDefinition[] }>('/api/admin/roles'),
          apiRequest<{ catalog: PermissionCatalogItem[] }>('/api/admin/permission-catalog'),
          apiRequest<{ policy: SecurityPolicy }>('/api/admin/policy'),
          apiRequest<{ settings: SystemSettings }>('/api/admin/settings'),
          apiRequest<{ modules: OptionalModuleConfig[] }>('/api/modules'),
          apiRequest<{ integrations: Record<string, Record<string, unknown>> }>('/api/integrations'),
        ]);
        setUsers(uRes.users);
        setRoles(rRes.roles);
        setCatalog(cRes.catalog);
        setPolicy(pRes.policy);
        setSysSettings(sRes.settings);
        setModules(modRes.modules);
        if (intRes.integrations.ldap) {
          setLdapCfg((prev) => ({
            ...prev,
            ...(intRes.integrations.ldap as Partial<typeof prev>),
            bindPassword: '',
          }));
        }
        if (intRes.integrations.click_to_dial) {
          setDialCfg((prev) => ({ ...prev, ...(intRes.integrations.click_to_dial as Partial<typeof prev>) }));
        }
        if (intRes.integrations.payment_gateways) {
          setPayCfg((prev) => ({ ...prev, ...(intRes.integrations.payment_gateways as Partial<typeof prev>) }));
        }
        if (intRes.integrations.social) {
          setSocialCfg((prev) => ({ ...prev, ...(intRes.integrations.social as Partial<typeof prev>) }));
        }
        if (intRes.integrations.email_collector) {
          setCollectorCfg((prev) => ({
            ...prev,
            ...(intRes.integrations.email_collector as Partial<typeof prev>),
          }));
        }
        if (rRes.roles[0] && !selectedRoleId) setSelectedRoleId(rRes.roles[0].id);
        if (rRes.roles[1] && !uRoleId) setURoleId(String(rRes.roles[1].id));
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to load settings data.', 'error');
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  function promptDelete(url: string, label: string, warning?: string, afterDelete?: () => void) {
    setDeleteError('');
    setDeleteTarget({ url, label, warning, afterDelete });
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await apiRequest(deleteTarget.url, { method: 'DELETE' });
      const label = deleteTarget.label;
      const afterDelete = deleteTarget.afterDelete;
      setDeleteTarget(null);
      if (afterDelete) afterDelete();
      onNotify(`Deleted ${label}.`);
      await loadAll();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unable to delete record.');
    } finally {
      setDeleting(false);
    }
  }

  function openCreateUser() {
    setEditingUser(null);
    setUFullName('');
    setUUsername('');
    setUEmail('');
    setUPassword('');
    setURoleId(roles[1] ? String(roles[1].id) : roles[0] ? String(roles[0].id) : '');
    setUIsActive(true);
    setUserModal(true);
  }

  function openEditUser(u: UserProfile) {
    setEditingUser(u);
    setUFullName(u.fullName);
    setUUsername(u.username);
    setUEmail(u.email);
    setUPassword('');
    setURoleId(String(u.roleId));
    setUIsActive(u.isActive);
    setUserModal(true);
  }

  async function handleSaveUser(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingUser) {
        const isSelf = editingUser.id === currentUser.id;
        await apiRequest(`/api/admin/users/${editingUser.id}`, {
          method: 'PUT',
          body: {
            fullName: uFullName,
            username: uUsername,
            email: uEmail,
            ...(isSelf ? {} : { roleId: Number(uRoleId), isActive: uIsActive }),
            ...(uPassword ? { newPassword: uPassword } : {}),
          },
        });
        onNotify(`User ${uUsername} updated.`);
        if (isSelf) await onUserUpdated();
      } else {
        await apiRequest('/api/admin/users', {
          method: 'POST',
          body: {
            fullName: uFullName,
            username: uUsername,
            email: uEmail,
            password: uPassword,
            roleId: Number(uRoleId),
          },
        });
        onNotify('Team user created with assigned RBAC role.');
      }
      setUserModal(false);
      setEditingUser(null);
      setUPassword('');
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save user.', 'error');
    }
  }

  async function handleUpdateUser(
    userId: number,
    patch: { roleId?: number; isActive?: boolean; unlockAccount?: boolean; resetMfa?: boolean }
  ) {
    try {
      await apiRequest(`/api/admin/users/${userId}`, { method: 'PUT', body: patch });
      onNotify('User account updated.');
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Update failed.', 'error');
    }
  }

  function openCreateRole() {
    setEditingRole(null);
    setRName('');
    setRDesc('');
    setRMfa(false);
    setRoleModal(true);
  }

  function openEditRole(r: RoleDefinition) {
    setEditingRole(r);
    setRName(r.name);
    setRDesc(r.description ?? '');
    setRMfa(r.requireMfa);
    setRoleModal(true);
  }

  async function handleSaveRole(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingRole) {
        await apiRequest(`/api/admin/roles/${editingRole.id}`, {
          method: 'PUT',
          body: { name: rName, description: rDesc, requireMfa: rMfa },
        });
        onNotify(`Role "${rName}" updated.`);
        if (editingRole.id === currentUser.roleId) await onUserUpdated();
      } else {
        const created = await apiRequest<{ id: number }>('/api/admin/roles', {
          method: 'POST',
          body: {
            name: rName,
            description: rDesc,
            requireMfa: rMfa,
            permissions: { dashboard: ['read'] },
          },
        });
        setSelectedRoleId(created.id);
        onNotify('Custom RBAC role created.');
      }
      setRoleModal(false);
      setEditingRole(null);
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save role.', 'error');
    }
  }

  async function handleTogglePermission(
    role: RoleDefinition,
    mod: PermissionModule,
    action: PermissionAction
  ) {
    if (!canManageRoles) return;
    const currentActions = role.permissions[mod] ?? [];
    const nextActions = currentActions.includes(action)
      ? currentActions.filter((a) => a !== action)
      : [...currentActions, action];

    const nextPerms: PermissionMap = {
      ...role.permissions,
      [mod]: nextActions,
    };

    try {
      await apiRequest(`/api/admin/roles/${role.id}`, {
        method: 'PUT',
        body: { permissions: nextPerms },
      });
      setRoles((prev) =>
        prev.map((r) => (r.id === role.id ? { ...r, permissions: nextPerms } : r))
      );
      if (role.id === currentUser.roleId) {
        await onUserUpdated();
      }
      onNotify(`Updated ${role.name} (${mod}.${action}).`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Permission update failed.', 'error');
    }
  }

  async function handleToggleRoleMfa(role: RoleDefinition) {
    if (!canManageRoles) return;
    try {
      await apiRequest(`/api/admin/roles/${role.id}`, {
        method: 'PUT',
        body: { requireMfa: !role.requireMfa },
      });
      onNotify(`Updated MFA requirement for ${role.name}.`);
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Update failed.', 'error');
    }
  }

  async function handleSavePolicy(e: FormEvent) {
    e.preventDefault();
    if (!policy) return;
    try {
      await apiRequest('/api/admin/policy', {
        method: 'PUT',
        body: {
          maxFailedAttempts: policy.max_failed_attempts,
          lockoutMinutes: policy.lockout_minutes,
          sessionTtlHours: policy.session_ttl_hours,
          enforceMfaGlobal: Boolean(policy.enforce_mfa_global),
          minPasswordLength: policy.min_password_length,
        },
      });
      onNotify('Organization security policy updated.');
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save policy.', 'error');
    }
  }

  async function handleSaveSystemSettings(e: FormEvent) {
    e.preventDefault();
    if (!sysSettings) return;
    try {
      await apiRequest('/api/admin/settings', {
        method: 'PUT',
        body: {
          appName: sysSettings.app_name,
          companyName: sysSettings.company_name,
          companyEmail: sysSettings.company_email,
          companyPhone: sysSettings.company_phone,
          companyAddress: sysSettings.company_address,
          taxId: sysSettings.tax_id,
          defaultCurrency: sysSettings.default_currency,
          defaultTaxRate: sysSettings.default_tax_rate,
          defaultPaymentTerms: sysSettings.default_payment_terms,
          defaultIncoterm: sysSettings.default_incoterm,
          fiscalYearStart: sysSettings.fiscal_year_start,
          dateFormat: sysSettings.date_format,
        },
      });
      onNotify('System settings saved.');
      await onSettingsChanged();
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save system settings.', 'error');
    }
  }

  async function handleToggleModule(mod: OptionalModuleConfig) {
    try {
      await apiRequest(`/api/modules/${mod.module_key}`, {
        method: 'PUT',
        body: { enabled: mod.enabled === 0 },
      });
      onNotify(`${mod.name} ${mod.enabled === 0 ? 'enabled' : 'disabled'}.`);
      await onModulesChanged();
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Module toggle failed.', 'error');
    }
  }

  async function handleSaveIntegration(key: string, payload: Record<string, unknown>, label: string) {
    try {
      await apiRequest(`/api/integrations/${key}`, { method: 'PUT', body: payload });
      onNotify(`${label} settings saved.`);
      await loadAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save integration.', 'error');
    }
  }

  const selectedRole = roles.find((r) => r.id === selectedRoleId) ?? roles[0] ?? null;

  return (
    <div className="space-y-5">
      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex flex-wrap items-center p-1 rounded-lg bg-zinc-200/70 dark:bg-zinc-800">
          {canAdminRead && (
            <>
              <button
                type="button"
                onClick={() => setTab('users')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'users'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Users & Roles ({users.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('system')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'system'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>System Settings</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('roles')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'roles'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                <span>RBAC Matrix</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('policy')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'policy'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Security Policy</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('modules')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'modules'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <Boxes className="w-3.5 h-3.5" />
                <span>ERP Modules ({modules.filter((m) => m.enabled === 1).length}/{modules.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('integrations')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'integrations'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <Plug className="w-3.5 h-3.5" />
                <span>Integrations</span>
              </button>
            </>
          )}
          {canAuditRead && (
            <button
              type="button"
              onClick={() => setTab('audit')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                tab === 'audit'
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              <ScrollText className="w-3.5 h-3.5" />
              <span>System Audit Log</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {tab === 'users' && canAdminWrite && (
            <button
              type="button"
              onClick={openCreateUser}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Add New User</span>
            </button>
          )}
          {tab === 'roles' && canManageRoles && (
            <button
              type="button"
              onClick={openCreateRole}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Custom Role</span>
            </button>
          )}
        </div>
      </div>

      {/* USERS TAB */}
      {tab === 'users' && canAdminRead && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-xs text-zinc-500">
                  <th className="py-3 px-4 font-medium">User</th>
                  <th className="py-3 px-4 font-medium">Assigned Role</th>
                  <th className="py-3 px-4 font-medium">MFA Status</th>
                  <th className="py-3 px-4 font-medium">Account State</th>
                  <th className="py-3 px-4 font-medium">Last Login</th>
                  <th className="py-3 px-4 font-medium text-right">Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {users.map((u) => {
                  const isLocked = Boolean(u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now());
                  return (
                    <tr key={u.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <td className="py-3 px-4">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">
                          {u.fullName}
                          {u.id === currentUser.id && (
                            <span className="ml-1.5 text-[11px] font-normal text-orange-700 dark:text-orange-400">
                              · You
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-zinc-500 font-mono">
                          {u.username} · {u.email}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {canAdminWrite ? (
                          <select
                            value={u.roleId}
                            disabled={u.id === currentUser.id}
                            onChange={(e) => handleUpdateUser(u.id, { roleId: Number(e.target.value) })}
                            className="px-2.5 py-1 text-xs rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                          >
                            {roles.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs text-zinc-700 dark:text-zinc-300">{u.roleName}</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <StatusText status={u.mfaEnabled ? 'mfa_on' : 'mfa_off'} />
                      </td>
                      <td className="py-3 px-4">
                        <StatusText
                          status={isLocked ? 'locked' : u.isActive ? 'active' : 'inactive'}
                        />
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-zinc-500">
                        {formatDateTime(u.lastLoginAt)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2.5">
                          {canUnlock && isLocked && (
                            <button
                              type="button"
                              onClick={() => handleUpdateUser(u.id, { unlockAccount: true })}
                              className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline"
                            >
                              <Unlock className="w-3.5 h-3.5" />
                              <span>Unlock</span>
                            </button>
                          )}
                          {canUnlock && u.mfaEnabled && u.id !== currentUser.id && (
                            <button
                              type="button"
                              onClick={() => handleUpdateUser(u.id, { resetMfa: true })}
                              className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline"
                            >
                              Reset MFA
                            </button>
                          )}
                          {canAdminWrite && u.id !== currentUser.id && (
                            <button
                              type="button"
                              onClick={() => handleUpdateUser(u.id, { isActive: !u.isActive })}
                              className="text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:underline"
                            >
                              {u.isActive ? 'Deactivate' : 'Reactivate'}
                            </button>
                          )}
                          {canAdminWrite && (
                            <button
                              type="button"
                              onClick={() => openEditUser(u)}
                              title={`Edit ${u.fullName}`}
                              className="p-1 text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canAdminWrite && u.id !== currentUser.id && (
                            <button
                              type="button"
                              onClick={() =>
                                promptDelete(
                                  `/api/admin/users/${u.id}`,
                                  `${u.fullName} (${u.username})`,
                                  'Deleting this user permanently revokes their sessions and access.'
                                )
                              }
                              title={`Delete ${u.fullName}`}
                              className="p-1 text-zinc-400 hover:text-red-600"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ROLES & RBAC MATRIX TAB */}
      {tab === 'roles' && canAdminRead && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="space-y-2.5">
            {roles.map((r) => {
              const selected = selectedRole?.id === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedRoleId(r.id)}
                  className={`w-full text-left p-4 rounded-xl border transition-colors ${
                    selected
                      ? 'border-orange-600 bg-white dark:bg-zinc-900 ring-1 ring-orange-600/20'
                      : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100">{r.name}</span>
                    <span className="font-mono text-zinc-500">{r.userCount} user(s)</span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
                    {r.description}
                  </p>
                  <div className="mt-2 text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                    {r.requireMfa ? 'MFA Enforced' : 'MFA Optional'}
                    {r.isSystem ? ' · System Role' : ''}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="lg:col-span-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
            {selectedRole && (
              <div className="space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-200 dark:border-zinc-800">
                  <div>
                    <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                      {selectedRole.name} — Module Permissions
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {selectedRole.description}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 shrink-0">
                    <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer">
                      <input
                        type="checkbox"
                        disabled={!canManageRoles}
                        checked={selectedRole.requireMfa}
                        onChange={() => handleToggleRoleMfa(selectedRole)}
                        className="rounded border-zinc-300 text-orange-600"
                      />
                      <span>Require TOTP MFA</span>
                    </label>
                    {canManageRoles && (
                      <>
                        <button
                          type="button"
                          onClick={() => openEditRole(selectedRole)}
                          title={`Edit role ${selectedRole.name}`}
                          className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 hover:text-orange-700 dark:text-zinc-300 dark:hover:text-orange-400"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {!selectedRole.isSystem && (
                          <button
                            type="button"
                            onClick={() =>
                              promptDelete(
                                `/api/admin/roles/${selectedRole.id}`,
                                `role "${selectedRole.name}"`,
                                'All users assigned to this role must be reassigned before deletion.',
                                () => setSelectedRoleId(null)
                              )
                            }
                            title={`Delete role ${selectedRole.name}`}
                            className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {catalog.map((mod) => {
                    const granted = selectedRole.permissions[mod.module] ?? [];
                    return (
                      <div
                        key={mod.module}
                        className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div>
                          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            {mod.label}
                          </div>
                          <div className="text-xs text-zinc-500 dark:text-zinc-400">
                            {mod.description}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          {mod.actions.map((act) => {
                            const checked = granted.includes(act.key);
                            return (
                              <label
                                key={act.key}
                                className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border cursor-pointer transition-colors ${
                                  checked
                                    ? 'border-orange-200 dark:border-orange-900 bg-orange-50/70 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300 font-medium'
                                    : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  disabled={!canManageRoles}
                                  checked={checked}
                                  onChange={() =>
                                    handleTogglePermission(selectedRole, mod.module, act.key)
                                  }
                                  className="rounded border-zinc-300 text-orange-600"
                                />
                                <span>{act.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECURITY POLICY TAB */}
      {tab === 'policy' && canAdminRead && policy && (
        <form
          onSubmit={handleSavePolicy}
          className="max-w-2xl rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-5"
        >
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Organization Authentication & Lockout Policy
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Configure brute-force protection, session lifetime, password minimums, and global MFA enforcement.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Max Failed Logins Before Lockout
              </label>
              <input
                type="number"
                min={2}
                max={20}
                disabled={!canManageRoles}
                value={policy.max_failed_attempts}
                onChange={(e) =>
                  setPolicy({ ...policy, max_failed_attempts: Number(e.target.value) })
                }
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Lockout Duration (Minutes)
              </label>
              <input
                type="number"
                min={1}
                max={1440}
                disabled={!canManageRoles}
                value={policy.lockout_minutes}
                onChange={(e) => setPolicy({ ...policy, lockout_minutes: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Session Token TTL (Hours)
              </label>
              <input
                type="number"
                min={1}
                max={168}
                disabled={!canManageRoles}
                value={policy.session_ttl_hours}
                onChange={(e) =>
                  setPolicy({ ...policy, session_ttl_hours: Number(e.target.value) })
                }
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Minimum Password Length
              </label>
              <input
                type="number"
                min={8}
                max={32}
                disabled={!canManageRoles}
                value={policy.min_password_length}
                onChange={(e) =>
                  setPolicy({ ...policy, min_password_length: Number(e.target.value) })
                }
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>

          <label className="flex items-start gap-2.5 text-xs text-zinc-700 dark:text-zinc-300 pt-2 border-t border-zinc-200 dark:border-zinc-800 cursor-pointer">
            <input
              type="checkbox"
              disabled={!canManageRoles}
              checked={Boolean(policy.enforce_mfa_global)}
              onChange={(e) =>
                setPolicy({ ...policy, enforce_mfa_global: e.target.checked ? 1 : 0 })
              }
              className="mt-0.5 rounded border-zinc-300 text-orange-600"
            />
            <span>
              Enforce TOTP Multi-Factor Authentication globally for all users across every role on next sign-in
            </span>
          </label>

          {canManageRoles && (
            <div className="flex justify-end">
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
              >
                Save Security Policy
              </button>
            </div>
          )}
        </form>
      )}

      {/* SYSTEM SETTINGS TAB */}
      {tab === 'system' && canAdminRead && sysSettings && (
        <form
          onSubmit={handleSaveSystemSettings}
          className="max-w-3xl rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-6"
        >
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Organization & System Configuration
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Manage global company identity, currency formatting, default tax rates, payment terms, and regional ERP defaults.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Application Name
              </label>
              <input
                type="text"
                required
                disabled={!canAdminWrite}
                value={sysSettings.app_name}
                onChange={(e) => setSysSettings({ ...sysSettings, app_name: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Legal Company Name
              </label>
              <input
                type="text"
                required
                disabled={!canAdminWrite}
                value={sysSettings.company_name}
                onChange={(e) => setSysSettings({ ...sysSettings, company_name: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Company Email
              </label>
              <input
                type="email"
                disabled={!canAdminWrite}
                value={sysSettings.company_email}
                onChange={(e) => setSysSettings({ ...sysSettings, company_email: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Company Phone
              </label>
              <input
                type="text"
                disabled={!canAdminWrite}
                value={sysSettings.company_phone}
                onChange={(e) => setSysSettings({ ...sysSettings, company_phone: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Tax ID / VAT Registration
              </label>
              <input
                type="text"
                disabled={!canAdminWrite}
                value={sysSettings.tax_id}
                onChange={(e) => setSysSettings({ ...sysSettings, tax_id: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Headquarters Address
              </label>
              <input
                type="text"
                disabled={!canAdminWrite}
                value={sysSettings.company_address}
                onChange={(e) => setSysSettings({ ...sysSettings, company_address: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Default Currency
              </label>
              <select
                disabled={!canAdminWrite}
                value={sysSettings.default_currency}
                onChange={(e) => setSysSettings({ ...sysSettings, default_currency: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="USD">USD ($)</option>
                <option value="PHP">PHP (₱)</option>
                <option value="EUR">EUR (€)</option>
                <option value="SGD">SGD (S$)</option>
                <option value="JPY">JPY (¥)</option>
                <option value="GBP">GBP (£)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Default Tax / VAT Rate (%)
              </label>
              <input
                type="number"
                step="0.5"
                min={0}
                max={50}
                disabled={!canAdminWrite}
                value={sysSettings.default_tax_rate}
                onChange={(e) => setSysSettings({ ...sysSettings, default_tax_rate: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Default Payment Terms
              </label>
              <select
                disabled={!canAdminWrite}
                value={sysSettings.default_payment_terms}
                onChange={(e) => setSysSettings({ ...sysSettings, default_payment_terms: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="Due on Receipt">Due on Receipt</option>
                <option value="Net 15">Net 15</option>
                <option value="Net 30">Net 30</option>
                <option value="Net 45">Net 45</option>
                <option value="Net 60">Net 60</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Default Incoterm
              </label>
              <select
                disabled={!canAdminWrite}
                value={sysSettings.default_incoterm}
                onChange={(e) => setSysSettings({ ...sysSettings, default_incoterm: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="EXW">EXW — Ex Works</option>
                <option value="FOB">FOB — Free On Board</option>
                <option value="CIF">CIF — Cost Insurance Freight</option>
                <option value="DDP">DDP — Delivered Duty Paid</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Fiscal Year Start Month
              </label>
              <select
                disabled={!canAdminWrite}
                value={sysSettings.fiscal_year_start}
                onChange={(e) => setSysSettings({ ...sysSettings, fiscal_year_start: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value={1}>January (Month 1)</option>
                <option value={4}>April (Month 4)</option>
                <option value={7}>July (Month 7)</option>
                <option value={10}>October (Month 10)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Display Date Format
              </label>
              <select
                disabled={!canAdminWrite}
                value={sysSettings.date_format}
                onChange={(e) => setSysSettings({ ...sysSettings, date_format: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="MMM d, yyyy">MMM d, yyyy</option>
                <option value="yyyy-MM-dd">yyyy-MM-dd (ISO)</option>
                <option value="dd/MM/yyyy">dd/MM/yyyy</option>
              </select>
            </div>
          </div>

          {canAdminWrite && (
            <div className="flex justify-end">
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
              >
                Save System Settings
              </button>
            </div>
          )}
        </form>
      )}

      {/* OPTIONAL ERP MODULES MANAGER TAB */}
      {tab === 'modules' && canAdminRead && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Optional Application Modules
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Enable or disable Dolibarr ERP functional modules organization-wide. Disabled modules hide immediately from workspace navigation.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-6">
            {modules.map((m) => (
              <div
                key={m.module_key}
                className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 flex flex-col justify-between gap-3"
              >
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-zinc-500">{m.category}</span>
                    <StatusText status={m.enabled === 1 ? 'active' : 'inactive'} />
                  </div>
                  <div className="mt-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {m.name}
                  </div>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{m.description}</p>
                </div>
                <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                  <span className="font-mono text-[11px] text-zinc-400">{m.module_key}</span>
                  {m.locked === 1 ? (
                    <span className="text-[11px] font-medium text-zinc-500">Core Locked</span>
                  ) : (
                    <button
                      type="button"
                      disabled={!canAdminWrite}
                      onClick={() => handleToggleModule(m)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                        m.enabled === 1
                          ? 'border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                          : 'bg-orange-700 text-white hover:bg-orange-800'
                      }`}
                    >
                      {m.enabled === 1 ? 'Disable' : 'Enable'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* INTEGRATIONS HUB TAB */}
      {tab === 'integrations' && canAdminRead && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                LDAP / Active Directory Connectivity
              </h3>
              <p className="text-xs text-zinc-500">
                Directory bind settings for enterprise user synchronization. Secrets are write-only.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium mb-1">LDAP Host</label>
                <input
                  type="text"
                  value={ldapCfg.host}
                  onChange={(e) => setLdapCfg({ ...ldapCfg, host: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Port</label>
                <input
                  type="number"
                  value={ldapCfg.port}
                  onChange={(e) => setLdapCfg({ ...ldapCfg, port: Number(e.target.value) })}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Base DN</label>
              <input
                type="text"
                value={ldapCfg.baseDn}
                onChange={(e) => setLdapCfg({ ...ldapCfg, baseDn: e.target.value })}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Bind DN</label>
                <input
                  type="text"
                  value={ldapCfg.bindDn}
                  onChange={(e) => setLdapCfg({ ...ldapCfg, bindDn: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  Bind Secret {ldapCfg.hasBindSecret ? '(Configured)' : '(Not set)'}
                </label>
                <input
                  type="password"
                  value={ldapCfg.bindPassword}
                  onChange={(e) => setLdapCfg({ ...ldapCfg, bindPassword: e.target.value })}
                  placeholder="Enter to update"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              </div>
            </div>
            <div className="flex items-center justify-between pt-2">
              <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={ldapCfg.enabled}
                  onChange={(e) => setLdapCfg({ ...ldapCfg, enabled: e.target.checked })}
                />
                <span>Enable LDAP Sync</span>
              </label>
              {canManageRoles && (
                <button
                  type="button"
                  onClick={() => handleSaveIntegration('ldap', ldapCfg, 'LDAP')}
                  className="px-3.5 py-1.5 rounded-lg bg-orange-700 text-white text-xs font-medium"
                >
                  Save LDAP
                </button>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Payment Platforms (Stripe, PayPal, Paybox)
              </h3>
              <p className="text-xs text-zinc-500">
                Enable customer portal online payment processors on validated invoices.
              </p>
            </div>
            <div className="space-y-2.5 text-xs">
              <label className="flex items-center justify-between p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 cursor-pointer">
                <span>Stripe Payments ({payCfg.stripeMode})</span>
                <input
                  type="checkbox"
                  checked={payCfg.stripeEnabled}
                  onChange={(e) => setPayCfg({ ...payCfg, stripeEnabled: e.target.checked })}
                />
              </label>
              <label className="flex items-center justify-between p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 cursor-pointer">
                <span>PayPal Express Checkout</span>
                <input
                  type="checkbox"
                  checked={payCfg.paypalEnabled}
                  onChange={(e) => setPayCfg({ ...payCfg, paypalEnabled: e.target.checked })}
                />
              </label>
              <label className="flex items-center justify-between p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 cursor-pointer">
                <span>Paybox / Verifone Gateway</span>
                <input
                  type="checkbox"
                  checked={payCfg.payboxEnabled}
                  onChange={(e) => setPayCfg({ ...payCfg, payboxEnabled: e.target.checked })}
                />
              </label>
            </div>
            <div className="flex justify-end">
              {canManageRoles && (
                <button
                  type="button"
                  onClick={() => handleSaveIntegration('payment_gateways', payCfg, 'Payment gateways')}
                  className="px-3.5 py-1.5 rounded-lg bg-orange-700 text-white text-xs font-medium"
                >
                  Save Gateways
                </button>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Click-to-Dial & Inbound Email Collector
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Dial URI Scheme</label>
                <select
                  value={dialCfg.scheme}
                  onChange={(e) => setDialCfg({ ...dialCfg, scheme: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  <option value="tel:">tel: (Standard Telephony)</option>
                  <option value="sip:">sip: (VoIP / Asterisk)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Collector IMAP Mailbox</label>
                <input
                  type="text"
                  value={collectorCfg.mailbox}
                  onChange={(e) => setCollectorCfg({ ...collectorCfg, mailbox: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              {canManageRoles && (
                <>
                  <button
                    type="button"
                    onClick={() => handleSaveIntegration('click_to_dial', dialCfg, 'Click-to-Dial')}
                    className="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
                  >
                    Save Telephony
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveIntegration('email_collector', collectorCfg, 'Email Collector')}
                    className="px-3.5 py-1.5 rounded-lg bg-orange-700 text-white text-xs font-medium"
                  >
                    Save Collector
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Organization Social Platforms
            </h3>
            <div className="space-y-2.5">
              <input
                type="url"
                value={socialCfg.linkedin}
                onChange={(e) => setSocialCfg({ ...socialCfg, linkedin: e.target.value })}
                placeholder="LinkedIn https://..."
                className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
              <input
                type="url"
                value={socialCfg.x}
                onChange={(e) => setSocialCfg({ ...socialCfg, x: e.target.value })}
                placeholder="X / Twitter https://..."
                className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
              <input
                type="url"
                value={socialCfg.github}
                onChange={(e) => setSocialCfg({ ...socialCfg, github: e.target.value })}
                placeholder="GitHub https://..."
                className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div className="flex justify-end">
              {canManageRoles && (
                <button
                  type="button"
                  onClick={() => handleSaveIntegration('social', socialCfg, 'Social platforms')}
                  className="px-3.5 py-1.5 rounded-lg bg-orange-700 text-white text-xs font-medium"
                >
                  Save Social Links
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SYSTEM AUDIT LOG TAB */}
      {tab === 'audit' && canAuditRead && (
        <SystemAuditLogView permissions={permissions} onNotify={onNotify} />
      )}

      {/* Create / Edit Team User Modal */}
      <Modal
        open={userModal}
        onClose={() => {
          setUserModal(false);
          setEditingUser(null);
        }}
        title={editingUser ? `Edit User · ${editingUser.username}` : 'Create Team User'}
        subtitle={
          editingUser
            ? 'Update user profile details, role assignment, or password.'
            : 'Provision an account with a specific RBAC role.'
        }
      >
        <form onSubmit={handleSaveUser} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Full Name
              </label>
              <input
                type="text"
                required
                value={uFullName}
                onChange={(e) => setUFullName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Username
              </label>
              <input
                type="text"
                required
                value={uUsername}
                onChange={(e) => setUUsername(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Email Address
            </label>
            <input
              type="email"
              required
              value={uEmail}
              onChange={(e) => setUEmail(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                {editingUser ? 'New Password (Optional)' : 'Initial Password'}
              </label>
              <input
                type="password"
                required={!editingUser}
                minLength={policy?.min_password_length ?? 10}
                value={uPassword}
                placeholder={editingUser ? 'Leave blank to keep current password' : undefined}
                onChange={(e) => setUPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Assign Role
              </label>
              <select
                required
                disabled={editingUser?.id === currentUser.id}
                value={uRoleId}
                onChange={(e) => setURoleId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-60"
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {editingUser && editingUser.id !== currentUser.id && (
            <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={uIsActive}
                onChange={(e) => setUIsActive(e.target.checked)}
                className="rounded border-zinc-300 text-orange-600"
              />
              <span>Account active (allow login)</span>
            </label>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setUserModal(false);
                setEditingUser(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              {editingUser ? 'Save Changes' : 'Create User'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Create / Edit Role Modal */}
      <Modal
        open={roleModal}
        onClose={() => {
          setRoleModal(false);
          setEditingRole(null);
        }}
        title={editingRole ? `Edit Role · ${editingRole.name}` : 'New Custom RBAC Role'}
        subtitle={
          editingRole
            ? 'Update role name, description, or MFA enforcement policy.'
            : 'Create a role and configure its module permissions in the matrix.'
        }
      >
        <form onSubmit={handleSaveRole} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Role Name
            </label>
            <input
              type="text"
              required
              value={rName}
              onChange={(e) => setRName(e.target.value)}
              placeholder="e.g. Regional Auditor"
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Description
            </label>
            <input
              type="text"
              value={rDesc}
              onChange={(e) => setRDesc(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={rMfa}
              onChange={(e) => setRMfa(e.target.checked)}
              className="rounded border-zinc-300 text-orange-600"
            />
            <span>Require TOTP MFA for users with this role</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setRoleModal(false);
                setEditingRole(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              {editingRole ? 'Save Role' : 'Create Role'}
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

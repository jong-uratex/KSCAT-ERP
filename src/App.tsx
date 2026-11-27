import { Suspense, lazy, useEffect, useState } from 'react';
import {
  Boxes,
  Building2,
  CreditCard,
  Factory,
  FolderKanban,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  Moon,
  Settings,
  ShoppingBag,
  Sun,
  UserCircle,
  UsersRound,
  Wrench,
  X,
} from 'lucide-react';
import { AuthPortal } from './components/AuthPortal';
import { GlobalSearchBar } from './components/GlobalSearchBar';
import { apiRequest, can, setAuthToken, setUnauthorizedHandler } from './lib/api';

const AdminSecurityView = lazy(() =>
  import('./components/AdminSecurityView').then((m) => ({ default: m.AdminSecurityView }))
);
const BillingView = lazy(() =>
  import('./components/BillingView').then((m) => ({ default: m.BillingView }))
);
const CommerceView = lazy(() =>
  import('./components/CommerceView').then((m) => ({ default: m.CommerceView }))
);
const DashboardView = lazy(() =>
  import('./components/DashboardView').then((m) => ({ default: m.DashboardView }))
);
const HrView = lazy(() =>
  import('./components/HrView').then((m) => ({ default: m.HrView }))
);
const InventoryView = lazy(() =>
  import('./components/InventoryView').then((m) => ({ default: m.InventoryView }))
);
const ManufacturingView = lazy(() =>
  import('./components/ManufacturingView').then((m) => ({ default: m.ManufacturingView }))
);
const PosView = lazy(() =>
  import('./components/PosView').then((m) => ({ default: m.PosView }))
);
const ProjectsView = lazy(() =>
  import('./components/ProjectsView').then((m) => ({ default: m.ProjectsView }))
);
const SupportView = lazy(() =>
  import('./components/SupportView').then((m) => ({ default: m.SupportView }))
);
const ThirdPartiesView = lazy(() =>
  import('./components/ThirdPartiesView').then((m) => ({ default: m.ThirdPartiesView }))
);
const UserProfileView = lazy(() =>
  import('./components/UserProfileView').then((m) => ({ default: m.UserProfileView }))
);
const WorkspaceToolsView = lazy(() =>
  import('./components/WorkspaceToolsView').then((m) => ({ default: m.WorkspaceToolsView }))
);
import { setDefaultCurrency } from './lib/format';
import type {
  EnabledModulesMap,
  GlobalSearchResult,
  PermissionMap,
  SearchFocusHint,
  SystemSettings,
  UserProfile,
} from './types/erp';

type ModuleKey =
  | 'dashboard'
  | 'crm'
  | 'inventory'
  | 'manufacturing'
  | 'commerce'
  | 'pos'
  | 'billing'
  | 'support'
  | 'projects'
  | 'hr'
  | 'tools'
  | 'profile'
  | 'settings';

interface NavItem {
  key: ModuleKey;
  label: string;
  section: string;
  Icon: typeof LayoutDashboard;
  visible: (p: PermissionMap, m: EnabledModulesMap) => boolean;
}

const isModOn = (m: EnabledModulesMap, key: string) => m[key] !== false;

const NAV_ITEMS: NavItem[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    section: 'Overview',
    Icon: LayoutDashboard,
    visible: (p) => can(p, 'dashboard', 'read'),
  },
  {
    key: 'crm',
    label: 'Third Parties & CRM',
    section: 'CRM & Directory',
    Icon: Building2,
    visible: (p, m) =>
      can(p, 'crm', 'read') &&
      (isModOn(m, 'crm') || isModOn(m, 'members') || isModOn(m, 'partnerships')),
  },
  {
    key: 'inventory',
    label: 'Products & Stock',
    section: 'Supply Chain',
    Icon: Boxes,
    visible: (p, m) => can(p, 'products', 'read') && isModOn(m, 'products'),
  },
  {
    key: 'manufacturing',
    label: 'Manufacturing & BOM',
    section: 'Supply Chain',
    Icon: Factory,
    visible: (p, m) => can(p, 'manufacturing', 'read') && isModOn(m, 'manufacturing'),
  },
  {
    key: 'commerce',
    label: 'Proposals & Orders',
    section: 'Commerce',
    Icon: ShoppingBag,
    visible: (p, m) =>
      (can(p, 'sales', 'read') && isModOn(m, 'sales')) ||
      (can(p, 'purchasing', 'read') && isModOn(m, 'purchasing')),
  },
  {
    key: 'pos',
    label: 'TakePOS Register',
    section: 'Commerce',
    Icon: CreditCard,
    visible: (p, m) => can(p, 'pos', 'read') && isModOn(m, 'pos'),
  },
  {
    key: 'billing',
    label: 'Finance & Accounting',
    section: 'Finance',
    Icon: Landmark,
    visible: (p, m) =>
      can(p, 'billing', 'read') && (isModOn(m, 'billing') || isModOn(m, 'accounting')),
  },
  {
    key: 'support',
    label: 'Tickets & Knowledge',
    section: 'Service & Collaboration',
    Icon: LifeBuoy,
    visible: (p, m) => can(p, 'support', 'read') && isModOn(m, 'support'),
  },
  {
    key: 'projects',
    label: 'Projects & Agenda',
    section: 'Service & Collaboration',
    Icon: FolderKanban,
    visible: (p, m) =>
      can(p, 'projects', 'read') && (isModOn(m, 'projects') || isModOn(m, 'collaboration')),
  },
  {
    key: 'hr',
    label: 'Human Resources',
    section: 'People',
    Icon: UsersRound,
    visible: (p, m) => can(p, 'hr', 'read') && isModOn(m, 'hr'),
  },
  {
    key: 'tools',
    label: 'EDM, Tools & AI',
    section: 'Workspace Tools',
    Icon: Wrench,
    visible: (p, m) =>
      can(p, 'tools', 'read') &&
      (isModOn(m, 'edm') || isModOn(m, 'tools') || isModOn(m, 'ai_assistant')),
  },
  {
    key: 'profile',
    label: 'User Profile',
    section: 'Account & System',
    Icon: UserCircle,
    visible: () => true,
  },
  {
    key: 'settings',
    label: 'Settings',
    section: 'Account & System',
    Icon: Settings,
    visible: (p) => can(p, 'admin', 'read'),
  },
];

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [permissions, setPermissions] = useState<PermissionMap>({});
  const [enabledModules, setEnabledModules] = useState<EnabledModulesMap>({});
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
  const [activeModule, setActiveModule] = useState<ModuleKey>('dashboard');
  const [searchFocus, setSearchFocus] = useState<SearchFocusHint | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setPermissions({});
      setEnabledModules({});
      setSystemSettings(null);
      setToast({ message: 'Your session expired. Please sign in again.', type: 'error' });
    });
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  function applySystemSettings(settings?: SystemSettings | null) {
    if (!settings) return;
    setSystemSettings(settings);
    if (settings.default_currency) {
      setDefaultCurrency(settings.default_currency);
    }
    if (settings.app_name) {
      document.title = `${settings.app_name} — ${settings.company_name || 'Enterprise Resource Planning'}`;
    }
  }

  function notify(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type });
    window.setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 3600);
  }

  async function refreshCurrentUser() {
    try {
      const me = await apiRequest<{
        user: UserProfile;
        permissions: PermissionMap;
        enabledModules?: EnabledModulesMap;
        systemSettings?: SystemSettings;
      }>('/api/auth/me');
      setUser(me.user);
      setPermissions(me.permissions);
      if (me.enabledModules) {
        setEnabledModules(me.enabledModules);
      }
      if (me.systemSettings) {
        applySystemSettings(me.systemSettings);
      }
    } catch {
      // handled by unauthorized handler
    }
  }

  async function handleSignOut() {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST', skipAuthCheck: true });
    } catch {
      // ignore
    } finally {
      setAuthToken(null);
      setUser(null);
      setPermissions({});
      setEnabledModules({});
      setSystemSettings(null);
    }
  }

  if (!user) {
    return (
      <AuthPortal
        onAuthenticated={(payload) => {
          setUser(payload.user);
          setPermissions(payload.permissions);
          const mods = payload.enabledModules ?? {};
          setEnabledModules(mods);
          applySystemSettings(payload.systemSettings);
          const firstAllowed = NAV_ITEMS.find((item) => item.visible(payload.permissions, mods));
          setActiveModule(firstAllowed?.key ?? 'profile');
        }}
      />
    );
  }

  const appName = systemSettings?.app_name || 'KSCAT-ERP';
  const visibleNav = NAV_ITEMS.filter((item) => item.visible(permissions, enabledModules));
  const currentNav = visibleNav.find((n) => n.key === activeModule) ?? visibleNav[0];

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-zinc-950/50 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Left Navigation Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 flex flex-col transition-transform duration-150 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-14 px-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="bg-white rounded-md px-1.5 py-1 border border-zinc-200/80 dark:border-transparent shrink-0">
              <img
                src="/assets/aistudio/kscat_logo_5a3936b7.png"
                alt="KSCAT Logo"
                className="h-6 w-auto object-contain"
              />
            </div>
            <span className="font-display font-semibold text-sm tracking-tight text-zinc-900 dark:text-zinc-100 truncate">
              {appName}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation"
            className="lg:hidden p-1 text-zinc-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-2">
          {visibleNav.map((item, idx) => {
            const Icon = item.Icon;
            const active = currentNav?.key === item.key;
            const showSection = idx === 0 || visibleNav[idx - 1].section !== item.section;
            return (
              <div key={item.key}>
                {showSection && (
                  <div className="px-3 pt-2.5 pb-1 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                    {item.section}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setActiveModule(item.key);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-orange-50 dark:bg-orange-950/50 text-orange-800 dark:text-orange-300'
                      : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-orange-600 dark:text-orange-400' : ''}`} />
                  <span>{item.label}</span>
                </button>
              </div>
            );
          })}
        </nav>

        {/* Authenticated User Summary Footer */}
        <button
          type="button"
          onClick={() => {
            setActiveModule('profile');
            setMobileMenuOpen(false);
          }}
          className="p-4 border-t border-zinc-200 dark:border-zinc-800 space-y-1 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
        >
          <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            {user.fullName}
          </div>
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
            {user.roleName} · {user.mfaEnabled ? 'MFA On' : 'MFA Off'}
          </div>
        </button>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract */}
        <header className="h-14 px-4 sm:px-6 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3 sm:gap-6 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0 shrink-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden p-1.5 rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <img
                src="/assets/aistudio/favicon_1e6abf50.png"
                alt=""
                aria-hidden="true"
                className="w-4 h-4 rounded-sm hidden sm:inline object-contain"
              />
              <span className="text-zinc-500 dark:text-zinc-400 hidden md:inline">{appName}</span>
              <span className="text-zinc-300 dark:text-zinc-700 hidden md:inline">/</span>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100 truncate hidden sm:inline">
                {currentNav?.label ?? 'Workspace'}
              </span>
            </div>
          </div>

          <GlobalSearchBar
            onSelectResult={(result: GlobalSearchResult) => {
              setActiveModule(result.moduleKey as ModuleKey);
              setSearchFocus({
                moduleKey: result.moduleKey,
                subTab: result.subTab,
                recordId: result.id,
                ref: result.ref,
                title: result.title,
                ts: Date.now(),
              });
            }}
          />

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
              className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="px-3.5 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </header>

        {/* Non-blocking Toast */}
        {toast && (
          <div className="fixed bottom-5 right-5 z-50 max-w-sm">
            <div
              className={`px-4 py-3 rounded-lg border shadow-lg text-xs font-medium flex items-center justify-between gap-3 ${
                toast.type === 'error'
                  ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-900 text-red-800 dark:text-red-200'
                  : 'bg-zinc-900 dark:bg-zinc-100 border-zinc-800 dark:border-zinc-200 text-white dark:text-zinc-900'
              }`}
            >
              <span>{toast.message}</span>
              <button
                type="button"
                onClick={() => setToast(null)}
                aria-label="Dismiss notification"
                className="opacity-70 hover:opacity-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Active Module Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1400px] w-full mx-auto">
          <Suspense
            fallback={
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-8 text-sm text-zinc-500">
                Loading workspace module...
              </div>
            }
          >
            {currentNav?.key === 'dashboard' && (
              <DashboardView
                onNavigate={(k) =>
                  setActiveModule((k === 'admin' ? 'settings' : k) as ModuleKey)
                }
              />
            )}
            {currentNav?.key === 'crm' && (
              <ThirdPartiesView
                permissions={permissions}
                enabledModules={enabledModules}
                focusHint={searchFocus?.moduleKey === 'crm' ? searchFocus : null}
                onNotify={notify}
              />
            )}
            {currentNav?.key === 'inventory' && (
              <InventoryView
                permissions={permissions}
                focusHint={searchFocus?.moduleKey === 'inventory' ? searchFocus : null}
                onNotify={notify}
              />
            )}
            {currentNav?.key === 'manufacturing' && (
              <ManufacturingView permissions={permissions} onNotify={notify} />
            )}
            {currentNav?.key === 'commerce' && (
              <CommerceView
                permissions={permissions}
                enabledModules={enabledModules}
                focusHint={searchFocus?.moduleKey === 'commerce' ? searchFocus : null}
                onNotify={notify}
              />
            )}
            {currentNav?.key === 'pos' && (
              <PosView permissions={permissions} onNotify={notify} />
            )}
            {currentNav?.key === 'billing' && (
              <BillingView
                permissions={permissions}
                enabledModules={enabledModules}
                focusHint={searchFocus?.moduleKey === 'billing' ? searchFocus : null}
                onNotify={notify}
              />
            )}
            {currentNav?.key === 'support' && (
              <SupportView
                permissions={permissions}
                focusHint={searchFocus?.moduleKey === 'support' ? searchFocus : null}
                onNotify={notify}
              />
            )}
            {currentNav?.key === 'projects' && (
              <ProjectsView
                permissions={permissions}
                enabledModules={enabledModules}
                focusHint={searchFocus?.moduleKey === 'projects' ? searchFocus : null}
                onNotify={notify}
              />
            )}
            {currentNav?.key === 'hr' && (
              <HrView permissions={permissions} currentUserEmail={user.email} onNotify={notify} />
            )}
            {currentNav?.key === 'tools' && (
              <WorkspaceToolsView
                permissions={permissions}
                enabledModules={enabledModules}
                onNotify={notify}
              />
            )}
            {currentNav?.key === 'profile' && (
              <UserProfileView
                currentUser={user}
                onUserUpdated={refreshCurrentUser}
                onNotify={notify}
              />
            )}
            {currentNav?.key === 'settings' && can(permissions, 'admin', 'read') && (
              <AdminSecurityView
                currentUser={user}
                permissions={permissions}
                onUserUpdated={refreshCurrentUser}
                onModulesChanged={refreshCurrentUser}
                onSettingsChanged={refreshCurrentUser}
                onNotify={notify}
              />
            )}
          </Suspense>
        </main>
      </div>
    </div>
  );
}

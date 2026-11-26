import { useEffect, useState, type FormEvent } from 'react';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { apiRequest, setAuthToken } from '../lib/api';
import type {
  EnabledModulesMap,
  PermissionMap,
  SecurityPolicy,
  SystemSettings,
  UserProfile,
} from '../types/erp';

interface AuthSuccessPayload {
  status: 'authenticated';
  token: string;
  user: UserProfile;
  permissions: PermissionMap;
  policy: SecurityPolicy;
  enabledModules?: EnabledModulesMap;
  systemSettings?: SystemSettings;
  recoveryCodes?: string[];
}

interface AuthPortalProps {
  onAuthenticated: (payload: AuthSuccessPayload) => void;
}

type AuthStep =
  | 'loading'
  | 'bootstrap'
  | 'login'
  | 'mfa_verify'
  | 'mfa_enroll'
  | 'mfa_recovery_reveal';

export function AuthPortal({ onAuthenticated }: AuthPortalProps) {
  const [step, setStep] = useState<AuthStep>('loading');
  const [hasEnvBootPasscode, setHasEnvBootPasscode] = useState(false);
  const [minPasswordLength, setMinPasswordLength] = useState(10);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Bootstrap fields
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('admin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [bootPasscode, setBootPasscode] = useState('');
  const [enrollMfaNow, setEnrollMfaNow] = useState(false);
  const [seedSampleData, setSeedSampleData] = useState(true);

  // Login fields
  const [identifier, setIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // MFA Verify fields
  const [challengeToken, setChallengeToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [userPreview, setUserPreview] = useState<{
    fullName: string;
    email: string;
    roleName: string;
  } | null>(null);

  // MFA Enroll fields
  const [enrollToken, setEnrollToken] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [manualSecret, setManualSecret] = useState('');
  const [enrollCode, setEnrollCode] = useState('');
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [pendingAuthSuccess, setPendingAuthSuccess] = useState<AuthSuccessPayload | null>(null);
  const [copiedRecovery, setCopiedRecovery] = useState(false);

  useEffect(() => {
    let active = true;
    apiRequest<{
      needsBootstrap: boolean;
      hasEnvBootPasscode: boolean;
      minPasswordLength: number;
    }>('/api/auth/status', { skipAuthCheck: true })
      .then((res) => {
        if (!active) return;
        setHasEnvBootPasscode(res.hasEnvBootPasscode);
        setMinPasswordLength(res.minPasswordLength || 10);
        setStep(res.needsBootstrap ? 'bootstrap' : 'login');
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Unable to reach authentication service.');
        setStep('login');
      });
    return () => {
      active = false;
    };
  }, []);

  async function beginMfaEnrollment(token: string) {
    setEnrollToken(token);
    setStep('mfa_enroll');
    try {
      const data = await apiRequest<{ qrDataUrl: string; manualSecret: string }>(
        '/api/auth/mfa/enroll-start',
        {
          method: 'POST',
          body: { enrollToken: token },
          skipAuthCheck: true,
        }
      );
      setQrDataUrl(data.qrDataUrl);
      setManualSecret(data.manualSecret);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to initialize MFA setup.');
    }
  }

  async function handleBootstrap(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await apiRequest<
        | AuthSuccessPayload
        | {
            status: 'mfa_enrollment_required';
            enrollToken: string;
            userPreview: { fullName: string; email: string; roleName: string };
          }
      >('/api/auth/bootstrap', {
        method: 'POST',
        body: {
          fullName,
          username,
          email,
          password,
          bootPasscode: hasEnvBootPasscode ? bootPasscode : undefined,
          enrollMfaNow,
          seedSampleData,
        },
        skipAuthCheck: true,
      });

      if (res.status === 'mfa_enrollment_required') {
        setUserPreview(res.userPreview);
        await beginMfaEnrollment(res.enrollToken);
      } else {
        setAuthToken(res.token);
        onAuthenticated(res);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Workspace initialization failed.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await apiRequest<
        | AuthSuccessPayload
        | {
            status: 'mfa_required';
            challengeToken: string;
            userPreview: { fullName: string; email: string; roleName: string };
          }
        | {
            status: 'mfa_enrollment_required';
            enrollToken: string;
            userPreview: { fullName: string; email: string; roleName: string };
          }
      >('/api/auth/login', {
        method: 'POST',
        body: { identifier, password: loginPassword },
        skipAuthCheck: true,
      });

      if (res.status === 'mfa_required') {
        setChallengeToken(res.challengeToken);
        setUserPreview(res.userPreview);
        setMfaCode('');
        setUseRecoveryCode(false);
        setStep('mfa_verify');
      } else if (res.status === 'mfa_enrollment_required') {
        setUserPreview(res.userPreview);
        await beginMfaEnrollment(res.enrollToken);
      } else {
        setAuthToken(res.token);
        onAuthenticated(res);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMfaVerify(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await apiRequest<AuthSuccessPayload>('/api/auth/mfa/verify', {
        method: 'POST',
        body: {
          challengeToken,
          code: mfaCode,
          isRecoveryCode: useRecoveryCode,
        },
        skipAuthCheck: true,
      });
      setAuthToken(res.token);
      onAuthenticated(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MFA verification failed.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEnrollConfirm(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await apiRequest<AuthSuccessPayload>('/api/auth/mfa/enroll-confirm', {
        method: 'POST',
        body: { enrollToken, code: enrollCode },
        skipAuthCheck: true,
      });
      if (res.recoveryCodes && res.recoveryCodes.length > 0) {
        setPendingAuthSuccess(res);
        setStep('mfa_recovery_reveal');
      } else {
        setAuthToken(res.token);
        onAuthenticated(res);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification code invalid.');
    } finally {
      setSubmitting(false);
    }
  }

  function finishWithRecoveryCodes() {
    if (!pendingAuthSuccess) return;
    setAuthToken(pendingAuthSuccess.token);
    onAuthenticated(pendingAuthSuccess);
  }

  function copyText(text: string, which: 'secret' | 'recovery') {
    navigator.clipboard?.writeText(text).then(() => {
      if (which === 'secret') {
        setCopiedSecret(true);
        setTimeout(() => setCopiedSecret(false), 1800);
      } else {
        setCopiedRecovery(true);
        setTimeout(() => setCopiedRecovery(false), 1800);
      }
    });
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col lg:flex-row">
      {/* Left Enterprise Overview Column */}
      <div className="lg:w-[44%] bg-zinc-900 text-zinc-100 p-8 lg:p-14 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-zinc-800">
        <div>
          <div className="flex items-center">
            <span className="font-display text-xl font-bold tracking-tight text-white">
              KSCAT-ERP
            </span>
          </div>

          <div className="mt-12 max-w-md">
            <h1 className="text-3xl font-semibold tracking-tight text-white leading-tight [text-wrap:balance]">
              Unified Enterprise Resource Planning & Security Operations
            </h1>
            <p className="mt-4 text-sm text-zinc-300 leading-relaxed">
              Manage third parties, multi-warehouse inventory, commercial proposals, sales and purchase
              orders, invoicing, treasury ledgers, and client projects inside a single role-governed workspace.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-5 max-w-md border-t border-zinc-800 pt-8">
            <div className="flex items-start gap-3.5">
              <ShieldCheck className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-medium text-white">Role-Based Access Control</h2>
                <p className="mt-0.5 text-xs text-zinc-400 leading-relaxed">
                  Granular module permissions across CRM, Inventory, Commerce, Finance, Projects, and
                  Administration enforced on every API route.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3.5">
              <Smartphone className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-medium text-white">TOTP Multi-Factor Authentication</h2>
                <p className="mt-0.5 text-xs text-zinc-400 leading-relaxed">
                  RFC 6238 authenticator verification with QR provisioning, single-use recovery codes,
                  replay protection, and role-level MFA enforcement.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3.5">
              <Lock className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-medium text-white">Account Lockout & Audit Trail</h2>
                <p className="mt-0.5 text-xs text-zinc-400 leading-relaxed">
                  Salted scrypt credential hashing, brute-force lockout protection, active session
                  revocation, and immutable audit logging.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-zinc-800 flex items-center gap-2 text-xs text-zinc-400">
          <span>KSCAT-ERP</span>
          <span aria-hidden="true">·</span>
          <span>KS Cross Asia Technologies Inc.</span>
          <span aria-hidden="true">·</span>
          <span>RBAC & TOTP MFA</span>
        </div>
      </div>

      {/* Right Authentication Form Column */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10 lg:p-14 gap-7">
        <div className="w-full max-w-md flex justify-center">
          <div className="dark:bg-white dark:px-5 dark:py-3 dark:rounded-xl">
            <img
              src="/assets/aistudio/kscat_logo_5a3936b7.png"
              alt="KSCAT — KS Cross Asia Technologies Inc."
              className="h-20 sm:h-24 w-auto max-w-full object-contain"
            />
          </div>
        </div>
        <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-7 sm:p-8">
          {step === 'loading' && (
            <div className="py-12 text-center text-sm text-zinc-500">
              Checking workspace initialization status...
            </div>
          )}

          {step === 'bootstrap' && (
            <form onSubmit={handleBootstrap} className="space-y-4">
              <div>
                <p className="text-xs font-medium text-orange-700 dark:text-orange-400">
                  First-Run Setup
                </p>
                <h2 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                  Claim Super Admin Account
                </h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Create the primary Super Admin account to initialize your KSCAT-ERP workspace. You can add
                  Finance, Sales, and Warehouse team accounts inside Settings.
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Alex Mercer"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="admin"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:ring-2 focus:ring-orange-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Work Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@kscat.com"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Password (min {minPasswordLength} characters)
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={minPasswordLength}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create a strong password"
                    className="w-full px-3 py-2 pr-10 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-0.5"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {hasEnvBootPasscode && (
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Admin Boot Passcode
                  </label>
                  <input
                    type="password"
                    required
                    value={bootPasscode}
                    onChange={(e) => setBootPasscode(e.target.value)}
                    placeholder="Configured ADMIN_BOOT_PASSCODE"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-600"
                  />
                </div>
              )}

              <div className="space-y-2.5 pt-1 border-t border-zinc-200 dark:border-zinc-800">
                <label className="flex items-start gap-2.5 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enrollMfaNow}
                    onChange={(e) => setEnrollMfaNow(e.target.checked)}
                    className="mt-0.5 rounded border-zinc-300 text-orange-600 focus:ring-orange-600"
                  />
                  <span>
                    Enroll TOTP Authenticator MFA immediately (can also be enabled anytime in User Profile)
                  </span>
                </label>

                <label className="flex items-start gap-2.5 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={seedSampleData}
                    onChange={(e) => setSeedSampleData(e.target.checked)}
                    className="mt-0.5 rounded border-zinc-300 text-orange-600 focus:ring-orange-600"
                  />
                  <span>
                    Initialize workspace with sample Dolibarr ERP records (customers, products,
                    warehouses, proposals, invoices, and projects)
                  </span>
                </label>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 disabled:opacity-60 text-white text-sm font-medium transition-colors"
              >
                {submitting ? 'Initializing Workspace...' : 'Create Super Admin & Launch ERP'}
              </button>
            </form>
          )}

          {step === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                  Sign in to KSCAT-ERP
                </h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Enter your organizational credentials. Accounts with MFA enabled will prompt for a
                  6-digit authenticator code.
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Email or Username
                </label>
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="user@kscat.com or username"
                  autoComplete="username"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    className="w-full px-3 py-2 pr-10 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-0.5"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 disabled:opacity-60 text-white text-sm font-medium transition-colors"
              >
                {submitting ? 'Verifying...' : 'Sign In'}
              </button>
            </form>
          )}

          {step === 'mfa_verify' && (
            <form onSubmit={handleMfaVerify} className="space-y-4">
              <div>
                <p className="text-xs font-medium text-orange-700 dark:text-orange-400">
                  Two-Factor Verification
                </p>
                <h2 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                  {useRecoveryCode ? 'Enter Recovery Code' : 'Authenticator Verification'}
                </h2>
                {userPreview && (
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {userPreview.fullName} · {userPreview.roleName} · {userPreview.email}
                  </p>
                )}
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {useRecoveryCode
                    ? '8-Character Single-Use Recovery Code'
                    : '6-Digit Authenticator Code'}
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  placeholder={useRecoveryCode ? 'ABCD-1234' : '000000'}
                  maxLength={useRecoveryCode ? 12 : 6}
                  className="w-full px-3 py-2.5 text-center text-lg tracking-widest font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-600"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 disabled:opacity-60 text-white text-sm font-medium transition-colors"
              >
                {submitting ? 'Verifying Code...' : 'Verify & Continue'}
              </button>

              <div className="flex items-center justify-between pt-2 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setUseRecoveryCode((v) => !v);
                    setMfaCode('');
                    setError('');
                  }}
                  className="text-orange-700 dark:text-orange-400 hover:underline font-medium"
                >
                  {useRecoveryCode ? 'Use 6-digit authenticator app' : 'Use a backup recovery code'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep('login');
                    setError('');
                  }}
                  className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                >
                  Back to sign in
                </button>
              </div>
            </form>
          )}

          {step === 'mfa_enroll' && (
            <form onSubmit={handleEnrollConfirm} className="space-y-4">
              <div>
                <p className="text-xs font-medium text-orange-700 dark:text-orange-400">
                  Required Security Setup
                </p>
                <h2 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                  Enroll Authenticator App
                </h2>
                {userPreview && (
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {userPreview.roleName} policy requires TOTP MFA for {userPreview.email}.
                  </p>
                )}
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}

              <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center gap-3">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="TOTP MFA QR Code"
                    className="w-44 h-44 rounded-md border border-zinc-200 bg-white p-1"
                  />
                ) : (
                  <div className="w-44 h-44 flex items-center justify-center text-xs text-zinc-400">
                    Generating QR code...
                  </div>
                )}

                {manualSecret && (
                  <div className="w-full">
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-1 text-center">
                      Or enter setup key manually:
                    </div>
                    <div className="flex items-center gap-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md px-2.5 py-1.5">
                      <code className="flex-1 text-xs font-mono text-zinc-800 dark:text-zinc-200 truncate">
                        {manualSecret}
                      </code>
                      <button
                        type="button"
                        onClick={() => copyText(manualSecret, 'secret')}
                        className="text-xs text-orange-700 dark:text-orange-400 hover:underline inline-flex items-center gap-1 shrink-0"
                      >
                        {copiedSecret ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedSecret ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Enter 6-Digit Verification Code
                </label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={enrollCode}
                  onChange={(e) => setEnrollCode(e.target.value)}
                  placeholder="000000"
                  className="w-full px-3 py-2 text-center text-lg tracking-widest font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-600"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 disabled:opacity-60 text-white text-sm font-medium transition-colors"
              >
                {submitting ? 'Confirming Enrollment...' : 'Verify & Activate MFA'}
              </button>
            </form>
          )}

          {step === 'mfa_recovery_reveal' && pendingAuthSuccess?.recoveryCodes && (
            <div className="space-y-4">
              <div className="flex items-start gap-2.5">
                <KeyRound className="w-5 h-5 text-orange-700 dark:text-orange-400 shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                    Save Your Recovery Codes
                  </h2>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Store these 8 single-use codes securely. They will not be shown again and let you
                    sign in if you lose access to your authenticator device.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 p-3.5 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
                {pendingAuthSuccess.recoveryCodes.map((rc) => (
                  <div
                    key={rc}
                    className="font-mono text-xs text-zinc-800 dark:text-zinc-200 text-center py-1 bg-white dark:bg-zinc-900 rounded border border-zinc-200 dark:border-zinc-800"
                  >
                    {rc}
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => copyText(pendingAuthSuccess.recoveryCodes!.join('\n'), 'recovery')}
                className="w-full py-2 px-4 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 inline-flex items-center justify-center gap-1.5"
              >
                {copiedRecovery ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedRecovery ? 'Copied All Codes' : 'Copy Recovery Codes'}</span>
              </button>

              <button
                type="button"
                onClick={finishWithRecoveryCodes}
                className="w-full py-2.5 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-sm font-medium transition-colors"
              >
                I Saved My Codes — Launch KSCAT-ERP
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

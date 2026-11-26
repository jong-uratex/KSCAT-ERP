import { useEffect, useState, type FormEvent } from 'react';
import {
  Check,
  Copy,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  User,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { SecurityPolicy, UserProfile, UserSessionInfo } from '../types/erp';
import { Modal } from './Modal';
import { StatusText } from './StatusText';

interface UserProfileViewProps {
  currentUser: UserProfile;
  onUserUpdated: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export function UserProfileView({ currentUser, onUserUpdated, onNotify }: UserProfileViewProps) {
  const [fullName, setFullName] = useState(currentUser.fullName);
  const [username, setUsername] = useState(currentUser.username);
  const [email, setEmail] = useState(currentUser.email);
  const [phone, setPhone] = useState(currentUser.phone ?? '');
  const [jobTitle, setJobTitle] = useState(currentUser.jobTitle ?? '');
  const [department, setDepartment] = useState(currentUser.department ?? '');
  const [timezone, setTimezone] = useState(currentUser.timezone ?? 'Asia/Manila');
  const [savingProfile, setSavingProfile] = useState(false);

  // Password Change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // MFA & Sessions
  const [policy, setPolicy] = useState<SecurityPolicy | null>(null);
  const [sessions, setSessions] = useState<UserSessionInfo[]>([]);
  const [remainingRecoveryCodes, setRemainingRecoveryCodes] = useState(0);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [manualSecret, setManualSecret] = useState('');
  const [enrollCode, setEnrollCode] = useState('');
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [revealedCodes, setRevealedCodes] = useState<string[] | null>(null);
  const [disableModal, setDisableModal] = useState(false);
  const [disablePass, setDisablePass] = useState('');
  const [disableCode, setDisableCode] = useState('');

  useEffect(() => {
    setFullName(currentUser.fullName);
    setUsername(currentUser.username);
    setEmail(currentUser.email);
    setPhone(currentUser.phone ?? '');
    setJobTitle(currentUser.jobTitle ?? '');
    setDepartment(currentUser.department ?? '');
    setTimezone(currentUser.timezone ?? 'Asia/Manila');
  }, [currentUser]);

  async function loadSecurityDetails() {
    try {
      const res = await apiRequest<{
        sessions: UserSessionInfo[];
        remainingRecoveryCodes: number;
        policy: SecurityPolicy;
      }>('/api/auth/me');
      setSessions(res.sessions);
      setRemainingRecoveryCodes(res.remainingRecoveryCodes);
      setPolicy(res.policy);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to load account security details.', 'error');
    }
  }

  useEffect(() => {
    loadSecurityDetails();
  }, []);

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await apiRequest('/api/auth/profile', {
        method: 'PUT',
        body: { fullName, username, email, phone, jobTitle, department, timezone },
      });
      await onUserUpdated();
      onNotify('Your profile details have been updated.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update profile.', 'error');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      onNotify('New password and confirmation do not match.', 'error');
      return;
    }
    setSavingPassword(true);
    try {
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onNotify('Account password updated successfully.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to change password.', 'error');
    } finally {
      setSavingPassword(false);
    }
  }

  async function startMfaEnrollment() {
    try {
      const res = await apiRequest<{ qrDataUrl: string; manualSecret: string }>(
        '/api/auth/mfa/enroll-start',
        { method: 'POST', body: {} }
      );
      setQrDataUrl(res.qrDataUrl);
      setManualSecret(res.manualSecret);
      setEnrollCode('');
      setEnrollOpen(true);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to start MFA enrollment.', 'error');
    }
  }

  async function confirmMfaEnrollment(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await apiRequest<{ mfaEnabled: boolean; recoveryCodes: string[] }>(
        '/api/auth/mfa/enroll-confirm',
        { method: 'POST', body: { code: enrollCode } }
      );
      setEnrollOpen(false);
      setRevealedCodes(res.recoveryCodes);
      onNotify('TOTP Multi-Factor Authentication activated.');
      await onUserUpdated();
      await loadSecurityDetails();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Invalid verification code.', 'error');
    }
  }

  async function handleDisableMfa(e: FormEvent) {
    e.preventDefault();
    try {
      await apiRequest('/api/auth/mfa/disable', {
        method: 'POST',
        body: { password: disablePass, code: disableCode },
      });
      setDisableModal(false);
      setDisablePass('');
      setDisableCode('');
      onNotify('MFA disabled for your account.');
      await onUserUpdated();
      await loadSecurityDetails();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to disable MFA.', 'error');
    }
  }

  async function handleRevokeSession(sessionId: number) {
    try {
      await apiRequest(`/api/auth/sessions/${sessionId}`, { method: 'DELETE' });
      onNotify('Session revoked.');
      await loadSecurityDetails();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to revoke session.', 'error');
    }
  }

  const initials = currentUser.fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div className="space-y-6">
      {/* Identity Overview Header */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-orange-700 text-white font-display font-bold text-base flex items-center justify-center shrink-0">
            {initials || <User className="w-5 h-5" />}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {currentUser.fullName}
            </h2>
            <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 flex flex-wrap items-center gap-2">
              <span className="font-medium text-orange-700 dark:text-orange-400">{currentUser.roleName}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{currentUser.username}</span>
              <span aria-hidden="true">·</span>
              <span>{currentUser.email}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
          <StatusText status={currentUser.mfaEnabled ? 'mfa_on' : 'mfa_off'} />
          <span>Last sign-in: {formatDateTime(currentUser.lastLoginAt)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Personal Profile Form */}
        <form
          onSubmit={handleSaveProfile}
          className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4"
        >
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-orange-600 dark:text-orange-400" />
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Personal Details
            </h3>
          </div>

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
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-orange-600"
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
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-orange-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Work Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-orange-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Direct Phone
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+63 917 555 0140"
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-orange-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Job Title
              </label>
              <input
                type="text"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="Operations Lead"
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-orange-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Department
              </label>
              <input
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="Enterprise Systems"
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-orange-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Timezone
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-orange-600"
            >
              <option value="Asia/Manila">Asia/Manila (GMT+8)</option>
              <option value="Asia/Singapore">Asia/Singapore (GMT+8)</option>
              <option value="Asia/Tokyo">Asia/Tokyo (GMT+9)</option>
              <option value="UTC">UTC (Coordinated Universal Time)</option>
              <option value="Europe/London">Europe/London</option>
              <option value="America/Los_Angeles">America/Los_Angeles</option>
              <option value="America/New_York">America/New_York</option>
            </select>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={savingProfile}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 disabled:opacity-60 text-white text-xs font-medium whitespace-nowrap"
            >
              {savingProfile ? 'Saving Profile...' : 'Save Profile'}
            </button>
          </div>
        </form>

        {/* Password & Credentials */}
        <form
          onSubmit={handleChangePassword}
          className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4 flex flex-col justify-between"
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-orange-600 dark:text-orange-400" />
              <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                Change Password
              </h3>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Passwords require at least {policy?.min_password_length ?? 10} characters and are stored with salted scrypt hashing.
            </p>

            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Current Password
              </label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-orange-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                New Password
              </label>
              <input
                type="password"
                required
                minLength={policy?.min_password_length ?? 10}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-orange-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Confirm New Password
              </label>
              <input
                type="password"
                required
                minLength={policy?.min_password_length ?? 10}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-orange-600"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={savingPassword}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 disabled:opacity-60 text-white text-xs font-medium whitespace-nowrap"
            >
              {savingPassword ? 'Updating...' : 'Update Password'}
            </button>
          </div>
        </form>

        {/* TOTP Multi-Factor Authentication */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  Two-Factor Authentication (TOTP)
                </h3>
              </div>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Protect your KSCAT-ERP account using Google Authenticator, Authy, 1Password, or any RFC 6238 authenticator app.
              </p>
            </div>
            <StatusText status={currentUser.mfaEnabled ? 'mfa_on' : 'mfa_off'} />
          </div>

          {currentUser.mfaEnabled ? (
            <div className="space-y-4 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-600 dark:text-zinc-400">Remaining single-use recovery codes</span>
                <span className="font-mono tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                  {remainingRecoveryCodes} / 8
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {!currentUser.roleRequireMfa && !policy?.enforce_mfa_global && (
                  <button
                    type="button"
                    onClick={() => setDisableModal(true)}
                    className="px-3.5 py-2 rounded-lg border border-red-200 dark:border-red-900 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                  >
                    Disable MFA
                  </button>
                )}
                <button
                  type="button"
                  onClick={startMfaEnrollment}
                  className="px-3.5 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 inline-flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Re-enroll Authenticator</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={startMfaEnrollment}
                className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Enable TOTP Authenticator MFA</span>
              </button>
            </div>
          )}

          {revealedCodes && (
            <div className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                <KeyRound className="w-4 h-4 text-orange-700 dark:text-orange-400" />
                <span>New Recovery Codes (Save Now)</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {revealedCodes.map((c) => (
                  <div
                    key={c}
                    className="font-mono text-xs text-center py-1 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
                  >
                    {c}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(revealedCodes.join('\n'));
                  onNotify('Recovery codes copied to clipboard.');
                }}
                className="text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline"
              >
                Copy all codes
              </button>
            </div>
          )}
        </div>

        {/* Active Authenticated Sessions */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Active Authenticated Sessions
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Inspect and revoke active Bearer sessions bound to your account.
            </p>
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {sessions.map((s) => (
              <div key={s.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                    Session #{s.id}
                    {s.isCurrent && (
                      <span className="ml-2 text-orange-700 dark:text-orange-400 font-normal">
                        · Current Browser
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-zinc-500 truncate">
                    IP {s.ipAddress} · Issued {formatDateTime(s.createdAt)}
                  </div>
                </div>
                {!s.isCurrent && (
                  <button
                    type="button"
                    onClick={() => handleRevokeSession(s.id)}
                    className="text-xs font-medium text-red-700 dark:text-red-400 hover:underline inline-flex items-center gap-1 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Revoke</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Enroll MFA Modal */}
      <Modal
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        title="Enroll Authenticator App (TOTP)"
        subtitle="Scan the QR code below with your authenticator app, then enter a 6-digit verification code."
      >
        <form onSubmit={confirmMfaEnrollment} className="space-y-4">
          <div className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 flex flex-col items-center gap-3">
            {qrDataUrl && (
              <img
                src={qrDataUrl}
                alt="TOTP QR Code"
                className="w-44 h-44 rounded border border-zinc-200 bg-white p-1"
              />
            )}
            <div className="w-full flex items-center gap-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded px-2.5 py-1.5">
              <code className="flex-1 text-xs font-mono truncate">{manualSecret}</code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(manualSecret);
                  setCopiedSecret(true);
                  setTimeout(() => setCopiedSecret(false), 1800);
                }}
                className="text-xs text-orange-700 dark:text-orange-400 inline-flex items-center gap-1"
              >
                {copiedSecret ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedSecret ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              6-Digit Code
            </label>
            <input
              type="text"
              required
              maxLength={6}
              value={enrollCode}
              onChange={(e) => setEnrollCode(e.target.value)}
              placeholder="000000"
              className="w-full px-3 py-2 text-center text-lg font-mono tracking-widest rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEnrollOpen(false)}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              Activate MFA
            </button>
          </div>
        </form>
      </Modal>

      {/* Disable MFA Modal */}
      <Modal
        open={disableModal}
        onClose={() => setDisableModal(false)}
        title="Disable Multi-Factor Authentication"
        subtitle="Confirm your password and current 6-digit authenticator code."
      >
        <form onSubmit={handleDisableMfa} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Current Password
            </label>
            <input
              type="password"
              required
              value={disablePass}
              onChange={(e) => setDisablePass(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              6-Digit Authenticator Code
            </label>
            <input
              type="text"
              required
              maxLength={6}
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDisableModal(false)}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 text-white text-xs font-medium"
            >
              Disable MFA
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

import crypto from 'node:crypto';
import type { AppEnv, DbClient } from './db_adapter.ts';
import { getChallengeSigningSecret, getEnabledModulesMap, seedSampleBusinessData, writeAuditLog } from './db.ts';
import {
  PERMISSION_CATALOG,
  hasPermission,
  type PermissionAction,
  type PermissionMap,
  type PermissionModule,
} from './rbac.ts';
import { createExtraApiRouter } from './routes_extra.ts';
import { WebRouter, type ApiRequest, type ApiResponse, type NextFunction } from './web_router.ts';
import {
  buildOtpAuthUri,
  generateQrDataUrl,
  generateRecoveryCodes,
  generateSessionToken,
  generateTotpSecret,
  hashPassword,
  hashToken,
  signChallengeToken,
  verifyChallengeToken,
  verifyPassword,
  verifyRecoveryCode,
  verifyTotpCode,
} from './security.ts';

interface AuthUserRow {
  id: number;
  username: string;
  email: string;
  full_name: string;
  password_hash: string;
  role_id: number;
  is_active: number;
  mfa_enabled: number;
  mfa_secret: string | null;
  mfa_pending_secret: string | null;
  mfa_last_step: number | null;
  recovery_codes_json: string;
  failed_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
  role_slug: string;
  role_name: string;
  permissions_json: string;
  role_require_mfa: number;
  phone: string;
  job_title: string;
  department: string;
  timezone: string;
}

interface SecurityPolicyRow {
  id: number;
  max_failed_attempts: number;
  lockout_minutes: number;
  session_ttl_hours: number;
  enforce_mfa_global: number;
  min_password_length: number;
}

interface SystemSettingsRow {
  id: number;
  app_name: string;
  company_name: string;
  company_email: string;
  company_phone: string;
  company_address: string;
  tax_id: string;
  default_currency: string;
  default_tax_rate: number;
  default_payment_terms: string;
  default_incoterm: string;
  fiscal_year_start: number;
  date_format: string;
  updated_at: string;
}

export interface AuthenticatedRequest extends ApiRequest {
  authUser?: AuthUserRow;
  authPermissions?: PermissionMap;
  authSessionId?: number;
}

interface DocumentLineInput {
  productId?: number | null;
  ref?: string;
  label: string;
  qty: number;
  unitPrice: number;
  discountPct: number;
  taxRate: number;
}

function getClientIp(req: ApiRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function sanitizeUser(u: AuthUserRow) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    fullName: u.full_name,
    phone: u.phone ?? '',
    jobTitle: u.job_title ?? '',
    department: u.department ?? '',
    timezone: u.timezone ?? 'Asia/Manila',
    roleId: u.role_id,
    roleSlug: u.role_slug,
    roleName: u.role_name,
    roleRequireMfa: Boolean(u.role_require_mfa),
    isActive: Boolean(u.is_active),
    mfaEnabled: Boolean(u.mfa_enabled),
    lockedUntil: u.locked_until,
    lastLoginAt: u.last_login_at,
    createdAt: u.created_at,
  };
}

function parsePermissions(json: string): PermissionMap {
  try {
    return JSON.parse(json) as PermissionMap;
  } catch {
    return {};
  }
}

function computeLineTotals(lines: unknown[]): {
  sanitized: DocumentLineInput[];
  subtotalHt: number;
  taxTotal: number;
  totalTtc: number;
} {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('At least one line item is required.');
  }
  let subtotalHt = 0;
  let taxTotal = 0;
  const sanitized: DocumentLineInput[] = lines.map((raw) => {
    const item = raw as Record<string, unknown>;
    const label = String(item.label ?? '').trim();
    const qty = Number(item.qty);
    const unitPrice = Number(item.unitPrice);
    const discountPct = Math.min(100, Math.max(0, Number(item.discountPct ?? 0)));
    const taxRate = Math.min(100, Math.max(0, Number(item.taxRate ?? 0)));
    if (!label || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error('Each line item requires a valid description, positive quantity, and non-negative price.');
    }
    const lineNet = qty * unitPrice * (1 - discountPct / 100);
    const lineTax = lineNet * (taxRate / 100);
    subtotalHt += lineNet;
    taxTotal += lineTax;
    return {
      productId: item.productId ? Number(item.productId) : null,
      ref: String(item.ref ?? '').trim(),
      label,
      qty,
      unitPrice,
      discountPct,
      taxRate,
    };
  });
  return {
    sanitized,
    subtotalHt: Math.round(subtotalHt * 100) / 100,
    taxTotal: Math.round(taxTotal * 100) / 100,
    totalTtc: Math.round((subtotalHt + taxTotal) * 100) / 100,
  };
}

export function createApiRouter(db: DbClient, env: AppEnv): WebRouter {
  const router = new WebRouter();

  async function getSecurityPolicy(): Promise<SecurityPolicyRow> {
    return (await db.prepare('SELECT * FROM security_policy WHERE id = 1').get()) as unknown as SecurityPolicyRow;
  }

  async function getSystemSettings(): Promise<SystemSettingsRow> {
    return (await db.prepare('SELECT * FROM system_settings WHERE id = 1').get()) as unknown as SystemSettingsRow;
  }

  async function getUserWithRoleById(userId: number): Promise<AuthUserRow | undefined> {
    return (await db
      .prepare(
        `SELECT u.*, r.slug AS role_slug, r.name AS role_name, r.permissions_json, r.require_mfa AS role_require_mfa
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE u.id = ?`
      )
      .get(userId)) as unknown as AuthUserRow | undefined;
  }

  async function getUserWithRoleByIdentifier(identifier: string): Promise<AuthUserRow | undefined> {
    const clean = identifier.trim().toLowerCase();
    return (await db
      .prepare(
        `SELECT u.*, r.slug AS role_slug, r.name AS role_name, r.permissions_json, r.require_mfa AS role_require_mfa
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE LOWER(u.email) = ? OR LOWER(u.username) = ?`
      )
      .get(clean, clean)) as unknown as AuthUserRow | undefined;
  }

  async function createSessionForUser(user: AuthUserRow, req: ApiRequest): Promise<string> {
    const policy = await getSecurityPolicy();
    const { rawToken, tokenHash } = generateSessionToken();
    const expiresAt = new Date(Date.now() + policy.session_ttl_hours * 3600 * 1000).toISOString();
    const ua = String(req.headers['user-agent'] ?? '').slice(0, 200);
    await db
      .prepare(
        `INSERT INTO sessions (token_hash, user_id, ip_address, user_agent, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(tokenHash, user.id, getClientIp(req), ua, expiresAt);
    await db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(user.id);
    return rawToken;
  }

  async function authenticate(req: AuthenticatedRequest, res: ApiResponse, next: NextFunction): Promise<void> {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const rawToken = authHeader.slice(7).trim();
    if (!rawToken) {
      res.status(401).json({ error: 'Invalid Bearer token.' });
      return;
    }
    const tokenHash = hashToken(rawToken);
    const sessionRow = (await db
      .prepare(
        `SELECT id, user_id, expires_at, revoked
         FROM sessions
         WHERE token_hash = ?`
      )
      .get(tokenHash)) as unknown as
      | { id: number; user_id: number; expires_at: string; revoked: number }
      | undefined;

    if (!sessionRow || sessionRow.revoked === 1 || new Date(sessionRow.expires_at).getTime() < Date.now()) {
      res.status(401).json({ error: 'Session expired or revoked. Please sign in again.' });
      return;
    }

    const user = await getUserWithRoleById(sessionRow.user_id);
    if (!user || user.is_active !== 1) {
      res.status(401).json({ error: 'Account is inactive or unavailable.' });
      return;
    }
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      res.status(403).json({ error: 'Account is temporarily locked.' });
      return;
    }

    req.authUser = user;
    req.authPermissions = parsePermissions(user.permissions_json);
    req.authSessionId = sessionRow.id;
    await next();
  }

  function requirePermission(module: PermissionModule, action: PermissionAction) {
    return async (req: AuthenticatedRequest, res: ApiResponse, next: NextFunction): Promise<void> => {
      if (!req.authUser || !req.authPermissions) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }
      if (!hasPermission(req.authPermissions, module, action)) {
        await writeAuditLog(db, {
          userId: req.authUser.id,
          userEmail: req.authUser.email,
          action: 'PERMISSION_DENIED',
          module,
          details: `Denied ${action} on ${module} (role: ${req.authUser.role_name})`,
          ipAddress: getClientIp(req),
          severity: 'warning',
        });
        res.status(403).json({
          error: `Access denied: your role (${req.authUser.role_name}) lacks "${module}.${action}" permission.`,
        });
        return;
      }
      await next();
    };
  }

  async function nextDocRef(table: string, prefix: string): Promise<string> {
    const ym = new Date().toISOString().slice(2, 7).replace('-', '');
    const fullPrefix = `${prefix}${ym}-`;
    const allowed = new Set(['third_parties', 'proposals', 'sales_orders', 'purchase_orders', 'invoices', 'projects', 'tasks']);
    if (!allowed.has(table)) {
      throw new Error('Invalid reference sequence table');
    }
    const row = (await db
      .prepare(`SELECT ref FROM ${table} WHERE ref LIKE ? ORDER BY id DESC LIMIT 1`)
      .get(`${fullPrefix}%`)) as { ref: string } | undefined;
    let seq = 1;
    if (row?.ref) {
      const num = Number(row.ref.split('-').pop());
      if (Number.isFinite(num)) seq = num + 1;
    }
    return `${fullPrefix}${String(seq).padStart(4, '0')}`;
  }

  async function applyStockAdjustment(params: {
    productId: number;
    warehouseId: number;
    delta: number;
    movementType: 'in' | 'out' | 'transfer' | 'adjustment';
    reason: string;
    docRef: string;
    actorEmail: string;
  }): Promise<void> {
    const prod = (await db.prepare('SELECT id, product_type FROM products WHERE id = ?').get(params.productId)) as
      | { id: number; product_type: string }
      | undefined;
    if (!prod || prod.product_type !== 'product') return;

    const existing = (await db
      .prepare('SELECT quantity FROM stock_levels WHERE product_id = ? AND warehouse_id = ?')
      .get(params.productId, params.warehouseId)) as { quantity: number } | undefined;

    const currentQty = existing?.quantity ?? 0;
    const nextQty = currentQty + params.delta;
    if (nextQty < 0) {
      throw new Error(`Insufficient stock in selected warehouse (available: ${currentQty}, requested change: ${params.delta}).`);
    }

    await db
      .prepare(
        `INSERT INTO stock_levels (product_id, warehouse_id, quantity)
         VALUES (?, ?, ?)
         ON CONFLICT(product_id, warehouse_id) DO UPDATE SET quantity = excluded.quantity`
      )
      .run(params.productId, params.warehouseId, nextQty);

    await db
      .prepare(
        `INSERT INTO stock_movements (product_id, warehouse_id, movement_type, quantity_delta, reason, doc_ref, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.productId,
        params.warehouseId,
        params.movementType,
        params.delta,
        params.reason,
        params.docRef,
        params.actorEmail
      );
  }

  // ========================
  // AUTH & MFA ROUTES
  // ========================

  router.get('/auth/status', async (_req, res) => {
    const countRow = (await db.prepare('SELECT COUNT(*) as cnt FROM users').get()) as { cnt: number };
    const policy = (await getSecurityPolicy());
    const envPasscodeSet = Boolean(env.ADMIN_BOOT_PASSCODE && env.ADMIN_BOOT_PASSCODE.trim().length > 0);
    res.json({
      needsBootstrap: countRow.cnt === 0,
      hasEnvBootPasscode: envPasscodeSet,
      minPasswordLength: policy.min_password_length,
    });
  });

  router.post('/auth/bootstrap', async (req, res) => {
    const countRow = (await db.prepare('SELECT COUNT(*) as cnt FROM users').get()) as { cnt: number };
    if (countRow.cnt > 0) {
      res.status(409).json({ error: 'Workspace has already been initialized. Please sign in.' });
      return;
    }

    const { fullName, username, email, password, bootPasscode, enrollMfaNow, seedSampleData } = req.body ?? {};
    const envPasscode = (env.ADMIN_BOOT_PASSCODE ?? '').trim();
    if (envPasscode) {
      const provided = String(bootPasscode ?? '');
      const a = Buffer.from(provided, 'utf8');
      const b = Buffer.from(envPasscode, 'utf8');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        res.status(403).json({ error: 'Invalid admin setup passcode.' });
        return;
      }
    }

    const policy = (await getSecurityPolicy());
    const cleanEmail = String(email ?? '').trim().toLowerCase();
    const cleanUsername = String(username ?? '').trim().toLowerCase();
    const cleanName = String(fullName ?? '').trim();
    const rawPass = String(password ?? '');

    if (!cleanName || !cleanUsername || !cleanEmail.includes('@')) {
      res.status(400).json({ error: 'Full name, username, and a valid email address are required.' });
      return;
    }
    if (rawPass.length < policy.min_password_length) {
      res.status(400).json({ error: `Password must be at least ${policy.min_password_length} characters.` });
      return;
    }

    const superRole = (await db.prepare("SELECT id FROM roles WHERE slug = 'super_admin'").get()) as { id: number } | undefined;
    if (!superRole) {
      res.status(500).json({ error: 'System role definitions missing.' });
      return;
    }

    // If admin opted not to enroll MFA right at bootstrap, keep super_admin require_mfa configurable in Security settings
    const requireMfaNow = Boolean(enrollMfaNow);
    if (!requireMfaNow) {
      (await db.prepare("UPDATE roles SET require_mfa = 0 WHERE slug = 'super_admin'").run());
    }

    const pwHash = hashPassword(rawPass);
    const info = (await db
      .prepare(
        `INSERT INTO users (username, email, full_name, password_hash, role_id, is_active, mfa_enabled)
         VALUES (?, ?, ?, ?, ?, 1, 0)`
      )
      .run(cleanUsername, cleanEmail, cleanName, pwHash, superRole.id));

    const newUserId = Number(info.lastInsertRowid);
    if (seedSampleData !== false) {
      (await seedSampleBusinessData(db, cleanEmail));
    }

    (await writeAuditLog(db, {
      userId: newUserId,
      userEmail: cleanEmail,
      action: 'WORKSPACE_BOOTSTRAP',
      module: 'admin',
      entityRef: cleanUsername,
      details: `Super Admin claimed workspace${seedSampleData !== false ? ' with sample ERP data' : ''}.`,
      ipAddress: getClientIp(req),
      severity: 'info',
    }));

    const user = (await getUserWithRoleById(newUserId))!;
    if (requireMfaNow) {
      const secret = await getChallengeSigningSecret(db, env);
      const enrollToken = signChallengeToken(user.id, 'mfa_enroll', 600, secret);
      res.json({
        status: 'mfa_enrollment_required',
        enrollToken,
        userPreview: { fullName: user.full_name, email: user.email, roleName: user.role_name },
      });
      return;
    }

    const token = (await createSessionForUser(user, req));
    res.json({
      status: 'authenticated',
      token,
      user: sanitizeUser(user),
      permissions: parsePermissions(user.permissions_json),
      policy,
      enabledModules: (await getEnabledModulesMap(db)),
      systemSettings: (await getSystemSettings()),
    });
  });

  router.post('/auth/login', async (req, res) => {
    const { identifier, password } = req.body ?? {};
    const idStr = String(identifier ?? '').trim();
    const passStr = String(password ?? '');
    if (!idStr || !passStr) {
      res.status(400).json({ error: 'Email or username and password are required.' });
      return;
    }

    const policy = (await getSecurityPolicy());
    const user = (await getUserWithRoleByIdentifier(idStr));
    if (!user) {
      (await writeAuditLog(db, {
        userEmail: idStr.toLowerCase(),
        action: 'LOGIN_FAILED',
        module: 'admin',
        details: 'Unknown user identifier',
        ipAddress: getClientIp(req),
        severity: 'warning',
      }));
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }

    if (user.is_active !== 1) {
      res.status(403).json({ error: 'Account has been deactivated by an administrator.' });
      return;
    }

    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      res.status(423).json({
        error: `Account locked due to failed attempts until ${new Date(user.locked_until).toLocaleTimeString()}.`,
      });
      return;
    }

    if (!verifyPassword(passStr, user.password_hash)) {
      const nextAttempts = user.failed_attempts + 1;
      let lockedUntil: string | null = null;
      if (nextAttempts >= policy.max_failed_attempts) {
        lockedUntil = new Date(Date.now() + policy.lockout_minutes * 60 * 1000).toISOString();
      }
      (await db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(
        nextAttempts,
        lockedUntil,
        user.id
      ));
      (await writeAuditLog(db, {
        userId: user.id,
        userEmail: user.email,
        action: lockedUntil ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
        module: 'admin',
        details: `Failed login attempt ${nextAttempts}/${policy.max_failed_attempts}`,
        ipAddress: getClientIp(req),
        severity: lockedUntil ? 'critical' : 'warning',
      }));
      res.status(401).json({
        error: lockedUntil
          ? `Too many failed attempts. Account locked for ${policy.lockout_minutes} minutes.`
          : 'Invalid credentials.',
      });
      return;
    }

    (await db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id));

    const mfaRequired =
      user.mfa_enabled === 1 || user.role_require_mfa === 1 || policy.enforce_mfa_global === 1;

    if (mfaRequired && user.mfa_enabled === 1 && user.mfa_secret) {
      const secret = await getChallengeSigningSecret(db, env);
      const challengeToken = signChallengeToken(user.id, 'mfa_verify', 300, secret);
      res.json({
        status: 'mfa_required',
        challengeToken,
        userPreview: { fullName: user.full_name, email: user.email, roleName: user.role_name },
      });
      return;
    }

    if (mfaRequired && user.mfa_enabled === 0) {
      const secret = await getChallengeSigningSecret(db, env);
      const enrollToken = signChallengeToken(user.id, 'mfa_enroll', 600, secret);
      res.json({
        status: 'mfa_enrollment_required',
        enrollToken,
        userPreview: { fullName: user.full_name, email: user.email, roleName: user.role_name },
      });
      return;
    }

    const token = (await createSessionForUser(user, req));
    (await writeAuditLog(db, {
      userId: user.id,
      userEmail: user.email,
      action: 'LOGIN_SUCCESS',
      module: 'admin',
      details: `Signed in as ${user.role_name}`,
      ipAddress: getClientIp(req),
      severity: 'info',
    }));

    res.json({
      status: 'authenticated',
      token,
      user: sanitizeUser(user),
      permissions: parsePermissions(user.permissions_json),
      policy,
      enabledModules: (await getEnabledModulesMap(db)),
      systemSettings: (await getSystemSettings()),
    });
  });

  router.post('/auth/mfa/verify', async (req, res) => {
    const { challengeToken, code, isRecoveryCode } = req.body ?? {};
    const secret = await getChallengeSigningSecret(db, env);
    const payload = verifyChallengeToken(String(challengeToken ?? ''), 'mfa_verify', secret);
    if (!payload) {
      res.status(401).json({ error: 'MFA challenge expired or invalid. Please sign in again.' });
      return;
    }

    const user = (await getUserWithRoleById(payload.sub));
    if (!user || user.is_active !== 1 || !user.mfa_secret) {
      res.status(401).json({ error: 'MFA verification unavailable.' });
      return;
    }

    if (isRecoveryCode) {
      let hashes: string[] = [];
      try {
        hashes = JSON.parse(user.recovery_codes_json) as string[];
      } catch {
        hashes = [];
      }
      const matchIdx = verifyRecoveryCode(String(code ?? ''), hashes);
      if (matchIdx === -1) {
        (await writeAuditLog(db, {
          userId: user.id,
          userEmail: user.email,
          action: 'MFA_RECOVERY_FAILED',
          module: 'admin',
          details: 'Invalid recovery code attempt',
          ipAddress: getClientIp(req),
          severity: 'warning',
        }));
        res.status(401).json({ error: 'Invalid or already used recovery code.' });
        return;
      }
      hashes.splice(matchIdx, 1);
      (await db.prepare('UPDATE users SET recovery_codes_json = ? WHERE id = ?').run(JSON.stringify(hashes), user.id));
      (await writeAuditLog(db, {
        userId: user.id,
        userEmail: user.email,
        action: 'MFA_RECOVERY_USED',
        module: 'admin',
        details: `Used single-use recovery code (${hashes.length} remaining)`,
        ipAddress: getClientIp(req),
        severity: 'warning',
      }));
    } else {
      const check = verifyTotpCode(user.mfa_secret, String(code ?? ''), user.mfa_last_step);
      if (!check.valid) {
        (await writeAuditLog(db, {
          userId: user.id,
          userEmail: user.email,
          action: 'MFA_FAILED',
          module: 'admin',
          details: 'Invalid TOTP verification code',
          ipAddress: getClientIp(req),
          severity: 'warning',
        }));
        res.status(401).json({ error: 'Invalid 6-digit authenticator code.' });
        return;
      }
      (await db.prepare('UPDATE users SET mfa_last_step = ? WHERE id = ?').run(check.step, user.id));
    }

    const token = (await createSessionForUser(user, req));
    const policy = (await getSecurityPolicy());
    (await writeAuditLog(db, {
      userId: user.id,
      userEmail: user.email,
      action: 'LOGIN_MFA_SUCCESS',
      module: 'admin',
      details: `MFA verified sign-in (${user.role_name})`,
      ipAddress: getClientIp(req),
      severity: 'info',
    }));

    res.json({
      status: 'authenticated',
      token,
      user: sanitizeUser(user),
      permissions: parsePermissions(user.permissions_json),
      policy,
      enabledModules: (await getEnabledModulesMap(db)),
      systemSettings: (await getSystemSettings()),
    });
  });

  async function resolveEnrollmentTarget(req: AuthenticatedRequest): Promise<AuthUserRow | null> {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const rawToken = authHeader.slice(7).trim();
      const tokenHash = hashToken(rawToken);
      const sess = (await db
        .prepare('SELECT user_id, expires_at, revoked FROM sessions WHERE token_hash = ?')
        .get(tokenHash)) as unknown as { user_id: number; expires_at: string; revoked: number } | undefined;
      if (sess && sess.revoked === 0 && new Date(sess.expires_at).getTime() > Date.now()) {
        return (await getUserWithRoleById(sess.user_id)) ?? null;
      }
    }
    const enrollToken = String((req.body as Record<string, unknown>)?.enrollToken ?? '');
    if (enrollToken) {
      const secret = await getChallengeSigningSecret(db, env);
      const payload = verifyChallengeToken(enrollToken, 'mfa_enroll', secret);
      if (payload) {
        return (await getUserWithRoleById(payload.sub)) ?? null;
      }
    }
    return null;
  }

  router.post('/auth/mfa/enroll-start', async (req: AuthenticatedRequest, res) => {
    const user = (await resolveEnrollmentTarget(req));
    if (!user || user.is_active !== 1) {
      res.status(401).json({ error: 'Authorization required to begin MFA enrollment.' });
      return;
    }

    const pendingSecret = generateTotpSecret();
    (await db.prepare('UPDATE users SET mfa_pending_secret = ? WHERE id = ?').run(pendingSecret, user.id));
    const settings = (await getSystemSettings());
    const otpAuthUri = buildOtpAuthUri(pendingSecret, user.email, settings?.app_name || 'KSCAT-ERP');
    const qrDataUrl = await generateQrDataUrl(otpAuthUri);
    res.json({
      qrDataUrl,
      manualSecret: pendingSecret,
      otpAuthUri,
    });
  });

  router.post('/auth/mfa/enroll-confirm', async (req: AuthenticatedRequest, res) => {
    const user = (await resolveEnrollmentTarget(req));
    if (!user || user.is_active !== 1) {
      res.status(401).json({ error: 'Authorization required to confirm MFA enrollment.' });
      return;
    }
    if (!user.mfa_pending_secret) {
      res.status(400).json({ error: 'No pending MFA enrollment found. Start enrollment again.' });
      return;
    }

    const { code, enrollToken } = req.body ?? {};
    const check = verifyTotpCode(user.mfa_pending_secret, String(code ?? ''), null);
    if (!check.valid) {
      res.status(400).json({ error: 'Invalid 6-digit verification code. Check your device clock and try again.' });
      return;
    }

    const { plainCodes, hashedCodes } = generateRecoveryCodes(8);
    (await db.prepare(
      `UPDATE users
       SET mfa_enabled = 1,
           mfa_secret = mfa_pending_secret,
           mfa_pending_secret = NULL,
           mfa_last_step = ?,
           recovery_codes_json = ?
       WHERE id = ?`
    ).run(check.step, JSON.stringify(hashedCodes), user.id));

    (await writeAuditLog(db, {
      userId: user.id,
      userEmail: user.email,
      action: 'MFA_ENROLLED',
      module: 'admin',
      details: 'TOTP Multi-Factor Authentication enabled with 8 recovery codes',
      ipAddress: getClientIp(req),
      severity: 'info',
    }));

    const refreshed = (await getUserWithRoleById(user.id))!;
    if (enrollToken) {
      const token = (await createSessionForUser(refreshed, req));
      const policy = (await getSecurityPolicy());
      res.json({
        status: 'authenticated',
        token,
        user: sanitizeUser(refreshed),
        permissions: parsePermissions(refreshed.permissions_json),
        policy,
        recoveryCodes: plainCodes,
        enabledModules: (await getEnabledModulesMap(db)),
        systemSettings: (await getSystemSettings()),
      });
      return;
    }

    res.json({
      mfaEnabled: true,
      user: sanitizeUser(refreshed),
      recoveryCodes: plainCodes,
    });
  });

  router.post('/auth/mfa/disable', authenticate, async (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const policy = (await getSecurityPolicy());
    if (policy.enforce_mfa_global === 1 || user.role_require_mfa === 1) {
      res.status(403).json({
        error: `MFA cannot be disabled because your role (${user.role_name}) or organization policy requires it.`,
      });
      return;
    }

    const { password, code } = req.body ?? {};
    if (!verifyPassword(String(password ?? ''), user.password_hash)) {
      res.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }
    if (user.mfa_secret) {
      const check = verifyTotpCode(user.mfa_secret, String(code ?? ''), user.mfa_last_step);
      if (!check.valid) {
        res.status(401).json({ error: 'Valid 6-digit authenticator code required to disable MFA.' });
        return;
      }
    }

    (await db.prepare(
      `UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, mfa_pending_secret = NULL, recovery_codes_json = '[]' WHERE id = ?`
    ).run(user.id));

    (await writeAuditLog(db, {
      userId: user.id,
      userEmail: user.email,
      action: 'MFA_DISABLED',
      module: 'admin',
      details: 'User disabled TOTP Multi-Factor Authentication',
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));

    res.json({ mfaEnabled: false });
  });

  router.post('/auth/mfa/regenerate-recovery', authenticate, async (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    if (user.mfa_enabled !== 1) {
      res.status(400).json({ error: 'MFA must be enabled before generating recovery codes.' });
      return;
    }
    const { password } = req.body ?? {};
    if (!verifyPassword(String(password ?? ''), user.password_hash)) {
      res.status(401).json({ error: 'Password verification failed.' });
      return;
    }
    const { plainCodes, hashedCodes } = generateRecoveryCodes(8);
    (await db.prepare('UPDATE users SET recovery_codes_json = ? WHERE id = ?').run(JSON.stringify(hashedCodes), user.id));
    (await writeAuditLog(db, {
      userId: user.id,
      userEmail: user.email,
      action: 'MFA_RECOVERY_REGENERATED',
      module: 'admin',
      details: 'Regenerated 8 single-use recovery codes',
      ipAddress: getClientIp(req),
      severity: 'info',
    }));
    res.json({ recoveryCodes: plainCodes });
  });

  router.get('/auth/me', authenticate, async (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const policy = (await getSecurityPolicy());
    const sessions = (await db
      .prepare(
        `SELECT id, ip_address, user_agent, created_at, expires_at
         FROM sessions
         WHERE user_id = ? AND revoked = 0 AND expires_at > datetime('now')
         ORDER BY created_at DESC`
      )
      .all(user.id)) as unknown as {
      id: number;
      ip_address: string;
      user_agent: string;
      created_at: string;
      expires_at: string;
    }[];

    let remainingRecoveryCodes = 0;
    try {
      remainingRecoveryCodes = (JSON.parse(user.recovery_codes_json) as string[]).length;
    } catch {
      remainingRecoveryCodes = 0;
    }

    res.json({
      user: sanitizeUser(user),
      permissions: req.authPermissions,
      policy,
      enabledModules: (await getEnabledModulesMap(db)),
      systemSettings: (await getSystemSettings()),
      remainingRecoveryCodes,
      currentSessionId: req.authSessionId,
      sessions: sessions.map((s) => ({
        id: s.id,
        ipAddress: s.ip_address,
        userAgent: s.user_agent,
        createdAt: s.created_at,
        expiresAt: s.expires_at,
        isCurrent: s.id === req.authSessionId,
      })),
    });
  });

  router.put('/auth/profile', authenticate, async (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const { fullName, username, email, phone, jobTitle, department, timezone } = req.body ?? {};
    const cleanName = String(fullName ?? '').trim();
    const cleanUsername = String(username ?? '').trim().toLowerCase();
    const cleanEmail = String(email ?? '').trim().toLowerCase();

    if (!cleanName || !cleanUsername || !cleanEmail.includes('@')) {
      res.status(400).json({ error: 'Full name, username, and a valid email address are required.' });
      return;
    }

    try {
      (await db.prepare(
        `UPDATE users
         SET full_name = ?, username = ?, email = ?, phone = ?, job_title = ?, department = ?, timezone = ?
         WHERE id = ?`
      ).run(
        cleanName,
        cleanUsername,
        cleanEmail,
        String(phone ?? '').trim(),
        String(jobTitle ?? '').trim(),
        String(department ?? '').trim(),
        String(timezone ?? 'Asia/Manila').trim() || 'Asia/Manila',
        user.id
      ));

      (await writeAuditLog(db, {
        userId: user.id,
        userEmail: cleanEmail,
        action: 'UPDATE_PROFILE',
        module: 'admin',
        entityRef: cleanUsername,
        details: `Updated personal user profile (${cleanName})`,
        ipAddress: getClientIp(req),
        severity: 'info',
      }));

      const updated = (await getUserWithRoleById(user.id))!;
      res.json({ user: sanitizeUser(updated) });
    } catch {
      res.status(409).json({ error: 'Username or email address is already in use.' });
    }
  });

  router.post('/auth/change-password', authenticate, async (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    const policy = (await getSecurityPolicy());
    const { currentPassword, newPassword } = req.body ?? {};
    if (!verifyPassword(String(currentPassword ?? ''), user.password_hash)) {
      res.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }
    const nextPass = String(newPassword ?? '');
    if (nextPass.length < policy.min_password_length) {
      res.status(400).json({ error: `New password must be at least ${policy.min_password_length} characters.` });
      return;
    }
    (await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(nextPass), user.id));
    (await writeAuditLog(db, {
      userId: user.id,
      userEmail: user.email,
      action: 'CHANGE_PASSWORD',
      module: 'admin',
      entityRef: user.username,
      details: 'User changed account password',
      ipAddress: getClientIp(req),
      severity: 'info',
    }));
    res.json({ ok: true });
  });

  router.post('/auth/logout', authenticate, async (req: AuthenticatedRequest, res) => {
    if (req.authSessionId) {
      (await db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(req.authSessionId));
    }
    (await writeAuditLog(db, {
      userId: req.authUser?.id,
      userEmail: req.authUser?.email ?? 'unknown',
      action: 'LOGOUT',
      module: 'admin',
      details: 'User signed out',
      ipAddress: getClientIp(req),
      severity: 'info',
    }));
    res.json({ ok: true });
  });

  router.delete('/auth/sessions/:id', authenticate, async (req: AuthenticatedRequest, res) => {
    const sessionId = Number(req.params.id);
    if (!Number.isFinite(sessionId)) {
      res.status(400).json({ error: 'Invalid session ID.' });
      return;
    }
    const target = (await db.prepare('SELECT id, user_id FROM sessions WHERE id = ?').get(sessionId)) as
      | { id: number; user_id: number }
      | undefined;
    if (!target) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }
    const isAdmin = hasPermission(req.authPermissions, 'admin', 'unlock_users');
    if (target.user_id !== req.authUser!.id && !isAdmin) {
      res.status(403).json({ error: 'Cannot revoke another user session.' });
      return;
    }
    (await db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(sessionId));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'SESSION_REVOKED',
      module: 'admin',
      entityRef: `SESSION-${sessionId}`,
      details: `Revoked session #${sessionId}`,
      ipAddress: getClientIp(req),
      severity: 'info',
    }));
    res.json({ ok: true });
  });

  // ========================
  // DASHBOARD
  // ========================

  router.get('/dashboard', authenticate, requirePermission('dashboard', 'read'), async (_req, res) => {
    const kpiInvoices = (await db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN invoice_type = 'customer' AND status != 'cancelled' THEN total_ttc ELSE 0 END), 0) AS total_billed,
           COALESCE(SUM(CASE WHEN invoice_type = 'customer' AND status IN ('validated', 'partial') THEN total_ttc - amount_paid ELSE 0 END), 0) AS open_receivables,
           COALESCE(SUM(CASE WHEN invoice_type = 'supplier' AND status IN ('validated', 'partial') THEN total_ttc - amount_paid ELSE 0 END), 0) AS open_payables
         FROM invoices`
      )
      .get()) as { total_billed: number; open_receivables: number; open_payables: number };

    const proposalStats = (await db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(total_ttc), 0) AS total
         FROM proposals WHERE status IN ('draft', 'validated')`
      )
      .get()) as { count: number; total: number };

    const bankTotal = (await db
      .prepare("SELECT COALESCE(SUM(balance), 0) AS cash_balance FROM bank_accounts WHERE status = 'active'")
      .get()) as { cash_balance: number };

    const lowStock = (await db
      .prepare(
        `SELECT p.id, p.ref, p.name, p.min_stock, COALESCE(SUM(sl.quantity), 0) AS total_stock
         FROM products p
         LEFT JOIN stock_levels sl ON sl.product_id = p.id
         WHERE p.product_type = 'product'
         GROUP BY p.id
         HAVING total_stock < p.min_stock
         ORDER BY (p.min_stock - total_stock) DESC
         LIMIT 6`
      )
      .all());

    const openProposals = (await db
      .prepare(
        `SELECT p.id, p.ref, p.title, p.total_ttc, p.status, p.valid_until, tp.name AS customer_name
         FROM proposals p
         JOIN third_parties tp ON tp.id = p.third_party_id
         WHERE p.status IN ('draft', 'validated', 'signed')
         ORDER BY p.id DESC LIMIT 5`
      )
      .all());

    const pendingInvoices = (await db
      .prepare(
        `SELECT i.id, i.ref, i.invoice_type, i.total_ttc, i.amount_paid, i.due_date, i.status, tp.name AS party_name
         FROM invoices i
         JOIN third_parties tp ON tp.id = i.third_party_id
         WHERE i.status IN ('validated', 'partial')
         ORDER BY i.due_date ASC LIMIT 6`
      )
      .all());

    const activeProjects = (await db
      .prepare(
        `SELECT pr.id, pr.ref, pr.title, pr.progress, pr.due_date, pr.status, tp.name AS customer_name
         FROM projects pr
         LEFT JOIN third_parties tp ON tp.id = pr.third_party_id
         WHERE pr.status IN ('active', 'on_hold')
         ORDER BY pr.due_date ASC LIMIT 5`
      )
      .all());

    const recentLogs = (await db
      .prepare(
        `SELECT id, user_email, action, module, entity_ref, details, severity, created_at
         FROM audit_logs
         ORDER BY id DESC LIMIT 8`
      )
      .all());

    const txMonthly = (await db
      .prepare(
        `SELECT substr(tx_date, 1, 7) AS month,
                COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END), 0) AS inflow,
                COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END), 0) AS outflow
         FROM bank_transactions
         GROUP BY substr(tx_date, 1, 7)
         ORDER BY month ASC
         LIMIT 6`
      )
      .all());

    res.json({
      kpis: {
        totalBilled: kpiInvoices.total_billed,
        openReceivables: kpiInvoices.open_receivables,
        openPayables: kpiInvoices.open_payables,
        openProposalsCount: proposalStats.count,
        openProposalsValue: proposalStats.total,
        cashBalance: bankTotal.cash_balance,
      },
      lowStock,
      openProposals,
      pendingInvoices,
      activeProjects,
      recentLogs,
      cashflowSeries: txMonthly,
    });
  });

  // ========================
  // THIRD PARTIES & CONTACTS (CRM)
  // ========================

  router.get('/third-parties', authenticate, requirePermission('crm', 'read'), async (_req, res) => {
    const parties = (await db.prepare('SELECT * FROM third_parties ORDER BY id DESC').all());
    const contacts = (await db
      .prepare(
        `SELECT c.*, tp.name AS company_name, tp.ref AS company_ref
         FROM contacts c
         JOIN third_parties tp ON tp.id = c.third_party_id
         ORDER BY c.is_primary DESC, c.id DESC`
      )
      .all());
    res.json({ thirdParties: parties, contacts });
  });

  router.get('/third-parties/:id', authenticate, requirePermission('crm', 'read'), async (req, res) => {
    const id = Number(req.params.id);
    const party = (await db.prepare('SELECT * FROM third_parties WHERE id = ?').get(id));
    if (!party) {
      res.status(404).json({ error: 'Third party not found.' });
      return;
    }
    const contacts = (await db.prepare('SELECT * FROM contacts WHERE third_party_id = ?').all(id));
    const proposals = (await db.prepare('SELECT * FROM proposals WHERE third_party_id = ? ORDER BY id DESC').all(id));
    const invoices = (await db.prepare('SELECT * FROM invoices WHERE third_party_id = ? ORDER BY id DESC').all(id));
    const projects = (await db.prepare('SELECT * FROM projects WHERE third_party_id = ? ORDER BY id DESC').all(id));
    res.json({ party, contacts, proposals, invoices, projects });
  });

  router.post('/third-parties', authenticate, requirePermission('crm', 'write'), async (req: AuthenticatedRequest, res) => {
    const {
      name,
      partyType = 'customer',
      email = '',
      phone = '',
      website = '',
      address = '',
      city = '',
      country = '',
      taxId = '',
      paymentTerms = 'Net 30',
      creditLimit = 25000,
      notes = '',
      socialJson = '{}',
    } = req.body ?? {};
    const cleanName = String(name ?? '').trim();
    if (!cleanName) {
      res.status(400).json({ error: 'Company or organization name is required.' });
      return;
    }
    const allowedTypes = new Set(['customer', 'prospect', 'supplier', 'customer_supplier']);
    if (!allowedTypes.has(partyType)) {
      res.status(400).json({ error: 'Invalid third-party type.' });
      return;
    }
    const prefixMap: Record<string, string> = {
      customer: 'CU',
      prospect: 'PR',
      supplier: 'SU',
      customer_supplier: 'CS',
    };
    const ref = (await nextDocRef('third_parties', prefixMap[partyType]));
    const info = (await db
      .prepare(
        `INSERT INTO third_parties (ref, name, party_type, email, phone, website, address, city, country, tax_id, payment_terms, credit_limit, status, notes, social_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
      )
      .run(
        ref,
        cleanName,
        partyType,
        String(email).trim(),
        String(phone).trim(),
        String(website).trim(),
        String(address).trim(),
        String(city).trim(),
        String(country).trim(),
        String(taxId).trim(),
        String(paymentTerms).trim() || 'Net 30',
        Number(creditLimit) || 0,
        String(notes).trim(),
        typeof socialJson === 'string' ? socialJson : JSON.stringify(socialJson ?? {})
      ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_THIRD_PARTY',
      module: 'crm',
      entityRef: ref,
      details: `Created ${partyType}: ${cleanName}`,
      ipAddress: getClientIp(req),
    }));
    res.status(201).json((await db.prepare('SELECT * FROM third_parties WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/third-parties/:id', authenticate, requirePermission('crm', 'write'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM third_parties WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Third party not found.' });
      return;
    }
    const {
      name,
      partyType,
      email,
      phone,
      website,
      address,
      city,
      country,
      taxId,
      paymentTerms,
      creditLimit,
      status,
      notes,
      socialJson,
    } = req.body ?? {};
    (await db.prepare(
      `UPDATE third_parties
       SET name = COALESCE(?, name),
           party_type = COALESCE(?, party_type),
           email = COALESCE(?, email),
           phone = COALESCE(?, phone),
           website = COALESCE(?, website),
           address = COALESCE(?, address),
           city = COALESCE(?, city),
           country = COALESCE(?, country),
           tax_id = COALESCE(?, tax_id),
           payment_terms = COALESCE(?, payment_terms),
           credit_limit = COALESCE(?, credit_limit),
           status = COALESCE(?, status),
           notes = COALESCE(?, notes),
           social_json = COALESCE(?, social_json)
       WHERE id = ?`
    ).run(
      name ? String(name).trim() : null,
      partyType ?? null,
      email !== undefined ? String(email).trim() : null,
      phone !== undefined ? String(phone).trim() : null,
      website !== undefined ? String(website).trim() : null,
      address !== undefined ? String(address).trim() : null,
      city !== undefined ? String(city).trim() : null,
      country !== undefined ? String(country).trim() : null,
      taxId !== undefined ? String(taxId).trim() : null,
      paymentTerms !== undefined ? String(paymentTerms).trim() : null,
      creditLimit !== undefined ? Number(creditLimit) : null,
      status ?? null,
      notes !== undefined ? String(notes).trim() : null,
      socialJson !== undefined ? (typeof socialJson === 'string' ? socialJson : JSON.stringify(socialJson ?? {})) : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_THIRD_PARTY',
      module: 'crm',
      entityRef: existing.ref,
      details: `Updated third party ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM third_parties WHERE id = ?').get(id)));
  });

  router.delete('/third-parties/:id', authenticate, requirePermission('crm', 'delete'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, name FROM third_parties WHERE id = ?').get(id)) as
      | { ref: string; name: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Third party not found.' });
      return;
    }
    try {
      (await db.prepare('DELETE FROM third_parties WHERE id = ?').run(id));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'DELETE_THIRD_PARTY',
        module: 'crm',
        entityRef: existing.ref,
        details: `Deleted ${existing.name}`,
        ipAddress: getClientIp(req),
        severity: 'warning',
      }));
      res.json({ ok: true });
    } catch {
      res.status(409).json({ error: 'Cannot delete third party with linked proposals, orders, or invoices.' });
    }
  });

  router.post('/contacts', authenticate, requirePermission('crm', 'write'), async (req: AuthenticatedRequest, res) => {
    const { thirdPartyId, firstName, lastName, jobTitle = '', email = '', phone = '', isPrimary = false } = req.body ?? {};
    if (!thirdPartyId || !String(firstName ?? '').trim() || !String(lastName ?? '').trim()) {
      res.status(400).json({ error: 'Company, first name, and last name are required.' });
      return;
    }
    const info = (await db
      .prepare(
        `INSERT INTO contacts (third_party_id, first_name, last_name, job_title, email, phone, is_primary)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        Number(thirdPartyId),
        String(firstName).trim(),
        String(lastName).trim(),
        String(jobTitle).trim(),
        String(email).trim(),
        String(phone).trim(),
        isPrimary ? 1 : 0
      ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_CONTACT',
      module: 'crm',
      details: `Added contact ${firstName} ${lastName}`,
      ipAddress: getClientIp(req),
    }));
    res.status(201).json((await db.prepare('SELECT * FROM contacts WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/contacts/:id', authenticate, requirePermission('crm', 'write'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM contacts WHERE id = ?').get(id)) as
      | { id: number; first_name: string; last_name: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Contact not found.' });
      return;
    }
    const { thirdPartyId, firstName, lastName, jobTitle, email, phone, isPrimary } = req.body ?? {};
    (await db.prepare(
      `UPDATE contacts
       SET third_party_id = COALESCE(?, third_party_id),
           first_name = COALESCE(?, first_name),
           last_name = COALESCE(?, last_name),
           job_title = COALESCE(?, job_title),
           email = COALESCE(?, email),
           phone = COALESCE(?, phone),
           is_primary = COALESCE(?, is_primary)
       WHERE id = ?`
    ).run(
      thirdPartyId !== undefined ? Number(thirdPartyId) : null,
      firstName ? String(firstName).trim() : null,
      lastName ? String(lastName).trim() : null,
      jobTitle !== undefined ? String(jobTitle).trim() : null,
      email !== undefined ? String(email).trim() : null,
      phone !== undefined ? String(phone).trim() : null,
      isPrimary !== undefined ? (isPrimary ? 1 : 0) : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_CONTACT',
      module: 'crm',
      entityRef: `CNT-${id}`,
      details: `Updated contact ${firstName ?? existing.first_name} ${lastName ?? existing.last_name}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM contacts WHERE id = ?').get(id)));
  });

  router.delete('/contacts/:id', authenticate, requirePermission('crm', 'delete'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = (await db
      .prepare('SELECT first_name, last_name, email FROM contacts WHERE id = ?')
      .get(id)) as { first_name: string; last_name: string; email: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Contact not found.' });
      return;
    }
    (await db.prepare('DELETE FROM contacts WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_CONTACT',
      module: 'crm',
      entityRef: `CNT-${id}`,
      details: `Deleted contact ${existing.first_name} ${existing.last_name} (${existing.email || 'no email'})`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  // ========================
  // PRODUCTS, WAREHOUSES & STOCK
  // ========================

  router.get('/products', authenticate, requirePermission('products', 'read'), async (_req, res) => {
    const products = (await db
      .prepare(
        `SELECT p.*, COALESCE(SUM(sl.quantity), 0) AS total_stock
         FROM products p
         LEFT JOIN stock_levels sl ON sl.product_id = p.id
         GROUP BY p.id
         ORDER BY p.id DESC`
      )
      .all());
    const stockLevels = (await db
      .prepare(
        `SELECT sl.*, w.ref AS warehouse_ref, w.name AS warehouse_name
         FROM stock_levels sl
         JOIN warehouses w ON w.id = sl.warehouse_id`
      )
      .all());
    const warehouses = (await db.prepare('SELECT * FROM warehouses ORDER BY id ASC').all());
    const movements = (await db
      .prepare(
        `SELECT sm.*, p.ref AS product_ref, p.name AS product_name, w.name AS warehouse_name
         FROM stock_movements sm
         JOIN products p ON p.id = sm.product_id
         JOIN warehouses w ON w.id = sm.warehouse_id
         ORDER BY sm.id DESC
         LIMIT 60`
      )
      .all());
    res.json({ products, stockLevels, warehouses, movements });
  });

  router.post('/products', authenticate, requirePermission('products', 'write'), async (req: AuthenticatedRequest, res) => {
    const {
      ref,
      name,
      productType = 'product',
      category = 'General',
      description = '',
      costPrice = 0,
      sellPrice = 0,
      taxRate = 20,
      minStock = 10,
      barcode = '',
      initialStock = 0,
      warehouseId,
    } = req.body ?? {};
    const cleanRef = String(ref ?? '').trim().toUpperCase();
    const cleanName = String(name ?? '').trim();
    if (!cleanRef || !cleanName) {
      res.status(400).json({ error: 'Product SKU/Ref and Name are required.' });
      return;
    }
    try {
      (await db.exec('BEGIN'));
      const info = (await db
        .prepare(
          `INSERT INTO products (ref, name, product_type, category, description, cost_price, sell_price, tax_rate, min_stock, barcode)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          cleanRef,
          cleanName,
          productType === 'service' ? 'service' : 'product',
          String(category).trim() || 'General',
          String(description).trim(),
          Number(costPrice) || 0,
          Number(sellPrice) || 0,
          Number(taxRate) || 0,
          Number(minStock) || 0,
          String(barcode).trim()
        ));
      const productId = Number(info.lastInsertRowid);
      if (productType !== 'service' && Number(initialStock) > 0 && warehouseId) {
        (await applyStockAdjustment({
          productId,
          warehouseId: Number(warehouseId),
          delta: Number(initialStock),
          movementType: 'in',
          reason: 'Initial catalog stock',
          docRef: cleanRef,
          actorEmail: req.authUser!.email,
        }));
      }
      (await db.exec('COMMIT'));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'CREATE_PRODUCT',
        module: 'products',
        entityRef: cleanRef,
        details: `Created ${productType}: ${cleanName}`,
        ipAddress: getClientIp(req),
      }));
      res.status(201).json((await db.prepare('SELECT * FROM products WHERE id = ?').get(productId)));
    } catch (err) {
      (await db.exec('ROLLBACK'));
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to create product.' });
    }
  });

  router.put('/products/:id', authenticate, requirePermission('products', 'write'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM products WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }
    const { name, productType, category, description, costPrice, sellPrice, taxRate, minStock, barcode } = req.body ?? {};
    (await db.prepare(
      `UPDATE products
       SET name = COALESCE(?, name),
           product_type = COALESCE(?, product_type),
           category = COALESCE(?, category),
           description = COALESCE(?, description),
           cost_price = COALESCE(?, cost_price),
           sell_price = COALESCE(?, sell_price),
           tax_rate = COALESCE(?, tax_rate),
           min_stock = COALESCE(?, min_stock),
           barcode = COALESCE(?, barcode)
       WHERE id = ?`
    ).run(
      name ? String(name).trim() : null,
      productType === 'product' || productType === 'service' ? productType : null,
      category ? String(category).trim() : null,
      description !== undefined ? String(description).trim() : null,
      costPrice !== undefined ? Number(costPrice) : null,
      sellPrice !== undefined ? Number(sellPrice) : null,
      taxRate !== undefined ? Number(taxRate) : null,
      minStock !== undefined ? Number(minStock) : null,
      barcode !== undefined ? String(barcode).trim() : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_PRODUCT',
      module: 'products',
      entityRef: existing.ref,
      details: `Updated product ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM products WHERE id = ?').get(id)));
  });

  router.delete('/products/:id', authenticate, requirePermission('products', 'delete'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, name FROM products WHERE id = ?').get(id)) as
      | { ref: string; name: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }
    try {
      (await db.prepare('DELETE FROM products WHERE id = ?').run(id));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'DELETE_PRODUCT',
        module: 'products',
        entityRef: existing.ref,
        details: `Deleted product ${existing.name}`,
        ipAddress: getClientIp(req),
        severity: 'warning',
      }));
      res.json({ ok: true });
    } catch {
      res.status(409).json({ error: 'Cannot delete product referenced by active BOMs or manufacturing orders.' });
    }
  });

  router.post('/warehouses', authenticate, requirePermission('products', 'write'), async (req: AuthenticatedRequest, res) => {
    const { ref, name, location = '' } = req.body ?? {};
    const cleanRef = String(ref ?? '').trim().toUpperCase();
    const cleanName = String(name ?? '').trim();
    if (!cleanRef || !cleanName) {
      res.status(400).json({ error: 'Warehouse ref and name are required.' });
      return;
    }
    try {
      const info = (await db
        .prepare(`INSERT INTO warehouses (ref, name, location, status) VALUES (?, ?, ?, 'active')`)
        .run(cleanRef, cleanName, String(location).trim()));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'CREATE_WAREHOUSE',
        module: 'products',
        entityRef: cleanRef,
        details: `Created warehouse ${cleanName}`,
        ipAddress: getClientIp(req),
      }));
      res.status(201).json((await db.prepare('SELECT * FROM warehouses WHERE id = ?').get(info.lastInsertRowid)));
    } catch {
      res.status(400).json({ error: 'Warehouse ref already exists.' });
    }
  });

  router.put('/warehouses/:id', authenticate, requirePermission('products', 'write'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM warehouses WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Warehouse not found.' });
      return;
    }
    const { name, location, status } = req.body ?? {};
    (await db.prepare(
      `UPDATE warehouses
       SET name = COALESCE(?, name),
           location = COALESCE(?, location),
           status = COALESCE(?, status)
       WHERE id = ?`
    ).run(
      name ? String(name).trim() : null,
      location !== undefined ? String(location).trim() : null,
      status === 'active' || status === 'inactive' ? status : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_WAREHOUSE',
      module: 'products',
      entityRef: existing.ref,
      details: `Updated warehouse ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM warehouses WHERE id = ?').get(id)));
  });

  router.delete('/warehouses/:id', authenticate, requirePermission('products', 'delete'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, name FROM warehouses WHERE id = ?').get(id)) as
      | { ref: string; name: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Warehouse not found.' });
      return;
    }
    const stockSum = ((await db.prepare('SELECT COALESCE(SUM(quantity), 0) AS qty FROM stock_levels WHERE warehouse_id = ?').get(id)) as { qty: number }).qty;
    if (stockSum > 0) {
      res.status(409).json({ error: `Transfer or clear ${stockSum} unit(s) of stock before deleting this warehouse.` });
      return;
    }
    try {
      (await db.prepare('DELETE FROM warehouses WHERE id = ?').run(id));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'DELETE_WAREHOUSE',
        module: 'products',
        entityRef: existing.ref,
        details: `Deleted warehouse ${existing.name}`,
        ipAddress: getClientIp(req),
        severity: 'warning',
      }));
      res.json({ ok: true });
    } catch {
      res.status(409).json({ error: 'Cannot delete warehouse referenced by existing orders, shipments, or manufacturing orders.' });
    }
  });

  router.post('/stock-movements', authenticate, requirePermission('products', 'adjust_stock'), async (req: AuthenticatedRequest, res) => {
    const { productId, warehouseId, targetWarehouseId, movementType, quantity, reason = '' } = req.body ?? {};
    const qty = Math.abs(Math.floor(Number(quantity)));
    if (!productId || !warehouseId || !Number.isFinite(qty) || qty <= 0) {
      res.status(400).json({ error: 'Product, warehouse, and positive integer quantity are required.' });
      return;
    }

    try {
      (await db.exec('BEGIN'));
      if (movementType === 'transfer') {
        if (!targetWarehouseId || Number(targetWarehouseId) === Number(warehouseId)) {
          throw new Error('Select a different destination warehouse for stock transfer.');
        }
        (await applyStockAdjustment({
          productId: Number(productId),
          warehouseId: Number(warehouseId),
          delta: -qty,
          movementType: 'transfer',
          reason: String(reason).trim() || `Transfer to warehouse #${targetWarehouseId}`,
          docRef: `TRF-${Date.now().toString().slice(-6)}`,
          actorEmail: req.authUser!.email,
        }));
        (await applyStockAdjustment({
          productId: Number(productId),
          warehouseId: Number(targetWarehouseId),
          delta: qty,
          movementType: 'transfer',
          reason: String(reason).trim() || `Transfer from warehouse #${warehouseId}`,
          docRef: `TRF-${Date.now().toString().slice(-6)}`,
          actorEmail: req.authUser!.email,
        }));
      } else if (movementType === 'in' || movementType === 'out' || movementType === 'adjustment') {
        const delta = movementType === 'out' ? -qty : qty;
        (await applyStockAdjustment({
          productId: Number(productId),
          warehouseId: Number(warehouseId),
          delta,
          movementType,
          reason: String(reason).trim() || 'Manual stock adjustment',
          docRef: `ADJ-${Date.now().toString().slice(-6)}`,
          actorEmail: req.authUser!.email,
        }));
      } else {
        throw new Error('Invalid movement type.');
      }
      (await db.exec('COMMIT'));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'STOCK_MOVEMENT',
        module: 'products',
        entityRef: `PRD-${productId}`,
        details: `${movementType} qty ${qty} at warehouse #${warehouseId}`,
        ipAddress: getClientIp(req),
      }));
      res.status(201).json({ ok: true });
    } catch (err) {
      (await db.exec('ROLLBACK'));
      res.status(400).json({ error: err instanceof Error ? err.message : 'Stock adjustment failed.' });
    }
  });

  router.put('/stock-movements/:id', authenticate, requirePermission('products', 'adjust_stock'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT id, doc_ref FROM stock_movements WHERE id = ?').get(id)) as
      | { id: number; doc_ref: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Stock movement not found.' });
      return;
    }
    const { reason, docRef } = req.body ?? {};
    (await db.prepare(
      `UPDATE stock_movements
       SET reason = COALESCE(?, reason),
           doc_ref = COALESCE(?, doc_ref)
       WHERE id = ?`
    ).run(
      reason !== undefined ? String(reason).trim() : null,
      docRef !== undefined ? String(docRef).trim() : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_STOCK_MOVEMENT',
      module: 'products',
      entityRef: existing.doc_ref || `MOV-${id}`,
      details: `Updated stock movement #${id} note/reference`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM stock_movements WHERE id = ?').get(id)));
  });

  // ========================
  // PROPOSALS & SALES ORDERS (COMMERCE)
  // ========================

  router.get('/proposals', authenticate, requirePermission('sales', 'read'), async (_req, res) => {
    const rows = (await db
      .prepare(
        `SELECT p.*, tp.name AS customer_name, tp.ref AS customer_ref
         FROM proposals p
         JOIN third_parties tp ON tp.id = p.third_party_id
         ORDER BY p.id DESC`
      )
      .all());
    res.json({ proposals: rows });
  });

  router.post('/proposals', authenticate, requirePermission('sales', 'write'), async (req: AuthenticatedRequest, res) => {
    const { thirdPartyId, title, issueDate, validUntil, lines, notes = '' } = req.body ?? {};
    if (!thirdPartyId || !String(title ?? '').trim()) {
      res.status(400).json({ error: 'Customer and proposal title are required.' });
      return;
    }
    try {
      const totals = computeLineTotals(lines);
      const ref = (await nextDocRef('proposals', 'PR'));
      const today = new Date().toISOString().slice(0, 10);
      const defaultValid = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const info = (await db
        .prepare(
          `INSERT INTO proposals (ref, third_party_id, title, issue_date, valid_until, status, lines_json, subtotal_ht, tax_total, total_ttc, notes, created_by)
           VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`
        )
        .run(
          ref,
          Number(thirdPartyId),
          String(title).trim(),
          String(issueDate || today),
          String(validUntil || defaultValid),
          JSON.stringify(totals.sanitized),
          totals.subtotalHt,
          totals.taxTotal,
          totals.totalTtc,
          String(notes).trim(),
          req.authUser!.email
        ));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'CREATE_PROPOSAL',
        module: 'sales',
        entityRef: ref,
        details: `Created proposal ${ref} ($${totals.totalTtc.toFixed(2)})`,
        ipAddress: getClientIp(req),
      }));
      res.status(201).json((await db.prepare('SELECT * FROM proposals WHERE id = ?').get(info.lastInsertRowid)));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid proposal payload.' });
    }
  });

  router.put('/proposals/:id', authenticate, requirePermission('sales', 'write'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM proposals WHERE id = ?').get(id)) as
      | { id: number; ref: string; status: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Proposal not found.' });
      return;
    }
    const { thirdPartyId, title, issueDate, validUntil, lines, notes, status } = req.body ?? {};
    try {
      const totals = Array.isArray(lines) && lines.length > 0 ? computeLineTotals(lines) : null;
      const allowedStatus = new Set(['draft', 'validated', 'signed', 'declined', 'billed']);
      (await db.prepare(
        `UPDATE proposals
         SET third_party_id = COALESCE(?, third_party_id),
             title = COALESCE(?, title),
             issue_date = COALESCE(?, issue_date),
             valid_until = COALESCE(?, valid_until),
             status = COALESCE(?, status),
             lines_json = COALESCE(?, lines_json),
             subtotal_ht = COALESCE(?, subtotal_ht),
             tax_total = COALESCE(?, tax_total),
             total_ttc = COALESCE(?, total_ttc),
             notes = COALESCE(?, notes)
         WHERE id = ?`
      ).run(
        thirdPartyId !== undefined ? Number(thirdPartyId) : null,
        title ? String(title).trim() : null,
        issueDate ? String(issueDate) : null,
        validUntil ? String(validUntil) : null,
        status && allowedStatus.has(status) ? status : null,
        totals ? JSON.stringify(totals.sanitized) : null,
        totals ? totals.subtotalHt : null,
        totals ? totals.taxTotal : null,
        totals ? totals.totalTtc : null,
        notes !== undefined ? String(notes).trim() : null,
        id
      ));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'UPDATE_PROPOSAL',
        module: 'sales',
        entityRef: existing.ref,
        details: `Updated proposal ${existing.ref}`,
        ipAddress: getClientIp(req),
      }));
      res.json((await db.prepare('SELECT * FROM proposals WHERE id = ?').get(id)));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid proposal update.' });
    }
  });

  router.post('/proposals/:id/status', authenticate, requirePermission('sales', 'validate'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const { status } = req.body ?? {};
    const allowed = new Set(['draft', 'validated', 'signed', 'declined', 'billed']);
    if (!allowed.has(status)) {
      res.status(400).json({ error: 'Invalid proposal status.' });
      return;
    }
    const existing = (await db.prepare('SELECT ref FROM proposals WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Proposal not found.' });
      return;
    }
    (await db.prepare('UPDATE proposals SET status = ? WHERE id = ?').run(status, id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'PROPOSAL_STATUS',
      module: 'sales',
      entityRef: existing.ref,
      details: `Transitioned ${existing.ref} -> ${status}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM proposals WHERE id = ?').get(id)));
  });

  router.post('/proposals/:id/convert-order', authenticate, requirePermission('sales', 'validate'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const { warehouseId } = req.body ?? {};
    const prop = (await db.prepare('SELECT * FROM proposals WHERE id = ?').get(id)) as Record<string, unknown> | undefined;
    if (!prop) {
      res.status(404).json({ error: 'Proposal not found.' });
      return;
    }
    const wh = warehouseId
      ? Number(warehouseId)
      : ((await db.prepare('SELECT id FROM warehouses ORDER BY id ASC LIMIT 1').get()) as { id: number } | undefined)?.id;
    if (!wh) {
      res.status(400).json({ error: 'At least one warehouse is required.' });
      return;
    }
    const soRef = (await nextDocRef('sales_orders', 'SO'));
    const today = new Date().toISOString().slice(0, 10);
    const delivery = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

    (await db.exec('BEGIN'));
    try {
      const info = (await db
        .prepare(
          `INSERT INTO sales_orders (ref, third_party_id, proposal_ref, order_date, delivery_date, warehouse_id, status, lines_json, subtotal_ht, tax_total, total_ttc, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?, 'validated', ?, ?, ?, ?, ?, ?)`
        )
        .run(
          soRef,
          prop.third_party_id as number,
          prop.ref as string,
          today,
          delivery,
          wh,
          prop.lines_json as string,
          prop.subtotal_ht as number,
          prop.tax_total as number,
          prop.total_ttc as number,
          `Converted from proposal ${prop.ref}`,
          req.authUser!.email
        ));
      (await db.prepare("UPDATE proposals SET status = 'signed' WHERE id = ?").run(id));
      (await db.exec('COMMIT'));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'CONVERT_PROPOSAL_TO_ORDER',
        module: 'sales',
        entityRef: soRef,
        details: `Converted ${prop.ref} -> Sales Order ${soRef}`,
        ipAddress: getClientIp(req),
      }));
      res.status(201).json((await db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(info.lastInsertRowid)));
    } catch (err) {
      (await db.exec('ROLLBACK'));
      res.status(500).json({ error: err instanceof Error ? err.message : 'Conversion failed.' });
    }
  });

  router.delete('/proposals/:id', authenticate, requirePermission('sales', 'delete'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM proposals WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Proposal not found.' });
      return;
    }
    (await db.prepare('DELETE FROM proposals WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_PROPOSAL',
      module: 'sales',
      entityRef: existing.ref,
      details: `Deleted proposal ${existing.ref}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.get('/sales-orders', authenticate, requirePermission('sales', 'read'), async (_req, res) => {
    const rows = (await db
      .prepare(
        `SELECT so.*, tp.name AS customer_name, w.name AS warehouse_name
         FROM sales_orders so
         JOIN third_parties tp ON tp.id = so.third_party_id
         JOIN warehouses w ON w.id = so.warehouse_id
         ORDER BY so.id DESC`
      )
      .all());
    res.json({ salesOrders: rows });
  });

  router.post('/sales-orders', authenticate, requirePermission('sales', 'write'), async (req: AuthenticatedRequest, res) => {
    const { thirdPartyId, warehouseId, orderDate, deliveryDate, incoterm = 'EXW', lines, notes = '' } = req.body ?? {};
    if (!thirdPartyId || !warehouseId) {
      res.status(400).json({ error: 'Customer and fulfillment warehouse are required.' });
      return;
    }
    try {
      const totals = computeLineTotals(lines);
      const ref = (await nextDocRef('sales_orders', 'SO'));
      const today = new Date().toISOString().slice(0, 10);
      const delivery = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const info = (await db
        .prepare(
          `INSERT INTO sales_orders (ref, third_party_id, proposal_ref, order_date, delivery_date, warehouse_id, incoterm, status, lines_json, subtotal_ht, tax_total, total_ttc, notes, created_by)
           VALUES (?, ?, '', ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`
        )
        .run(
          ref,
          Number(thirdPartyId),
          String(orderDate || today),
          String(deliveryDate || delivery),
          Number(warehouseId),
          String(incoterm || 'EXW').toUpperCase(),
          JSON.stringify(totals.sanitized),
          totals.subtotalHt,
          totals.taxTotal,
          totals.totalTtc,
          String(notes).trim(),
          req.authUser!.email
        ));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'CREATE_SALES_ORDER',
        module: 'sales',
        entityRef: ref,
        details: `Created sales order ${ref}`,
        ipAddress: getClientIp(req),
      }));
      res.status(201).json((await db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(info.lastInsertRowid)));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid sales order payload.' });
    }
  });

  router.put('/sales-orders/:id', authenticate, requirePermission('sales', 'write'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(id)) as
      | { id: number; ref: string; status: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Sales order not found.' });
      return;
    }
    const { thirdPartyId, warehouseId, orderDate, deliveryDate, incoterm, lines, notes } = req.body ?? {};
    const lockedFinancials = existing.status === 'shipped' || existing.status === 'billed';
    try {
      const totals = !lockedFinancials && Array.isArray(lines) && lines.length > 0 ? computeLineTotals(lines) : null;
      (await db.prepare(
        `UPDATE sales_orders
         SET third_party_id = COALESCE(?, third_party_id),
             warehouse_id = COALESCE(?, warehouse_id),
             order_date = COALESCE(?, order_date),
             delivery_date = COALESCE(?, delivery_date),
             incoterm = COALESCE(?, incoterm),
             lines_json = COALESCE(?, lines_json),
             subtotal_ht = COALESCE(?, subtotal_ht),
             tax_total = COALESCE(?, tax_total),
             total_ttc = COALESCE(?, total_ttc),
             notes = COALESCE(?, notes)
         WHERE id = ?`
      ).run(
        !lockedFinancials && thirdPartyId !== undefined ? Number(thirdPartyId) : null,
        !lockedFinancials && warehouseId !== undefined ? Number(warehouseId) : null,
        orderDate ? String(orderDate) : null,
        deliveryDate ? String(deliveryDate) : null,
        incoterm ? String(incoterm).trim().toUpperCase() : null,
        totals ? JSON.stringify(totals.sanitized) : null,
        totals ? totals.subtotalHt : null,
        totals ? totals.taxTotal : null,
        totals ? totals.totalTtc : null,
        notes !== undefined ? String(notes).trim() : null,
        id
      ));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'UPDATE_SALES_ORDER',
        module: 'sales',
        entityRef: existing.ref,
        details: `Updated sales order ${existing.ref}`,
        ipAddress: getClientIp(req),
      }));
      res.json((await db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(id)));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid sales order update.' });
    }
  });

  router.delete('/sales-orders/:id', authenticate, requirePermission('sales', 'delete'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, status FROM sales_orders WHERE id = ?').get(id)) as
      | { ref: string; status: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Sales order not found.' });
      return;
    }
    if (existing.status === 'shipped' || existing.status === 'billed') {
      res.status(409).json({ error: 'Shipped or billed sales orders cannot be deleted.' });
      return;
    }
    try {
      (await db.prepare('DELETE FROM sales_orders WHERE id = ?').run(id));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'DELETE_SALES_ORDER',
        module: 'sales',
        entityRef: existing.ref,
        details: `Deleted sales order ${existing.ref}`,
        ipAddress: getClientIp(req),
        severity: 'warning',
      }));
      res.json({ ok: true });
    } catch {
      res.status(409).json({ error: 'Delete linked shipments before deleting this sales order.' });
    }
  });

  router.post('/sales-orders/:id/status', authenticate, requirePermission('sales', 'validate'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const { status } = req.body ?? {};
    const order = (await db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(id)) as
      | { id: number; ref: string; status: string; warehouse_id: number; lines_json: string }
      | undefined;
    if (!order) {
      res.status(404).json({ error: 'Sales order not found.' });
      return;
    }
    const allowed = new Set(['draft', 'validated', 'shipped', 'billed', 'cancelled']);
    if (!allowed.has(status)) {
      res.status(400).json({ error: 'Invalid sales order status.' });
      return;
    }

    (await db.exec('BEGIN'));
    try {
      if (status === 'shipped' && order.status !== 'shipped' && order.status !== 'billed') {
        const lines = JSON.parse(order.lines_json) as DocumentLineInput[];
        for (const line of lines) {
          if (line.productId) {
            (await applyStockAdjustment({
              productId: line.productId,
              warehouseId: order.warehouse_id,
              delta: -Math.round(line.qty),
              movementType: 'out',
              reason: `Dispatched sales order ${order.ref}`,
              docRef: order.ref,
              actorEmail: req.authUser!.email,
            }));
          }
        }
      }
      (await db.prepare('UPDATE sales_orders SET status = ? WHERE id = ?').run(status, id));
      (await db.exec('COMMIT'));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'SALES_ORDER_STATUS',
        module: 'sales',
        entityRef: order.ref,
        details: `Sales order ${order.ref} -> ${status}`,
        ipAddress: getClientIp(req),
      }));
      res.json((await db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(id)));
    } catch (err) {
      (await db.exec('ROLLBACK'));
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to update sales order.' });
    }
  });

  router.post(
    '/sales-orders/:id/convert-invoice',
    authenticate,
    requirePermission('billing', 'write'),
    async (req: AuthenticatedRequest, res) => {
      const id = Number(req.params.id);
      const order = (await db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(id)) as Record<string, unknown> | undefined;
      if (!order) {
        res.status(404).json({ error: 'Sales order not found.' });
        return;
      }
      const invRef = (await nextDocRef('invoices', 'IN'));
      const today = new Date().toISOString().slice(0, 10);
      const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

      (await db.exec('BEGIN'));
      try {
        const info = (await db
          .prepare(
            `INSERT INTO invoices (ref, invoice_type, third_party_id, source_ref, issue_date, due_date, status, lines_json, subtotal_ht, tax_total, total_ttc, amount_paid, notes, created_by)
             VALUES (?, 'customer', ?, ?, ?, ?, 'validated', ?, ?, ?, ?, 0, ?, ?)`
          )
          .run(
            invRef,
            order.third_party_id as number,
            order.ref as string,
            today,
            due,
            order.lines_json as string,
            order.subtotal_ht as number,
            order.tax_total as number,
            order.total_ttc as number,
            `Generated from Sales Order ${order.ref}`,
            req.authUser!.email
          ));
        (await db.prepare("UPDATE sales_orders SET status = 'billed' WHERE id = ?").run(id));
        (await db.exec('COMMIT'));
        (await writeAuditLog(db, {
          userId: req.authUser!.id,
          userEmail: req.authUser!.email,
          action: 'CONVERT_ORDER_TO_INVOICE',
          module: 'billing',
          entityRef: invRef,
          details: `Created customer invoice ${invRef} from ${order.ref}`,
          ipAddress: getClientIp(req),
        }));
        res.status(201).json((await db.prepare('SELECT * FROM invoices WHERE id = ?').get(info.lastInsertRowid)));
      } catch (err) {
        (await db.exec('ROLLBACK'));
        res.status(500).json({ error: err instanceof Error ? err.message : 'Invoice conversion failed.' });
      }
    }
  );

  // ========================
  // PURCHASE ORDERS
  // ========================

  router.get('/purchase-orders', authenticate, requirePermission('purchasing', 'read'), async (_req, res) => {
    const rows = (await db
      .prepare(
        `SELECT po.*, tp.name AS supplier_name, w.name AS warehouse_name
         FROM purchase_orders po
         JOIN third_parties tp ON tp.id = po.third_party_id
         JOIN warehouses w ON w.id = po.warehouse_id
         ORDER BY po.id DESC`
      )
      .all());
    res.json({ purchaseOrders: rows });
  });

  router.post('/purchase-orders', authenticate, requirePermission('purchasing', 'write'), async (req: AuthenticatedRequest, res) => {
    const { thirdPartyId, warehouseId, orderDate, expectedDate, incoterm = 'FOB', lines, notes = '' } = req.body ?? {};
    if (!thirdPartyId || !warehouseId) {
      res.status(400).json({ error: 'Supplier and receiving warehouse are required.' });
      return;
    }
    try {
      const totals = computeLineTotals(lines);
      const ref = (await nextDocRef('purchase_orders', 'PO'));
      const today = new Date().toISOString().slice(0, 10);
      const expected = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
      const info = (await db
        .prepare(
          `INSERT INTO purchase_orders (ref, third_party_id, order_date, expected_date, warehouse_id, incoterm, status, lines_json, subtotal_ht, tax_total, total_ttc, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`
        )
        .run(
          ref,
          Number(thirdPartyId),
          String(orderDate || today),
          String(expectedDate || expected),
          Number(warehouseId),
          String(incoterm || 'FOB').toUpperCase(),
          JSON.stringify(totals.sanitized),
          totals.subtotalHt,
          totals.taxTotal,
          totals.totalTtc,
          String(notes).trim(),
          req.authUser!.email
        ));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'CREATE_PURCHASE_ORDER',
        module: 'purchasing',
        entityRef: ref,
        details: `Created purchase order ${ref}`,
        ipAddress: getClientIp(req),
      }));
      res.status(201).json((await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(info.lastInsertRowid)));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid purchase order payload.' });
    }
  });

  router.put('/purchase-orders/:id', authenticate, requirePermission('purchasing', 'write'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id)) as
      | { id: number; ref: string; status: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Purchase order not found.' });
      return;
    }
    const { thirdPartyId, warehouseId, orderDate, expectedDate, incoterm, lines, notes } = req.body ?? {};
    const lockedFinancials = existing.status === 'received' || existing.status === 'billed';
    try {
      const totals = !lockedFinancials && Array.isArray(lines) && lines.length > 0 ? computeLineTotals(lines) : null;
      (await db.prepare(
        `UPDATE purchase_orders
         SET third_party_id = COALESCE(?, third_party_id),
             warehouse_id = COALESCE(?, warehouse_id),
             order_date = COALESCE(?, order_date),
             expected_date = COALESCE(?, expected_date),
             incoterm = COALESCE(?, incoterm),
             lines_json = COALESCE(?, lines_json),
             subtotal_ht = COALESCE(?, subtotal_ht),
             tax_total = COALESCE(?, tax_total),
             total_ttc = COALESCE(?, total_ttc),
             notes = COALESCE(?, notes)
         WHERE id = ?`
      ).run(
        !lockedFinancials && thirdPartyId !== undefined ? Number(thirdPartyId) : null,
        !lockedFinancials && warehouseId !== undefined ? Number(warehouseId) : null,
        orderDate ? String(orderDate) : null,
        expectedDate ? String(expectedDate) : null,
        incoterm ? String(incoterm).trim().toUpperCase() : null,
        totals ? JSON.stringify(totals.sanitized) : null,
        totals ? totals.subtotalHt : null,
        totals ? totals.taxTotal : null,
        totals ? totals.totalTtc : null,
        notes !== undefined ? String(notes).trim() : null,
        id
      ));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'UPDATE_PURCHASE_ORDER',
        module: 'purchasing',
        entityRef: existing.ref,
        details: `Updated purchase order ${existing.ref}`,
        ipAddress: getClientIp(req),
      }));
      res.json((await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id)));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid purchase order update.' });
    }
  });

  router.delete('/purchase-orders/:id', authenticate, requirePermission('purchasing', 'delete'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, status FROM purchase_orders WHERE id = ?').get(id)) as
      | { ref: string; status: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Purchase order not found.' });
      return;
    }
    if (existing.status === 'received' || existing.status === 'billed') {
      res.status(409).json({ error: 'Received or billed purchase orders cannot be deleted.' });
      return;
    }
    (await db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_PURCHASE_ORDER',
      module: 'purchasing',
      entityRef: existing.ref,
      details: `Deleted purchase order ${existing.ref}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.post('/purchase-orders/:id/status', authenticate, requirePermission('purchasing', 'validate'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const { status } = req.body ?? {};
    const po = (await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id)) as
      | { id: number; ref: string; status: string; warehouse_id: number; lines_json: string }
      | undefined;
    if (!po) {
      res.status(404).json({ error: 'Purchase order not found.' });
      return;
    }
    const allowed = new Set(['draft', 'ordered', 'received', 'billed', 'cancelled']);
    if (!allowed.has(status)) {
      res.status(400).json({ error: 'Invalid purchase order status.' });
      return;
    }
    (await db.exec('BEGIN'));
    try {
      if (status === 'received' && po.status !== 'received' && po.status !== 'billed') {
        const lines = JSON.parse(po.lines_json) as DocumentLineInput[];
        for (const line of lines) {
          if (line.productId) {
            (await applyStockAdjustment({
              productId: line.productId,
              warehouseId: po.warehouse_id,
              delta: Math.round(line.qty),
              movementType: 'in',
              reason: `Received purchase order ${po.ref}`,
              docRef: po.ref,
              actorEmail: req.authUser!.email,
            }));
          }
        }
      }
      (await db.prepare('UPDATE purchase_orders SET status = ? WHERE id = ?').run(status, id));
      (await db.exec('COMMIT'));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'PURCHASE_ORDER_STATUS',
        module: 'purchasing',
        entityRef: po.ref,
        details: `Purchase order ${po.ref} -> ${status}`,
        ipAddress: getClientIp(req),
      }));
      res.json((await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id)));
    } catch (err) {
      (await db.exec('ROLLBACK'));
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to update purchase order.' });
    }
  });

  router.post(
    '/purchase-orders/:id/convert-bill',
    authenticate,
    requirePermission('billing', 'write'),
    async (req: AuthenticatedRequest, res) => {
      const id = Number(req.params.id);
      const po = (await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id)) as Record<string, unknown> | undefined;
      if (!po) {
        res.status(404).json({ error: 'Purchase order not found.' });
        return;
      }
      const invRef = (await nextDocRef('invoices', 'SI'));
      const today = new Date().toISOString().slice(0, 10);
      const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

      (await db.exec('BEGIN'));
      try {
        const info = (await db
          .prepare(
            `INSERT INTO invoices (ref, invoice_type, third_party_id, source_ref, issue_date, due_date, status, lines_json, subtotal_ht, tax_total, total_ttc, amount_paid, notes, created_by)
             VALUES (?, 'supplier', ?, ?, ?, ?, 'validated', ?, ?, ?, ?, 0, ?, ?)`
          )
          .run(
            invRef,
            po.third_party_id as number,
            po.ref as string,
            today,
            due,
            po.lines_json as string,
            po.subtotal_ht as number,
            po.tax_total as number,
            po.total_ttc as number,
            `Supplier bill from Purchase Order ${po.ref}`,
            req.authUser!.email
          ));
        (await db.prepare("UPDATE purchase_orders SET status = 'billed' WHERE id = ?").run(id));
        (await db.exec('COMMIT'));
        (await writeAuditLog(db, {
          userId: req.authUser!.id,
          userEmail: req.authUser!.email,
          action: 'CONVERT_PO_TO_BILL',
          module: 'billing',
          entityRef: invRef,
          details: `Created supplier bill ${invRef} from ${po.ref}`,
          ipAddress: getClientIp(req),
        }));
        res.status(201).json((await db.prepare('SELECT * FROM invoices WHERE id = ?').get(info.lastInsertRowid)));
      } catch (err) {
        (await db.exec('ROLLBACK'));
        res.status(500).json({ error: err instanceof Error ? err.message : 'Bill conversion failed.' });
      }
    }
  );

  // ========================
  // BILLING & BANK TREASURY
  // ========================

  router.get('/invoices', authenticate, requirePermission('billing', 'read'), async (_req, res) => {
    const rows = (await db
      .prepare(
        `SELECT i.*, tp.name AS party_name, tp.ref AS party_ref
         FROM invoices i
         JOIN third_parties tp ON tp.id = i.third_party_id
         ORDER BY i.id DESC`
      )
      .all());
    res.json({ invoices: rows });
  });

  router.post('/invoices', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedRequest, res) => {
    const { invoiceType = 'customer', invoiceKind = 'standard', thirdPartyId, issueDate, dueDate, lines, notes = '' } = req.body ?? {};
    if (!thirdPartyId) {
      res.status(400).json({ error: 'Third party is required.' });
      return;
    }
    const cleanType = invoiceType === 'supplier' ? 'supplier' : 'customer';
    const cleanKind = invoiceKind === 'credit_note' ? 'credit_note' : 'standard';
    try {
      const totals = computeLineTotals(lines);
      const prefix = cleanKind === 'credit_note' ? (cleanType === 'supplier' ? 'SC' : 'CR') : cleanType === 'supplier' ? 'SI' : 'IN';
      const ref = (await nextDocRef('invoices', prefix));
      const today = new Date().toISOString().slice(0, 10);
      const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const info = (await db
        .prepare(
          `INSERT INTO invoices (ref, invoice_type, invoice_kind, third_party_id, source_ref, issue_date, due_date, status, lines_json, subtotal_ht, tax_total, total_ttc, amount_paid, notes, created_by)
           VALUES (?, ?, ?, ?, '', ?, ?, 'draft', ?, ?, ?, ?, 0, ?, ?)`
        )
        .run(
          ref,
          cleanType,
          cleanKind,
          Number(thirdPartyId),
          String(issueDate || today),
          String(dueDate || due),
          JSON.stringify(totals.sanitized),
          totals.subtotalHt,
          totals.taxTotal,
          totals.totalTtc,
          String(notes).trim(),
          req.authUser!.email
        ));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: cleanKind === 'credit_note' ? 'CREATE_CREDIT_NOTE' : 'CREATE_INVOICE',
        module: 'billing',
        entityRef: ref,
        details: `Created ${cleanType} ${cleanKind.replace('_', ' ')} ${ref} ($${totals.totalTtc.toFixed(2)})`,
        ipAddress: getClientIp(req),
      }));
      res.status(201).json((await db.prepare('SELECT * FROM invoices WHERE id = ?').get(info.lastInsertRowid)));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid invoice payload.' });
    }
  });

  router.put('/invoices/:id', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM invoices WHERE id = ?').get(id)) as
      | { id: number; ref: string; status: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Invoice not found.' });
      return;
    }
    const { thirdPartyId, issueDate, dueDate, lines, notes, status } = req.body ?? {};
    const isDraft = existing.status === 'draft';
    try {
      const totals = isDraft && Array.isArray(lines) && lines.length > 0 ? computeLineTotals(lines) : null;
      const allowedStatus = new Set(['draft', 'validated', 'cancelled']);
      (await db.prepare(
        `UPDATE invoices
         SET third_party_id = COALESCE(?, third_party_id),
             issue_date = COALESCE(?, issue_date),
             due_date = COALESCE(?, due_date),
             lines_json = COALESCE(?, lines_json),
             subtotal_ht = COALESCE(?, subtotal_ht),
             tax_total = COALESCE(?, tax_total),
             total_ttc = COALESCE(?, total_ttc),
             notes = COALESCE(?, notes),
             status = COALESCE(?, status)
         WHERE id = ?`
      ).run(
        isDraft && thirdPartyId !== undefined ? Number(thirdPartyId) : null,
        isDraft && issueDate ? String(issueDate) : null,
        dueDate ? String(dueDate) : null,
        totals ? JSON.stringify(totals.sanitized) : null,
        totals ? totals.subtotalHt : null,
        totals ? totals.taxTotal : null,
        totals ? totals.totalTtc : null,
        notes !== undefined ? String(notes).trim() : null,
        existing.status !== 'paid' && existing.status !== 'partial' && status && allowedStatus.has(status) ? status : null,
        id
      ));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'UPDATE_INVOICE',
        module: 'billing',
        entityRef: existing.ref,
        details: `Updated invoice ${existing.ref}`,
        ipAddress: getClientIp(req),
      }));
      res.json((await db.prepare('SELECT * FROM invoices WHERE id = ?').get(id)));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid invoice update.' });
    }
  });

  router.post('/invoices/:id/validate', authenticate, requirePermission('billing', 'validate'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const inv = (await db.prepare('SELECT * FROM invoices WHERE id = ?').get(id)) as { ref: string; status: string } | undefined;
    if (!inv) {
      res.status(404).json({ error: 'Invoice not found.' });
      return;
    }
    if (inv.status !== 'draft') {
      res.status(400).json({ error: 'Only draft invoices can be validated.' });
      return;
    }
    (await db.prepare("UPDATE invoices SET status = 'validated' WHERE id = ?").run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'VALIDATE_INVOICE',
      module: 'billing',
      entityRef: inv.ref,
      details: `Validated invoice ${inv.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM invoices WHERE id = ?').get(id)));
  });

  router.post('/invoices/:id/payments', authenticate, requirePermission('billing', 'record_payment'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const { bankAccountId, amount, paymentDate, label } = req.body ?? {};
    const payAmount = Number(amount);
    if (!bankAccountId || !Number.isFinite(payAmount) || payAmount <= 0) {
      res.status(400).json({ error: 'Bank account and positive payment amount are required.' });
      return;
    }
    const inv = (await db
      .prepare(
        `SELECT i.*, tp.name AS party_name
         FROM invoices i
         JOIN third_parties tp ON tp.id = i.third_party_id
         WHERE i.id = ?`
      )
      .get(id)) as
      | {
          id: number;
          ref: string;
          invoice_type: 'customer' | 'supplier';
          status: string;
          total_ttc: number;
          amount_paid: number;
          party_name: string;
        }
      | undefined;
    if (!inv) {
      res.status(404).json({ error: 'Invoice not found.' });
      return;
    }
    if (inv.status === 'draft' || inv.status === 'cancelled') {
      res.status(400).json({ error: 'Validate the invoice before recording a payment.' });
      return;
    }
    const remaining = Math.round((inv.total_ttc - inv.amount_paid) * 100) / 100;
    if (payAmount > remaining + 0.01) {
      res.status(400).json({ error: `Payment exceeds remaining balance ($${remaining.toFixed(2)}).` });
      return;
    }

    const nextPaid = Math.min(inv.total_ttc, Math.round((inv.amount_paid + payAmount) * 100) / 100);
    const nextStatus = nextPaid >= inv.total_ttc - 0.01 ? 'paid' : 'partial';
    const direction = inv.invoice_type === 'customer' ? 'credit' : 'debit';
    const balanceDelta = direction === 'credit' ? payAmount : -payAmount;
    const txDate = String(paymentDate || new Date().toISOString().slice(0, 10));
    const txLabel =
      String(label ?? '').trim() ||
      `${inv.invoice_type === 'customer' ? 'Payment' : 'Bill Settlement'} ${inv.ref} — ${inv.party_name}`;

    (await db.exec('BEGIN'));
    try {
      (await db.prepare('UPDATE invoices SET amount_paid = ?, status = ? WHERE id = ?').run(nextPaid, nextStatus, id));
      (await db.prepare('UPDATE bank_accounts SET balance = balance + ? WHERE id = ?').run(balanceDelta, Number(bankAccountId)));
      (await db.prepare(
        `INSERT INTO bank_transactions (bank_account_id, tx_date, label, category, amount, direction, invoice_ref, reconciled, reconciled_at, reconciled_invoice_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      ).run(
        Number(bankAccountId),
        txDate,
        txLabel,
        inv.invoice_type === 'customer' ? 'Customer Payment' : 'Supplier Payment',
        payAmount,
        direction,
        inv.ref,
        txDate,
        id,
        req.authUser!.email
      ));
      (await db.exec('COMMIT'));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'RECORD_PAYMENT',
        module: 'billing',
        entityRef: inv.ref,
        details: `Recorded $${payAmount.toFixed(2)} (${nextStatus}) on ${inv.ref}`,
        ipAddress: getClientIp(req),
      }));
      res.json((await db.prepare('SELECT * FROM invoices WHERE id = ?').get(id)));
    } catch (err) {
      (await db.exec('ROLLBACK'));
      res.status(500).json({ error: err instanceof Error ? err.message : 'Payment recording failed.' });
    }
  });

  router.delete('/invoices/:id', authenticate, requirePermission('billing', 'delete'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const inv = (await db.prepare('SELECT ref, status FROM invoices WHERE id = ?').get(id)) as
      | { ref: string; status: string }
      | undefined;
    if (!inv) {
      res.status(404).json({ error: 'Invoice not found.' });
      return;
    }
    if (inv.status === 'paid' || inv.status === 'partial') {
      res.status(400).json({ error: 'Paid or partially paid invoices cannot be deleted.' });
      return;
    }
    (await db.prepare('DELETE FROM invoices WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_INVOICE',
      module: 'billing',
      entityRef: inv.ref,
      details: `Deleted invoice ${inv.ref}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.get('/bank-accounts', authenticate, requirePermission('billing', 'read'), async (_req, res) => {
    const accounts = (await db.prepare('SELECT * FROM bank_accounts ORDER BY id ASC').all());
    const transactions = (await db
      .prepare(
        `SELECT bt.*, ba.name AS account_name, ba.ref AS account_ref
         FROM bank_transactions bt
         JOIN bank_accounts ba ON ba.id = bt.bank_account_id
         ORDER BY bt.tx_date DESC, bt.id DESC
         LIMIT 100`
      )
      .all());
    res.json({ accounts, transactions });
  });

  router.post('/bank-accounts', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedRequest, res) => {
    const { ref, name, bankName = '', accountNumber = '', accountType = 'checking', initialBalance = 0 } = req.body ?? {};
    const cleanRef = String(ref ?? '').trim().toUpperCase();
    const cleanName = String(name ?? '').trim();
    if (!cleanRef || !cleanName) {
      res.status(400).json({ error: 'Account ref and name are required.' });
      return;
    }
    try {
      const info = (await db
        .prepare(
          `INSERT INTO bank_accounts (ref, name, bank_name, account_number, currency, balance, account_type, status)
           VALUES (?, ?, ?, ?, 'USD', ?, ?, 'active')`
        )
        .run(
          cleanRef,
          cleanName,
          String(bankName).trim(),
          String(accountNumber).trim(),
          Number(initialBalance) || 0,
          ['checking', 'savings', 'cash'].includes(accountType) ? accountType : 'checking'
        ));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'CREATE_BANK_ACCOUNT',
        module: 'billing',
        entityRef: cleanRef,
        details: `Added treasury account ${cleanName}`,
        ipAddress: getClientIp(req),
      }));
      res.status(201).json((await db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(info.lastInsertRowid)));
    } catch {
      res.status(400).json({ error: 'Bank account ref already exists.' });
    }
  });

  router.put('/bank-accounts/:id', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM bank_accounts WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Bank account not found.' });
      return;
    }
    const { name, bankName, accountNumber, accountType, status } = req.body ?? {};
    (await db.prepare(
      `UPDATE bank_accounts
       SET name = COALESCE(?, name),
           bank_name = COALESCE(?, bank_name),
           account_number = COALESCE(?, account_number),
           account_type = COALESCE(?, account_type),
           status = COALESCE(?, status)
       WHERE id = ?`
    ).run(
      name ? String(name).trim() : null,
      bankName !== undefined ? String(bankName).trim() : null,
      accountNumber !== undefined ? String(accountNumber).trim() : null,
      ['checking', 'savings', 'cash'].includes(accountType) ? accountType : null,
      status === 'active' || status === 'closed' ? status : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_BANK_ACCOUNT',
      module: 'billing',
      entityRef: existing.ref,
      details: `Updated bank account ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(id)));
  });

  router.delete('/bank-accounts/:id', authenticate, requirePermission('billing', 'delete'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, name FROM bank_accounts WHERE id = ?').get(id)) as
      | { ref: string; name: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Bank account not found.' });
      return;
    }
    const txCnt = ((await db.prepare('SELECT COUNT(*) AS cnt FROM bank_transactions WHERE bank_account_id = ?').get(id)) as { cnt: number }).cnt;
    if (txCnt > 0) {
      res.status(409).json({ error: `Remove or settle ${txCnt} ledger transaction(s) before deleting this bank account.` });
      return;
    }
    try {
      (await db.prepare('DELETE FROM bank_accounts WHERE id = ?').run(id));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'DELETE_BANK_ACCOUNT',
        module: 'billing',
        entityRef: existing.ref,
        details: `Deleted bank account ${existing.name}`,
        ipAddress: getClientIp(req),
        severity: 'warning',
      }));
      res.json({ ok: true });
    } catch {
      res.status(409).json({ error: 'Cannot delete bank account referenced by SEPA batches.' });
    }
  });

  router.post('/bank-transactions', authenticate, requirePermission('billing', 'record_payment'), async (req: AuthenticatedRequest, res) => {
    const { bankAccountId, txDate, label, category = 'Operations', amount, direction } = req.body ?? {};
    const amt = Number(amount);
    if (!bankAccountId || !String(label ?? '').trim() || !Number.isFinite(amt) || amt <= 0) {
      res.status(400).json({ error: 'Account, label, and positive amount are required.' });
      return;
    }
    const dir = direction === 'debit' ? 'debit' : 'credit';
    const delta = dir === 'credit' ? amt : -amt;
    (await db.exec('BEGIN'));
    try {
      (await db.prepare('UPDATE bank_accounts SET balance = balance + ? WHERE id = ?').run(delta, Number(bankAccountId)));
      const info = (await db
        .prepare(
          `INSERT INTO bank_transactions (bank_account_id, tx_date, label, category, amount, direction, invoice_ref, created_by)
           VALUES (?, ?, ?, ?, ?, ?, '', ?)`
        )
        .run(
          Number(bankAccountId),
          String(txDate || new Date().toISOString().slice(0, 10)),
          String(label).trim(),
          String(category).trim() || 'Operations',
          amt,
          dir,
          req.authUser!.email
        ));
      (await db.exec('COMMIT'));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'BANK_TRANSACTION',
        module: 'billing',
        details: `${dir.toUpperCase()} $${amt.toFixed(2)}: ${label}`,
        ipAddress: getClientIp(req),
      }));
      res.status(201).json((await db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(info.lastInsertRowid)));
    } catch (err) {
      (await db.exec('ROLLBACK'));
      res.status(500).json({ error: err instanceof Error ? err.message : 'Transaction failed.' });
    }
  });

  router.put('/bank-transactions/:id', authenticate, requirePermission('billing', 'record_payment'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(id)) as
      | { id: number; bank_account_id: number; amount: number; direction: 'credit' | 'debit'; label: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Bank transaction not found.' });
      return;
    }
    const { txDate, label, category, amount, direction } = req.body ?? {};
    const nextAmt = amount !== undefined ? Number(amount) : existing.amount;
    if (!Number.isFinite(nextAmt) || nextAmt <= 0) {
      res.status(400).json({ error: 'Positive transaction amount is required.' });
      return;
    }
    const nextDir: 'credit' | 'debit' =
      direction === 'debit' || direction === 'credit' ? direction : existing.direction;
    const oldImpact = existing.direction === 'credit' ? existing.amount : -existing.amount;
    const newImpact = nextDir === 'credit' ? nextAmt : -nextAmt;
    const balanceDelta = newImpact - oldImpact;

    (await db.exec('BEGIN'));
    try {
      if (Math.abs(balanceDelta) > 0.0001) {
        (await db.prepare('UPDATE bank_accounts SET balance = balance + ? WHERE id = ?').run(balanceDelta, existing.bank_account_id));
      }
      (await db.prepare(
        `UPDATE bank_transactions
         SET tx_date = COALESCE(?, tx_date),
             label = COALESCE(?, label),
             category = COALESCE(?, category),
             amount = ?,
             direction = ?
         WHERE id = ?`
      ).run(
        txDate ? String(txDate) : null,
        label ? String(label).trim() : null,
        category !== undefined ? String(category).trim() : null,
        nextAmt,
        nextDir,
        id
      ));
      (await db.exec('COMMIT'));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'UPDATE_BANK_TRANSACTION',
        module: 'billing',
        entityRef: `TX-${id}`,
        details: `Updated ledger transaction #${id} (${nextDir.toUpperCase()} $${nextAmt.toFixed(2)})`,
        ipAddress: getClientIp(req),
      }));
      res.json((await db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(id)));
    } catch (err) {
      (await db.exec('ROLLBACK'));
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to update transaction.' });
    }
  });

  router.delete('/bank-transactions/:id', authenticate, requirePermission('billing', 'delete'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(id)) as
      | { id: number; bank_account_id: number; amount: number; direction: 'credit' | 'debit'; label: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Bank transaction not found.' });
      return;
    }
    const reverseDelta = existing.direction === 'credit' ? -existing.amount : existing.amount;
    (await db.exec('BEGIN'));
    try {
      (await db.prepare('UPDATE bank_accounts SET balance = balance + ? WHERE id = ?').run(reverseDelta, existing.bank_account_id));
      (await db.prepare('DELETE FROM bank_transactions WHERE id = ?').run(id));
      (await db.exec('COMMIT'));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'DELETE_BANK_TRANSACTION',
        module: 'billing',
        entityRef: `TX-${id}`,
        details: `Deleted ledger transaction "${existing.label}" ($${existing.amount.toFixed(2)})`,
        ipAddress: getClientIp(req),
        severity: 'warning',
      }));
      res.json({ ok: true });
    } catch (err) {
      (await db.exec('ROLLBACK'));
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to delete transaction.' });
    }
  });

  // ========================
  // PROJECTS & TASKS
  // ========================

  router.get('/projects', authenticate, requirePermission('projects', 'read'), async (_req, res) => {
    const projects = (await db
      .prepare(
        `SELECT pr.*, tp.name AS customer_name
         FROM projects pr
         LEFT JOIN third_parties tp ON tp.id = pr.third_party_id
         ORDER BY pr.id DESC`
      )
      .all());
    const tasks = (await db.prepare('SELECT * FROM tasks ORDER BY id DESC').all());
    res.json({ projects, tasks });
  });

  router.post('/projects', authenticate, requirePermission('projects', 'write'), async (req: AuthenticatedRequest, res) => {
    const { title, thirdPartyId = null, startDate, dueDate, budgetAmount = 0, description = '' } = req.body ?? {};
    if (!String(title ?? '').trim()) {
      res.status(400).json({ error: 'Project title is required.' });
      return;
    }
    const ref = (await nextDocRef('projects', 'PJ'));
    const today = new Date().toISOString().slice(0, 10);
    const due = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
    const info = (await db
      .prepare(
        `INSERT INTO projects (ref, title, third_party_id, start_date, due_date, budget_amount, status, progress, description, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?, ?)`
      )
      .run(
        ref,
        String(title).trim(),
        thirdPartyId ? Number(thirdPartyId) : null,
        String(startDate || today),
        String(dueDate || due),
        Number(budgetAmount) || 0,
        String(description).trim(),
        req.authUser!.email
      ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_PROJECT',
      module: 'projects',
      entityRef: ref,
      details: `Created project ${title}`,
      ipAddress: getClientIp(req),
    }));
    res.status(201).json((await db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/projects/:id', authenticate, requirePermission('projects', 'write'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM projects WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    const { title, thirdPartyId, startDate, dueDate, budgetAmount, status, description } = req.body ?? {};
    (await db.prepare(
      `UPDATE projects
       SET title = COALESCE(?, title),
           third_party_id = ?,
           start_date = COALESCE(?, start_date),
           due_date = COALESCE(?, due_date),
           budget_amount = COALESCE(?, budget_amount),
           status = COALESCE(?, status),
           description = COALESCE(?, description)
       WHERE id = ?`
    ).run(
      title ? String(title).trim() : null,
      thirdPartyId === '' || thirdPartyId === null
        ? null
        : thirdPartyId !== undefined
          ? Number(thirdPartyId)
          : ((await db.prepare('SELECT third_party_id FROM projects WHERE id = ?').get(id)) as { third_party_id: number | null }).third_party_id,
      startDate ? String(startDate) : null,
      dueDate ? String(dueDate) : null,
      budgetAmount !== undefined ? Number(budgetAmount) : null,
      ['draft', 'active', 'on_hold', 'completed'].includes(status) ? status : null,
      description !== undefined ? String(description).trim() : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_PROJECT',
      module: 'projects',
      entityRef: existing.ref,
      details: `Updated project ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM projects WHERE id = ?').get(id)));
  });

  router.delete('/projects/:id', authenticate, requirePermission('projects', 'delete'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, title FROM projects WHERE id = ?').get(id)) as
      | { ref: string; title: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    (await db.exec('BEGIN'));
    try {
      (await db.prepare('UPDATE timesheets SET project_id = NULL WHERE project_id = ?').run(id));
      (await db.prepare('DELETE FROM projects WHERE id = ?').run(id));
      (await db.exec('COMMIT'));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'DELETE_PROJECT',
        module: 'projects',
        entityRef: existing.ref,
        details: `Deleted project ${existing.title}`,
        ipAddress: getClientIp(req),
        severity: 'warning',
      }));
      res.json({ ok: true });
    } catch (err) {
      (await db.exec('ROLLBACK'));
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to delete project.' });
    }
  });

  router.post('/projects/:id/tasks', authenticate, requirePermission('projects', 'write'), async (req: AuthenticatedRequest, res) => {
    const projectId = Number(req.params.id);
    const { title, assigneeName = '', priority = 'medium', estimatedHours = 8, dueDate = '' } = req.body ?? {};
    if (!String(title ?? '').trim()) {
      res.status(400).json({ error: 'Task title is required.' });
      return;
    }
    const ref = (await nextDocRef('tasks', 'TK'));
    const info = (await db
      .prepare(
        `INSERT INTO tasks (project_id, ref, title, assignee_name, priority, status, estimated_hours, logged_hours, progress, due_date)
         VALUES (?, ?, ?, ?, ?, 'todo', ?, 0, 0, ?)`
      )
      .run(
        projectId,
        ref,
        String(title).trim(),
        String(assigneeName).trim() || req.authUser!.full_name,
        ['low', 'medium', 'high'].includes(priority) ? priority : 'medium',
        Number(estimatedHours) || 0,
        String(dueDate).trim()
      ));
    res.status(201).json((await db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/tasks/:id', authenticate, async (req: AuthenticatedRequest, res) => {
    if (!hasPermission(req.authPermissions, 'projects', 'write') && !hasPermission(req.authPermissions, 'projects', 'log_time')) {
      res.status(403).json({ error: 'Permission required to update tasks or log time.' });
      return;
    }
    const id = Number(req.params.id);
    const task = (await db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)) as
      | { id: number; project_id: number; logged_hours: number; progress: number; status: string }
      | undefined;
    if (!task) {
      res.status(404).json({ error: 'Task not found.' });
      return;
    }
    const { title, assigneeName, priority, estimatedHours, dueDate, status, progress, addHours } = req.body ?? {};
    const nextHours = Math.max(0, task.logged_hours + (Number(addHours) || 0));
    const nextProgress =
      progress !== undefined ? Math.min(100, Math.max(0, Math.round(Number(progress)))) : task.progress;
    const nextStatus = status ?? (nextProgress === 100 ? 'done' : task.status);

    (await db.prepare(
      `UPDATE tasks
       SET title = COALESCE(?, title),
           assignee_name = COALESCE(?, assignee_name),
           priority = COALESCE(?, priority),
           estimated_hours = COALESCE(?, estimated_hours),
           due_date = COALESCE(?, due_date),
           status = ?,
           progress = ?,
           logged_hours = ?
       WHERE id = ?`
    ).run(
      title ? String(title).trim() : null,
      assigneeName !== undefined ? String(assigneeName).trim() : null,
      ['low', 'medium', 'high'].includes(priority) ? priority : null,
      estimatedHours !== undefined ? Number(estimatedHours) : null,
      dueDate !== undefined ? String(dueDate).trim() : null,
      nextStatus,
      nextProgress,
      nextHours,
      id
    ));

    // Recompute parent project progress automatically
    const avgRow = (await db
      .prepare('SELECT COALESCE(AVG(progress), 0) AS avg_prog FROM tasks WHERE project_id = ?')
      .get(task.project_id)) as { avg_prog: number };
    (await db.prepare('UPDATE projects SET progress = ? WHERE id = ?').run(Math.round(avgRow.avg_prog), task.project_id));

    res.json((await db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)));
  });

  router.delete('/tasks/:id', authenticate, requirePermission('projects', 'delete'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const task = (await db.prepare('SELECT id, ref, title, project_id FROM tasks WHERE id = ?').get(id)) as
      | { id: number; ref: string; title: string; project_id: number }
      | undefined;
    if (!task) {
      res.status(404).json({ error: 'Task not found.' });
      return;
    }
    (await db.prepare('DELETE FROM tasks WHERE id = ?').run(id));
    const avgRow = (await db
      .prepare('SELECT COALESCE(AVG(progress), 0) AS avg_prog FROM tasks WHERE project_id = ?')
      .get(task.project_id)) as { avg_prog: number };
    (await db.prepare('UPDATE projects SET progress = ? WHERE id = ?').run(Math.round(avgRow.avg_prog), task.project_id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_TASK',
      module: 'projects',
      entityRef: task.ref,
      details: `Deleted task ${task.title}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  // ========================
  // ADMINISTRATION, RBAC & AUDIT
  // ========================

  router.get('/admin/permission-catalog', authenticate, requirePermission('admin', 'read'), async (_req, res) => {
    res.json({ catalog: PERMISSION_CATALOG });
  });

  router.get('/admin/roles', authenticate, requirePermission('admin', 'read'), async (_req, res) => {
    const roles = (await db
      .prepare(
        `SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count
         FROM roles r
         ORDER BY r.is_system DESC, r.id ASC`
      )
      .all()) as unknown as Array<Record<string, unknown>>;

    res.json({
      roles: roles.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        permissions: parsePermissions(String(r.permissions_json)),
        requireMfa: Boolean(r.require_mfa),
        isSystem: Boolean(r.is_system),
        userCount: Number(r.user_count ?? 0),
        createdAt: r.created_at,
      })),
    });
  });

  router.post('/admin/roles', authenticate, requirePermission('admin', 'manage_roles'), async (req: AuthenticatedRequest, res) => {
    const { name, description = '', permissions = {}, requireMfa = false } = req.body ?? {};
    const cleanName = String(name ?? '').trim();
    if (!cleanName) {
      res.status(400).json({ error: 'Role name is required.' });
      return;
    }
    const slug = cleanName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    if (!slug) {
      res.status(400).json({ error: 'Invalid role name.' });
      return;
    }
    try {
      const info = (await db
        .prepare(
          `INSERT INTO roles (slug, name, description, permissions_json, require_mfa, is_system)
           VALUES (?, ?, ?, ?, ?, 0)`
        )
        .run(slug, cleanName, String(description).trim(), JSON.stringify(permissions), requireMfa ? 1 : 0));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'CREATE_ROLE',
        module: 'admin',
        entityRef: slug,
        details: `Created RBAC role ${cleanName}`,
        ipAddress: getClientIp(req),
      }));
      res.status(201).json({ id: Number(info.lastInsertRowid), slug, name: cleanName });
    } catch {
      res.status(400).json({ error: 'A role with a similar slug already exists.' });
    }
  });

  router.put('/admin/roles/:id', authenticate, requirePermission('admin', 'manage_roles'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM roles WHERE id = ?').get(id)) as
      | { id: number; slug: string; name: string; is_system: number }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Role not found.' });
      return;
    }
    const { name, description, permissions, requireMfa } = req.body ?? {};
    let nextPermissions = permissions as PermissionMap | undefined;
    if (existing.slug === 'super_admin' && nextPermissions) {
      // Prevent locking out Super Admin from admin/audit controls
      nextPermissions = {
        ...nextPermissions,
        admin: ['read', 'write', 'manage_roles', 'unlock_users'],
        audit: ['read', 'export'],
      };
    }

    (await db.prepare(
      `UPDATE roles
       SET name = COALESCE(?, name),
           description = COALESCE(?, description),
           permissions_json = COALESCE(?, permissions_json),
           require_mfa = COALESCE(?, require_mfa)
       WHERE id = ?`
    ).run(
      name ? String(name).trim() : null,
      description !== undefined ? String(description).trim() : null,
      nextPermissions ? JSON.stringify(nextPermissions) : null,
      requireMfa !== undefined ? (requireMfa ? 1 : 0) : null,
      id
    ));

    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_ROLE_PERMISSIONS',
      module: 'admin',
      entityRef: existing.slug,
      details: `Updated permissions/MFA policy for role ${existing.name}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.delete('/admin/roles/:id', authenticate, requirePermission('admin', 'manage_roles'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM roles WHERE id = ?').get(id)) as
      | { id: number; slug: string; name: string; is_system: number }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Role not found.' });
      return;
    }
    if (existing.is_system === 1) {
      res.status(400).json({ error: 'System Super Admin role cannot be deleted.' });
      return;
    }
    const assigned = (await db.prepare('SELECT COUNT(*) AS cnt FROM users WHERE role_id = ?').get(id)) as { cnt: number };
    if (assigned.cnt > 0) {
      res.status(409).json({ error: `Reassign ${assigned.cnt} user(s) before deleting this role.` });
      return;
    }
    (await db.prepare('DELETE FROM roles WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_ROLE',
      module: 'admin',
      entityRef: existing.slug,
      details: `Deleted role ${existing.name}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.get('/admin/users', authenticate, requirePermission('admin', 'read'), async (_req, res) => {
    const rows = (await db
      .prepare(
        `SELECT u.*, r.slug AS role_slug, r.name AS role_name, r.permissions_json, r.require_mfa AS role_require_mfa
         FROM users u
         JOIN roles r ON r.id = u.role_id
         ORDER BY u.id ASC`
      )
      .all()) as unknown as AuthUserRow[];
    res.json({ users: rows.map(sanitizeUser) });
  });

  router.post('/admin/users', authenticate, requirePermission('admin', 'write'), async (req: AuthenticatedRequest, res) => {
    const { fullName, username, email, password, roleId } = req.body ?? {};
    const policy = (await getSecurityPolicy());
    const cleanName = String(fullName ?? '').trim();
    const cleanUsername = String(username ?? '').trim().toLowerCase();
    const cleanEmail = String(email ?? '').trim().toLowerCase();
    const rawPass = String(password ?? '');

    if (!cleanName || !cleanUsername || !cleanEmail.includes('@') || !roleId) {
      res.status(400).json({ error: 'Full name, username, valid email, and role are required.' });
      return;
    }
    if (rawPass.length < policy.min_password_length) {
      res.status(400).json({ error: `Password must be at least ${policy.min_password_length} characters.` });
      return;
    }
    const role = (await db.prepare('SELECT id, name FROM roles WHERE id = ?').get(Number(roleId))) as
      | { id: number; name: string }
      | undefined;
    if (!role) {
      res.status(400).json({ error: 'Selected role does not exist.' });
      return;
    }

    try {
      const info = (await db
        .prepare(
          `INSERT INTO users (username, email, full_name, password_hash, role_id, is_active, mfa_enabled)
           VALUES (?, ?, ?, ?, ?, 1, 0)`
        )
        .run(cleanUsername, cleanEmail, cleanName, hashPassword(rawPass), role.id));

      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'CREATE_USER',
        module: 'admin',
        entityRef: cleanUsername,
        details: `Created user ${cleanEmail} with role ${role.name}`,
        ipAddress: getClientIp(req),
      }));

      const created = (await getUserWithRoleById(Number(info.lastInsertRowid)))!;
      res.status(201).json({ user: sanitizeUser(created) });
    } catch {
      res.status(409).json({ error: 'Username or email address already exists.' });
    }
  });

  router.put('/admin/users/:id', authenticate, requirePermission('admin', 'write'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const target = (await getUserWithRoleById(id));
    if (!target) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const { fullName, email, username, roleId, isActive, newPassword, unlockAccount, resetMfa } = req.body ?? {};
    const policy = (await getSecurityPolicy());

    if (id === req.authUser!.id && isActive === false) {
      res.status(400).json({ error: 'You cannot deactivate your own active account.' });
      return;
    }

    if ((unlockAccount || resetMfa) && !hasPermission(req.authPermissions, 'admin', 'unlock_users')) {
      res.status(403).json({ error: 'Permission "admin.unlock_users" is required to unlock accounts or reset MFA.' });
      return;
    }

    if (newPassword) {
      if (String(newPassword).length < policy.min_password_length) {
        res.status(400).json({ error: `Password must be at least ${policy.min_password_length} characters.` });
        return;
      }
      (await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(newPassword)), id));
    }

    if (unlockAccount) {
      (await db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(id));
    }

    if (resetMfa) {
      (await db.prepare(
        `UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, mfa_pending_secret = NULL, recovery_codes_json = '[]' WHERE id = ?`
      ).run(id));
    }

    try {
      (await db.prepare(
        `UPDATE users
         SET full_name = COALESCE(?, full_name),
             email = COALESCE(?, email),
             username = COALESCE(?, username),
             role_id = COALESCE(?, role_id),
             is_active = COALESCE(?, is_active)
         WHERE id = ?`
      ).run(
        fullName ? String(fullName).trim() : null,
        email && String(email).includes('@') ? String(email).trim().toLowerCase() : null,
        username ? String(username).trim().toLowerCase() : null,
        roleId ? Number(roleId) : null,
        isActive !== undefined ? (isActive ? 1 : 0) : null,
        id
      ));
    } catch {
      res.status(409).json({ error: 'Username or email address already exists.' });
      return;
    }

    if (isActive === false) {
      (await db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ?').run(id));
    }

    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: resetMfa ? 'ADMIN_RESET_MFA' : unlockAccount ? 'ADMIN_UNLOCK_USER' : 'UPDATE_USER',
      module: 'admin',
      entityRef: target.username,
      details: `Updated user ${target.email}`,
      ipAddress: getClientIp(req),
      severity: resetMfa || isActive === false ? 'warning' : 'info',
    }));

    res.json({ user: sanitizeUser((await getUserWithRoleById(id))!) });
  });

  router.delete('/admin/users/:id', authenticate, requirePermission('admin', 'write'), async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    const target = (await getUserWithRoleById(id));
    if (!target) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    if (id === req.authUser!.id) {
      res.status(400).json({ error: 'You cannot delete your own active account.' });
      return;
    }
    if (target.role_slug === 'super_admin') {
      const superAdmins = ((await db.prepare(`SELECT COUNT(*) AS cnt FROM users u JOIN roles r ON r.id = u.role_id WHERE r.slug = 'super_admin'`).get()) as { cnt: number }).cnt;
      if (superAdmins <= 1) {
        res.status(409).json({ error: 'Cannot delete the last Super Admin user.' });
        return;
      }
    }
    (await db.prepare('DELETE FROM users WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_USER',
      module: 'admin',
      entityRef: target.username,
      details: `Deleted user ${target.email}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.get('/admin/policy', authenticate, requirePermission('admin', 'read'), async (_req, res) => {
    res.json({ policy: (await getSecurityPolicy()) });
  });

  router.put('/admin/policy', authenticate, requirePermission('admin', 'manage_roles'), async (req: AuthenticatedRequest, res) => {
    const { maxFailedAttempts, lockoutMinutes, sessionTtlHours, enforceMfaGlobal, minPasswordLength } = req.body ?? {};
    (await db.prepare(
      `UPDATE security_policy
       SET max_failed_attempts = COALESCE(?, max_failed_attempts),
           lockout_minutes = COALESCE(?, lockout_minutes),
           session_ttl_hours = COALESCE(?, session_ttl_hours),
           enforce_mfa_global = COALESCE(?, enforce_mfa_global),
           min_password_length = COALESCE(?, min_password_length),
           updated_at = datetime('now')
       WHERE id = 1`
    ).run(
      maxFailedAttempts !== undefined ? Math.min(20, Math.max(2, Number(maxFailedAttempts))) : null,
      lockoutMinutes !== undefined ? Math.min(1440, Math.max(1, Number(lockoutMinutes))) : null,
      sessionTtlHours !== undefined ? Math.min(168, Math.max(1, Number(sessionTtlHours))) : null,
      enforceMfaGlobal !== undefined ? (enforceMfaGlobal ? 1 : 0) : null,
      minPasswordLength !== undefined ? Math.min(32, Math.max(8, Number(minPasswordLength))) : null
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_SECURITY_POLICY',
      module: 'admin',
      details: 'Updated organization authentication & MFA policy',
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ policy: (await getSecurityPolicy()) });
  });

  router.get('/admin/settings', authenticate, requirePermission('admin', 'read'), async (_req, res) => {
    res.json({ settings: (await getSystemSettings()) });
  });

  router.put('/admin/settings', authenticate, requirePermission('admin', 'write'), async (req: AuthenticatedRequest, res) => {
    const {
      appName,
      companyName,
      companyEmail,
      companyPhone,
      companyAddress,
      taxId,
      defaultCurrency,
      defaultTaxRate,
      defaultPaymentTerms,
      defaultIncoterm,
      fiscalYearStart,
      dateFormat,
    } = req.body ?? {};

    const cleanAppName = String(appName ?? 'KSCAT-ERP').trim() || 'KSCAT-ERP';
    const cleanCompany = String(companyName ?? 'KS Cross Asia Technologies Inc.').trim() || 'KS Cross Asia Technologies Inc.';
    const cleanCurrency = String(defaultCurrency ?? 'USD').trim().toUpperCase().slice(0, 3) || 'USD';
    const taxRate = Number(defaultTaxRate);
    const fiscalStart = Number(fiscalYearStart);

    (await db.prepare(
      `UPDATE system_settings
       SET app_name = ?,
           company_name = ?,
           company_email = ?,
           company_phone = ?,
           company_address = ?,
           tax_id = ?,
           default_currency = ?,
           default_tax_rate = ?,
           default_payment_terms = ?,
           default_incoterm = ?,
           fiscal_year_start = ?,
           date_format = ?,
           updated_at = datetime('now')
       WHERE id = 1`
    ).run(
      cleanAppName,
      cleanCompany,
      String(companyEmail ?? '').trim(),
      String(companyPhone ?? '').trim(),
      String(companyAddress ?? '').trim(),
      String(taxId ?? '').trim(),
      cleanCurrency,
      Number.isFinite(taxRate) ? Math.min(50, Math.max(0, taxRate)) : 12.0,
      String(defaultPaymentTerms ?? 'Net 30').trim() || 'Net 30',
      String(defaultIncoterm ?? 'FOB').trim() || 'FOB',
      Number.isFinite(fiscalStart) ? Math.min(12, Math.max(1, fiscalStart)) : 1,
      String(dateFormat ?? 'MMM d, yyyy').trim() || 'MMM d, yyyy'
    ));

    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_SYSTEM_SETTINGS',
      module: 'admin',
      entityRef: cleanAppName,
      details: `Updated system settings (${cleanCompany}, currency: ${cleanCurrency})`,
      ipAddress: getClientIp(req),
      severity: 'info',
    }));

    res.json({ settings: (await getSystemSettings()) });
  });

  function buildAuditFilterClause(query: Record<string, unknown>) {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    const category = String(query.category ?? 'all');
    if (category === 'authentication') {
      conditions.push(
        `action IN ('LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGIN_MFA_SUCCESS', 'MFA_FAILED', 'MFA_RECOVERY_USED', 'MFA_RECOVERY_FAILED', 'MFA_ENROLLED', 'MFA_DISABLED', 'ACCOUNT_LOCKED', 'LOGOUT', 'SESSION_REVOKED')`
      );
    } else if (category === 'permissions') {
      conditions.push(
        `action IN ('CREATE_ROLE', 'UPDATE_ROLE_PERMISSIONS', 'DELETE_ROLE', 'UPDATE_SECURITY_POLICY', 'PERMISSION_DENIED', 'CREATE_USER', 'UPDATE_USER', 'ADMIN_UNLOCK_USER', 'ADMIN_RESET_MFA', 'WORKSPACE_BOOTSTRAP')`
      );
    } else if (category === 'deletions') {
      conditions.push(`action LIKE 'DELETE_%'`);
    } else if (category === 'operations') {
      conditions.push(
        `action NOT IN ('LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGIN_MFA_SUCCESS', 'MFA_FAILED', 'MFA_RECOVERY_USED', 'MFA_RECOVERY_FAILED', 'MFA_ENROLLED', 'MFA_DISABLED', 'ACCOUNT_LOCKED', 'LOGOUT', 'SESSION_REVOKED', 'CREATE_ROLE', 'UPDATE_ROLE_PERMISSIONS', 'DELETE_ROLE', 'UPDATE_SECURITY_POLICY', 'PERMISSION_DENIED', 'CREATE_USER', 'UPDATE_USER', 'ADMIN_UNLOCK_USER', 'ADMIN_RESET_MFA', 'WORKSPACE_BOOTSTRAP') AND action NOT LIKE 'DELETE_%'`
      );
    }

    const severity = String(query.severity ?? 'all');
    if (severity === 'info' || severity === 'warning' || severity === 'critical') {
      conditions.push('severity = ?');
      params.push(severity);
    }

    const search = String(query.search ?? '').trim().toLowerCase();
    if (search) {
      const pattern = `%${search}%`;
      conditions.push(
        `(LOWER(user_email) LIKE ? OR LOWER(action) LIKE ? OR LOWER(module) LIKE ? OR LOWER(entity_ref) LIKE ? OR LOWER(details) LIKE ? OR LOWER(ip_address) LIKE ?)`
      );
      params.push(pattern, pattern, pattern, pattern, pattern, pattern);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderDir = String(query.sort ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const limit = Math.min(500, Math.max(10, Number(query.limit) || 250));

    return { whereClause, params, orderDir, limit };
  }

  router.get('/admin/audit-logs', authenticate, requirePermission('audit', 'read'), async (req, res) => {
    const { whereClause, params, orderDir, limit } = buildAuditFilterClause(req.query as Record<string, unknown>);
    const logs = (await db
      .prepare(`SELECT * FROM audit_logs ${whereClause} ORDER BY created_at ${orderDir}, id ${orderDir} LIMIT ?`)
      .all(...params, limit));

    const summary = (await db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN action IN ('LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGIN_MFA_SUCCESS', 'MFA_FAILED', 'MFA_RECOVERY_USED', 'MFA_RECOVERY_FAILED', 'MFA_ENROLLED', 'MFA_DISABLED', 'ACCOUNT_LOCKED', 'LOGOUT', 'SESSION_REVOKED') THEN 1 ELSE 0 END), 0) AS auth_count,
           COALESCE(SUM(CASE WHEN action IN ('CREATE_ROLE', 'UPDATE_ROLE_PERMISSIONS', 'DELETE_ROLE', 'UPDATE_SECURITY_POLICY', 'PERMISSION_DENIED', 'CREATE_USER', 'UPDATE_USER', 'ADMIN_UNLOCK_USER', 'ADMIN_RESET_MFA', 'WORKSPACE_BOOTSTRAP') THEN 1 ELSE 0 END), 0) AS permission_count,
           COALESCE(SUM(CASE WHEN action LIKE 'DELETE_%' THEN 1 ELSE 0 END), 0) AS deletion_count,
           COALESCE(SUM(CASE WHEN severity IN ('warning', 'critical') THEN 1 ELSE 0 END), 0) AS alert_count
         FROM audit_logs`
      )
      .get()) as {
      total: number;
      auth_count: number;
      permission_count: number;
      deletion_count: number;
      alert_count: number;
    };

    res.json({ logs, summary });
  });

  router.get('/admin/audit-logs/export', authenticate, requirePermission('audit', 'export'), async (req: AuthenticatedRequest, res) => {
    const { whereClause, params, orderDir } = buildAuditFilterClause(req.query as Record<string, unknown>);
    const logs = (await db
      .prepare(`SELECT * FROM audit_logs ${whereClause} ORDER BY created_at ${orderDir}, id ${orderDir} LIMIT 1000`)
      .all(...params)) as unknown as Array<Record<string, unknown>>;

    const sanitizeCsvCell = (val: unknown): string => {
      let s = String(val ?? '');
      if (/^[=+\-@\t\r]/.test(s)) {
        s = `'${s}`;
      }
      return `"${s.replace(/"/g, '""')}"`;
    };

    const header = ['ID', 'Timestamp (UTC)', 'Actor Email', 'Module', 'Action', 'Entity Ref', 'Severity', 'IP Address', 'Details']
      .map(sanitizeCsvCell)
      .join(',');
    const rows = logs.map((l) =>
      [l.id, l.created_at, l.user_email, l.module, l.action, l.entity_ref, l.severity, l.ip_address, l.details]
        .map(sanitizeCsvCell)
        .join(',')
    );
    const csv = [header, ...rows].join('\n');

    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'EXPORT_AUDIT_LOGS',
      module: 'audit',
      details: `Exported ${logs.length} audit log record(s) to CSV`,
      ipAddress: getClientIp(req),
      severity: 'info',
    });

    res.json({ csv, count: logs.length });
  });

  router.use(
    createExtraApiRouter(db, env, {
      authenticate,
      requirePermission,
      getClientIp,
      applyStockAdjustment,
      nextSequenceRef: nextDocRef,
    })
  );

  return router;
}

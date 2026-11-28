import crypto from 'node:crypto';
import { runErpAiAssist } from './ai.ts';
import type { AppEnv, DbClient } from './db_adapter.ts';
import { getEnabledModulesMap, writeAuditLog } from './db.ts';
import { hasPermission, type PermissionAction, type PermissionMap, type PermissionModule } from './rbac.ts';
import type { AuthenticatedRequest } from './routes.ts';
import { createCurrencyService } from './services/currencyService.ts';
import { WebRouter, type ApiRequest, type ApiResponse, type NextFunction } from './web_router.ts';

export type AuthenticatedReq = AuthenticatedRequest;

export interface ExtraRouterDeps {
  authenticate: (req: AuthenticatedReq, res: ApiResponse, next: NextFunction) => Promise<void>;
  requirePermission: (
    module: PermissionModule,
    action: PermissionAction
  ) => (req: AuthenticatedReq, res: ApiResponse, next: NextFunction) => Promise<void>;
  getClientIp: (req: ApiRequest) => string;
  applyStockAdjustment: (params: {
    productId: number;
    warehouseId: number;
    delta: number;
    movementType: 'in' | 'out' | 'transfer' | 'adjustment';
    reason: string;
    docRef: string;
    actorEmail: string;
  }) => Promise<void>;
  nextSequenceRef: (table: string, prefix: string) => Promise<string>;
}

function isValidHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isIpv4Address(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

function isPrivateOrBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '::1' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal') ||
    lower === 'metadata.google.internal' ||
    lower.startsWith('fe80:') ||
    lower.startsWith('fc') ||
    lower.startsWith('fd')
  ) {
    return true;
  }
  if (isIpv4Address(lower)) {
    const parts = lower.split('.').map(Number);
    if (
      parts[0] === 10 ||
      parts[0] === 127 ||
      parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    ) {
      return true;
    }
  }
  return false;
}

function sanitizeCsvCell(val: unknown): string {
  let s = String(val ?? '');
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  return `"${s.replace(/"/g, '""')}"`;
}

function escapeXml(raw: unknown): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function createExtraApiRouter(db: DbClient, env: AppEnv, deps: ExtraRouterDeps): WebRouter {
  const router = new WebRouter();
  const { authenticate, requirePermission, getClientIp, applyStockAdjustment, nextSequenceRef } = deps;

  async function seqRef(table: string, prefix: string): Promise<string> {
    const ym = new Date().toISOString().slice(2, 7).replace('-', '');
    const fullPrefix = `${prefix}${ym}-`;
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

  // ========================
  // OPTIONAL MODULES MANAGER
  // ========================
  router.get('/modules', authenticate, async (_req, res) => {
    const modules = (await db.prepare('SELECT * FROM modules_config ORDER BY category ASC, module_key ASC').all());
    res.json({ modules, enabledModules: (await getEnabledModulesMap(db)) });
  });

  router.put('/modules/:key', authenticate, requirePermission('admin', 'write'), async (req: AuthenticatedReq, res) => {
    const key = String(req.params.key ?? '').trim();
    const existing = (await db.prepare('SELECT * FROM modules_config WHERE module_key = ?').get(key)) as
      | { module_key: string; name: string; locked: number }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Module not found.' });
      return;
    }
    const { enabled } = req.body ?? {};
    if (existing.locked === 1 && !enabled) {
      res.status(400).json({ error: 'Core Administration & Security module cannot be disabled.' });
      return;
    }
    (await db.prepare(`UPDATE modules_config SET enabled = ?, updated_at = datetime('now') WHERE module_key = ?`).run(
      enabled ? 1 : 0,
      key
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: enabled ? 'ENABLE_MODULE' : 'DISABLE_MODULE',
      module: 'admin',
      entityRef: key,
      details: `${enabled ? 'Enabled' : 'Disabled'} optional ERP module: ${existing.name}`,
      ipAddress: getClientIp(req),
      severity: 'info',
    }));
    res.json({ ok: true, enabledModules: (await getEnabledModulesMap(db)) });
  });

  // ========================
  // MEMBERS & PARTNERSHIPS
  // ========================
  router.get('/members', authenticate, requirePermission('crm', 'read'), async (_req, res) => {
    const members = (await db.prepare('SELECT * FROM members ORDER BY id DESC').all());
    const partnerships = (await db
      .prepare(
        `SELECT pt.*, tp.name AS party_name, tp.ref AS party_ref
         FROM partnerships pt
         JOIN third_parties tp ON tp.id = pt.third_party_id
         ORDER BY pt.id DESC`
      )
      .all());
    res.json({ members, partnerships });
  });

  router.post('/members', authenticate, requirePermission('crm', 'write'), async (req: AuthenticatedReq, res) => {
    const {
      fullName,
      organization = '',
      memberType = 'Individual',
      email = '',
      phone = '',
      subscriptionFee = 150,
      startDate,
      expiryDate,
      notes = '',
    } = req.body ?? {};
    if (!String(fullName ?? '').trim()) {
      res.status(400).json({ error: 'Member name is required.' });
      return;
    }
    const ref = (await seqRef('members', 'MEM'));
    const today = new Date().toISOString().slice(0, 10);
    const nextYear = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
    const info = (await db
      .prepare(
        `INSERT INTO members (ref, full_name, organization, member_type, email, phone, subscription_fee, start_date, expiry_date, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
      )
      .run(
        ref,
        String(fullName).trim(),
        String(organization).trim(),
        ['Individual', 'Corporate', 'Foundation Patron', 'Student'].includes(memberType) ? memberType : 'Individual',
        String(email).trim(),
        String(phone).trim(),
        Number(subscriptionFee) || 0,
        String(startDate || today),
        String(expiryDate || nextYear),
        String(notes).trim()
      ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_MEMBER',
      module: 'crm',
      entityRef: ref,
      details: `Enrolled member ${fullName}`,
      ipAddress: getClientIp(req),
    }));
    res.status(201).json((await db.prepare('SELECT * FROM members WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.post('/members/:id/renew', authenticate, requirePermission('crm', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const m = (await db.prepare('SELECT * FROM members WHERE id = ?').get(id)) as
      | { id: number; ref: string; full_name: string; expiry_date: string }
      | undefined;
    if (!m) {
      res.status(404).json({ error: 'Member not found.' });
      return;
    }
    const baseTime = Math.max(Date.now(), new Date(m.expiry_date || Date.now()).getTime());
    const nextExpiry = new Date(baseTime + 365 * 86400000).toISOString().slice(0, 10);
    (await db.prepare(`UPDATE members SET expiry_date = ?, status = 'active' WHERE id = ?`).run(nextExpiry, id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'RENEW_MEMBER',
      module: 'crm',
      entityRef: m.ref,
      details: `Renewed membership for ${m.full_name} until ${nextExpiry}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM members WHERE id = ?').get(id)));
  });

  router.put('/members/:id', authenticate, requirePermission('crm', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM members WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Member not found.' });
      return;
    }
    const { fullName, organization, memberType, email, phone, subscriptionFee, startDate, expiryDate, status, notes } = req.body ?? {};
    (await db.prepare(
      `UPDATE members
       SET full_name = COALESCE(?, full_name),
           organization = COALESCE(?, organization),
           member_type = COALESCE(?, member_type),
           email = COALESCE(?, email),
           phone = COALESCE(?, phone),
           subscription_fee = COALESCE(?, subscription_fee),
           start_date = COALESCE(?, start_date),
           expiry_date = COALESCE(?, expiry_date),
           status = COALESCE(?, status),
           notes = COALESCE(?, notes)
       WHERE id = ?`
    ).run(
      fullName ? String(fullName).trim() : null,
      organization !== undefined ? String(organization).trim() : null,
      ['Individual', 'Corporate', 'Foundation Patron', 'Student'].includes(memberType) ? memberType : null,
      email !== undefined ? String(email).trim() : null,
      phone !== undefined ? String(phone).trim() : null,
      subscriptionFee !== undefined ? Number(subscriptionFee) : null,
      startDate ? String(startDate) : null,
      expiryDate ? String(expiryDate) : null,
      ['draft', 'active', 'expired', 'resiliated'].includes(status) ? status : null,
      notes !== undefined ? String(notes).trim() : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_MEMBER',
      module: 'crm',
      entityRef: existing.ref,
      details: `Updated member ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM members WHERE id = ?').get(id)));
  });

  router.delete('/members/:id', authenticate, requirePermission('crm', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, full_name FROM members WHERE id = ?').get(id)) as { ref: string; full_name: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Member not found.' });
      return;
    }
    (await db.prepare('DELETE FROM members WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_MEMBER',
      module: 'crm',
      entityRef: existing.ref,
      details: `Deleted member ${existing.full_name}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.post('/partnerships', authenticate, requirePermission('crm', 'write'), async (req: AuthenticatedReq, res) => {
    const { thirdPartyId, partnerTier = 'Silver', commissionPct = 10, startDate, endDate, notes = '' } = req.body ?? {};
    if (!thirdPartyId) {
      res.status(400).json({ error: 'Third party is required.' });
      return;
    }
    const ref = (await seqRef('partnerships', 'PTN'));
    const today = new Date().toISOString().slice(0, 10);
    const nextYear = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
    const info = (await db
      .prepare(
        `INSERT INTO partnerships (ref, third_party_id, partner_tier, commission_pct, start_date, end_date, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`
      )
      .run(
        ref,
        Number(thirdPartyId),
        ['Referral', 'Silver', 'Gold', 'Strategic'].includes(partnerTier) ? partnerTier : 'Silver',
        Math.min(100, Math.max(0, Number(commissionPct) || 0)),
        String(startDate || today),
        String(endDate || nextYear),
        String(notes).trim()
      ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_PARTNERSHIP',
      module: 'crm',
      entityRef: ref,
      details: `Created ${partnerTier} partnership (${commissionPct}%)`,
      ipAddress: getClientIp(req),
    }));
    res.status(201).json((await db.prepare('SELECT * FROM partnerships WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/partnerships/:id', authenticate, requirePermission('crm', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM partnerships WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Partnership not found.' });
      return;
    }
    const { thirdPartyId, partnerTier, commissionPct, startDate, endDate, status, notes } = req.body ?? {};
    (await db.prepare(
      `UPDATE partnerships
       SET third_party_id = COALESCE(?, third_party_id),
           partner_tier = COALESCE(?, partner_tier),
           commission_pct = COALESCE(?, commission_pct),
           start_date = COALESCE(?, start_date),
           end_date = COALESCE(?, end_date),
           status = COALESCE(?, status),
           notes = COALESCE(?, notes)
       WHERE id = ?`
    ).run(
      thirdPartyId !== undefined ? Number(thirdPartyId) : null,
      ['Referral', 'Silver', 'Gold', 'Strategic'].includes(partnerTier) ? partnerTier : null,
      commissionPct !== undefined ? Math.min(100, Math.max(0, Number(commissionPct) || 0)) : null,
      startDate ? String(startDate) : null,
      endDate ? String(endDate) : null,
      ['pending', 'active', 'paused', 'closed'].includes(status) ? status : null,
      notes !== undefined ? String(notes).trim() : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_PARTNERSHIP',
      module: 'crm',
      entityRef: existing.ref,
      details: `Updated partnership ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM partnerships WHERE id = ?').get(id)));
  });

  router.delete('/partnerships/:id', authenticate, requirePermission('crm', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM partnerships WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Partnership not found.' });
      return;
    }
    (await db.prepare('DELETE FROM partnerships WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_PARTNERSHIP',
      module: 'crm',
      entityRef: existing.ref,
      details: `Deleted partnership ${existing.ref}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  // ========================
  // PRODUCT LOTS & VARIANTS
  // ========================
  router.get('/product-extensions', authenticate, requirePermission('products', 'read'), async (_req, res) => {
    const lots = (await db
      .prepare(
        `SELECT pl.*, p.ref AS product_ref, p.name AS product_name, w.name AS warehouse_name
         FROM product_lots pl
         JOIN products p ON p.id = pl.product_id
         JOIN warehouses w ON w.id = pl.warehouse_id
         ORDER BY pl.id DESC`
      )
      .all());
    const variants = (await db
      .prepare(
        `SELECT pv.*, p.ref AS product_ref, p.name AS product_name, p.sell_price AS base_sell_price
         FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
         ORDER BY pv.id DESC`
      )
      .all());
    res.json({ lots, variants });
  });

  router.post('/product-lots', authenticate, requirePermission('products', 'write'), async (req: AuthenticatedReq, res) => {
    const { productId, warehouseId, lotNumber, serialNumber = '', quantity = 0, manufactureDate = '', expiryDate = '' } = req.body ?? {};
    if (!productId || !warehouseId || !String(lotNumber ?? '').trim()) {
      res.status(400).json({ error: 'Product, warehouse, and lot number are required.' });
      return;
    }
    const info = (await db
      .prepare(
        `INSERT INTO product_lots (product_id, warehouse_id, lot_number, serial_number, quantity, manufacture_date, expiry_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'available')`
      )
      .run(
        Number(productId),
        Number(warehouseId),
        String(lotNumber).trim(),
        String(serialNumber).trim(),
        Math.max(0, Number(quantity) || 0),
        String(manufactureDate).trim(),
        String(expiryDate).trim()
      ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_LOT',
      module: 'products',
      entityRef: String(lotNumber).trim(),
      details: `Registered lot ${lotNumber} (qty: ${quantity})`,
      ipAddress: getClientIp(req),
    }));
    res.status(201).json((await db.prepare('SELECT * FROM product_lots WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/product-lots/:id', authenticate, requirePermission('products', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT lot_number FROM product_lots WHERE id = ?').get(id)) as { lot_number: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Product lot not found.' });
      return;
    }
    const { productId, warehouseId, lotNumber, serialNumber, quantity, manufactureDate, expiryDate, status } = req.body ?? {};
    (await db.prepare(
      `UPDATE product_lots
       SET product_id = COALESCE(?, product_id),
           warehouse_id = COALESCE(?, warehouse_id),
           lot_number = COALESCE(?, lot_number),
           serial_number = COALESCE(?, serial_number),
           quantity = COALESCE(?, quantity),
           manufacture_date = COALESCE(?, manufacture_date),
           expiry_date = COALESCE(?, expiry_date),
           status = COALESCE(?, status)
       WHERE id = ?`
    ).run(
      productId !== undefined ? Number(productId) : null,
      warehouseId !== undefined ? Number(warehouseId) : null,
      lotNumber ? String(lotNumber).trim() : null,
      serialNumber !== undefined ? String(serialNumber).trim() : null,
      quantity !== undefined ? Math.max(0, Number(quantity) || 0) : null,
      manufactureDate !== undefined ? String(manufactureDate).trim() : null,
      expiryDate !== undefined ? String(expiryDate).trim() : null,
      ['available', 'quarantine', 'consumed'].includes(status) ? status : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_LOT',
      module: 'products',
      entityRef: existing.lot_number,
      details: `Updated lot ${existing.lot_number}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM product_lots WHERE id = ?').get(id)));
  });

  router.delete('/product-lots/:id', authenticate, requirePermission('products', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT lot_number FROM product_lots WHERE id = ?').get(id)) as { lot_number: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Product lot not found.' });
      return;
    }
    (await db.prepare('DELETE FROM product_lots WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_LOT',
      module: 'products',
      entityRef: existing.lot_number,
      details: `Deleted lot ${existing.lot_number}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.post('/product-variants', authenticate, requirePermission('products', 'write'), async (req: AuthenticatedReq, res) => {
    const { productId, skuSuffix, attributeName, attributeValue, priceDelta = 0, stockQty = 0, barcode = '' } = req.body ?? {};
    if (!productId || !String(skuSuffix ?? '').trim() || !String(attributeName ?? '').trim() || !String(attributeValue ?? '').trim()) {
      res.status(400).json({ error: 'Product, SKU suffix, attribute name, and value are required.' });
      return;
    }
    const info = (await db
      .prepare(
        `INSERT INTO product_variants (product_id, sku_suffix, attribute_name, attribute_value, price_delta, stock_qty, barcode)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        Number(productId),
        String(skuSuffix).trim().toUpperCase(),
        String(attributeName).trim(),
        String(attributeValue).trim(),
        Number(priceDelta) || 0,
        Math.max(0, Number(stockQty) || 0),
        String(barcode).trim()
      ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_VARIANT',
      module: 'products',
      entityRef: String(skuSuffix).trim().toUpperCase(),
      details: `Added variant ${attributeName}: ${attributeValue}`,
      ipAddress: getClientIp(req),
    }));
    res.status(201).json((await db.prepare('SELECT * FROM product_variants WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/product-variants/:id', authenticate, requirePermission('products', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT sku_suffix FROM product_variants WHERE id = ?').get(id)) as { sku_suffix: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Product variant not found.' });
      return;
    }
    const { productId, skuSuffix, attributeName, attributeValue, priceDelta, stockQty, barcode } = req.body ?? {};
    (await db.prepare(
      `UPDATE product_variants
       SET product_id = COALESCE(?, product_id),
           sku_suffix = COALESCE(?, sku_suffix),
           attribute_name = COALESCE(?, attribute_name),
           attribute_value = COALESCE(?, attribute_value),
           price_delta = COALESCE(?, price_delta),
           stock_qty = COALESCE(?, stock_qty),
           barcode = COALESCE(?, barcode)
       WHERE id = ?`
    ).run(
      productId !== undefined ? Number(productId) : null,
      skuSuffix ? String(skuSuffix).trim().toUpperCase() : null,
      attributeName ? String(attributeName).trim() : null,
      attributeValue ? String(attributeValue).trim() : null,
      priceDelta !== undefined ? Number(priceDelta) : null,
      stockQty !== undefined ? Math.max(0, Number(stockQty) || 0) : null,
      barcode !== undefined ? String(barcode).trim() : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_VARIANT',
      module: 'products',
      entityRef: existing.sku_suffix,
      details: `Updated product variant ${existing.sku_suffix}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM product_variants WHERE id = ?').get(id)));
  });

  router.delete('/product-variants/:id', authenticate, requirePermission('products', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT sku_suffix FROM product_variants WHERE id = ?').get(id)) as { sku_suffix: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Product variant not found.' });
      return;
    }
    (await db.prepare('DELETE FROM product_variants WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_VARIANT',
      module: 'products',
      entityRef: existing.sku_suffix,
      details: `Deleted product variant ${existing.sku_suffix}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  // ========================
  // MANUFACTURING (WORKSTATIONS, BOM, MO)
  // ========================
  router.get('/manufacturing', authenticate, requirePermission('manufacturing', 'read'), async (_req, res) => {
    const workstations = (await db.prepare('SELECT * FROM workstations ORDER BY id ASC').all());
    const boms = (await db
      .prepare(
        `SELECT b.*, p.ref AS product_ref, p.name AS product_name, ws.name AS workstation_name
         FROM boms b
         JOIN products p ON p.id = b.product_id
         LEFT JOIN workstations ws ON ws.id = b.workstation_id
         ORDER BY b.id DESC`
      )
      .all());
    const orders = (await db
      .prepare(
        `SELECT mo.*, b.ref AS bom_ref, b.label AS bom_label, p.ref AS product_ref, p.name AS product_name,
                w.name AS warehouse_name, ws.name AS workstation_name
         FROM manufacturing_orders mo
         JOIN boms b ON b.id = mo.bom_id
         JOIN products p ON p.id = mo.product_id
         JOIN warehouses w ON w.id = mo.warehouse_id
         LEFT JOIN workstations ws ON ws.id = mo.workstation_id
         ORDER BY mo.id DESC`
      )
      .all());
    res.json({ workstations, boms, orders });
  });

  router.post('/workstations', authenticate, requirePermission('manufacturing', 'write'), async (req: AuthenticatedReq, res) => {
    const { ref, name, location = '', hourlyCost = 65, capacityPerDay = 8 } = req.body ?? {};
    const cleanRef = String(ref ?? '').trim().toUpperCase() || (await seqRef('workstations', 'WS'));
    if (!String(name ?? '').trim()) {
      res.status(400).json({ error: 'Workstation name is required.' });
      return;
    }
    try {
      const info = (await db
        .prepare(
          `INSERT INTO workstations (ref, name, location, hourly_cost, capacity_per_day, status)
           VALUES (?, ?, ?, ?, ?, 'operational')`
        )
        .run(cleanRef, String(name).trim(), String(location).trim(), Number(hourlyCost) || 0, Math.max(1, Number(capacityPerDay) || 8)));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'CREATE_WORKSTATION',
        module: 'manufacturing',
        entityRef: cleanRef,
        details: `Created workstation ${name}`,
        ipAddress: getClientIp(req),
      }));
      res.status(201).json((await db.prepare('SELECT * FROM workstations WHERE id = ?').get(info.lastInsertRowid)));
    } catch {
      res.status(400).json({ error: 'Workstation ref already exists.' });
    }
  });

  router.put('/workstations/:id', authenticate, requirePermission('manufacturing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM workstations WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Workstation not found.' });
      return;
    }
    const { name, location, hourlyCost, capacityPerDay, status } = req.body ?? {};
    (await db.prepare(
      `UPDATE workstations
       SET name = COALESCE(?, name),
           location = COALESCE(?, location),
           hourly_cost = COALESCE(?, hourly_cost),
           capacity_per_day = COALESCE(?, capacity_per_day),
           status = COALESCE(?, status)
       WHERE id = ?`
    ).run(
      name ? String(name).trim() : null,
      location !== undefined ? String(location).trim() : null,
      hourlyCost !== undefined ? Number(hourlyCost) : null,
      capacityPerDay !== undefined ? Math.max(1, Number(capacityPerDay) || 8) : null,
      ['operational', 'maintenance', 'offline'].includes(status) ? status : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_WORKSTATION',
      module: 'manufacturing',
      entityRef: existing.ref,
      details: `Updated workstation ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM workstations WHERE id = ?').get(id)));
  });

  router.delete('/workstations/:id', authenticate, requirePermission('manufacturing', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, name FROM workstations WHERE id = ?').get(id)) as { ref: string; name: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Workstation not found.' });
      return;
    }
    try {
      (await db.prepare('DELETE FROM workstations WHERE id = ?').run(id));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'DELETE_WORKSTATION',
        module: 'manufacturing',
        entityRef: existing.ref,
        details: `Deleted workstation ${existing.name}`,
        ipAddress: getClientIp(req),
        severity: 'warning',
      }));
      res.json({ ok: true });
    } catch {
      res.status(409).json({ error: 'Cannot delete workstation linked to existing BOMs or manufacturing orders.' });
    }
  });

  router.post('/boms', authenticate, requirePermission('manufacturing', 'write'), async (req: AuthenticatedReq, res) => {
    const { productId, workstationId = null, label, outputQty = 1, estimatedMinutes = 60, components } = req.body ?? {};
    if (!productId || !String(label ?? '').trim() || !Array.isArray(components) || components.length === 0) {
      res.status(400).json({ error: 'Finished product, label, and at least one BOM component are required.' });
      return;
    }
    const cleanComponents: Array<{ productId: number; ref: string; name: string; qty: number }> = [];
    for (const rawComp of components) {
      const c = rawComp as Record<string, unknown>;
      const compProd = (await db.prepare('SELECT id, ref, name FROM products WHERE id = ?').get(Number(c.productId))) as
        | { id: number; ref: string; name: string }
        | undefined;
      if (!compProd) {
        res.status(400).json({ error: 'Selected component product does not exist.' });
        return;
      }
      const qty = Math.max(1, Number(c.qty) || 1);
      cleanComponents.push({ productId: compProd.id, ref: compProd.ref, name: compProd.name, qty });
    }
    const ref = (await seqRef('boms', 'BOM'));
    const info = (await db
      .prepare(
        `INSERT INTO boms (ref, product_id, workstation_id, label, output_qty, components_json, estimated_minutes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`
      )
      .run(
        ref,
        Number(productId),
        workstationId ? Number(workstationId) : null,
        String(label).trim(),
        Math.max(1, Number(outputQty) || 1),
        JSON.stringify(cleanComponents),
        Math.max(1, Number(estimatedMinutes) || 60)
      ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_BOM',
      module: 'manufacturing',
      entityRef: ref,
      details: `Created BOM ${label} (${cleanComponents.length} components)`,
      ipAddress: getClientIp(req),
    }));
    res.status(201).json((await db.prepare('SELECT * FROM boms WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/boms/:id', authenticate, requirePermission('manufacturing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM boms WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'BOM not found.' });
      return;
    }
    const { productId, workstationId, label, outputQty, estimatedMinutes, components, status } = req.body ?? {};
    let cleanComponentsJson: string | null = null;
    if (Array.isArray(components) && components.length > 0) {
      try {
        const cleanComponents: Array<{ productId: number; ref: string; name: string; qty: number }> = [];
        for (const rawComp of components) {
          const c = rawComp as Record<string, unknown>;
          const compProd = (await db.prepare('SELECT id, ref, name FROM products WHERE id = ?').get(Number(c.productId))) as
            | { id: number; ref: string; name: string }
            | undefined;
          if (!compProd) throw new Error('Selected component product does not exist.');
          const qty = Math.max(1, Number(c.qty) || 1);
          cleanComponents.push({ productId: compProd.id, ref: compProd.ref, name: compProd.name, qty });
        }
        cleanComponentsJson = JSON.stringify(cleanComponents);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid BOM components.' });
        return;
      }
    }
    const nextWs =
      workstationId === null || workstationId === ''
        ? null
        : workstationId !== undefined
          ? Number(workstationId)
          : ((await db.prepare('SELECT workstation_id FROM boms WHERE id = ?').get(id)) as { workstation_id: number | null }).workstation_id;
    (await db.prepare(
      `UPDATE boms
       SET product_id = COALESCE(?, product_id),
           workstation_id = ?,
           label = COALESCE(?, label),
           output_qty = COALESCE(?, output_qty),
           components_json = COALESCE(?, components_json),
           estimated_minutes = COALESCE(?, estimated_minutes),
           status = COALESCE(?, status)
       WHERE id = ?`
    ).run(
      productId !== undefined ? Number(productId) : null,
      nextWs,
      label ? String(label).trim() : null,
      outputQty !== undefined ? Math.max(1, Number(outputQty) || 1) : null,
      cleanComponentsJson,
      estimatedMinutes !== undefined ? Math.max(1, Number(estimatedMinutes) || 60) : null,
      ['draft', 'active', 'archived'].includes(status) ? status : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_BOM',
      module: 'manufacturing',
      entityRef: existing.ref,
      details: `Updated BOM ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM boms WHERE id = ?').get(id)));
  });

  router.delete('/boms/:id', authenticate, requirePermission('manufacturing', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, label FROM boms WHERE id = ?').get(id)) as { ref: string; label: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'BOM not found.' });
      return;
    }
    try {
      (await db.prepare('DELETE FROM boms WHERE id = ?').run(id));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'DELETE_BOM',
        module: 'manufacturing',
        entityRef: existing.ref,
        details: `Deleted BOM ${existing.label}`,
        ipAddress: getClientIp(req),
        severity: 'warning',
      }));
      res.json({ ok: true });
    } catch {
      res.status(409).json({ error: 'Cannot delete BOM referenced by manufacturing orders.' });
    }
  });

  router.post('/manufacturing-orders', authenticate, requirePermission('manufacturing', 'write'), async (req: AuthenticatedReq, res) => {
    const { bomId, warehouseId, qtyPlanned = 1, scheduledDate, notes = '' } = req.body ?? {};
    const bom = (await db.prepare('SELECT * FROM boms WHERE id = ?').get(Number(bomId))) as
      | { id: number; product_id: number; workstation_id: number | null }
      | undefined;
    if (!bom || !warehouseId) {
      res.status(400).json({ error: 'BOM and target warehouse are required.' });
      return;
    }
    const ref = (await seqRef('manufacturing_orders', 'MO'));
    const today = new Date().toISOString().slice(0, 10);
    const info = (await db
      .prepare(
        `INSERT INTO manufacturing_orders (ref, bom_id, product_id, warehouse_id, workstation_id, qty_planned, qty_produced, scheduled_date, status, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'validated', ?, ?)`
      )
      .run(
        ref,
        bom.id,
        bom.product_id,
        Number(warehouseId),
        bom.workstation_id,
        Math.max(1, Math.round(Number(qtyPlanned) || 1)),
        String(scheduledDate || today),
        String(notes).trim(),
        req.authUser!.email
      ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_MO',
      module: 'manufacturing',
      entityRef: ref,
      details: `Scheduled MO ${ref} (qty ${qtyPlanned})`,
      ipAddress: getClientIp(req),
    }));
    res.status(201).json((await db.prepare('SELECT * FROM manufacturing_orders WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/manufacturing-orders/:id', authenticate, requirePermission('manufacturing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, status FROM manufacturing_orders WHERE id = ?').get(id)) as
      | { ref: string; status: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Manufacturing order not found.' });
      return;
    }
    const { warehouseId, qtyPlanned, scheduledDate, status, notes } = req.body ?? {};
    const locked = existing.status === 'produced';
    (await db.prepare(
      `UPDATE manufacturing_orders
       SET warehouse_id = COALESCE(?, warehouse_id),
           qty_planned = COALESCE(?, qty_planned),
           scheduled_date = COALESCE(?, scheduled_date),
           status = COALESCE(?, status),
           notes = COALESCE(?, notes)
       WHERE id = ?`
    ).run(
      !locked && warehouseId !== undefined ? Number(warehouseId) : null,
      !locked && qtyPlanned !== undefined ? Math.max(1, Math.round(Number(qtyPlanned) || 1)) : null,
      scheduledDate ? String(scheduledDate) : null,
      !locked && ['draft', 'validated', 'in_progress', 'cancelled'].includes(status) ? status : null,
      notes !== undefined ? String(notes).trim() : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_MO',
      module: 'manufacturing',
      entityRef: existing.ref,
      details: `Updated manufacturing order ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM manufacturing_orders WHERE id = ?').get(id)));
  });

  router.delete('/manufacturing-orders/:id', authenticate, requirePermission('manufacturing', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, status FROM manufacturing_orders WHERE id = ?').get(id)) as
      | { ref: string; status: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Manufacturing order not found.' });
      return;
    }
    if (existing.status === 'produced') {
      res.status(409).json({ error: 'Completed production orders cannot be deleted.' });
      return;
    }
    (await db.prepare('DELETE FROM manufacturing_orders WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_MO',
      module: 'manufacturing',
      entityRef: existing.ref,
      details: `Deleted manufacturing order ${existing.ref}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.post('/manufacturing-orders/:id/produce', authenticate, requirePermission('manufacturing', 'validate'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const mo = (await db.prepare('SELECT * FROM manufacturing_orders WHERE id = ?').get(id)) as
      | { id: number; ref: string; bom_id: number; product_id: number; warehouse_id: number; qty_planned: number; status: string }
      | undefined;
    if (!mo) {
      res.status(404).json({ error: 'Manufacturing order not found.' });
      return;
    }
    if (mo.status === 'produced' || mo.status === 'cancelled') {
      res.status(400).json({ error: 'Manufacturing order already completed or cancelled.' });
      return;
    }
    const bom = (await db.prepare('SELECT * FROM boms WHERE id = ?').get(mo.bom_id)) as
      | { output_qty: number; components_json: string }
      | undefined;
    if (!bom) {
      res.status(404).json({ error: 'Linked BOM missing.' });
      return;
    }
    const components = JSON.parse(bom.components_json) as Array<{ productId: number; ref: string; qty: number }>;
    const batchRuns = Math.ceil(mo.qty_planned / Math.max(1, bom.output_qty));

    (await db.exec('BEGIN'));
    try {
      for (const c of components) {
        await applyStockAdjustment({
          productId: c.productId,
          warehouseId: mo.warehouse_id,
          delta: -(c.qty * batchRuns),
          movementType: 'out',
          reason: `Consumed in ${mo.ref}`,
          docRef: mo.ref,
          actorEmail: req.authUser!.email,
        });
      }
      await applyStockAdjustment({
        productId: mo.product_id,
        warehouseId: mo.warehouse_id,
        delta: mo.qty_planned,
        movementType: 'in',
        reason: `Produced from ${mo.ref}`,
        docRef: mo.ref,
        actorEmail: req.authUser!.email,
      });
      (await db.prepare(`UPDATE manufacturing_orders SET status = 'produced', qty_produced = qty_planned WHERE id = ?`).run(id));
      (await db.exec('COMMIT'));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'COMPLETE_MO_PRODUCTION',
        module: 'manufacturing',
        entityRef: mo.ref,
        details: `Produced ${mo.qty_planned} unit(s) and deducted BOM components`,
        ipAddress: getClientIp(req),
      }));
      res.json((await db.prepare('SELECT * FROM manufacturing_orders WHERE id = ?').get(id)));
    } catch (err) {
      (await db.exec('ROLLBACK'));
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to produce order.' });
    }
  });

  // ========================
  // SALES EXTENSIONS (OPPS, SIGNING, CONTRACTS, SHIPMENTS, INTERVENTIONS, RFQS, POS)
  // ========================
  router.get('/commerce-extensions', authenticate, requirePermission('sales', 'read'), async (_req, res) => {
    const opportunities = (await db
      .prepare(
        `SELECT o.*, tp.name AS party_name
         FROM opportunities o
         JOIN third_parties tp ON tp.id = o.third_party_id
         ORDER BY o.id DESC`
      )
      .all());
    const contracts = (await db
      .prepare(
        `SELECT c.*, tp.name AS customer_name
         FROM contracts c
         JOIN third_parties tp ON tp.id = c.third_party_id
         ORDER BY c.id DESC`
      )
      .all());
    const shipments = (await db
      .prepare(
        `SELECT sh.*, so.ref AS order_ref, tp.name AS customer_name, w.name AS warehouse_name
         FROM shipments sh
         JOIN sales_orders so ON so.id = sh.sales_order_id
         JOIN third_parties tp ON tp.id = so.third_party_id
         JOIN warehouses w ON w.id = sh.warehouse_id
         ORDER BY sh.id DESC`
      )
      .all());
    const interventions = (await db
      .prepare(
        `SELECT iv.*, tp.name AS customer_name
         FROM interventions iv
         JOIN third_parties tp ON tp.id = iv.third_party_id
         ORDER BY iv.id DESC`
      )
      .all());
    const rfqs = (await db
      .prepare(
        `SELECT r.*, tp.name AS supplier_name
         FROM supplier_rfqs r
         JOIN third_parties tp ON tp.id = r.third_party_id
         ORDER BY r.id DESC`
      )
      .all());
    res.json({ opportunities, contracts, shipments, interventions, rfqs });
  });

  router.post('/opportunities', authenticate, requirePermission('sales', 'write'), async (req: AuthenticatedReq, res) => {
    const { thirdPartyId, title, stage = 'qualification', probability = 25, amount = 0, closeDate, ownerName = '', notes = '' } = req.body ?? {};
    if (!thirdPartyId || !String(title ?? '').trim()) {
      res.status(400).json({ error: 'Account and opportunity title are required.' });
      return;
    }
    const ref = (await seqRef('opportunities', 'OPP'));
    const close = String(closeDate || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
    const info = (await db
      .prepare(
        `INSERT INTO opportunities (ref, third_party_id, title, stage, probability, amount, close_date, owner_name, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        ref,
        Number(thirdPartyId),
        String(title).trim(),
        ['qualification', 'proposition', 'negotiation', 'won', 'lost'].includes(stage) ? stage : 'qualification',
        Math.min(100, Math.max(0, Number(probability) || 0)),
        Number(amount) || 0,
        close,
        String(ownerName).trim() || req.authUser!.full_name,
        String(notes).trim()
      ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_OPPORTUNITY',
      module: 'sales',
      entityRef: ref,
      details: `Created opportunity ${title} ($${Number(amount).toFixed(2)})`,
      ipAddress: getClientIp(req),
    }));
    res.status(201).json((await db.prepare('SELECT * FROM opportunities WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/opportunities/:id', authenticate, requirePermission('sales', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const { thirdPartyId, title, stage, probability, amount, closeDate, ownerName, notes } = req.body ?? {};
    const existing = (await db.prepare('SELECT ref FROM opportunities WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Opportunity not found.' });
      return;
    }
    (await db.prepare(
      `UPDATE opportunities
       SET third_party_id = COALESCE(?, third_party_id),
           title = COALESCE(?, title),
           stage = COALESCE(?, stage),
           probability = COALESCE(?, probability),
           amount = COALESCE(?, amount),
           close_date = COALESCE(?, close_date),
           owner_name = COALESCE(?, owner_name),
           notes = COALESCE(?, notes)
       WHERE id = ?`
    ).run(
      thirdPartyId !== undefined ? Number(thirdPartyId) : null,
      title ? String(title).trim() : null,
      ['qualification', 'proposition', 'negotiation', 'won', 'lost'].includes(stage) ? stage : null,
      probability !== undefined ? Math.min(100, Math.max(0, Number(probability) || 0)) : null,
      amount !== undefined ? Number(amount) : null,
      closeDate ? String(closeDate) : null,
      ownerName !== undefined ? String(ownerName).trim() : null,
      notes !== undefined ? String(notes).trim() : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_OPPORTUNITY',
      module: 'sales',
      entityRef: existing.ref,
      details: `Updated opportunity ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id)));
  });

  router.delete('/opportunities/:id', authenticate, requirePermission('sales', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, title FROM opportunities WHERE id = ?').get(id)) as
      | { ref: string; title: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Opportunity not found.' });
      return;
    }
    (await db.prepare('DELETE FROM opportunities WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_OPPORTUNITY',
      module: 'sales',
      entityRef: existing.ref,
      details: `Deleted opportunity ${existing.title}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.post('/opportunities/:id/convert-proposal', authenticate, requirePermission('sales', 'validate'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const opp = (await db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id)) as
      | { id: number; ref: string; third_party_id: number; title: string; amount: number }
      | undefined;
    if (!opp) {
      res.status(404).json({ error: 'Opportunity not found.' });
      return;
    }
    const prRef = await nextSequenceRef('proposals', 'PR');
    const today = new Date().toISOString().slice(0, 10);
    const validUntil = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const ht = Math.round(opp.amount * 100) / 100;
    const tax = Math.round(ht * 0.2 * 100) / 100;
    const ttc = Math.round((ht + tax) * 100) / 100;
    const lines = [{ productId: null, ref: opp.ref, label: opp.title, qty: 1, unitPrice: ht, discountPct: 0, taxRate: 20 }];
    const info = (await db
      .prepare(
        `INSERT INTO proposals (ref, third_party_id, title, issue_date, valid_until, status, lines_json, subtotal_ht, tax_total, total_ttc, notes, created_by)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`
      )
      .run(prRef, opp.third_party_id, opp.title, today, validUntil, JSON.stringify(lines), ht, tax, ttc, `Converted from ${opp.ref}`, req.authUser!.email));
    (await db.prepare(`UPDATE opportunities SET stage = 'proposition' WHERE id = ?`).run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CONVERT_OPP_TO_PROPOSAL',
      module: 'sales',
      entityRef: prRef,
      details: `Converted ${opp.ref} -> Proposal ${prRef}`,
      ipAddress: getClientIp(req),
    }));
    res.status(201).json((await db.prepare('SELECT * FROM proposals WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.post('/proposals/:id/sign', authenticate, requirePermission('sales', 'validate'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const { signatureName, signerEmail = '' } = req.body ?? {};
    if (!String(signatureName ?? '').trim()) {
      res.status(400).json({ error: 'Signer legal name is required for online signing.' });
      return;
    }
    const prop = (await db.prepare('SELECT ref FROM proposals WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!prop) {
      res.status(404).json({ error: 'Proposal not found.' });
      return;
    }
    const nowIso = new Date().toISOString();
    (await db.prepare(
      `UPDATE proposals SET status = 'signed', signature_name = ?, signed_by = ?, signed_at = ? WHERE id = ?`
    ).run(String(signatureName).trim(), String(signerEmail).trim() || req.authUser!.email, nowIso, id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'SIGN_PROPOSAL_ONLINE',
      module: 'sales',
      entityRef: prop.ref,
      details: `Online signed by ${signatureName}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM proposals WHERE id = ?').get(id)));
  });

  router.post('/contracts', authenticate, requirePermission('sales', 'write'), async (req: AuthenticatedReq, res) => {
    const { thirdPartyId, title, billingCycle = 'monthly', recurringAmount = 0, startDate, notes = '' } = req.body ?? {};
    if (!thirdPartyId || !String(title ?? '').trim()) {
      res.status(400).json({ error: 'Customer and contract title are required.' });
      return;
    }
    const ref = (await seqRef('contracts', 'CTR'));
    const today = String(startDate || new Date().toISOString().slice(0, 10));
    const days = billingCycle === 'annual' ? 365 : billingCycle === 'quarterly' ? 90 : 30;
    const nextBilling = new Date(new Date(today).getTime() + days * 86400000).toISOString().slice(0, 10);
    const info = (await db
      .prepare(
        `INSERT INTO contracts (ref, third_party_id, title, billing_cycle, recurring_amount, start_date, next_billing_date, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`
      )
      .run(
        ref,
        Number(thirdPartyId),
        String(title).trim(),
        ['monthly', 'quarterly', 'annual'].includes(billingCycle) ? billingCycle : 'monthly',
        Number(recurringAmount) || 0,
        today,
        nextBilling,
        String(notes).trim()
      ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_CONTRACT',
      module: 'sales',
      entityRef: ref,
      details: `Created recurring contract ${title}`,
      ipAddress: getClientIp(req),
    }));
    res.status(201).json((await db.prepare('SELECT * FROM contracts WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/contracts/:id', authenticate, requirePermission('sales', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM contracts WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Contract not found.' });
      return;
    }
    const { thirdPartyId, title, billingCycle, recurringAmount, startDate, nextBillingDate, status, notes } = req.body ?? {};
    (await db.prepare(
      `UPDATE contracts
       SET third_party_id = COALESCE(?, third_party_id),
           title = COALESCE(?, title),
           billing_cycle = COALESCE(?, billing_cycle),
           recurring_amount = COALESCE(?, recurring_amount),
           start_date = COALESCE(?, start_date),
           next_billing_date = COALESCE(?, next_billing_date),
           status = COALESCE(?, status),
           notes = COALESCE(?, notes)
       WHERE id = ?`
    ).run(
      thirdPartyId !== undefined ? Number(thirdPartyId) : null,
      title ? String(title).trim() : null,
      ['monthly', 'quarterly', 'annual'].includes(billingCycle) ? billingCycle : null,
      recurringAmount !== undefined ? Number(recurringAmount) : null,
      startDate ? String(startDate) : null,
      nextBillingDate ? String(nextBillingDate) : null,
      ['draft', 'active', 'suspended', 'closed'].includes(status) ? status : null,
      notes !== undefined ? String(notes).trim() : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_CONTRACT',
      module: 'sales',
      entityRef: existing.ref,
      details: `Updated contract ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM contracts WHERE id = ?').get(id)));
  });

  router.delete('/contracts/:id', authenticate, requirePermission('sales', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, title FROM contracts WHERE id = ?').get(id)) as
      | { ref: string; title: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Contract not found.' });
      return;
    }
    (await db.prepare('DELETE FROM contracts WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_CONTRACT',
      module: 'sales',
      entityRef: existing.ref,
      details: `Deleted contract ${existing.title}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.post('/contracts/:id/generate-invoice', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const ctr = (await db.prepare('SELECT * FROM contracts WHERE id = ?').get(id)) as
      | { id: number; ref: string; third_party_id: number; title: string; billing_cycle: string; recurring_amount: number; next_billing_date: string }
      | undefined;
    if (!ctr) {
      res.status(404).json({ error: 'Contract not found.' });
      return;
    }
    const invRef = await nextSequenceRef('invoices', 'IN');
    const today = new Date().toISOString().slice(0, 10);
    const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const ht = Math.round(ctr.recurring_amount * 100) / 100;
    const tax = Math.round(ht * 0.2 * 100) / 100;
    const ttc = Math.round((ht + tax) * 100) / 100;
    const lines = [{ productId: null, ref: ctr.ref, label: `${ctr.title} (${ctr.billing_cycle} cycle)`, qty: 1, unitPrice: ht, discountPct: 0, taxRate: 20 }];
    const days = ctr.billing_cycle === 'annual' ? 365 : ctr.billing_cycle === 'quarterly' ? 90 : 30;
    const nextCycle = new Date(new Date(ctr.next_billing_date || today).getTime() + days * 86400000).toISOString().slice(0, 10);

    (await db.exec('BEGIN'));
    try {
      const info = (await db
        .prepare(
          `INSERT INTO invoices (ref, invoice_type, invoice_kind, third_party_id, source_ref, issue_date, due_date, status, lines_json, subtotal_ht, tax_total, total_ttc, amount_paid, notes, created_by)
           VALUES (?, 'customer', 'standard', ?, ?, ?, ?, 'validated', ?, ?, ?, ?, 0, ?, ?)`
        )
        .run(invRef, ctr.third_party_id, ctr.ref, today, due, JSON.stringify(lines), ht, tax, ttc, `Recurring billing from ${ctr.ref}`, req.authUser!.email));
      (await db.prepare('UPDATE contracts SET next_billing_date = ? WHERE id = ?').run(nextCycle, id));
      (await db.exec('COMMIT'));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'CONTRACT_CYCLE_INVOICED',
        module: 'billing',
        entityRef: invRef,
        details: `Generated subscription invoice ${invRef} from ${ctr.ref}`,
        ipAddress: getClientIp(req),
      }));
      res.status(201).json((await db.prepare('SELECT * FROM invoices WHERE id = ?').get(info.lastInsertRowid)));
    } catch (err) {
      (await db.exec('ROLLBACK'));
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to generate contract invoice.' });
    }
  });

  router.post('/shipments', authenticate, requirePermission('sales', 'validate'), async (req: AuthenticatedReq, res) => {
    const { salesOrderId, carrier = 'DHL Freight', trackingNumber = '', shipDate, weightKg = 5, notes = '' } = req.body ?? {};
    const so = (await db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(Number(salesOrderId))) as
      | { id: number; ref: string; warehouse_id: number }
      | undefined;
    if (!so) {
      res.status(400).json({ error: 'Valid sales order is required.' });
      return;
    }
    const ref = (await seqRef('shipments', 'SH'));
    const info = (await db
      .prepare(
        `INSERT INTO shipments (ref, sales_order_id, warehouse_id, carrier, tracking_number, ship_date, weight_kg, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'in_transit', ?)`
      )
      .run(
        ref,
        so.id,
        so.warehouse_id,
        String(carrier).trim() || 'DHL Freight',
        String(trackingNumber).trim() || `TRK-${Date.now().toString().slice(-8)}`,
        String(shipDate || new Date().toISOString().slice(0, 10)),
        Number(weightKg) || 0,
        String(notes).trim()
      ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_SHIPMENT',
      module: 'sales',
      entityRef: ref,
      details: `Created shipment ${ref} for ${so.ref} via ${carrier}`,
      ipAddress: getClientIp(req),
    }));
    res.status(201).json((await db.prepare('SELECT * FROM shipments WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/shipments/:id', authenticate, async (req: AuthenticatedReq, res) => {
    if (!hasPermission(req.authPermissions, 'sales', 'write') && !hasPermission(req.authPermissions, 'sales', 'validate')) {
      res.status(403).json({ error: 'Permission required to update shipments.' });
      return;
    }
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM shipments WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Shipment not found.' });
      return;
    }
    const { carrier, trackingNumber, shipDate, weightKg, status, notes } = req.body ?? {};
    if (status !== undefined && !['draft', 'packed', 'in_transit', 'delivered'].includes(status)) {
      res.status(400).json({ error: 'Invalid shipment status.' });
      return;
    }
    (await db.prepare(
      `UPDATE shipments
       SET carrier = COALESCE(?, carrier),
           tracking_number = COALESCE(?, tracking_number),
           ship_date = COALESCE(?, ship_date),
           weight_kg = COALESCE(?, weight_kg),
           status = COALESCE(?, status),
           notes = COALESCE(?, notes)
       WHERE id = ?`
    ).run(
      carrier ? String(carrier).trim() : null,
      trackingNumber !== undefined ? String(trackingNumber).trim() : null,
      shipDate ? String(shipDate) : null,
      weightKg !== undefined ? Number(weightKg) : null,
      status ?? null,
      notes !== undefined ? String(notes).trim() : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_SHIPMENT',
      module: 'sales',
      entityRef: existing.ref,
      details: `Updated shipment ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM shipments WHERE id = ?').get(id)));
  });

  router.delete('/shipments/:id', authenticate, requirePermission('sales', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM shipments WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Shipment not found.' });
      return;
    }
    (await db.prepare('DELETE FROM shipments WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_SHIPMENT',
      module: 'sales',
      entityRef: existing.ref,
      details: `Deleted shipment ${existing.ref}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.post('/interventions', authenticate, requirePermission('sales', 'write'), async (req: AuthenticatedReq, res) => {
    const { thirdPartyId, title, technicianName = '', scheduledDate, durationHours = 2, notes = '' } = req.body ?? {};
    if (!thirdPartyId || !String(title ?? '').trim()) {
      res.status(400).json({ error: 'Customer and intervention title are required.' });
      return;
    }
    const ref = (await seqRef('interventions', 'INT'));
    const info = (await db
      .prepare(
        `INSERT INTO interventions (ref, third_party_id, title, technician_name, scheduled_date, duration_hours, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, 'planned', ?)`
      )
      .run(
        ref,
        Number(thirdPartyId),
        String(title).trim(),
        String(technicianName).trim() || req.authUser!.full_name,
        String(scheduledDate || new Date().toISOString().slice(0, 10)),
        Math.max(0.5, Number(durationHours) || 2),
        String(notes).trim()
      ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_INTERVENTION',
      module: 'sales',
      entityRef: ref,
      details: `Scheduled field intervention ${title}`,
      ipAddress: getClientIp(req),
    }));
    res.status(201).json((await db.prepare('SELECT * FROM interventions WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/interventions/:id', authenticate, async (req: AuthenticatedReq, res) => {
    if (!hasPermission(req.authPermissions, 'sales', 'write') && !hasPermission(req.authPermissions, 'sales', 'validate')) {
      res.status(403).json({ error: 'Permission required to update interventions.' });
      return;
    }
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM interventions WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Intervention not found.' });
      return;
    }
    const { thirdPartyId, title, technicianName, scheduledDate, durationHours, status, notes } = req.body ?? {};
    if (status !== undefined && !['planned', 'in_progress', 'completed', 'billed'].includes(status)) {
      res.status(400).json({ error: 'Invalid status.' });
      return;
    }
    (await db.prepare(
      `UPDATE interventions
       SET third_party_id = COALESCE(?, third_party_id),
           title = COALESCE(?, title),
           technician_name = COALESCE(?, technician_name),
           scheduled_date = COALESCE(?, scheduled_date),
           duration_hours = COALESCE(?, duration_hours),
           status = COALESCE(?, status),
           notes = COALESCE(?, notes)
       WHERE id = ?`
    ).run(
      thirdPartyId !== undefined ? Number(thirdPartyId) : null,
      title ? String(title).trim() : null,
      technicianName !== undefined ? String(technicianName).trim() : null,
      scheduledDate ? String(scheduledDate) : null,
      durationHours !== undefined ? Math.max(0.5, Number(durationHours) || 2) : null,
      status ?? null,
      notes !== undefined ? String(notes).trim() : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_INTERVENTION',
      module: 'sales',
      entityRef: existing.ref,
      details: `Updated intervention ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM interventions WHERE id = ?').get(id)));
  });

  router.delete('/interventions/:id', authenticate, requirePermission('sales', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, title FROM interventions WHERE id = ?').get(id)) as
      | { ref: string; title: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Intervention not found.' });
      return;
    }
    (await db.prepare('DELETE FROM interventions WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_INTERVENTION',
      module: 'sales',
      entityRef: existing.ref,
      details: `Deleted intervention ${existing.title}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.post('/supplier-rfqs', authenticate, requirePermission('purchasing', 'write'), async (req: AuthenticatedReq, res) => {
    const { thirdPartyId, title, deadlineDate, incoterm = 'CIF', productId, qty = 10, unitPrice = 50, notes = '' } = req.body ?? {};
    if (!thirdPartyId || !String(title ?? '').trim()) {
      res.status(400).json({ error: 'Supplier and RFQ title are required.' });
      return;
    }
    const prod = productId
      ? ((await db.prepare('SELECT id, ref, name FROM products WHERE id = ?').get(Number(productId))) as
          | { id: number; ref: string; name: string }
          | undefined)
      : undefined;
    const lines = [
      {
        productId: prod?.id ?? null,
        ref: prod?.ref ?? 'CUSTOM',
        label: prod?.name ?? String(title).trim(),
        qty: Math.max(1, Number(qty) || 1),
        unitPrice: Math.max(0, Number(unitPrice) || 0),
        discountPct: 0,
        taxRate: 20,
      },
    ];
    const estTotal = Math.round(lines[0].qty * lines[0].unitPrice * 1.2 * 100) / 100;
    const ref = (await seqRef('supplier_rfqs', 'RFQ'));
    const today = new Date().toISOString().slice(0, 10);
    const deadline = String(deadlineDate || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
    const info = (await db
      .prepare(
        `INSERT INTO supplier_rfqs (ref, third_party_id, title, request_date, deadline_date, incoterm, lines_json, estimated_total, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`
      )
      .run(ref, Number(thirdPartyId), String(title).trim(), today, deadline, String(incoterm || 'CIF'), JSON.stringify(lines), estTotal, String(notes).trim()));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_SUPPLIER_RFQ',
      module: 'purchasing',
      entityRef: ref,
      details: `Issued supplier pricing request ${ref}`,
      ipAddress: getClientIp(req),
    }));
    res.status(201).json((await db.prepare('SELECT * FROM supplier_rfqs WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/supplier-rfqs/:id', authenticate, requirePermission('purchasing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM supplier_rfqs WHERE id = ?').get(id)) as
      | { id: number; ref: string; lines_json: string; title: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Supplier RFQ not found.' });
      return;
    }
    const { thirdPartyId, title, deadlineDate, incoterm, productId, qty, unitPrice, status, notes } = req.body ?? {};
    let nextLinesJson: string | null = null;
    let nextTotal: number | null = null;
    if (qty !== undefined || unitPrice !== undefined || productId !== undefined) {
      const existingLines = JSON.parse(existing.lines_json || '[]') as Array<{
        productId: number | null;
        ref: string;
        label: string;
        qty: number;
        unitPrice: number;
        discountPct: number;
        taxRate: number;
      }>;
      const cur = existingLines[0] ?? { productId: null, ref: 'CUSTOM', label: existing.title, qty: 1, unitPrice: 0, discountPct: 0, taxRate: 20 };
      const prod = productId
        ? ((await db.prepare('SELECT id, ref, name FROM products WHERE id = ?').get(Number(productId))) as
            | { id: number; ref: string; name: string }
            | undefined)
        : undefined;
      const finalQty = Math.max(1, Number(qty ?? cur.qty) || 1);
      const finalPrice = Math.max(0, Number(unitPrice ?? cur.unitPrice) || 0);
      const nextLine = {
        productId: prod ? prod.id : cur.productId,
        ref: prod ? prod.ref : cur.ref,
        label: prod ? prod.name : title ? String(title).trim() : cur.label,
        qty: finalQty,
        unitPrice: finalPrice,
        discountPct: 0,
        taxRate: 20,
      };
      nextLinesJson = JSON.stringify([nextLine]);
      nextTotal = Math.round(finalQty * finalPrice * 1.2 * 100) / 100;
    }
    (await db.prepare(
      `UPDATE supplier_rfqs
       SET third_party_id = COALESCE(?, third_party_id),
           title = COALESCE(?, title),
           deadline_date = COALESCE(?, deadline_date),
           incoterm = COALESCE(?, incoterm),
           lines_json = COALESCE(?, lines_json),
           estimated_total = COALESCE(?, estimated_total),
           status = COALESCE(?, status),
           notes = COALESCE(?, notes)
       WHERE id = ?`
    ).run(
      thirdPartyId !== undefined ? Number(thirdPartyId) : null,
      title ? String(title).trim() : null,
      deadlineDate ? String(deadlineDate) : null,
      incoterm ? String(incoterm).trim().toUpperCase() : null,
      nextLinesJson,
      nextTotal,
      ['draft', 'open', 'quoted', 'accepted', 'declined'].includes(status) ? status : null,
      notes !== undefined ? String(notes).trim() : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_SUPPLIER_RFQ',
      module: 'purchasing',
      entityRef: existing.ref,
      details: `Updated RFQ ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM supplier_rfqs WHERE id = ?').get(id)));
  });

  router.delete('/supplier-rfqs/:id', authenticate, requirePermission('purchasing', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, title FROM supplier_rfqs WHERE id = ?').get(id)) as
      | { ref: string; title: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Supplier RFQ not found.' });
      return;
    }
    (await db.prepare('DELETE FROM supplier_rfqs WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_SUPPLIER_RFQ',
      module: 'purchasing',
      entityRef: existing.ref,
      details: `Deleted supplier RFQ ${existing.title}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.post('/supplier-rfqs/:id/convert-po', authenticate, requirePermission('purchasing', 'validate'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const rfq = (await db.prepare('SELECT * FROM supplier_rfqs WHERE id = ?').get(id)) as
      | { id: number; ref: string; third_party_id: number; incoterm: string; lines_json: string; estimated_total: number }
      | undefined;
    if (!rfq) {
      res.status(404).json({ error: 'Supplier RFQ not found.' });
      return;
    }
    const wh = ((await db.prepare('SELECT id FROM warehouses ORDER BY id ASC LIMIT 1').get()) as { id: number } | undefined)?.id;
    if (!wh) {
      res.status(400).json({ error: 'Warehouse required.' });
      return;
    }
    const lines = JSON.parse(rfq.lines_json) as Array<{ qty: number; unitPrice: number }>;
    const ht = Math.round(lines.reduce((acc, l) => acc + l.qty * l.unitPrice, 0) * 100) / 100;
    const tax = Math.round(ht * 0.2 * 100) / 100;
    const ttc = Math.round((ht + tax) * 100) / 100;
    const poRef = await nextSequenceRef('purchase_orders', 'PO');
    const today = new Date().toISOString().slice(0, 10);
    const exp = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);

    (await db.exec('BEGIN'));
    try {
      const info = (await db
        .prepare(
          `INSERT INTO purchase_orders (ref, third_party_id, order_date, expected_date, warehouse_id, incoterm, status, lines_json, subtotal_ht, tax_total, total_ttc, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?, 'ordered', ?, ?, ?, ?, ?, ?)`
        )
        .run(poRef, rfq.third_party_id, today, exp, wh, rfq.incoterm || 'CIF', rfq.lines_json, ht, tax, ttc, `Converted from RFQ ${rfq.ref}`, req.authUser!.email));
      (await db.prepare(`UPDATE supplier_rfqs SET status = 'accepted' WHERE id = ?`).run(id));
      (await db.exec('COMMIT'));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'CONVERT_RFQ_TO_PO',
        module: 'purchasing',
        entityRef: poRef,
        details: `Converted ${rfq.ref} -> PO ${poRef}`,
        ipAddress: getClientIp(req),
      }));
      res.status(201).json((await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(info.lastInsertRowid)));
    } catch (err) {
      (await db.exec('ROLLBACK'));
      res.status(500).json({ error: err instanceof Error ? err.message : 'RFQ conversion failed.' });
    }
  });

  // POS CHECKOUT
  router.post('/pos/checkout', authenticate, requirePermission('pos', 'write'), async (req: AuthenticatedReq, res) => {
    const { thirdPartyId, warehouseId, bankAccountId, paymentMethod = 'Card Terminal', items } = req.body ?? {};
    if (!warehouseId || !bankAccountId || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Warehouse, register account, and at least one cart item are required.' });
      return;
    }
    const partyId = thirdPartyId
      ? Number(thirdPartyId)
      : (((await db.prepare('SELECT id FROM third_parties ORDER BY id ASC LIMIT 1').get()) as { id: number } | undefined)?.id ?? 1);

    let subtotalHt = 0;
    let taxTotal = 0;
    const sanitizedLines: Array<{ productId: number; ref: string; label: string; qty: number; unitPrice: number; discountPct: number; taxRate: number }> = [];

    for (const raw of items) {
      const prod = (await db.prepare('SELECT id, ref, name, sell_price, tax_rate, product_type FROM products WHERE id = ?').get(Number(raw.productId))) as
        | { id: number; ref: string; name: string; sell_price: number; tax_rate: number; product_type: string }
        | undefined;
      if (!prod) {
        res.status(400).json({ error: 'Unknown product in POS cart.' });
        return;
      }
      const qty = Math.max(1, Math.round(Number(raw.qty) || 1));
      const lineNet = qty * prod.sell_price;
      const lineTax = lineNet * (prod.tax_rate / 100);
      subtotalHt += lineNet;
      taxTotal += lineTax;
      sanitizedLines.push({
        productId: prod.id,
        ref: prod.ref,
        label: prod.name,
        qty,
        unitPrice: prod.sell_price,
        discountPct: 0,
        taxRate: prod.tax_rate,
      });
    }

    subtotalHt = Math.round(subtotalHt * 100) / 100;
    taxTotal = Math.round(taxTotal * 100) / 100;
    const totalTtc = Math.round((subtotalHt + taxTotal) * 100) / 100;
    const invRef = await nextSequenceRef('invoices', 'POS');
    const today = new Date().toISOString().slice(0, 10);

    (await db.exec('BEGIN'));
    try {
      for (const l of sanitizedLines) {
        await applyStockAdjustment({
          productId: l.productId,
          warehouseId: Number(warehouseId),
          delta: -l.qty,
          movementType: 'out',
          reason: `POS sale ${invRef}`,
          docRef: invRef,
          actorEmail: req.authUser!.email,
        });
      }
      (await db.prepare(
        `INSERT INTO invoices (ref, invoice_type, invoice_kind, third_party_id, source_ref, issue_date, due_date, status, lines_json, subtotal_ht, tax_total, total_ttc, amount_paid, notes, created_by)
         VALUES (?, 'customer', 'standard', ?, 'TakePOS', ?, ?, 'paid', ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        invRef,
        partyId,
        today,
        today,
        JSON.stringify(sanitizedLines),
        subtotalHt,
        taxTotal,
        totalTtc,
        totalTtc,
        `POS Checkout (${paymentMethod})`,
        req.authUser!.email
      ));
      (await db.prepare('UPDATE bank_accounts SET balance = balance + ? WHERE id = ?').run(totalTtc, Number(bankAccountId)));
      (await db.prepare(
        `INSERT INTO bank_transactions (bank_account_id, tx_date, label, category, amount, direction, invoice_ref, created_by)
         VALUES (?, ?, ?, 'POS Retail Sale', ?, 'credit', ?, ?)`
      ).run(Number(bankAccountId), today, `POS Sale ${invRef} (${paymentMethod})`, totalTtc, invRef, req.authUser!.email));
      (await db.exec('COMMIT'));

      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'POS_SALE_COMPLETED',
        module: 'pos',
        entityRef: invRef,
        details: `Completed POS sale ${invRef} for $${totalTtc.toFixed(2)} (${paymentMethod})`,
        ipAddress: getClientIp(req),
      }));
      res.status(201).json({ ref: invRef, totalTtc, subtotalHt, taxTotal, lines: sanitizedLines, paymentMethod, date: today });
    } catch (err) {
      (await db.exec('ROLLBACK'));
      res.status(400).json({ error: err instanceof Error ? err.message : 'POS checkout failed.' });
    }
  });

  // ========================
  // FINANCE & PROJECT ACCOUNTING EXTENSIONS
  // ========================
  async function applyAccountPosting(accountCode: string, side: 'debit' | 'credit', amount: number): Promise<void> {
    const acct = (await db.prepare('SELECT account_class FROM accounting_accounts WHERE code = ?').get(accountCode)) as
      | { account_class: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' }
      | undefined;
    const isDebitNormal = !acct || acct.account_class === 'asset' || acct.account_class === 'expense';
    const delta = isDebitNormal ? (side === 'debit' ? amount : -amount) : side === 'credit' ? amount : -amount;
    await db.prepare('UPDATE accounting_accounts SET balance = balance + ? WHERE code = ?').run(delta, accountCode);
  }

  const currencyService = createCurrencyService(db);

  async function getClosedPeriodForDate(dateStr: string): Promise<{ code: string; name: string } | undefined> {
    return (await db
      .prepare(`SELECT code, name FROM fiscal_periods WHERE status = 'closed' AND start_date <= ? AND end_date >= ? LIMIT 1`)
      .get(dateStr, dateStr)) as { code: string; name: string } | undefined;
  }

  function advanceRecurringDate(dateStr: string, frequency: string): string {
    const d = new Date(`${dateStr}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
    if (frequency === 'annual') {
      d.setUTCFullYear(d.getUTCFullYear() + 1);
    } else if (frequency === 'quarterly') {
      d.setUTCMonth(d.getUTCMonth() + 3);
    } else {
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return d.toISOString().slice(0, 10);
  }

  function computeFinanceLinesTotals(rawLines: unknown) {
    const list = Array.isArray(rawLines) ? rawLines : [];
    const sanitized = list
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const l = item as Record<string, unknown>;
        return {
          productId: l.productId ? Number(l.productId) : null,
          ref: String(l.ref ?? '').trim(),
          label: String(l.label ?? 'Service Line').trim() || 'Service Line',
          qty: Math.max(0.01, Number(l.qty) || 1),
          unitPrice: Math.max(0, Number(l.unitPrice) || 0),
          discountPct: Math.min(100, Math.max(0, Number(l.discountPct) || 0)),
          taxRate: Math.min(100, Math.max(0, Number(l.taxRate) ?? 20)),
        };
      });
    let subtotalHt = 0;
    let taxTotal = 0;
    for (const l of sanitized) {
      const lineHt = l.qty * l.unitPrice * (1 - l.discountPct / 100);
      subtotalHt += lineHt;
      taxTotal += lineHt * (l.taxRate / 100);
    }
    subtotalHt = Math.round(subtotalHt * 100) / 100;
    taxTotal = Math.round(taxTotal * 100) / 100;
    const totalTtc = Math.round((subtotalHt + taxTotal) * 100) / 100;
    return { sanitized, subtotalHt, taxTotal, totalTtc };
  }

  router.get('/finance-extensions', authenticate, requirePermission('billing', 'read'), async (_req, res) => {
    const sepaBatches = await db
      .prepare(
        `SELECT sb.*, ba.name AS bank_name, ba.ref AS bank_ref
         FROM sepa_batches sb
         JOIN bank_accounts ba ON ba.id = sb.bank_account_id
         ORDER BY sb.id DESC`
      )
      .all();

    const accounts = (await db.prepare('SELECT * FROM accounting_accounts ORDER BY code ASC').all()) as Array<{
      id: number;
      code: string;
      label: string;
      account_class: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
      balance: number;
      is_active: number;
    }>;

    const journalEntries = await db
      .prepare(
        `SELECT je.*, p.ref AS project_ref, p.title AS project_title
         FROM journal_entries je
         LEFT JOIN projects p ON p.id = je.project_id
         ORDER BY je.entry_date DESC, je.id DESC
         LIMIT 150`
      )
      .all();

    const donations = await db.prepare('SELECT * FROM donations ORDER BY id DESC').all();
    const loans = await db.prepare('SELECT * FROM loans ORDER BY id DESC').all();
    const fiscalPeriods = await db.prepare('SELECT * FROM fiscal_periods ORDER BY start_date DESC, id DESC').all();
    const currencies = await db.prepare('SELECT * FROM currencies ORDER BY is_base DESC, code ASC').all();
    const taxRates = await db.prepare('SELECT * FROM tax_rates ORDER BY rate DESC, code ASC').all();

    const projectBudgets = await db
      .prepare(
        `SELECT pb.*, p.ref AS project_ref, p.title AS project_title, p.status AS project_status
         FROM project_budgets pb
         JOIN projects p ON p.id = pb.project_id
         ORDER BY pb.project_id ASC, pb.cost_code ASC`
      )
      .all();

    const rawAssets = (await db.prepare('SELECT * FROM fixed_assets ORDER BY acquisition_date DESC, id DESC').all()) as Array<{
      id: number;
      ref: string;
      name: string;
      category: string;
      acquisition_date: string;
      purchase_cost: number;
      salvage_value: number;
      useful_life_months: number;
      depreciation_method: 'straight_line' | 'declining_balance';
      accumulated_depreciation: number;
      last_depreciation_date: string;
      location: string;
      status: 'active' | 'fully_depreciated' | 'disposed';
      notes: string;
    }>;
    const fixedAssets = rawAssets.map((a) => {
      const nbv = Math.max(0, Math.round((a.purchase_cost - a.accumulated_depreciation) * 100) / 100);
      const depreciableBase = Math.max(0, a.purchase_cost - a.salvage_value);
      const life = Math.max(1, a.useful_life_months);
      const estMonthly =
        a.status !== 'active'
          ? 0
          : a.depreciation_method === 'declining_balance'
            ? Math.round((Math.max(0, nbv - a.salvage_value) * (2 / life)) * 100) / 100
            : Math.round((depreciableBase / life) * 100) / 100;
      return { ...a, net_book_value: nbv, monthly_depreciation: Math.min(estMonthly, Math.max(0, nbv - a.salvage_value)) };
    });

    const recurringInvoices = await db
      .prepare(
        `SELECT ri.*, tp.name AS party_name, tp.ref AS party_ref, p.ref AS project_ref, p.title AS project_title
         FROM recurring_invoices ri
         JOIN third_parties tp ON tp.id = ri.third_party_id
         LEFT JOIN projects p ON p.id = ri.project_id
         ORDER BY ri.next_run_date ASC, ri.id DESC`
      )
      .all();

    const marginStats = await db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN invoice_type = 'customer' AND invoice_kind = 'standard' AND status != 'cancelled' THEN subtotal_ht / COALESCE(NULLIF(exchange_rate, 0), 1) ELSE 0 END), 0) AS revenue_ht,
           COALESCE(SUM(CASE WHEN invoice_type = 'customer' AND invoice_kind = 'credit_note' AND status != 'cancelled' THEN subtotal_ht / COALESCE(NULLIF(exchange_rate, 0), 1) ELSE 0 END), 0) AS credit_notes_ht,
           COALESCE(SUM(CASE WHEN invoice_type = 'supplier' AND status != 'cancelled' THEN subtotal_ht / COALESCE(NULLIF(exchange_rate, 0), 1) ELSE 0 END), 0) AS purchases_ht,
           COALESCE(SUM(CASE WHEN invoice_type = 'customer' AND status != 'cancelled' THEN tax_total / COALESCE(NULLIF(exchange_rate, 0), 1) ELSE 0 END), 0) AS vat_collected,
           COALESCE(SUM(CASE WHEN invoice_type = 'supplier' AND status != 'cancelled' THEN tax_total / COALESCE(NULLIF(exchange_rate, 0), 1) ELSE 0 END), 0) AS vat_deductible
         FROM invoices`
      )
      .get();

    // Project Profitability & Job Costing
    const projRows = (await db
      .prepare(
        `SELECT p.id, p.ref, p.title, p.budget_amount, p.status, p.progress, tp.name AS customer_name
         FROM projects p
         LEFT JOIN third_parties tp ON tp.id = p.third_party_id
         ORDER BY p.id ASC`
      )
      .all()) as Array<{
      id: number;
      ref: string;
      title: string;
      budget_amount: number;
      status: string;
      progress: number;
      customer_name: string | null;
    }>;

    const budgetAggRows = (await db
      .prepare(
        `SELECT project_id,
                COALESCE(SUM(planned_budget), 0) AS planned_budget,
                COALESCE(SUM(committed_amount), 0) AS committed_cost,
                COALESCE(AVG(hourly_cost_rate), 65) AS avg_cost_rate,
                COALESCE(AVG(hourly_bill_rate), 145) AS avg_bill_rate
         FROM project_budgets
         GROUP BY project_id`
      )
      .all()) as Array<{
      project_id: number;
      planned_budget: number;
      committed_cost: number;
      avg_cost_rate: number;
      avg_bill_rate: number;
    }>;

    const invProjRows = (await db
      .prepare(
        `SELECT project_id,
                COALESCE(SUM(CASE WHEN invoice_type = 'customer' AND invoice_kind = 'standard' AND status != 'cancelled' THEN subtotal_ht / COALESCE(NULLIF(exchange_rate, 0), 1)
                                  WHEN invoice_type = 'customer' AND invoice_kind = 'credit_note' AND status != 'cancelled' THEN -subtotal_ht / COALESCE(NULLIF(exchange_rate, 0), 1)
                                  ELSE 0 END), 0) AS invoiced_revenue,
                COALESCE(SUM(CASE WHEN invoice_type = 'supplier' AND status != 'cancelled' THEN subtotal_ht / COALESCE(NULLIF(exchange_rate, 0), 1) ELSE 0 END), 0) AS supplier_costs
         FROM invoices
         WHERE project_id IS NOT NULL
         GROUP BY project_id`
      )
      .all()) as Array<{ project_id: number; invoiced_revenue: number; supplier_costs: number }>;

    const tsProjRows = (await db
      .prepare(
        `SELECT project_id,
                COALESCE(SUM(CASE WHEN billable = 1 THEN hours ELSE 0 END), 0) AS billable_hours,
                COALESCE(SUM(CASE WHEN billable = 0 THEN hours ELSE 0 END), 0) AS non_billable_hours
         FROM timesheets
         WHERE project_id IS NOT NULL
         GROUP BY project_id`
      )
      .all()) as Array<{ project_id: number; billable_hours: number; non_billable_hours: number }>;

    const jrnProjRows = (await db
      .prepare(
        `SELECT je.project_id,
                COALESCE(SUM(CASE WHEN aa.account_class = 'expense' THEN je.amount ELSE 0 END), 0) AS gl_expenses
         FROM journal_entries je
         LEFT JOIN accounting_accounts aa ON aa.code = je.debit_account_code
         WHERE je.project_id IS NOT NULL
         GROUP BY je.project_id`
      )
      .all()) as Array<{ project_id: number; gl_expenses: number }>;

    const budgetByProj = new Map(budgetAggRows.map((r) => [r.project_id, r]));
    const invByProj = new Map(invProjRows.map((r) => [r.project_id, r]));
    const tsByProj = new Map(tsProjRows.map((r) => [r.project_id, r]));
    const jrnByProj = new Map(jrnProjRows.map((r) => [r.project_id, r]));

    const projectProfitability = projRows.map((p) => {
      const b = budgetByProj.get(p.id);
      const inv = invByProj.get(p.id);
      const ts = tsByProj.get(p.id);
      const jrn = jrnByProj.get(p.id);
      const plannedBudget = b && b.planned_budget > 0 ? b.planned_budget : p.budget_amount;
      const committedCost = b?.committed_cost ?? 0;
      const costRate = b?.avg_cost_rate ?? 65;
      const billRate = b?.avg_bill_rate ?? 145;
      const billableHours = ts?.billable_hours ?? 0;
      const nonBillableHours = ts?.non_billable_hours ?? 0;
      const laborCost = Math.round((billableHours + nonBillableHours) * costRate * 100) / 100;
      const billableLaborValue = Math.round(billableHours * billRate * 100) / 100;
      const invoicedRevenue = Math.round((inv?.invoiced_revenue ?? 0) * 100) / 100;
      const supplierCosts = Math.round((inv?.supplier_costs ?? 0) * 100) / 100;
      const glDirectCosts = Math.round((jrn?.gl_expenses ?? 0) * 100) / 100;
      const totalActualCost = Math.round((supplierCosts + laborCost + glDirectCosts) * 100) / 100;
      const effectiveRevenue = invoicedRevenue > 0 ? invoicedRevenue : billableLaborValue;
      const grossProfit = Math.round((invoicedRevenue - totalActualCost) * 100) / 100;
      const marginPct = invoicedRevenue > 0 ? Math.round((grossProfit / invoicedRevenue) * 1000) / 10 : 0;
      const budgetUtilizationPct = plannedBudget > 0 ? Math.round((totalActualCost / plannedBudget) * 1000) / 10 : 0;
      return {
        project_id: p.id,
        project_ref: p.ref,
        project_title: p.title,
        customer_name: p.customer_name || 'Internal',
        status: p.status,
        progress: p.progress,
        planned_budget: plannedBudget,
        committed_cost: committedCost,
        invoiced_revenue: invoicedRevenue,
        billable_hours: billableHours,
        non_billable_hours: nonBillableHours,
        labor_cost: laborCost,
        billable_labor_value: billableLaborValue,
        supplier_costs: supplierCosts,
        gl_direct_costs: glDirectCosts,
        total_actual_cost: totalActualCost,
        effective_revenue: effectiveRevenue,
        gross_profit: grossProfit,
        margin_pct: marginPct,
        budget_utilization_pct: budgetUtilizationPct,
      };
    });

    // AR & AP Aging Summary
    const openInvoices = (await db
      .prepare(
        `SELECT invoice_type, due_date, total_ttc, amount_paid, exchange_rate
         FROM invoices
         WHERE status IN ('validated', 'partial')`
      )
      .all()) as Array<{
      invoice_type: 'customer' | 'supplier';
      due_date: string;
      total_ttc: number;
      amount_paid: number;
      exchange_rate: number;
    }>;

    const todayMs = Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate()
    );
    const emptyAging = () => ({ current: 0, days_1_30: 0, days_31_60: 0, days_61_plus: 0, total: 0 });
    const arAging = emptyAging();
    const apAging = emptyAging();
    for (const inv of openInvoices) {
      const fx = inv.exchange_rate && inv.exchange_rate > 0 ? inv.exchange_rate : 1;
      const remaining = Math.max(0, (inv.total_ttc - inv.amount_paid) / fx);
      if (remaining <= 0.005) continue;
      const dueMs = Date.parse(`${inv.due_date}T00:00:00Z`);
      const daysOverdue = Number.isFinite(dueMs) ? Math.floor((todayMs - dueMs) / 86400000) : 0;
      const bucket = inv.invoice_type === 'supplier' ? apAging : arAging;
      if (daysOverdue <= 0) bucket.current += remaining;
      else if (daysOverdue <= 30) bucket.days_1_30 += remaining;
      else if (daysOverdue <= 60) bucket.days_31_60 += remaining;
      else bucket.days_61_plus += remaining;
      bucket.total += remaining;
    }
    for (const b of [arAging, apAging]) {
      b.current = Math.round(b.current * 100) / 100;
      b.days_1_30 = Math.round(b.days_1_30 * 100) / 100;
      b.days_31_60 = Math.round(b.days_31_60 * 100) / 100;
      b.days_61_plus = Math.round(b.days_61_plus * 100) / 100;
      b.total = Math.round(b.total * 100) / 100;
    }

    // Automated Financial Statements (Trial Balance, Profit & Loss, Balance Sheet)
    const activeAccts = accounts.filter((a) => a.is_active !== 0);
    let totalDebits = 0;
    let totalCredits = 0;
    const trialBalanceRows = activeAccts.map((a) => {
      const isDebitNormal = a.account_class === 'asset' || a.account_class === 'expense';
      const debit = isDebitNormal ? (a.balance >= 0 ? a.balance : 0) : a.balance < 0 ? Math.abs(a.balance) : 0;
      const credit = !isDebitNormal ? (a.balance >= 0 ? a.balance : 0) : a.balance < 0 ? Math.abs(a.balance) : 0;
      totalDebits += debit;
      totalCredits += credit;
      return {
        code: a.code,
        label: a.label,
        account_class: a.account_class,
        debit: Math.round(debit * 100) / 100,
        credit: Math.round(credit * 100) / 100,
      };
    });
    totalDebits = Math.round(totalDebits * 100) / 100;
    totalCredits = Math.round(totalCredits * 100) / 100;

    const revenueItems = activeAccts
      .filter((a) => a.account_class === 'revenue')
      .map((a) => ({ code: a.code, label: a.label, amount: Math.round(a.balance * 100) / 100 }));
    const expenseItems = activeAccts
      .filter((a) => a.account_class === 'expense')
      .map((a) => ({ code: a.code, label: a.label, amount: Math.round(a.balance * 100) / 100 }));
    const totalRevenue = Math.round(revenueItems.reduce((s, x) => s + x.amount, 0) * 100) / 100;
    const totalExpenses = Math.round(expenseItems.reduce((s, x) => s + x.amount, 0) * 100) / 100;
    const netIncome = Math.round((totalRevenue - totalExpenses) * 100) / 100;

    const assetItems = activeAccts
      .filter((a) => a.account_class === 'asset')
      .map((a) => ({ code: a.code, label: a.label, amount: Math.round(a.balance * 100) / 100 }));
    const liabilityItems = activeAccts
      .filter((a) => a.account_class === 'liability')
      .map((a) => ({ code: a.code, label: a.label, amount: Math.round(a.balance * 100) / 100 }));
    const equityItems = activeAccts
      .filter((a) => a.account_class === 'equity')
      .map((a) => ({ code: a.code, label: a.label, amount: Math.round(a.balance * 100) / 100 }));
    const totalAssets = Math.round(assetItems.reduce((s, x) => s + x.amount, 0) * 100) / 100;
    const totalLiabilities = Math.round(liabilityItems.reduce((s, x) => s + x.amount, 0) * 100) / 100;
    const totalEquity = Math.round(equityItems.reduce((s, x) => s + x.amount, 0) * 100) / 100;
    const totalLiabilitiesAndEquity = Math.round((totalLiabilities + totalEquity + netIncome) * 100) / 100;

    res.json({
      sepaBatches,
      accounts,
      journalEntries,
      donations,
      loans,
      marginStats,
      fiscalPeriods,
      currencies,
      baseCurrency: await currencyService.getBaseCurrency(),
      periodRates: (await currencyService.getMultiCurrencyWorkspace()).periodRates,
      taxRates,
      projectBudgets,
      projectProfitability,
      fixedAssets,
      recurringInvoices,
      agingSummary: { ar: arAging, ap: apAging },
      financialStatements: {
        trialBalance: {
          rows: trialBalanceRows,
          totalDebits,
          totalCredits,
          isBalanced: Math.abs(totalDebits - totalCredits) < 0.02,
        },
        profitAndLoss: {
          revenueItems,
          expenseItems,
          totalRevenue,
          totalExpenses,
          netIncome,
          netMarginPct: totalRevenue > 0 ? Math.round((netIncome / totalRevenue) * 1000) / 10 : 0,
        },
        balanceSheet: {
          assetItems,
          liabilityItems,
          equityItems,
          totalAssets,
          totalLiabilities,
          totalEquity,
          netIncome,
          totalLiabilitiesAndEquity,
          isBalanced: Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.02,
        },
      },
    });
  });

  router.post('/sepa-batches', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const { batchType = 'credit_transfer', bankAccountId, executionDate, partyName, iban, invoiceRef = '', amount } = req.body ?? {};
    const amt = Number(amount);
    if (!bankAccountId || !String(partyName ?? '').trim() || !String(iban ?? '').trim() || !Number.isFinite(amt) || amt <= 0) {
      res.status(400).json({ error: 'Bank account, counterparty, IBAN, and positive amount are required.' });
      return;
    }
    const ref = (await seqRef('sepa_batches', 'SEPA'));
    const items = [{ partyName: String(partyName).trim(), iban: String(iban).trim().toUpperCase(), invoiceRef: String(invoiceRef).trim(), amount: amt }];
    const info = (await db
      .prepare(
        `INSERT INTO sepa_batches (ref, batch_type, bank_account_id, execution_date, total_amount, items_json, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'prepared', ?)`
      )
      .run(
        ref,
        batchType === 'direct_debit' ? 'direct_debit' : 'credit_transfer',
        Number(bankAccountId),
        String(executionDate || new Date().toISOString().slice(0, 10)),
        amt,
        JSON.stringify(items),
        req.authUser!.email
      ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_SEPA_BATCH',
      module: 'billing',
      entityRef: ref,
      details: `Prepared SEPA ${batchType} batch ${ref} ($${amt.toFixed(2)})`,
      ipAddress: getClientIp(req),
    }));
    res.status(201).json((await db.prepare('SELECT * FROM sepa_batches WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/sepa-batches/:id', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM sepa_batches WHERE id = ?').get(id)) as
      | { id: number; ref: string; items_json: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'SEPA batch not found.' });
      return;
    }
    const { batchType, bankAccountId, executionDate, partyName, iban, invoiceRef, amount, status } = req.body ?? {};
    const items = JSON.parse(existing.items_json || '[]') as Array<{
      partyName: string;
      iban: string;
      invoiceRef: string;
      amount: number;
    }>;
    const first = items[0] ?? { partyName: '', iban: '', invoiceRef: '', amount: 0 };
    const nextAmt = amount !== undefined ? Number(amount) : first.amount;
    if (!Number.isFinite(nextAmt) || nextAmt <= 0) {
      res.status(400).json({ error: 'Positive SEPA amount is required.' });
      return;
    }
    const updatedItems = [
      {
        partyName: partyName ? String(partyName).trim() : first.partyName,
        iban: iban ? String(iban).trim().toUpperCase() : first.iban,
        invoiceRef: invoiceRef !== undefined ? String(invoiceRef).trim() : first.invoiceRef,
        amount: nextAmt,
      },
    ];
    (await db.prepare(
      `UPDATE sepa_batches
       SET batch_type = COALESCE(?, batch_type),
           bank_account_id = COALESCE(?, bank_account_id),
           execution_date = COALESCE(?, execution_date),
           total_amount = ?,
           items_json = ?,
           status = COALESCE(?, status)
       WHERE id = ?`
    ).run(
      batchType === 'direct_debit' || batchType === 'credit_transfer' ? batchType : null,
      bankAccountId !== undefined ? Number(bankAccountId) : null,
      executionDate ? String(executionDate) : null,
      nextAmt,
      JSON.stringify(updatedItems),
      ['prepared', 'transmitted', 'settled'].includes(status) ? status : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_SEPA_BATCH',
      module: 'billing',
      entityRef: existing.ref,
      details: `Updated SEPA batch ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM sepa_batches WHERE id = ?').get(id)));
  });

  router.delete('/sepa-batches/:id', authenticate, requirePermission('billing', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM sepa_batches WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'SEPA batch not found.' });
      return;
    }
    (await db.prepare('DELETE FROM sepa_batches WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_SEPA_BATCH',
      module: 'billing',
      entityRef: existing.ref,
      details: `Deleted SEPA batch ${existing.ref}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.get('/sepa-batches/:id/xml', authenticate, requirePermission('billing', 'read'), async (req, res) => {
    const id = Number(req.params.id);
    const batch = (await db.prepare('SELECT * FROM sepa_batches WHERE id = ?').get(id)) as
      | { ref: string; batch_type: string; execution_date: string; total_amount: number; items_json: string }
      | undefined;
    if (!batch) {
      res.status(404).json({ error: 'SEPA batch not found.' });
      return;
    }
    const items = JSON.parse(batch.items_json) as Array<{ partyName: string; iban: string; invoiceRef: string; amount: number }>;
    const isDebit = batch.batch_type === 'direct_debit';
    const rootTag = isDebit ? 'CstmrDrctDbtInitn' : 'CstmrCdtTrfInitn';
    const schemaNs = isDebit ? 'urn:iso:std:iso:20022:tech:xsd:pain.008.001.02' : 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03';

    const txBlocks = items
      .map(
        (item, idx) => `      <PmtTx>
        <PmtId><EndToEndId>${escapeXml(`${batch.ref}-${idx + 1}`)}</EndToEndId></PmtId>
        <Amt Ccy="EUR">${item.amount.toFixed(2)}</Amt>
        <Counterparty><Nm>${escapeXml(item.partyName)}</Nm><IBAN>${escapeXml(item.iban)}</IBAN></Counterparty>
        <RmtInf><Ustrd>${escapeXml(item.invoiceRef || batch.ref)}</Ustrd></RmtInf>
      </PmtTx>`
      )
      .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="${schemaNs}">
  <${rootTag}>
    <GrpHdr>
      <MsgId>${escapeXml(batch.ref)}</MsgId>
      <CreDtTm>${new Date().toISOString()}</CreDtTm>
      <NbOfTxs>${items.length}</NbOfTxs>
      <CtrlSum>${batch.total_amount.toFixed(2)}</CtrlSum>
      <InitgPty><Nm>KSCAT-ERP Treasury</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${escapeXml(batch.ref)}-PMT</PmtInfId>
      <PmtMtd>${isDebit ? 'DD' : 'TRF'}</PmtMtd>
      <ReqdExctnDt>${escapeXml(batch.execution_date)}</ReqdExctnDt>
${txBlocks}
    </PmtInf>
  </${rootTag}>
</Document>`;
    res.json({ ref: batch.ref, xml });
  });

  router.post('/accounting/accounts', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const { code, label, accountClass = 'expense' } = req.body ?? {};
    const cleanCode = String(code ?? '').trim();
    const cleanLabel = String(label ?? '').trim();
    if (!cleanCode || !cleanLabel) {
      res.status(400).json({ error: 'Account code and label are required.' });
      return;
    }
    try {
      const info = (await db
        .prepare(`INSERT INTO accounting_accounts (code, label, account_class, balance) VALUES (?, ?, ?, 0)`)
        .run(cleanCode, cleanLabel, ['asset', 'liability', 'equity', 'revenue', 'expense'].includes(accountClass) ? accountClass : 'expense'));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'CREATE_GL_ACCOUNT',
        module: 'billing',
        entityRef: cleanCode,
        details: `Created GL account ${cleanCode} ${cleanLabel}`,
        ipAddress: getClientIp(req),
      }));
      res.status(201).json((await db.prepare('SELECT * FROM accounting_accounts WHERE id = ?').get(info.lastInsertRowid)));
    } catch {
      res.status(400).json({ error: 'Account code already exists.' });
    }
  });

  router.put('/accounting/accounts/:id', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT code FROM accounting_accounts WHERE id = ?').get(id)) as { code: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'GL account not found.' });
      return;
    }
    const { label, accountClass, isActive } = req.body ?? {};
    (await db.prepare(
      `UPDATE accounting_accounts
       SET label = COALESCE(?, label),
           account_class = COALESCE(?, account_class),
           is_active = COALESCE(?, is_active)
       WHERE id = ?`
    ).run(
      label ? String(label).trim() : null,
      ['asset', 'liability', 'equity', 'revenue', 'expense'].includes(accountClass) ? accountClass : null,
      isActive !== undefined ? (isActive ? 1 : 0) : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_GL_ACCOUNT',
      module: 'billing',
      entityRef: existing.code,
      details: `Updated GL account ${existing.code}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM accounting_accounts WHERE id = ?').get(id)));
  });

  router.delete('/accounting/accounts/:id', authenticate, requirePermission('billing', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT code, label FROM accounting_accounts WHERE id = ?').get(id)) as
      | { code: string; label: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'GL account not found.' });
      return;
    }
    const used = (
      (await db
        .prepare('SELECT COUNT(*) AS cnt FROM journal_entries WHERE debit_account_code = ? OR credit_account_code = ?')
        .get(existing.code, existing.code)) as { cnt: number }
    ).cnt;
    if (used > 0) {
      res.status(409).json({ error: `Cannot delete GL account ${existing.code} used in ${used} journal entry(s).` });
      return;
    }
    (await db.prepare('DELETE FROM accounting_accounts WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_GL_ACCOUNT',
      module: 'billing',
      entityRef: existing.code,
      details: `Deleted GL account ${existing.code} ${existing.label}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  type GlFilterParams = {
    dateFrom?: string;
    dateTo?: string;
    accountType?: string;
    accountCode?: string;
    entryStatus?: string;
    search?: string;
    sort?: string;
  };

  async function queryGeneralLedgerReport(q: GlFilterParams) {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    const dateFrom = String(q.dateFrom ?? '').trim();
    const dateTo = String(q.dateTo ?? '').trim();
    const accountType = String(q.accountType ?? 'all').trim().toLowerCase();
    const accountCode = String(q.accountCode ?? 'all').trim();
    const entryStatusFilter = String(q.entryStatus ?? 'all').trim().toLowerCase();
    const search = String(q.search ?? '').trim().toLowerCase();
    const sortDir = String(q.sort ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    if (dateFrom) {
      conditions.push('je.entry_date >= ?');
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push('je.entry_date <= ?');
      params.push(dateTo);
    }
    if (['asset', 'liability', 'equity', 'revenue', 'expense'].includes(accountType)) {
      conditions.push('(da.account_class = ? OR ca.account_class = ?)');
      params.push(accountType, accountType);
    }
    if (accountCode && accountCode !== 'all') {
      conditions.push('(je.debit_account_code = ? OR je.credit_account_code = ?)');
      params.push(accountCode, accountCode);
    }
    if (search) {
      const pattern = `%${search}%`;
      conditions.push(
        `(LOWER(je.ref) LIKE ? OR LOWER(je.description) LIKE ? OR LOWER(je.journal_code) LIKE ? OR LOWER(je.source_ref) LIKE ? OR LOWER(je.debit_account_code) LIKE ? OR LOWER(je.credit_account_code) LIKE ? OR LOWER(COALESCE(p.ref, '')) LIKE ? OR LOWER(je.created_by) LIKE ?)`
      );
      params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rawEntries = (await db
      .prepare(
        `SELECT je.*,
                da.label AS debit_account_label,
                da.account_class AS debit_account_class,
                ca.label AS credit_account_label,
                ca.account_class AS credit_account_class,
                p.ref AS project_ref,
                p.title AS project_title
         FROM journal_entries je
         LEFT JOIN accounting_accounts da ON da.code = je.debit_account_code
         LEFT JOIN accounting_accounts ca ON ca.code = je.credit_account_code
         LEFT JOIN projects p ON p.id = je.project_id
         ${whereClause}
         ORDER BY je.entry_date ${sortDir}, je.id ${sortDir}
         LIMIT 500`
      )
      .all(...params)) as Array<{
      id: number;
      ref: string;
      entry_date: string;
      journal_code: string;
      description: string;
      debit_account_code: string;
      credit_account_code: string;
      amount: number;
      currency: string;
      exchange_rate: number;
      original_amount: number;
      source_ref: string;
      project_id: number | null;
      is_reversal: number;
      reversed_entry_ref: string;
      created_by: string;
      created_at: string;
      debit_account_label: string | null;
      debit_account_class: string | null;
      credit_account_label: string | null;
      credit_account_class: string | null;
      project_ref: string | null;
      project_title: string | null;
    }>;

    const reversedRows = (await db
      .prepare(`SELECT DISTINCT reversed_entry_ref FROM journal_entries WHERE reversed_entry_ref != ''`)
      .all()) as Array<{ reversed_entry_ref: string }>;
    const reversedRefs = new Set(reversedRows.map((r) => r.reversed_entry_ref));

    const fiscalPeriods = (await db
      .prepare('SELECT * FROM fiscal_periods ORDER BY start_date DESC, id DESC')
      .all()) as Array<{
      id: number;
      code: string;
      name: string;
      start_date: string;
      end_date: string;
      status: 'open' | 'closed';
    }>;

    const accounts = (await db
      .prepare('SELECT * FROM accounting_accounts ORDER BY code ASC')
      .all()) as Array<{
      id: number;
      code: string;
      label: string;
      account_class: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
      balance: number;
      is_active: number;
    }>;

    const enriched = rawEntries
      .map((e) => {
        const matchedPeriod = fiscalPeriods.find(
          (fp) => e.entry_date >= fp.start_date && e.entry_date <= fp.end_date
        );
        let entryStatus: 'posted' | 'reversal' | 'reversed' | 'locked' = 'posted';
        if (reversedRefs.has(e.ref)) {
          entryStatus = 'reversed';
        } else if (e.is_reversal === 1 || Boolean(e.reversed_entry_ref)) {
          entryStatus = 'reversal';
        } else if (matchedPeriod?.status === 'closed') {
          entryStatus = 'locked';
        }
        return {
          ...e,
          debit_account_label: e.debit_account_label ?? e.debit_account_code,
          debit_account_class: e.debit_account_class ?? 'expense',
          credit_account_label: e.credit_account_label ?? e.credit_account_code,
          credit_account_class: e.credit_account_class ?? 'asset',
          entry_status: entryStatus,
          fiscal_period_code: matchedPeriod?.code ?? '',
          fiscal_period_status: matchedPeriod?.status ?? 'open',
        };
      })
      .filter((e) => entryStatusFilter === 'all' || e.entry_status === entryStatusFilter);

    type LedgerLine = {
      line_id: string;
      entry_id: number;
      ref: string;
      entry_date: string;
      journal_code: string;
      account_code: string;
      account_label: string;
      account_class: string;
      counterpart_code: string;
      counterpart_label: string;
      description: string;
      source_ref: string;
      project_ref: string | null;
      debit: number;
      credit: number;
      currency: string;
      exchange_rate: number;
      original_amount: number;
      entry_status: 'posted' | 'reversal' | 'reversed' | 'locked';
      fiscal_period_code: string;
      reversed_entry_ref: string;
      created_by: string;
    };

    const lines: LedgerLine[] = [];
    const acctStats = new Map<
      string,
      {
        code: string;
        label: string;
        account_class: string;
        current_balance: number;
        period_debits: number;
        period_credits: number;
        tx_ids: Set<number>;
      }
    >();

    for (const a of accounts) {
      if (['asset', 'liability', 'equity', 'revenue', 'expense'].includes(accountType) && a.account_class !== accountType) {
        continue;
      }
      if (accountCode && accountCode !== 'all' && a.code !== accountCode) {
        continue;
      }
      acctStats.set(a.code, {
        code: a.code,
        label: a.label,
        account_class: a.account_class,
        current_balance: Math.round(a.balance * 100) / 100,
        period_debits: 0,
        period_credits: 0,
        tx_ids: new Set<number>(),
      });
    }

    const matchesAccountLeg = (code: string, cls: string): boolean => {
      if (['asset', 'liability', 'equity', 'revenue', 'expense'].includes(accountType) && cls !== accountType) {
        return false;
      }
      if (accountCode && accountCode !== 'all' && code !== accountCode) {
        return false;
      }
      return true;
    };

    let totalDebits = 0;
    let totalCredits = 0;

    for (const e of enriched) {
      if (matchesAccountLeg(e.debit_account_code, e.debit_account_class)) {
        const amt = Math.round(Number(e.amount) * 100) / 100;
        totalDebits += amt;
        lines.push({
          line_id: `${e.id}-DR`,
          entry_id: e.id,
          ref: e.ref,
          entry_date: e.entry_date,
          journal_code: e.journal_code,
          account_code: e.debit_account_code,
          account_label: e.debit_account_label,
          account_class: e.debit_account_class,
          counterpart_code: e.credit_account_code,
          counterpart_label: e.credit_account_label,
          description: e.description,
          source_ref: e.source_ref,
          project_ref: e.project_ref,
          debit: amt,
          credit: 0,
          currency: e.currency || 'USD',
          exchange_rate: e.exchange_rate || 1,
          original_amount: e.original_amount > 0 ? e.original_amount : amt,
          entry_status: e.entry_status,
          fiscal_period_code: e.fiscal_period_code,
          reversed_entry_ref: e.reversed_entry_ref,
          created_by: e.created_by,
        });
        const st = acctStats.get(e.debit_account_code);
        if (st) {
          st.period_debits += amt;
          st.tx_ids.add(e.id);
        }
      }

      if (matchesAccountLeg(e.credit_account_code, e.credit_account_class)) {
        const amt = Math.round(Number(e.amount) * 100) / 100;
        totalCredits += amt;
        lines.push({
          line_id: `${e.id}-CR`,
          entry_id: e.id,
          ref: e.ref,
          entry_date: e.entry_date,
          journal_code: e.journal_code,
          account_code: e.credit_account_code,
          account_label: e.credit_account_label,
          account_class: e.credit_account_class,
          counterpart_code: e.debit_account_code,
          counterpart_label: e.debit_account_label,
          description: e.description,
          source_ref: e.source_ref,
          project_ref: e.project_ref,
          debit: 0,
          credit: amt,
          currency: e.currency || 'USD',
          exchange_rate: e.exchange_rate || 1,
          original_amount: e.original_amount > 0 ? e.original_amount : amt,
          entry_status: e.entry_status,
          fiscal_period_code: e.fiscal_period_code,
          reversed_entry_ref: e.reversed_entry_ref,
          created_by: e.created_by,
        });
        const st = acctStats.get(e.credit_account_code);
        if (st) {
          st.period_credits += amt;
          st.tx_ids.add(e.id);
        }
      }
    }

    totalDebits = Math.round(totalDebits * 100) / 100;
    totalCredits = Math.round(totalCredits * 100) / 100;

    const accountSummary = Array.from(acctStats.values()).map((st) => ({
      code: st.code,
      label: st.label,
      account_class: st.account_class,
      current_balance: st.current_balance,
      period_debits: Math.round(st.period_debits * 100) / 100,
      period_credits: Math.round(st.period_credits * 100) / 100,
      net_change: Math.round((st.period_debits - st.period_credits) * 100) / 100,
      tx_count: st.tx_ids.size,
    }));

    return {
      entries: enriched,
      lines,
      accountSummary,
      accounts,
      fiscalPeriods,
      summary: {
        entryCount: enriched.length,
        lineCount: lines.length,
        totalDebits,
        totalCredits,
        netMovement: Math.round((totalDebits - totalCredits) * 100) / 100,
        isBalanced: Math.abs(totalDebits - totalCredits) < 0.02,
      },
    };
  }

  router.get('/accounting/general-ledger', authenticate, requirePermission('billing', 'read'), async (req, res) => {
    const q = req.query as GlFilterParams;
    const result = await queryGeneralLedgerReport(q);
    res.json(result);
  });

  router.get('/accounting/general-ledger/export', authenticate, requirePermission('billing', 'read'), async (req, res) => {
    const q = req.query as GlFilterParams;
    const result = await queryGeneralLedgerReport(q);
    const headers = [
      'Date',
      'Journal Ref',
      'Journal Code',
      'Account Code',
      'Account Label',
      'Account Type',
      'Counterpart Account',
      'Description',
      'Source Ref',
      'Project',
      'Period',
      'Status',
      'Debit',
      'Credit',
    ];
    const csvLines = [
      headers.map(sanitizeCsvCell).join(','),
      ...result.lines.map((l) =>
        [
          l.entry_date,
          l.ref,
          l.journal_code,
          l.account_code,
          l.account_label,
          l.account_class,
          `${l.counterpart_code} ${l.counterpart_label}`,
          l.description,
          l.source_ref,
          l.project_ref ?? '',
          l.fiscal_period_code,
          l.entry_status,
          l.debit.toFixed(2),
          l.credit.toFixed(2),
        ]
          .map(sanitizeCsvCell)
          .join(',')
      ),
    ];
    res.json({
      count: result.lines.length,
      filename: `kscat-general-ledger-${new Date().toISOString().slice(0, 10)}.csv`,
      csv: csvLines.join('\n'),
    });
  });

  router.post('/accounting/journal', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const {
      entryDate,
      journalCode = 'GEN',
      description,
      debitAccountCode,
      creditAccountCode,
      amount,
      originalAmount,
      currency,
      exchangeRate,
      sourceRef = '',
      projectId = null,
    } = req.body ?? {};
    const rawOriginal = originalAmount !== undefined && Number(originalAmount) > 0 ? Number(originalAmount) : Number(amount);
    if (!String(description ?? '').trim() || !debitAccountCode || !creditAccountCode || !Number.isFinite(rawOriginal) || rawOriginal <= 0) {
      res.status(400).json({ error: 'Description, debit/credit accounts, and positive amount are required.' });
      return;
    }
    if (debitAccountCode === creditAccountCode) {
      res.status(400).json({ error: 'Debit and credit accounts must be distinct for balanced double-entry.' });
      return;
    }
    const cleanDate = String(entryDate || new Date().toISOString().slice(0, 10));
    const closedPeriod = await getClosedPeriodForDate(cleanDate);
    if (closedPeriod) {
      res.status(409).json({ error: `Fiscal period ${closedPeriod.code} (${closedPeriod.name}) is closed for ${cleanDate}.` });
      return;
    }
    let normalized: Awaited<ReturnType<typeof currencyService.normalizeTransactionToBase>>;
    try {
      normalized = await currencyService.normalizeTransactionToBase({
        currency,
        originalAmount: rawOriginal,
        txDate: cleanDate,
        explicitRate: exchangeRate !== undefined ? Number(exchangeRate) : null,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid currency conversion parameters.' });
      return;
    }
    const amt = normalized.baseAmount;
    const cleanProjId = projectId !== null && projectId !== '' && Number(projectId) > 0 ? Number(projectId) : null;
    const ref = (await seqRef('journal_entries', 'JRN'));
    (await db.exec('BEGIN'));
    try {
      const info = (await db
        .prepare(
          `INSERT INTO journal_entries (ref, entry_date, journal_code, description, debit_account_code, credit_account_code, amount, currency, exchange_rate, original_amount, source_ref, project_id, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          ref,
          cleanDate,
          String(journalCode).trim().toUpperCase() || 'GEN',
          String(description).trim(),
          String(debitAccountCode),
          String(creditAccountCode),
          amt,
          normalized.currency,
          normalized.exchangeRate,
          normalized.originalAmount,
          String(sourceRef).trim(),
          cleanProjId,
          req.authUser!.email
        ));
      await applyAccountPosting(String(debitAccountCode), 'debit', amt);
      await applyAccountPosting(String(creditAccountCode), 'credit', amt);
      (await db.exec('COMMIT'));
      const fxNote =
        normalized.currency !== normalized.baseCurrencyCode
          ? ` (${normalized.currency} ${normalized.originalAmount.toFixed(2)} @ ${normalized.exchangeRate.toFixed(4)} → ${normalized.baseCurrencyCode} ${amt.toFixed(2)})`
          : ` ($${amt.toFixed(2)})`;
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'POST_JOURNAL_ENTRY',
        module: 'billing',
        entityRef: ref,
        details: `Posted ${journalCode} entry ${ref}: DR ${debitAccountCode} / CR ${creditAccountCode}${fxNote}`,
        ipAddress: getClientIp(req),
      }));
      res.status(201).json((await db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(info.lastInsertRowid)));
    } catch (err) {
      (await db.exec('ROLLBACK'));
      res.status(500).json({ error: err instanceof Error ? err.message : 'Journal post failed.' });
    }
  });

  router.put('/accounting/journal/:id', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id)) as
      | {
          id: number;
          ref: string;
          entry_date: string;
          journal_code: string;
          description: string;
          debit_account_code: string;
          credit_account_code: string;
          amount: number;
          currency: string;
          exchange_rate: number;
          original_amount: number;
          source_ref: string;
          project_id: number | null;
        }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Journal entry not found.' });
      return;
    }
    const existingLocked = await getClosedPeriodForDate(existing.entry_date);
    if (existingLocked) {
      res.status(409).json({ error: `Cannot modify entry inside closed period ${existingLocked.code}. Use Reversal instead.` });
      return;
    }
    const {
      entryDate,
      journalCode,
      description,
      debitAccountCode,
      creditAccountCode,
      amount,
      originalAmount,
      currency,
      exchangeRate,
      sourceRef,
      projectId,
    } = req.body ?? {};
    const nextDate = entryDate ? String(entryDate) : existing.entry_date;
    const nextLocked = await getClosedPeriodForDate(nextDate);
    if (nextLocked) {
      res.status(409).json({ error: `Target date falls inside closed fiscal period ${nextLocked.code}.` });
      return;
    }
    const nextDebit = debitAccountCode ? String(debitAccountCode) : existing.debit_account_code;
    const nextCredit = creditAccountCode ? String(creditAccountCode) : existing.credit_account_code;
    const nextCurrency = currency ? String(currency).trim().toUpperCase().slice(0, 8) : existing.currency || 'USD';
    const rawOriginal =
      originalAmount !== undefined
        ? Number(originalAmount)
        : amount !== undefined
          ? Number(amount)
          : existing.original_amount > 0
            ? existing.original_amount
            : existing.amount;
    if (!Number.isFinite(rawOriginal) || rawOriginal <= 0 || nextDebit === nextCredit) {
      res.status(400).json({ error: 'Distinct debit/credit accounts and positive amount are required.' });
      return;
    }
    let normalized: Awaited<ReturnType<typeof currencyService.normalizeTransactionToBase>>;
    try {
      normalized = await currencyService.normalizeTransactionToBase({
        currency: nextCurrency,
        originalAmount: rawOriginal,
        txDate: nextDate,
        explicitRate: exchangeRate !== undefined ? Number(exchangeRate) : null,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid currency conversion parameters.' });
      return;
    }
    const nextAmt = normalized.baseAmount;
    const nextProjId =
      projectId === undefined
        ? existing.project_id
        : projectId === null || projectId === '' || Number(projectId) <= 0
          ? null
          : Number(projectId);
    (await db.exec('BEGIN'));
    try {
      await applyAccountPosting(existing.debit_account_code, 'credit', existing.amount);
      await applyAccountPosting(existing.credit_account_code, 'debit', existing.amount);
      (await db.prepare(
        `UPDATE journal_entries
         SET entry_date = ?,
             journal_code = ?,
             description = ?,
             debit_account_code = ?,
             credit_account_code = ?,
             amount = ?,
             currency = ?,
             exchange_rate = ?,
             original_amount = ?,
             source_ref = ?,
             project_id = ?
         WHERE id = ?`
      ).run(
        nextDate,
        journalCode ? String(journalCode).trim().toUpperCase() : existing.journal_code,
        description ? String(description).trim() : existing.description,
        nextDebit,
        nextCredit,
        nextAmt,
        normalized.currency,
        normalized.exchangeRate,
        normalized.originalAmount,
        sourceRef !== undefined ? String(sourceRef).trim() : existing.source_ref,
        nextProjId,
        id
      ));
      await applyAccountPosting(nextDebit, 'debit', nextAmt);
      await applyAccountPosting(nextCredit, 'credit', nextAmt);
      (await db.exec('COMMIT'));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'UPDATE_JOURNAL_ENTRY',
        module: 'billing',
        entityRef: existing.ref,
        details: `Updated journal entry ${existing.ref}`,
        ipAddress: getClientIp(req),
      }));
      res.json((await db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id)));
    } catch (err) {
      (await db.exec('ROLLBACK'));
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to update journal entry.' });
    }
  });

  router.post('/accounting/journal/:id/reverse', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id)) as
      | {
          id: number;
          ref: string;
          journal_code: string;
          description: string;
          debit_account_code: string;
          credit_account_code: string;
          amount: number;
          currency: string;
          exchange_rate: number;
          original_amount: number;
          project_id: number | null;
        }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Journal entry not found.' });
      return;
    }
    const revDate = String(req.body?.entryDate || new Date().toISOString().slice(0, 10));
    const closedPeriod = await getClosedPeriodForDate(revDate);
    if (closedPeriod) {
      res.status(409).json({ error: `Reversal date falls inside closed fiscal period ${closedPeriod.code}. Choose an open period date.` });
      return;
    }
    const revRef = await seqRef('journal_entries', 'REV');
    (await db.exec('BEGIN'));
    try {
      const info = await db
        .prepare(
          `INSERT INTO journal_entries (ref, entry_date, journal_code, description, debit_account_code, credit_account_code, amount, currency, exchange_rate, original_amount, source_ref, project_id, is_reversal, reversed_entry_ref, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
        )
        .run(
          revRef,
          revDate,
          existing.journal_code,
          `Reversal of ${existing.ref}: ${existing.description}`,
          existing.credit_account_code,
          existing.debit_account_code,
          existing.amount,
          existing.currency || 'USD',
          existing.exchange_rate || 1,
          existing.original_amount > 0 ? existing.original_amount : existing.amount,
          existing.ref,
          existing.project_id ?? null,
          existing.ref,
          req.authUser!.email
        );
      await applyAccountPosting(existing.credit_account_code, 'debit', existing.amount);
      await applyAccountPosting(existing.debit_account_code, 'credit', existing.amount);
      (await db.exec('COMMIT'));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'REVERSE_JOURNAL_ENTRY',
        module: 'billing',
        entityRef: revRef,
        details: `Posted reversal ${revRef} offsetting ${existing.ref} ($${existing.amount.toFixed(2)})`,
        ipAddress: getClientIp(req),
      }));
      res.status(201).json(await db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(info.lastInsertRowid));
    } catch (err) {
      (await db.exec('ROLLBACK'));
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to reverse journal entry.' });
    }
  });

  router.delete('/accounting/journal/:id', authenticate, requirePermission('billing', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id)) as
      | { id: number; ref: string; entry_date: string; debit_account_code: string; credit_account_code: string; amount: number }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Journal entry not found.' });
      return;
    }
    const closedPeriod = await getClosedPeriodForDate(existing.entry_date);
    if (closedPeriod) {
      res.status(409).json({ error: `Cannot delete entry inside closed fiscal period ${closedPeriod.code}. Post a reversal instead.` });
      return;
    }
    (await db.exec('BEGIN'));
    try {
      await applyAccountPosting(existing.debit_account_code, 'credit', existing.amount);
      await applyAccountPosting(existing.credit_account_code, 'debit', existing.amount);
      (await db.prepare('DELETE FROM journal_entries WHERE id = ?').run(id));
      (await db.exec('COMMIT'));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'DELETE_JOURNAL_ENTRY',
        module: 'billing',
        entityRef: existing.ref,
        details: `Deleted and reversed journal entry ${existing.ref}`,
        ipAddress: getClientIp(req),
        severity: 'warning',
      }));
      res.json({ ok: true });
    } catch (err) {
      (await db.exec('ROLLBACK'));
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to delete journal entry.' });
    }
  });

  // ========================
  // BANK RECONCILIATION
  // ========================
  type ParsedBankLineInput = {
    txDate: string;
    description: string;
    reference: string;
    direction: 'credit' | 'debit';
    amount: number;
    runningBalance: number | null;
  };

  function normalizeStatementDate(raw: string): string | null {
    const clean = String(raw ?? '').trim();
    if (!clean) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
    const slashIso = clean.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
    if (slashIso) {
      return `${slashIso[1]}-${slashIso[2].padStart(2, '0')}-${slashIso[3].padStart(2, '0')}`;
    }
    const usDate = clean.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (usDate) {
      const m = Number(usDate[1]);
      const d = Number(usDate[2]);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return `${usDate[3]}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
    return null;
  }

  function parseNumericAmount(raw: unknown): number | null {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    const str = String(raw ?? '').trim();
    if (!str) return null;
    const isParenNegative = /^\(.*\)$/.test(str);
    const cleaned = str.replace(/[(),$\s€£₱¥]/g, '');
    if (!cleaned || !/^[+-]?\d+(\.\d+)?$/.test(cleaned)) return null;
    const val = Number(cleaned);
    if (!Number.isFinite(val)) return null;
    return isParenNegative ? -Math.abs(val) : val;
  }

  function splitCsvRow(line: string, delimiter: string): string[] {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  }

  function parseBankStatementCsv(csvText: string): { lines: ParsedBankLineInput[]; error?: string } {
    if (csvText.length > 512_000) {
      return { lines: [], error: 'CSV statement exceeds 512 KB limit.' };
    }
    const rawLines = csvText
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (rawLines.length < 2) {
      return { lines: [], error: 'CSV must include a header row and at least one transaction row.' };
    }
    if (rawLines.length > 501) {
      return { lines: [], error: 'CSV statements are limited to 500 lines per upload.' };
    }

    const headerRaw = rawLines[0];
    const delimiter =
      headerRaw.split(';').length > headerRaw.split(',').length
        ? ';'
        : headerRaw.split('\t').length > headerRaw.split(',').length
          ? '\t'
          : ',';

    const headers = splitCsvRow(headerRaw, delimiter).map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, '_'));
    const findCol = (candidates: string[]) => headers.findIndex((h) => candidates.some((c) => h === c || h.includes(c)));

    const dateIdx = findCol(['tx_date', 'transaction_date', 'posting_date', 'value_date', 'date']);
    const descIdx = findCol(['description', 'memo', 'label', 'narrative', 'details', 'particulars', 'payee']);
    const refIdx = findCol(['reference', 'ref', 'check', 'tx_id', 'transaction_id', 'doc_ref']);
    const debitIdx = findCol(['debit', 'withdrawal', 'outflow']);
    const creditIdx = findCol(['credit', 'deposit', 'inflow']);
    const amtIdx = findCol(['amount', 'net', 'value']);
    const dirIdx = findCol(['direction', 'type', 'dr_cr', 'side']);
    const balIdx = findCol(['running_balance', 'balance']);

    if (dateIdx === -1 || descIdx === -1 || (amtIdx === -1 && debitIdx === -1 && creditIdx === -1)) {
      return {
        lines: [],
        error: 'CSV headers must include Date, Description, and either Amount or Debit/Credit columns.',
      };
    }

    const parsed: ParsedBankLineInput[] = [];
    for (let r = 1; r < rawLines.length; r++) {
      const row = splitCsvRow(rawLines[r], delimiter);
      if (row.every((cell) => !cell)) continue;
      const txDate = normalizeStatementDate(row[dateIdx] ?? '');
      const description = String(row[descIdx] ?? '').trim();
      if (!txDate || !description) {
        return { lines: [], error: `Row ${r + 1}: valid date and description are required.` };
      }

      let direction: 'credit' | 'debit' = 'debit';
      let amount = 0;

      const drVal = debitIdx >= 0 ? parseNumericAmount(row[debitIdx]) : null;
      const crVal = creditIdx >= 0 ? parseNumericAmount(row[creditIdx]) : null;

      if (drVal !== null && Math.abs(drVal) > 0) {
        direction = 'debit';
        amount = Math.abs(drVal);
      } else if (crVal !== null && Math.abs(crVal) > 0) {
        direction = 'credit';
        amount = Math.abs(crVal);
      } else if (amtIdx >= 0) {
        const rawAmt = parseNumericAmount(row[amtIdx]);
        if (rawAmt === null || Math.abs(rawAmt) <= 0) {
          return { lines: [], error: `Row ${r + 1}: positive transaction amount is required.` };
        }
        const dirText = dirIdx >= 0 ? String(row[dirIdx] ?? '').trim().toLowerCase() : '';
        if (['credit', 'cr', 'deposit', 'inflow', 'in'].includes(dirText)) {
          direction = 'credit';
        } else if (['debit', 'dr', 'withdrawal', 'outflow', 'out'].includes(dirText)) {
          direction = 'debit';
        } else {
          direction = rawAmt >= 0 ? 'credit' : 'debit';
        }
        amount = Math.abs(rawAmt);
      } else {
        return { lines: [], error: `Row ${r + 1}: missing debit, credit, or amount value.` };
      }

      const runningBal = balIdx >= 0 ? parseNumericAmount(row[balIdx]) : null;
      parsed.push({
        txDate,
        description: description.slice(0, 240),
        reference: refIdx >= 0 ? String(row[refIdx] ?? '').trim().slice(0, 80) : '',
        direction,
        amount: Math.round(amount * 100) / 100,
        runningBalance: runningBal !== null ? Math.round(runningBal * 100) / 100 : null,
      });
    }

    if (parsed.length === 0) {
      return { lines: [], error: 'No valid transaction rows found in CSV.' };
    }
    return { lines: parsed };
  }

  async function recomputeBankStatementStatus(statementId: number): Promise<'open' | 'in_progress' | 'reconciled'> {
    const counts = (await db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN match_status = 'matched' THEN 1 ELSE 0 END) AS matched_cnt,
                SUM(CASE WHEN match_status = 'ignored' THEN 1 ELSE 0 END) AS ignored_cnt
         FROM bank_statement_lines
         WHERE statement_id = ?`
      )
      .get(statementId)) as { total: number; matched_cnt: number | null; ignored_cnt: number | null } | undefined;

    const total = Number(counts?.total ?? 0);
    const matched = Number(counts?.matched_cnt ?? 0);
    const ignored = Number(counts?.ignored_cnt ?? 0);
    let status: 'open' | 'in_progress' | 'reconciled' = 'open';
    if (total > 0 && matched + ignored >= total) {
      status = 'reconciled';
    } else if (matched > 0 || ignored > 0) {
      status = 'in_progress';
    }
    await db.prepare('UPDATE bank_statements SET status = ? WHERE id = ?').run(status, statementId);
    return status;
  }

  router.get('/bank-reconciliation', authenticate, requirePermission('billing', 'read'), async (req, res) => {
    const requestedStmtId = Number(req.query.statementId ?? 0);
    const bankAccountFilter = Number(req.query.bankAccountId ?? 0);
    const matchStatusFilter = String(req.query.matchStatus ?? 'all').trim().toLowerCase();
    const search = String(req.query.search ?? '').trim().toLowerCase();
    const journalScope = String(req.query.journalScope ?? 'all').trim().toLowerCase();

    const bankAccounts = await db.prepare('SELECT * FROM bank_accounts ORDER BY id ASC').all();
    const stmtConditions: string[] = [];
    const stmtParams: (string | number)[] = [];
    if (bankAccountFilter > 0) {
      stmtConditions.push('bs.bank_account_id = ?');
      stmtParams.push(bankAccountFilter);
    }
    const stmtWhere = stmtConditions.length ? `WHERE ${stmtConditions.join(' AND ')}` : '';

    const statements = (await db
      .prepare(
        `SELECT bs.*,
                ba.ref AS account_ref,
                ba.name AS account_name,
                ba.bank_name AS bank_name,
                ba.balance AS account_book_balance,
                COUNT(bsl.id) AS line_count,
                COALESCE(SUM(CASE WHEN bsl.match_status = 'matched' THEN 1 ELSE 0 END), 0) AS matched_count,
                COALESCE(SUM(CASE WHEN bsl.match_status = 'unmatched' THEN 1 ELSE 0 END), 0) AS unmatched_count,
                COALESCE(SUM(CASE WHEN bsl.match_status = 'ignored' THEN 1 ELSE 0 END), 0) AS ignored_count,
                COALESCE(SUM(CASE WHEN bsl.match_status = 'matched' THEN (CASE WHEN bsl.direction = 'credit' THEN bsl.amount ELSE -bsl.amount END) ELSE 0 END), 0) AS matched_net,
                COALESCE(SUM(CASE WHEN bsl.match_status = 'unmatched' THEN bsl.amount ELSE 0 END), 0) AS unmatched_volume
         FROM bank_statements bs
         JOIN bank_accounts ba ON ba.id = bs.bank_account_id
         LEFT JOIN bank_statement_lines bsl ON bsl.statement_id = bs.id
         ${stmtWhere}
         GROUP BY bs.id
         ORDER BY bs.statement_date DESC, bs.id DESC`
      )
      .all(...stmtParams)) as Array<{
      id: number;
      ref: string;
      bank_account_id: number;
      statement_name: string;
      statement_date: string;
      period_start: string;
      period_end: string;
      opening_balance: number;
      closing_balance: number;
      currency: string;
      source_type: 'manual' | 'csv';
      status: 'open' | 'in_progress' | 'reconciled';
      notes: string;
      created_by: string;
      created_at: string;
      account_ref: string;
      account_name: string;
      bank_name: string;
      account_book_balance: number;
      line_count: number;
      matched_count: number;
      unmatched_count: number;
      ignored_count: number;
      matched_net: number;
      unmatched_volume: number;
    }>;

    const activeStatement =
      (requestedStmtId > 0 ? statements.find((s) => s.id === requestedStmtId) : undefined) ?? statements[0] ?? null;

    let lines: Array<Record<string, unknown>> = [];
    let allActiveStatementLines: Array<{
      id: number;
      direction: 'credit' | 'debit';
      amount: number;
      match_status: string;
    }> = [];

    if (activeStatement) {
      allActiveStatementLines = (await db
        .prepare('SELECT id, direction, amount, match_status FROM bank_statement_lines WHERE statement_id = ?')
        .all(activeStatement.id)) as Array<{
        id: number;
        direction: 'credit' | 'debit';
        amount: number;
        match_status: string;
      }>;

      const lineConditions: string[] = ['bsl.statement_id = ?'];
      const lineParams: (string | number)[] = [activeStatement.id];
      if (['unmatched', 'matched', 'ignored'].includes(matchStatusFilter)) {
        lineConditions.push('bsl.match_status = ?');
        lineParams.push(matchStatusFilter);
      }
      if (search) {
        const pattern = `%${search}%`;
        lineConditions.push(
          `(LOWER(bsl.description) LIKE ? OR LOWER(bsl.reference) LIKE ? OR LOWER(bsl.matched_journal_ref) LIKE ? OR LOWER(COALESCE(je.description, '')) LIKE ?)`
        );
        lineParams.push(pattern, pattern, pattern, pattern);
      }

      lines = await db
        .prepare(
          `SELECT bsl.*,
                  je.entry_date AS journal_date,
                  je.journal_code AS journal_code,
                  je.description AS journal_description,
                  je.debit_account_code AS debit_account_code,
                  je.credit_account_code AS credit_account_code,
                  je.amount AS journal_amount,
                  je.source_ref AS journal_source_ref
           FROM bank_statement_lines bsl
           LEFT JOIN journal_entries je ON je.id = bsl.matched_journal_entry_id
           WHERE ${lineConditions.join(' AND ')}
           ORDER BY bsl.tx_date ASC, bsl.id ASC`
        )
        .all(...lineParams);
    }

    const matchedLinks = (await db
      .prepare(
        `SELECT bsl.id AS line_id,
                bsl.matched_journal_entry_id AS journal_entry_id,
                bs.ref AS statement_ref
         FROM bank_statement_lines bsl
         JOIN bank_statements bs ON bs.id = bsl.statement_id
         WHERE bsl.match_status = 'matched' AND bsl.matched_journal_entry_id IS NOT NULL`
      )
      .all()) as Array<{ line_id: number; journal_entry_id: number; statement_ref: string }>;
    const matchedByJeId = new Map(matchedLinks.map((m) => [m.journal_entry_id, m]));

    const rawJournals = (await db
      .prepare(
        `SELECT je.*,
                da.label AS debit_account_label,
                ca.label AS credit_account_label,
                p.ref AS project_ref
         FROM journal_entries je
         LEFT JOIN accounting_accounts da ON da.code = je.debit_account_code
         LEFT JOIN accounting_accounts ca ON ca.code = je.credit_account_code
         LEFT JOIN projects p ON p.id = je.project_id
         ORDER BY je.entry_date DESC, je.id DESC
         LIMIT 300`
      )
      .all()) as Array<{
      id: number;
      ref: string;
      entry_date: string;
      journal_code: string;
      description: string;
      debit_account_code: string;
      credit_account_code: string;
      amount: number;
      source_ref: string;
      project_id: number | null;
      is_reversal: number;
      reversed_entry_ref: string;
      created_by: string;
      debit_account_label: string | null;
      credit_account_label: string | null;
      project_ref: string | null;
    }>;

    const journalEntries = rawJournals
      .map((je) => {
        const link = matchedByJeId.get(je.id);
        return {
          ...je,
          debit_account_label: je.debit_account_label ?? je.debit_account_code,
          credit_account_label: je.credit_account_label ?? je.credit_account_code,
          is_matched: Boolean(link),
          matched_line_id: link?.line_id ?? null,
          matched_statement_ref: link?.statement_ref ?? '',
        };
      })
      .filter((je) => (journalScope === 'unmatched' ? !je.is_matched : true));

    const accounts = await db.prepare('SELECT * FROM accounting_accounts WHERE is_active = 1 ORDER BY code ASC').all();

    let totalInflows = 0;
    let totalOutflows = 0;
    let matchedNet = 0;
    let unmatchedVolume = 0;
    let matchedCount = 0;
    let unmatchedCount = 0;
    let ignoredCount = 0;

    for (const l of allActiveStatementLines) {
      const amt = Number(l.amount) || 0;
      if (l.direction === 'credit') totalInflows += amt;
      else totalOutflows += amt;
      if (l.match_status === 'matched') {
        matchedCount++;
        matchedNet += l.direction === 'credit' ? amt : -amt;
      } else if (l.match_status === 'ignored') {
        ignoredCount++;
      } else {
        unmatchedCount++;
        unmatchedVolume += amt;
      }
    }

    const openingBalance = Number(activeStatement?.opening_balance ?? 0);
    const closingBalance = Number(activeStatement?.closing_balance ?? 0);
    const statementNetFlow = Math.round((totalInflows - totalOutflows) * 100) / 100;
    const computedEndingBalance = Math.round((openingBalance + statementNetFlow) * 100) / 100;
    const reconciledEndingBalance = Math.round((openingBalance + matchedNet) * 100) / 100;
    const reconciliationGap = activeStatement ? Math.round((closingBalance - reconciledEndingBalance) * 100) / 100 : 0;

    res.json({
      bankAccounts,
      statements,
      activeStatement,
      lines,
      journalEntries,
      accounts,
      summary: {
        totalStatements: statements.length,
        totalLines: allActiveStatementLines.length,
        matchedCount,
        unmatchedCount,
        ignoredCount,
        totalInflows: Math.round(totalInflows * 100) / 100,
        totalOutflows: Math.round(totalOutflows * 100) / 100,
        statementNetFlow,
        matchedNet: Math.round(matchedNet * 100) / 100,
        unmatchedVolume: Math.round(unmatchedVolume * 100) / 100,
        openingBalance,
        closingBalance,
        computedEndingBalance,
        reconciledEndingBalance,
        reconciliationGap,
      },
    });
  });

  router.post('/bank-reconciliation/statements', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const {
      bankAccountId,
      statementName,
      statementDate,
      periodStart,
      periodEnd,
      openingBalance = 0,
      closingBalance,
      sourceType = 'manual',
      csvText = '',
      lines: rawManualLines,
      notes = '',
    } = req.body ?? {};

    const accountId = Number(bankAccountId);
    const bankAccount = (await db.prepare('SELECT id, ref, currency FROM bank_accounts WHERE id = ?').get(accountId)) as
      | { id: number; ref: string; currency: string }
      | undefined;
    if (!bankAccount) {
      res.status(400).json({ error: 'Valid bank account is required.' });
      return;
    }

    const cleanName = String(statementName ?? '').trim();
    if (!cleanName) {
      res.status(400).json({ error: 'Statement title/name is required.' });
      return;
    }

    let parsedLines: ParsedBankLineInput[] = [];
    const normalizedSource: 'manual' | 'csv' = sourceType === 'csv' || String(csvText ?? '').trim().length > 0 ? 'csv' : 'manual';

    if (normalizedSource === 'csv' && String(csvText ?? '').trim()) {
      const result = parseBankStatementCsv(String(csvText));
      if (result.error) {
        res.status(400).json({ error: result.error });
        return;
      }
      parsedLines = result.lines;
    } else if (Array.isArray(rawManualLines) && rawManualLines.length > 0) {
      if (rawManualLines.length > 500) {
        res.status(400).json({ error: 'Statements are limited to 500 lines.' });
        return;
      }
      for (let i = 0; i < rawManualLines.length; i++) {
        const item = (rawManualLines[i] ?? {}) as Record<string, unknown>;
        const txDate = normalizeStatementDate(String(item.txDate ?? ''));
        const description = String(item.description ?? '').trim();
        const direction: 'credit' | 'debit' = item.direction === 'credit' ? 'credit' : 'debit';
        const amount = Number(item.amount);
        if (!txDate || !description || !Number.isFinite(amount) || amount <= 0 || amount >= 1_000_000_000) {
          res.status(400).json({ error: `Line ${i + 1}: valid date, description, and positive amount are required.` });
          return;
        }
        const rb = item.runningBalance !== undefined && item.runningBalance !== null && item.runningBalance !== ''
          ? Number(item.runningBalance)
          : null;
        parsedLines.push({
          txDate,
          description: description.slice(0, 240),
          reference: String(item.reference ?? '').trim().slice(0, 80),
          direction,
          amount: Math.round(amount * 100) / 100,
          runningBalance: rb !== null && Number.isFinite(rb) ? Math.round(rb * 100) / 100 : null,
        });
      }
    } else {
      res.status(400).json({ error: 'Provide either a CSV bank statement or at least one manual statement line.' });
      return;
    }

    const sortedDates = [...parsedLines].map((l) => l.txDate).sort();
    const today = new Date().toISOString().slice(0, 10);
    const cleanStart = normalizeStatementDate(String(periodStart ?? '')) || sortedDates[0] || today;
    const cleanEnd = normalizeStatementDate(String(periodEnd ?? '')) || sortedDates[sortedDates.length - 1] || cleanStart;
    const cleanStmtDate = normalizeStatementDate(String(statementDate ?? '')) || cleanEnd;

    const openBal = Number.isFinite(Number(openingBalance)) ? Math.round(Number(openingBalance) * 100) / 100 : 0;
    const netLines = parsedLines.reduce((s, l) => s + (l.direction === 'credit' ? l.amount : -l.amount), 0);
    const closeBal =
      closingBalance !== undefined && closingBalance !== null && closingBalance !== '' && Number.isFinite(Number(closingBalance))
        ? Math.round(Number(closingBalance) * 100) / 100
        : Math.round((openBal + netLines) * 100) / 100;

    const ref = await seqRef('bank_statements', 'BST');
    await db.exec('BEGIN');
    try {
      const info = await db
        .prepare(
          `INSERT INTO bank_statements (ref, bank_account_id, statement_name, statement_date, period_start, period_end, opening_balance, closing_balance, currency, source_type, status, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
        )
        .run(
          ref,
          accountId,
          cleanName.slice(0, 160),
          cleanStmtDate,
          cleanStart,
          cleanEnd,
          openBal,
          closeBal,
          bankAccount.currency || 'USD',
          normalizedSource,
          String(notes ?? '').trim().slice(0, 500),
          req.authUser!.email
        );
      const statementId = Number(info.lastInsertRowid);
      const insLine = db.prepare(
        `INSERT INTO bank_statement_lines (statement_id, tx_date, description, reference, direction, amount, running_balance, match_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'unmatched')`
      );
      for (const l of parsedLines) {
        await insLine.run(statementId, l.txDate, l.description, l.reference, l.direction, l.amount, l.runningBalance);
      }
      await db.exec('COMMIT');
      await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'CREATE_BANK_STATEMENT',
        module: 'billing',
        entityRef: ref,
        details: `Imported ${normalizedSource.toUpperCase()} statement ${ref} for ${bankAccount.ref} with ${parsedLines.length} lines`,
        ipAddress: getClientIp(req),
      });
      res.status(201).json(await db.prepare('SELECT * FROM bank_statements WHERE id = ?').get(statementId));
    } catch (err) {
      await db.exec('ROLLBACK');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to save bank statement.' });
    }
  });

  router.post('/bank-reconciliation/statements/:id/lines', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const statementId = Number(req.params.id);
    const stmt = (await db.prepare('SELECT id, ref FROM bank_statements WHERE id = ?').get(statementId)) as
      | { id: number; ref: string }
      | undefined;
    if (!stmt) {
      res.status(404).json({ error: 'Bank statement not found.' });
      return;
    }

    const { txDate, description, reference = '', direction = 'debit', amount, runningBalance = null } = req.body ?? {};
    const cleanDate = normalizeStatementDate(String(txDate ?? ''));
    const cleanDesc = String(description ?? '').trim();
    const amt = Number(amount);
    if (!cleanDate || !cleanDesc || !Number.isFinite(amt) || amt <= 0 || amt >= 1_000_000_000) {
      res.status(400).json({ error: 'Valid date, description, and positive amount are required.' });
      return;
    }
    const dir: 'credit' | 'debit' = direction === 'credit' ? 'credit' : 'debit';
    const rb =
      runningBalance !== null && runningBalance !== undefined && runningBalance !== '' && Number.isFinite(Number(runningBalance))
        ? Math.round(Number(runningBalance) * 100) / 100
        : null;

    const info = await db
      .prepare(
        `INSERT INTO bank_statement_lines (statement_id, tx_date, description, reference, direction, amount, running_balance, match_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'unmatched')`
      )
      .run(statementId, cleanDate, cleanDesc.slice(0, 240), String(reference).trim().slice(0, 80), dir, Math.round(amt * 100) / 100, rb);
    await recomputeBankStatementStatus(statementId);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'ADD_BANK_STATEMENT_LINE',
      module: 'billing',
      entityRef: stmt.ref,
      details: `Added manual ${dir} line ($${amt.toFixed(2)}) to ${stmt.ref}`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json(await db.prepare('SELECT * FROM bank_statement_lines WHERE id = ?').get(info.lastInsertRowid));
  });

  router.post('/bank-reconciliation/lines/:id/match', authenticate, requirePermission('billing', 'record_payment'), async (req: AuthenticatedReq, res) => {
    const lineId = Number(req.params.id);
    const { journalEntryId, note = '' } = req.body ?? {};
    const jeId = Number(journalEntryId);
    if (!jeId) {
      res.status(400).json({ error: 'Target journal entry is required.' });
      return;
    }

    const line = (await db.prepare('SELECT * FROM bank_statement_lines WHERE id = ?').get(lineId)) as
      | { id: number; statement_id: number; description: string; amount: number; match_status: string }
      | undefined;
    if (!line) {
      res.status(404).json({ error: 'Bank statement line not found.' });
      return;
    }

    const je = (await db.prepare('SELECT id, ref, amount, description FROM journal_entries WHERE id = ?').get(jeId)) as
      | { id: number; ref: string; amount: number; description: string }
      | undefined;
    if (!je) {
      res.status(404).json({ error: 'Journal entry not found.' });
      return;
    }

    const alreadyMatched = (await db
      .prepare("SELECT id FROM bank_statement_lines WHERE matched_journal_entry_id = ? AND match_status = 'matched' AND id != ?")
      .get(jeId, lineId)) as { id: number } | undefined;
    if (alreadyMatched) {
      res.status(409).json({ error: `Journal entry ${je.ref} is already matched to statement line #${alreadyMatched.id}.` });
      return;
    }

    const now = new Date().toISOString();
    await db
      .prepare(
        `UPDATE bank_statement_lines
         SET match_status = 'matched',
             matched_journal_entry_id = ?,
             matched_journal_ref = ?,
             matched_at = ?,
             matched_by = ?,
             match_note = ?
         WHERE id = ?`
      )
      .run(je.id, je.ref, now, req.authUser!.email, String(note).trim().slice(0, 300), lineId);

    await recomputeBankStatementStatus(line.statement_id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'MATCH_BANK_STATEMENT_LINE',
      module: 'billing',
      entityRef: je.ref,
      details: `Matched statement line #${lineId} ("${line.description}") to journal ${je.ref}`,
      ipAddress: getClientIp(req),
    });
    res.json(await db.prepare('SELECT * FROM bank_statement_lines WHERE id = ?').get(lineId));
  });

  router.post('/bank-reconciliation/lines/:id/unmatch', authenticate, requirePermission('billing', 'record_payment'), async (req: AuthenticatedReq, res) => {
    const lineId = Number(req.params.id);
    const line = (await db.prepare('SELECT * FROM bank_statement_lines WHERE id = ?').get(lineId)) as
      | { id: number; statement_id: number; matched_journal_ref: string; description: string }
      | undefined;
    if (!line) {
      res.status(404).json({ error: 'Bank statement line not found.' });
      return;
    }

    await db
      .prepare(
        `UPDATE bank_statement_lines
         SET match_status = 'unmatched',
             matched_journal_entry_id = NULL,
             matched_journal_ref = '',
             matched_at = '',
             matched_by = '',
             match_note = ''
         WHERE id = ?`
      )
      .run(lineId);

    await recomputeBankStatementStatus(line.statement_id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UNMATCH_BANK_STATEMENT_LINE',
      module: 'billing',
      entityRef: line.matched_journal_ref || `LINE-${lineId}`,
      details: `Unmatched statement line #${lineId} ("${line.description}")`,
      ipAddress: getClientIp(req),
    });
    res.json(await db.prepare('SELECT * FROM bank_statement_lines WHERE id = ?').get(lineId));
  });

  router.post('/bank-reconciliation/lines/:id/ignore', authenticate, requirePermission('billing', 'record_payment'), async (req: AuthenticatedReq, res) => {
    const lineId = Number(req.params.id);
    const { ignored = true } = req.body ?? {};
    const line = (await db.prepare('SELECT * FROM bank_statement_lines WHERE id = ?').get(lineId)) as
      | { id: number; statement_id: number; description: string }
      | undefined;
    if (!line) {
      res.status(404).json({ error: 'Bank statement line not found.' });
      return;
    }

    const nextStatus = ignored ? 'ignored' : 'unmatched';
    await db
      .prepare(
        `UPDATE bank_statement_lines
         SET match_status = ?,
             matched_journal_entry_id = NULL,
             matched_journal_ref = '',
             matched_at = '',
             matched_by = ''
         WHERE id = ?`
      )
      .run(nextStatus, lineId);

    await recomputeBankStatementStatus(line.statement_id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: ignored ? 'IGNORE_BANK_STATEMENT_LINE' : 'RESTORE_BANK_STATEMENT_LINE',
      module: 'billing',
      entityRef: `LINE-${lineId}`,
      details: `${ignored ? 'Ignored' : 'Restored'} statement line #${lineId} ("${line.description}")`,
      ipAddress: getClientIp(req),
    });
    res.json(await db.prepare('SELECT * FROM bank_statement_lines WHERE id = ?').get(lineId));
  });

  router.post('/bank-reconciliation/lines/:id/create-journal', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const lineId = Number(req.params.id);
    const { counterAccountCode, cashAccountCode = '1010', journalCode = 'BNK', description } = req.body ?? {};
    const cleanCounter = String(counterAccountCode ?? '').trim();
    const cleanCash = String(cashAccountCode ?? '1010').trim();
    if (!cleanCounter || !cleanCash || cleanCounter === cleanCash) {
      res.status(400).json({ error: 'Distinct cash and offset GL accounts are required.' });
      return;
    }

    const line = (await db.prepare('SELECT * FROM bank_statement_lines WHERE id = ?').get(lineId)) as
      | {
          id: number;
          statement_id: number;
          tx_date: string;
          description: string;
          reference: string;
          direction: 'credit' | 'debit';
          amount: number;
          match_status: string;
        }
      | undefined;
    if (!line) {
      res.status(404).json({ error: 'Bank statement line not found.' });
      return;
    }
    if (line.match_status === 'matched') {
      res.status(409).json({ error: 'Statement line is already matched to a journal entry.' });
      return;
    }

    const closedPeriod = await getClosedPeriodForDate(line.tx_date);
    if (closedPeriod) {
      res.status(409).json({ error: `Fiscal period ${closedPeriod.code} (${closedPeriod.name}) is closed for ${line.tx_date}.` });
      return;
    }

    const debitAccountCode = line.direction === 'credit' ? cleanCash : cleanCounter;
    const creditAccountCode = line.direction === 'credit' ? cleanCounter : cleanCash;
    const cleanDesc = String(description ?? '').trim() || line.description;
    const ref = await seqRef('journal_entries', 'JRN');
    const now = new Date().toISOString();

    await db.exec('BEGIN');
    try {
      const jeInfo = await db
        .prepare(
          `INSERT INTO journal_entries (ref, entry_date, journal_code, description, debit_account_code, credit_account_code, amount, source_ref, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          ref,
          line.tx_date,
          String(journalCode).trim().toUpperCase() || 'BNK',
          cleanDesc,
          debitAccountCode,
          creditAccountCode,
          line.amount,
          line.reference || `BST-LINE-${line.id}`,
          req.authUser!.email
        );
      await applyAccountPosting(debitAccountCode, 'debit', line.amount);
      await applyAccountPosting(creditAccountCode, 'credit', line.amount);
      await db
        .prepare(
          `UPDATE bank_statement_lines
           SET match_status = 'matched',
               matched_journal_entry_id = ?,
               matched_journal_ref = ?,
               matched_at = ?,
               matched_by = ?,
               match_note = ?
           WHERE id = ?`
        )
        .run(Number(jeInfo.lastInsertRowid), ref, now, req.authUser!.email, 'Posted & matched from Bank Reconciliation', line.id);
      await db.exec('COMMIT');
      await recomputeBankStatementStatus(line.statement_id);
      await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'CREATE_AND_MATCH_BANK_JOURNAL',
        module: 'billing',
        entityRef: ref,
        details: `Created ${ref} (DR ${debitAccountCode} / CR ${creditAccountCode} $${line.amount.toFixed(2)}) for bank line #${line.id}`,
        ipAddress: getClientIp(req),
      });
      res.status(201).json({
        journalEntry: await db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(jeInfo.lastInsertRowid),
        line: await db.prepare('SELECT * FROM bank_statement_lines WHERE id = ?').get(line.id),
      });
    } catch (err) {
      await db.exec('ROLLBACK');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to create balancing journal entry.' });
    }
  });

  router.post('/bank-reconciliation/statements/:id/auto-match', authenticate, requirePermission('billing', 'record_payment'), async (req: AuthenticatedReq, res) => {
    const statementId = Number(req.params.id);
    const stmt = (await db.prepare('SELECT id, ref FROM bank_statements WHERE id = ?').get(statementId)) as
      | { id: number; ref: string }
      | undefined;
    if (!stmt) {
      res.status(404).json({ error: 'Bank statement not found.' });
      return;
    }

    const unmatchedLines = (await db
      .prepare("SELECT * FROM bank_statement_lines WHERE statement_id = ? AND match_status = 'unmatched' ORDER BY tx_date ASC, id ASC")
      .all(statementId)) as Array<{
      id: number;
      tx_date: string;
      description: string;
      reference: string;
      amount: number;
    }>;

    const usedRows = (await db
      .prepare("SELECT matched_journal_entry_id FROM bank_statement_lines WHERE match_status = 'matched' AND matched_journal_entry_id IS NOT NULL")
      .all()) as Array<{ matched_journal_entry_id: number }>;
    const usedJeIds = new Set(usedRows.map((r) => r.matched_journal_entry_id));

    const availableJes = (await db
      .prepare('SELECT id, ref, entry_date, description, amount, source_ref FROM journal_entries ORDER BY entry_date DESC, id DESC')
      .all()) as Array<{
      id: number;
      ref: string;
      entry_date: string;
      description: string;
      amount: number;
      source_ref: string;
    }>;

    const matches: Array<{ lineId: number; journalEntryId: number; journalRef: string }> = [];
    const now = new Date().toISOString();

    for (const line of unmatchedLines) {
      const lineMs = Date.parse(`${line.tx_date}T00:00:00Z`);
      const candidates = availableJes
        .filter((je) => !usedJeIds.has(je.id) && Math.abs(je.amount - line.amount) < 0.01)
        .map((je) => {
          const jeMs = Date.parse(`${je.entry_date}T00:00:00Z`);
          const dayDiff = Number.isFinite(lineMs) && Number.isFinite(jeMs) ? Math.abs(lineMs - jeMs) / 86400000 : 999;
          const refHit =
            (line.reference && je.source_ref && line.reference.toLowerCase() === je.source_ref.toLowerCase()) ||
            (je.source_ref && line.description.toLowerCase().includes(je.source_ref.toLowerCase())) ||
            (line.reference && je.description.toLowerCase().includes(line.reference.toLowerCase()));
          return { je, dayDiff, refHit };
        })
        .filter((c) => c.dayDiff <= 7 || c.refHit)
        .sort((a, b) => Number(b.refHit) - Number(a.refHit) || a.dayDiff - b.dayDiff);

      if (candidates.length === 1 || (candidates.length > 1 && candidates[0].refHit && !candidates[1].refHit)) {
        const chosen = candidates[0].je;
        usedJeIds.add(chosen.id);
        await db
          .prepare(
            `UPDATE bank_statement_lines
             SET match_status = 'matched',
                 matched_journal_entry_id = ?,
                 matched_journal_ref = ?,
                 matched_at = ?,
                 matched_by = ?,
                 match_note = 'Auto-matched by amount and reference/date'
             WHERE id = ?`
          )
          .run(chosen.id, chosen.ref, now, req.authUser!.email, line.id);
        matches.push({ lineId: line.id, journalEntryId: chosen.id, journalRef: chosen.ref });
      }
    }

    await recomputeBankStatementStatus(statementId);
    if (matches.length > 0) {
      await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'AUTO_MATCH_BANK_STATEMENT',
        module: 'billing',
        entityRef: stmt.ref,
        details: `Auto-matched ${matches.length} bank statement line(s) on ${stmt.ref}`,
        ipAddress: getClientIp(req),
      });
    }
    res.json({ matchedCount: matches.length, matches });
  });

  router.delete('/bank-reconciliation/lines/:id', authenticate, requirePermission('billing', 'delete'), async (req: AuthenticatedReq, res) => {
    const lineId = Number(req.params.id);
    const existing = (await db.prepare('SELECT id, statement_id, description FROM bank_statement_lines WHERE id = ?').get(lineId)) as
      | { id: number; statement_id: number; description: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Bank statement line not found.' });
      return;
    }
    await db.prepare('DELETE FROM bank_statement_lines WHERE id = ?').run(lineId);
    await recomputeBankStatementStatus(existing.statement_id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_BANK_STATEMENT_LINE',
      module: 'billing',
      entityRef: `LINE-${lineId}`,
      details: `Deleted statement line #${lineId} ("${existing.description}")`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    });
    res.json({ ok: true });
  });

  router.delete('/bank-reconciliation/statements/:id', authenticate, requirePermission('billing', 'delete'), async (req: AuthenticatedReq, res) => {
    const statementId = Number(req.params.id);
    const existing = (await db.prepare('SELECT id, ref, statement_name FROM bank_statements WHERE id = ?').get(statementId)) as
      | { id: number; ref: string; statement_name: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Bank statement not found.' });
      return;
    }
    await db.prepare('DELETE FROM bank_statements WHERE id = ?').run(statementId);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_BANK_STATEMENT',
      module: 'billing',
      entityRef: existing.ref,
      details: `Deleted bank statement ${existing.ref} (${existing.statement_name})`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    });
    res.json({ ok: true });
  });

  router.get('/bank-reconciliation/statements/:id/export', authenticate, requirePermission('billing', 'read'), async (req, res) => {
    const statementId = Number(req.params.id);
    const stmt = (await db.prepare('SELECT * FROM bank_statements WHERE id = ?').get(statementId)) as
      | { id: number; ref: string; statement_name: string }
      | undefined;
    if (!stmt) {
      res.status(404).json({ error: 'Bank statement not found.' });
      return;
    }
    const rows = (await db
      .prepare(
        `SELECT bsl.*, je.entry_date AS journal_date, je.description AS journal_description
         FROM bank_statement_lines bsl
         LEFT JOIN journal_entries je ON je.id = bsl.matched_journal_entry_id
         WHERE bsl.statement_id = ?
         ORDER BY bsl.tx_date ASC, bsl.id ASC`
      )
      .all(statementId)) as Array<{
      tx_date: string;
      description: string;
      reference: string;
      direction: string;
      amount: number;
      running_balance: number | null;
      match_status: string;
      matched_journal_ref: string;
      journal_date: string | null;
      journal_description: string | null;
      matched_by: string;
      match_note: string;
    }>;

    const headers = [
      'Statement Ref',
      'Tx Date',
      'Description',
      'Reference',
      'Direction',
      'Amount',
      'Running Balance',
      'Match Status',
      'Matched Journal Ref',
      'Journal Date',
      'Journal Description',
      'Matched By',
      'Note',
    ];
    const csvLines = [
      headers.map(sanitizeCsvCell).join(','),
      ...rows.map((r) =>
        [
          stmt.ref,
          r.tx_date,
          r.description,
          r.reference,
          r.direction,
          Number(r.amount).toFixed(2),
          r.running_balance !== null && r.running_balance !== undefined ? Number(r.running_balance).toFixed(2) : '',
          r.match_status,
          r.matched_journal_ref,
          r.journal_date ?? '',
          r.journal_description ?? '',
          r.matched_by,
          r.match_note,
        ]
          .map(sanitizeCsvCell)
          .join(',')
      ),
    ];
    res.json({
      count: rows.length,
      filename: `${stmt.ref}-reconciliation.csv`,
      csv: csvLines.join('\n'),
    });
  });

  router.get('/accounting/export', authenticate, requirePermission('billing', 'read'), async (_req, res) => {
    const accounts = (await db.prepare('SELECT * FROM accounting_accounts WHERE is_active = 1 ORDER BY code ASC').all()) as Array<{
      code: string;
      label: string;
      account_class: string;
      balance: number;
    }>;
    const headers = ['Account Code', 'Account Label', 'Class', 'Debit Balance', 'Credit Balance', 'Signed Balance'];
    const lines = [
      headers.map(sanitizeCsvCell).join(','),
      ...accounts.map((a) => {
        const isDebitNormal = a.account_class === 'asset' || a.account_class === 'expense';
        const debit = isDebitNormal ? (a.balance >= 0 ? a.balance : 0) : a.balance < 0 ? Math.abs(a.balance) : 0;
        const credit = !isDebitNormal ? (a.balance >= 0 ? a.balance : 0) : a.balance < 0 ? Math.abs(a.balance) : 0;
        return [a.code, a.label, a.account_class, debit.toFixed(2), credit.toFixed(2), a.balance.toFixed(2)]
          .map(sanitizeCsvCell)
          .join(',');
      }),
    ];
    res.json({
      count: accounts.length,
      filename: `kscat-trial-balance-${new Date().toISOString().slice(0, 10)}.csv`,
      csv: lines.join('\n'),
    });
  });

  // Fiscal Periods
  router.post('/accounting/fiscal-periods', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const { code, name, startDate, endDate } = req.body ?? {};
    const cleanCode = String(code ?? '').trim().toUpperCase();
    const cleanName = String(name ?? '').trim();
    if (!cleanCode || !cleanName || !startDate || !endDate) {
      res.status(400).json({ error: 'Period code, name, start date, and end date are required.' });
      return;
    }
    if (String(endDate) < String(startDate)) {
      res.status(400).json({ error: 'End date must be on or after start date.' });
      return;
    }
    try {
      const info = await db
        .prepare(`INSERT INTO fiscal_periods (code, name, start_date, end_date, status) VALUES (?, ?, ?, ?, 'open')`)
        .run(cleanCode, cleanName, String(startDate), String(endDate));
      await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'CREATE_FISCAL_PERIOD',
        module: 'billing',
        entityRef: cleanCode,
        details: `Created fiscal period ${cleanCode} (${startDate} to ${endDate})`,
        ipAddress: getClientIp(req),
      });
      res.status(201).json(await db.prepare('SELECT * FROM fiscal_periods WHERE id = ?').get(info.lastInsertRowid));
    } catch {
      res.status(400).json({ error: 'Fiscal period code already exists.' });
    }
  });

  router.put('/accounting/fiscal-periods/:id', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT code FROM fiscal_periods WHERE id = ?').get(id)) as { code: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Fiscal period not found.' });
      return;
    }
    const { name, startDate, endDate, status } = req.body ?? {};
    const nextStatus = status === 'open' || status === 'closed' ? status : null;
    await db
      .prepare(
        `UPDATE fiscal_periods
         SET name = COALESCE(?, name),
             start_date = COALESCE(?, start_date),
             end_date = COALESCE(?, end_date),
             status = COALESCE(?, status),
             closed_by = CASE WHEN ? = 'closed' THEN ? WHEN ? = 'open' THEN '' ELSE closed_by END,
             closed_at = CASE WHEN ? = 'closed' THEN ? WHEN ? = 'open' THEN '' ELSE closed_at END
         WHERE id = ?`
      )
      .run(
        name ? String(name).trim() : null,
        startDate ? String(startDate) : null,
        endDate ? String(endDate) : null,
        nextStatus,
        nextStatus,
        req.authUser!.email,
        nextStatus,
        nextStatus,
        new Date().toISOString(),
        nextStatus,
        id
      );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_FISCAL_PERIOD',
      module: 'billing',
      entityRef: existing.code,
      details: `Updated fiscal period ${existing.code}`,
      ipAddress: getClientIp(req),
    });
    res.json(await db.prepare('SELECT * FROM fiscal_periods WHERE id = ?').get(id));
  });

  router.post('/accounting/fiscal-periods/:id/toggle', authenticate, requirePermission('billing', 'validate'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM fiscal_periods WHERE id = ?').get(id)) as
      | { id: number; code: string; status: 'open' | 'closed' }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Fiscal period not found.' });
      return;
    }
    const nextStatus = existing.status === 'open' ? 'closed' : 'open';
    await db
      .prepare(`UPDATE fiscal_periods SET status = ?, closed_by = ?, closed_at = ? WHERE id = ?`)
      .run(nextStatus, nextStatus === 'closed' ? req.authUser!.email : '', nextStatus === 'closed' ? new Date().toISOString() : '', id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: nextStatus === 'closed' ? 'CLOSE_FISCAL_PERIOD' : 'REOPEN_FISCAL_PERIOD',
      module: 'billing',
      entityRef: existing.code,
      details: `${nextStatus === 'closed' ? 'Closed' : 'Reopened'} fiscal period ${existing.code}`,
      ipAddress: getClientIp(req),
      severity: nextStatus === 'closed' ? 'info' : 'warning',
    });
    res.json(await db.prepare('SELECT * FROM fiscal_periods WHERE id = ?').get(id));
  });

  router.delete('/accounting/fiscal-periods/:id', authenticate, requirePermission('billing', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT code, status FROM fiscal_periods WHERE id = ?').get(id)) as
      | { code: string; status: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Fiscal period not found.' });
      return;
    }
    if (existing.status === 'closed') {
      res.status(409).json({ error: 'Reopen the closed fiscal period before deleting it.' });
      return;
    }
    await db.prepare('DELETE FROM fiscal_periods WHERE id = ?').run(id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_FISCAL_PERIOD',
      module: 'billing',
      entityRef: existing.code,
      details: `Deleted fiscal period ${existing.code}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    });
    res.json({ ok: true });
  });

  // Currencies & FX Rates
  router.post('/finance/currencies', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const { code, name, symbol = '$', exchangeRate = 1, isBase = false } = req.body ?? {};
    const cleanCode = String(code ?? '').trim().toUpperCase().slice(0, 8);
    const cleanName = String(name ?? '').trim();
    const rate = isBase ? 1 : Number(exchangeRate);
    if (!cleanCode || !cleanName || !Number.isFinite(rate) || rate <= 0) {
      res.status(400).json({ error: 'Currency code, name, and positive exchange rate are required.' });
      return;
    }
    await db.exec('BEGIN');
    try {
      if (isBase) {
        await db.prepare('UPDATE currencies SET is_base = 0').run();
      }
      const info = await db
        .prepare(`INSERT INTO currencies (code, name, symbol, exchange_rate, is_base) VALUES (?, ?, ?, ?, ?)`)
        .run(cleanCode, cleanName, String(symbol || '$').trim().slice(0, 4), rate, isBase ? 1 : 0);
      await db.exec('COMMIT');
      await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'CREATE_CURRENCY',
        module: 'billing',
        entityRef: cleanCode,
        details: `Added currency ${cleanCode} (${cleanName}) @ ${rate}`,
        ipAddress: getClientIp(req),
      });
      res.status(201).json(await db.prepare('SELECT * FROM currencies WHERE id = ?').get(info.lastInsertRowid));
    } catch {
      await db.exec('ROLLBACK');
      res.status(400).json({ error: 'Currency code already exists.' });
    }
  });

  router.put('/finance/currencies/:id', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM currencies WHERE id = ?').get(id)) as
      | { id: number; code: string; is_base: number }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Currency not found.' });
      return;
    }
    const { name, symbol, exchangeRate, isBase } = req.body ?? {};
    const nextIsBase = isBase !== undefined ? (isBase ? 1 : 0) : existing.is_base;
    const rate = nextIsBase ? 1 : exchangeRate !== undefined ? Number(exchangeRate) : null;
    if (rate !== null && (!Number.isFinite(rate) || rate <= 0)) {
      res.status(400).json({ error: 'Exchange rate must be positive.' });
      return;
    }
    await db.exec('BEGIN');
    try {
      if (isBase) {
        await db.prepare('UPDATE currencies SET is_base = 0').run();
      }
      await db
        .prepare(
          `UPDATE currencies
           SET name = COALESCE(?, name),
               symbol = COALESCE(?, symbol),
               exchange_rate = COALESCE(?, exchange_rate),
               is_base = ?,
               updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(
          name ? String(name).trim() : null,
          symbol ? String(symbol).trim().slice(0, 4) : null,
          rate,
          nextIsBase,
          id
        );
      await db.exec('COMMIT');
      await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'UPDATE_CURRENCY',
        module: 'billing',
        entityRef: existing.code,
        details: `Updated currency ${existing.code}`,
        ipAddress: getClientIp(req),
      });
      res.json(await db.prepare('SELECT * FROM currencies WHERE id = ?').get(id));
    } catch (err) {
      await db.exec('ROLLBACK');
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to update currency.' });
    }
  });

  router.delete('/finance/currencies/:id', authenticate, requirePermission('billing', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT code, is_base FROM currencies WHERE id = ?').get(id)) as
      | { code: string; is_base: number }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Currency not found.' });
      return;
    }
    if (existing.is_base) {
      res.status(409).json({ error: 'Cannot delete the active base currency. Assign another base currency first.' });
      return;
    }
    await db.prepare('DELETE FROM currencies WHERE id = ?').run(id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_CURRENCY',
      module: 'billing',
      entityRef: existing.code,
      details: `Deleted currency ${existing.code}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    });
    res.json({ ok: true });
  });

  // ========================
  // MULTI-CURRENCY ACCOUNTING SERVICE
  // ========================
  router.get('/finance/currency-service', authenticate, requirePermission('billing', 'read'), async (req, res) => {
    const fiscalPeriodId = req.query.fiscalPeriodId ? Number(req.query.fiscalPeriodId) : null;
    const currencyCode = req.query.currencyCode ? String(req.query.currencyCode) : undefined;
    const workspace = await currencyService.getMultiCurrencyWorkspace({ fiscalPeriodId, currencyCode });
    res.json(workspace);
  });

  router.post('/finance/currency-service/convert', authenticate, requirePermission('billing', 'read'), async (req, res) => {
    const { amount, fromCurrency, toCurrency, date, fiscalPeriodId, exchangeRate, preferClosing } = req.body ?? {};
    const numAmt = Number(amount);
    if (!Number.isFinite(numAmt) || !fromCurrency) {
      res.status(400).json({ error: 'Valid numeric amount and source currency code are required.' });
      return;
    }
    try {
      const result = await currencyService.convertAmount({
        amount: numAmt,
        fromCurrency: String(fromCurrency),
        toCurrency: toCurrency ? String(toCurrency) : undefined,
        txDate: date ? String(date) : undefined,
        fiscalPeriodId: fiscalPeriodId ? Number(fiscalPeriodId) : null,
        explicitRate: exchangeRate !== undefined ? Number(exchangeRate) : null,
        preferClosing: Boolean(preferClosing),
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Currency conversion failed.' });
    }
  });

  router.post('/finance/currency-service/revalue', authenticate, requirePermission('billing', 'validate'), async (req: AuthenticatedReq, res) => {
    const { fiscalPeriodId, entryDate, postToLedger = true } = req.body ?? {};
    const reval = await currencyService.computePeriodRevaluation(fiscalPeriodId ? Number(fiscalPeriodId) : null);
    if (!postToLedger) {
      res.json({ ...reval, postedEntry: null });
      return;
    }
    const postDate = String(entryDate || reval.targetPeriod?.end_date || new Date().toISOString().slice(0, 10));
    const closedPeriod = await getClosedPeriodForDate(postDate);
    if (closedPeriod) {
      res.status(409).json({ error: `Fiscal period ${closedPeriod.code} is closed for ${postDate}.` });
      return;
    }
    if (Math.abs(reval.netUnrealizedFxGainLoss) < 0.01) {
      res.json({ ...reval, postedEntry: null, message: 'No material unrealized FX variance to post for this period.' });
      return;
    }

    const isGain = reval.netUnrealizedFxGainLoss > 0;
    const fxAbs = Math.round(Math.abs(reval.netUnrealizedFxGainLoss) * 100) / 100;
    const debitCode = isGain ? '1200' : '6350';
    const creditCode = isGain ? '4300' : '1200';
    const ref = await seqRef('journal_entries', 'FXR');

    await db.exec('BEGIN');
    try {
      const info = await db
        .prepare(
          `INSERT INTO journal_entries (ref, entry_date, journal_code, description, debit_account_code, credit_account_code, amount, currency, exchange_rate, original_amount, source_ref, created_by)
           VALUES (?, ?, 'FXR', ?, ?, ?, ?, ?, 1, ?, ?, ?)`
        )
        .run(
          ref,
          postDate,
          `Period-End FX Revaluation (${reval.targetPeriod?.code || postDate}) — Unrealized FX ${isGain ? 'Gain' : 'Loss'}`,
          debitCode,
          creditCode,
          fxAbs,
          reval.baseCurrency.code,
          fxAbs,
          reval.targetPeriod?.code || 'FX-REVAL',
          req.authUser!.email
        );
      await applyAccountPosting(debitCode, 'debit', fxAbs);
      await applyAccountPosting(creditCode, 'credit', fxAbs);
      await db.exec('COMMIT');
      await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'POST_FX_REVALUATION',
        module: 'billing',
        entityRef: ref,
        details: `Posted period FX revaluation ${ref}: ${reval.baseCurrency.code} ${isGain ? '+' : '-'}${fxAbs.toFixed(2)}`,
        ipAddress: getClientIp(req),
      });
      res.status(201).json({
        ...reval,
        postedEntry: await db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(info.lastInsertRowid),
      });
    } catch (err) {
      await db.exec('ROLLBACK');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to post FX revaluation.' });
    }
  });

  router.get('/finance/currency-rates/export', authenticate, requirePermission('billing', 'read'), async (req, res) => {
    const fiscalPeriodId = req.query.fiscalPeriodId ? Number(req.query.fiscalPeriodId) : null;
    const currencyCode = req.query.currencyCode ? String(req.query.currencyCode) : undefined;
    const workspace = await currencyService.getMultiCurrencyWorkspace({ fiscalPeriodId, currencyCode });
    const headers = [
      'Currency',
      'Period Code',
      'Effective From',
      'Effective To',
      `Rate (per 1 ${workspace.baseCurrency.code})`,
      `Closing Rate (per 1 ${workspace.baseCurrency.code})`,
      `Inverse (1 Foreign in ${workspace.baseCurrency.code})`,
      'Source',
      'Notes',
    ];
    const lines = [
      headers.map(sanitizeCsvCell).join(','),
      ...workspace.periodRates.map((r) =>
        [
          r.currency_code,
          r.period_code || 'Custom',
          r.effective_from,
          r.effective_to,
          r.exchange_rate.toFixed(4),
          r.closing_rate.toFixed(4),
          r.inverse_rate.toFixed(6),
          r.rate_source,
          r.notes,
        ]
          .map(sanitizeCsvCell)
          .join(',')
      ),
    ];
    res.json({
      count: workspace.periodRates.length,
      filename: `kscat-period-fx-rates-${new Date().toISOString().slice(0, 10)}.csv`,
      csv: lines.join('\n'),
    });
  });

  router.post('/finance/currency-rates', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const {
      currencyCode,
      fiscalPeriodId,
      effectiveFrom,
      effectiveTo,
      exchangeRate,
      closingRate,
      rateSource = 'manual',
      notes = '',
    } = req.body ?? {};
    const cleanCode = String(currencyCode ?? '').trim().toUpperCase().slice(0, 8);
    const base = await currencyService.getBaseCurrency();
    if (!cleanCode || cleanCode === base.code) {
      res.status(400).json({ error: `Select a foreign currency other than base currency (${base.code}).` });
      return;
    }
    const currRow = await db.prepare('SELECT code FROM currencies WHERE code = ?').get(cleanCode);
    if (!currRow) {
      res.status(404).json({ error: `Currency ${cleanCode} does not exist. Add the currency first.` });
      return;
    }

    let periodId: number | null = fiscalPeriodId ? Number(fiscalPeriodId) : null;
    let periodCode = '';
    let startDate = String(effectiveFrom ?? '').trim();
    let endDate = String(effectiveTo ?? '').trim();

    if (periodId) {
      const fp = (await db
        .prepare('SELECT id, code, start_date, end_date FROM fiscal_periods WHERE id = ?')
        .get(periodId)) as { id: number; code: string; start_date: string; end_date: string } | undefined;
      if (!fp) {
        res.status(404).json({ error: 'Selected fiscal period not found.' });
        return;
      }
      periodCode = fp.code;
      if (!startDate) startDate = fp.start_date;
      if (!endDate) endDate = fp.end_date;
    }

    if (!startDate || !endDate || endDate < startDate) {
      res.status(400).json({ error: 'Valid effective start and end dates (end >= start) are required.' });
      return;
    }

    const rate = Number(exchangeRate);
    if (!Number.isFinite(rate) || rate <= 0) {
      res.status(400).json({ error: 'Positive exchange rate is required.' });
      return;
    }
    const closing = closingRate !== undefined && Number(closingRate) > 0 ? Number(closingRate) : rate;
    const cleanSource = ['manual', 'ecb', 'bsp', 'fed', 'spot_override'].includes(String(rateSource))
      ? String(rateSource)
      : 'manual';

    try {
      const info = await db
        .prepare(
          `INSERT INTO currency_period_rates
           (currency_code, fiscal_period_id, period_code, effective_from, effective_to, exchange_rate, closing_rate, rate_source, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(cleanCode, periodId, periodCode, startDate, endDate, rate, closing, cleanSource, String(notes).trim(), req.authUser!.email);

      await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'CREATE_PERIOD_FX_RATE',
        module: 'billing',
        entityRef: `${cleanCode}:${periodCode || startDate}`,
        details: `Defined ${cleanCode} rate ${rate.toFixed(4)} (closing ${closing.toFixed(4)}) for ${periodCode || `${startDate}..${endDate}`}`,
        ipAddress: getClientIp(req),
      });

      res.status(201).json(await db.prepare('SELECT * FROM currency_period_rates WHERE id = ?').get(info.lastInsertRowid));
    } catch {
      res.status(409).json({ error: `A period rate for ${cleanCode} covering ${startDate} to ${endDate} already exists.` });
    }
  });

  router.put('/finance/currency-rates/:id', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM currency_period_rates WHERE id = ?').get(id)) as
      | {
          id: number;
          currency_code: string;
          fiscal_period_id: number | null;
          period_code: string;
          effective_from: string;
          effective_to: string;
          exchange_rate: number;
          closing_rate: number;
        }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Period exchange rate not found.' });
      return;
    }

    const { fiscalPeriodId, effectiveFrom, effectiveTo, exchangeRate, closingRate, rateSource, notes } = req.body ?? {};
    let nextPeriodId = existing.fiscal_period_id;
    let nextPeriodCode = existing.period_code;
    if (fiscalPeriodId !== undefined) {
      if (!fiscalPeriodId) {
        nextPeriodId = null;
        nextPeriodCode = '';
      } else {
        const fp = (await db.prepare('SELECT id, code FROM fiscal_periods WHERE id = ?').get(Number(fiscalPeriodId))) as
          | { id: number; code: string }
          | undefined;
        if (!fp) {
          res.status(404).json({ error: 'Selected fiscal period not found.' });
          return;
        }
        nextPeriodId = fp.id;
        nextPeriodCode = fp.code;
      }
    }

    const nextFrom = effectiveFrom ? String(effectiveFrom).trim() : existing.effective_from;
    const nextTo = effectiveTo ? String(effectiveTo).trim() : existing.effective_to;
    if (nextTo < nextFrom) {
      res.status(400).json({ error: 'Effective end date must be on or after effective start date.' });
      return;
    }

    const nextRate = exchangeRate !== undefined ? Number(exchangeRate) : existing.exchange_rate;
    if (!Number.isFinite(nextRate) || nextRate <= 0) {
      res.status(400).json({ error: 'Exchange rate must be positive.' });
      return;
    }
    const nextClosing = closingRate !== undefined ? (Number(closingRate) > 0 ? Number(closingRate) : nextRate) : existing.closing_rate;

    try {
      await db
        .prepare(
          `UPDATE currency_period_rates
           SET fiscal_period_id = ?,
               period_code = ?,
               effective_from = ?,
               effective_to = ?,
               exchange_rate = ?,
               closing_rate = ?,
               rate_source = COALESCE(?, rate_source),
               notes = COALESCE(?, notes),
               updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(
          nextPeriodId,
          nextPeriodCode,
          nextFrom,
          nextTo,
          nextRate,
          nextClosing,
          rateSource && ['manual', 'ecb', 'bsp', 'fed', 'spot_override'].includes(String(rateSource)) ? String(rateSource) : null,
          notes !== undefined ? String(notes).trim() : null,
          id
        );

      await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'UPDATE_PERIOD_FX_RATE',
        module: 'billing',
        entityRef: `${existing.currency_code}:${nextPeriodCode || nextFrom}`,
        details: `Updated ${existing.currency_code} rate to ${nextRate.toFixed(4)} (${nextFrom} to ${nextTo})`,
        ipAddress: getClientIp(req),
      });

      res.json(await db.prepare('SELECT * FROM currency_period_rates WHERE id = ?').get(id));
    } catch {
      res.status(409).json({ error: 'Another period rate already covers that exact date range for this currency.' });
    }
  });

  router.delete('/finance/currency-rates/:id', authenticate, requirePermission('billing', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db
      .prepare('SELECT currency_code, period_code, effective_from, effective_to FROM currency_period_rates WHERE id = ?')
      .get(id)) as { currency_code: string; period_code: string; effective_from: string; effective_to: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Period exchange rate not found.' });
      return;
    }
    await db.prepare('DELETE FROM currency_period_rates WHERE id = ?').run(id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_PERIOD_FX_RATE',
      module: 'billing',
      entityRef: `${existing.currency_code}:${existing.period_code || existing.effective_from}`,
      details: `Deleted ${existing.currency_code} rate for ${existing.period_code || `${existing.effective_from}..${existing.effective_to}`}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    });
    res.json({ ok: true });
  });

  // Tax Rates & Codes
  router.post('/finance/tax-rates', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const { code, name, rate = 0, taxType = 'both', appliesTo = 'Standard Goods & Services', isActive = true, notes = '' } = req.body ?? {};
    const cleanCode = String(code ?? '').trim().toUpperCase();
    const cleanName = String(name ?? '').trim();
    const numRate = Number(rate);
    if (!cleanCode || !cleanName || !Number.isFinite(numRate) || numRate < 0 || numRate > 100) {
      res.status(400).json({ error: 'Tax code, name, and rate (0-100%) are required.' });
      return;
    }
    try {
      const info = await db
        .prepare(
          `INSERT INTO tax_rates (code, name, rate, tax_type, applies_to, is_active, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          cleanCode,
          cleanName,
          numRate,
          ['sales', 'purchase', 'both'].includes(taxType) ? taxType : 'both',
          String(appliesTo).trim() || 'Standard Goods & Services',
          isActive ? 1 : 0,
          String(notes).trim()
        );
      await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'CREATE_TAX_RATE',
        module: 'billing',
        entityRef: cleanCode,
        details: `Created tax rate ${cleanCode} (${numRate}%)`,
        ipAddress: getClientIp(req),
      });
      res.status(201).json(await db.prepare('SELECT * FROM tax_rates WHERE id = ?').get(info.lastInsertRowid));
    } catch {
      res.status(400).json({ error: 'Tax code already exists.' });
    }
  });

  router.put('/finance/tax-rates/:id', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT code FROM tax_rates WHERE id = ?').get(id)) as { code: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Tax code not found.' });
      return;
    }
    const { name, rate, taxType, appliesTo, isActive, notes } = req.body ?? {};
    const nextRate = rate !== undefined ? Number(rate) : null;
    if (nextRate !== null && (!Number.isFinite(nextRate) || nextRate < 0 || nextRate > 100)) {
      res.status(400).json({ error: 'Tax rate must be between 0 and 100%.' });
      return;
    }
    await db
      .prepare(
        `UPDATE tax_rates
         SET name = COALESCE(?, name),
             rate = COALESCE(?, rate),
             tax_type = COALESCE(?, tax_type),
             applies_to = COALESCE(?, applies_to),
             is_active = COALESCE(?, is_active),
             notes = COALESCE(?, notes)
         WHERE id = ?`
      )
      .run(
        name ? String(name).trim() : null,
        nextRate,
        ['sales', 'purchase', 'both'].includes(taxType) ? taxType : null,
        appliesTo !== undefined ? String(appliesTo).trim() : null,
        isActive !== undefined ? (isActive ? 1 : 0) : null,
        notes !== undefined ? String(notes).trim() : null,
        id
      );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_TAX_RATE',
      module: 'billing',
      entityRef: existing.code,
      details: `Updated tax rate ${existing.code}`,
      ipAddress: getClientIp(req),
    });
    res.json(await db.prepare('SELECT * FROM tax_rates WHERE id = ?').get(id));
  });

  router.delete('/finance/tax-rates/:id', authenticate, requirePermission('billing', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT code FROM tax_rates WHERE id = ?').get(id)) as { code: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Tax code not found.' });
      return;
    }
    await db.prepare('DELETE FROM tax_rates WHERE id = ?').run(id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_TAX_RATE',
      module: 'billing',
      entityRef: existing.code,
      details: `Deleted tax rate ${existing.code}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    });
    res.json({ ok: true });
  });

  router.get('/finance/tax-rates/export', authenticate, requirePermission('billing', 'read'), async (_req, res) => {
    const rows = (await db.prepare('SELECT * FROM tax_rates ORDER BY rate DESC, code ASC').all()) as Array<{
      code: string;
      name: string;
      rate: number;
      tax_type: string;
      applies_to: string;
      is_active: number;
      notes: string;
    }>;
    const headers = ['Code', 'Name', 'Rate %', 'Scope', 'Applies To', 'Active', 'Notes'];
    const lines = [
      headers.map(sanitizeCsvCell).join(','),
      ...rows.map((r) =>
        [r.code, r.name, r.rate.toFixed(2), r.tax_type, r.applies_to, r.is_active ? 'Active' : 'Inactive', r.notes]
          .map(sanitizeCsvCell)
          .join(',')
      ),
    ];
    res.json({
      count: rows.length,
      filename: `kscat-tax-schedule-${new Date().toISOString().slice(0, 10)}.csv`,
      csv: lines.join('\n'),
    });
  });

  // Tax Compliance & Upcoming VAT / Sales Tax Liabilities
  interface TaxComplianceQuery {
    dateFrom?: string;
    dateTo?: string;
    fiscalPeriod?: string;
    includeDrafts?: string;
    sourceFilter?: string;
    taxBucket?: string;
    search?: string;
  }

  async function computeTaxComplianceReport(q: TaxComplianceQuery) {
    const cleanDate = (val?: string) => {
      const s = String(val ?? '').trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
    };

    const fiscalPeriods = (await db
      .prepare('SELECT * FROM fiscal_periods ORDER BY start_date DESC, id DESC')
      .all()) as Array<{
      id: number;
      code: string;
      name: string;
      start_date: string;
      end_date: string;
      status: 'open' | 'closed';
      closed_by: string;
      closed_at: string;
    }>;

    const taxRates = (await db
      .prepare('SELECT * FROM tax_rates ORDER BY rate DESC, code ASC')
      .all()) as Array<{
      id: number;
      code: string;
      name: string;
      rate: number;
      tax_type: 'sales' | 'purchase' | 'both';
      applies_to: string;
      is_active: number;
      notes: string;
    }>;

    const baseCurrRow = (await db
      .prepare('SELECT code FROM currencies WHERE is_base = 1 LIMIT 1')
      .get()) as { code: string } | undefined;
    const baseCurrency = baseCurrRow?.code || 'USD';

    const glVatRow = (await db
      .prepare("SELECT balance FROM accounting_accounts WHERE code = '2200' LIMIT 1")
      .get()) as { balance: number } | undefined;
    const glVatPayableBalance = Math.round((Number(glVatRow?.balance) || 0) * 100) / 100;

    let dateFrom = cleanDate(q.dateFrom);
    let dateTo = cleanDate(q.dateTo);
    const periodCode = String(q.fiscalPeriod ?? '').trim();
    if (periodCode && periodCode !== 'all') {
      const matchedPeriod = fiscalPeriods.find((p) => p.code === periodCode);
      if (matchedPeriod) {
        if (!dateFrom) dateFrom = matchedPeriod.start_date;
        if (!dateTo) dateTo = matchedPeriod.end_date;
      }
    }

    const includeDrafts = String(q.includeDrafts ?? '').toLowerCase() === 'true';
    const sourceFilter = ['all', 'invoices', 'purchase_orders'].includes(String(q.sourceFilter ?? 'all'))
      ? String(q.sourceFilter ?? 'all')
      : 'all';
    const taxBucket = ['all', 'output', 'input_recognized', 'input_pending_po'].includes(String(q.taxBucket ?? 'all'))
      ? String(q.taxBucket ?? 'all')
      : 'all';
    const search = String(q.search ?? '').trim().toLowerCase();

    const invWhere: string[] = ["i.status != 'cancelled'"];
    const invParams: (string | number)[] = [];
    if (dateFrom) {
      invWhere.push('i.issue_date >= ?');
      invParams.push(dateFrom);
    }
    if (dateTo) {
      invWhere.push('i.issue_date <= ?');
      invParams.push(dateTo);
    }

    const invRows = (await db
      .prepare(
        `SELECT i.id, i.ref, i.invoice_type, i.invoice_kind, i.currency, i.exchange_rate,
                i.source_ref, i.issue_date, i.due_date, i.status, i.lines_json,
                i.subtotal_ht, i.tax_total, i.total_ttc,
                tp.name AS party_name, tp.tax_id AS party_tax_id
         FROM invoices i
         JOIN third_parties tp ON tp.id = i.third_party_id
         WHERE ${invWhere.join(' AND ')}
         ORDER BY i.issue_date DESC, i.id DESC`
      )
      .all(...invParams)) as Array<{
      id: number;
      ref: string;
      invoice_type: 'customer' | 'supplier';
      invoice_kind: 'standard' | 'credit_note';
      currency: string;
      exchange_rate: number;
      source_ref: string;
      issue_date: string;
      due_date: string;
      status: string;
      lines_json: string;
      subtotal_ht: number;
      tax_total: number;
      total_ttc: number;
      party_name: string;
      party_tax_id: string;
    }>;

    // Track all PO references already billed via non-cancelled supplier bills to prevent double-counting
    const billedPoRefsRows = (await db
      .prepare(
        `SELECT DISTINCT source_ref
         FROM invoices
         WHERE invoice_type = 'supplier' AND status != 'cancelled' AND source_ref != ''`
      )
      .all()) as Array<{ source_ref: string }>;
    const billedPoRefs = new Set(billedPoRefsRows.map((r) => String(r.source_ref).trim().toUpperCase()));

    const poWhere: string[] = ["po.status != 'cancelled'"];
    const poParams: (string | number)[] = [];
    if (dateFrom) {
      poWhere.push('po.order_date >= ?');
      poParams.push(dateFrom);
    }
    if (dateTo) {
      poWhere.push('po.order_date <= ?');
      poParams.push(dateTo);
    }

    const poRows = (await db
      .prepare(
        `SELECT po.id, po.ref, po.order_date, po.expected_date, po.status, po.lines_json,
                po.subtotal_ht, po.tax_total, po.total_ttc,
                tp.name AS party_name, tp.tax_id AS party_tax_id
         FROM purchase_orders po
         JOIN third_parties tp ON tp.id = po.third_party_id
         WHERE ${poWhere.join(' AND ')}
         ORDER BY po.order_date DESC, po.id DESC`
      )
      .all(...poParams)) as Array<{
      id: number;
      ref: string;
      order_date: string;
      expected_date: string;
      status: string;
      lines_json: string;
      subtotal_ht: number;
      tax_total: number;
      total_ttc: number;
      party_name: string;
      party_tax_id: string;
    }>;

    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

    type LineDetail = {
      label: string;
      ref: string;
      qty: number;
      netBaseUsd: number;
      taxRate: number;
      taxAmountUsd: number;
    };

    const parseDocLinesUsd = (rawJson: string, headerBaseUsd: number, headerTaxUsd: number): LineDetail[] => {
      let parsed: Array<{
        ref?: string;
        label?: string;
        qty?: number;
        unitPrice?: number;
        discountPct?: number;
        taxRate?: number;
      }> = [];
      try {
        const val = JSON.parse(rawJson || '[]');
        if (Array.isArray(val)) parsed = val;
      } catch {
        parsed = [];
      }

      if (parsed.length === 0) {
        const effRate = headerBaseUsd > 0 ? round2((headerTaxUsd / headerBaseUsd) * 100) : 0;
        return [
          {
            label: 'Document Summary',
            ref: '',
            qty: 1,
            netBaseUsd: round2(headerBaseUsd),
            taxRate: effRate,
            taxAmountUsd: round2(headerTaxUsd),
          },
        ];
      }

      const rawDetails = parsed.map((l) => {
        const qty = Number(l.qty) || 0;
        const unitPrice = Number(l.unitPrice) || 0;
        const discountPct = Number(l.discountPct) || 0;
        const taxRate = Number(l.taxRate) || 0;
        const lineHt = qty * unitPrice * (1 - discountPct / 100);
        const lineTax = lineHt * (taxRate / 100);
        return {
          label: String(l.label || 'Line Item'),
          ref: String(l.ref || ''),
          qty,
          rawBase: lineHt,
          taxRate,
          rawTax: lineTax,
        };
      });

      const sumBase = rawDetails.reduce((s, d) => s + d.rawBase, 0);
      const sumTax = rawDetails.reduce((s, d) => s + d.rawTax, 0);
      const baseScale = sumBase > 0 ? headerBaseUsd / sumBase : 1;
      const taxScale = sumTax > 0 ? headerTaxUsd / sumTax : 1;

      const scaled = rawDetails.map((d) => ({
        label: d.label,
        ref: d.ref,
        qty: d.qty,
        netBaseUsd: round2(d.rawBase * baseScale),
        taxRate: round2(d.taxRate),
        taxAmountUsd: sumTax > 0 ? round2(d.rawTax * taxScale) : 0,
      }));

      // Reconcile any 1-cent rounding residual on the last line
      if (scaled.length > 0) {
        const scaledBaseSum = scaled.reduce((s, d) => s + d.netBaseUsd, 0);
        const scaledTaxSum = scaled.reduce((s, d) => s + d.taxAmountUsd, 0);
        scaled[scaled.length - 1].netBaseUsd = round2(scaled[scaled.length - 1].netBaseUsd + (headerBaseUsd - scaledBaseSum));
        scaled[scaled.length - 1].taxAmountUsd = round2(scaled[scaled.length - 1].taxAmountUsd + (headerTaxUsd - scaledTaxSum));
      }
      return scaled;
    };

    const matchTaxRateMeta = (ratePct: number, scope: 'sales' | 'purchase') => {
      const exactScope = taxRates.find(
        (t) => Math.abs(t.rate - ratePct) < 0.01 && (t.tax_type === scope || t.tax_type === 'both')
      );
      const anyScope = exactScope || taxRates.find((t) => Math.abs(t.rate - ratePct) < 0.01);
      if (anyScope) {
        return {
          tax_code: anyScope.code,
          tax_name: anyScope.name,
          tax_type: anyScope.tax_type,
        };
      }
      return {
        tax_code: `RATE-${ratePct}`,
        tax_name: `Custom Rate (${ratePct}%)`,
        tax_type: scope,
      };
    };

    type DocumentRow = {
      uid: string;
      id: number;
      source: 'invoice' | 'purchase_order';
      doc_type_label: string;
      ref: string;
      source_ref: string;
      party_name: string;
      party_tax_id: string;
      doc_date: string;
      due_or_expected_date: string;
      status: string;
      currency: string;
      exchange_rate: number;
      taxable_base_usd: number;
      tax_amount_usd: number;
      signed_tax_usd: number;
      liability_impact_usd: number;
      vat_bucket: 'output' | 'input_recognized' | 'input_pending_po';
      effective_rate_pct: number;
      line_details: LineDetail[];
    };

    const rateBuckets = new Map<
      number,
      {
        rate: number;
        tax_code: string;
        tax_name: string;
        tax_type: string;
        sales_base_usd: number;
        output_vat_usd: number;
        purchases_base_usd: number;
        recognized_input_vat_usd: number;
        pending_po_base_usd: number;
        pending_po_input_vat_usd: number;
        docUids: Set<string>;
      }
    >();

    // Seed rateBuckets with active configured tax rates so configured codes always have context if matched
    const ensureRateBucket = (ratePct: number, scope: 'sales' | 'purchase') => {
      const key = round2(ratePct);
      let bucket = rateBuckets.get(key);
      if (!bucket) {
        const meta = matchTaxRateMeta(key, scope);
        bucket = {
          rate: key,
          tax_code: meta.tax_code,
          tax_name: meta.tax_name,
          tax_type: meta.tax_type,
          sales_base_usd: 0,
          output_vat_usd: 0,
          purchases_base_usd: 0,
          recognized_input_vat_usd: 0,
          pending_po_base_usd: 0,
          pending_po_input_vat_usd: 0,
          docUids: new Set<string>(),
        };
        rateBuckets.set(key, bucket);
      }
      return bucket;
    };

    const periodBuckets = new Map<
      string,
      {
        period_month: string;
        output_vat_usd: number;
        recognized_input_vat_usd: number;
        pending_po_input_vat_usd: number;
        doc_count: number;
      }
    >();

    const ensurePeriodBucket = (dateStr: string) => {
      const ym = /^\d{4}-\d{2}/.test(dateStr) ? dateStr.slice(0, 7) : 'Unknown';
      let p = periodBuckets.get(ym);
      if (!p) {
        p = {
          period_month: ym,
          output_vat_usd: 0,
          recognized_input_vat_usd: 0,
          pending_po_input_vat_usd: 0,
          doc_count: 0,
        };
        periodBuckets.set(ym, p);
      }
      return p;
    };

    let grossOutputVat = 0;
    let creditNoteOutputOffset = 0;
    let recognizedInputVat = 0;
    let pendingPoInputVat = 0;
    let taxableSalesBase = 0;
    let taxablePurchasesBase = 0;
    let pendingPoBase = 0;
    let customerInvoiceCount = 0;
    let supplierBillCount = 0;
    let openPoCount = 0;
    let billedPoExcludedCount = 0;
    let draftExcludedCount = 0;

    const allDocs: DocumentRow[] = [];

    for (const inv of invRows) {
      if (inv.status === 'draft' && !includeDrafts) {
        draftExcludedCount += 1;
        continue;
      }
      const fx = inv.exchange_rate && inv.exchange_rate > 0 ? inv.exchange_rate : 1;
      const baseUsd = round2((Number(inv.subtotal_ht) || 0) / fx);
      const taxUsd = round2((Number(inv.tax_total) || 0) / fx);
      const isCreditNote = inv.invoice_kind === 'credit_note';
      const sign = isCreditNote ? -1 : 1;
      const isCustomer = inv.invoice_type === 'customer';
      const vatBucket: DocumentRow['vat_bucket'] = isCustomer ? 'output' : 'input_recognized';
      const signedTaxUsd = round2(taxUsd * sign);
      const liabilityImpactUsd = isCustomer ? signedTaxUsd : round2(-signedTaxUsd);
      const docTypeLabel = isCustomer
        ? isCreditNote
          ? 'Customer Credit Note'
          : 'Customer Invoice'
        : isCreditNote
          ? 'Supplier Credit Note'
          : 'Supplier Bill';

      const lineDetails = parseDocLinesUsd(inv.lines_json, baseUsd, taxUsd);
      const effRate = baseUsd > 0 ? round2((taxUsd / baseUsd) * 100) : lineDetails[0]?.taxRate ?? 0;
      const uid = `inv-${inv.id}`;

      if (isCustomer) {
        customerInvoiceCount += 1;
        taxableSalesBase += baseUsd * sign;
        if (isCreditNote) {
          creditNoteOutputOffset += taxUsd;
        } else {
          grossOutputVat += taxUsd;
        }
      } else {
        supplierBillCount += 1;
        taxablePurchasesBase += baseUsd * sign;
        recognizedInputVat += signedTaxUsd;
      }

      const period = ensurePeriodBucket(inv.issue_date);
      period.doc_count += 1;
      if (isCustomer) period.output_vat_usd += signedTaxUsd;
      else period.recognized_input_vat_usd += signedTaxUsd;

      for (const line of lineDetails) {
        const rb = ensureRateBucket(line.taxRate, isCustomer ? 'sales' : 'purchase');
        rb.docUids.add(uid);
        if (isCustomer) {
          rb.sales_base_usd += line.netBaseUsd * sign;
          rb.output_vat_usd += line.taxAmountUsd * sign;
        } else {
          rb.purchases_base_usd += line.netBaseUsd * sign;
          rb.recognized_input_vat_usd += line.taxAmountUsd * sign;
        }
      }

      allDocs.push({
        uid,
        id: inv.id,
        source: 'invoice',
        doc_type_label: docTypeLabel,
        ref: inv.ref,
        source_ref: inv.source_ref || '',
        party_name: inv.party_name,
        party_tax_id: inv.party_tax_id || '',
        doc_date: inv.issue_date,
        due_or_expected_date: inv.due_date,
        status: inv.status,
        currency: inv.currency || baseCurrency,
        exchange_rate: fx,
        taxable_base_usd: baseUsd,
        tax_amount_usd: taxUsd,
        signed_tax_usd: signedTaxUsd,
        liability_impact_usd: liabilityImpactUsd,
        vat_bucket: vatBucket,
        effective_rate_pct: effRate,
        line_details: lineDetails,
      });
    }

    for (const po of poRows) {
      if (po.status === 'billed' || billedPoRefs.has(po.ref.trim().toUpperCase())) {
        billedPoExcludedCount += 1;
        continue;
      }
      if (po.status === 'draft' && !includeDrafts) {
        draftExcludedCount += 1;
        continue;
      }

      const baseUsd = round2(Number(po.subtotal_ht) || 0);
      const taxUsd = round2(Number(po.tax_total) || 0);
      const lineDetails = parseDocLinesUsd(po.lines_json, baseUsd, taxUsd);
      const effRate = baseUsd > 0 ? round2((taxUsd / baseUsd) * 100) : lineDetails[0]?.taxRate ?? 0;
      const uid = `po-${po.id}`;

      openPoCount += 1;
      pendingPoBase += baseUsd;
      pendingPoInputVat += taxUsd;

      const period = ensurePeriodBucket(po.expected_date || po.order_date);
      period.doc_count += 1;
      period.pending_po_input_vat_usd += taxUsd;

      for (const line of lineDetails) {
        const rb = ensureRateBucket(line.taxRate, 'purchase');
        rb.docUids.add(uid);
        rb.pending_po_base_usd += line.netBaseUsd;
        rb.pending_po_input_vat_usd += line.taxAmountUsd;
      }

      allDocs.push({
        uid,
        id: po.id,
        source: 'purchase_order',
        doc_type_label: 'Purchase Order',
        ref: po.ref,
        source_ref: '',
        party_name: po.party_name,
        party_tax_id: po.party_tax_id || '',
        doc_date: po.order_date,
        due_or_expected_date: po.expected_date,
        status: po.status,
        currency: baseCurrency,
        exchange_rate: 1,
        taxable_base_usd: baseUsd,
        tax_amount_usd: taxUsd,
        signed_tax_usd: taxUsd,
        liability_impact_usd: round2(-taxUsd),
        vat_bucket: 'input_pending_po',
        effective_rate_pct: effRate,
        line_details: lineDetails,
      });
    }

    allDocs.sort((a, b) => b.doc_date.localeCompare(a.doc_date) || b.id - a.id);

    const filteredDocs = allDocs.filter((d) => {
      if (sourceFilter === 'invoices' && d.source !== 'invoice') return false;
      if (sourceFilter === 'purchase_orders' && d.source !== 'purchase_order') return false;
      if (taxBucket !== 'all' && d.vat_bucket !== taxBucket) return false;
      if (search) {
        const hay = `${d.ref} ${d.source_ref} ${d.party_name} ${d.party_tax_id} ${d.doc_type_label} ${d.status}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    const netOutputVat = round2(grossOutputVat - creditNoteOutputOffset);
    recognizedInputVat = round2(recognizedInputVat);
    pendingPoInputVat = round2(pendingPoInputVat);
    const totalPotentialInputVat = round2(recognizedInputVat + pendingPoInputVat);
    const netStatutoryPayable = round2(netOutputVat - recognizedInputVat);
    const projectedNetLiability = round2(netStatutoryPayable - pendingPoInputVat);
    const glVariance = round2(netStatutoryPayable - glVatPayableBalance);

    const rateBreakdown = Array.from(rateBuckets.values())
      .map((rb) => {
        const outVat = round2(rb.output_vat_usd);
        const inVat = round2(rb.recognized_input_vat_usd);
        const poVat = round2(rb.pending_po_input_vat_usd);
        return {
          rate: rb.rate,
          tax_code: rb.tax_code,
          tax_name: rb.tax_name,
          tax_type: rb.tax_type,
          sales_base_usd: round2(rb.sales_base_usd),
          output_vat_usd: outVat,
          purchases_base_usd: round2(rb.purchases_base_usd),
          recognized_input_vat_usd: inVat,
          pending_po_base_usd: round2(rb.pending_po_base_usd),
          pending_po_input_vat_usd: poVat,
          net_vat_usd: round2(outVat - inVat),
          projected_net_vat_usd: round2(outVat - inVat - poVat),
          doc_count: rb.docUids.size,
        };
      })
      .sort((a, b) => b.rate - a.rate);

    const monthlyTimeline = Array.from(periodBuckets.values())
      .map((p) => {
        const outVat = round2(p.output_vat_usd);
        const inVat = round2(p.recognized_input_vat_usd);
        const poVat = round2(p.pending_po_input_vat_usd);
        return {
          period_month: p.period_month,
          output_vat_usd: outVat,
          recognized_input_vat_usd: inVat,
          pending_po_input_vat_usd: poVat,
          net_payable_usd: round2(outVat - inVat),
          projected_payable_usd: round2(outVat - inVat - poVat),
          doc_count: p.doc_count,
        };
      })
      .sort((a, b) => b.period_month.localeCompare(a.period_month));

    return {
      summary: {
        baseCurrency,
        grossOutputVat: round2(grossOutputVat),
        creditNoteOutputOffset: round2(creditNoteOutputOffset),
        netOutputVat,
        recognizedInputVat,
        pendingPoInputVat,
        totalPotentialInputVat,
        netStatutoryPayable,
        projectedNetLiability,
        glVatPayableBalance,
        glVariance,
        taxableSalesBase: round2(taxableSalesBase),
        taxablePurchasesBase: round2(taxablePurchasesBase),
        pendingPoBase: round2(pendingPoBase),
        customerInvoiceCount,
        supplierBillCount,
        openPoCount,
        billedPoExcludedCount,
        draftExcludedCount,
      },
      documents: filteredDocs,
      rateBreakdown,
      monthlyTimeline,
      fiscalPeriods,
      taxRates,
    };
  }

  router.get('/finance/tax-compliance', authenticate, requirePermission('billing', 'read'), async (req, res) => {
    const payload = await computeTaxComplianceReport(req.query as TaxComplianceQuery);
    res.json(payload);
  });

  router.get('/finance/tax-compliance/export', authenticate, requirePermission('billing', 'read'), async (req, res) => {
    const payload = await computeTaxComplianceReport(req.query as TaxComplianceQuery);
    const headers = [
      'Reference',
      'Document Type',
      'Tax Bucket',
      'Counterparty',
      'Party Tax ID',
      'Document Date',
      'Due / Expected Date',
      'Status',
      'Currency',
      'FX Rate',
      'Taxable Base (USD)',
      'Effective Rate %',
      'Tax Amount (USD)',
      'Liability Impact (USD)',
    ];
    const bucketLabels: Record<string, string> = {
      output: 'Output VAT Collected',
      input_recognized: 'Recognized Input VAT',
      input_pending_po: 'Pending PO Input Credit',
    };
    const lines = [
      headers.map(sanitizeCsvCell).join(','),
      ...payload.documents.map((d) =>
        [
          d.ref,
          d.doc_type_label,
          bucketLabels[d.vat_bucket] || d.vat_bucket,
          d.party_name,
          d.party_tax_id,
          d.doc_date,
          d.due_or_expected_date,
          d.status,
          d.currency,
          d.exchange_rate,
          d.taxable_base_usd.toFixed(2),
          d.effective_rate_pct.toFixed(2),
          d.tax_amount_usd.toFixed(2),
          d.liability_impact_usd.toFixed(2),
        ]
          .map(sanitizeCsvCell)
          .join(',')
      ),
    ];
    res.json({
      count: payload.documents.length,
      filename: `kscat-tax-compliance-${new Date().toISOString().slice(0, 10)}.csv`,
      csv: lines.join('\n'),
    });
  });

  // Project Budget Allocations & Cost Codes
  router.post('/finance/project-budgets', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const {
      projectId,
      costCode = 'GEN-01',
      category = 'Services & Labor',
      description = '',
      plannedBudget = 0,
      committedAmount = 0,
      hourlyCostRate = 65,
      hourlyBillRate = 145,
    } = req.body ?? {};
    if (!projectId) {
      res.status(400).json({ error: 'Project is required.' });
      return;
    }
    const info = await db
      .prepare(
        `INSERT INTO project_budgets (project_id, cost_code, category, description, planned_budget, committed_amount, hourly_cost_rate, hourly_bill_rate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        Number(projectId),
        String(costCode).trim().toUpperCase() || 'GEN-01',
        String(category).trim() || 'Services & Labor',
        String(description).trim(),
        Math.max(0, Number(plannedBudget) || 0),
        Math.max(0, Number(committedAmount) || 0),
        Math.max(0, Number(hourlyCostRate) || 0),
        Math.max(0, Number(hourlyBillRate) || 0)
      );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_PROJECT_BUDGET',
      module: 'billing',
      entityRef: String(costCode).trim().toUpperCase(),
      details: `Allocated $${Number(plannedBudget || 0).toFixed(2)} budget (${costCode}) on project #${projectId}`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json(await db.prepare('SELECT * FROM project_budgets WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/finance/project-budgets/:id', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT cost_code FROM project_budgets WHERE id = ?').get(id)) as
      | { cost_code: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Budget line not found.' });
      return;
    }
    const { projectId, costCode, category, description, plannedBudget, committedAmount, hourlyCostRate, hourlyBillRate } = req.body ?? {};
    await db
      .prepare(
        `UPDATE project_budgets
         SET project_id = COALESCE(?, project_id),
             cost_code = COALESCE(?, cost_code),
             category = COALESCE(?, category),
             description = COALESCE(?, description),
             planned_budget = COALESCE(?, planned_budget),
             committed_amount = COALESCE(?, committed_amount),
             hourly_cost_rate = COALESCE(?, hourly_cost_rate),
             hourly_bill_rate = COALESCE(?, hourly_bill_rate)
         WHERE id = ?`
      )
      .run(
        projectId !== undefined ? Number(projectId) : null,
        costCode ? String(costCode).trim().toUpperCase() : null,
        category ? String(category).trim() : null,
        description !== undefined ? String(description).trim() : null,
        plannedBudget !== undefined ? Math.max(0, Number(plannedBudget)) : null,
        committedAmount !== undefined ? Math.max(0, Number(committedAmount)) : null,
        hourlyCostRate !== undefined ? Math.max(0, Number(hourlyCostRate)) : null,
        hourlyBillRate !== undefined ? Math.max(0, Number(hourlyBillRate)) : null,
        id
      );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_PROJECT_BUDGET',
      module: 'billing',
      entityRef: existing.cost_code,
      details: `Updated project budget allocation #${id}`,
      ipAddress: getClientIp(req),
    });
    res.json(await db.prepare('SELECT * FROM project_budgets WHERE id = ?').get(id));
  });

  router.delete('/finance/project-budgets/:id', authenticate, requirePermission('billing', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT cost_code FROM project_budgets WHERE id = ?').get(id)) as
      | { cost_code: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Budget line not found.' });
      return;
    }
    await db.prepare('DELETE FROM project_budgets WHERE id = ?').run(id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_PROJECT_BUDGET',
      module: 'billing',
      entityRef: existing.cost_code,
      details: `Deleted project budget line ${existing.cost_code}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    });
    res.json({ ok: true });
  });

  // Fixed Assets & Automated Depreciation
  router.post('/finance/fixed-assets', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const {
      name,
      category = 'Machinery & Equipment',
      acquisitionDate,
      purchaseCost,
      salvageValue = 0,
      usefulLifeMonths = 60,
      depreciationMethod = 'straight_line',
      accumulatedDepreciation = 0,
      location = 'Chicago HQ',
      notes = '',
    } = req.body ?? {};
    const cost = Number(purchaseCost);
    if (!String(name ?? '').trim() || !Number.isFinite(cost) || cost <= 0) {
      res.status(400).json({ error: 'Asset name and positive purchase cost are required.' });
      return;
    }
    const ref = await seqRef('fixed_assets', 'FA');
    const salvage = Math.max(0, Math.min(cost, Number(salvageValue) || 0));
    const accum = Math.max(0, Math.min(cost - salvage, Number(accumulatedDepreciation) || 0));
    const status = accum >= cost - salvage - 0.01 ? 'fully_depreciated' : 'active';
    const info = await db
      .prepare(
        `INSERT INTO fixed_assets (ref, name, category, acquisition_date, purchase_cost, salvage_value, useful_life_months, depreciation_method, accumulated_depreciation, location, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        ref,
        String(name).trim(),
        String(category).trim() || 'Machinery & Equipment',
        String(acquisitionDate || new Date().toISOString().slice(0, 10)),
        cost,
        salvage,
        Math.max(1, Number(usefulLifeMonths) || 60),
        depreciationMethod === 'declining_balance' ? 'declining_balance' : 'straight_line',
        accum,
        String(location).trim() || 'Chicago HQ',
        status,
        String(notes).trim()
      );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_FIXED_ASSET',
      module: 'billing',
      entityRef: ref,
      details: `Registered fixed asset ${name} ($${cost.toFixed(2)})`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json(await db.prepare('SELECT * FROM fixed_assets WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/finance/fixed-assets/:id', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM fixed_assets WHERE id = ?').get(id)) as
      | { ref: string; purchase_cost: number; salvage_value: number; accumulated_depreciation: number }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Fixed asset not found.' });
      return;
    }
    const {
      name,
      category,
      acquisitionDate,
      purchaseCost,
      salvageValue,
      usefulLifeMonths,
      depreciationMethod,
      accumulatedDepreciation,
      location,
      status,
      notes,
    } = req.body ?? {};
    const nextCost = purchaseCost !== undefined ? Math.max(1, Number(purchaseCost)) : existing.purchase_cost;
    const nextSalvage = salvageValue !== undefined ? Math.max(0, Math.min(nextCost, Number(salvageValue))) : existing.salvage_value;
    const maxDepreciable = Math.max(0, nextCost - nextSalvage);
    const nextAccum =
      accumulatedDepreciation !== undefined
        ? Math.max(0, Math.min(maxDepreciable, Number(accumulatedDepreciation) || 0))
        : Math.min(maxDepreciable, existing.accumulated_depreciation);
    const explicitStatus = ['active', 'fully_depreciated', 'disposed'].includes(status) ? status : null;
    const computedStatus =
      explicitStatus === 'disposed'
        ? 'disposed'
        : nextAccum >= maxDepreciable - 0.01 && maxDepreciable > 0
          ? 'fully_depreciated'
          : explicitStatus;
    await db
      .prepare(
        `UPDATE fixed_assets
         SET name = COALESCE(?, name),
             category = COALESCE(?, category),
             acquisition_date = COALESCE(?, acquisition_date),
             purchase_cost = ?,
             salvage_value = ?,
             useful_life_months = COALESCE(?, useful_life_months),
             depreciation_method = COALESCE(?, depreciation_method),
             accumulated_depreciation = ?,
             location = COALESCE(?, location),
             status = COALESCE(?, status),
             notes = COALESCE(?, notes)
         WHERE id = ?`
      )
      .run(
        name ? String(name).trim() : null,
        category ? String(category).trim() : null,
        acquisitionDate ? String(acquisitionDate) : null,
        nextCost,
        nextSalvage,
        usefulLifeMonths !== undefined ? Math.max(1, Number(usefulLifeMonths)) : null,
        ['straight_line', 'declining_balance'].includes(depreciationMethod) ? depreciationMethod : null,
        Math.round(nextAccum * 100) / 100,
        location !== undefined ? String(location).trim() : null,
        computedStatus,
        notes !== undefined ? String(notes).trim() : null,
        id
      );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_FIXED_ASSET',
      module: 'billing',
      entityRef: existing.ref,
      details: `Updated fixed asset ${existing.ref}`,
      ipAddress: getClientIp(req),
    });
    res.json(await db.prepare('SELECT * FROM fixed_assets WHERE id = ?').get(id));
  });

  router.post('/finance/fixed-assets/:id/depreciate', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const asset = (await db.prepare('SELECT * FROM fixed_assets WHERE id = ?').get(id)) as
      | {
          id: number;
          ref: string;
          name: string;
          purchase_cost: number;
          salvage_value: number;
          useful_life_months: number;
          depreciation_method: 'straight_line' | 'declining_balance';
          accumulated_depreciation: number;
          status: string;
        }
      | undefined;
    if (!asset) {
      res.status(404).json({ error: 'Fixed asset not found.' });
      return;
    }
    if (asset.status !== 'active') {
      res.status(400).json({ error: 'Only active assets can record monthly depreciation.' });
      return;
    }
    const postDate = String(req.body?.postDate || new Date().toISOString().slice(0, 10));
    const closedPeriod = await getClosedPeriodForDate(postDate);
    if (closedPeriod) {
      res.status(409).json({ error: `Cannot post depreciation into closed fiscal period ${closedPeriod.code}.` });
      return;
    }
    const remainingDepreciable = Math.max(0, asset.purchase_cost - asset.salvage_value - asset.accumulated_depreciation);
    if (remainingDepreciable <= 0.01) {
      await db.prepare(`UPDATE fixed_assets SET status = 'fully_depreciated' WHERE id = ?`).run(id);
      res.status(400).json({ error: 'Asset is already fully depreciated down to salvage value.' });
      return;
    }
    const life = Math.max(1, asset.useful_life_months);
    const rawMonthly =
      asset.depreciation_method === 'declining_balance'
        ? remainingDepreciable * (2 / life)
        : (asset.purchase_cost - asset.salvage_value) / life;
    const charge = Math.min(remainingDepreciable, Math.max(0.01, Math.round(rawMonthly * 100) / 100));
    const nextAccum = Math.round((asset.accumulated_depreciation + charge) * 100) / 100;
    const nextStatus = asset.purchase_cost - asset.salvage_value - nextAccum <= 0.01 ? 'fully_depreciated' : 'active';
    const jrnRef = await seqRef('journal_entries', 'DEP');

    await db.exec('BEGIN');
    try {
      await db
        .prepare(`UPDATE fixed_assets SET accumulated_depreciation = ?, last_depreciation_date = ?, status = ? WHERE id = ?`)
        .run(nextAccum, postDate, nextStatus, id);
      await db
        .prepare(
          `INSERT INTO journal_entries (ref, entry_date, journal_code, description, debit_account_code, credit_account_code, amount, source_ref, created_by)
           VALUES (?, ?, 'DEP', ?, '6300', '1290', ?, ?, ?)`
        )
        .run(jrnRef, postDate, `Monthly Depreciation — ${asset.ref} (${asset.name})`, charge, asset.ref, req.authUser!.email);
      await applyAccountPosting('6300', 'debit', charge);
      await applyAccountPosting('1290', 'credit', charge);
      await db.exec('COMMIT');
      await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'DEPRECIATE_FIXED_ASSET',
        module: 'billing',
        entityRef: asset.ref,
        details: `Posted $${charge.toFixed(2)} depreciation (${jrnRef}) on ${asset.ref}`,
        ipAddress: getClientIp(req),
      });
      res.json({ asset: await db.prepare('SELECT * FROM fixed_assets WHERE id = ?').get(id), journalRef: jrnRef, charge });
    } catch (err) {
      await db.exec('ROLLBACK');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to post depreciation.' });
    }
  });

  router.post('/finance/fixed-assets/depreciate-batch', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const rawDate = String(req.body?.postDate || new Date().toISOString().slice(0, 10)).trim();
    const postDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : new Date().toISOString().slice(0, 10);
    const closedPeriod = await getClosedPeriodForDate(postDate);
    if (closedPeriod) {
      res.status(409).json({ error: `Cannot post depreciation into closed fiscal period ${closedPeriod.code}.` });
      return;
    }

    const postMonth = postDate.slice(0, 7);
    const skipSameMonth = req.body?.skipAlreadyPostedThisMonth !== false;
    const requestedIds = Array.isArray(req.body?.assetIds)
      ? new Set((req.body.assetIds as unknown[]).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))
      : null;

    const activeAssets = (await db
      .prepare("SELECT * FROM fixed_assets WHERE status = 'active' ORDER BY id ASC")
      .all()) as Array<{
      id: number;
      ref: string;
      name: string;
      purchase_cost: number;
      salvage_value: number;
      useful_life_months: number;
      depreciation_method: 'straight_line' | 'declining_balance';
      accumulated_depreciation: number;
      last_depreciation_date: string;
    }>;

    const candidates = activeAssets.filter((a) => {
      if (requestedIds && !requestedIds.has(a.id)) return false;
      if (skipSameMonth && String(a.last_depreciation_date || '').slice(0, 7) === postMonth) return false;
      return a.purchase_cost - a.salvage_value - a.accumulated_depreciation > 0.01;
    });

    if (candidates.length === 0) {
      res.status(400).json({ error: `No eligible active assets remain to depreciate for ${postMonth}.` });
      return;
    }

    const results: Array<{ ref: string; journalRef: string; charge: number }> = [];
    let totalCharge = 0;

    await db.exec('BEGIN');
    try {
      for (const asset of candidates) {
        const remainingDepreciable = Math.max(0, asset.purchase_cost - asset.salvage_value - asset.accumulated_depreciation);
        if (remainingDepreciable <= 0.01) continue;
        const life = Math.max(1, asset.useful_life_months);
        const rawMonthly =
          asset.depreciation_method === 'declining_balance'
            ? remainingDepreciable * (2 / life)
            : (asset.purchase_cost - asset.salvage_value) / life;
        const charge = Math.min(remainingDepreciable, Math.max(0.01, Math.round(rawMonthly * 100) / 100));
        const nextAccum = Math.round((asset.accumulated_depreciation + charge) * 100) / 100;
        const nextStatus = asset.purchase_cost - asset.salvage_value - nextAccum <= 0.01 ? 'fully_depreciated' : 'active';
        const jrnRef = await seqRef('journal_entries', 'DEP');

        await db
          .prepare(`UPDATE fixed_assets SET accumulated_depreciation = ?, last_depreciation_date = ?, status = ? WHERE id = ?`)
          .run(nextAccum, postDate, nextStatus, asset.id);
        await db
          .prepare(
            `INSERT INTO journal_entries (ref, entry_date, journal_code, description, debit_account_code, credit_account_code, amount, source_ref, created_by)
             VALUES (?, ?, 'DEP', ?, '6300', '1290', ?, ?, ?)`
          )
          .run(jrnRef, postDate, `Monthly Depreciation — ${asset.ref} (${asset.name})`, charge, asset.ref, req.authUser!.email);
        await applyAccountPosting('6300', 'debit', charge);
        await applyAccountPosting('1290', 'credit', charge);

        totalCharge = Math.round((totalCharge + charge) * 100) / 100;
        results.push({ ref: asset.ref, journalRef: jrnRef, charge });
      }
      await db.exec('COMMIT');
      await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'BATCH_DEPRECIATE_FIXED_ASSETS',
        module: 'billing',
        entityRef: postMonth,
        details: `Posted batch depreciation ($${totalCharge.toFixed(2)}) across ${results.length} fixed asset(s)`,
        ipAddress: getClientIp(req),
      });
      res.json({ count: results.length, totalCharge, postDate, items: results });
    } catch (err) {
      await db.exec('ROLLBACK');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to run batch depreciation.' });
    }
  });

  router.get('/finance/fixed-assets/export', authenticate, requirePermission('billing', 'read'), async (_req, res) => {
    const rawAssets = (await db.prepare('SELECT * FROM fixed_assets ORDER BY acquisition_date DESC, id DESC').all()) as Array<{
      ref: string;
      name: string;
      category: string;
      acquisition_date: string;
      purchase_cost: number;
      salvage_value: number;
      useful_life_months: number;
      depreciation_method: 'straight_line' | 'declining_balance';
      accumulated_depreciation: number;
      last_depreciation_date: string;
      location: string;
      status: string;
      notes: string;
    }>;
    const headers = [
      'Asset Ref',
      'Asset Name',
      'Category',
      'Purchase Date',
      'Location',
      'Method',
      'Useful Life (Months)',
      'Purchase Cost',
      'Salvage Value',
      'Accumulated Depreciation',
      'Current Net Book Value',
      'Est. Monthly Charge',
      'Last Depreciation Date',
      'Status',
      'Notes',
    ];
    const lines = [
      headers.map(sanitizeCsvCell).join(','),
      ...rawAssets.map((a) => {
        const nbv = Math.max(0, Math.round((a.purchase_cost - a.accumulated_depreciation) * 100) / 100);
        const depreciableBase = Math.max(0, a.purchase_cost - a.salvage_value);
        const life = Math.max(1, a.useful_life_months);
        const estMonthly =
          a.status !== 'active'
            ? 0
            : a.depreciation_method === 'declining_balance'
              ? Math.round(Math.max(0, nbv - a.salvage_value) * (2 / life) * 100) / 100
              : Math.round((depreciableBase / life) * 100) / 100;
        const boundedMonthly = Math.min(estMonthly, Math.max(0, nbv - a.salvage_value));
        return [
          a.ref,
          a.name,
          a.category,
          a.acquisition_date,
          a.location,
          a.depreciation_method === 'declining_balance' ? 'Double Declining Balance' : 'Straight-Line',
          a.useful_life_months,
          a.purchase_cost.toFixed(2),
          a.salvage_value.toFixed(2),
          a.accumulated_depreciation.toFixed(2),
          nbv.toFixed(2),
          boundedMonthly.toFixed(2),
          a.last_depreciation_date || '',
          a.status,
          a.notes || '',
        ]
          .map(sanitizeCsvCell)
          .join(',');
      }),
    ];
    res.json({
      count: rawAssets.length,
      filename: `kscat-fixed-assets-${new Date().toISOString().slice(0, 10)}.csv`,
      csv: lines.join('\n'),
    });
  });

  router.delete('/finance/fixed-assets/:id', authenticate, requirePermission('billing', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, name FROM fixed_assets WHERE id = ?').get(id)) as
      | { ref: string; name: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Fixed asset not found.' });
      return;
    }
    await db.prepare('DELETE FROM fixed_assets WHERE id = ?').run(id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_FIXED_ASSET',
      module: 'billing',
      entityRef: existing.ref,
      details: `Deleted fixed asset ${existing.ref} (${existing.name})`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    });
    res.json({ ok: true });
  });

  // Fiscal Period Budgets, Actual Spend Tracking & Variance Alerts
  interface FiscalBudgetsQuery {
    fiscalPeriodId?: string;
    alertStatus?: string;
    category?: string;
    search?: string;
  }

  const VALID_SPEND_SOURCES = [
    'auto',
    'gl_account',
    'supplier_bills',
    'payroll',
    'bank_debits',
    'expenses',
    'manual',
  ] as const;

  async function computeFiscalBudgetsReport(q: FiscalBudgetsQuery) {
    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

    const fiscalPeriods = (await db
      .prepare('SELECT * FROM fiscal_periods ORDER BY start_date DESC, id DESC')
      .all()) as Array<{
      id: number;
      code: string;
      name: string;
      start_date: string;
      end_date: string;
      status: 'open' | 'closed';
      closed_by: string;
      closed_at: string;
    }>;

    const accounts = (await db
      .prepare('SELECT * FROM accounting_accounts ORDER BY code ASC')
      .all()) as Array<{
      id: number;
      code: string;
      label: string;
      account_class: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
      balance: number;
      is_active: number;
    }>;
    const accountLabelMap = new Map(accounts.map((a) => [a.code, a.label]));

    const rawBudgets = (await db
      .prepare(
        `SELECT fb.*, fp.code AS period_code, fp.name AS period_name,
                fp.start_date AS period_start, fp.end_date AS period_end, fp.status AS period_status
         FROM fiscal_budgets fb
         JOIN fiscal_periods fp ON fp.id = fb.fiscal_period_id
         ORDER BY fp.start_date DESC, fb.id DESC`
      )
      .all()) as Array<{
      id: number;
      ref: string;
      fiscal_period_id: number;
      period_code: string;
      period_name: string;
      period_start: string;
      period_end: string;
      period_status: 'open' | 'closed';
      name: string;
      category: string;
      department: string;
      account_code: string;
      planned_amount: number;
      warning_threshold_pct: number;
      critical_threshold_pct: number;
      spend_source: (typeof VALID_SPEND_SOURCES)[number];
      manual_actual_amount: number;
      notes: string;
      created_by: string;
      created_at: string;
      updated_at: string;
    }>;

    const journalRows = (await db
      .prepare(
        `SELECT ref, entry_date, description, debit_account_code, credit_account_code, amount, source_ref
         FROM journal_entries
         WHERE is_reversal = 0
         ORDER BY entry_date DESC, id DESC`
      )
      .all()) as Array<{
      ref: string;
      entry_date: string;
      description: string;
      debit_account_code: string;
      credit_account_code: string;
      amount: number;
      source_ref: string;
    }>;

    const supplierBillRows = (await db
      .prepare(
        `SELECT i.ref, i.issue_date, i.invoice_kind, i.subtotal_ht, i.exchange_rate, tp.name AS party_name
         FROM invoices i
         JOIN third_parties tp ON tp.id = i.third_party_id
         WHERE i.invoice_type = 'supplier' AND i.status != 'cancelled'
         ORDER BY i.issue_date DESC, i.id DESC`
      )
      .all()) as Array<{
      ref: string;
      issue_date: string;
      invoice_kind: 'standard' | 'credit_note';
      subtotal_ht: number;
      exchange_rate: number;
      party_name: string;
    }>;

    const bankDebitRows = (await db
      .prepare(
        `SELECT id, tx_date, label, category, amount
         FROM bank_transactions
         WHERE direction = 'debit' AND invoice_ref = ''
         ORDER BY tx_date DESC, id DESC`
      )
      .all()) as Array<{
      id: number;
      tx_date: string;
      label: string;
      category: string;
      amount: number;
    }>;

    const payrollRows = (await db
      .prepare(
        `SELECT ref, pay_period, pay_date, total_gross, employee_count
         FROM payroll_runs
         WHERE status IN ('processed', 'paid')
         ORDER BY pay_date DESC, id DESC`
      )
      .all()) as Array<{
      ref: string;
      pay_period: string;
      pay_date: string;
      total_gross: number;
      employee_count: number;
    }>;

    const expenseRows = (await db
      .prepare(
        `SELECT er.ref, er.category, er.expense_date, er.amount, er.description, e.full_name AS employee_name
         FROM expense_reports er
         LEFT JOIN employees e ON e.id = er.employee_id
         WHERE er.status IN ('approved', 'paid')
         ORDER BY er.expense_date DESC, er.id DESC`
      )
      .all()) as Array<{
      ref: string;
      category: string;
      expense_date: string;
      amount: number;
      description: string;
      employee_name: string | null;
    }>;

    type SpendLine = {
      sourceLabel: string;
      ref: string;
      date: string;
      description: string;
      amount: number;
    };

    const categoriesSet = new Set<string>();

    const enriched = rawBudgets.map((b) => {
      if (b.category) categoriesSet.add(b.category);
      const start = b.period_start;
      const end = b.period_end;
      const acct = String(b.account_code || '').trim();
      const source = b.spend_source || 'auto';
      const breakdown: SpendLine[] = [];
      const postedSourceRefs = new Set<string>();

      const addGlMatches = () => {
        if (!acct) return;
        for (const je of journalRows) {
          if (je.entry_date < start || je.entry_date > end) continue;
          if (je.debit_account_code === acct) {
            if (je.source_ref) postedSourceRefs.add(je.source_ref.toUpperCase());
            breakdown.push({
              sourceLabel: 'General Ledger (DR)',
              ref: je.ref,
              date: je.entry_date,
              description: je.description,
              amount: round2(Number(je.amount) || 0),
            });
          } else if (je.credit_account_code === acct) {
            if (je.source_ref) postedSourceRefs.add(je.source_ref.toUpperCase());
            breakdown.push({
              sourceLabel: 'General Ledger (CR)',
              ref: je.ref,
              date: je.entry_date,
              description: je.description,
              amount: round2(-(Number(je.amount) || 0)),
            });
          }
        }
      };

      const addSupplierBills = (avoidDoubleCount: boolean) => {
        for (const inv of supplierBillRows) {
          if (inv.issue_date < start || inv.issue_date > end) continue;
          if (avoidDoubleCount && postedSourceRefs.has(inv.ref.toUpperCase())) continue;
          const fx = inv.exchange_rate && inv.exchange_rate > 0 ? inv.exchange_rate : 1;
          const sign = inv.invoice_kind === 'credit_note' ? -1 : 1;
          const amt = round2(((Number(inv.subtotal_ht) || 0) / fx) * sign);
          breakdown.push({
            sourceLabel: inv.invoice_kind === 'credit_note' ? 'Supplier Credit Note' : 'Supplier Bill',
            ref: inv.ref,
            date: inv.issue_date,
            description: `${inv.party_name} (Excl. Tax)`,
            amount: amt,
          });
        }
      };

      const addPayrollRuns = (avoidDoubleCount: boolean) => {
        for (const pr of payrollRows) {
          if (pr.pay_date < start || pr.pay_date > end) continue;
          if (avoidDoubleCount && postedSourceRefs.has(pr.ref.toUpperCase())) continue;
          breakdown.push({
            sourceLabel: 'Payroll Run',
            ref: pr.ref,
            date: pr.pay_date,
            description: `Pay Period ${pr.pay_period} (${pr.employee_count} employees)`,
            amount: round2(Number(pr.total_gross) || 0),
          });
        }
      };

      const addBankDebits = (matchFacilitiesOnly: boolean) => {
        const catLower = b.category.toLowerCase();
        for (const tx of bankDebitRows) {
          if (tx.tx_date < start || tx.tx_date > end) continue;
          if (matchFacilitiesOnly) {
            const txCat = tx.category.toLowerCase();
            if (!catLower.includes(txCat) && !txCat.includes('facilit')) continue;
          }
          breakdown.push({
            sourceLabel: 'Bank Outflow',
            ref: `BNK-TX-${tx.id}`,
            date: tx.tx_date,
            description: `${tx.label} (${tx.category})`,
            amount: round2(Number(tx.amount) || 0),
          });
        }
      };

      const addExpenseReports = (avoidDoubleCount: boolean) => {
        for (const exp of expenseRows) {
          if (exp.expense_date < start || exp.expense_date > end) continue;
          if (avoidDoubleCount && postedSourceRefs.has(exp.ref.toUpperCase())) continue;
          breakdown.push({
            sourceLabel: 'Expense Report',
            ref: exp.ref,
            date: exp.expense_date,
            description: `${exp.employee_name || 'Employee'} — ${exp.description}`,
            amount: round2(Number(exp.amount) || 0),
          });
        }
      };

      if (source === 'gl_account') {
        addGlMatches();
      } else if (source === 'supplier_bills') {
        addSupplierBills(false);
      } else if (source === 'payroll') {
        addPayrollRuns(false);
      } else if (source === 'bank_debits') {
        addBankDebits(false);
      } else if (source === 'expenses') {
        addExpenseReports(false);
      } else if (source === 'auto') {
        addGlMatches();
        const catLower = b.category.toLowerCase();
        if (acct === '5000' || /cogs|cost of goods|purchase|inventory|material/.test(catLower)) {
          addSupplierBills(true);
        } else if (acct === '6100' || /facilit|lease|rent|utilities/.test(catLower)) {
          addBankDebits(true);
        } else if (acct === '6200' || /payroll|salary|salaries|benefit/.test(catLower)) {
          addPayrollRuns(true);
        } else if (/travel|expense/.test(catLower)) {
          addExpenseReports(true);
        }
      }

      const manualAmt = round2(Number(b.manual_actual_amount) || 0);
      if (manualAmt !== 0 || source === 'manual') {
        if (manualAmt !== 0) {
          breakdown.push({
            sourceLabel: source === 'manual' ? 'Manual Actual Entry' : 'Manual Accrual Adjustment',
            ref: b.ref,
            date: b.period_end,
            description: source === 'manual' ? 'Direct budget actual figure' : 'Controller adjustment',
            amount: manualAmt,
          });
        }
      }

      const actualAmount = round2(breakdown.reduce((s, item) => s + item.amount, 0));
      const plannedAmount = round2(Number(b.planned_amount) || 0);
      const remainingAmount = round2(plannedAmount - actualAmount);
      const varianceAmount = round2(actualAmount - plannedAmount);
      const utilizationPct =
        plannedAmount > 0
          ? Math.round((actualAmount / plannedAmount) * 1000) / 10
          : actualAmount > 0
            ? 100
            : 0;
      const warnPct = Number(b.warning_threshold_pct) || 85;
      const critPct = Number(b.critical_threshold_pct) || 100;

      const alertStatus: 'on_track' | 'warning' | 'over_budget' =
        (plannedAmount > 0 && actualAmount > plannedAmount) || utilizationPct >= critPct
          ? 'over_budget'
          : utilizationPct >= warnPct
            ? 'warning'
            : 'on_track';

      return {
        ...b,
        account_label: acct ? accountLabelMap.get(acct) || '' : '',
        planned_amount: plannedAmount,
        actual_amount: actualAmount,
        remaining_amount: remainingAmount,
        variance_amount: varianceAmount,
        utilization_pct: utilizationPct,
        alert_status: alertStatus,
        actual_breakdown: breakdown,
      };
    });

    const periodFilter = String(q.fiscalPeriodId ?? 'all').trim();
    const alertFilter = String(q.alertStatus ?? 'all').trim();
    const catFilter = String(q.category ?? 'all').trim();
    const search = String(q.search ?? '').trim().toLowerCase();

    const filtered = enriched.filter((b) => {
      if (periodFilter !== 'all' && String(b.fiscal_period_id) !== periodFilter) return false;
      if (alertFilter === 'alerts_only' && b.alert_status === 'on_track') return false;
      if (
        alertFilter !== 'all' &&
        alertFilter !== 'alerts_only' &&
        b.alert_status !== alertFilter
      ) {
        return false;
      }
      if (catFilter !== 'all' && b.category !== catFilter) return false;
      if (search) {
        const hay = `${b.ref} ${b.name} ${b.category} ${b.department} ${b.account_code} ${b.account_label} ${b.period_code}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    const periodScoped = periodFilter === 'all'
      ? enriched
      : enriched.filter((b) => String(b.fiscal_period_id) === periodFilter);

    const alerts = periodScoped
      .filter((b) => b.alert_status !== 'on_track')
      .sort((a, b) => {
        if (a.alert_status !== b.alert_status) {
          return a.alert_status === 'over_budget' ? -1 : 1;
        }
        return b.utilization_pct - a.utilization_pct;
      });

    const totalPlanned = round2(filtered.reduce((s, b) => s + b.planned_amount, 0));
    const totalActual = round2(filtered.reduce((s, b) => s + b.actual_amount, 0));
    const totalRemaining = round2(totalPlanned - totalActual);
    const totalVariance = round2(totalActual - totalPlanned);
    const overallUtilizationPct =
      totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 1000) / 10 : 0;
    const overBudgetCount = filtered.filter((b) => b.alert_status === 'over_budget').length;
    const warningCount = filtered.filter((b) => b.alert_status === 'warning').length;
    const onTrackCount = filtered.filter((b) => b.alert_status === 'on_track').length;

    return {
      budgets: filtered,
      alerts,
      summary: {
        totalBudgets: filtered.length,
        totalPlanned,
        totalActual,
        totalRemaining,
        totalVariance,
        overallUtilizationPct,
        overBudgetCount,
        warningCount,
        onTrackCount,
        alertCount: overBudgetCount + warningCount,
      },
      fiscalPeriods,
      accounts,
      categories: Array.from(categoriesSet).sort(),
    };
  }

  router.get('/finance/budgets', authenticate, requirePermission('billing', 'read'), async (req, res) => {
    const payload = await computeFiscalBudgetsReport(req.query as FiscalBudgetsQuery);
    res.json(payload);
  });

  router.get('/finance/budgets/export', authenticate, requirePermission('billing', 'read'), async (req, res) => {
    const payload = await computeFiscalBudgetsReport(req.query as FiscalBudgetsQuery);
    const headers = [
      'Budget Ref',
      'Fiscal Period',
      'Period Start',
      'Period End',
      'Budget Name',
      'Category',
      'Department',
      'GL Account',
      'Spend Source',
      'Planned Budget',
      'Actual Spend',
      'Remaining Headroom',
      'Variance',
      'Utilization %',
      'Warning Threshold %',
      'Critical Threshold %',
      'Alert Status',
      'Notes',
    ];
    const lines = [
      headers.map(sanitizeCsvCell).join(','),
      ...payload.budgets.map((b) =>
        [
          b.ref,
          b.period_code,
          b.period_start,
          b.period_end,
          b.name,
          b.category,
          b.department,
          b.account_code ? `${b.account_code} ${b.account_label}` : '',
          b.spend_source,
          b.planned_amount.toFixed(2),
          b.actual_amount.toFixed(2),
          b.remaining_amount.toFixed(2),
          b.variance_amount.toFixed(2),
          b.utilization_pct.toFixed(1),
          b.warning_threshold_pct.toFixed(1),
          b.critical_threshold_pct.toFixed(1),
          b.alert_status,
          b.notes,
        ]
          .map(sanitizeCsvCell)
          .join(',')
      ),
    ];
    res.json({
      count: payload.budgets.length,
      filename: `kscat-fiscal-budgets-${new Date().toISOString().slice(0, 10)}.csv`,
      csv: lines.join('\n'),
    });
  });

  router.post('/finance/budgets', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const {
      fiscalPeriodId,
      name,
      category = 'Operating Expenses',
      department = 'General',
      accountCode = '',
      plannedAmount,
      warningThresholdPct = 85,
      criticalThresholdPct = 100,
      spendSource = 'auto',
      manualActualAmount = 0,
      notes = '',
    } = req.body ?? {};

    const periodId = Number(fiscalPeriodId);
    const cleanName = String(name ?? '').trim();
    const planned = Number(plannedAmount);
    const warnPct = Number(warningThresholdPct);
    const critPct = Number(criticalThresholdPct);
    const manualAmt = Number(manualActualAmount) || 0;

    if (!Number.isFinite(periodId) || periodId <= 0 || !cleanName || !Number.isFinite(planned) || planned < 0) {
      res.status(400).json({ error: 'Fiscal period, budget name, and non-negative planned amount are required.' });
      return;
    }
    const period = (await db.prepare('SELECT id, code FROM fiscal_periods WHERE id = ?').get(periodId)) as
      | { id: number; code: string }
      | undefined;
    if (!period) {
      res.status(404).json({ error: 'Selected fiscal period not found.' });
      return;
    }

    const boundedWarn = Number.isFinite(warnPct) ? Math.max(1, Math.min(500, warnPct)) : 85;
    const boundedCrit = Number.isFinite(critPct) ? Math.max(boundedWarn, Math.min(500, critPct)) : 100;
    const cleanSource = VALID_SPEND_SOURCES.includes(spendSource) ? spendSource : 'auto';
    const ref = await seqRef('fiscal_budgets', 'BUD');

    const info = await db
      .prepare(
        `INSERT INTO fiscal_budgets
         (ref, fiscal_period_id, name, category, department, account_code, planned_amount,
          warning_threshold_pct, critical_threshold_pct, spend_source, manual_actual_amount, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        ref,
        periodId,
        cleanName,
        String(category).trim() || 'Operating Expenses',
        String(department).trim() || 'General',
        String(accountCode).trim(),
        Math.round(planned * 100) / 100,
        boundedWarn,
        boundedCrit,
        cleanSource,
        Math.round(manualAmt * 100) / 100,
        String(notes).trim(),
        req.authUser!.email
      );

    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_FISCAL_BUDGET',
      module: 'billing',
      entityRef: ref,
      details: `Created fiscal budget ${ref} (${cleanName}) for ${period.code}: $${planned.toFixed(2)}`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json(await db.prepare('SELECT * FROM fiscal_budgets WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/finance/budgets/:id', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM fiscal_budgets WHERE id = ?').get(id)) as
      | {
          id: number;
          ref: string;
          fiscal_period_id: number;
          planned_amount: number;
          warning_threshold_pct: number;
          critical_threshold_pct: number;
        }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Fiscal budget not found.' });
      return;
    }

    const {
      fiscalPeriodId,
      name,
      category,
      department,
      accountCode,
      plannedAmount,
      warningThresholdPct,
      criticalThresholdPct,
      spendSource,
      manualActualAmount,
      notes,
    } = req.body ?? {};

    let nextPeriodId: number | null = null;
    if (fiscalPeriodId !== undefined) {
      const pid = Number(fiscalPeriodId);
      const period = await db.prepare('SELECT id FROM fiscal_periods WHERE id = ?').get(pid);
      if (!period) {
        res.status(404).json({ error: 'Selected fiscal period not found.' });
        return;
      }
      nextPeriodId = pid;
    }

    const nextPlanned =
      plannedAmount !== undefined ? Math.max(0, Number(plannedAmount) || 0) : existing.planned_amount;
    const nextWarn =
      warningThresholdPct !== undefined
        ? Math.max(1, Math.min(500, Number(warningThresholdPct) || 85))
        : existing.warning_threshold_pct;
    const nextCrit =
      criticalThresholdPct !== undefined
        ? Math.max(nextWarn, Math.min(500, Number(criticalThresholdPct) || 100))
        : Math.max(nextWarn, existing.critical_threshold_pct);

    await db
      .prepare(
        `UPDATE fiscal_budgets
         SET fiscal_period_id = COALESCE(?, fiscal_period_id),
             name = COALESCE(?, name),
             category = COALESCE(?, category),
             department = COALESCE(?, department),
             account_code = COALESCE(?, account_code),
             planned_amount = ?,
             warning_threshold_pct = ?,
             critical_threshold_pct = ?,
             spend_source = COALESCE(?, spend_source),
             manual_actual_amount = COALESCE(?, manual_actual_amount),
             notes = COALESCE(?, notes),
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        nextPeriodId,
        name ? String(name).trim() : null,
        category ? String(category).trim() : null,
        department !== undefined ? String(department).trim() : null,
        accountCode !== undefined ? String(accountCode).trim() : null,
        Math.round(nextPlanned * 100) / 100,
        nextWarn,
        nextCrit,
        VALID_SPEND_SOURCES.includes(spendSource) ? spendSource : null,
        manualActualAmount !== undefined ? Math.round((Number(manualActualAmount) || 0) * 100) / 100 : null,
        notes !== undefined ? String(notes).trim() : null,
        id
      );

    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_FISCAL_BUDGET',
      module: 'billing',
      entityRef: existing.ref,
      details: `Updated fiscal budget ${existing.ref} ($${nextPlanned.toFixed(2)})`,
      ipAddress: getClientIp(req),
    });
    res.json(await db.prepare('SELECT * FROM fiscal_budgets WHERE id = ?').get(id));
  });

  router.delete('/finance/budgets/:id', authenticate, requirePermission('billing', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, name FROM fiscal_budgets WHERE id = ?').get(id)) as
      | { ref: string; name: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Fiscal budget not found.' });
      return;
    }
    await db.prepare('DELETE FROM fiscal_budgets WHERE id = ?').run(id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_FISCAL_BUDGET',
      module: 'billing',
      entityRef: existing.ref,
      details: `Deleted fiscal budget ${existing.ref} (${existing.name})`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    });
    res.json({ ok: true });
  });

  // Recurring Invoice Templates
  router.post('/finance/recurring-invoices', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const {
      invoiceType = 'customer',
      thirdPartyId,
      projectId = null,
      title,
      frequency = 'monthly',
      nextRunDate,
      currency = 'USD',
      lines,
      notes = '',
    } = req.body ?? {};
    if (!thirdPartyId || !String(title ?? '').trim()) {
      res.status(400).json({ error: 'Third party and schedule title are required.' });
      return;
    }
    const totals = computeFinanceLinesTotals(lines);
    if (totals.sanitized.length === 0) {
      res.status(400).json({ error: 'At least one billing line item is required.' });
      return;
    }
    const ref = await seqRef('recurring_invoices', 'REC');
    const cleanType = invoiceType === 'supplier' ? 'supplier' : 'customer';
    const cleanFreq = ['monthly', 'quarterly', 'annual'].includes(frequency) ? frequency : 'monthly';
    const cleanProj = projectId !== null && projectId !== '' && Number(projectId) > 0 ? Number(projectId) : null;
    const info = await db
      .prepare(
        `INSERT INTO recurring_invoices (ref, invoice_type, third_party_id, project_id, title, frequency, next_run_date, currency, lines_json, total_ttc, status, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
      )
      .run(
        ref,
        cleanType,
        Number(thirdPartyId),
        cleanProj,
        String(title).trim(),
        cleanFreq,
        String(nextRunDate || new Date().toISOString().slice(0, 10)),
        String(currency || 'USD').trim().toUpperCase().slice(0, 8),
        JSON.stringify(totals.sanitized),
        totals.totalTtc,
        String(notes).trim(),
        req.authUser!.email
      );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_RECURRING_INVOICE',
      module: 'billing',
      entityRef: ref,
      details: `Created recurring ${cleanFreq} template ${ref}: ${title}`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json(await db.prepare('SELECT * FROM recurring_invoices WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/finance/recurring-invoices/:id', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM recurring_invoices WHERE id = ?').get(id)) as
      | { id: number; ref: string; project_id: number | null }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Recurring template not found.' });
      return;
    }
    const { invoiceType, thirdPartyId, projectId, title, frequency, nextRunDate, currency, lines, status, notes } = req.body ?? {};
    const totals = Array.isArray(lines) && lines.length > 0 ? computeFinanceLinesTotals(lines) : null;
    const nextProj =
      projectId === undefined
        ? existing.project_id
        : projectId === null || projectId === '' || Number(projectId) <= 0
          ? null
          : Number(projectId);
    await db
      .prepare(
        `UPDATE recurring_invoices
         SET invoice_type = COALESCE(?, invoice_type),
             third_party_id = COALESCE(?, third_party_id),
             project_id = ?,
             title = COALESCE(?, title),
             frequency = COALESCE(?, frequency),
             next_run_date = COALESCE(?, next_run_date),
             currency = COALESCE(?, currency),
             lines_json = COALESCE(?, lines_json),
             total_ttc = COALESCE(?, total_ttc),
             status = COALESCE(?, status),
             notes = COALESCE(?, notes)
         WHERE id = ?`
      )
      .run(
        invoiceType === 'supplier' || invoiceType === 'customer' ? invoiceType : null,
        thirdPartyId !== undefined ? Number(thirdPartyId) : null,
        nextProj,
        title ? String(title).trim() : null,
        ['monthly', 'quarterly', 'annual'].includes(frequency) ? frequency : null,
        nextRunDate ? String(nextRunDate) : null,
        currency ? String(currency).trim().toUpperCase().slice(0, 8) : null,
        totals ? JSON.stringify(totals.sanitized) : null,
        totals ? totals.totalTtc : null,
        ['active', 'paused', 'ended'].includes(status) ? status : null,
        notes !== undefined ? String(notes).trim() : null,
        id
      );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_RECURRING_INVOICE',
      module: 'billing',
      entityRef: existing.ref,
      details: `Updated recurring template ${existing.ref}`,
      ipAddress: getClientIp(req),
    });
    res.json(await db.prepare('SELECT * FROM recurring_invoices WHERE id = ?').get(id));
  });

  router.post('/finance/recurring-invoices/:id/generate', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const tpl = (await db.prepare('SELECT * FROM recurring_invoices WHERE id = ?').get(id)) as
      | {
          id: number;
          ref: string;
          invoice_type: 'customer' | 'supplier';
          third_party_id: number;
          project_id: number | null;
          title: string;
          frequency: 'monthly' | 'quarterly' | 'annual';
          next_run_date: string;
          currency: string;
          lines_json: string;
          notes: string;
        }
      | undefined;
    if (!tpl) {
      res.status(404).json({ error: 'Recurring template not found.' });
      return;
    }
    const parsedLines = JSON.parse(tpl.lines_json || '[]');
    const totals = computeFinanceLinesTotals(parsedLines);
    const issueDate = new Date().toISOString().slice(0, 10);
    let fxRate = 1;
    try {
      const resolved = await currencyService.resolveExchangeRate(tpl.currency || 'USD', { txDate: issueDate });
      fxRate = resolved.exchangeRate;
    } catch {
      fxRate = 1;
    }
    const prefix = tpl.invoice_type === 'supplier' ? 'SI' : 'IN';
    const invRef = await nextSequenceRef('invoices', prefix);
    const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const nextRun = advanceRecurringDate(tpl.next_run_date || issueDate, tpl.frequency);

    await db.exec('BEGIN');
    try {
      const info = await db
        .prepare(
          `INSERT INTO invoices (ref, invoice_type, invoice_kind, third_party_id, project_id, currency, exchange_rate, source_ref, issue_date, due_date, status, lines_json, subtotal_ht, tax_total, total_ttc, amount_paid, notes, created_by)
           VALUES (?, ?, 'standard', ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, 0, ?, ?)`
        )
        .run(
          invRef,
          tpl.invoice_type,
          tpl.third_party_id,
          tpl.project_id ?? null,
          tpl.currency || 'USD',
          fxRate,
          tpl.ref,
          issueDate,
          dueDate,
          JSON.stringify(totals.sanitized),
          totals.subtotalHt,
          totals.taxTotal,
          totals.totalTtc,
          `${tpl.title}${tpl.notes ? ` — ${tpl.notes}` : ''}`,
          req.authUser!.email
        );
      await db
        .prepare(`UPDATE recurring_invoices SET last_generated_ref = ?, next_run_date = ? WHERE id = ?`)
        .run(invRef, nextRun, id);
      await db.exec('COMMIT');
      await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'GENERATE_RECURRING_INVOICE',
        module: 'billing',
        entityRef: invRef,
        details: `Generated ${invRef} from recurring template ${tpl.ref} (next run ${nextRun})`,
        ipAddress: getClientIp(req),
      });
      res.status(201).json({ invoice: await db.prepare('SELECT * FROM invoices WHERE id = ?').get(info.lastInsertRowid), nextRunDate: nextRun });
    } catch (err) {
      await db.exec('ROLLBACK');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to generate invoice.' });
    }
  });

  router.delete('/finance/recurring-invoices/:id', authenticate, requirePermission('billing', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, title FROM recurring_invoices WHERE id = ?').get(id)) as
      | { ref: string; title: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Recurring template not found.' });
      return;
    }
    await db.prepare('DELETE FROM recurring_invoices WHERE id = ?').run(id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_RECURRING_INVOICE',
      module: 'billing',
      entityRef: existing.ref,
      details: `Deleted recurring template ${existing.ref} (${existing.title})`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    });
    res.json({ ok: true });
  });

  router.post('/donations', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const { donorName, donorEmail = '', amount, donationDate, paymentMode = 'Bank Transfer', notes = '' } = req.body ?? {};
    const amt = Number(amount);
    if (!String(donorName ?? '').trim() || !Number.isFinite(amt) || amt <= 0) {
      res.status(400).json({ error: 'Donor name and positive amount are required.' });
      return;
    }
    const ref = (await seqRef('donations', 'DON'));
    const info = (await db
      .prepare(
        `INSERT INTO donations (ref, donor_name, donor_email, amount, donation_date, payment_mode, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, 'promised', ?)`
      )
      .run(
        ref,
        String(donorName).trim(),
        String(donorEmail).trim(),
        amt,
        String(donationDate || new Date().toISOString().slice(0, 10)),
        String(paymentMode).trim(),
        String(notes).trim()
      ));
    res.status(201).json((await db.prepare('SELECT * FROM donations WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/donations/:id', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM donations WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Donation not found.' });
      return;
    }
    const { donorName, donorEmail, amount, donationDate, paymentMode, status, notes } = req.body ?? {};
    (await db.prepare(
      `UPDATE donations
       SET donor_name = COALESCE(?, donor_name),
           donor_email = COALESCE(?, donor_email),
           amount = COALESCE(?, amount),
           donation_date = COALESCE(?, donation_date),
           payment_mode = COALESCE(?, payment_mode),
           status = COALESCE(?, status),
           notes = COALESCE(?, notes)
       WHERE id = ?`
    ).run(
      donorName ? String(donorName).trim() : null,
      donorEmail !== undefined ? String(donorEmail).trim() : null,
      amount !== undefined ? Number(amount) : null,
      donationDate ? String(donationDate) : null,
      paymentMode ? String(paymentMode).trim() : null,
      ['promised', 'received', 'cancelled'].includes(status) ? status : null,
      notes !== undefined ? String(notes).trim() : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_DONATION',
      module: 'billing',
      entityRef: existing.ref,
      details: `Updated donation ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM donations WHERE id = ?').get(id)));
  });

  router.delete('/donations/:id', authenticate, requirePermission('billing', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, donor_name FROM donations WHERE id = ?').get(id)) as
      | { ref: string; donor_name: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Donation not found.' });
      return;
    }
    (await db.prepare('DELETE FROM donations WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_DONATION',
      module: 'billing',
      entityRef: existing.ref,
      details: `Deleted donation ${existing.ref} (${existing.donor_name})`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.post('/donations/:id/receive', authenticate, requirePermission('billing', 'record_payment'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const don = (await db.prepare('SELECT * FROM donations WHERE id = ?').get(id)) as
      | { id: number; ref: string; donor_name: string; amount: number; status: string }
      | undefined;
    if (!don) {
      res.status(404).json({ error: 'Donation not found.' });
      return;
    }
    (await db.prepare(`UPDATE donations SET status = 'received' WHERE id = ?`).run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'RECEIVE_DONATION',
      module: 'billing',
      entityRef: don.ref,
      details: `Marked donation ${don.ref} ($${don.amount.toFixed(2)}) received`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM donations WHERE id = ?').get(id)));
  });

  router.post('/loans', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const { label, lenderName, principalAmount, interestRate = 4.5, termMonths = 36, startDate } = req.body ?? {};
    const principal = Number(principalAmount);
    if (!String(label ?? '').trim() || !String(lenderName ?? '').trim() || !Number.isFinite(principal) || principal <= 0) {
      res.status(400).json({ error: 'Loan label, lender, and positive principal are required.' });
      return;
    }
    const ref = (await seqRef('loans', 'LN'));
    const info = (await db
      .prepare(
        `INSERT INTO loans (ref, label, lender_name, principal_amount, remaining_principal, interest_rate, term_months, start_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`
      )
      .run(
        ref,
        String(label).trim(),
        String(lenderName).trim(),
        principal,
        principal,
        Number(interestRate) || 0,
        Math.max(1, Number(termMonths) || 12),
        String(startDate || new Date().toISOString().slice(0, 10))
      ));
    res.status(201).json((await db.prepare('SELECT * FROM loans WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/loans/:id', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM loans WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Loan not found.' });
      return;
    }
    const { label, lenderName, principalAmount, remainingPrincipal, interestRate, termMonths, startDate, status } = req.body ?? {};
    (await db.prepare(
      `UPDATE loans
       SET label = COALESCE(?, label),
           lender_name = COALESCE(?, lender_name),
           principal_amount = COALESCE(?, principal_amount),
           remaining_principal = COALESCE(?, remaining_principal),
           interest_rate = COALESCE(?, interest_rate),
           term_months = COALESCE(?, term_months),
           start_date = COALESCE(?, start_date),
           status = COALESCE(?, status)
       WHERE id = ?`
    ).run(
      label ? String(label).trim() : null,
      lenderName ? String(lenderName).trim() : null,
      principalAmount !== undefined ? Number(principalAmount) : null,
      remainingPrincipal !== undefined ? Math.max(0, Number(remainingPrincipal)) : null,
      interestRate !== undefined ? Number(interestRate) : null,
      termMonths !== undefined ? Math.max(1, Number(termMonths)) : null,
      startDate ? String(startDate) : null,
      ['active', 'paid_off'].includes(status) ? status : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_LOAN',
      module: 'billing',
      entityRef: existing.ref,
      details: `Updated loan ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM loans WHERE id = ?').get(id)));
  });

  router.delete('/loans/:id', authenticate, requirePermission('billing', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, label FROM loans WHERE id = ?').get(id)) as { ref: string; label: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Loan not found.' });
      return;
    }
    (await db.prepare('DELETE FROM loans WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_LOAN',
      module: 'billing',
      entityRef: existing.ref,
      details: `Deleted loan ${existing.label}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.post('/loans/:id/payment', authenticate, requirePermission('billing', 'record_payment'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const { amount } = req.body ?? {};
    const pay = Number(amount);
    const loan = (await db.prepare('SELECT * FROM loans WHERE id = ?').get(id)) as
      | { id: number; ref: string; remaining_principal: number }
      | undefined;
    if (!loan || !Number.isFinite(pay) || pay <= 0) {
      res.status(400).json({ error: 'Valid loan and positive payment amount required.' });
      return;
    }
    const nextRem = Math.max(0, Math.round((loan.remaining_principal - pay) * 100) / 100);
    const nextStatus = nextRem <= 0.01 ? 'paid_off' : 'active';
    (await db.prepare('UPDATE loans SET remaining_principal = ?, status = ? WHERE id = ?').run(nextRem, nextStatus, id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'LOAN_REPAYMENT',
      module: 'billing',
      entityRef: loan.ref,
      details: `Recorded $${pay.toFixed(2)} principal payment (remaining $${nextRem.toFixed(2)})`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM loans WHERE id = ?').get(id)));
  });

  // ========================
  // SUPPORT TICKETS & KNOWLEDGE BASE
  // ========================
  router.get('/support', authenticate, requirePermission('support', 'read'), async (_req, res) => {
    const tickets = (await db
      .prepare(
        `SELECT t.*, tp.name AS customer_name
         FROM tickets t
         LEFT JOIN third_parties tp ON tp.id = t.third_party_id
         ORDER BY t.id DESC`
      )
      .all());
    const articles = (await db.prepare('SELECT * FROM kb_articles ORDER BY id DESC').all());
    res.json({ tickets, articles });
  });

  router.post('/tickets', authenticate, requirePermission('support', 'write'), async (req: AuthenticatedReq, res) => {
    const { thirdPartyId = null, subject, category = 'Technical Support', severity = 'normal', message = '' } = req.body ?? {};
    if (!String(subject ?? '').trim()) {
      res.status(400).json({ error: 'Ticket subject is required.' });
      return;
    }
    const ref = (await seqRef('tickets', 'TCK'));
    const info = (await db
      .prepare(
        `INSERT INTO tickets (ref, third_party_id, subject, category, severity, status, assignee_name, message, replies_json, created_by)
         VALUES (?, ?, ?, ?, ?, 'open', ?, ?, '[]', ?)`
      )
      .run(
        ref,
        thirdPartyId ? Number(thirdPartyId) : null,
        String(subject).trim(),
        String(category).trim(),
        ['low', 'normal', 'high', 'critical'].includes(severity) ? severity : 'normal',
        req.authUser!.full_name,
        String(message).trim(),
        req.authUser!.email
      ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_TICKET',
      module: 'support',
      entityRef: ref,
      details: `Opened ticket ${ref}: ${subject}`,
      ipAddress: getClientIp(req),
    }));
    res.status(201).json((await db.prepare('SELECT * FROM tickets WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/tickets/:id', authenticate, requirePermission('support', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, third_party_id FROM tickets WHERE id = ?').get(id)) as
      | { ref: string; third_party_id: number | null }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Ticket not found.' });
      return;
    }
    const { thirdPartyId, subject, category, severity, status, assigneeName, message } = req.body ?? {};
    const nextParty =
      thirdPartyId === '' || thirdPartyId === null
        ? null
        : thirdPartyId !== undefined
          ? Number(thirdPartyId)
          : existing.third_party_id;
    (await db.prepare(
      `UPDATE tickets
       SET third_party_id = ?,
           subject = COALESCE(?, subject),
           category = COALESCE(?, category),
           severity = COALESCE(?, severity),
           status = COALESCE(?, status),
           assignee_name = COALESCE(?, assignee_name),
           message = COALESCE(?, message)
       WHERE id = ?`
    ).run(
      nextParty,
      subject ? String(subject).trim() : null,
      category ? String(category).trim() : null,
      ['low', 'normal', 'high', 'critical'].includes(severity) ? severity : null,
      ['open', 'in_progress', 'waiting_customer', 'closed'].includes(status) ? status : null,
      assigneeName !== undefined ? String(assigneeName).trim() : null,
      message !== undefined ? String(message).trim() : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_TICKET',
      module: 'support',
      entityRef: existing.ref,
      details: `Updated ticket ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM tickets WHERE id = ?').get(id)));
  });

  router.delete('/tickets/:id', authenticate, requirePermission('support', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, subject FROM tickets WHERE id = ?').get(id)) as
      | { ref: string; subject: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Ticket not found.' });
      return;
    }
    (await db.prepare('DELETE FROM tickets WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_TICKET',
      module: 'support',
      entityRef: existing.ref,
      details: `Deleted ticket ${existing.ref} (${existing.subject})`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.post('/tickets/:id/reply', authenticate, requirePermission('support', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const { text, status } = req.body ?? {};
    const ticket = (await db.prepare('SELECT * FROM tickets WHERE id = ?').get(id)) as
      | { id: number; ref: string; replies_json: string; status: string }
      | undefined;
    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found.' });
      return;
    }
    const replies = JSON.parse(ticket.replies_json || '[]') as Array<{ author: string; date: string; text: string }>;
    if (String(text ?? '').trim()) {
      replies.push({
        author: req.authUser!.full_name,
        date: new Date().toISOString().slice(0, 10),
        text: String(text).trim(),
      });
    }
    const nextStatus = ['open', 'in_progress', 'waiting_customer', 'closed'].includes(status) ? status : ticket.status;
    (await db.prepare('UPDATE tickets SET replies_json = ?, status = ? WHERE id = ?').run(JSON.stringify(replies), nextStatus, id));
    res.json((await db.prepare('SELECT * FROM tickets WHERE id = ?').get(id)));
  });

  router.post('/kb-articles', authenticate, requirePermission('support', 'write'), async (req: AuthenticatedReq, res) => {
    const { title, category = 'Operations', content, isPublic = true } = req.body ?? {};
    if (!String(title ?? '').trim() || !String(content ?? '').trim()) {
      res.status(400).json({ error: 'Article title and body are required.' });
      return;
    }
    const ref = (await seqRef('kb_articles', 'KB'));
    const info = (await db
      .prepare(`INSERT INTO kb_articles (ref, title, category, content, is_public, views) VALUES (?, ?, ?, ?, ?, 1)`)
      .run(ref, String(title).trim(), String(category).trim(), String(content).trim(), isPublic ? 1 : 0));
    res.status(201).json((await db.prepare('SELECT * FROM kb_articles WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/kb-articles/:id', authenticate, requirePermission('support', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM kb_articles WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Knowledge base article not found.' });
      return;
    }
    const { title, category, content, isPublic } = req.body ?? {};
    (await db.prepare(
      `UPDATE kb_articles
       SET title = COALESCE(?, title),
           category = COALESCE(?, category),
           content = COALESCE(?, content),
           is_public = COALESCE(?, is_public),
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      title ? String(title).trim() : null,
      category ? String(category).trim() : null,
      content !== undefined ? String(content).trim() : null,
      isPublic !== undefined ? (isPublic ? 1 : 0) : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_KB_ARTICLE',
      module: 'support',
      entityRef: existing.ref,
      details: `Updated KB article ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM kb_articles WHERE id = ?').get(id)));
  });

  router.delete('/kb-articles/:id', authenticate, requirePermission('support', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, title FROM kb_articles WHERE id = ?').get(id)) as
      | { ref: string; title: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Knowledge base article not found.' });
      return;
    }
    (await db.prepare('DELETE FROM kb_articles WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_KB_ARTICLE',
      module: 'support',
      entityRef: existing.ref,
      details: `Deleted KB article ${existing.title}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  // ========================
  // COLLABORATION (AGENDA iCal/vCal, EVENTS, SURVEYS)
  // ========================
  router.get('/collaboration', authenticate, requirePermission('projects', 'read'), async (_req, res) => {
    const agendaEvents = (await db.prepare('SELECT * FROM agenda_events ORDER BY start_at ASC').all());
    const orgEvents = (await db.prepare('SELECT * FROM org_events ORDER BY event_date ASC').all());
    const surveys = (await db.prepare('SELECT * FROM surveys ORDER BY id DESC').all());
    res.json({ agendaEvents, orgEvents, surveys });
  });

  router.post('/agenda-events', authenticate, requirePermission('projects', 'write'), async (req: AuthenticatedReq, res) => {
    const { title, eventType = 'meeting', startAt, endAt, location = '', description = '' } = req.body ?? {};
    if (!String(title ?? '').trim() || !startAt) {
      res.status(400).json({ error: 'Event title and start date/time are required.' });
      return;
    }
    const uid = `kscat-${crypto.randomUUID()}@erp`;
    const info = (await db
      .prepare(
        `INSERT INTO agenda_events (uid, title, event_type, start_at, end_at, location, organizer, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        uid,
        String(title).trim(),
        ['meeting', 'call', 'deadline', 'intervention', 'holiday'].includes(eventType) ? eventType : 'meeting',
        String(startAt),
        String(endAt || startAt),
        String(location).trim(),
        req.authUser!.full_name,
        String(description).trim()
      ));
    res.status(201).json((await db.prepare('SELECT * FROM agenda_events WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/agenda-events/:id', authenticate, requirePermission('projects', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT uid FROM agenda_events WHERE id = ?').get(id)) as { uid: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Agenda event not found.' });
      return;
    }
    const { title, eventType, startAt, endAt, location, description } = req.body ?? {};
    (await db.prepare(
      `UPDATE agenda_events
       SET title = COALESCE(?, title),
           event_type = COALESCE(?, event_type),
           start_at = COALESCE(?, start_at),
           end_at = COALESCE(?, end_at),
           location = COALESCE(?, location),
           description = COALESCE(?, description)
       WHERE id = ?`
    ).run(
      title ? String(title).trim() : null,
      ['meeting', 'call', 'deadline', 'intervention', 'holiday'].includes(eventType) ? eventType : null,
      startAt ? String(startAt) : null,
      endAt ? String(endAt) : null,
      location !== undefined ? String(location).trim() : null,
      description !== undefined ? String(description).trim() : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_AGENDA_EVENT',
      module: 'projects',
      entityRef: existing.uid,
      details: `Updated agenda event ${title ?? id}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM agenda_events WHERE id = ?').get(id)));
  });

  router.delete('/agenda-events/:id', authenticate, requirePermission('projects', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT uid, title FROM agenda_events WHERE id = ?').get(id)) as
      | { uid: string; title: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Agenda event not found.' });
      return;
    }
    (await db.prepare('DELETE FROM agenda_events WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_AGENDA_EVENT',
      module: 'projects',
      entityRef: existing.uid,
      details: `Deleted agenda event ${existing.title}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.get('/agenda-events/export.ics', authenticate, requirePermission('projects', 'read'), async (req, res) => {
    const format = String(req.query.format ?? 'ical') === 'vcal' ? 'vcal' : 'ical';
    const events = (await db.prepare('SELECT * FROM agenda_events ORDER BY start_at ASC').all()) as Array<{
      uid: string;
      title: string;
      start_at: string;
      end_at: string;
      location: string;
      description: string;
    }>;
    const toCalDt = (iso: string) => iso.replace(/[-:]/g, '').split('.')[0].slice(0, 15) + 'Z';
    const vevents = events
      .map(
        (ev) => `BEGIN:VEVENT
UID:${ev.uid}
DTSTART:${toCalDt(ev.start_at)}
DTEND:${toCalDt(ev.end_at || ev.start_at)}
SUMMARY:${ev.title.replace(/\n/g, ' ')}
LOCATION:${ev.location.replace(/\n/g, ' ')}
DESCRIPTION:${ev.description.replace(/\n/g, ' ')}
END:VEVENT`
      )
      .join('\r\n');

    const ics = `BEGIN:VCALENDAR\r\nVERSION:${format === 'vcal' ? '1.0' : '2.0'}\r\nPRODID:-//KSCAT-ERP//Collaboration Agenda//EN\r\n${vevents}\r\nEND:VCALENDAR`;
    res.json({ format, content: ics, count: events.length });
  });

  router.post('/agenda-events/import-ics', authenticate, requirePermission('projects', 'write'), async (req: AuthenticatedReq, res) => {
    const { content } = req.body ?? {};
    const raw = String(content ?? '');
    if (!raw.includes('BEGIN:VEVENT')) {
      res.status(400).json({ error: 'Valid iCal (.ics) or vCal (.vcs) content containing BEGIN:VEVENT is required.' });
      return;
    }
    const blocks = raw.split('BEGIN:VEVENT').slice(1);
    const insert = db.prepare(
      `INSERT OR IGNORE INTO agenda_events (uid, title, event_type, start_at, end_at, location, organizer, description)
       VALUES (?, ?, 'meeting', ?, ?, ?, ?, ?)`
    );
    const parseDt = (rawDt: string) => {
      const m = rawDt.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
      if (!m) return new Date().toISOString().slice(0, 19);
      return `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '09'}:${m[5] ?? '00'}:${m[6] ?? '00'}`;
    };

    let imported = 0;
    for (const block of blocks) {
      const endIdx = block.indexOf('END:VEVENT');
      const body = endIdx >= 0 ? block.slice(0, endIdx) : block;
      const getField = (name: string) => {
        const re = new RegExp(`^${name}[^:]*:(.*)$`, 'mi');
        return body.match(re)?.[1]?.trim() ?? '';
      };
      const summary = getField('SUMMARY') || 'Imported Calendar Event';
      const uid = getField('UID') || `imp-${crypto.randomUUID()}@erp`;
      const startAt = parseDt(getField('DTSTART'));
      const endAt = parseDt(getField('DTEND') || getField('DTSTART'));
      const loc = getField('LOCATION');
      const desc = getField('DESCRIPTION');
      const r = await insert.run(uid, summary, startAt, endAt, loc, req.authUser!.full_name, desc);
      if (r.changes > 0) imported += 1;
    }
    res.status(201).json({ imported });
  });

  router.post('/org-events', authenticate, requirePermission('projects', 'write'), async (req, res) => {
    const { title, eventDate, venue = '', capacity = 100, description = '' } = req.body ?? {};
    if (!String(title ?? '').trim()) {
      res.status(400).json({ error: 'Event title is required.' });
      return;
    }
    const ref = (await seqRef('org_events', 'EVT'));
    const info = (await db
      .prepare(
        `INSERT INTO org_events (ref, title, event_date, venue, capacity, registered_count, status, description)
         VALUES (?, ?, ?, ?, ?, 0, 'open', ?)`
      )
      .run(ref, String(title).trim(), String(eventDate || new Date().toISOString().slice(0, 10)), String(venue).trim(), Math.max(1, Number(capacity) || 50), String(description).trim()));
    res.status(201).json((await db.prepare('SELECT * FROM org_events WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/org-events/:id', authenticate, requirePermission('projects', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM org_events WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Organization event not found.' });
      return;
    }
    const { title, eventDate, venue, capacity, status, description } = req.body ?? {};
    (await db.prepare(
      `UPDATE org_events
       SET title = COALESCE(?, title),
           event_date = COALESCE(?, event_date),
           venue = COALESCE(?, venue),
           capacity = COALESCE(?, capacity),
           status = COALESCE(?, status),
           description = COALESCE(?, description)
       WHERE id = ?`
    ).run(
      title ? String(title).trim() : null,
      eventDate ? String(eventDate) : null,
      venue !== undefined ? String(venue).trim() : null,
      capacity !== undefined ? Math.max(1, Number(capacity) || 50) : null,
      ['draft', 'open', 'full', 'completed'].includes(status) ? status : null,
      description !== undefined ? String(description).trim() : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_ORG_EVENT',
      module: 'projects',
      entityRef: existing.ref,
      details: `Updated organization event ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM org_events WHERE id = ?').get(id)));
  });

  router.delete('/org-events/:id', authenticate, requirePermission('projects', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, title FROM org_events WHERE id = ?').get(id)) as
      | { ref: string; title: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Organization event not found.' });
      return;
    }
    (await db.prepare('DELETE FROM org_events WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_ORG_EVENT',
      module: 'projects',
      entityRef: existing.ref,
      details: `Deleted organization event ${existing.title}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.post('/org-events/:id/register', authenticate, requirePermission('projects', 'write'), async (req, res) => {
    const id = Number(req.params.id);
    const ev = (await db.prepare('SELECT * FROM org_events WHERE id = ?').get(id)) as
      | { id: number; capacity: number; registered_count: number }
      | undefined;
    if (!ev) {
      res.status(404).json({ error: 'Event not found.' });
      return;
    }
    const nextCount = Math.min(ev.capacity, ev.registered_count + 1);
    const status = nextCount >= ev.capacity ? 'full' : 'open';
    (await db.prepare('UPDATE org_events SET registered_count = ?, status = ? WHERE id = ?').run(nextCount, status, id));
    res.json((await db.prepare('SELECT * FROM org_events WHERE id = ?').get(id)));
  });

  router.post('/surveys', authenticate, requirePermission('projects', 'write'), async (req, res) => {
    const { title, question, options } = req.body ?? {};
    if (!String(title ?? '').trim() || !String(question ?? '').trim() || !Array.isArray(options) || options.length < 2) {
      res.status(400).json({ error: 'Title, question, and at least 2 options are required.' });
      return;
    }
    const cleanOpts = options.map((o: unknown) => String(o).trim()).filter(Boolean);
    const votes: Record<string, number> = {};
    for (const o of cleanOpts) votes[o] = 0;
    const ref = (await seqRef('surveys', 'SRV'));
    const info = (await db
      .prepare(`INSERT INTO surveys (ref, title, question, options_json, votes_json, status) VALUES (?, ?, ?, ?, ?, 'open')`)
      .run(ref, String(title).trim(), String(question).trim(), JSON.stringify(cleanOpts), JSON.stringify(votes)));
    res.status(201).json((await db.prepare('SELECT * FROM surveys WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/surveys/:id', authenticate, requirePermission('projects', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, votes_json FROM surveys WHERE id = ?').get(id)) as
      | { ref: string; votes_json: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Survey not found.' });
      return;
    }
    const { title, question, options, status } = req.body ?? {};
    let nextOptsJson: string | null = null;
    let nextVotesJson: string | null = null;
    if (Array.isArray(options) && options.length >= 2) {
      const cleanOpts = options.map((o: unknown) => String(o).trim()).filter(Boolean);
      const oldVotes = JSON.parse(existing.votes_json || '{}') as Record<string, number>;
      const nextVotes: Record<string, number> = {};
      for (const o of cleanOpts) nextVotes[o] = oldVotes[o] ?? 0;
      nextOptsJson = JSON.stringify(cleanOpts);
      nextVotesJson = JSON.stringify(nextVotes);
    }
    (await db.prepare(
      `UPDATE surveys
       SET title = COALESCE(?, title),
           question = COALESCE(?, question),
           options_json = COALESCE(?, options_json),
           votes_json = COALESCE(?, votes_json),
           status = COALESCE(?, status)
       WHERE id = ?`
    ).run(
      title ? String(title).trim() : null,
      question ? String(question).trim() : null,
      nextOptsJson,
      nextVotesJson,
      status === 'open' || status === 'closed' ? status : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_SURVEY',
      module: 'projects',
      entityRef: existing.ref,
      details: `Updated survey ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM surveys WHERE id = ?').get(id)));
  });

  router.delete('/surveys/:id', authenticate, requirePermission('projects', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, title FROM surveys WHERE id = ?').get(id)) as
      | { ref: string; title: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Survey not found.' });
      return;
    }
    (await db.prepare('DELETE FROM surveys WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_SURVEY',
      module: 'projects',
      entityRef: existing.ref,
      details: `Deleted survey ${existing.title}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.post('/surveys/:id/respond', authenticate, requirePermission('projects', 'read'), async (req, res) => {
    const id = Number(req.params.id);
    const { option } = req.body ?? {};
    const s = (await db.prepare('SELECT * FROM surveys WHERE id = ?').get(id)) as { votes_json: string; options_json: string } | undefined;
    if (!s) {
      res.status(404).json({ error: 'Survey not found.' });
      return;
    }
    const opts = JSON.parse(s.options_json) as string[];
    if (!opts.includes(String(option))) {
      res.status(400).json({ error: 'Invalid survey option.' });
      return;
    }
    const votes = JSON.parse(s.votes_json) as Record<string, number>;
    votes[String(option)] = (votes[String(option)] ?? 0) + 1;
    (await db.prepare('UPDATE surveys SET votes_json = ? WHERE id = ?').run(JSON.stringify(votes), id));
    res.json((await db.prepare('SELECT * FROM surveys WHERE id = ?').get(id)));
  });

  // ========================
  // HR MANAGEMENT & HRIS + KPI EVALUATION
  // ========================
  function normalizeLeaveType(val: unknown): string | null {
    const raw = String(val ?? '').trim();
    if (raw === 'Paid Time Off' || raw === 'Sick Leave' || raw === 'Parental' || raw === 'Unpaid') return raw;
    if (raw === 'Parental Leave') return 'Parental';
    if (raw === 'Unpaid Leave') return 'Unpaid';
    return null;
  }

  function computeClockHours(clockIn: string, clockOut: string): { regularHours: number; overtimeHours: number } {
    const mIn = /^(\d{1,2}):(\d{2})$/.exec(clockIn.trim());
    const mOut = /^(\d{1,2}):(\d{2})$/.exec(clockOut.trim());
    if (!mIn || !mOut) return { regularHours: 8, overtimeHours: 0 };
    const startMins = Number(mIn[1]) * 60 + Number(mIn[2]);
    let endMins = Number(mOut[1]) * 60 + Number(mOut[2]);
    if (endMins < startMins) endMins += 24 * 60;
    const total = Math.max(0, Number(((endMins - startMins) / 60).toFixed(2)));
    const regularHours = Math.min(8, total);
    const overtimeHours = Math.max(0, Number((total - 8).toFixed(2)));
    return { regularHours, overtimeHours };
  }

  function computeKpiSummary(rawMetrics: unknown): {
    metricsJson: string;
    overallScore: number;
    ratingLabel: string;
  } {
    const arr = Array.isArray(rawMetrics) ? rawMetrics : [];
    const cleaned = arr
      .map((item, idx) => {
        const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        const kpiName = String(obj.kpiName ?? '').trim();
        if (!kpiName) return null;
        const weightPct = Math.max(0, Math.min(100, Number(obj.weightPct) || 0));
        const score = Math.max(0, Math.min(100, Number(obj.score) || 0));
        return {
          id: String(obj.id || `m${idx + 1}`),
          kpiName,
          category: String(obj.category || 'Operations').trim(),
          weightPct,
          targetValue: String(obj.targetValue ?? '').trim(),
          actualValue: String(obj.actualValue ?? '').trim(),
          unit: String(obj.unit ?? '%').trim(),
          score,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    let overallScore = 0;
    if (cleaned.length > 0) {
      const totalWeight = cleaned.reduce((acc, m) => acc + m.weightPct, 0);
      if (totalWeight > 0) {
        overallScore = Number(
          (cleaned.reduce((acc, m) => acc + m.score * m.weightPct, 0) / totalWeight).toFixed(1)
        );
      } else {
        overallScore = Number((cleaned.reduce((acc, m) => acc + m.score, 0) / cleaned.length).toFixed(1));
      }
    }

    const ratingLabel =
      overallScore >= 90
        ? 'Exceeds Expectations'
        : overallScore >= 75
          ? 'Meets Expectations'
          : overallScore >= 60
            ? 'Developing'
            : 'Needs Improvement';

    return {
      metricsJson: JSON.stringify(cleaned),
      overallScore,
      ratingLabel,
    };
  }

  router.get('/hr', authenticate, requirePermission('hr', 'read'), async (_req, res) => {
    const employees = (await db.prepare('SELECT * FROM employees ORDER BY id ASC').all()) as Array<Record<string, unknown>>;
    const leaveRequests = (await db
      .prepare(
        `SELECT lr.*, e.full_name AS employee_name, e.department
         FROM leave_requests lr
         JOIN employees e ON e.id = lr.employee_id
         ORDER BY lr.id DESC`
      )
      .all()) as Array<Record<string, unknown>>;
    const expenseReports = await db
      .prepare(
        `SELECT er.*, e.full_name AS employee_name, e.department
         FROM expense_reports er
         JOIN employees e ON e.id = er.employee_id
         ORDER BY er.id DESC`
      )
      .all();
    const jobs = await db.prepare('SELECT * FROM job_postings ORDER BY id DESC').all();
    const candidates = await db
      .prepare(
        `SELECT c.*, j.title AS job_title, j.ref AS job_ref
         FROM candidates c
         JOIN job_postings j ON j.id = c.job_id
         ORDER BY c.id DESC`
      )
      .all();
    const timesheets = await db
      .prepare(
        `SELECT ts.*, e.full_name AS employee_name, pr.ref AS project_ref, pr.title AS project_title
         FROM timesheets ts
         JOIN employees e ON e.id = ts.employee_id
         LEFT JOIN projects pr ON pr.id = ts.project_id
         ORDER BY ts.work_date DESC, ts.id DESC`
      )
      .all();
    const attendanceLogs = (await db
      .prepare(
        `SELECT al.*, e.full_name AS employee_name, e.department
         FROM attendance_logs al
         JOIN employees e ON e.id = al.employee_id
         ORDER BY al.work_date DESC, al.id DESC`
      )
      .all()) as Array<Record<string, unknown>>;
    const shiftSchedules = await db
      .prepare(
        `SELECT ss.*, e.full_name AS employee_name, e.department
         FROM shift_schedules ss
         JOIN employees e ON e.id = ss.employee_id
         ORDER BY ss.id DESC`
      )
      .all();
    const payrollRuns = (await db.prepare('SELECT * FROM payroll_runs ORDER BY pay_period DESC, id DESC').all()) as Array<
      Record<string, unknown>
    >;
    const payslips = await db
      .prepare(
        `SELECT ps.*, e.full_name AS employee_name, e.ref AS employee_ref, e.department, e.job_title, e.tax_id, e.bank_account
         FROM payslips ps
         JOIN employees e ON e.id = ps.employee_id
         ORDER BY ps.pay_period DESC, ps.id DESC`
      )
      .all();
    const benefitPlans = await db.prepare('SELECT * FROM benefit_plans ORDER BY id ASC').all();
    const benefitEnrollments = await db
      .prepare(
        `SELECT be.*, e.full_name AS employee_name, e.department, bp.name AS plan_name, bp.ref AS plan_ref,
                bp.category AS plan_category, bp.employee_contribution, bp.employer_contribution
         FROM benefit_enrollments be
         JOIN employees e ON e.id = be.employee_id
         JOIN benefit_plans bp ON bp.id = be.plan_id
         ORDER BY be.id DESC`
      )
      .all();
    const onboardingTasks = (await db
      .prepare(
        `SELECT ot.*, e.full_name AS employee_name, c.full_name AS candidate_name
         FROM onboarding_tasks ot
         LEFT JOIN employees e ON e.id = ot.employee_id
         LEFT JOIN candidates c ON c.id = ot.candidate_id
         ORDER BY ot.due_date ASC, ot.id DESC`
      )
      .all()) as Array<Record<string, unknown>>;
    const kpiEvaluations = (await db
      .prepare(
        `SELECT ke.*, e.full_name AS employee_name, e.department, e.job_title
         FROM kpi_evaluations ke
         JOIN employees e ON e.id = ke.employee_id
         ORDER BY ke.review_period DESC, ke.id DESC`
      )
      .all()) as Array<Record<string, unknown>>;
    const complianceRecords = (await db
      .prepare('SELECT * FROM hr_compliance_records ORDER BY due_date ASC, id DESC')
      .all()) as Array<Record<string, unknown>>;

    // Analytics & Compliance summary
    const totalHeadcount = employees.length;
    const activeHeadcount = employees.filter((e) => e.status === 'active').length;
    const onLeaveCount = employees.filter((e) => e.status === 'on_leave').length;
    const terminatedCount = employees.filter((e) => e.status === 'terminated').length;
    const turnoverRatePct = totalHeadcount > 0 ? Number(((terminatedCount / totalHeadcount) * 100).toFixed(1)) : 0;
    const totalAnnualPayroll = employees
      .filter((e) => e.status !== 'terminated')
      .reduce((acc, e) => acc + (Number(e.annual_salary) || 0), 0);
    const monthlyPayrollEstimate = Number((totalAnnualPayroll / 12).toFixed(2));
    const latestPayrollNet = payrollRuns[0] ? Number(payrollRuns[0].total_net) || 0 : 0;
    const totalOvertimeHours = Number(
      attendanceLogs.reduce((acc, a) => acc + (Number(a.overtime_hours) || 0), 0).toFixed(2)
    );
    const pendingLeaveCount = leaveRequests.filter((l) => l.status === 'pending').length;
    const completedOnboarding = onboardingTasks.filter((t) => t.status === 'completed').length;
    const onboardingCompletionPct =
      onboardingTasks.length > 0 ? Math.round((completedOnboarding / onboardingTasks.length) * 100) : 100;
    const avgKpiScore =
      kpiEvaluations.length > 0
        ? Number(
            (
              kpiEvaluations.reduce((acc, k) => acc + (Number(k.overall_score) || 0), 0) / kpiEvaluations.length
            ).toFixed(1)
          )
        : 0;
    const complianceRatePct =
      complianceRecords.length > 0
        ? Number(
            (
              complianceRecords.reduce((acc, c) => acc + (Number(c.compliance_rate) || 0), 0) /
              complianceRecords.length
            ).toFixed(1)
          )
        : 100;

    const deptMap = new Map<string, { department: string; headcount: number; payroll: number }>();
    for (const emp of employees) {
      if (emp.status === 'terminated') continue;
      const dept = String(emp.department || 'Operations');
      const cur = deptMap.get(dept) ?? { department: dept, headcount: 0, payroll: 0 };
      cur.headcount += 1;
      cur.payroll += Number(emp.annual_salary) || 0;
      deptMap.set(dept, cur);
    }

    res.json({
      employees,
      leaveRequests,
      expenseReports,
      jobs,
      candidates,
      timesheets,
      attendanceLogs,
      shiftSchedules,
      payrollRuns,
      payslips,
      benefitPlans,
      benefitEnrollments,
      onboardingTasks,
      kpiEvaluations,
      complianceRecords,
      analytics: {
        totalHeadcount,
        activeHeadcount,
        onLeaveCount,
        terminatedCount,
        turnoverRatePct,
        totalAnnualPayroll,
        monthlyPayrollEstimate,
        latestPayrollNet,
        totalOvertimeHours,
        pendingLeaveCount,
        onboardingCompletionPct,
        avgKpiScore,
        complianceRatePct,
        departmentBreakdown: Array.from(deptMap.values()),
      },
    });
  });

  router.post('/employees', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const {
      fullName,
      email,
      phone = '',
      department = 'Operations',
      jobTitle = '',
      employmentType = 'Full-Time',
      hireDate,
      annualSalary = 75000,
      leaveBalanceDays = 20,
      taxId = '',
      bankAccount = '',
      emergencyContact = '',
      jobHistoryJson = '[]',
      taxDocumentsJson = '[]',
    } = req.body ?? {};
    if (!String(fullName ?? '').trim() || !String(email ?? '').trim()) {
      res.status(400).json({ error: 'Employee name and email are required.' });
      return;
    }
    const ref = await seqRef('employees', 'EMP');
    const info = await db
      .prepare(
        `INSERT INTO employees (ref, full_name, email, phone, department, job_title, employment_type, hire_date, annual_salary, leave_balance_days, tax_id, bank_account, emergency_contact, job_history_json, tax_documents_json, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
      )
      .run(
        ref,
        String(fullName).trim(),
        String(email).trim(),
        String(phone).trim(),
        String(department).trim(),
        String(jobTitle).trim(),
        String(employmentType).trim() || 'Full-Time',
        String(hireDate || new Date().toISOString().slice(0, 10)),
        Number(annualSalary) || 0,
        Number(leaveBalanceDays) || 20,
        String(taxId).trim(),
        String(bankAccount).trim(),
        String(emergencyContact).trim(),
        typeof jobHistoryJson === 'string' ? jobHistoryJson : JSON.stringify(jobHistoryJson ?? []),
        typeof taxDocumentsJson === 'string' ? taxDocumentsJson : JSON.stringify(taxDocumentsJson ?? [])
      );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_EMPLOYEE',
      module: 'hr',
      entityRef: ref,
      details: `Onboarded staff member ${fullName}`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json(await db.prepare('SELECT * FROM employees WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/employees/:id', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM employees WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Employee not found.' });
      return;
    }
    const {
      fullName,
      email,
      phone,
      department,
      jobTitle,
      employmentType,
      hireDate,
      annualSalary,
      leaveBalanceDays,
      taxId,
      bankAccount,
      emergencyContact,
      jobHistoryJson,
      taxDocumentsJson,
      status,
    } = req.body ?? {};
    await db
      .prepare(
        `UPDATE employees
         SET full_name = COALESCE(?, full_name),
             email = COALESCE(?, email),
             phone = COALESCE(?, phone),
             department = COALESCE(?, department),
             job_title = COALESCE(?, job_title),
             employment_type = COALESCE(?, employment_type),
             hire_date = COALESCE(?, hire_date),
             annual_salary = COALESCE(?, annual_salary),
             leave_balance_days = COALESCE(?, leave_balance_days),
             tax_id = COALESCE(?, tax_id),
             bank_account = COALESCE(?, bank_account),
             emergency_contact = COALESCE(?, emergency_contact),
             job_history_json = COALESCE(?, job_history_json),
             tax_documents_json = COALESCE(?, tax_documents_json),
             status = COALESCE(?, status)
         WHERE id = ?`
      )
      .run(
        fullName ? String(fullName).trim() : null,
        email ? String(email).trim() : null,
        phone !== undefined ? String(phone).trim() : null,
        department ? String(department).trim() : null,
        jobTitle !== undefined ? String(jobTitle).trim() : null,
        employmentType ? String(employmentType).trim() : null,
        hireDate ? String(hireDate) : null,
        annualSalary !== undefined ? Number(annualSalary) : null,
        leaveBalanceDays !== undefined ? Number(leaveBalanceDays) : null,
        taxId !== undefined ? String(taxId).trim() : null,
        bankAccount !== undefined ? String(bankAccount).trim() : null,
        emergencyContact !== undefined ? String(emergencyContact).trim() : null,
        jobHistoryJson !== undefined
          ? typeof jobHistoryJson === 'string'
            ? jobHistoryJson
            : JSON.stringify(jobHistoryJson)
          : null,
        taxDocumentsJson !== undefined
          ? typeof taxDocumentsJson === 'string'
            ? taxDocumentsJson
            : JSON.stringify(taxDocumentsJson)
          : null,
        ['active', 'on_leave', 'terminated'].includes(status) ? status : null,
        id
      );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_EMPLOYEE',
      module: 'hr',
      entityRef: existing.ref,
      details: `Updated employee ${existing.ref}`,
      ipAddress: getClientIp(req),
    });
    res.json(await db.prepare('SELECT * FROM employees WHERE id = ?').get(id));
  });

  // Self-Service Portal update (allows HR writers OR the matching staff member updating personal contact/tax docs/bank)
  router.put('/hr/self-service/:id', authenticate, requirePermission('hr', 'read'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT id, ref, email FROM employees WHERE id = ?').get(id)) as
      | { id: number; ref: string; email: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Employee profile not found.' });
      return;
    }
    const isSelf = existing.email.trim().toLowerCase() === req.authUser!.email.trim().toLowerCase();
    if (!isSelf && !hasPermission(req.authPermissions, 'hr', 'write')) {
      res.status(403).json({ error: 'You may only update your own self-service profile unless granted HR write access.' });
      return;
    }
    const { phone, emergencyContact, bankAccount, taxId, jobHistoryJson, taxDocumentsJson } = req.body ?? {};
    await db
      .prepare(
        `UPDATE employees
         SET phone = COALESCE(?, phone),
             emergency_contact = COALESCE(?, emergency_contact),
             bank_account = COALESCE(?, bank_account),
             tax_id = COALESCE(?, tax_id),
             job_history_json = COALESCE(?, job_history_json),
             tax_documents_json = COALESCE(?, tax_documents_json)
         WHERE id = ?`
      )
      .run(
        phone !== undefined ? String(phone).trim() : null,
        emergencyContact !== undefined ? String(emergencyContact).trim() : null,
        bankAccount !== undefined ? String(bankAccount).trim() : null,
        taxId !== undefined ? String(taxId).trim() : null,
        jobHistoryJson !== undefined
          ? typeof jobHistoryJson === 'string'
            ? jobHistoryJson
            : JSON.stringify(jobHistoryJson)
          : null,
        taxDocumentsJson !== undefined
          ? typeof taxDocumentsJson === 'string'
            ? taxDocumentsJson
            : JSON.stringify(taxDocumentsJson)
          : null,
        id
      );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'SELF_SERVICE_UPDATE',
      module: 'hr',
      entityRef: existing.ref,
      details: `Updated self-service HR details for ${existing.ref}`,
      ipAddress: getClientIp(req),
    });
    res.json(await db.prepare('SELECT * FROM employees WHERE id = ?').get(id));
  });

  router.delete('/employees/:id', authenticate, requirePermission('hr', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, full_name FROM employees WHERE id = ?').get(id)) as
      | { ref: string; full_name: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Employee not found.' });
      return;
    }
    await db.prepare('DELETE FROM employees WHERE id = ?').run(id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_EMPLOYEE',
      module: 'hr',
      entityRef: existing.ref,
      details: `Deleted employee ${existing.full_name}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    });
    res.json({ ok: true });
  });

  router.post('/leave-requests', authenticate, requirePermission('hr', 'write'), async (req, res) => {
    const { employeeId, leaveType = 'Paid Time Off', startDate, endDate, days = 1, reason = '' } = req.body ?? {};
    if (!employeeId || !startDate || !endDate) {
      res.status(400).json({ error: 'Employee, start date, and end date are required.' });
      return;
    }
    const cleanType = normalizeLeaveType(leaveType) ?? 'Paid Time Off';
    const ref = await seqRef('leave_requests', 'LVR');
    const info = await db
      .prepare(
        `INSERT INTO leave_requests (ref, employee_id, leave_type, start_date, end_date, days, reason, status, reviewed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', '')`
      )
      .run(ref, Number(employeeId), cleanType, String(startDate), String(endDate), Math.max(0.5, Number(days) || 1), String(reason).trim());
    res.status(201).json(await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/leave-requests/:id', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM leave_requests WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Leave request not found.' });
      return;
    }
    const { employeeId, leaveType, startDate, endDate, days, reason } = req.body ?? {};
    const cleanType = leaveType !== undefined ? normalizeLeaveType(leaveType) : null;
    await db
      .prepare(
        `UPDATE leave_requests
         SET employee_id = COALESCE(?, employee_id),
             leave_type = COALESCE(?, leave_type),
             start_date = COALESCE(?, start_date),
             end_date = COALESCE(?, end_date),
             days = COALESCE(?, days),
             reason = COALESCE(?, reason)
         WHERE id = ?`
      )
      .run(
        employeeId !== undefined ? Number(employeeId) : null,
        cleanType,
        startDate ? String(startDate) : null,
        endDate ? String(endDate) : null,
        days !== undefined ? Math.max(0.5, Number(days) || 1) : null,
        reason !== undefined ? String(reason).trim() : null,
        id
      );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_LEAVE_REQUEST',
      module: 'hr',
      entityRef: existing.ref,
      details: `Updated leave request ${existing.ref}`,
      ipAddress: getClientIp(req),
    });
    res.json(await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id));
  });

  router.delete('/leave-requests/:id', authenticate, requirePermission('hr', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM leave_requests WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Leave request not found.' });
      return;
    }
    await db.prepare('DELETE FROM leave_requests WHERE id = ?').run(id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_LEAVE_REQUEST',
      module: 'hr',
      entityRef: existing.ref,
      details: `Deleted leave request ${existing.ref}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    });
    res.json({ ok: true });
  });

  router.post('/leave-requests/:id/decide', authenticate, requirePermission('hr', 'validate'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const { decision } = req.body ?? {};
    if (decision !== 'approved' && decision !== 'rejected') {
      res.status(400).json({ error: 'Decision must be approved or rejected.' });
      return;
    }
    const lr = (await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id)) as
      | { id: number; ref: string; employee_id: number; days: number; status: string }
      | undefined;
    if (!lr || lr.status !== 'pending') {
      res.status(400).json({ error: 'Pending leave request not found.' });
      return;
    }
    await db.exec('BEGIN');
    try {
      await db.prepare('UPDATE leave_requests SET status = ?, reviewed_by = ? WHERE id = ?').run(decision, req.authUser!.email, id);
      if (decision === 'approved') {
        await db.prepare('UPDATE employees SET leave_balance_days = MAX(0, leave_balance_days - ?) WHERE id = ?').run(lr.days, lr.employee_id);
      }
      await db.exec('COMMIT');
      await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'DECIDE_LEAVE_REQUEST',
        module: 'hr',
        entityRef: lr.ref,
        details: `${decision.toUpperCase()} leave request ${lr.ref} (${lr.days} days)`,
        ipAddress: getClientIp(req),
      });
      res.json(await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id));
    } catch (err) {
      await db.exec('ROLLBACK');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to decide leave.' });
    }
  });

  // --- Attendance & Shift Schedules ---
  router.post('/hr/attendance/clock-in', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const { employeeId, shiftName = 'Standard Day Shift', status = 'present', notes = '' } = req.body ?? {};
    if (!employeeId) {
      res.status(400).json({ error: 'Employee is required to clock in.' });
      return;
    }
    const now = new Date();
    const workDate = now.toISOString().slice(0, 10);
    const clockIn = now.toISOString().slice(11, 16);
    const validStatus = ['present', 'late', 'remote'].includes(status) ? status : 'present';
    const info = await db
      .prepare(
        `INSERT INTO attendance_logs (employee_id, work_date, clock_in, clock_out, shift_name, regular_hours, overtime_hours, status, notes, approved_by)
         VALUES (?, ?, ?, '', ?, 0, 0, ?, ?, '')`
      )
      .run(Number(employeeId), workDate, clockIn, String(shiftName).trim(), validStatus, String(notes).trim());
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'ATTENDANCE_CLOCK_IN',
      module: 'hr',
      entityRef: `ATT-${info.lastInsertRowid}`,
      details: `Clocked in employee #${employeeId} at ${clockIn}`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json(await db.prepare('SELECT * FROM attendance_logs WHERE id = ?').get(info.lastInsertRowid));
  });

  router.post('/hr/attendance/:id/clock-out', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM attendance_logs WHERE id = ?').get(id)) as
      | { id: number; clock_in: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Attendance log not found.' });
      return;
    }
    const clockOut = String(req.body?.clockOut || new Date().toISOString().slice(11, 16));
    const { regularHours, overtimeHours } = computeClockHours(existing.clock_in, clockOut);
    await db
      .prepare(`UPDATE attendance_logs SET clock_out = ?, regular_hours = ?, overtime_hours = ? WHERE id = ?`)
      .run(clockOut, regularHours, overtimeHours, id);
    res.json(await db.prepare('SELECT * FROM attendance_logs WHERE id = ?').get(id));
  });

  router.post('/hr/attendance', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const {
      employeeId,
      workDate,
      clockIn = '09:00',
      clockOut = '17:30',
      shiftName = 'Standard Day Shift',
      regularHours,
      overtimeHours,
      status = 'present',
      notes = '',
    } = req.body ?? {};
    if (!employeeId || !workDate) {
      res.status(400).json({ error: 'Employee and work date are required.' });
      return;
    }
    const computed = clockOut ? computeClockHours(String(clockIn), String(clockOut)) : { regularHours: 8, overtimeHours: 0 };
    const reg = regularHours !== undefined && regularHours !== '' ? Math.max(0, Number(regularHours) || 0) : computed.regularHours;
    const ot = overtimeHours !== undefined && overtimeHours !== '' ? Math.max(0, Number(overtimeHours) || 0) : computed.overtimeHours;
    const validStatus = ['present', 'late', 'remote', 'absent', 'approved'].includes(status) ? status : 'present';
    const info = await db
      .prepare(
        `INSERT INTO attendance_logs (employee_id, work_date, clock_in, clock_out, shift_name, regular_hours, overtime_hours, status, notes, approved_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '')`
      )
      .run(Number(employeeId), String(workDate), String(clockIn), String(clockOut), String(shiftName).trim(), reg, ot, validStatus, String(notes).trim());
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_ATTENDANCE',
      module: 'hr',
      entityRef: `ATT-${info.lastInsertRowid}`,
      details: `Logged attendance for employee #${employeeId} on ${workDate}`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json(await db.prepare('SELECT * FROM attendance_logs WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/hr/attendance/:id', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT id FROM attendance_logs WHERE id = ?').get(id)) as { id: number } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Attendance log not found.' });
      return;
    }
    const { employeeId, workDate, clockIn, clockOut, shiftName, regularHours, overtimeHours, status, notes } = req.body ?? {};
    const validStatus = ['present', 'late', 'remote', 'absent', 'approved'].includes(status) ? status : null;
    await db
      .prepare(
        `UPDATE attendance_logs
         SET employee_id = COALESCE(?, employee_id),
             work_date = COALESCE(?, work_date),
             clock_in = COALESCE(?, clock_in),
             clock_out = COALESCE(?, clock_out),
             shift_name = COALESCE(?, shift_name),
             regular_hours = COALESCE(?, regular_hours),
             overtime_hours = COALESCE(?, overtime_hours),
             status = COALESCE(?, status),
             notes = COALESCE(?, notes)
         WHERE id = ?`
      )
      .run(
        employeeId !== undefined ? Number(employeeId) : null,
        workDate ? String(workDate) : null,
        clockIn !== undefined ? String(clockIn) : null,
        clockOut !== undefined ? String(clockOut) : null,
        shiftName !== undefined ? String(shiftName).trim() : null,
        regularHours !== undefined ? Math.max(0, Number(regularHours) || 0) : null,
        overtimeHours !== undefined ? Math.max(0, Number(overtimeHours) || 0) : null,
        validStatus,
        notes !== undefined ? String(notes).trim() : null,
        id
      );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_ATTENDANCE',
      module: 'hr',
      entityRef: `ATT-${id}`,
      details: `Updated attendance log #${id}`,
      ipAddress: getClientIp(req),
    });
    res.json(await db.prepare('SELECT * FROM attendance_logs WHERE id = ?').get(id));
  });

  router.post('/hr/attendance/:id/approve', authenticate, requirePermission('hr', 'validate'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT id FROM attendance_logs WHERE id = ?').get(id)) as { id: number } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Attendance log not found.' });
      return;
    }
    await db.prepare(`UPDATE attendance_logs SET status = 'approved', approved_by = ? WHERE id = ?`).run(req.authUser!.email, id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'APPROVE_ATTENDANCE',
      module: 'hr',
      entityRef: `ATT-${id}`,
      details: `Approved attendance & overtime #${id}`,
      ipAddress: getClientIp(req),
    });
    res.json(await db.prepare('SELECT * FROM attendance_logs WHERE id = ?').get(id));
  });

  router.delete('/hr/attendance/:id', authenticate, requirePermission('hr', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT id FROM attendance_logs WHERE id = ?').get(id)) as { id: number } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Attendance log not found.' });
      return;
    }
    await db.prepare('DELETE FROM attendance_logs WHERE id = ?').run(id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_ATTENDANCE',
      module: 'hr',
      entityRef: `ATT-${id}`,
      details: `Deleted attendance log #${id}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    });
    res.json({ ok: true });
  });

  router.post('/hr/shifts', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const { employeeId, shiftName, startTime = '09:00', endTime = '17:30', workDays = 'Mon–Fri', location = 'HQ / Hybrid', status = 'active' } =
      req.body ?? {};
    if (!employeeId || !String(shiftName ?? '').trim()) {
      res.status(400).json({ error: 'Employee and shift name are required.' });
      return;
    }
    const ref = await seqRef('shift_schedules', 'SHF');
    const info = await db
      .prepare(
        `INSERT INTO shift_schedules (ref, employee_id, shift_name, start_time, end_time, work_days, location, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        ref,
        Number(employeeId),
        String(shiftName).trim(),
        String(startTime).trim(),
        String(endTime).trim(),
        String(workDays).trim(),
        String(location).trim(),
        status === 'inactive' ? 'inactive' : 'active'
      );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_SHIFT',
      module: 'hr',
      entityRef: ref,
      details: `Assigned shift ${shiftName}`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json(await db.prepare('SELECT * FROM shift_schedules WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/hr/shifts/:id', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM shift_schedules WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Shift schedule not found.' });
      return;
    }
    const { employeeId, shiftName, startTime, endTime, workDays, location, status } = req.body ?? {};
    await db
      .prepare(
        `UPDATE shift_schedules
         SET employee_id = COALESCE(?, employee_id),
             shift_name = COALESCE(?, shift_name),
             start_time = COALESCE(?, start_time),
             end_time = COALESCE(?, end_time),
             work_days = COALESCE(?, work_days),
             location = COALESCE(?, location),
             status = COALESCE(?, status)
         WHERE id = ?`
      )
      .run(
        employeeId !== undefined ? Number(employeeId) : null,
        shiftName ? String(shiftName).trim() : null,
        startTime ? String(startTime).trim() : null,
        endTime ? String(endTime).trim() : null,
        workDays ? String(workDays).trim() : null,
        location !== undefined ? String(location).trim() : null,
        ['active', 'inactive'].includes(status) ? status : null,
        id
      );
    res.json(await db.prepare('SELECT * FROM shift_schedules WHERE id = ?').get(id));
  });

  router.delete('/hr/shifts/:id', authenticate, requirePermission('hr', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM shift_schedules WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Shift schedule not found.' });
      return;
    }
    await db.prepare('DELETE FROM shift_schedules WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // --- Payroll & Benefits Administration ---
  router.post('/hr/payroll-runs', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const {
      payPeriod = new Date().toISOString().slice(0, 7),
      payDate = new Date().toISOString().slice(0, 10),
      taxRatePct = 15,
      socialRatePct = 4.5,
      includeOvertime = true,
      overtimeMultiplier = 1.5,
    } = req.body ?? {};

    const cleanPeriod = String(payPeriod).trim();
    if (!cleanPeriod) {
      res.status(400).json({ error: 'Pay period is required (e.g. 2026-11).' });
      return;
    }

    const activeEmployees = (await db
      .prepare(`SELECT * FROM employees WHERE status != 'terminated' ORDER BY id ASC`)
      .all()) as Array<{
      id: number;
      ref: string;
      full_name: string;
      annual_salary: number;
      bank_account: string;
    }>;
    if (activeEmployees.length === 0) {
      res.status(400).json({ error: 'No active employees available for payroll processing.' });
      return;
    }

    const enrollments = (await db
      .prepare(
        `SELECT be.employee_id, bp.employee_contribution
         FROM benefit_enrollments be
         JOIN benefit_plans bp ON bp.id = be.plan_id
         WHERE be.status = 'active'`
      )
      .all()) as Array<{ employee_id: number; employee_contribution: number }>;

    const benefitMap = new Map<number, number>();
    for (const enr of enrollments) {
      benefitMap.set(enr.employee_id, (benefitMap.get(enr.employee_id) ?? 0) + (Number(enr.employee_contribution) || 0));
    }

    const otRows = (await db
      .prepare(
        `SELECT employee_id, COALESCE(SUM(overtime_hours), 0) AS ot_hours
         FROM attendance_logs
         WHERE work_date LIKE ? AND status IN ('approved', 'present', 'remote')
         GROUP BY employee_id`
      )
      .all(`${cleanPeriod}%`)) as Array<{ employee_id: number; ot_hours: number }>;
    const otMap = new Map<number, number>();
    for (const row of otRows) {
      otMap.set(row.employee_id, Number(row.ot_hours) || 0);
    }

    const runRef = await seqRef('payroll_runs', 'PAY');
    const taxPct = Math.max(0, Math.min(50, Number(taxRatePct) || 0)) / 100;
    const socPct = Math.max(0, Math.min(25, Number(socialRatePct) || 0)) / 100;
    const otMult = Math.max(1, Math.min(3, Number(overtimeMultiplier) || 1.5));

    let totalGross = 0;
    let totalDeductions = 0;
    let totalNet = 0;

    const slipDrafts = activeEmployees.map((emp) => {
      const monthlyBase = Number(emp.annual_salary) / 12;
      const hourlyRate = Number(emp.annual_salary) / 2080;
      const otHours = includeOvertime ? otMap.get(emp.id) ?? 0 : 0;
      const otPay = otHours * hourlyRate * otMult;
      const grossPay = Number((monthlyBase + otPay).toFixed(2));
      const taxDeduction = Number((grossPay * taxPct).toFixed(2));
      const socialDeduction = Number((grossPay * socPct).toFixed(2));
      const healthDeduction = Number((benefitMap.get(emp.id) ?? 0).toFixed(2));
      const otherDeductions = 0;
      const ded = taxDeduction + socialDeduction + healthDeduction + otherDeductions;
      const netPay = Number(Math.max(0, grossPay - ded).toFixed(2));

      totalGross += grossPay;
      totalDeductions += ded;
      totalNet += netPay;

      return {
        employeeId: emp.id,
        grossPay,
        taxDeduction,
        socialDeduction,
        healthDeduction,
        otherDeductions,
        netPay,
        depositRef: `ACH-${emp.ref}-${cleanPeriod.replace('-', '')}`,
      };
    });

    const runInfo = await db
      .prepare(
        `INSERT INTO payroll_runs (ref, pay_period, pay_date, total_gross, total_deductions, total_net, employee_count, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'processed', ?)`
      )
      .run(
        runRef,
        cleanPeriod,
        String(payDate),
        Number(totalGross.toFixed(2)),
        Number(totalDeductions.toFixed(2)),
        Number(totalNet.toFixed(2)),
        activeEmployees.length,
        req.authUser!.email
      );

    const runId = Number(runInfo.lastInsertRowid);
    const baseSlipRef = await seqRef('payslips', 'SLP');
    const prefixPart = baseSlipRef.slice(0, baseSlipRef.lastIndexOf('-') + 1);
    let slipSeq = Number(baseSlipRef.split('-').pop()) || 1;

    for (const s of slipDrafts) {
      const slipRef = `${prefixPart}${String(slipSeq).padStart(4, '0')}`;
      slipSeq += 1;
      await db
        .prepare(
          `INSERT INTO payslips (ref, payroll_run_id, employee_id, pay_period, gross_pay, tax_deduction, social_deduction, health_deduction, other_deductions, net_pay, direct_deposit_ref, payment_method, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Direct Deposit', 'generated')`
        )
        .run(
          slipRef,
          runId,
          s.employeeId,
          cleanPeriod,
          s.grossPay,
          s.taxDeduction,
          s.socialDeduction,
          s.healthDeduction,
          s.otherDeductions,
          s.netPay,
          s.depositRef
        );
    }

    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'RUN_PAYROLL',
      module: 'hr',
      entityRef: runRef,
      details: `Processed payroll ${runRef} for ${activeEmployees.length} staff (${cleanPeriod})`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json(await db.prepare('SELECT * FROM payroll_runs WHERE id = ?').get(runId));
  });

  router.put('/hr/payroll-runs/:id', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM payroll_runs WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Payroll run not found.' });
      return;
    }
    const { payPeriod, payDate, status } = req.body ?? {};
    await db
      .prepare(
        `UPDATE payroll_runs
         SET pay_period = COALESCE(?, pay_period),
             pay_date = COALESCE(?, pay_date),
             status = COALESCE(?, status)
         WHERE id = ?`
      )
      .run(
        payPeriod ? String(payPeriod).trim() : null,
        payDate ? String(payDate) : null,
        ['draft', 'processed', 'paid'].includes(status) ? status : null,
        id
      );
    res.json(await db.prepare('SELECT * FROM payroll_runs WHERE id = ?').get(id));
  });

  router.post('/hr/payroll-runs/:id/mark-paid', authenticate, requirePermission('hr', 'validate'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM payroll_runs WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Payroll run not found.' });
      return;
    }
    await db.prepare(`UPDATE payroll_runs SET status = 'paid' WHERE id = ?`).run(id);
    await db.prepare(`UPDATE payslips SET status = 'paid' WHERE payroll_run_id = ?`).run(id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'MARK_PAYROLL_PAID',
      module: 'hr',
      entityRef: existing.ref,
      details: `Disbursed direct deposits for payroll ${existing.ref}`,
      ipAddress: getClientIp(req),
    });
    res.json(await db.prepare('SELECT * FROM payroll_runs WHERE id = ?').get(id));
  });

  router.delete('/hr/payroll-runs/:id', authenticate, requirePermission('hr', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM payroll_runs WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Payroll run not found.' });
      return;
    }
    await db.prepare('DELETE FROM payroll_runs WHERE id = ?').run(id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_PAYROLL_RUN',
      module: 'hr',
      entityRef: existing.ref,
      details: `Deleted payroll run ${existing.ref}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    });
    res.json({ ok: true });
  });

  router.put('/hr/payslips/:id', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM payslips WHERE id = ?').get(id)) as
      | {
          id: number;
          ref: string;
          payroll_run_id: number;
          gross_pay: number;
          tax_deduction: number;
          social_deduction: number;
          health_deduction: number;
          other_deductions: number;
        }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Payslip not found.' });
      return;
    }
    const { grossPay, taxDeduction, socialDeduction, healthDeduction, otherDeductions, directDepositRef, paymentMethod, status } = req.body ?? {};
    const gross = grossPay !== undefined ? Math.max(0, Number(grossPay) || 0) : existing.gross_pay;
    const tax = taxDeduction !== undefined ? Math.max(0, Number(taxDeduction) || 0) : existing.tax_deduction;
    const soc = socialDeduction !== undefined ? Math.max(0, Number(socialDeduction) || 0) : existing.social_deduction;
    const hlth = healthDeduction !== undefined ? Math.max(0, Number(healthDeduction) || 0) : existing.health_deduction;
    const other = otherDeductions !== undefined ? Math.max(0, Number(otherDeductions) || 0) : existing.other_deductions;
    const net = Number(Math.max(0, gross - tax - soc - hlth - other).toFixed(2));
    await db
      .prepare(
        `UPDATE payslips
         SET gross_pay = ?, tax_deduction = ?, social_deduction = ?, health_deduction = ?, other_deductions = ?, net_pay = ?,
             direct_deposit_ref = COALESCE(?, direct_deposit_ref),
             payment_method = COALESCE(?, payment_method),
             status = COALESCE(?, status)
         WHERE id = ?`
      )
      .run(
        gross,
        tax,
        soc,
        hlth,
        other,
        net,
        directDepositRef !== undefined ? String(directDepositRef).trim() : null,
        paymentMethod ? String(paymentMethod).trim() : null,
        ['generated', 'paid'].includes(status) ? status : null,
        id
      );

    // Recalculate parent payroll run totals
    const agg = (await db
      .prepare(
        `SELECT COUNT(*) AS cnt,
                COALESCE(SUM(gross_pay), 0) AS tg,
                COALESCE(SUM(tax_deduction + social_deduction + health_deduction + other_deductions), 0) AS td,
                COALESCE(SUM(net_pay), 0) AS tn
         FROM payslips WHERE payroll_run_id = ?`
      )
      .get(existing.payroll_run_id)) as { cnt: number; tg: number; td: number; tn: number };
    await db
      .prepare(`UPDATE payroll_runs SET total_gross = ?, total_deductions = ?, total_net = ?, employee_count = ? WHERE id = ?`)
      .run(Number(agg.tg.toFixed(2)), Number(agg.td.toFixed(2)), Number(agg.tn.toFixed(2)), agg.cnt, existing.payroll_run_id);

    res.json(await db.prepare('SELECT * FROM payslips WHERE id = ?').get(id));
  });

  router.delete('/hr/payslips/:id', authenticate, requirePermission('hr', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, payroll_run_id FROM payslips WHERE id = ?').get(id)) as
      | { ref: string; payroll_run_id: number }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Payslip not found.' });
      return;
    }
    await db.prepare('DELETE FROM payslips WHERE id = ?').run(id);
    const agg = (await db
      .prepare(
        `SELECT COUNT(*) AS cnt,
                COALESCE(SUM(gross_pay), 0) AS tg,
                COALESCE(SUM(tax_deduction + social_deduction + health_deduction + other_deductions), 0) AS td,
                COALESCE(SUM(net_pay), 0) AS tn
         FROM payslips WHERE payroll_run_id = ?`
      )
      .get(existing.payroll_run_id)) as { cnt: number; tg: number; td: number; tn: number };
    await db
      .prepare(`UPDATE payroll_runs SET total_gross = ?, total_deductions = ?, total_net = ?, employee_count = ? WHERE id = ?`)
      .run(Number(agg.tg.toFixed(2)), Number(agg.td.toFixed(2)), Number(agg.tn.toFixed(2)), agg.cnt, existing.payroll_run_id);
    res.json({ ok: true });
  });

  router.post('/hr/benefit-plans', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const {
      name,
      provider = '',
      category = 'Health Insurance',
      employerContribution = 0,
      employeeContribution = 0,
      description = '',
      status = 'active',
    } = req.body ?? {};
    if (!String(name ?? '').trim()) {
      res.status(400).json({ error: 'Benefit plan name is required.' });
      return;
    }
    const ref = await seqRef('benefit_plans', 'BEN');
    const info = await db
      .prepare(
        `INSERT INTO benefit_plans (ref, name, provider, category, employer_contribution, employee_contribution, description, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        ref,
        String(name).trim(),
        String(provider).trim(),
        String(category).trim(),
        Math.max(0, Number(employerContribution) || 0),
        Math.max(0, Number(employeeContribution) || 0),
        String(description).trim(),
        status === 'archived' ? 'archived' : 'active'
      );
    res.status(201).json(await db.prepare('SELECT * FROM benefit_plans WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/hr/benefit-plans/:id', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM benefit_plans WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Benefit plan not found.' });
      return;
    }
    const { name, provider, category, employerContribution, employeeContribution, description, status } = req.body ?? {};
    await db
      .prepare(
        `UPDATE benefit_plans
         SET name = COALESCE(?, name),
             provider = COALESCE(?, provider),
             category = COALESCE(?, category),
             employer_contribution = COALESCE(?, employer_contribution),
             employee_contribution = COALESCE(?, employee_contribution),
             description = COALESCE(?, description),
             status = COALESCE(?, status)
         WHERE id = ?`
      )
      .run(
        name ? String(name).trim() : null,
        provider !== undefined ? String(provider).trim() : null,
        category ? String(category).trim() : null,
        employerContribution !== undefined ? Math.max(0, Number(employerContribution) || 0) : null,
        employeeContribution !== undefined ? Math.max(0, Number(employeeContribution) || 0) : null,
        description !== undefined ? String(description).trim() : null,
        ['active', 'archived'].includes(status) ? status : null,
        id
      );
    res.json(await db.prepare('SELECT * FROM benefit_plans WHERE id = ?').get(id));
  });

  router.delete('/hr/benefit-plans/:id', authenticate, requirePermission('hr', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM benefit_plans WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Benefit plan not found.' });
      return;
    }
    await db.prepare('DELETE FROM benefit_plans WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  router.post('/hr/benefit-enrollments', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const { employeeId, planId, coverageTier = 'Employee Only', enrollmentDate, status = 'active', notes = '' } = req.body ?? {};
    if (!employeeId || !planId) {
      res.status(400).json({ error: 'Employee and benefit plan are required.' });
      return;
    }
    const info = await db
      .prepare(
        `INSERT INTO benefit_enrollments (employee_id, plan_id, coverage_tier, enrollment_date, status, notes)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        Number(employeeId),
        Number(planId),
        String(coverageTier).trim(),
        String(enrollmentDate || new Date().toISOString().slice(0, 10)),
        ['pending', 'active', 'cancelled'].includes(status) ? status : 'active',
        String(notes).trim()
      );
    res.status(201).json(await db.prepare('SELECT * FROM benefit_enrollments WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/hr/benefit-enrollments/:id', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT id FROM benefit_enrollments WHERE id = ?').get(id)) as { id: number } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Benefit enrollment not found.' });
      return;
    }
    const { employeeId, planId, coverageTier, enrollmentDate, status, notes } = req.body ?? {};
    await db
      .prepare(
        `UPDATE benefit_enrollments
         SET employee_id = COALESCE(?, employee_id),
             plan_id = COALESCE(?, plan_id),
             coverage_tier = COALESCE(?, coverage_tier),
             enrollment_date = COALESCE(?, enrollment_date),
             status = COALESCE(?, status),
             notes = COALESCE(?, notes)
         WHERE id = ?`
      )
      .run(
        employeeId !== undefined ? Number(employeeId) : null,
        planId !== undefined ? Number(planId) : null,
        coverageTier ? String(coverageTier).trim() : null,
        enrollmentDate ? String(enrollmentDate) : null,
        ['pending', 'active', 'cancelled'].includes(status) ? status : null,
        notes !== undefined ? String(notes).trim() : null,
        id
      );
    res.json(await db.prepare('SELECT * FROM benefit_enrollments WHERE id = ?').get(id));
  });

  router.delete('/hr/benefit-enrollments/:id', authenticate, requirePermission('hr', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT id FROM benefit_enrollments WHERE id = ?').get(id)) as { id: number } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Benefit enrollment not found.' });
      return;
    }
    await db.prepare('DELETE FROM benefit_enrollments WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  router.post('/expense-reports', authenticate, requirePermission('hr', 'write'), async (req, res) => {
    const { employeeId, category = 'Travel', expenseDate, amount, taxAmount = 0, description = '' } = req.body ?? {};
    const amt = Number(amount);
    if (!employeeId || !Number.isFinite(amt) || amt <= 0) {
      res.status(400).json({ error: 'Employee and positive expense amount are required.' });
      return;
    }
    const ref = await seqRef('expense_reports', 'EXP');
    const info = await db
      .prepare(
        `INSERT INTO expense_reports (ref, employee_id, category, expense_date, amount, tax_amount, description, status, approved_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', '')`
      )
      .run(ref, Number(employeeId), String(category).trim(), String(expenseDate || new Date().toISOString().slice(0, 10)), amt, Number(taxAmount) || 0, String(description).trim());
    res.status(201).json(await db.prepare('SELECT * FROM expense_reports WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/expense-reports/:id', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM expense_reports WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Expense report not found.' });
      return;
    }
    const { employeeId, category, expenseDate, amount, taxAmount, description } = req.body ?? {};
    await db
      .prepare(
        `UPDATE expense_reports
         SET employee_id = COALESCE(?, employee_id),
             category = COALESCE(?, category),
             expense_date = COALESCE(?, expense_date),
             amount = COALESCE(?, amount),
             tax_amount = COALESCE(?, tax_amount),
             description = COALESCE(?, description)
         WHERE id = ?`
      )
      .run(
        employeeId !== undefined ? Number(employeeId) : null,
        category ? String(category).trim() : null,
        expenseDate ? String(expenseDate) : null,
        amount !== undefined ? Number(amount) : null,
        taxAmount !== undefined ? Number(taxAmount) : null,
        description !== undefined ? String(description).trim() : null,
        id
      );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_EXPENSE_REPORT',
      module: 'hr',
      entityRef: existing.ref,
      details: `Updated expense report ${existing.ref}`,
      ipAddress: getClientIp(req),
    });
    res.json(await db.prepare('SELECT * FROM expense_reports WHERE id = ?').get(id));
  });

  router.delete('/expense-reports/:id', authenticate, requirePermission('hr', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM expense_reports WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Expense report not found.' });
      return;
    }
    await db.prepare('DELETE FROM expense_reports WHERE id = ?').run(id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_EXPENSE_REPORT',
      module: 'hr',
      entityRef: existing.ref,
      details: `Deleted expense report ${existing.ref}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    });
    res.json({ ok: true });
  });

  router.post('/expense-reports/:id/decide', authenticate, requirePermission('hr', 'validate'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const { status } = req.body ?? {};
    if (!['approved', 'paid', 'rejected'].includes(status)) {
      res.status(400).json({ error: 'Invalid expense status.' });
      return;
    }
    await db.prepare('UPDATE expense_reports SET status = ?, approved_by = ? WHERE id = ?').run(status, req.authUser!.email, id);
    res.json(await db.prepare('SELECT * FROM expense_reports WHERE id = ?').get(id));
  });

  router.post('/recruitment/jobs', authenticate, requirePermission('hr', 'write'), async (req, res) => {
    const { title, department = 'Engineering', location = 'Remote / HQ', contractType = 'Full-Time', description = '' } = req.body ?? {};
    if (!String(title ?? '').trim()) {
      res.status(400).json({ error: 'Job title is required.' });
      return;
    }
    const ref = await seqRef('job_postings', 'JOB');
    const info = await db
      .prepare(
        `INSERT INTO job_postings (ref, title, department, location, contract_type, status, description)
         VALUES (?, ?, ?, ?, ?, 'open', ?)`
      )
      .run(ref, String(title).trim(), String(department).trim(), String(location).trim(), String(contractType).trim(), String(description).trim());
    res.status(201).json(await db.prepare('SELECT * FROM job_postings WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/recruitment/jobs/:id', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM job_postings WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Job posting not found.' });
      return;
    }
    const { title, department, location, contractType, status, description } = req.body ?? {};
    await db
      .prepare(
        `UPDATE job_postings
         SET title = COALESCE(?, title),
             department = COALESCE(?, department),
             location = COALESCE(?, location),
             contract_type = COALESCE(?, contract_type),
             status = COALESCE(?, status),
             description = COALESCE(?, description)
         WHERE id = ?`
      )
      .run(
        title ? String(title).trim() : null,
        department ? String(department).trim() : null,
        location !== undefined ? String(location).trim() : null,
        contractType ? String(contractType).trim() : null,
        ['draft', 'open', 'closed'].includes(status) ? status : null,
        description !== undefined ? String(description).trim() : null,
        id
      );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_JOB_POSTING',
      module: 'hr',
      entityRef: existing.ref,
      details: `Updated job posting ${existing.ref}`,
      ipAddress: getClientIp(req),
    });
    res.json(await db.prepare('SELECT * FROM job_postings WHERE id = ?').get(id));
  });

  router.delete('/recruitment/jobs/:id', authenticate, requirePermission('hr', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, title FROM job_postings WHERE id = ?').get(id)) as
      | { ref: string; title: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Job posting not found.' });
      return;
    }
    await db.prepare('DELETE FROM job_postings WHERE id = ?').run(id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_JOB_POSTING',
      module: 'hr',
      entityRef: existing.ref,
      details: `Deleted job posting ${existing.title}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    });
    res.json({ ok: true });
  });

  router.post('/recruitment/candidates', authenticate, requirePermission('hr', 'write'), async (req, res) => {
    const { jobId, fullName, email, phone = '', stage = 'applied', notes = '' } = req.body ?? {};
    if (!jobId || !String(fullName ?? '').trim() || !String(email ?? '').trim()) {
      res.status(400).json({ error: 'Job posting, candidate name, and email are required.' });
      return;
    }
    const info = await db
      .prepare(`INSERT INTO candidates (job_id, full_name, email, phone, stage, notes) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(Number(jobId), String(fullName).trim(), String(email).trim(), String(phone).trim(), stage, String(notes).trim());
    res.status(201).json(await db.prepare('SELECT * FROM candidates WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/recruitment/candidates/:id', authenticate, async (req: AuthenticatedReq, res) => {
    if (!hasPermission(req.authPermissions, 'hr', 'write') && !hasPermission(req.authPermissions, 'hr', 'validate')) {
      res.status(403).json({ error: 'Permission required to update candidates.' });
      return;
    }
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT full_name FROM candidates WHERE id = ?').get(id)) as { full_name: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Candidate not found.' });
      return;
    }
    const { jobId, fullName, email, phone, stage, notes } = req.body ?? {};
    if (stage !== undefined && !['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'].includes(stage)) {
      res.status(400).json({ error: 'Invalid candidate stage.' });
      return;
    }
    await db
      .prepare(
        `UPDATE candidates
         SET job_id = COALESCE(?, job_id),
             full_name = COALESCE(?, full_name),
             email = COALESCE(?, email),
             phone = COALESCE(?, phone),
             stage = COALESCE(?, stage),
             notes = COALESCE(?, notes)
         WHERE id = ?`
      )
      .run(
        jobId !== undefined ? Number(jobId) : null,
        fullName ? String(fullName).trim() : null,
        email ? String(email).trim() : null,
        phone !== undefined ? String(phone).trim() : null,
        stage ?? null,
        notes !== undefined ? String(notes).trim() : null,
        id
      );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_CANDIDATE',
      module: 'hr',
      entityRef: `CND-${id}`,
      details: `Updated candidate ${fullName ?? existing.full_name}`,
      ipAddress: getClientIp(req),
    });
    res.json(await db.prepare('SELECT * FROM candidates WHERE id = ?').get(id));
  });

  router.delete('/recruitment/candidates/:id', authenticate, requirePermission('hr', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT full_name FROM candidates WHERE id = ?').get(id)) as { full_name: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Candidate not found.' });
      return;
    }
    await db.prepare('DELETE FROM candidates WHERE id = ?').run(id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_CANDIDATE',
      module: 'hr',
      entityRef: `CND-${id}`,
      details: `Deleted candidate ${existing.full_name}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    });
    res.json({ ok: true });
  });

  // --- Onboarding Checklists ---
  router.post('/hr/onboarding', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const {
      employeeId = null,
      candidateId = null,
      taskTitle,
      category = 'Identity & Tax Forms',
      dueDate,
      assigneeName = 'HR Operations',
      status = 'pending',
      notes = '',
    } = req.body ?? {};
    if (!String(taskTitle ?? '').trim()) {
      res.status(400).json({ error: 'Onboarding task title is required.' });
      return;
    }
    const ref = await seqRef('onboarding_tasks', 'ONB');
    const info = await db
      .prepare(
        `INSERT INTO onboarding_tasks (ref, employee_id, candidate_id, task_title, category, due_date, assignee_name, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        ref,
        employeeId ? Number(employeeId) : null,
        candidateId ? Number(candidateId) : null,
        String(taskTitle).trim(),
        String(category).trim(),
        String(dueDate || new Date().toISOString().slice(0, 10)),
        String(assigneeName).trim(),
        ['pending', 'in_progress', 'completed'].includes(status) ? status : 'pending',
        String(notes).trim()
      );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_ONBOARDING_TASK',
      module: 'hr',
      entityRef: ref,
      details: `Created onboarding task ${taskTitle}`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json(await db.prepare('SELECT * FROM onboarding_tasks WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/hr/onboarding/:id', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, employee_id, candidate_id FROM onboarding_tasks WHERE id = ?').get(id)) as
      | { ref: string; employee_id: number | null; candidate_id: number | null }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Onboarding task not found.' });
      return;
    }
    const { employeeId, candidateId, taskTitle, category, dueDate, assigneeName, status, notes } = req.body ?? {};
    const nextEmpId = employeeId === '' || employeeId === null ? null : employeeId !== undefined ? Number(employeeId) : existing.employee_id;
    const nextCandId = candidateId === '' || candidateId === null ? null : candidateId !== undefined ? Number(candidateId) : existing.candidate_id;
    await db
      .prepare(
        `UPDATE onboarding_tasks
         SET employee_id = ?,
             candidate_id = ?,
             task_title = COALESCE(?, task_title),
             category = COALESCE(?, category),
             due_date = COALESCE(?, due_date),
             assignee_name = COALESCE(?, assignee_name),
             status = COALESCE(?, status),
             notes = COALESCE(?, notes)
         WHERE id = ?`
      )
      .run(
        nextEmpId,
        nextCandId,
        taskTitle ? String(taskTitle).trim() : null,
        category ? String(category).trim() : null,
        dueDate ? String(dueDate) : null,
        assigneeName ? String(assigneeName).trim() : null,
        ['pending', 'in_progress', 'completed'].includes(status) ? status : null,
        notes !== undefined ? String(notes).trim() : null,
        id
      );
    res.json(await db.prepare('SELECT * FROM onboarding_tasks WHERE id = ?').get(id));
  });

  router.delete('/hr/onboarding/:id', authenticate, requirePermission('hr', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM onboarding_tasks WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Onboarding task not found.' });
      return;
    }
    await db.prepare('DELETE FROM onboarding_tasks WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // --- KPI Evaluations ---
  router.post('/hr/kpi-evaluations', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const {
      employeeId,
      evaluatorName = req.authUser!.full_name || req.authUser!.email,
      reviewPeriod = '2026-Q4',
      periodStart = '',
      periodEnd = '',
      metrics = [],
      strengths = '',
      improvementPlan = '',
      employeeComments = '',
      status = 'draft',
    } = req.body ?? {};
    if (!employeeId || !String(reviewPeriod).trim()) {
      res.status(400).json({ error: 'Employee and review period are required.' });
      return;
    }
    const { metricsJson, overallScore, ratingLabel } = computeKpiSummary(metrics);
    const validStatus = ['draft', 'self_review', 'submitted', 'approved'].includes(status) ? status : 'draft';
    const ref = await seqRef('kpi_evaluations', 'KPI');
    const info = await db
      .prepare(
        `INSERT INTO kpi_evaluations (ref, employee_id, evaluator_name, review_period, period_start, period_end, metrics_json, overall_score, rating_label, strengths, improvement_plan, employee_comments, status, reviewed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        ref,
        Number(employeeId),
        String(evaluatorName).trim(),
        String(reviewPeriod).trim(),
        String(periodStart),
        String(periodEnd),
        metricsJson,
        overallScore,
        ratingLabel,
        String(strengths).trim(),
        String(improvementPlan).trim(),
        String(employeeComments).trim(),
        validStatus,
        validStatus === 'approved' ? req.authUser!.email : ''
      );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_KPI_EVALUATION',
      module: 'hr',
      entityRef: ref,
      details: `Created KPI scorecard ${ref} (${overallScore}%) for employee #${employeeId}`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json(await db.prepare('SELECT * FROM kpi_evaluations WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/hr/kpi-evaluations/:id', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM kpi_evaluations WHERE id = ?').get(id)) as
      | { ref: string; metrics_json: string; overall_score: number; rating_label: string; status: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'KPI evaluation not found.' });
      return;
    }
    const {
      employeeId,
      evaluatorName,
      reviewPeriod,
      periodStart,
      periodEnd,
      metrics,
      strengths,
      improvementPlan,
      employeeComments,
      status,
    } = req.body ?? {};
    const summary =
      metrics !== undefined
        ? computeKpiSummary(metrics)
        : {
            metricsJson: existing.metrics_json,
            overallScore: existing.overall_score,
            ratingLabel: existing.rating_label,
          };
    const nextStatus = ['draft', 'self_review', 'submitted', 'approved'].includes(status) ? status : existing.status;
    await db
      .prepare(
        `UPDATE kpi_evaluations
         SET employee_id = COALESCE(?, employee_id),
             evaluator_name = COALESCE(?, evaluator_name),
             review_period = COALESCE(?, review_period),
             period_start = COALESCE(?, period_start),
             period_end = COALESCE(?, period_end),
             metrics_json = ?,
             overall_score = ?,
             rating_label = ?,
             strengths = COALESCE(?, strengths),
             improvement_plan = COALESCE(?, improvement_plan),
             employee_comments = COALESCE(?, employee_comments),
             status = ?,
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        employeeId !== undefined ? Number(employeeId) : null,
        evaluatorName !== undefined ? String(evaluatorName).trim() : null,
        reviewPeriod ? String(reviewPeriod).trim() : null,
        periodStart !== undefined ? String(periodStart) : null,
        periodEnd !== undefined ? String(periodEnd) : null,
        summary.metricsJson,
        summary.overallScore,
        summary.ratingLabel,
        strengths !== undefined ? String(strengths).trim() : null,
        improvementPlan !== undefined ? String(improvementPlan).trim() : null,
        employeeComments !== undefined ? String(employeeComments).trim() : null,
        nextStatus,
        id
      );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_KPI_EVALUATION',
      module: 'hr',
      entityRef: existing.ref,
      details: `Updated KPI evaluation ${existing.ref} (${summary.overallScore}%)`,
      ipAddress: getClientIp(req),
    });
    res.json(await db.prepare('SELECT * FROM kpi_evaluations WHERE id = ?').get(id));
  });

  router.post('/hr/kpi-evaluations/:id/decide', authenticate, requirePermission('hr', 'validate'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const { status = 'approved' } = req.body ?? {};
    if (!['self_review', 'submitted', 'approved'].includes(status)) {
      res.status(400).json({ error: 'Invalid KPI evaluation status.' });
      return;
    }
    const existing = (await db.prepare('SELECT ref FROM kpi_evaluations WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'KPI evaluation not found.' });
      return;
    }
    await db
      .prepare(`UPDATE kpi_evaluations SET status = ?, reviewed_by = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(status, status === 'approved' ? req.authUser!.email : '', id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'FINALIZE_KPI_EVALUATION',
      module: 'hr',
      entityRef: existing.ref,
      details: `Marked KPI evaluation ${existing.ref} as ${status}`,
      ipAddress: getClientIp(req),
    });
    res.json(await db.prepare('SELECT * FROM kpi_evaluations WHERE id = ?').get(id));
  });

  router.delete('/hr/kpi-evaluations/:id', authenticate, requirePermission('hr', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM kpi_evaluations WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'KPI evaluation not found.' });
      return;
    }
    await db.prepare('DELETE FROM kpi_evaluations WHERE id = ?').run(id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_KPI_EVALUATION',
      module: 'hr',
      entityRef: existing.ref,
      details: `Deleted KPI evaluation ${existing.ref}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    });
    res.json({ ok: true });
  });

  // --- HR Compliance & Reporting ---
  router.post('/hr/compliance', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const {
      title,
      category = 'Labor Law',
      jurisdiction = 'Federal / State',
      dueDate,
      ownerName = 'HR Compliance',
      complianceRate = 100,
      status = 'compliant',
      notes = '',
    } = req.body ?? {};
    if (!String(title ?? '').trim()) {
      res.status(400).json({ error: 'Compliance item title is required.' });
      return;
    }
    const ref = await seqRef('hr_compliance_records', 'CMP');
    const info = await db
      .prepare(
        `INSERT INTO hr_compliance_records (ref, title, category, jurisdiction, due_date, owner_name, compliance_rate, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        ref,
        String(title).trim(),
        String(category).trim(),
        String(jurisdiction).trim(),
        String(dueDate || new Date().toISOString().slice(0, 10)),
        String(ownerName).trim(),
        Math.max(0, Math.min(100, Number(complianceRate) || 0)),
        ['compliant', 'due_soon', 'action_required'].includes(status) ? status : 'compliant',
        String(notes).trim()
      );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_HR_COMPLIANCE',
      module: 'hr',
      entityRef: ref,
      details: `Created HR compliance item ${title}`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json(await db.prepare('SELECT * FROM hr_compliance_records WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/hr/compliance/:id', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM hr_compliance_records WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Compliance record not found.' });
      return;
    }
    const { title, category, jurisdiction, dueDate, ownerName, complianceRate, status, notes } = req.body ?? {};
    await db
      .prepare(
        `UPDATE hr_compliance_records
         SET title = COALESCE(?, title),
             category = COALESCE(?, category),
             jurisdiction = COALESCE(?, jurisdiction),
             due_date = COALESCE(?, due_date),
             owner_name = COALESCE(?, owner_name),
             compliance_rate = COALESCE(?, compliance_rate),
             status = COALESCE(?, status),
             notes = COALESCE(?, notes)
         WHERE id = ?`
      )
      .run(
        title ? String(title).trim() : null,
        category ? String(category).trim() : null,
        jurisdiction ? String(jurisdiction).trim() : null,
        dueDate ? String(dueDate) : null,
        ownerName ? String(ownerName).trim() : null,
        complianceRate !== undefined ? Math.max(0, Math.min(100, Number(complianceRate) || 0)) : null,
        ['compliant', 'due_soon', 'action_required'].includes(status) ? status : null,
        notes !== undefined ? String(notes).trim() : null,
        id
      );
    res.json(await db.prepare('SELECT * FROM hr_compliance_records WHERE id = ?').get(id));
  });

  router.delete('/hr/compliance/:id', authenticate, requirePermission('hr', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM hr_compliance_records WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Compliance record not found.' });
      return;
    }
    await db.prepare('DELETE FROM hr_compliance_records WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  router.get('/hr/compliance/export', authenticate, requirePermission('hr', 'read'), async (req: AuthenticatedReq, res) => {
    const rows = (await db.prepare('SELECT * FROM hr_compliance_records ORDER BY due_date ASC').all()) as Array<{
      ref: string;
      title: string;
      category: string;
      jurisdiction: string;
      due_date: string;
      owner_name: string;
      compliance_rate: number;
      status: string;
      notes: string;
    }>;
    const header = ['Ref', 'Title', 'Category', 'Jurisdiction', 'Due Date', 'Owner', 'Compliance %', 'Status', 'Notes']
      .map(sanitizeCsvCell)
      .join(',');
    const lines = rows.map((r) =>
      [r.ref, r.title, r.category, r.jurisdiction, r.due_date, r.owner_name, r.compliance_rate, r.status, r.notes]
        .map(sanitizeCsvCell)
        .join(',')
    );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'EXPORT_HR_COMPLIANCE',
      module: 'hr',
      entityRef: 'hr_compliance_records',
      details: `Exported ${rows.length} HR compliance record(s)`,
      ipAddress: getClientIp(req),
    });
    res.json({
      count: rows.length,
      filename: 'hr-compliance-report.csv',
      csv: [header, ...lines].join('\r\n'),
    });
  });

  router.post('/timesheets', authenticate, requirePermission('hr', 'write'), async (req, res) => {
    const { employeeId, projectId = null, workDate, hours = 8, taskLabel = '', billable = true } = req.body ?? {};
    if (!employeeId || !Number.isFinite(Number(hours)) || Number(hours) <= 0) {
      res.status(400).json({ error: 'Employee and positive hours are required.' });
      return;
    }
    const info = await db
      .prepare(`INSERT INTO timesheets (employee_id, project_id, work_date, hours, task_label, billable) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        Number(employeeId),
        projectId ? Number(projectId) : null,
        String(workDate || new Date().toISOString().slice(0, 10)),
        Number(hours),
        String(taskLabel).trim(),
        billable ? 1 : 0
      );
    res.status(201).json(await db.prepare('SELECT * FROM timesheets WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/timesheets/:id', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT project_id FROM timesheets WHERE id = ?').get(id)) as
      | { project_id: number | null }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Timesheet entry not found.' });
      return;
    }
    const { employeeId, projectId, workDate, hours, taskLabel, billable } = req.body ?? {};
    const nextProjectId =
      projectId === '' || projectId === null
        ? null
        : projectId !== undefined
          ? Number(projectId)
          : existing.project_id;
    await db
      .prepare(
        `UPDATE timesheets
         SET employee_id = COALESCE(?, employee_id),
             project_id = ?,
             work_date = COALESCE(?, work_date),
             hours = COALESCE(?, hours),
             task_label = COALESCE(?, task_label),
             billable = COALESCE(?, billable)
         WHERE id = ?`
      )
      .run(
        employeeId !== undefined ? Number(employeeId) : null,
        nextProjectId,
        workDate ? String(workDate) : null,
        hours !== undefined ? Math.max(0.25, Number(hours) || 1) : null,
        taskLabel !== undefined ? String(taskLabel).trim() : null,
        billable !== undefined ? (billable ? 1 : 0) : null,
        id
      );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_TIMESHEET',
      module: 'hr',
      entityRef: `TS-${id}`,
      details: `Updated timesheet entry #${id}`,
      ipAddress: getClientIp(req),
    });
    res.json(await db.prepare('SELECT * FROM timesheets WHERE id = ?').get(id));
  });

  router.delete('/timesheets/:id', authenticate, requirePermission('hr', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT task_label FROM timesheets WHERE id = ?').get(id)) as { task_label: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Timesheet entry not found.' });
      return;
    }
    await db.prepare('DELETE FROM timesheets WHERE id = ?').run(id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_TIMESHEET',
      module: 'hr',
      entityRef: `TS-${id}`,
      details: `Deleted timesheet entry #${id}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    });
    res.json({ ok: true });
  });

  // ========================
  // WORKSPACE TOOLS (EDM, BOOKMARKS, MASS MAIL, COLLECTOR, DATA CSV, INTEGRATIONS, AI)
  // ========================
  router.get('/tools', authenticate, requirePermission('tools', 'read'), async (_req, res) => {
    const documents = (await db.prepare('SELECT * FROM edm_documents ORDER BY id DESC').all());
    const bookmarks = (await db.prepare('SELECT * FROM bookmarks ORDER BY id DESC').all());
    const campaigns = (await db.prepare('SELECT * FROM email_campaigns ORDER BY id DESC').all());
    const collectedEmails = (await db.prepare('SELECT * FROM collected_emails ORDER BY id DESC').all());
    res.json({ documents, bookmarks, campaigns, collectedEmails });
  });

  router.post('/edm-documents', authenticate, requirePermission('tools', 'write'), async (req: AuthenticatedReq, res) => {
    const { title, folder = 'General', mimeType = 'text/plain', tags = '', contentText = '' } = req.body ?? {};
    if (!String(title ?? '').trim()) {
      res.status(400).json({ error: 'Document title is required.' });
      return;
    }
    const ref = (await seqRef('edm_documents', 'DOC'));
    const body = String(contentText ?? '');
    const info = (await db
      .prepare(
        `INSERT INTO edm_documents (ref, title, folder, mime_type, size_bytes, tags, content_text, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(ref, String(title).trim(), String(folder).trim(), String(mimeType).trim(), Buffer.byteLength(body, 'utf8'), String(tags).trim(), body, req.authUser!.email));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPLOAD_EDM_DOCUMENT',
      module: 'tools',
      entityRef: ref,
      details: `Stored EDM document ${title}`,
      ipAddress: getClientIp(req),
    }));
    res.status(201).json((await db.prepare('SELECT * FROM edm_documents WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/edm-documents/:id', authenticate, requirePermission('tools', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, content_text FROM edm_documents WHERE id = ?').get(id)) as
      | { ref: string; content_text: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }
    const { title, folder, mimeType, tags, contentText } = req.body ?? {};
    const body = contentText !== undefined ? String(contentText) : existing.content_text;
    (await db.prepare(
      `UPDATE edm_documents
       SET title = COALESCE(?, title),
           folder = COALESCE(?, folder),
           mime_type = COALESCE(?, mime_type),
           size_bytes = ?,
           tags = COALESCE(?, tags),
           content_text = ?
       WHERE id = ?`
    ).run(
      title ? String(title).trim() : null,
      folder ? String(folder).trim() : null,
      mimeType ? String(mimeType).trim() : null,
      Buffer.byteLength(body, 'utf8'),
      tags !== undefined ? String(tags).trim() : null,
      body,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_EDM_DOCUMENT',
      module: 'tools',
      entityRef: existing.ref,
      details: `Updated EDM document ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM edm_documents WHERE id = ?').get(id)));
  });

  router.delete('/edm-documents/:id', authenticate, requirePermission('tools', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const doc = (await db.prepare('SELECT ref, title FROM edm_documents WHERE id = ?').get(id)) as { ref: string; title: string } | undefined;
    if (!doc) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }
    (await db.prepare('DELETE FROM edm_documents WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_EDM_DOCUMENT',
      module: 'tools',
      entityRef: doc.ref,
      details: `Deleted EDM document ${doc.title}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.post('/bookmarks', authenticate, requirePermission('tools', 'write'), async (req: AuthenticatedReq, res) => {
    const { title, url, category = 'ERP Shortcuts' } = req.body ?? {};
    if (!String(title ?? '').trim() || !isValidHttpUrl(String(url ?? '').trim())) {
      res.status(400).json({ error: 'Title and a valid http:// or https:// URL are required.' });
      return;
    }
    const info = (await db
      .prepare(`INSERT INTO bookmarks (title, url, category, created_by) VALUES (?, ?, ?, ?)`)
      .run(String(title).trim(), String(url).trim(), String(category).trim(), req.authUser!.email));
    res.status(201).json((await db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/bookmarks/:id', authenticate, requirePermission('tools', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT id FROM bookmarks WHERE id = ?').get(id)) as { id: number } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Bookmark not found.' });
      return;
    }
    const { title, url, category } = req.body ?? {};
    if (url !== undefined && !isValidHttpUrl(String(url).trim())) {
      res.status(400).json({ error: 'Valid http:// or https:// URL is required.' });
      return;
    }
    (await db.prepare(
      `UPDATE bookmarks
       SET title = COALESCE(?, title),
           url = COALESCE(?, url),
           category = COALESCE(?, category)
       WHERE id = ?`
    ).run(
      title ? String(title).trim() : null,
      url ? String(url).trim() : null,
      category ? String(category).trim() : null,
      id
    ));
    res.json((await db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(id)));
  });

  router.delete('/bookmarks/:id', authenticate, requirePermission('tools', 'delete'), async (req, res) => {
    (await db.prepare('DELETE FROM bookmarks WHERE id = ?').run(Number(req.params.id)));
    res.json({ ok: true });
  });

  router.post('/email-campaigns', authenticate, requirePermission('tools', 'write'), async (req: AuthenticatedReq, res) => {
    const { subject, targetSegment = 'all_customers', bodyText } = req.body ?? {};
    if (!String(subject ?? '').trim() || !String(bodyText ?? '').trim()) {
      res.status(400).json({ error: 'Subject and campaign body are required.' });
      return;
    }
    const ref = (await seqRef('email_campaigns', 'CMP'));
    const info = (await db
      .prepare(
        `INSERT INTO email_campaigns (ref, subject, target_segment, body_text, recipient_count, status, sent_at, created_by)
         VALUES (?, ?, ?, ?, 0, 'draft', '', ?)`
      )
      .run(ref, String(subject).trim(), String(targetSegment).trim(), String(bodyText).trim(), req.authUser!.email));
    res.status(201).json((await db.prepare('SELECT * FROM email_campaigns WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/email-campaigns/:id', authenticate, requirePermission('tools', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM email_campaigns WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Campaign not found.' });
      return;
    }
    const { subject, targetSegment, bodyText } = req.body ?? {};
    (await db.prepare(
      `UPDATE email_campaigns
       SET subject = COALESCE(?, subject),
           target_segment = COALESCE(?, target_segment),
           body_text = COALESCE(?, body_text)
       WHERE id = ?`
    ).run(
      subject ? String(subject).trim() : null,
      targetSegment ? String(targetSegment).trim() : null,
      bodyText !== undefined ? String(bodyText).trim() : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_EMAIL_CAMPAIGN',
      module: 'tools',
      entityRef: existing.ref,
      details: `Updated campaign ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM email_campaigns WHERE id = ?').get(id)));
  });

  router.delete('/email-campaigns/:id', authenticate, requirePermission('tools', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, subject FROM email_campaigns WHERE id = ?').get(id)) as
      | { ref: string; subject: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Campaign not found.' });
      return;
    }
    (await db.prepare('DELETE FROM email_campaigns WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_EMAIL_CAMPAIGN',
      module: 'tools',
      entityRef: existing.ref,
      details: `Deleted campaign ${existing.subject}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.post('/email-campaigns/:id/send', authenticate, requirePermission('tools', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const camp = (await db.prepare('SELECT * FROM email_campaigns WHERE id = ?').get(id)) as
      | { id: number; ref: string; target_segment: string; subject: string }
      | undefined;
    if (!camp) {
      res.status(404).json({ error: 'Campaign not found.' });
      return;
    }
    let count = 0;
    if (camp.target_segment === 'all_members') {
      count = ((await db.prepare(`SELECT COUNT(*) AS cnt FROM members WHERE email != ''`).get()) as { cnt: number }).cnt;
    } else if (camp.target_segment === 'prospects') {
      count = ((await db.prepare(`SELECT COUNT(*) AS cnt FROM third_parties WHERE party_type = 'prospect' AND email != ''`).get()) as { cnt: number }).cnt;
    } else {
      count = ((await db.prepare(`SELECT COUNT(*) AS cnt FROM third_parties WHERE party_type IN ('customer', 'customer_supplier') AND email != ''`).get()) as { cnt: number }).cnt;
    }
    (await db.prepare(`UPDATE email_campaigns SET status = 'sent', recipient_count = ?, sent_at = ? WHERE id = ?`).run(
      count,
      new Date().toISOString(),
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'SEND_MASS_EMAIL',
      module: 'tools',
      entityRef: camp.ref,
      details: `Dispatched campaign ${camp.ref} (${camp.subject}) to ${count} recipient(s)`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM email_campaigns WHERE id = ?').get(id)));
  });

  router.post('/collected-emails', authenticate, requirePermission('tools', 'write'), async (req, res) => {
    const { senderEmail, subject, snippet } = req.body ?? {};
    if (!String(senderEmail ?? '').trim() || !String(subject ?? '').trim()) {
      res.status(400).json({ error: 'Sender email and subject are required.' });
      return;
    }
    const matched = (await db
      .prepare(`SELECT name FROM third_parties WHERE LOWER(email) = LOWER(?) LIMIT 1`)
      .get(String(senderEmail).trim())) as { name: string } | undefined;
    const info = (await db
      .prepare(`INSERT INTO collected_emails (sender_email, subject, snippet, matched_party, status) VALUES (?, ?, ?, ?, 'unprocessed')`)
      .run(String(senderEmail).trim(), String(subject).trim(), String(snippet ?? '').trim(), matched?.name ?? ''));
    res.status(201).json((await db.prepare('SELECT * FROM collected_emails WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/collected-emails/:id', authenticate, requirePermission('tools', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT id FROM collected_emails WHERE id = ?').get(id)) as { id: number } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Collected email not found.' });
      return;
    }
    const { senderEmail, subject, snippet, status } = req.body ?? {};
    const matched = senderEmail
      ? ((await db.prepare(`SELECT name FROM third_parties WHERE LOWER(email) = LOWER(?) LIMIT 1`).get(String(senderEmail).trim())) as
          | { name: string }
          | undefined)
      : undefined;
    (await db.prepare(
      `UPDATE collected_emails
       SET sender_email = COALESCE(?, sender_email),
           subject = COALESCE(?, subject),
           snippet = COALESCE(?, snippet),
           matched_party = COALESCE(?, matched_party),
           status = COALESCE(?, status)
       WHERE id = ?`
    ).run(
      senderEmail ? String(senderEmail).trim() : null,
      subject ? String(subject).trim() : null,
      snippet !== undefined ? String(snippet).trim() : null,
      senderEmail ? (matched?.name ?? '') : null,
      ['unprocessed', 'converted_ticket', 'archived'].includes(status) ? status : null,
      id
    ));
    res.json((await db.prepare('SELECT * FROM collected_emails WHERE id = ?').get(id)));
  });

  router.delete('/collected-emails/:id', authenticate, requirePermission('tools', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT subject FROM collected_emails WHERE id = ?').get(id)) as { subject: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Collected email not found.' });
      return;
    }
    (await db.prepare('DELETE FROM collected_emails WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_COLLECTED_EMAIL',
      module: 'tools',
      entityRef: `EML-${id}`,
      details: `Deleted collected email "${existing.subject}"`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.post('/collected-emails/:id/convert-ticket', authenticate, requirePermission('support', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const em = (await db.prepare('SELECT * FROM collected_emails WHERE id = ?').get(id)) as
      | { id: number; sender_email: string; subject: string; snippet: string }
      | undefined;
    if (!em) {
      res.status(404).json({ error: 'Collected email not found.' });
      return;
    }
    const party = (await db
      .prepare(`SELECT id FROM third_parties WHERE LOWER(email) = LOWER(?) LIMIT 1`)
      .get(em.sender_email)) as { id: number } | undefined;
    const tckRef = (await seqRef('tickets', 'TCK'));
    (await db.exec('BEGIN'));
    try {
      (await db.prepare(
        `INSERT INTO tickets (ref, third_party_id, subject, category, severity, status, assignee_name, message, replies_json, created_by)
         VALUES (?, ?, ?, 'Email Collector', 'normal', 'open', ?, ?, '[]', ?)`
      ).run(tckRef, party?.id ?? null, em.subject, req.authUser!.full_name, `From: ${em.sender_email}\n\n${em.snippet}`, req.authUser!.email));
      (await db.prepare(`UPDATE collected_emails SET status = 'converted_ticket' WHERE id = ?`).run(id));
      (await db.exec('COMMIT'));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'EMAIL_COLLECTOR_TO_TICKET',
        module: 'support',
        entityRef: tckRef,
        details: `Converted inbound email from ${em.sender_email} into ticket ${tckRef}`,
        ipAddress: getClientIp(req),
      }));
      res.status(201).json({ ticketRef: tckRef });
    } catch (err) {
      (await db.exec('ROLLBACK'));
      res.status(500).json({ error: err instanceof Error ? err.message : 'Conversion failed.' });
    }
  });

  router.get('/data/export-csv', authenticate, requirePermission('tools', 'export'), async (req: AuthenticatedReq, res) => {
    const dataset = String(req.query.dataset ?? 'third_parties');
    let rows: Array<Record<string, unknown>> = [];
    let headers: string[] = [];
    if (dataset === 'products') {
      headers = ['ref', 'name', 'product_type', 'category', 'cost_price', 'sell_price', 'tax_rate', 'min_stock', 'barcode'];
      rows = (await db.prepare(`SELECT ${headers.join(', ')} FROM products ORDER BY id ASC`).all()) as Array<Record<string, unknown>>;
    } else if (dataset === 'invoices') {
      headers = ['ref', 'invoice_type', 'invoice_kind', 'issue_date', 'due_date', 'status', 'subtotal_ht', 'tax_total', 'total_ttc', 'amount_paid'];
      rows = (await db.prepare(`SELECT ${headers.join(', ')} FROM invoices ORDER BY id ASC`).all()) as Array<Record<string, unknown>>;
    } else {
      headers = ['ref', 'name', 'party_type', 'email', 'phone', 'city', 'country', 'payment_terms', 'status'];
      rows = (await db.prepare(`SELECT ${headers.join(', ')} FROM third_parties ORDER BY id ASC`).all()) as Array<Record<string, unknown>>;
    }
    const csvLines = [
      headers.map(sanitizeCsvCell).join(','),
      ...rows.map((r) => headers.map((h) => sanitizeCsvCell(r[h])).join(',')),
    ];
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DATA_EXPORT_CSV',
      module: 'tools',
      entityRef: dataset,
      details: `Exported ${rows.length} ${dataset} record(s)`,
      ipAddress: getClientIp(req),
    }));
    res.json({ dataset, count: rows.length, csv: csvLines.join('\n') });
  });

  router.post('/data/import-csv', authenticate, requirePermission('tools', 'export'), async (req: AuthenticatedReq, res) => {
    const { dataset = 'third_parties', csvText } = req.body ?? {};
    const lines = String(csvText ?? '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) {
      res.status(400).json({ error: 'Provide a CSV header row plus at least one data row.' });
      return;
    }
    const dataRows = lines.slice(1, 201);
    let imported = 0;

    if (dataset === 'products') {
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO products (ref, name, product_type, category, cost_price, sell_price, tax_rate, min_stock, barcode)
         VALUES (?, ?, ?, ?, ?, ?, 20, 10, ?)`
      );
      for (const row of dataRows) {
        const cols = row.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
        const ref = (cols[0] || `IMP-${Date.now().toString().slice(-5)}-${imported}`).toUpperCase();
        const name = cols[1];
        if (!name) continue;
        const ptype = cols[2] === 'service' ? 'service' : 'product';
        const r = await stmt.run(ref, name, ptype, cols[3] || 'Imported', Number(cols[4]) || 0, Number(cols[5]) || 0, cols[6] || '');
        if (r.changes > 0) imported += 1;
      }
    } else {
      const stmt = db.prepare(
        `INSERT INTO third_parties (ref, name, party_type, email, phone, city, country, payment_terms, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Net 30', 'active')`
      );
      for (const row of dataRows) {
        const cols = row.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
        const name = cols[0];
        if (!name) continue;
        const ptype = ['customer', 'prospect', 'supplier', 'customer_supplier'].includes(cols[1]) ? cols[1] : 'customer';
        const ref = await nextSequenceRef('third_parties', 'IMP');
        await stmt.run(ref, name, ptype, cols[2] || '', cols[3] || '', cols[4] || '', cols[5] || '');
        imported += 1;
      }
    }
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DATA_IMPORT_CSV',
      module: 'tools',
      entityRef: String(dataset),
      details: `Imported ${imported} row(s) into ${dataset}`,
      ipAddress: getClientIp(req),
    }));
    res.status(201).json({ imported });
  });

  // INTEGRATIONS (LDAP, Click-to-Dial, Payments, Social, RSS)
  router.get('/integrations', authenticate, async (_req, res) => {
    const rows = (await db.prepare('SELECT config_key, config_json FROM integrations_config').all()) as Array<{
      config_key: string;
      config_json: string;
    }>;
    const out: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        out[r.config_key] = JSON.parse(r.config_json);
      } catch {
        out[r.config_key] = {};
      }
    }
    res.json({ integrations: out });
  });

  router.put('/integrations/:key', authenticate, requirePermission('admin', 'manage_roles'), async (req: AuthenticatedReq, res) => {
    const key = String(req.params.key ?? '').trim();
    const allowedKeys = new Set(['ldap', 'click_to_dial', 'payment_gateways', 'social', 'rss', 'email_collector']);
    if (!allowedKeys.has(key)) {
      res.status(400).json({ error: 'Unknown integration configuration key.' });
      return;
    }
    const payload = { ...(req.body ?? {}) } as Record<string, unknown>;
    // Never store raw secret strings from client directly into inspectable JSON
    if (key === 'ldap' && 'bindPassword' in payload) {
      const hasSecret = Boolean(String(payload.bindPassword ?? '').trim());
      delete payload.bindPassword;
      payload.hasBindSecret = hasSecret;
    }
    if (key === 'social') {
      for (const k of ['linkedin', 'x', 'github']) {
        const val = String(payload[k] ?? '').trim();
        if (val && !isValidHttpUrl(val)) {
          res.status(400).json({ error: `Social URL for ${k} must start with http:// or https://.` });
          return;
        }
      }
    }
    (await db.prepare(
      `INSERT INTO integrations_config (config_key, config_json, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(config_key) DO UPDATE SET config_json = excluded.config_json, updated_at = datetime('now')`
    ).run(key, JSON.stringify(payload)));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_INTEGRATION',
      module: 'admin',
      entityRef: key,
      details: `Updated integration configuration for ${key}`,
      ipAddress: getClientIp(req),
    }));
    res.json({ ok: true });
  });

  router.post('/rss/fetch', authenticate, requirePermission('tools', 'read'), async (req, res) => {
    const rawUrl = String((req.body as Record<string, unknown>)?.url ?? '').trim();
    if (!isValidHttpUrl(rawUrl)) {
      res.status(400).json({ error: 'Valid https:// RSS or Atom feed URL is required.' });
      return;
    }
    const parsed = new URL(rawUrl);
    if (isPrivateOrBlockedHost(parsed.hostname)) {
      res.status(403).json({ error: 'Private or local network feed URLs are blocked.' });
      return;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const upstream = await fetch(parsed.toString(), {
        signal: controller.signal,
        headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
      });
      clearTimeout(timer);
      if (!upstream.ok) {
        res.status(502).json({ error: `Upstream feed returned HTTP ${upstream.status}.` });
        return;
      }
      const xml = (await upstream.text()).slice(0, 120000);
      const items: Array<{ title: string; link: string; published: string }> = [];
      const matches = [...xml.matchAll(/<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/gi)].slice(0, 10);
      for (const m of matches) {
        const block = m[1];
        const title = (block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1] ?? 'Untitled').trim();
        const link =
          block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ??
          block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]?.trim() ??
          '';
        const published =
          block.match(/<(?:pubDate|updated|published)[^>]*>([\s\S]*?)<\/(?:pubDate|updated|published)>/i)?.[1]?.trim() ?? '';
        items.push({ title, link: isValidHttpUrl(link) ? link : '', published });
      }
      res.json({ url: parsed.toString(), items });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Unable to fetch RSS feed.' });
    }
  });

  // AI SUPPORT VIA API (Server-side @google/genai)
  router.post('/ai/assist', authenticate, requirePermission('tools', 'write'), async (req: AuthenticatedReq, res) => {
    const { taskType = 'custom_qa', prompt, contextRef } = req.body ?? {};
    if (!String(prompt ?? '').trim()) {
      res.status(400).json({ error: 'Prompt is required.' });
      return;
    }
    const allowedTasks = new Set(['executive_brief', 'ticket_reply', 'proposal_scope', 'email_campaign', 'custom_qa']);
    const cleanTask = allowedTasks.has(taskType) ? taskType : 'custom_qa';
    try {
      const result = await runErpAiAssist(db, env, {
        taskType: cleanTask as 'executive_brief' | 'ticket_reply' | 'proposal_scope' | 'email_campaign' | 'custom_qa',
        prompt: String(prompt).trim(),
        contextRef: contextRef ? String(contextRef).trim() : undefined,
      });
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'AI_ASSISTANT_QUERY',
        module: 'tools',
        entityRef: cleanTask,
        details: `Ran ${cleanTask} via ${result.model}`,
        ipAddress: getClientIp(req),
      }));
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI generation failed.';
      res.status(502).json({ error: message });
    }
  });

  // ========================
  // GLOBAL CROSS-MODULE SEARCH
  // ========================
  router.get('/search', authenticate, async (req: AuthenticatedReq, res) => {
    const rawQ = String(req.query.q ?? '').trim();
    if (!rawQ) {
      res.json({ results: [] });
      return;
    }

    const perms = req.authPermissions;
    const enabled = (await getEnabledModulesMap(db));
    const like = `%${rawQ}%`;
    const cleanIdStr = rawQ.replace(/^#/, '');
    const numericId = /^\d+$/.test(cleanIdStr) ? Number(cleanIdStr) : -1;

    interface SearchRow {
      uid: string;
      id: number;
      ref: string;
      title: string;
      subtitle: string;
      category: string;
      moduleKey: string;
      subTab?: string;
      status?: string;
      amount?: number | null;
    }

    const results: SearchRow[] = [];

    if (hasPermission(perms, 'crm', 'read') && enabled.crm !== false) {
      const rows = (await db
        .prepare(
          `SELECT id, ref, name, party_type, email, city, status
           FROM third_parties
           WHERE id = ? OR ref LIKE ? OR name LIKE ? OR email LIKE ? OR city LIKE ?
           ORDER BY CASE WHEN ref = ? OR id = ? THEN 0 ELSE 1 END, id DESC
           LIMIT 6`
        )
        .all(numericId, like, like, like, like, rawQ.toUpperCase(), numericId)) as Array<{
        id: number;
        ref: string;
        name: string;
        party_type: string;
        email: string;
        city: string;
        status: string;
      }>;
      const partyLabels: Record<string, string> = {
        customer: 'Customer',
        prospect: 'Prospect',
        supplier: 'Supplier',
        customer_supplier: 'Customer & Supplier',
      };
      for (const r of rows) {
        results.push({
          uid: `crm-${r.id}`,
          id: r.id,
          ref: r.ref,
          title: r.name,
          subtitle: [partyLabels[r.party_type] ?? r.party_type, r.email || r.city].filter(Boolean).join(' · '),
          category: 'Third Parties',
          moduleKey: 'crm',
          subTab: 'companies',
          status: r.status,
        });
      }
    }

    if (hasPermission(perms, 'products', 'read') && enabled.products !== false) {
      const rows = (await db
        .prepare(
          `SELECT id, ref, name, product_type, category, barcode, sell_price
           FROM products
           WHERE id = ? OR ref LIKE ? OR name LIKE ? OR barcode LIKE ? OR category LIKE ?
           ORDER BY CASE WHEN ref = ? OR id = ? THEN 0 ELSE 1 END, id DESC
           LIMIT 6`
        )
        .all(numericId, like, like, like, like, rawQ.toUpperCase(), numericId)) as Array<{
        id: number;
        ref: string;
        name: string;
        product_type: string;
        category: string;
        barcode: string;
        sell_price: number;
      }>;
      for (const r of rows) {
        results.push({
          uid: `product-${r.id}`,
          id: r.id,
          ref: r.ref,
          title: r.name,
          subtitle: [r.product_type === 'service' ? 'Service' : 'Product', r.category, r.barcode]
            .filter(Boolean)
            .join(' · '),
          category: 'Products & Services',
          moduleKey: 'inventory',
          subTab: 'catalog',
          amount: r.sell_price,
        });
      }
    }

    if (hasPermission(perms, 'sales', 'read') && enabled.sales !== false) {
      const propRows = (await db
        .prepare(
          `SELECT p.id, p.ref, p.title, p.status, p.total_ttc, tp.name AS party_name
           FROM proposals p
           JOIN third_parties tp ON tp.id = p.third_party_id
           WHERE p.id = ? OR p.ref LIKE ? OR p.title LIKE ? OR tp.name LIKE ?
           ORDER BY CASE WHEN p.ref = ? OR p.id = ? THEN 0 ELSE 1 END, p.id DESC
           LIMIT 5`
        )
        .all(numericId, like, like, like, rawQ.toUpperCase(), numericId)) as Array<{
        id: number;
        ref: string;
        title: string;
        status: string;
        total_ttc: number;
        party_name: string;
      }>;
      for (const r of propRows) {
        results.push({
          uid: `proposal-${r.id}`,
          id: r.id,
          ref: r.ref,
          title: r.title,
          subtitle: r.party_name,
          category: 'Proposals',
          moduleKey: 'commerce',
          subTab: 'proposals',
          status: r.status,
          amount: r.total_ttc,
        });
      }

      const soRows = (await db
        .prepare(
          `SELECT so.id, so.ref, so.status, so.total_ttc, so.proposal_ref, tp.name AS party_name
           FROM sales_orders so
           JOIN third_parties tp ON tp.id = so.third_party_id
           WHERE so.id = ? OR so.ref LIKE ? OR tp.name LIKE ? OR so.proposal_ref LIKE ?
           ORDER BY CASE WHEN so.ref = ? OR so.id = ? THEN 0 ELSE 1 END, so.id DESC
           LIMIT 5`
        )
        .all(numericId, like, like, like, rawQ.toUpperCase(), numericId)) as Array<{
        id: number;
        ref: string;
        status: string;
        total_ttc: number;
        proposal_ref: string;
        party_name: string;
      }>;
      for (const r of soRows) {
        results.push({
          uid: `so-${r.id}`,
          id: r.id,
          ref: r.ref,
          title: `Sales Order ${r.ref}`,
          subtitle: [r.party_name, r.proposal_ref ? `From ${r.proposal_ref}` : ''].filter(Boolean).join(' · '),
          category: 'Sales Orders',
          moduleKey: 'commerce',
          subTab: 'sales_orders',
          status: r.status,
          amount: r.total_ttc,
        });
      }
    }

    if (hasPermission(perms, 'purchasing', 'read') && enabled.purchasing !== false) {
      const poRows = (await db
        .prepare(
          `SELECT po.id, po.ref, po.status, po.total_ttc, tp.name AS party_name
           FROM purchase_orders po
           JOIN third_parties tp ON tp.id = po.third_party_id
           WHERE po.id = ? OR po.ref LIKE ? OR tp.name LIKE ?
           ORDER BY CASE WHEN po.ref = ? OR po.id = ? THEN 0 ELSE 1 END, po.id DESC
           LIMIT 5`
        )
        .all(numericId, like, like, rawQ.toUpperCase(), numericId)) as Array<{
        id: number;
        ref: string;
        status: string;
        total_ttc: number;
        party_name: string;
      }>;
      for (const r of poRows) {
        results.push({
          uid: `po-${r.id}`,
          id: r.id,
          ref: r.ref,
          title: `Purchase Order ${r.ref}`,
          subtitle: r.party_name,
          category: 'Purchase Orders',
          moduleKey: 'commerce',
          subTab: 'purchase_orders',
          status: r.status,
          amount: r.total_ttc,
        });
      }
    }

    if (hasPermission(perms, 'billing', 'read') && enabled.billing !== false) {
      const invRows = (await db
        .prepare(
          `SELECT inv.id, inv.ref, inv.invoice_type, inv.invoice_kind, inv.status, inv.total_ttc, inv.source_ref, tp.name AS party_name
           FROM invoices inv
           JOIN third_parties tp ON tp.id = inv.third_party_id
           WHERE inv.id = ? OR inv.ref LIKE ? OR tp.name LIKE ? OR inv.source_ref LIKE ?
           ORDER BY CASE WHEN inv.ref = ? OR inv.id = ? THEN 0 ELSE 1 END, inv.id DESC
           LIMIT 5`
        )
        .all(numericId, like, like, like, rawQ.toUpperCase(), numericId)) as Array<{
        id: number;
        ref: string;
        invoice_type: 'customer' | 'supplier';
        invoice_kind: string;
        status: string;
        total_ttc: number;
        source_ref: string;
        party_name: string;
      }>;
      for (const r of invRows) {
        results.push({
          uid: `inv-${r.id}`,
          id: r.id,
          ref: r.ref,
          title: `${r.invoice_type === 'supplier' ? 'Supplier Bill' : 'Invoice'} ${r.ref}`,
          subtitle: [r.party_name, r.source_ref ? `Ref ${r.source_ref}` : ''].filter(Boolean).join(' · '),
          category: 'Invoices & Bills',
          moduleKey: 'billing',
          subTab: r.invoice_type === 'supplier' ? 'supplier_bills' : 'customer_invoices',
          status: r.status,
          amount: r.total_ttc,
        });
      }
    }

    if (hasPermission(perms, 'projects', 'read') && enabled.projects !== false) {
      const projRows = (await db
        .prepare(
          `SELECT p.id, p.ref, p.title, p.status, tp.name AS party_name
           FROM projects p
           LEFT JOIN third_parties tp ON tp.id = p.third_party_id
           WHERE p.id = ? OR p.ref LIKE ? OR p.title LIKE ? OR IFNULL(tp.name, '') LIKE ?
           ORDER BY CASE WHEN p.ref = ? OR p.id = ? THEN 0 ELSE 1 END, p.id DESC
           LIMIT 4`
        )
        .all(numericId, like, like, like, rawQ.toUpperCase(), numericId)) as Array<{
        id: number;
        ref: string;
        title: string;
        status: string;
        party_name: string | null;
      }>;
      for (const r of projRows) {
        results.push({
          uid: `proj-${r.id}`,
          id: r.id,
          ref: r.ref,
          title: r.title,
          subtitle: r.party_name || 'Internal Project',
          category: 'Projects',
          moduleKey: 'projects',
          subTab: 'projects',
          status: r.status,
        });
      }
    }

    if (hasPermission(perms, 'support', 'read') && enabled.support !== false) {
      const tckRows = (await db
        .prepare(
          `SELECT t.id, t.ref, t.subject, t.status, t.severity, tp.name AS party_name
           FROM tickets t
           LEFT JOIN third_parties tp ON tp.id = t.third_party_id
           WHERE t.id = ? OR t.ref LIKE ? OR t.subject LIKE ? OR IFNULL(tp.name, '') LIKE ?
           ORDER BY CASE WHEN t.ref = ? OR t.id = ? THEN 0 ELSE 1 END, t.id DESC
           LIMIT 4`
        )
        .all(numericId, like, like, like, rawQ.toUpperCase(), numericId)) as Array<{
        id: number;
        ref: string;
        subject: string;
        status: string;
        severity: string;
        party_name: string | null;
      }>;
      for (const r of tckRows) {
        results.push({
          uid: `tck-${r.id}`,
          id: r.id,
          ref: r.ref,
          title: r.subject,
          subtitle: [r.party_name || 'Support Desk', r.severity].join(' · '),
          category: 'Tickets',
          moduleKey: 'support',
          subTab: 'tickets',
          status: r.status,
        });
      }
    }

    if (hasPermission(perms, 'hr', 'read') && enabled.hr !== false) {
      const empRows = (await db
        .prepare(
          `SELECT id, ref, full_name, department, job_title, status
           FROM employees
           WHERE id = ? OR ref LIKE ? OR full_name LIKE ? OR email LIKE ? OR department LIKE ?
           ORDER BY CASE WHEN ref = ? OR id = ? THEN 0 ELSE 1 END, id DESC
           LIMIT 4`
        )
        .all(numericId, like, like, like, like, rawQ.toUpperCase(), numericId)) as Array<{
        id: number;
        ref: string;
        full_name: string;
        department: string;
        job_title: string;
        status: string;
      }>;
      for (const r of empRows) {
        results.push({
          uid: `emp-${r.id}`,
          id: r.id,
          ref: r.ref,
          title: r.full_name,
          subtitle: [r.job_title, r.department].filter(Boolean).join(' · '),
          category: 'Employees',
          moduleKey: 'hr',
          subTab: 'employees',
          status: r.status,
        });
      }
    }

    if (hasPermission(perms, 'manufacturing', 'read') && enabled.manufacturing !== false) {
      const moRows = (await db
        .prepare(
          `SELECT mo.id, mo.ref, mo.status, mo.qty_planned, p.name AS product_name
           FROM manufacturing_orders mo
           JOIN products p ON p.id = mo.product_id
           WHERE mo.id = ? OR mo.ref LIKE ? OR p.name LIKE ? OR p.ref LIKE ?
           ORDER BY CASE WHEN mo.ref = ? OR mo.id = ? THEN 0 ELSE 1 END, mo.id DESC
           LIMIT 4`
        )
        .all(numericId, like, like, like, rawQ.toUpperCase(), numericId)) as Array<{
        id: number;
        ref: string;
        status: string;
        qty_planned: number;
        product_name: string;
      }>;
      for (const r of moRows) {
        results.push({
          uid: `mo-${r.id}`,
          id: r.id,
          ref: r.ref,
          title: `MO ${r.ref} — ${r.product_name}`,
          subtitle: `Planned qty: ${r.qty_planned}`,
          category: 'Manufacturing Orders',
          moduleKey: 'manufacturing',
          subTab: 'orders',
          status: r.status,
        });
      }
    }

    res.json({ results });
  });

  return router;
}

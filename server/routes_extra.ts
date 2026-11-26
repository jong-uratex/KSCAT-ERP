import crypto from 'node:crypto';
import { runErpAiAssist } from './ai.ts';
import type { AppEnv, DbClient } from './db_adapter.ts';
import { getEnabledModulesMap, writeAuditLog } from './db.ts';
import { hasPermission, type PermissionAction, type PermissionMap, type PermissionModule } from './rbac.ts';
import type { AuthenticatedRequest } from './routes.ts';
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

  async function computeFinancialReports() {
    const glAccounts = (await db.prepare('SELECT * FROM accounting_accounts ORDER BY code ASC').all()) as Array<{
      id: number;
      code: string;
      label: string;
      account_class: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
      balance: number;
    }>;

    const revenueAccounts = glAccounts.filter((a) => a.account_class === 'revenue');
    const expenseAccounts = glAccounts.filter((a) => a.account_class === 'expense');
    const assetAccounts = glAccounts.filter((a) => a.account_class === 'asset');
    const liabilityAccounts = glAccounts.filter((a) => a.account_class === 'liability');
    const equityAccounts = glAccounts.filter((a) => a.account_class === 'equity');

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const totalRevenue = round2(revenueAccounts.reduce((s, a) => s + a.balance, 0));
    const totalExpenses = round2(expenseAccounts.reduce((s, a) => s + a.balance, 0));
    const netIncome = round2(totalRevenue - totalExpenses);
    const totalAssets = round2(assetAccounts.reduce((s, a) => s + a.balance, 0));
    const totalLiabilities = round2(liabilityAccounts.reduce((s, a) => s + a.balance, 0));
    const totalEquity = round2(equityAccounts.reduce((s, a) => s + a.balance, 0));

    let totalDebits = 0;
    let totalCredits = 0;
    const trialBalanceRows = glAccounts.map((a) => {
      const isDebitNormal = a.account_class === 'asset' || a.account_class === 'expense';
      let debit = 0;
      let credit = 0;
      if (isDebitNormal) {
        if (a.balance >= 0) debit = round2(a.balance);
        else credit = round2(Math.abs(a.balance));
      } else {
        if (a.balance >= 0) credit = round2(a.balance);
        else debit = round2(Math.abs(a.balance));
      }
      totalDebits += debit;
      totalCredits += credit;
      return { code: a.code, label: a.label, account_class: a.account_class, debit, credit };
    });

    const openDocs = (await db
      .prepare(
        `SELECT i.id, i.ref, i.invoice_type, i.due_date, i.total_ttc, i.amount_paid, tp.name AS party_name
         FROM invoices i
         JOIN third_parties tp ON tp.id = i.third_party_id
         WHERE i.status IN ('validated', 'partial')`
      )
      .all()) as Array<{
      id: number;
      ref: string;
      invoice_type: 'customer' | 'supplier';
      due_date: string;
      total_ttc: number;
      amount_paid: number;
      party_name: string;
    }>;

    const todayMs = new Date().setHours(0, 0, 0, 0);
    const initBuckets = () => ({ current: 0, d1_30: 0, d31_60: 0, d61_plus: 0, total: 0 });
    const arBuckets = initBuckets();
    const apBuckets = initBuckets();
    const overdueItems: Array<{
      id: number;
      ref: string;
      invoice_type: 'customer' | 'supplier';
      party_name: string;
      due_date: string;
      days_overdue: number;
      balance_due: number;
    }> = [];

    for (const doc of openDocs) {
      const rem = round2(Math.max(0, doc.total_ttc - doc.amount_paid));
      if (rem <= 0) continue;
      const dueMs = new Date(`${doc.due_date}T00:00:00Z`).getTime();
      const daysOverdue = Number.isFinite(dueMs) ? Math.floor((todayMs - dueMs) / 86400000) : 0;
      const bucket = doc.invoice_type === 'customer' ? arBuckets : apBuckets;
      if (daysOverdue <= 0) bucket.current = round2(bucket.current + rem);
      else if (daysOverdue <= 30) bucket.d1_30 = round2(bucket.d1_30 + rem);
      else if (daysOverdue <= 60) bucket.d31_60 = round2(bucket.d31_60 + rem);
      else bucket.d61_plus = round2(bucket.d61_plus + rem);
      bucket.total = round2(bucket.total + rem);

      if (daysOverdue > 0) {
        overdueItems.push({
          id: doc.id,
          ref: doc.ref,
          invoice_type: doc.invoice_type,
          party_name: doc.party_name,
          due_date: doc.due_date,
          days_overdue: daysOverdue,
          balance_due: rem,
        });
      }
    }
    overdueItems.sort((a, b) => b.days_overdue - a.days_overdue);

    const vatRow = (await db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN invoice_type = 'customer' AND status != 'cancelled' THEN subtotal_ht ELSE 0 END), 0) AS taxable_sales_ht,
           COALESCE(SUM(CASE WHEN invoice_type = 'supplier' AND status != 'cancelled' THEN subtotal_ht ELSE 0 END), 0) AS taxable_purchases_ht,
           COALESCE(SUM(CASE WHEN invoice_type = 'customer' AND status != 'cancelled' THEN tax_total ELSE 0 END), 0) AS vat_collected,
           COALESCE(SUM(CASE WHEN invoice_type = 'supplier' AND status != 'cancelled' THEN tax_total ELSE 0 END), 0) AS vat_deductible
         FROM invoices`
      )
      .get()) as { taxable_sales_ht: number; taxable_purchases_ht: number; vat_collected: number; vat_deductible: number };

    return {
      pnl: {
        revenueAccounts,
        expenseAccounts,
        totalRevenue,
        totalExpenses,
        netIncome,
      },
      balanceSheet: {
        assetAccounts,
        liabilityAccounts,
        equityAccounts,
        totalAssets,
        totalLiabilities,
        totalEquity,
        currentYearNetIncome: netIncome,
      },
      trialBalance: {
        rows: trialBalanceRows,
        totalDebits: round2(totalDebits),
        totalCredits: round2(totalCredits),
      },
      aging: {
        receivables: arBuckets,
        payables: apBuckets,
        overdueItems: overdueItems.slice(0, 12),
      },
      vatSummary: {
        taxableSalesHt: round2(vatRow.taxable_sales_ht),
        taxablePurchasesHt: round2(vatRow.taxable_purchases_ht),
        vatCollected: round2(vatRow.vat_collected),
        vatDeductible: round2(vatRow.vat_deductible),
        netVatPayable: round2(vatRow.vat_collected - vatRow.vat_deductible),
      },
    };
  }

  async function postAutoJournalEntry(params: {
    journalCode: string;
    description: string;
    debitAccountCode: string;
    creditAccountCode: string;
    amount: number;
    sourceRef: string;
    actorEmail: string;
    entryDate?: string;
  }) {
    const amt = Math.round(params.amount * 100) / 100;
    if (amt <= 0 || params.debitAccountCode === params.creditAccountCode) return null;
    const jrnRef = await seqRef('journal_entries', 'JRN');
    const dt = params.entryDate || new Date().toISOString().slice(0, 10);
    await db
      .prepare(
        `INSERT INTO journal_entries (ref, entry_date, journal_code, description, debit_account_code, credit_account_code, amount, source_ref, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        jrnRef,
        dt,
        params.journalCode,
        params.description,
        params.debitAccountCode,
        params.creditAccountCode,
        amt,
        params.sourceRef,
        params.actorEmail
      );
    await db.prepare('UPDATE accounting_accounts SET balance = balance + ? WHERE code = ?').run(amt, params.debitAccountCode);
    await db.prepare('UPDATE accounting_accounts SET balance = balance - ? WHERE code = ?').run(amt, params.creditAccountCode);
    return jrnRef;
  }

  // ========================
  // FINANCE EXTENSIONS (SEPA, ACCOUNTING, DONATIONS, LOANS, MARGINS, RECONCILIATION, REPORTS, FIXED ASSETS, PAYROLL, MILEAGE)
  // ========================
  router.get('/finance-extensions', authenticate, requirePermission('billing', 'read'), async (_req, res) => {
    const sepaBatches = (await db
      .prepare(
        `SELECT sb.*, ba.name AS bank_name, ba.ref AS bank_ref
         FROM sepa_batches sb
         JOIN bank_accounts ba ON ba.id = sb.bank_account_id
         ORDER BY sb.id DESC`
      )
      .all());
    const accounts = (await db.prepare('SELECT * FROM accounting_accounts ORDER BY code ASC').all());
    const journalEntries = (await db.prepare('SELECT * FROM journal_entries ORDER BY entry_date DESC, id DESC LIMIT 100').all());
    const donations = (await db.prepare('SELECT * FROM donations ORDER BY id DESC').all());
    const loans = (await db.prepare('SELECT * FROM loans ORDER BY id DESC').all());

    const marginStats = (await db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN invoice_type = 'customer' AND invoice_kind = 'standard' AND status != 'cancelled' THEN subtotal_ht ELSE 0 END), 0) AS revenue_ht,
           COALESCE(SUM(CASE WHEN invoice_type = 'customer' AND invoice_kind = 'credit_note' AND status != 'cancelled' THEN subtotal_ht ELSE 0 END), 0) AS credit_notes_ht,
           COALESCE(SUM(CASE WHEN invoice_type = 'supplier' AND status != 'cancelled' THEN subtotal_ht ELSE 0 END), 0) AS purchases_ht,
           COALESCE(SUM(CASE WHEN invoice_type = 'customer' AND status != 'cancelled' THEN tax_total ELSE 0 END), 0) AS vat_collected,
           COALESCE(SUM(CASE WHEN invoice_type = 'supplier' AND status != 'cancelled' THEN tax_total ELSE 0 END), 0) AS vat_deductible
         FROM invoices`
      )
      .get());

    const fixedAssets = await db.prepare('SELECT * FROM fixed_assets ORDER BY id DESC').all();
    const rawRuns = (await db
      .prepare(
        `SELECT pr.*, ba.name AS bank_account_name, ba.ref AS bank_account_ref
         FROM payroll_runs pr
         LEFT JOIN bank_accounts ba ON ba.id = pr.bank_account_id
         ORDER BY pr.id DESC`
      )
      .all()) as Array<Record<string, unknown> & { id: number }>;
    const allPayLines = (await db.prepare('SELECT * FROM payroll_lines ORDER BY id ASC').all()) as Array<
      Record<string, unknown> & { payroll_run_id: number }
    >;
    const linesByRun = new Map<number, Array<Record<string, unknown>>>();
    for (const ln of allPayLines) {
      const list = linesByRun.get(ln.payroll_run_id) ?? [];
      list.push(ln);
      linesByRun.set(ln.payroll_run_id, list);
    }
    const payrollRuns = rawRuns.map((r) => ({ ...r, lines: linesByRun.get(r.id) ?? [] }));

    const mileageClaims = await db.prepare('SELECT * FROM mileage_claims ORDER BY claim_date DESC, id DESC').all();
    const employeesList = await db
      .prepare("SELECT id, ref, full_name, department, annual_salary, status FROM employees ORDER BY full_name ASC")
      .all();

    const reconRow = (await db
      .prepare(
        `SELECT
           COUNT(CASE WHEN reconciled = 0 THEN 1 END) AS unreconciledCount,
           COUNT(CASE WHEN reconciled = 1 THEN 1 END) AS reconciledCount,
           COALESCE(SUM(CASE WHEN reconciled = 0 AND direction = 'credit' THEN amount ELSE 0 END), 0) AS unreconciledCredits,
           COALESCE(SUM(CASE WHEN reconciled = 0 AND direction = 'debit' THEN amount ELSE 0 END), 0) AS unreconciledDebits
         FROM bank_transactions`
      )
      .get()) as { unreconciledCount: number; reconciledCount: number; unreconciledCredits: number; unreconciledDebits: number };

    const reports = await computeFinancialReports();

    res.json({
      sepaBatches,
      accounts,
      journalEntries,
      donations,
      loans,
      marginStats,
      fixedAssets,
      payrollRuns,
      mileageClaims,
      employees: employeesList,
      reconciliationSummary: reconRow,
      reports,
    });
  });

  // Send Customer Invoice / Dispatch Payment Reference
  router.post('/invoices/:id/send', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const inv = (await db
      .prepare(
        `SELECT i.*, tp.name AS party_name, tp.email AS party_email
         FROM invoices i
         JOIN third_parties tp ON tp.id = i.third_party_id
         WHERE i.id = ?`
      )
      .get(id)) as
      | { id: number; ref: string; status: string; total_ttc: number; amount_paid: number; party_name: string; party_email: string; notes: string }
      | undefined;
    if (!inv) {
      res.status(404).json({ error: 'Invoice not found.' });
      return;
    }
    if (inv.status === 'cancelled') {
      res.status(400).json({ error: 'Cancelled invoices cannot be sent.' });
      return;
    }
    const { recipientEmail, message = '' } = req.body ?? {};
    const targetEmail = String(recipientEmail || inv.party_email || '').trim();
    if (inv.status === 'draft') {
      await db.prepare(`UPDATE invoices SET status = 'validated' WHERE id = ?`).run(id);
    }
    const sentStamp = new Date().toISOString().slice(0, 10);
    const dispatchNote = `[Sent ${sentStamp} to ${targetEmail || 'customer portal'}]${message ? ` — ${String(message).trim()}` : ''}`;
    const nextNotes = inv.notes ? `${inv.notes}\n${dispatchNote}` : dispatchNote;
    await db.prepare(`UPDATE invoices SET notes = ? WHERE id = ?`).run(nextNotes, id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'SEND_INVOICE',
      module: 'billing',
      entityRef: inv.ref,
      details: `Dispatched ${inv.ref} to ${targetEmail || inv.party_name}`,
      ipAddress: getClientIp(req),
    });
    res.json({
      invoice: await db.prepare('SELECT * FROM invoices WHERE id = ?').get(id),
      sentTo: targetEmail || inv.party_name,
      paymentCode: `PAY-${inv.ref}`,
    });
  });

  // Bank Feed Reconciliation (Match Invoice/Bill OR Categorize to GL)
  router.post('/bank-transactions/:id/reconcile', authenticate, requirePermission('billing', 'record_payment'), async (req: AuthenticatedReq, res) => {
    const txId = Number(req.params.id);
    const tx = (await db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(txId)) as
      | {
          id: number;
          bank_account_id: number;
          tx_date: string;
          label: string;
          amount: number;
          direction: 'credit' | 'debit';
          reconciled: number;
        }
      | undefined;
    if (!tx) {
      res.status(404).json({ error: 'Bank transaction not found.' });
      return;
    }
    if (tx.reconciled === 1) {
      res.status(400).json({ error: 'Bank transaction is already reconciled.' });
      return;
    }

    const { invoiceId, glAccountCode, memo = '' } = req.body ?? {};
    if (invoiceId) {
      const inv = (await db
        .prepare(
          `SELECT i.*, tp.name AS party_name
           FROM invoices i
           JOIN third_parties tp ON tp.id = i.third_party_id
           WHERE i.id = ?`
        )
        .get(Number(invoiceId))) as
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
        res.status(404).json({ error: 'Target invoice/bill not found.' });
        return;
      }
      if (inv.status !== 'validated' && inv.status !== 'partial') {
        res.status(400).json({ error: 'Only validated or partial invoices/bills can be reconciled.' });
        return;
      }
      if (tx.direction === 'credit' && inv.invoice_type !== 'customer') {
        res.status(400).json({ error: 'Bank inflows (credits) must match Customer Invoices.' });
        return;
      }
      if (tx.direction === 'debit' && inv.invoice_type !== 'supplier') {
        res.status(400).json({ error: 'Bank outflows (debits) must match Supplier Bills.' });
        return;
      }
      const remaining = Math.round((inv.total_ttc - inv.amount_paid) * 100) / 100;
      const applied = Math.min(tx.amount, remaining);
      const nextPaid = Math.min(inv.total_ttc, Math.round((inv.amount_paid + applied) * 100) / 100);
      const nextStatus = nextPaid >= inv.total_ttc - 0.01 ? 'paid' : 'partial';

      await db.exec('BEGIN');
      try {
        await db.prepare('UPDATE invoices SET amount_paid = ?, status = ? WHERE id = ?').run(nextPaid, nextStatus, inv.id);
        await db
          .prepare(
            `UPDATE bank_transactions
             SET reconciled = 1,
                 reconciled_at = ?,
                 reconciled_invoice_id = ?,
                 invoice_ref = ?,
                 category = ?
             WHERE id = ?`
          )
          .run(
            new Date().toISOString().slice(0, 10),
            inv.id,
            inv.ref,
            inv.invoice_type === 'customer' ? 'Customer Payment' : 'Supplier Payment',
            txId
          );
        await postAutoJournalEntry({
          journalCode: 'BNK',
          description: `Bank Reconciliation ${inv.ref} — ${inv.party_name}`,
          debitAccountCode: tx.direction === 'credit' ? '1010' : '2000',
          creditAccountCode: tx.direction === 'credit' ? '1200' : '1010',
          amount: applied,
          sourceRef: inv.ref,
          actorEmail: req.authUser!.email,
          entryDate: tx.tx_date,
        });
        await db.exec('COMMIT');
        await writeAuditLog(db, {
          userId: req.authUser!.id,
          userEmail: req.authUser!.email,
          action: 'RECONCILE_BANK_TX',
          module: 'billing',
          entityRef: inv.ref,
          details: `Reconciled bank tx #${txId} ($${tx.amount.toFixed(2)}) with ${inv.ref}`,
          ipAddress: getClientIp(req),
        });
        res.json({ ok: true, mode: 'invoice', invoiceRef: inv.ref });
        return;
      } catch (err) {
        await db.exec('ROLLBACK');
        res.status(500).json({ error: err instanceof Error ? err.message : 'Reconciliation failed.' });
        return;
      }
    }

    const cleanGl = String(glAccountCode ?? '').trim();
    if (!cleanGl) {
      res.status(400).json({ error: 'Select an open Invoice/Bill OR a GL Account to reconcile.' });
      return;
    }
    const glAcct = (await db.prepare('SELECT code, label FROM accounting_accounts WHERE code = ?').get(cleanGl)) as
      | { code: string; label: string }
      | undefined;
    if (!glAcct) {
      res.status(404).json({ error: 'Selected GL account not found.' });
      return;
    }

    await db.exec('BEGIN');
    try {
      await db
        .prepare(
          `UPDATE bank_transactions
           SET reconciled = 1,
               reconciled_at = ?,
               gl_account_code = ?,
               category = COALESCE(NULLIF(?, ''), category)
           WHERE id = ?`
        )
        .run(new Date().toISOString().slice(0, 10), cleanGl, glAcct.label, txId);

      if (cleanGl !== '1010') {
        await postAutoJournalEntry({
          journalCode: 'REC',
          description: `${String(memo || tx.label).trim()} (${glAcct.label})`,
          debitAccountCode: tx.direction === 'credit' ? '1010' : cleanGl,
          creditAccountCode: tx.direction === 'credit' ? cleanGl : '1010',
          amount: tx.amount,
          sourceRef: `TX-${txId}`,
          actorEmail: req.authUser!.email,
          entryDate: tx.tx_date,
        });
      }
      await db.exec('COMMIT');
      await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'RECONCILE_BANK_TX',
        module: 'billing',
        entityRef: `TX-${txId}`,
        details: `Categorized & reconciled bank tx #${txId} to GL ${cleanGl} (${glAcct.label})`,
        ipAddress: getClientIp(req),
      });
      res.json({ ok: true, mode: 'gl', glAccountCode: cleanGl });
    } catch (err) {
      await db.exec('ROLLBACK');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Reconciliation failed.' });
    }
  });

  router.post('/bank-transactions/:id/unreconcile', authenticate, requirePermission('billing', 'record_payment'), async (req: AuthenticatedReq, res) => {
    const txId = Number(req.params.id);
    const tx = (await db.prepare('SELECT id, label FROM bank_transactions WHERE id = ?').get(txId)) as { id: number; label: string } | undefined;
    if (!tx) {
      res.status(404).json({ error: 'Bank transaction not found.' });
      return;
    }
    await db
      .prepare(`UPDATE bank_transactions SET reconciled = 0, reconciled_at = '', reconciled_invoice_id = NULL, gl_account_code = '' WHERE id = ?`)
      .run(txId);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UNRECONCILE_BANK_TX',
      module: 'billing',
      entityRef: `TX-${txId}`,
      details: `Marked bank tx #${txId} (${tx.label}) unreconciled`,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  });

  // Financial Reports CSV Export
  router.get('/accounting/reports/export', authenticate, requirePermission('billing', 'read'), async (req: AuthenticatedReq, res) => {
    const type = String(req.query.type ?? 'pnl');
    const reports = await computeFinancialReports();
    const lines: string[] = [];

    if (type === 'balance_sheet') {
      lines.push(['Section', 'Code', 'Account', 'Balance'].map(sanitizeCsvCell).join(','));
      for (const a of reports.balanceSheet.assetAccounts) {
        lines.push(['Assets', a.code, a.label, a.balance.toFixed(2)].map(sanitizeCsvCell).join(','));
      }
      for (const a of reports.balanceSheet.liabilityAccounts) {
        lines.push(['Liabilities', a.code, a.label, a.balance.toFixed(2)].map(sanitizeCsvCell).join(','));
      }
      for (const a of reports.balanceSheet.equityAccounts) {
        lines.push(['Equity', a.code, a.label, a.balance.toFixed(2)].map(sanitizeCsvCell).join(','));
      }
      lines.push(['Equity', 'CURRENT', 'Current Period Net Income', reports.balanceSheet.currentYearNetIncome.toFixed(2)].map(sanitizeCsvCell).join(','));
    } else if (type === 'trial_balance') {
      lines.push(['Code', 'Account', 'Class', 'Debit', 'Credit'].map(sanitizeCsvCell).join(','));
      for (const r of reports.trialBalance.rows) {
        lines.push([r.code, r.label, r.account_class, r.debit.toFixed(2), r.credit.toFixed(2)].map(sanitizeCsvCell).join(','));
      }
      lines.push(['TOTAL', 'Trial Balance Totals', '', reports.trialBalance.totalDebits.toFixed(2), reports.trialBalance.totalCredits.toFixed(2)].map(sanitizeCsvCell).join(','));
    } else if (type === 'aging') {
      lines.push(['Ledger', 'Current', '1-30 Days', '31-60 Days', '61+ Days', 'Total Open'].map(sanitizeCsvCell).join(','));
      const ar = reports.aging.receivables;
      const ap = reports.aging.payables;
      lines.push(['Accounts Receivable', ar.current.toFixed(2), ar.d1_30.toFixed(2), ar.d31_60.toFixed(2), ar.d61_plus.toFixed(2), ar.total.toFixed(2)].map(sanitizeCsvCell).join(','));
      lines.push(['Accounts Payable', ap.current.toFixed(2), ap.d1_30.toFixed(2), ap.d31_60.toFixed(2), ap.d61_plus.toFixed(2), ap.total.toFixed(2)].map(sanitizeCsvCell).join(','));
    } else {
      lines.push(['Category', 'Code', 'Account', 'Amount'].map(sanitizeCsvCell).join(','));
      for (const a of reports.pnl.revenueAccounts) {
        lines.push(['Revenue', a.code, a.label, a.balance.toFixed(2)].map(sanitizeCsvCell).join(','));
      }
      for (const a of reports.pnl.expenseAccounts) {
        lines.push(['Expense', a.code, a.label, a.balance.toFixed(2)].map(sanitizeCsvCell).join(','));
      }
      lines.push(['Summary', '', 'Net Profit / (Loss)', reports.pnl.netIncome.toFixed(2)].map(sanitizeCsvCell).join(','));
    }

    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'EXPORT_ACCOUNTING_REPORT',
      module: 'billing',
      entityRef: type,
      details: `Exported ${type} accounting report CSV`,
      ipAddress: getClientIp(req),
    });

    res.json({ type, csv: lines.join('\n') });
  });

  // Fixed Assets Management + Monthly Depreciation Run
  router.post('/fixed-assets', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const {
      ref,
      name,
      category = 'Equipment',
      purchaseDate,
      purchaseCost,
      salvageValue = 0,
      usefulLifeMonths = 36,
      depreciationMethod = 'straight_line',
      accumulatedDepreciation = 0,
      notes = '',
    } = req.body ?? {};
    const cost = Number(purchaseCost);
    if (!String(name ?? '').trim() || !Number.isFinite(cost) || cost <= 0) {
      res.status(400).json({ error: 'Asset name and positive purchase cost are required.' });
      return;
    }
    const cleanRef = String(ref ?? '').trim().toUpperCase() || (await seqRef('fixed_assets', 'FA'));
    try {
      const info = await db
        .prepare(
          `INSERT INTO fixed_assets (ref, name, category, purchase_date, purchase_cost, salvage_value, useful_life_months, depreciation_method, accumulated_depreciation, status, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
        )
        .run(
          cleanRef,
          String(name).trim(),
          String(category).trim() || 'Equipment',
          String(purchaseDate || new Date().toISOString().slice(0, 10)),
          cost,
          Math.max(0, Number(salvageValue) || 0),
          Math.max(1, Number(usefulLifeMonths) || 36),
          depreciationMethod === 'declining_balance' ? 'declining_balance' : 'straight_line',
          Math.max(0, Number(accumulatedDepreciation) || 0),
          String(notes).trim()
        );
      await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'CREATE_FIXED_ASSET',
        module: 'billing',
        entityRef: cleanRef,
        details: `Registered fixed asset ${cleanRef} — ${String(name).trim()} ($${cost.toFixed(2)})`,
        ipAddress: getClientIp(req),
      });
      res.status(201).json(await db.prepare('SELECT * FROM fixed_assets WHERE id = ?').get(info.lastInsertRowid));
    } catch {
      res.status(400).json({ error: 'Fixed asset reference already exists.' });
    }
  });

  router.put('/fixed-assets/:id', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM fixed_assets WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Fixed asset not found.' });
      return;
    }
    const { name, category, purchaseDate, purchaseCost, salvageValue, usefulLifeMonths, depreciationMethod, accumulatedDepreciation, status, notes } =
      req.body ?? {};
    await db
      .prepare(
        `UPDATE fixed_assets
         SET name = COALESCE(?, name),
             category = COALESCE(?, category),
             purchase_date = COALESCE(?, purchase_date),
             purchase_cost = COALESCE(?, purchase_cost),
             salvage_value = COALESCE(?, salvage_value),
             useful_life_months = COALESCE(?, useful_life_months),
             depreciation_method = COALESCE(?, depreciation_method),
             accumulated_depreciation = COALESCE(?, accumulated_depreciation),
             status = COALESCE(?, status),
             notes = COALESCE(?, notes)
         WHERE id = ?`
      )
      .run(
        name ? String(name).trim() : null,
        category ? String(category).trim() : null,
        purchaseDate ? String(purchaseDate) : null,
        purchaseCost !== undefined ? Number(purchaseCost) : null,
        salvageValue !== undefined ? Math.max(0, Number(salvageValue)) : null,
        usefulLifeMonths !== undefined ? Math.max(1, Number(usefulLifeMonths)) : null,
        depreciationMethod === 'straight_line' || depreciationMethod === 'declining_balance' ? depreciationMethod : null,
        accumulatedDepreciation !== undefined ? Math.max(0, Number(accumulatedDepreciation)) : null,
        status === 'active' || status === 'disposed' ? status : null,
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

  router.delete('/fixed-assets/:id', authenticate, requirePermission('billing', 'delete'), async (req: AuthenticatedReq, res) => {
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

  router.post('/fixed-assets/run-depreciation', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const runDate = String(req.body?.runDate || new Date().toISOString().slice(0, 10));
    const assets = (await db.prepare("SELECT * FROM fixed_assets WHERE status = 'active'").all()) as Array<{
      id: number;
      ref: string;
      purchase_cost: number;
      salvage_value: number;
      useful_life_months: number;
      depreciation_method: 'straight_line' | 'declining_balance';
      accumulated_depreciation: number;
    }>;

    let totalDepreciation = 0;
    let assetsUpdated = 0;

    await db.exec('BEGIN');
    try {
      for (const a of assets) {
        const depreciableBase = Math.max(0, a.purchase_cost - a.salvage_value);
        const remaining = Math.max(0, depreciableBase - a.accumulated_depreciation);
        if (remaining <= 0.01) continue;

        let monthly = 0;
        if (a.depreciation_method === 'declining_balance') {
          const nbv = Math.max(0, a.purchase_cost - a.accumulated_depreciation);
          monthly = (nbv * (2 / Math.max(1, a.useful_life_months)));
        } else {
          monthly = depreciableBase / Math.max(1, a.useful_life_months);
        }
        const charge = Math.round(Math.min(remaining, monthly) * 100) / 100;
        if (charge <= 0) continue;

        const nextAccum = Math.round((a.accumulated_depreciation + charge) * 100) / 100;
        await db
          .prepare('UPDATE fixed_assets SET accumulated_depreciation = ?, last_depreciation_date = ? WHERE id = ?')
          .run(nextAccum, runDate, a.id);
        totalDepreciation += charge;
        assetsUpdated++;
      }

      totalDepreciation = Math.round(totalDepreciation * 100) / 100;
      let journalRef: string | null = null;
      if (totalDepreciation > 0) {
        journalRef = await postAutoJournalEntry({
          journalCode: 'DEP',
          description: `Monthly Fixed Asset Depreciation Run (${assetsUpdated} asset(s))`,
          debitAccountCode: '6300',
          creditAccountCode: '1590',
          amount: totalDepreciation,
          sourceRef: `DEP-${runDate}`,
          actorEmail: req.authUser!.email,
          entryDate: runDate,
        });
      }
      await db.exec('COMMIT');
      await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'RUN_DEPRECIATION',
        module: 'billing',
        entityRef: journalRef ?? `DEP-${runDate}`,
        details: `Posted $${totalDepreciation.toFixed(2)} depreciation across ${assetsUpdated} asset(s)`,
        ipAddress: getClientIp(req),
      });
      res.json({ assetsUpdated, totalDepreciation, journalRef });
    } catch (err) {
      await db.exec('ROLLBACK');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Depreciation run failed.' });
    }
  });

  // Payroll Runs & Payslips
  router.post('/payroll-runs', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const { payPeriodStart, payPeriodEnd, payDate, bankAccountId, notes = '', lines } = req.body ?? {};
    const periodStart = String(payPeriodStart || new Date().toISOString().slice(0, 8) + '01');
    const periodEnd = String(payPeriodEnd || new Date().toISOString().slice(0, 10));
    const pDate = String(payDate || periodEnd);

    let computedLines: Array<{
      employeeId: number | null;
      employeeName: string;
      baseSalary: number;
      overtimeAllowances: number;
      taxDeductions: number;
      netPay: number;
    }> = [];

    if (Array.isArray(lines) && lines.length > 0) {
      computedLines = lines.map((l: Record<string, unknown>) => {
        const base = Math.max(0, Number(l.baseSalary) || 0);
        const ot = Math.max(0, Number(l.overtimeAllowances) || 0);
        const ded = Math.max(0, Number(l.taxDeductions) || 0);
        const net = Math.max(0, Math.round((base + ot - ded) * 100) / 100);
        return {
          employeeId: l.employeeId ? Number(l.employeeId) : null,
          employeeName: String(l.employeeName || 'Staff Member').trim(),
          baseSalary: base,
          overtimeAllowances: ot,
          taxDeductions: ded,
          netPay: net,
        };
      });
    } else {
      const emps = (await db
        .prepare("SELECT id, full_name, annual_salary FROM employees WHERE status != 'terminated' ORDER BY id ASC")
        .all()) as Array<{ id: number; full_name: string; annual_salary: number }>;
      computedLines = emps.map((e) => {
        const base = Math.round((e.annual_salary / 12) * 100) / 100;
        const ded = Math.round(base * 0.22 * 100) / 100;
        const net = Math.round((base - ded) * 100) / 100;
        return {
          employeeId: e.id,
          employeeName: e.full_name,
          baseSalary: base,
          overtimeAllowances: 0,
          taxDeductions: ded,
          netPay: net,
        };
      });
    }

    if (computedLines.length === 0) {
      res.status(400).json({ error: 'At least one employee payslip line is required.' });
      return;
    }

    const totalGross = Math.round(computedLines.reduce((s, l) => s + l.baseSalary + l.overtimeAllowances, 0) * 100) / 100;
    const totalDeductions = Math.round(computedLines.reduce((s, l) => s + l.taxDeductions, 0) * 100) / 100;
    const totalNet = Math.round(computedLines.reduce((s, l) => s + l.netPay, 0) * 100) / 100;
    const ref = await seqRef('payroll_runs', 'PAY');

    await db.exec('BEGIN');
    try {
      const info = await db
        .prepare(
          `INSERT INTO payroll_runs (ref, pay_period_start, pay_period_end, pay_date, employee_count, total_gross, total_deductions, total_net, status, bank_account_id, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
        )
        .run(
          ref,
          periodStart,
          periodEnd,
          pDate,
          computedLines.length,
          totalGross,
          totalDeductions,
          totalNet,
          bankAccountId ? Number(bankAccountId) : null,
          String(notes).trim(),
          req.authUser!.email
        );
      const runId = Number(info.lastInsertRowid);
      const insLine = db.prepare(
        `INSERT INTO payroll_lines (payroll_run_id, employee_id, employee_name, base_salary, overtime_allowances, tax_deductions, net_pay)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const l of computedLines) {
        await insLine.run(runId, l.employeeId, l.employeeName, l.baseSalary, l.overtimeAllowances, l.taxDeductions, l.netPay);
      }
      await db.exec('COMMIT');
      await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'CREATE_PAYROLL_RUN',
        module: 'billing',
        entityRef: ref,
        details: `Created payroll run ${ref} for ${computedLines.length} employee(s) ($${totalNet.toFixed(2)} net)`,
        ipAddress: getClientIp(req),
      });
      res.status(201).json(await db.prepare('SELECT * FROM payroll_runs WHERE id = ?').get(runId));
    } catch (err) {
      await db.exec('ROLLBACK');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to create payroll run.' });
    }
  });

  router.put('/payroll-runs/:id', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM payroll_runs WHERE id = ?').get(id)) as
      | { id: number; ref: string; status: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Payroll run not found.' });
      return;
    }
    const { payPeriodStart, payPeriodEnd, payDate, status, bankAccountId, notes, lines } = req.body ?? {};
    await db.exec('BEGIN');
    try {
      if (Array.isArray(lines) && lines.length > 0 && existing.status !== 'paid') {
        await db.prepare('DELETE FROM payroll_lines WHERE payroll_run_id = ?').run(id);
        let gross = 0;
        let ded = 0;
        let net = 0;
        const insLine = db.prepare(
          `INSERT INTO payroll_lines (payroll_run_id, employee_id, employee_name, base_salary, overtime_allowances, tax_deductions, net_pay)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        for (const l of lines as Array<Record<string, unknown>>) {
          const base = Math.max(0, Number(l.baseSalary) || 0);
          const ot = Math.max(0, Number(l.overtimeAllowances) || 0);
          const tax = Math.max(0, Number(l.taxDeductions) || 0);
          const lineNet = Math.max(0, Math.round((base + ot - tax) * 100) / 100);
          gross += base + ot;
          ded += tax;
          net += lineNet;
          await insLine.run(id, l.employeeId ? Number(l.employeeId) : null, String(l.employeeName || 'Staff Member').trim(), base, ot, tax, lineNet);
        }
        await db
          .prepare(
            `UPDATE payroll_runs
             SET employee_count = ?, total_gross = ?, total_deductions = ?, total_net = ?
             WHERE id = ?`
          )
          .run(lines.length, Math.round(gross * 100) / 100, Math.round(ded * 100) / 100, Math.round(net * 100) / 100, id);
      }

      await db
        .prepare(
          `UPDATE payroll_runs
           SET pay_period_start = COALESCE(?, pay_period_start),
               pay_period_end = COALESCE(?, pay_period_end),
               pay_date = COALESCE(?, pay_date),
               status = COALESCE(?, status),
               bank_account_id = COALESCE(?, bank_account_id),
               notes = COALESCE(?, notes)
           WHERE id = ?`
        )
        .run(
          payPeriodStart ? String(payPeriodStart) : null,
          payPeriodEnd ? String(payPeriodEnd) : null,
          payDate ? String(payDate) : null,
          existing.status !== 'paid' && ['draft', 'approved', 'paid'].includes(status) ? status : null,
          bankAccountId ? Number(bankAccountId) : null,
          notes !== undefined ? String(notes).trim() : null,
          id
        );
      await db.exec('COMMIT');
      await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'UPDATE_PAYROLL_RUN',
        module: 'billing',
        entityRef: existing.ref,
        details: `Updated payroll run ${existing.ref}`,
        ipAddress: getClientIp(req),
      });
      res.json(await db.prepare('SELECT * FROM payroll_runs WHERE id = ?').get(id));
    } catch (err) {
      await db.exec('ROLLBACK');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to update payroll run.' });
    }
  });

  router.post('/payroll-runs/:id/post', authenticate, requirePermission('billing', 'record_payment'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const run = (await db.prepare('SELECT * FROM payroll_runs WHERE id = ?').get(id)) as
      | { id: number; ref: string; pay_date: string; total_gross: number; total_net: number; status: string; bank_account_id: number | null }
      | undefined;
    if (!run) {
      res.status(404).json({ error: 'Payroll run not found.' });
      return;
    }
    if (run.status === 'paid') {
      res.status(400).json({ error: 'Payroll run has already been posted and paid.' });
      return;
    }
    const bankId = Number(req.body?.bankAccountId || run.bank_account_id);
    if (!bankId) {
      res.status(400).json({ error: 'Select a treasury bank account to fund payroll.' });
      return;
    }

    await db.exec('BEGIN');
    try {
      await db.prepare(`UPDATE payroll_runs SET status = 'paid', bank_account_id = ? WHERE id = ?`).run(bankId, id);
      await db.prepare(`UPDATE bank_accounts SET balance = balance - ? WHERE id = ?`).run(run.total_net, bankId);
      await db
        .prepare(
          `INSERT INTO bank_transactions (bank_account_id, tx_date, label, category, amount, direction, invoice_ref, reconciled, reconciled_at, gl_account_code, created_by)
           VALUES (?, ?, ?, 'Payroll Disbursement', ?, 'debit', ?, 1, ?, '6200', ?)`
        )
        .run(bankId, run.pay_date, `Payroll Run ${run.ref} Net Settlement`, run.total_net, run.ref, run.pay_date, req.authUser!.email);

      await postAutoJournalEntry({
        journalCode: 'PAY',
        description: `Payroll Run ${run.ref} Expense & Cash Settlement`,
        debitAccountCode: '6200',
        creditAccountCode: '1010',
        amount: run.total_net,
        sourceRef: run.ref,
        actorEmail: req.authUser!.email,
        entryDate: run.pay_date,
      });
      await db.exec('COMMIT');
      await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'POST_PAYROLL_RUN',
        module: 'billing',
        entityRef: run.ref,
        details: `Paid payroll run ${run.ref} ($${run.total_net.toFixed(2)} net) and posted to GL`,
        ipAddress: getClientIp(req),
      });
      res.json(await db.prepare('SELECT * FROM payroll_runs WHERE id = ?').get(id));
    } catch (err) {
      await db.exec('ROLLBACK');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to post payroll run.' });
    }
  });

  router.delete('/payroll-runs/:id', authenticate, requirePermission('billing', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, status FROM payroll_runs WHERE id = ?').get(id)) as
      | { ref: string; status: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Payroll run not found.' });
      return;
    }
    if (existing.status === 'paid') {
      res.status(400).json({ error: 'Paid payroll runs cannot be deleted.' });
      return;
    }
    await db.prepare('DELETE FROM payroll_runs WHERE id = ?').run(id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_PAYROLL_RUN',
      module: 'billing',
      entityRef: existing.ref,
      details: `Deleted payroll run ${existing.ref}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    });
    res.json({ ok: true });
  });

  // Mileage Tracking Claims
  router.post('/mileage-claims', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const { employeeId, employeeName, claimDate, origin, destination, distanceKm, ratePerKm = 0.67, vehicle = '', projectRef = '', notes = '' } =
      req.body ?? {};
    const dist = Number(distanceKm);
    const rate = Number(ratePerKm);
    if (!String(origin ?? '').trim() || !String(destination ?? '').trim() || !Number.isFinite(dist) || dist <= 0) {
      res.status(400).json({ error: 'Origin, destination, and positive distance are required.' });
      return;
    }
    let resolvedEmpName = String(employeeName ?? '').trim();
    if (employeeId && !resolvedEmpName) {
      const emp = (await db.prepare('SELECT full_name FROM employees WHERE id = ?').get(Number(employeeId))) as { full_name: string } | undefined;
      if (emp) resolvedEmpName = emp.full_name;
    }
    const total = Math.round(dist * Math.max(0.01, rate) * 100) / 100;
    const ref = await seqRef('mileage_claims', 'MIL');
    const info = await db
      .prepare(
        `INSERT INTO mileage_claims (ref, employee_id, employee_name, claim_date, origin, destination, distance_km, rate_per_km, total_amount, vehicle, project_ref, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted')`
      )
      .run(
        ref,
        employeeId ? Number(employeeId) : null,
        resolvedEmpName || req.authUser!.full_name,
        String(claimDate || new Date().toISOString().slice(0, 10)),
        String(origin).trim(),
        String(destination).trim(),
        dist,
        rate,
        total,
        String(vehicle).trim(),
        String(projectRef).trim(),
        String(notes).trim()
      );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_MILEAGE_CLAIM',
      module: 'billing',
      entityRef: ref,
      details: `Logged mileage claim ${ref} (${dist} km = $${total.toFixed(2)})`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json(await db.prepare('SELECT * FROM mileage_claims WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/mileage-claims/:id', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db
      .prepare('SELECT * FROM mileage_claims WHERE id = ?')
      .get(id)) as { id: number; ref: string; distance_km: number; rate_per_km: number; status: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Mileage claim not found.' });
      return;
    }
    const { employeeId, employeeName, claimDate, origin, destination, distanceKm, ratePerKm, vehicle, projectRef, notes, status } = req.body ?? {};
    const nextDist = distanceKm !== undefined ? Number(distanceKm) : existing.distance_km;
    const nextRate = ratePerKm !== undefined ? Number(ratePerKm) : existing.rate_per_km;
    if (!Number.isFinite(nextDist) || nextDist <= 0 || !Number.isFinite(nextRate) || nextRate <= 0) {
      res.status(400).json({ error: 'Positive distance and rate per km are required.' });
      return;
    }
    const nextTotal = Math.round(nextDist * nextRate * 100) / 100;
    await db
      .prepare(
        `UPDATE mileage_claims
         SET employee_id = COALESCE(?, employee_id),
             employee_name = COALESCE(?, employee_name),
             claim_date = COALESCE(?, claim_date),
             origin = COALESCE(?, origin),
             destination = COALESCE(?, destination),
             distance_km = ?,
             rate_per_km = ?,
             total_amount = ?,
             vehicle = COALESCE(?, vehicle),
             project_ref = COALESCE(?, project_ref),
             notes = COALESCE(?, notes),
             status = COALESCE(?, status)
         WHERE id = ?`
      )
      .run(
        employeeId !== undefined ? (employeeId ? Number(employeeId) : null) : null,
        employeeName ? String(employeeName).trim() : null,
        claimDate ? String(claimDate) : null,
        origin ? String(origin).trim() : null,
        destination ? String(destination).trim() : null,
        nextDist,
        nextRate,
        nextTotal,
        vehicle !== undefined ? String(vehicle).trim() : null,
        projectRef !== undefined ? String(projectRef).trim() : null,
        notes !== undefined ? String(notes).trim() : null,
        existing.status !== 'paid' && ['draft', 'submitted', 'approved', 'paid'].includes(status) ? status : null,
        id
      );
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_MILEAGE_CLAIM',
      module: 'billing',
      entityRef: existing.ref,
      details: `Updated mileage claim ${existing.ref}`,
      ipAddress: getClientIp(req),
    });
    res.json(await db.prepare('SELECT * FROM mileage_claims WHERE id = ?').get(id));
  });

  router.post('/mileage-claims/:id/reimburse', authenticate, requirePermission('billing', 'record_payment'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const claim = (await db.prepare('SELECT * FROM mileage_claims WHERE id = ?').get(id)) as
      | { id: number; ref: string; employee_name: string; claim_date: string; total_amount: number; status: string }
      | undefined;
    if (!claim) {
      res.status(404).json({ error: 'Mileage claim not found.' });
      return;
    }
    if (claim.status === 'paid') {
      res.status(400).json({ error: 'Mileage claim is already reimbursed.' });
      return;
    }
    const bankId = Number(req.body?.bankAccountId);
    if (!bankId) {
      res.status(400).json({ error: 'Select a bank/cash account to reimburse mileage.' });
      return;
    }
    await db.exec('BEGIN');
    try {
      await db.prepare(`UPDATE mileage_claims SET status = 'paid', bank_account_id = ? WHERE id = ?`).run(bankId, id);
      await db.prepare(`UPDATE bank_accounts SET balance = balance - ? WHERE id = ?`).run(claim.total_amount, bankId);
      await db
        .prepare(
          `INSERT INTO bank_transactions (bank_account_id, tx_date, label, category, amount, direction, invoice_ref, reconciled, reconciled_at, gl_account_code, created_by)
           VALUES (?, ?, ?, 'Mileage Reimbursement', ?, 'debit', ?, 1, ?, '6400', ?)`
        )
        .run(
          bankId,
          new Date().toISOString().slice(0, 10),
          `Mileage ${claim.ref} — ${claim.employee_name}`,
          claim.total_amount,
          claim.ref,
          new Date().toISOString().slice(0, 10),
          req.authUser!.email
        );
      await postAutoJournalEntry({
        journalCode: 'MIL',
        description: `Mileage Reimbursement ${claim.ref} — ${claim.employee_name}`,
        debitAccountCode: '6400',
        creditAccountCode: '1010',
        amount: claim.total_amount,
        sourceRef: claim.ref,
        actorEmail: req.authUser!.email,
      });
      await db.exec('COMMIT');
      await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'REIMBURSE_MILEAGE',
        module: 'billing',
        entityRef: claim.ref,
        details: `Reimbursed mileage claim ${claim.ref} ($${claim.total_amount.toFixed(2)})`,
        ipAddress: getClientIp(req),
      });
      res.json(await db.prepare('SELECT * FROM mileage_claims WHERE id = ?').get(id));
    } catch (err) {
      await db.exec('ROLLBACK');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to reimburse mileage.' });
    }
  });

  router.delete('/mileage-claims/:id', authenticate, requirePermission('billing', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref, status FROM mileage_claims WHERE id = ?').get(id)) as
      | { ref: string; status: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Mileage claim not found.' });
      return;
    }
    if (existing.status === 'paid') {
      res.status(400).json({ error: 'Paid mileage claims cannot be deleted.' });
      return;
    }
    await db.prepare('DELETE FROM mileage_claims WHERE id = ?').run(id);
    await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_MILEAGE_CLAIM',
      module: 'billing',
      entityRef: existing.ref,
      details: `Deleted mileage claim ${existing.ref}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    });
    res.json({ ok: true });
  });

  // AI Finance Partner endpoint scoped to billing permission
  router.post('/billing/ai-partner', authenticate, requirePermission('billing', 'read'), async (req: AuthenticatedReq, res) => {
    const { prompt } = req.body ?? {};
    if (!String(prompt ?? '').trim()) {
      res.status(400).json({ error: 'Question or analysis prompt is required.' });
      return;
    }
    try {
      const result = await runErpAiAssist(db, env, {
        taskType: 'finance_partner',
        prompt: String(prompt).trim(),
      });
      await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'AI_FINANCE_PARTNER_QUERY',
        module: 'billing',
        entityRef: 'finance_partner',
        details: `Ran AI Finance Partner query via ${result.model}`,
        ipAddress: getClientIp(req),
      });
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'AI Finance Partner request failed.' });
    }
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

  router.post('/accounting/journal', authenticate, requirePermission('billing', 'write'), async (req: AuthenticatedReq, res) => {
    const { entryDate, journalCode = 'GEN', description, debitAccountCode, creditAccountCode, amount, sourceRef = '' } = req.body ?? {};
    const amt = Number(amount);
    if (!String(description ?? '').trim() || !debitAccountCode || !creditAccountCode || !Number.isFinite(amt) || amt <= 0) {
      res.status(400).json({ error: 'Description, debit/credit accounts, and positive amount are required.' });
      return;
    }
    if (debitAccountCode === creditAccountCode) {
      res.status(400).json({ error: 'Debit and credit accounts must be distinct for balanced double-entry.' });
      return;
    }
    const ref = (await seqRef('journal_entries', 'JRN'));
    (await db.exec('BEGIN'));
    try {
      const info = (await db
        .prepare(
          `INSERT INTO journal_entries (ref, entry_date, journal_code, description, debit_account_code, credit_account_code, amount, source_ref, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          ref,
          String(entryDate || new Date().toISOString().slice(0, 10)),
          String(journalCode).trim().toUpperCase() || 'GEN',
          String(description).trim(),
          String(debitAccountCode),
          String(creditAccountCode),
          amt,
          String(sourceRef).trim(),
          req.authUser!.email
        ));
      (await db.prepare('UPDATE accounting_accounts SET balance = balance + ? WHERE code = ?').run(amt, String(debitAccountCode)));
      (await db.prepare('UPDATE accounting_accounts SET balance = balance - ? WHERE code = ?').run(amt, String(creditAccountCode)));
      (await db.exec('COMMIT'));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'POST_JOURNAL_ENTRY',
        module: 'billing',
        entityRef: ref,
        details: `Posted ${journalCode} entry ${ref}: DR ${debitAccountCode} / CR ${creditAccountCode} $${amt.toFixed(2)}`,
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
          source_ref: string;
        }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Journal entry not found.' });
      return;
    }
    const { entryDate, journalCode, description, debitAccountCode, creditAccountCode, amount, sourceRef } = req.body ?? {};
    const nextDebit = debitAccountCode ? String(debitAccountCode) : existing.debit_account_code;
    const nextCredit = creditAccountCode ? String(creditAccountCode) : existing.credit_account_code;
    const nextAmt = amount !== undefined ? Number(amount) : existing.amount;
    if (!Number.isFinite(nextAmt) || nextAmt <= 0 || nextDebit === nextCredit) {
      res.status(400).json({ error: 'Distinct debit/credit accounts and positive amount are required.' });
      return;
    }
    (await db.exec('BEGIN'));
    try {
      // Reverse previous GL impact, then apply updated GL impact
      (await db.prepare('UPDATE accounting_accounts SET balance = balance - ? WHERE code = ?').run(existing.amount, existing.debit_account_code));
      (await db.prepare('UPDATE accounting_accounts SET balance = balance + ? WHERE code = ?').run(existing.amount, existing.credit_account_code));
      (await db.prepare(
        `UPDATE journal_entries
         SET entry_date = ?,
             journal_code = ?,
             description = ?,
             debit_account_code = ?,
             credit_account_code = ?,
             amount = ?,
             source_ref = ?
         WHERE id = ?`
      ).run(
        entryDate ? String(entryDate) : existing.entry_date,
        journalCode ? String(journalCode).trim().toUpperCase() : existing.journal_code,
        description ? String(description).trim() : existing.description,
        nextDebit,
        nextCredit,
        nextAmt,
        sourceRef !== undefined ? String(sourceRef).trim() : existing.source_ref,
        id
      ));
      (await db.prepare('UPDATE accounting_accounts SET balance = balance + ? WHERE code = ?').run(nextAmt, nextDebit));
      (await db.prepare('UPDATE accounting_accounts SET balance = balance - ? WHERE code = ?').run(nextAmt, nextCredit));
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

  router.delete('/accounting/journal/:id', authenticate, requirePermission('billing', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id)) as
      | { id: number; ref: string; debit_account_code: string; credit_account_code: string; amount: number }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Journal entry not found.' });
      return;
    }
    (await db.exec('BEGIN'));
    try {
      (await db.prepare('UPDATE accounting_accounts SET balance = balance - ? WHERE code = ?').run(existing.amount, existing.debit_account_code));
      (await db.prepare('UPDATE accounting_accounts SET balance = balance + ? WHERE code = ?').run(existing.amount, existing.credit_account_code));
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
  // HR MANAGEMENT
  // ========================
  router.get('/hr', authenticate, requirePermission('hr', 'read'), async (_req, res) => {
    const employees = (await db.prepare('SELECT * FROM employees ORDER BY id ASC').all());
    const leaveRequests = (await db
      .prepare(
        `SELECT lr.*, e.full_name AS employee_name, e.department
         FROM leave_requests lr
         JOIN employees e ON e.id = lr.employee_id
         ORDER BY lr.id DESC`
      )
      .all());
    const expenseReports = (await db
      .prepare(
        `SELECT er.*, e.full_name AS employee_name, e.department
         FROM expense_reports er
         JOIN employees e ON e.id = er.employee_id
         ORDER BY er.id DESC`
      )
      .all());
    const jobs = (await db.prepare('SELECT * FROM job_postings ORDER BY id DESC').all());
    const candidates = (await db
      .prepare(
        `SELECT c.*, j.title AS job_title, j.ref AS job_ref
         FROM candidates c
         JOIN job_postings j ON j.id = c.job_id
         ORDER BY c.id DESC`
      )
      .all());
    const timesheets = (await db
      .prepare(
        `SELECT ts.*, e.full_name AS employee_name, pr.ref AS project_ref, pr.title AS project_title
         FROM timesheets ts
         JOIN employees e ON e.id = ts.employee_id
         LEFT JOIN projects pr ON pr.id = ts.project_id
         ORDER BY ts.work_date DESC, ts.id DESC`
      )
      .all());
    res.json({ employees, leaveRequests, expenseReports, jobs, candidates, timesheets });
  });

  router.post('/employees', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const { fullName, email, phone = '', department = 'Operations', jobTitle = '', hireDate, annualSalary = 75000, leaveBalanceDays = 20 } = req.body ?? {};
    if (!String(fullName ?? '').trim() || !String(email ?? '').trim()) {
      res.status(400).json({ error: 'Employee name and email are required.' });
      return;
    }
    const ref = (await seqRef('employees', 'EMP'));
    const info = (await db
      .prepare(
        `INSERT INTO employees (ref, full_name, email, phone, department, job_title, hire_date, annual_salary, leave_balance_days, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
      )
      .run(
        ref,
        String(fullName).trim(),
        String(email).trim(),
        String(phone).trim(),
        String(department).trim(),
        String(jobTitle).trim(),
        String(hireDate || new Date().toISOString().slice(0, 10)),
        Number(annualSalary) || 0,
        Number(leaveBalanceDays) || 20
      ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'CREATE_EMPLOYEE',
      module: 'hr',
      entityRef: ref,
      details: `Onboarded staff member ${fullName}`,
      ipAddress: getClientIp(req),
    }));
    res.status(201).json((await db.prepare('SELECT * FROM employees WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/employees/:id', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM employees WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Employee not found.' });
      return;
    }
    const { fullName, email, phone, department, jobTitle, hireDate, annualSalary, leaveBalanceDays, status } = req.body ?? {};
    (await db.prepare(
      `UPDATE employees
       SET full_name = COALESCE(?, full_name),
           email = COALESCE(?, email),
           phone = COALESCE(?, phone),
           department = COALESCE(?, department),
           job_title = COALESCE(?, job_title),
           hire_date = COALESCE(?, hire_date),
           annual_salary = COALESCE(?, annual_salary),
           leave_balance_days = COALESCE(?, leave_balance_days),
           status = COALESCE(?, status)
       WHERE id = ?`
    ).run(
      fullName ? String(fullName).trim() : null,
      email ? String(email).trim() : null,
      phone !== undefined ? String(phone).trim() : null,
      department ? String(department).trim() : null,
      jobTitle !== undefined ? String(jobTitle).trim() : null,
      hireDate ? String(hireDate) : null,
      annualSalary !== undefined ? Number(annualSalary) : null,
      leaveBalanceDays !== undefined ? Number(leaveBalanceDays) : null,
      ['active', 'on_leave', 'terminated'].includes(status) ? status : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_EMPLOYEE',
      module: 'hr',
      entityRef: existing.ref,
      details: `Updated employee ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM employees WHERE id = ?').get(id)));
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
    (await db.prepare('DELETE FROM employees WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_EMPLOYEE',
      module: 'hr',
      entityRef: existing.ref,
      details: `Deleted employee ${existing.full_name}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.post('/leave-requests', authenticate, requirePermission('hr', 'write'), async (req, res) => {
    const { employeeId, leaveType = 'Paid Time Off', startDate, endDate, days = 1, reason = '' } = req.body ?? {};
    if (!employeeId || !startDate || !endDate) {
      res.status(400).json({ error: 'Employee, start date, and end date are required.' });
      return;
    }
    const ref = (await seqRef('leave_requests', 'LVR'));
    const info = (await db
      .prepare(
        `INSERT INTO leave_requests (ref, employee_id, leave_type, start_date, end_date, days, reason, status, reviewed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', '')`
      )
      .run(ref, Number(employeeId), leaveType, String(startDate), String(endDate), Math.max(0.5, Number(days) || 1), String(reason).trim()));
    res.status(201).json((await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/leave-requests/:id', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM leave_requests WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Leave request not found.' });
      return;
    }
    const { employeeId, leaveType, startDate, endDate, days, reason } = req.body ?? {};
    (await db.prepare(
      `UPDATE leave_requests
       SET employee_id = COALESCE(?, employee_id),
           leave_type = COALESCE(?, leave_type),
           start_date = COALESCE(?, start_date),
           end_date = COALESCE(?, end_date),
           days = COALESCE(?, days),
           reason = COALESCE(?, reason)
       WHERE id = ?`
    ).run(
      employeeId !== undefined ? Number(employeeId) : null,
      ['Paid Time Off', 'Sick Leave', 'Parental', 'Parental Leave', 'Unpaid', 'Unpaid Leave'].includes(leaveType) ? leaveType : null,
      startDate ? String(startDate) : null,
      endDate ? String(endDate) : null,
      days !== undefined ? Math.max(0.5, Number(days) || 1) : null,
      reason !== undefined ? String(reason).trim() : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_LEAVE_REQUEST',
      module: 'hr',
      entityRef: existing.ref,
      details: `Updated leave request ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id)));
  });

  router.delete('/leave-requests/:id', authenticate, requirePermission('hr', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM leave_requests WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Leave request not found.' });
      return;
    }
    (await db.prepare('DELETE FROM leave_requests WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_LEAVE_REQUEST',
      module: 'hr',
      entityRef: existing.ref,
      details: `Deleted leave request ${existing.ref}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
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
    (await db.exec('BEGIN'));
    try {
      (await db.prepare('UPDATE leave_requests SET status = ?, reviewed_by = ? WHERE id = ?').run(decision, req.authUser!.email, id));
      if (decision === 'approved') {
        (await db.prepare('UPDATE employees SET leave_balance_days = MAX(0, leave_balance_days - ?) WHERE id = ?').run(lr.days, lr.employee_id));
      }
      (await db.exec('COMMIT'));
      (await writeAuditLog(db, {
        userId: req.authUser!.id,
        userEmail: req.authUser!.email,
        action: 'DECIDE_LEAVE_REQUEST',
        module: 'hr',
        entityRef: lr.ref,
        details: `${decision.toUpperCase()} leave request ${lr.ref} (${lr.days} days)`,
        ipAddress: getClientIp(req),
      }));
      res.json((await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id)));
    } catch (err) {
      (await db.exec('ROLLBACK'));
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to decide leave.' });
    }
  });

  router.post('/expense-reports', authenticate, requirePermission('hr', 'write'), async (req, res) => {
    const { employeeId, category = 'Travel', expenseDate, amount, taxAmount = 0, description = '' } = req.body ?? {};
    const amt = Number(amount);
    if (!employeeId || !Number.isFinite(amt) || amt <= 0) {
      res.status(400).json({ error: 'Employee and positive expense amount are required.' });
      return;
    }
    const ref = (await seqRef('expense_reports', 'EXP'));
    const info = (await db
      .prepare(
        `INSERT INTO expense_reports (ref, employee_id, category, expense_date, amount, tax_amount, description, status, approved_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', '')`
      )
      .run(ref, Number(employeeId), String(category).trim(), String(expenseDate || new Date().toISOString().slice(0, 10)), amt, Number(taxAmount) || 0, String(description).trim()));
    res.status(201).json((await db.prepare('SELECT * FROM expense_reports WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/expense-reports/:id', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM expense_reports WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Expense report not found.' });
      return;
    }
    const { employeeId, category, expenseDate, amount, taxAmount, description } = req.body ?? {};
    (await db.prepare(
      `UPDATE expense_reports
       SET employee_id = COALESCE(?, employee_id),
           category = COALESCE(?, category),
           expense_date = COALESCE(?, expense_date),
           amount = COALESCE(?, amount),
           tax_amount = COALESCE(?, tax_amount),
           description = COALESCE(?, description)
       WHERE id = ?`
    ).run(
      employeeId !== undefined ? Number(employeeId) : null,
      category ? String(category).trim() : null,
      expenseDate ? String(expenseDate) : null,
      amount !== undefined ? Number(amount) : null,
      taxAmount !== undefined ? Number(taxAmount) : null,
      description !== undefined ? String(description).trim() : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_EXPENSE_REPORT',
      module: 'hr',
      entityRef: existing.ref,
      details: `Updated expense report ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM expense_reports WHERE id = ?').get(id)));
  });

  router.delete('/expense-reports/:id', authenticate, requirePermission('hr', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM expense_reports WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Expense report not found.' });
      return;
    }
    (await db.prepare('DELETE FROM expense_reports WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_EXPENSE_REPORT',
      module: 'hr',
      entityRef: existing.ref,
      details: `Deleted expense report ${existing.ref}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.post('/expense-reports/:id/decide', authenticate, requirePermission('hr', 'validate'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const { status } = req.body ?? {};
    if (!['approved', 'paid', 'rejected'].includes(status)) {
      res.status(400).json({ error: 'Invalid expense status.' });
      return;
    }
    (await db.prepare('UPDATE expense_reports SET status = ?, approved_by = ? WHERE id = ?').run(status, req.authUser!.email, id));
    res.json((await db.prepare('SELECT * FROM expense_reports WHERE id = ?').get(id)));
  });

  router.post('/recruitment/jobs', authenticate, requirePermission('hr', 'write'), async (req, res) => {
    const { title, department = 'Engineering', location = 'Remote / HQ', contractType = 'Full-Time', description = '' } = req.body ?? {};
    if (!String(title ?? '').trim()) {
      res.status(400).json({ error: 'Job title is required.' });
      return;
    }
    const ref = (await seqRef('job_postings', 'JOB'));
    const info = (await db
      .prepare(
        `INSERT INTO job_postings (ref, title, department, location, contract_type, status, description)
         VALUES (?, ?, ?, ?, ?, 'open', ?)`
      )
      .run(ref, String(title).trim(), String(department).trim(), String(location).trim(), String(contractType).trim(), String(description).trim()));
    res.status(201).json((await db.prepare('SELECT * FROM job_postings WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/recruitment/jobs/:id', authenticate, requirePermission('hr', 'write'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT ref FROM job_postings WHERE id = ?').get(id)) as { ref: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Job posting not found.' });
      return;
    }
    const { title, department, location, contractType, status, description } = req.body ?? {};
    (await db.prepare(
      `UPDATE job_postings
       SET title = COALESCE(?, title),
           department = COALESCE(?, department),
           location = COALESCE(?, location),
           contract_type = COALESCE(?, contract_type),
           status = COALESCE(?, status),
           description = COALESCE(?, description)
       WHERE id = ?`
    ).run(
      title ? String(title).trim() : null,
      department ? String(department).trim() : null,
      location !== undefined ? String(location).trim() : null,
      contractType ? String(contractType).trim() : null,
      ['draft', 'open', 'closed'].includes(status) ? status : null,
      description !== undefined ? String(description).trim() : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_JOB_POSTING',
      module: 'hr',
      entityRef: existing.ref,
      details: `Updated job posting ${existing.ref}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM job_postings WHERE id = ?').get(id)));
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
    (await db.prepare('DELETE FROM job_postings WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_JOB_POSTING',
      module: 'hr',
      entityRef: existing.ref,
      details: `Deleted job posting ${existing.title}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.post('/recruitment/candidates', authenticate, requirePermission('hr', 'write'), async (req, res) => {
    const { jobId, fullName, email, phone = '', stage = 'applied', notes = '' } = req.body ?? {};
    if (!jobId || !String(fullName ?? '').trim() || !String(email ?? '').trim()) {
      res.status(400).json({ error: 'Job posting, candidate name, and email are required.' });
      return;
    }
    const info = (await db
      .prepare(`INSERT INTO candidates (job_id, full_name, email, phone, stage, notes) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(Number(jobId), String(fullName).trim(), String(email).trim(), String(phone).trim(), stage, String(notes).trim()));
    res.status(201).json((await db.prepare('SELECT * FROM candidates WHERE id = ?').get(info.lastInsertRowid)));
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
    (await db.prepare(
      `UPDATE candidates
       SET job_id = COALESCE(?, job_id),
           full_name = COALESCE(?, full_name),
           email = COALESCE(?, email),
           phone = COALESCE(?, phone),
           stage = COALESCE(?, stage),
           notes = COALESCE(?, notes)
       WHERE id = ?`
    ).run(
      jobId !== undefined ? Number(jobId) : null,
      fullName ? String(fullName).trim() : null,
      email ? String(email).trim() : null,
      phone !== undefined ? String(phone).trim() : null,
      stage ?? null,
      notes !== undefined ? String(notes).trim() : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_CANDIDATE',
      module: 'hr',
      entityRef: `CND-${id}`,
      details: `Updated candidate ${fullName ?? existing.full_name}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM candidates WHERE id = ?').get(id)));
  });

  router.delete('/recruitment/candidates/:id', authenticate, requirePermission('hr', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT full_name FROM candidates WHERE id = ?').get(id)) as { full_name: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Candidate not found.' });
      return;
    }
    (await db.prepare('DELETE FROM candidates WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_CANDIDATE',
      module: 'hr',
      entityRef: `CND-${id}`,
      details: `Deleted candidate ${existing.full_name}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
    res.json({ ok: true });
  });

  router.post('/timesheets', authenticate, requirePermission('hr', 'write'), async (req, res) => {
    const { employeeId, projectId = null, workDate, hours = 8, taskLabel = '', billable = true } = req.body ?? {};
    if (!employeeId || !Number.isFinite(Number(hours)) || Number(hours) <= 0) {
      res.status(400).json({ error: 'Employee and positive hours are required.' });
      return;
    }
    const info = (await db
      .prepare(`INSERT INTO timesheets (employee_id, project_id, work_date, hours, task_label, billable) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        Number(employeeId),
        projectId ? Number(projectId) : null,
        String(workDate || new Date().toISOString().slice(0, 10)),
        Number(hours),
        String(taskLabel).trim(),
        billable ? 1 : 0
      ));
    res.status(201).json((await db.prepare('SELECT * FROM timesheets WHERE id = ?').get(info.lastInsertRowid)));
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
    (await db.prepare(
      `UPDATE timesheets
       SET employee_id = COALESCE(?, employee_id),
           project_id = ?,
           work_date = COALESCE(?, work_date),
           hours = COALESCE(?, hours),
           task_label = COALESCE(?, task_label),
           billable = COALESCE(?, billable)
       WHERE id = ?`
    ).run(
      employeeId !== undefined ? Number(employeeId) : null,
      nextProjectId,
      workDate ? String(workDate) : null,
      hours !== undefined ? Math.max(0.25, Number(hours) || 1) : null,
      taskLabel !== undefined ? String(taskLabel).trim() : null,
      billable !== undefined ? (billable ? 1 : 0) : null,
      id
    ));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'UPDATE_TIMESHEET',
      module: 'hr',
      entityRef: `TS-${id}`,
      details: `Updated timesheet entry #${id}`,
      ipAddress: getClientIp(req),
    }));
    res.json((await db.prepare('SELECT * FROM timesheets WHERE id = ?').get(id)));
  });

  router.delete('/timesheets/:id', authenticate, requirePermission('hr', 'delete'), async (req: AuthenticatedReq, res) => {
    const id = Number(req.params.id);
    const existing = (await db.prepare('SELECT task_label FROM timesheets WHERE id = ?').get(id)) as { task_label: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Timesheet entry not found.' });
      return;
    }
    (await db.prepare('DELETE FROM timesheets WHERE id = ?').run(id));
    (await writeAuditLog(db, {
      userId: req.authUser!.id,
      userEmail: req.authUser!.email,
      action: 'DELETE_TIMESHEET',
      module: 'hr',
      entityRef: `TS-${id}`,
      details: `Deleted timesheet entry #${id}`,
      ipAddress: getClientIp(req),
      severity: 'warning',
    }));
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
    const allowedTasks = new Set(['executive_brief', 'ticket_reply', 'proposal_scope', 'email_campaign', 'custom_qa', 'finance_partner']);
    const cleanTask = allowedTasks.has(taskType) ? taskType : 'custom_qa';
    try {
      const result = await runErpAiAssist(db, env, {
        taskType: cleanTask as 'executive_brief' | 'ticket_reply' | 'proposal_scope' | 'email_campaign' | 'custom_qa' | 'finance_partner',
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

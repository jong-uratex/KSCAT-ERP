import { useEffect, useState, type FormEvent } from 'react';
import { Cpu, Factory, Layers, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { apiRequest, can } from '../lib/api';
import { formatCurrency, formatDate } from '../lib/format';
import type {
  BomItem,
  ManufacturingOrder,
  PermissionMap,
  ProductItem,
  Warehouse,
  WorkstationItem,
} from '../types/erp';
import { ConfirmDeleteModal, Modal } from './Modal';
import { StatusText } from './StatusText';

interface ManufacturingViewProps {
  permissions: PermissionMap;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export function ManufacturingView({ permissions, onNotify }: ManufacturingViewProps) {
  const [tab, setTab] = useState<'orders' | 'boms' | 'workstations'>('orders');
  const [orders, setOrders] = useState<ManufacturingOrder[]>([]);
  const [boms, setBoms] = useState<BomItem[]>([]);
  const [workstations, setWorkstations] = useState<WorkstationItem[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);

  const [moModal, setMoModal] = useState(false);
  const [editingMo, setEditingMo] = useState<ManufacturingOrder | null>(null);
  const [moBomId, setMoBomId] = useState('');
  const [moWhId, setMoWhId] = useState('');
  const [moQty, setMoQty] = useState('5');
  const [moDate, setMoDate] = useState('');
  const [moStatus, setMoStatus] = useState<ManufacturingOrder['status']>('validated');
  const [moNotes, setMoNotes] = useState('');

  const [bomModal, setBomModal] = useState(false);
  const [editingBom, setEditingBom] = useState<BomItem | null>(null);
  const [bomProductId, setBomProductId] = useState('');
  const [bomWsId, setBomWsId] = useState('');
  const [bomLabel, setBomLabel] = useState('');
  const [bomOutQty, setBomOutQty] = useState('1');
  const [bomMinutes, setBomMinutes] = useState('45');
  const [bomStatus, setBomStatus] = useState<BomItem['status']>('active');
  const [bomComps, setBomComps] = useState<Array<{ productId: string; qty: string }>>([
    { productId: '', qty: '2' },
  ]);

  const [wsModal, setWsModal] = useState(false);
  const [editingWs, setEditingWs] = useState<WorkstationItem | null>(null);
  const [wsRef, setWsRef] = useState('');
  const [wsName, setWsName] = useState('');
  const [wsLoc, setWsLoc] = useState('');
  const [wsCost, setWsCost] = useState('75');
  const [wsCap, setWsCap] = useState('8');
  const [wsStatus, setWsStatus] = useState<WorkstationItem['status']>('operational');

  const [deleteTarget, setDeleteTarget] = useState<{ endpoint: string; label: string; warning?: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const canWrite = can(permissions, 'manufacturing', 'write');
  const canValidate = can(permissions, 'manufacturing', 'validate');
  const canDelete = can(permissions, 'manufacturing', 'delete');

  async function loadManufacturing() {
    setLoading(true);
    try {
      const [mfgRes, prodRes] = await Promise.all([
        apiRequest<{ workstations: WorkstationItem[]; boms: BomItem[]; orders: ManufacturingOrder[] }>(
          '/api/manufacturing'
        ),
        apiRequest<{ products: ProductItem[]; warehouses: Warehouse[] }>('/api/products'),
      ]);
      setWorkstations(mfgRes.workstations);
      setBoms(mfgRes.boms);
      setOrders(mfgRes.orders);
      setProducts(prodRes.products);
      setWarehouses(prodRes.warehouses);
      if (mfgRes.boms[0] && !moBomId) setMoBomId(String(mfgRes.boms[0].id));
      if (prodRes.warehouses[0] && !moWhId) setMoWhId(String(prodRes.warehouses[0].id));
      if (prodRes.products[0]) {
        if (!bomProductId) setBomProductId(String(prodRes.products[0].id));
        if (!bomComps[0].productId) {
          setBomComps([{ productId: String(prodRes.products[0].id), qty: '2' }]);
        }
      }
      if (mfgRes.workstations[0] && !bomWsId) setBomWsId(String(mfgRes.workstations[0].id));
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to load manufacturing data.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadManufacturing();
  }, []);

  function openCreateMo() {
    setEditingMo(null);
    if (boms[0]) setMoBomId(String(boms[0].id));
    if (warehouses[0]) setMoWhId(String(warehouses[0].id));
    setMoQty('5');
    setMoDate('');
    setMoStatus('validated');
    setMoNotes('');
    setMoModal(true);
  }

  function openEditMo(mo: ManufacturingOrder) {
    setEditingMo(mo);
    setMoBomId(String(mo.bom_id));
    setMoWhId(String(mo.warehouse_id));
    setMoQty(String(mo.qty_planned));
    setMoDate(mo.scheduled_date);
    setMoStatus(mo.status);
    setMoNotes(mo.notes);
    setMoModal(true);
  }

  async function handleSaveMo(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingMo) {
        await apiRequest(`/api/manufacturing-orders/${editingMo.id}`, {
          method: 'PUT',
          body: {
            warehouseId: Number(moWhId),
            qtyPlanned: Number(moQty) || 1,
            scheduledDate: moDate || undefined,
            status: moStatus,
            notes: moNotes,
          },
        });
        onNotify(`Updated ${editingMo.ref}.`);
      } else {
        await apiRequest('/api/manufacturing-orders', {
          method: 'POST',
          body: {
            bomId: Number(moBomId),
            warehouseId: Number(moWhId),
            qtyPlanned: Number(moQty) || 1,
            scheduledDate: moDate || undefined,
            notes: moNotes,
          },
        });
        onNotify('Manufacturing order scheduled.');
      }
      setMoModal(false);
      setEditingMo(null);
      await loadManufacturing();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save MO.', 'error');
    }
  }

  async function handleProduceMo(id: number) {
    try {
      await apiRequest(`/api/manufacturing-orders/${id}/produce`, { method: 'POST', body: {} });
      onNotify('Production batch completed: raw materials consumed and finished goods stocked.');
      await loadManufacturing();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Production run failed.', 'error');
    }
  }

  function openCreateBom() {
    setEditingBom(null);
    if (products[0]) setBomProductId(String(products[0].id));
    setBomWsId(workstations[0] ? String(workstations[0].id) : '');
    setBomLabel('');
    setBomOutQty('1');
    setBomMinutes('45');
    setBomStatus('active');
    setBomComps([{ productId: products[0] ? String(products[0].id) : '', qty: '2' }]);
    setBomModal(true);
  }

  function openEditBom(b: BomItem) {
    let parsed: Array<{ productId?: number; qty: number }> = [];
    try {
      parsed = JSON.parse(b.components_json || '[]');
    } catch {
      parsed = [];
    }
    setEditingBom(b);
    setBomProductId(String(b.product_id));
    setBomWsId(b.workstation_id ? String(b.workstation_id) : '');
    setBomLabel(b.label);
    setBomOutQty(String(b.output_qty));
    setBomMinutes(String(b.estimated_minutes));
    setBomStatus(b.status);
    setBomComps(
      parsed.length > 0
        ? parsed.map((c) => ({ productId: String(c.productId ?? ''), qty: String(c.qty ?? 1) }))
        : [{ productId: products[0] ? String(products[0].id) : '', qty: '1' }]
    );
    setBomModal(true);
  }

  async function handleSaveBom(e: FormEvent) {
    e.preventDefault();
    try {
      const body = {
        productId: Number(bomProductId),
        workstationId: bomWsId ? Number(bomWsId) : null,
        label: bomLabel,
        outputQty: Number(bomOutQty) || 1,
        estimatedMinutes: Number(bomMinutes) || 45,
        status: bomStatus,
        components: bomComps
          .filter((c) => c.productId)
          .map((c) => ({ productId: Number(c.productId), qty: Number(c.qty) || 1 })),
      };
      if (editingBom) {
        await apiRequest(`/api/boms/${editingBom.id}`, { method: 'PUT', body });
        onNotify(`Updated BOM ${editingBom.ref}.`);
      } else {
        await apiRequest('/api/boms', { method: 'POST', body });
        onNotify('Bill of Materials created.');
      }
      setBomModal(false);
      setEditingBom(null);
      await loadManufacturing();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save BOM.', 'error');
    }
  }

  function openCreateWs() {
    setEditingWs(null);
    setWsRef('');
    setWsName('');
    setWsLoc('');
    setWsCost('75');
    setWsCap('8');
    setWsStatus('operational');
    setWsModal(true);
  }

  function openEditWs(w: WorkstationItem) {
    setEditingWs(w);
    setWsRef(w.ref);
    setWsName(w.name);
    setWsLoc(w.location);
    setWsCost(String(w.hourly_cost));
    setWsCap(String(w.capacity_per_day));
    setWsStatus(w.status);
    setWsModal(true);
  }

  async function handleSaveWorkstation(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingWs) {
        await apiRequest(`/api/workstations/${editingWs.id}`, {
          method: 'PUT',
          body: {
            name: wsName,
            location: wsLoc,
            hourlyCost: Number(wsCost) || 65,
            capacityPerDay: Number(wsCap) || 8,
            status: wsStatus,
          },
        });
        onNotify(`Updated workstation ${editingWs.ref}.`);
      } else {
        await apiRequest('/api/workstations', {
          method: 'POST',
          body: {
            ref: wsRef,
            name: wsName,
            location: wsLoc,
            hourlyCost: Number(wsCost) || 65,
            capacityPerDay: Number(wsCap) || 8,
          },
        });
        onNotify('Workstation registered.');
      }
      setWsModal(false);
      setEditingWs(null);
      await loadManufacturing();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save workstation.', 'error');
    }
  }

  function promptDelete(endpoint: string, label: string, warning?: string) {
    setDeleteError('');
    setDeleteTarget({ endpoint, label, warning });
  }

  async function executeDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setDeleteError('');
    try {
      await apiRequest(deleteTarget.endpoint, { method: 'DELETE' });
      onNotify(`${deleteTarget.label} deleted.`);
      setDeleteTarget(null);
      await loadManufacturing();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-zinc-200/70 dark:bg-zinc-800 self-start">
          <button
            type="button"
            onClick={() => setTab('orders')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
              tab === 'orders'
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <Factory className="w-3.5 h-3.5" />
            <span>Manufacturing Orders ({orders.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('boms')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
              tab === 'boms'
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Bills of Materials ({boms.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('workstations')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
              tab === 'workstations'
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>Workstations ({workstations.length})</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {tab === 'orders' && canWrite && (
            <button
              type="button"
              onClick={openCreateMo}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Manufacturing Order</span>
            </button>
          )}
          {tab === 'boms' && canWrite && (
            <button
              type="button"
              onClick={openCreateBom}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New BOM</span>
            </button>
          )}
          {tab === 'workstations' && canWrite && (
            <button
              type="button"
              onClick={openCreateWs}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Workstation</span>
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-zinc-500">Loading production records...</div>
        ) : tab === 'orders' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-xs text-zinc-500">
                  <th className="py-3 px-4 font-medium">MO Ref</th>
                  <th className="py-3 px-4 font-medium">Finished Good · BOM</th>
                  <th className="py-3 px-4 font-medium">Warehouse · Workstation</th>
                  <th className="py-3 px-4 font-medium">Scheduled</th>
                  <th className="py-3 px-4 font-medium text-right">Qty (Produced/Plan)</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {orders.map((mo) => (
                  <tr key={mo.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="py-3 px-4 font-mono text-xs font-medium text-orange-700 dark:text-orange-400">
                      {mo.ref}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">
                        {mo.product_ref} — {mo.product_name}
                      </div>
                      <div className="text-[11px] font-mono text-zinc-500">
                        {mo.bom_ref} · {mo.bom_label}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-600 dark:text-zinc-400">
                      <div>{mo.warehouse_name}</div>
                      <div className="text-[11px] text-zinc-500">{mo.workstation_name || 'Unassigned'}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-zinc-500">{formatDate(mo.scheduled_date)}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-right font-medium">
                      {mo.qty_produced} / {mo.qty_planned}
                    </td>
                    <td className="py-3 px-4">
                      <StatusText status={mo.status} />
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2 justify-end">
                        {canValidate && mo.status !== 'produced' && mo.status !== 'cancelled' && (
                          <button
                            type="button"
                            onClick={() => handleProduceMo(mo.id)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline mr-1"
                          >
                            <Play className="w-3.5 h-3.5" />
                            <span>Produce Batch</span>
                          </button>
                        )}
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => openEditMo(mo)}
                            title="Edit manufacturing order"
                            className="p-1.5 rounded-lg text-zinc-500 hover:text-orange-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && mo.status !== 'produced' && (
                          <button
                            type="button"
                            onClick={() => promptDelete(`/api/manufacturing-orders/${mo.id}`, `MO ${mo.ref}`)}
                            title="Delete manufacturing order"
                            className="p-1.5 rounded-lg text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
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
        ) : tab === 'boms' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-xs text-zinc-500">
                  <th className="py-3 px-4 font-medium">BOM Ref</th>
                  <th className="py-3 px-4 font-medium">Finished Item · Label</th>
                  <th className="py-3 px-4 font-medium">Workstation</th>
                  <th className="py-3 px-4 font-medium">Raw Components</th>
                  <th className="py-3 px-4 font-medium text-right">Output</th>
                  <th className="py-3 px-4 font-medium text-right">Cycle Time</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  {(canWrite || canDelete) && <th className="py-3 px-4 font-medium text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {boms.map((b) => {
                  const comps = JSON.parse(b.components_json || '[]') as Array<{
                    ref: string;
                    name: string;
                    qty: number;
                  }>;
                  return (
                    <tr key={b.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <td className="py-3 px-4 font-mono text-xs font-medium text-orange-700 dark:text-orange-400">
                        {b.ref}
                      </td>
                      <td className="py-3 px-4 text-xs">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">{b.label}</div>
                        <div className="font-mono text-[11px] text-zinc-500">
                          {b.product_ref} · {b.product_name}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-zinc-600 dark:text-zinc-400">
                        {b.workstation_name || '—'}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-zinc-600 dark:text-zinc-300">
                        {comps.map((c) => `${c.qty}x ${c.ref}`).join(', ')}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-right">{b.output_qty}</td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-right">{b.estimated_minutes}m</td>
                      <td className="py-3 px-4">
                        <StatusText status={b.status} />
                      </td>
                      {(canWrite || canDelete) && (
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1 justify-end">
                            {canWrite && (
                              <button
                                type="button"
                                onClick={() => openEditBom(b)}
                                title="Edit BOM"
                                className="p-1.5 rounded-lg text-zinc-500 hover:text-orange-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() => promptDelete(`/api/boms/${b.id}`, `BOM ${b.ref}`)}
                                title="Delete BOM"
                                className="p-1.5 rounded-lg text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-xs text-zinc-500">
                  <th className="py-3 px-4 font-medium">Ref</th>
                  <th className="py-3 px-4 font-medium">Workstation / Line</th>
                  <th className="py-3 px-4 font-medium">Floor Location</th>
                  <th className="py-3 px-4 font-medium text-right">Hourly Cost</th>
                  <th className="py-3 px-4 font-medium text-right">Daily Capacity</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  {(canWrite || canDelete) && <th className="py-3 px-4 font-medium text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {workstations.map((w) => (
                  <tr key={w.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="py-3 px-4 font-mono text-xs font-medium text-orange-700 dark:text-orange-400">
                      {w.ref}
                    </td>
                    <td className="py-3 px-4 text-xs font-medium text-zinc-900 dark:text-zinc-100">{w.name}</td>
                    <td className="py-3 px-4 text-xs text-zinc-500">{w.location || '—'}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-right">
                      {formatCurrency(w.hourly_cost)}/h
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-right">{w.capacity_per_day}h</td>
                    <td className="py-3 px-4">
                      <StatusText status={w.status} />
                    </td>
                    {(canWrite || canDelete) && (
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1 justify-end">
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => openEditWs(w)}
                              title="Edit workstation"
                              className="p-1.5 rounded-lg text-zinc-500 hover:text-orange-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => promptDelete(`/api/workstations/${w.id}`, `Workstation ${w.ref}`)}
                              title="Delete workstation"
                              className="p-1.5 rounded-lg text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Manufacturing Order Modal */}
      <Modal
        open={moModal}
        onClose={() => setMoModal(false)}
        title={editingMo ? `Edit Manufacturing Order — ${editingMo.ref}` : 'Schedule Manufacturing Order'}
      >
        <form onSubmit={handleSaveMo} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Bill of Materials (BOM)
            </label>
            <select
              required
              disabled={Boolean(editingMo)}
              value={moBomId}
              onChange={(e) => setMoBomId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-60"
            >
              {boms.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.ref} — {b.label} ({b.product_name})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Production Warehouse
              </label>
              <select
                required
                disabled={editingMo?.status === 'produced'}
                value={moWhId}
                onChange={(e) => setMoWhId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-60"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.ref} — {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Planned Quantity
              </label>
              <input
                type="number"
                min={1}
                required
                disabled={editingMo?.status === 'produced'}
                value={moQty}
                onChange={(e) => setMoQty(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-60"
              />
            </div>
          </div>
          {editingMo && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Scheduled Date
                </label>
                <input
                  type="date"
                  value={moDate}
                  onChange={(e) => setMoDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Status</label>
                <select
                  disabled={editingMo.status === 'produced'}
                  value={moStatus}
                  onChange={(e) => setMoStatus(e.target.value as ManufacturingOrder['status'])}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-60"
                >
                  <option value="draft">Draft</option>
                  <option value="validated">Validated</option>
                  <option value="in_progress">In Progress</option>
                  {editingMo.status === 'produced' && <option value="produced">Produced</option>}
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Notes</label>
            <input
              type="text"
              value={moNotes}
              onChange={(e) => setMoNotes(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setMoModal(false)}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              {editingMo ? 'Save Changes' : 'Schedule MO'}
            </button>
          </div>
        </form>
      </Modal>

      {/* BOM Modal */}
      <Modal
        open={bomModal}
        onClose={() => setBomModal(false)}
        title={editingBom ? `Edit BOM — ${editingBom.ref}` : 'Create Bill of Materials'}
        maxWidthClass="max-w-xl"
      >
        <form onSubmit={handleSaveBom} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Finished Product
              </label>
              <select
                required
                value={bomProductId}
                onChange={(e) => setBomProductId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.ref} — {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Workstation</label>
              <select
                value={bomWsId}
                onChange={(e) => setBomWsId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="">None</option>
                {workstations.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.ref} — {w.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">BOM Label</label>
              <input
                type="text"
                required
                value={bomLabel}
                onChange={(e) => setBomLabel(e.target.value)}
                placeholder="e.g. Standard Assembly Rev B"
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Output Qty</label>
              <input
                type="number"
                min={1}
                value={bomOutQty}
                onChange={(e) => setBomOutQty(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          {editingBom && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Cycle Time (mins)
                </label>
                <input
                  type="number"
                  min={1}
                  value={bomMinutes}
                  onChange={(e) => setBomMinutes(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Status</label>
                <select
                  value={bomStatus}
                  onChange={(e) => setBomStatus(e.target.value as BomItem['status'])}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span>Raw Material Components</span>
              <button
                type="button"
                onClick={() =>
                  setBomComps((prev) => [...prev, { productId: products[0] ? String(products[0].id) : '', qty: '1' }])
                }
                className="text-orange-700 dark:text-orange-400 hover:underline"
              >
                + Add Component
              </button>
            </div>
            {bomComps.map((c, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <select
                  value={c.productId}
                  onChange={(e) =>
                    setBomComps((prev) => prev.map((it, i) => (i === idx ? { ...it, productId: e.target.value } : it)))
                  }
                  className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.ref} — {p.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  value={c.qty}
                  onChange={(e) =>
                    setBomComps((prev) => prev.map((it, i) => (i === idx ? { ...it, qty: e.target.value } : it)))
                  }
                  className="w-20 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
                {bomComps.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setBomComps((prev) => prev.filter((_, i) => i !== idx))}
                    className="p-1 text-zinc-400 hover:text-red-600"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setBomModal(false)}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              {editingBom ? 'Save Changes' : 'Save BOM'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Workstation Modal */}
      <Modal
        open={wsModal}
        onClose={() => setWsModal(false)}
        title={editingWs ? `Edit Workstation — ${editingWs.ref}` : 'Register Production Workstation'}
      >
        <form onSubmit={handleSaveWorkstation} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Ref Code</label>
              <input
                type="text"
                disabled={Boolean(editingWs)}
                value={wsRef}
                onChange={(e) => setWsRef(e.target.value)}
                placeholder="WS-CNC-02"
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Location</label>
              <input
                type="text"
                value={wsLoc}
                onChange={(e) => setWsLoc(e.target.value)}
                placeholder="Bay B"
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Name</label>
            <input
              type="text"
              required
              value={wsName}
              onChange={(e) => setWsName(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className={editingWs ? 'grid grid-cols-3 gap-3' : 'grid grid-cols-2 gap-3'}>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Hourly Cost (USD)
              </label>
              <input
                type="number"
                step="0.01"
                value={wsCost}
                onChange={(e) => setWsCost(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Capacity (h/day)
              </label>
              <input
                type="number"
                min={1}
                value={wsCap}
                onChange={(e) => setWsCap(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            {editingWs && (
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Status</label>
                <select
                  value={wsStatus}
                  onChange={(e) => setWsStatus(e.target.value as WorkstationItem['status'])}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  <option value="operational">Operational</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="offline">Offline</option>
                </select>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setWsModal(false)}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              {editingWs ? 'Save Changes' : 'Add Workstation'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title="Confirm Deletion"
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

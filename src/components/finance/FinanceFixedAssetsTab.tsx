import { useMemo, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CalendarClock,
  Calculator,
  Download,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import type { FiscalPeriodItem, FixedAssetItem } from '../../types/erp';
import { Modal } from '../Modal';
import { StatusText } from '../StatusText';
import { downloadCsvBlob } from './financeHelpers';

interface FinanceFixedAssetsTabProps {
  fixedAssets: FixedAssetItem[];
  fiscalPeriods: FiscalPeriodItem[];
  canWrite: boolean;
  canDelete: boolean;
  onReload: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPromptDelete: (url: string, title: string, itemLabel: string, warning?: string) => void;
}

const ASSET_CATEGORIES = [
  'Machinery & Production',
  'IT & Servers',
  'Warehouse Equipment',
  'Vehicles & Fleet',
  'Buildings & Leasehold',
  'Office Furniture',
];

function computeMonthsElapsed(acqDateStr: string): number {
  const parsed = Date.parse(`${acqDateStr}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return 0;
  const acq = new Date(parsed);
  const now = new Date();
  const months =
    (now.getUTCFullYear() - acq.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - acq.getUTCMonth());
  return Math.max(0, months);
}

interface ProjectedPeriodRow {
  periodNumber: number;
  openingNbv: number;
  depreciationCharge: number;
  endingAccumulated: number;
  endingNbv: number;
}

function buildProjectedSchedule(asset: FixedAssetItem, maxRows = 36): {
  rows: ProjectedPeriodRow[];
  totalRemainingMonths: number;
} {
  const rows: ProjectedPeriodRow[] = [];
  const life = Math.max(1, asset.useful_life_months);
  let nbv = Math.max(0, asset.purchase_cost - asset.accumulated_depreciation);
  let accum = asset.accumulated_depreciation;
  const floor = Math.max(0, Math.min(asset.purchase_cost, asset.salvage_value));
  const slMonthly = Math.max(0.01, (asset.purchase_cost - floor) / life);

  let period = 1;
  while (nbv - floor > 0.01 && period <= Math.max(life * 2, 240)) {
    const remainingDepreciable = nbv - floor;
    const rawCharge =
      asset.depreciation_method === 'declining_balance'
        ? remainingDepreciable * (2 / life)
        : slMonthly;
    const charge = Math.min(remainingDepreciable, Math.max(0.01, Math.round(rawCharge * 100) / 100));
    const nextAccum = Math.round((accum + charge) * 100) / 100;
    const nextNbv = Math.max(floor, Math.round((asset.purchase_cost - nextAccum) * 100) / 100);
    if (rows.length < maxRows) {
      rows.push({
        periodNumber: period,
        openingNbv: Math.round(nbv * 100) / 100,
        depreciationCharge: charge,
        endingAccumulated: nextAccum,
        endingNbv: nextNbv,
      });
    }
    nbv = nextNbv;
    accum = nextAccum;
    period += 1;
  }

  return { rows, totalRemainingMonths: period - 1 };
}

export function FinanceFixedAssetsTab({
  fixedAssets,
  fiscalPeriods,
  canWrite,
  canDelete,
  onReload,
  onNotify,
  onPromptDelete,
}: FinanceFixedAssetsTabProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | FixedAssetItem['status']>('all');
  const [methodFilter, setMethodFilter] = useState<'all' | FixedAssetItem['depreciation_method']>('all');
  const [exporting, setExporting] = useState(false);

  // Register / Edit modal state
  const [assetModal, setAssetModal] = useState(false);
  const [editingAsset, setEditingAsset] = useState<FixedAssetItem | null>(null);
  const [faName, setFaName] = useState('');
  const [faCategory, setFaCategory] = useState('Machinery & Production');
  const [faAcqDate, setFaAcqDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [faCost, setFaCost] = useState('15000');
  const [faSalvage, setFaSalvage] = useState('1500');
  const [faLife, setFaLife] = useState('60');
  const [faMethod, setFaMethod] = useState<'straight_line' | 'declining_balance'>('straight_line');
  const [faAccum, setFaAccum] = useState('0');
  const [faLocation, setFaLocation] = useState('Chicago Main Plant');
  const [faStatus, setFaStatus] = useState<FixedAssetItem['status']>('active');
  const [faNotes, setFaNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Schedule modal state
  const [scheduleAsset, setScheduleAsset] = useState<FixedAssetItem | null>(null);
  const [postingSingleId, setPostingSingleId] = useState<number | null>(null);

  // Batch depreciation modal state
  const [batchModal, setBatchModal] = useState(false);
  const [batchDate, setBatchDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [skipSameMonth, setSkipSameMonth] = useState(true);
  const [runningBatch, setRunningBatch] = useState(false);

  const categories = useMemo(() => {
    const set = new Set<string>(fixedAssets.map((a) => a.category).filter(Boolean));
    return Array.from(set).sort();
  }, [fixedAssets]);

  const summary = useMemo(() => {
    let grossCost = 0;
    let totalAccum = 0;
    let totalNbv = 0;
    let totalMonthlyRunRate = 0;
    let activeCount = 0;
    let fullyDepreciatedCount = 0;
    let disposedCount = 0;

    for (const a of fixedAssets) {
      if (a.status !== 'disposed') {
        grossCost += a.purchase_cost;
        totalAccum += a.accumulated_depreciation;
        totalNbv += a.net_book_value;
      }
      if (a.status === 'active') {
        activeCount += 1;
        totalMonthlyRunRate += a.monthly_depreciation;
      } else if (a.status === 'fully_depreciated') {
        fullyDepreciatedCount += 1;
      } else if (a.status === 'disposed') {
        disposedCount += 1;
      }
    }

    const totalDepreciable = fixedAssets
      .filter((a) => a.status !== 'disposed')
      .reduce((s, a) => s + Math.max(0, a.purchase_cost - a.salvage_value), 0);
    const pctDepreciated = totalDepreciable > 0 ? Math.min(100, (totalAccum / totalDepreciable) * 100) : 0;

    return {
      grossCost: Math.round(grossCost * 100) / 100,
      totalAccum: Math.round(totalAccum * 100) / 100,
      totalNbv: Math.round(totalNbv * 100) / 100,
      totalMonthlyRunRate: Math.round(totalMonthlyRunRate * 100) / 100,
      pctDepreciated,
      activeCount,
      fullyDepreciatedCount,
      disposedCount,
    };
  }, [fixedAssets]);

  const filteredAssets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return fixedAssets.filter((a) => {
      if (categoryFilter !== 'all' && a.category !== categoryFilter) return false;
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (methodFilter !== 'all' && a.depreciation_method !== methodFilter) return false;
      if (q) {
        const hay = `${a.ref} ${a.name} ${a.category} ${a.location} ${a.notes}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [fixedAssets, categoryFilter, statusFilter, methodFilter, search]);

  const hasFilters =
    Boolean(search.trim()) ||
    categoryFilter !== 'all' ||
    statusFilter !== 'all' ||
    methodFilter !== 'all';

  const batchClosedPeriod = useMemo(() => {
    return fiscalPeriods.find(
      (fp) => fp.status === 'closed' && batchDate >= fp.start_date && batchDate <= fp.end_date
    );
  }, [fiscalPeriods, batchDate]);

  const batchPreview = useMemo(() => {
    const postMonth = batchDate.slice(0, 7);
    const eligible: FixedAssetItem[] = [];
    const skipped: FixedAssetItem[] = [];

    for (const a of fixedAssets) {
      if (a.status !== 'active') continue;
      if (a.purchase_cost - a.salvage_value - a.accumulated_depreciation <= 0.01) continue;
      if (skipSameMonth && String(a.last_depreciation_date || '').slice(0, 7) === postMonth) {
        skipped.push(a);
      } else {
        eligible.push(a);
      }
    }
    const totalCharge = eligible.reduce((s, a) => s + a.monthly_depreciation, 0);
    return {
      eligible,
      skipped,
      totalCharge: Math.round(totalCharge * 100) / 100,
    };
  }, [fixedAssets, batchDate, skipSameMonth]);

  const scheduleProjection = useMemo(() => {
    if (!scheduleAsset) return { rows: [], totalRemainingMonths: 0 };
    return buildProjectedSchedule(scheduleAsset);
  }, [scheduleAsset]);

  // Live form preview math
  const formPreview = useMemo(() => {
    const cost = Math.max(0, Number(faCost) || 0);
    const salvage = Math.max(0, Math.min(cost, Number(faSalvage) || 0));
    const accum = Math.max(0, Math.min(cost - salvage, Number(faAccum) || 0));
    const life = Math.max(1, Number(faLife) || 60);
    const nbv = Math.max(0, cost - accum);
    const remainingDep = Math.max(0, nbv - salvage);
    const monthly =
      faMethod === 'declining_balance'
        ? remainingDep * (2 / life)
        : (cost - salvage) / life;
    return {
      depreciableBase: Math.round((cost - salvage) * 100) / 100,
      nbv: Math.round(nbv * 100) / 100,
      monthly: Math.min(remainingDep, Math.round(monthly * 100) / 100),
    };
  }, [faCost, faSalvage, faAccum, faLife, faMethod]);

  function openCreateAsset() {
    setEditingAsset(null);
    setFaName('');
    setFaCategory('Machinery & Production');
    setFaAcqDate(new Date().toISOString().slice(0, 10));
    setFaCost('15000');
    setFaSalvage('1500');
    setFaLife('60');
    setFaMethod('straight_line');
    setFaAccum('0');
    setFaLocation('Chicago Main Plant');
    setFaStatus('active');
    setFaNotes('');
    setAssetModal(true);
  }

  function openEditAsset(a: FixedAssetItem) {
    setEditingAsset(a);
    setFaName(a.name);
    setFaCategory(a.category);
    setFaAcqDate(a.acquisition_date);
    setFaCost(String(a.purchase_cost));
    setFaSalvage(String(a.salvage_value));
    setFaLife(String(a.useful_life_months));
    setFaMethod(a.depreciation_method);
    setFaAccum(String(a.accumulated_depreciation));
    setFaLocation(a.location);
    setFaStatus(a.status);
    setFaNotes(a.notes || '');
    setAssetModal(true);
  }

  async function handleSaveAsset(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: faName,
        category: faCategory,
        acquisitionDate: faAcqDate,
        purchaseCost: Number(faCost) || 0,
        salvageValue: Number(faSalvage) || 0,
        usefulLifeMonths: Number(faLife) || 60,
        depreciationMethod: faMethod,
        accumulatedDepreciation: Number(faAccum) || 0,
        location: faLocation,
        status: faStatus,
        notes: faNotes,
      };
      if (editingAsset) {
        await apiRequest(`/api/finance/fixed-assets/${editingAsset.id}`, {
          method: 'PUT',
          body: payload,
        });
        onNotify(`Fixed asset ${editingAsset.ref} updated.`);
      } else {
        await apiRequest('/api/finance/fixed-assets', {
          method: 'POST',
          body: payload,
        });
        onNotify('Fixed asset registered.');
      }
      setAssetModal(false);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save fixed asset.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDepreciateAsset(a: FixedAssetItem) {
    setPostingSingleId(a.id);
    try {
      const res = await apiRequest<{ asset: FixedAssetItem; journalRef: string; charge: number }>(
        `/api/finance/fixed-assets/${a.id}/depreciate`,
        { method: 'POST', body: {} }
      );
      onNotify(`Posted ${formatCurrency(res.charge)} monthly depreciation (${res.journalRef}).`);
      if (scheduleAsset && scheduleAsset.id === a.id && res.asset) {
        const nextNbv = Math.max(0, Math.round((res.asset.purchase_cost - res.asset.accumulated_depreciation) * 100) / 100);
        setScheduleAsset({ ...a, ...res.asset, net_book_value: nextNbv });
      }
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Depreciation run failed.', 'error');
    } finally {
      setPostingSingleId(null);
    }
  }

  async function handleRunBatchDepreciation() {
    setRunningBatch(true);
    try {
      const res = await apiRequest<{ count: number; totalCharge: number; postDate: string }>(
        '/api/finance/fixed-assets/depreciate-batch',
        {
          method: 'POST',
          body: {
            postDate: batchDate,
            skipAlreadyPostedThisMonth: skipSameMonth,
          },
        }
      );
      onNotify(`Posted ${formatCurrency(res.totalCharge)} depreciation across ${res.count} asset(s).`);
      setBatchModal(false);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Batch depreciation failed.', 'error');
    } finally {
      setRunningBatch(false);
    }
  }

  async function handleExportCsv() {
    setExporting(true);
    try {
      const res = await apiRequest<{ filename: string; csv: string }>('/api/finance/fixed-assets/export');
      downloadCsvBlob(res.filename, res.csv);
      onNotify('Fixed assets register CSV downloaded.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to export fixed assets CSV.', 'error');
    } finally {
      setExporting(false);
    }
  }

  function resetFilters() {
    setSearch('');
    setCategoryFilter('all');
    setStatusFilter('all');
    setMethodFilter('all');
  }

  return (
    <div className="space-y-5">
      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="text-xs text-zinc-500">Gross Asset Cost (Active &amp; Depreciated)</div>
          <div className="text-2xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100 mt-1">
            {formatCurrency(summary.grossCost)}
          </div>
          <div className="text-xs text-zinc-500 mt-1.5">
            {fixedAssets.length} registered · {categories.length} categories
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="text-xs text-zinc-500">Accumulated Depreciation</div>
          <div className="text-2xl font-semibold font-mono tabular-nums text-amber-700 dark:text-amber-400 mt-1">
            {formatCurrency(summary.totalAccum)}
          </div>
          <div className="text-xs text-zinc-500 mt-1.5 font-mono tabular-nums">
            {summary.pctDepreciated.toFixed(1)}% of depreciable base
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="text-xs text-zinc-500">Current Net Book Value (NBV)</div>
          <div className="text-2xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100 mt-1">
            {formatCurrency(summary.totalNbv)}
          </div>
          <div className="text-xs text-zinc-500 mt-1.5">
            {summary.fullyDepreciatedCount} fully depreciated · {summary.disposedCount} disposed
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="text-xs text-zinc-500">Monthly Depreciation Run-Rate</div>
          <div className="text-2xl font-semibold font-mono tabular-nums text-orange-700 dark:text-orange-400 mt-1">
            {formatCurrency(summary.totalMonthlyRunRate)}
          </div>
          <div className="text-xs text-zinc-500 mt-1.5">
            {summary.activeCount} active asset(s) accruing · DR 6300 / CR 1290
          </div>
        </div>
      </div>

      {/* Filter & Actions Toolbar */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Fixed Assets &amp; Book Value Register
            </h2>
            <p className="text-xs text-zinc-500">
              Manage purchase dates, straight-line and declining-balance schedules, accumulated depreciation, and current book values.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
              >
                Reset
              </button>
            )}
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={exporting || fixedAssets.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              {exporting ? 'Exporting...' : 'Export CSV'}
            </button>
            {canWrite && (
              <button
                type="button"
                onClick={() => setBatchModal(true)}
                disabled={summary.activeCount === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" />
                Run Monthly Depreciation
              </button>
            )}
            {canWrite && (
              <button
                type="button"
                onClick={openCreateAsset}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Register Asset
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search asset ref, name, location..."
              aria-label="Search fixed assets"
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter by asset category"
            className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100"
          >
            <option value="all">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <select
            value={methodFilter}
            onChange={(e) =>
              setMethodFilter(e.target.value as 'all' | FixedAssetItem['depreciation_method'])
            }
            aria-label="Filter by depreciation method"
            className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100"
          >
            <option value="all">All Depreciation Methods</option>
            <option value="straight_line">Straight-Line</option>
            <option value="declining_balance">Double Declining Balance</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | FixedAssetItem['status'])}
            aria-label="Filter by asset status"
            className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100"
          >
            <option value="all">All Lifecycle Statuses</option>
            <option value="active">Active</option>
            <option value="fully_depreciated">Fully Depreciated</option>
            <option value="disposed">Disposed</option>
          </select>
        </div>
      </div>

      {/* Fixed Assets Table */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-950/60 border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Asset</th>
              <th className="text-left px-4 py-2.5 font-medium whitespace-nowrap">Purchase Date</th>
              <th className="text-left px-4 py-2.5 font-medium whitespace-nowrap">Method · Life</th>
              <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">Purchase Cost</th>
              <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">Accum. Depr.</th>
              <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">Current Book Value</th>
              <th className="text-left px-4 py-2.5 font-medium whitespace-nowrap">Status</th>
              <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
            {filteredAssets.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center">
                  <div className="inline-flex flex-col items-center gap-2 text-zinc-500">
                    <span className="text-xs">
                      {fixedAssets.length === 0
                        ? 'No fixed assets are registered yet. Add your equipment, IT hardware, or vehicles to begin tracking book values.'
                        : 'No fixed assets match the current filter criteria.'}
                    </span>
                    {hasFilters ? (
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                      >
                        Clear Filters
                      </button>
                    ) : canWrite ? (
                      <button
                        type="button"
                        onClick={openCreateAsset}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Register First Fixed Asset
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ) : (
              filteredAssets.map((a) => {
                const depreciableBase = Math.max(0, a.purchase_cost - a.salvage_value);
                const depPct = depreciableBase > 0 ? Math.min(100, (a.accumulated_depreciation / depreciableBase) * 100) : 0;
                const monthsElapsed = computeMonthsElapsed(a.acquisition_date);
                return (
                  <tr
                    key={a.id}
                    className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40 transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-mono text-xs font-semibold text-orange-700 dark:text-orange-400">
                        {a.ref}
                      </div>
                      <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                        {a.name}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {a.category} · {a.location}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="text-xs font-mono text-zinc-800 dark:text-zinc-200">
                        {formatDate(a.acquisition_date)}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {monthsElapsed} mos age
                        {a.last_depreciation_date ? ` · Last ${formatDate(a.last_depreciation_date)}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="text-xs text-zinc-800 dark:text-zinc-200">
                        {a.depreciation_method === 'declining_balance' ? 'Declining Balance' : 'Straight-Line'}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-zinc-500">
                        {a.useful_life_months} mos · ~{formatCurrency(a.monthly_depreciation)}/mo
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="font-mono tabular-nums text-xs text-zinc-800 dark:text-zinc-200">
                        {formatCurrency(a.purchase_cost)}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-zinc-500">
                        Salvage {formatCurrency(a.salvage_value)}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="font-mono tabular-nums text-xs text-amber-700 dark:text-amber-400">
                        {formatCurrency(a.accumulated_depreciation)}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-zinc-500">
                        {depPct.toFixed(1)}% accrued
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="font-mono tabular-nums text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        {formatCurrency(a.net_book_value)}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <StatusText status={a.status} />
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap space-x-2">
                      <button
                        type="button"
                        onClick={() => setScheduleAsset(a)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 align-middle"
                      >
                        <CalendarClock className="w-3 h-3" />
                        Schedule
                      </button>
                      {canWrite && a.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => handleDepreciateAsset(a)}
                          disabled={postingSingleId === a.id}
                          className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline align-middle disabled:opacity-50"
                        >
                          <Calculator className="w-3.5 h-3.5" />
                          {postingSingleId === a.id ? 'Posting...' : 'Depreciate'}
                        </button>
                      )}
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => openEditAsset(a)}
                          title="Edit fixed asset"
                          aria-label={`Edit ${a.ref}`}
                          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center align-middle"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() =>
                            onPromptDelete(
                              `/api/finance/fixed-assets/${a.id}`,
                              'Delete Fixed Asset',
                              `${a.ref} — ${a.name}`,
                              'Existing depreciation journal entries remain in the General Ledger for audit continuity.'
                            )
                          }
                          title="Delete fixed asset"
                          aria-label={`Delete ${a.ref}`}
                          className="text-zinc-400 hover:text-red-600 inline-flex items-center align-middle"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Register / Edit Asset Modal */}
      <Modal
        open={assetModal}
        onClose={() => setAssetModal(false)}
        title={editingAsset ? `Edit Asset ${editingAsset.ref}` : 'Register Fixed Asset'}
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handleSaveAsset} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Asset Name
            </label>
            <input
              type="text"
              value={faName}
              onChange={(e) => setFaName(e.target.value)}
              required
              placeholder="e.g., CNC Fiber Laser Cutter"
              className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Category
              </label>
              <input
                type="text"
                list="fixed-asset-categories"
                value={faCategory}
                onChange={(e) => setFaCategory(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              />
              <datalist id="fixed-asset-categories">
                {ASSET_CATEGORIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Purchase Date
              </label>
              <input
                type="date"
                value={faAcqDate}
                onChange={(e) => setFaAcqDate(e.target.value)}
                required
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Purchase Cost ($)
              </label>
              <input
                type="number"
                step="0.01"
                min="1"
                value={faCost}
                onChange={(e) => setFaCost(e.target.value)}
                required
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Salvage Value ($)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={faSalvage}
                onChange={(e) => setFaSalvage(e.target.value)}
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Life (Months)
              </label>
              <input
                type="number"
                min="1"
                value={faLife}
                onChange={(e) => setFaLife(e.target.value)}
                required
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Accum. Depr. ($)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={faAccum}
                onChange={(e) => setFaAccum(e.target.value)}
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Depreciation Method
              </label>
              <select
                value={faMethod}
                onChange={(e) =>
                  setFaMethod(e.target.value as 'straight_line' | 'declining_balance')
                }
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              >
                <option value="straight_line">Straight-Line</option>
                <option value="declining_balance">Double Declining Balance</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Location / Facility
              </label>
              <input
                type="text"
                value={faLocation}
                onChange={(e) => setFaLocation(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              />
            </div>
          </div>

          {editingAsset && (
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Lifecycle Status
              </label>
              <select
                value={faStatus}
                onChange={(e) => setFaStatus(e.target.value as FixedAssetItem['status'])}
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              >
                <option value="active">Active</option>
                <option value="fully_depreciated">Fully Depreciated</option>
                <option value="disposed">Disposed</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Notes
            </label>
            <input
              type="text"
              value={faNotes}
              onChange={(e) => setFaNotes(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800 text-xs text-zinc-500">
            <span>
              Depreciable Base:{' '}
              <strong className="font-mono text-zinc-800 dark:text-zinc-200">
                {formatCurrency(formPreview.depreciableBase)}
              </strong>
            </span>
            <span>
              Current NBV:{' '}
              <strong className="font-mono text-zinc-800 dark:text-zinc-200">
                {formatCurrency(formPreview.nbv)}
              </strong>
            </span>
            <span>
              Monthly Charge:{' '}
              <strong className="font-mono text-orange-700 dark:text-orange-400">
                {formatCurrency(formPreview.monthly)}
              </strong>
            </span>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setAssetModal(false)}
              className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Asset'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Depreciation Schedule Projection Modal */}
      <Modal
        open={Boolean(scheduleAsset)}
        onClose={() => setScheduleAsset(null)}
        title={scheduleAsset ? `${scheduleAsset.ref} — Depreciation Schedule` : 'Depreciation Schedule'}
        maxWidthClass="max-w-2xl"
      >
        {scheduleAsset && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <div className="text-zinc-500">Purchase Date</div>
                <div className="font-mono font-medium text-zinc-900 dark:text-zinc-100 mt-0.5">
                  {formatDate(scheduleAsset.acquisition_date)}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Purchase Cost / Salvage</div>
                <div className="font-mono font-medium text-zinc-900 dark:text-zinc-100 mt-0.5">
                  {formatCurrency(scheduleAsset.purchase_cost)} / {formatCurrency(scheduleAsset.salvage_value)}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Accumulated Depr.</div>
                <div className="font-mono font-medium text-amber-700 dark:text-amber-400 mt-0.5">
                  {formatCurrency(scheduleAsset.accumulated_depreciation)}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Current Book Value</div>
                <div className="font-mono font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5">
                  {formatCurrency(scheduleAsset.net_book_value)}
                </div>
              </div>
            </div>

            {scheduleProjection.rows.length === 0 ? (
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 text-center text-xs text-zinc-500">
                This asset has reached its salvage floor ({formatCurrency(scheduleAsset.salvage_value)}) or is disposed. No further depreciation periods remain.
              </div>
            ) : (
              <>
                <div className="text-xs text-zinc-500 flex items-center justify-between gap-2">
                  <span>
                    Showing {scheduleProjection.rows.length} of {scheduleProjection.totalRemainingMonths} remaining monthly period(s) until salvage floor
                  </span>
                  <span className="font-mono">
                    {scheduleAsset.depreciation_method === 'declining_balance'
                      ? 'Double Declining Balance'
                      : 'Straight-Line'}
                  </span>
                </div>
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-50 dark:bg-zinc-950/60 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Period</th>
                        <th className="text-right px-3 py-2 font-medium">Opening Book Value</th>
                        <th className="text-right px-3 py-2 font-medium">Monthly Charge</th>
                        <th className="text-right px-3 py-2 font-medium">Ending Accum. Depr.</th>
                        <th className="text-right px-3 py-2 font-medium">Ending Book Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {scheduleProjection.rows.map((row) => (
                        <tr key={row.periodNumber}>
                          <td className="px-3 py-2 font-mono text-zinc-700 dark:text-zinc-300">
                            Month +{row.periodNumber}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                            {formatCurrency(row.openingNbv)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-orange-700 dark:text-orange-400">
                            {formatCurrency(row.depreciationCharge)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                            {formatCurrency(row.endingAccumulated)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                            {formatCurrency(row.endingNbv)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setScheduleAsset(null)}
                className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs"
              >
                Close
              </button>
              {canWrite && scheduleAsset.status === 'active' && scheduleProjection.rows.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleDepreciateAsset(scheduleAsset)}
                  disabled={postingSingleId === scheduleAsset.id}
                  className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium disabled:opacity-50"
                >
                  <Calculator className="w-3.5 h-3.5" />
                  {postingSingleId === scheduleAsset.id ? 'Posting...' : 'Post Next Month to GL'}
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Batch Monthly Depreciation Run Modal */}
      <Modal
        open={batchModal}
        onClose={() => setBatchModal(false)}
        title="Run Monthly Depreciation Batch"
        maxWidthClass="max-w-xl"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                GL Posting Date
              </label>
              <input
                type="date"
                value={batchDate}
                onChange={(e) => setBatchDate(e.target.value)}
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              />
            </div>
            <label className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={skipSameMonth}
                onChange={(e) => setSkipSameMonth(e.target.checked)}
                className="rounded border-zinc-300 text-orange-700 focus:ring-orange-600"
              />
              <span>Skip assets already posted in {batchDate.slice(0, 7)}</span>
            </label>
          </div>

          {batchClosedPeriod && (
            <div className="rounded-lg border border-red-200 dark:border-red-900/60 p-3 flex items-start gap-2.5 text-xs text-red-700 dark:text-red-400">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Posting date falls inside closed fiscal period <strong>{batchClosedPeriod.code}</strong> ({batchClosedPeriod.name}). Choose an open period date before posting.
              </span>
            </div>
          )}

          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 dark:bg-zinc-950/60 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Asset</th>
                  <th className="text-right px-3 py-2 font-medium">Current NBV</th>
                  <th className="text-right px-3 py-2 font-medium">Monthly Charge</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {batchPreview.eligible.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-zinc-500">
                      No active assets are queued for depreciation in {batchDate.slice(0, 7)}.
                    </td>
                  </tr>
                ) : (
                  batchPreview.eligible.map((a) => (
                    <tr key={a.id}>
                      <td className="px-3 py-2">
                        <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100 mr-2">
                          {a.ref}
                        </span>
                        <span className="text-zinc-700 dark:text-zinc-300">{a.name}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                        {formatCurrency(a.net_book_value)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums font-medium text-orange-700 dark:text-orange-400">
                        {formatCurrency(a.monthly_depreciation)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {batchPreview.skipped.length > 0 && (
            <div className="text-xs text-zinc-500">
              {batchPreview.skipped.length} active asset(s) already posted in {batchDate.slice(0, 7)} will be skipped.
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-zinc-100 dark:border-zinc-800 text-xs">
            <span className="text-zinc-500">
              Total GL Batch Posting (DR 6300 / CR 1290):
            </span>
            <strong className="font-mono tabular-nums text-sm text-zinc-900 dark:text-zinc-100">
              {formatCurrency(batchPreview.totalCharge)}
            </strong>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setBatchModal(false)}
              className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRunBatchDepreciation}
              disabled={
                runningBatch ||
                Boolean(batchClosedPeriod) ||
                batchPreview.eligible.length === 0
              }
              className="h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium disabled:opacity-50"
            >
              {runningBatch
                ? 'Posting Batch...'
                : `Post ${batchPreview.eligible.length} Depreciation Entry(s)`}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeftRight,
  Calendar,
  CheckCircle2,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import type {
  CurrencyConversionResult,
  CurrencyPeriodRateItem,
  CurrencyRateItem,
  FiscalPeriodItem,
  MultiCurrencyWorkspacePayload,
  TaxRateItem,
} from '../../types/erp';
import { Modal } from '../Modal';
import { StatusText } from '../StatusText';
import { downloadCsvBlob } from './financeHelpers';

interface MarginStats {
  revenue_ht: number;
  credit_notes_ht: number;
  purchases_ht: number;
  vat_collected: number;
  vat_deductible: number;
}

interface FinanceTaxCurrencySectionProps {
  currencies: CurrencyRateItem[];
  fiscalPeriods?: FiscalPeriodItem[];
  taxRates: TaxRateItem[];
  marginStats: MarginStats;
  canWrite: boolean;
  canValidate?: boolean;
  canDelete: boolean;
  refreshTick?: number;
  onReload: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPromptDelete: (url: string, title: string, itemLabel: string, warning?: string) => void;
}

const RATE_SOURCE_LABELS: Record<string, string> = {
  manual: 'Treasury Manual',
  ecb: 'ECB Reference',
  bsp: 'BSP Reference',
  fed: 'Fed / H.10 Desk',
  spot_override: 'Spot Override',
};

export function FinanceTaxCurrencySection({
  currencies,
  fiscalPeriods = [],
  taxRates,
  marginStats,
  canWrite,
  canValidate = false,
  canDelete,
  refreshTick = 0,
  onReload,
  onNotify,
  onPromptDelete,
}: FinanceTaxCurrencySectionProps) {
  const [subTab, setSubTab] = useState<'taxes' | 'currencies' | 'margins'>('taxes');

  // Multi-Currency Accounting Service workspace state
  const [fxWorkspace, setFxWorkspace] = useState<MultiCurrencyWorkspacePayload | null>(null);
  const [fxLoading, setFxLoading] = useState(false);
  const [periodFilter, setPeriodFilter] = useState<string>('all');
  const [currencyFilter, setCurrencyFilter] = useState<string>('ALL');

  // Period-aware converter widget
  const [fxAmount, setFxAmount] = useState('1000');
  const [fxFrom, setFxFrom] = useState('EUR');
  const [fxTo, setFxTo] = useState('USD');
  const [fxPeriodId, setFxPeriodId] = useState<string>('');
  const [fxDate, setFxDate] = useState('2026-11-15');
  const [fxPreferClosing, setFxPreferClosing] = useState(false);
  const [conversion, setConversion] = useState<CurrencyConversionResult | null>(null);
  const [converting, setConverting] = useState(false);

  // Tax modal
  const [taxModal, setTaxModal] = useState(false);
  const [editingTax, setEditingTax] = useState<TaxRateItem | null>(null);
  const [taxCode, setTaxCode] = useState('');
  const [taxName, setTaxName] = useState('');
  const [taxRate, setTaxRate] = useState('20');
  const [taxType, setTaxType] = useState<'sales' | 'purchase' | 'both'>('both');
  const [taxApplies, setTaxApplies] = useState('Standard Goods & Services');
  const [taxActive, setTaxActive] = useState(true);
  const [taxNotes, setTaxNotes] = useState('');

  // Currency modal
  const [currModal, setCurrModal] = useState(false);
  const [editingCurr, setEditingCurr] = useState<CurrencyRateItem | null>(null);
  const [currCode, setCurrCode] = useState('');
  const [currName, setCurrName] = useState('');
  const [currSymbol, setCurrSymbol] = useState('');
  const [currRate, setCurrRate] = useState('1');
  const [currBase, setCurrBase] = useState(false);

  // Period FX Rate modal
  const [rateModal, setRateModal] = useState(false);
  const [editingRate, setEditingRate] = useState<CurrencyPeriodRateItem | null>(null);
  const [rateCurrencyCode, setRateCurrencyCode] = useState('EUR');
  const [rateFiscalPeriodId, setRateFiscalPeriodId] = useState<string>('');
  const [rateFromDate, setRateFromDate] = useState('2026-11-01');
  const [rateToDate, setRateToDate] = useState('2026-11-30');
  const [rateBooking, setRateBooking] = useState('0.9200');
  const [rateClosing, setRateClosing] = useState('0.9250');
  const [rateSource, setRateSource] = useState('ecb');
  const [rateNotes, setRateNotes] = useState('');
  const [revaluing, setRevaluing] = useState(false);

  const netRevenue = marginStats.revenue_ht - marginStats.credit_notes_ht;
  const grossMargin = netRevenue - marginStats.purchases_ht;
  const marginPct = netRevenue > 0 ? ((grossMargin / netRevenue) * 100).toFixed(1) : '0.0';
  const netVat = marginStats.vat_collected - marginStats.vat_deductible;

  const activeCurrencies = fxWorkspace?.currencies ?? currencies;
  const activePeriods = fxWorkspace?.fiscalPeriods ?? fiscalPeriods;
  const baseCurrency =
    fxWorkspace?.baseCurrency ??
    activeCurrencies.find((c) => Boolean(c.is_base)) ?? {
      id: 0,
      code: 'USD',
      name: 'US Dollar (Base)',
      symbol: '$',
      exchange_rate: 1,
      is_base: 1,
    };

  const loadFxWorkspace = useCallback(async () => {
    setFxLoading(true);
    try {
      const qs = new URLSearchParams();
      if (periodFilter !== 'all') qs.set('fiscalPeriodId', periodFilter);
      if (currencyFilter !== 'ALL') qs.set('currencyCode', currencyFilter);
      const data = await apiRequest<MultiCurrencyWorkspacePayload>(
        `/api/finance/currency-service${qs.toString() ? `?${qs.toString()}` : ''}`
      );
      setFxWorkspace(data);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to load multi-currency service workspace.', 'error');
    } finally {
      setFxLoading(false);
    }
  }, [periodFilter, currencyFilter, onNotify]);

  useEffect(() => {
    if (subTab === 'currencies') {
      void loadFxWorkspace();
    }
  }, [subTab, refreshTick, loadFxWorkspace]);

  const runLiveConversion = useCallback(async () => {
    const amt = Number(fxAmount);
    if (!Number.isFinite(amt)) return;
    setConverting(true);
    try {
      const res = await apiRequest<CurrencyConversionResult>('/api/finance/currency-service/convert', {
        method: 'POST',
        body: {
          amount: amt,
          fromCurrency: fxFrom,
          toCurrency: fxTo,
          date: fxDate || undefined,
          fiscalPeriodId: fxPeriodId ? Number(fxPeriodId) : null,
          preferClosing: fxPreferClosing,
        },
      });
      setConversion(res);
    } catch {
      // keep previous value if temporary
    } finally {
      setConverting(false);
    }
  }, [fxAmount, fxFrom, fxTo, fxDate, fxPeriodId, fxPreferClosing]);

  useEffect(() => {
    if (subTab !== 'currencies') return;
    const t = setTimeout(() => {
      void runLiveConversion();
    }, 150);
    return () => clearTimeout(t);
  }, [subTab, fxWorkspace?.periodRates.length, runLiveConversion]);

  function openCreateTax() {
    setEditingTax(null);
    setTaxCode('');
    setTaxName('');
    setTaxRate('12');
    setTaxType('both');
    setTaxApplies('Standard Goods & Services');
    setTaxActive(true);
    setTaxNotes('');
    setTaxModal(true);
  }

  function openEditTax(t: TaxRateItem) {
    setEditingTax(t);
    setTaxCode(t.code);
    setTaxName(t.name);
    setTaxRate(String(t.rate));
    setTaxType(t.tax_type);
    setTaxApplies(t.applies_to);
    setTaxActive(Boolean(t.is_active));
    setTaxNotes(t.notes || '');
    setTaxModal(true);
  }

  async function handleSaveTax(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        code: taxCode,
        name: taxName,
        rate: Number(taxRate) || 0,
        taxType,
        appliesTo: taxApplies,
        isActive: taxActive,
        notes: taxNotes,
      };
      if (editingTax) {
        await apiRequest(`/api/finance/tax-rates/${editingTax.id}`, { method: 'PUT', body: payload });
        onNotify(`Tax rate ${editingTax.code} updated.`);
      } else {
        await apiRequest('/api/finance/tax-rates', { method: 'POST', body: payload });
        onNotify('Tax rate created.');
      }
      setTaxModal(false);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save tax rate.', 'error');
    }
  }

  async function handleExportTaxes() {
    try {
      const res = await apiRequest<{ filename: string; csv: string }>('/api/finance/tax-rates/export');
      downloadCsvBlob(res.filename, res.csv);
      onNotify('Tax schedule CSV downloaded.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Export failed.', 'error');
    }
  }

  function openCreateCurrency() {
    setEditingCurr(null);
    setCurrCode('');
    setCurrName('');
    setCurrSymbol('');
    setCurrRate('1.0');
    setCurrBase(false);
    setCurrModal(true);
  }

  function openEditCurrency(c: CurrencyRateItem) {
    setEditingCurr(c);
    setCurrCode(c.code);
    setCurrName(c.name);
    setCurrSymbol(c.symbol);
    setCurrRate(String(c.exchange_rate));
    setCurrBase(Boolean(c.is_base));
    setCurrModal(true);
  }

  async function handleSaveCurrency(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        code: currCode,
        name: currName,
        symbol: currSymbol,
        exchangeRate: Number(currRate) || 1,
        isBase: currBase,
      };
      if (editingCurr) {
        await apiRequest(`/api/finance/currencies/${editingCurr.id}`, { method: 'PUT', body: payload });
        onNotify(`Currency ${editingCurr.code} updated.`);
      } else {
        await apiRequest('/api/finance/currencies', { method: 'POST', body: payload });
        onNotify('Currency added.');
      }
      setCurrModal(false);
      await onReload();
      await loadFxWorkspace();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save currency.', 'error');
    }
  }

  async function handleSetBaseCurrency(c: CurrencyRateItem) {
    try {
      await apiRequest(`/api/finance/currencies/${c.id}`, {
        method: 'PUT',
        body: { isBase: true },
      });
      onNotify(`${c.code} set as functional base currency.`);
      await onReload();
      await loadFxWorkspace();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update base currency.', 'error');
    }
  }

  function openCreatePeriodRate() {
    const foreign = activeCurrencies.filter((c) => !c.is_base);
    const defaultCurr = foreign[0];
    const openPeriod = activePeriods.find((p) => p.status === 'open') || activePeriods[0];
    setEditingRate(null);
    setRateCurrencyCode(defaultCurr?.code || 'EUR');
    setRateFiscalPeriodId(openPeriod ? String(openPeriod.id) : '');
    setRateFromDate(openPeriod?.start_date || new Date().toISOString().slice(0, 8) + '01');
    setRateToDate(openPeriod?.end_date || new Date().toISOString().slice(0, 8) + '28');
    setRateBooking(String(defaultCurr?.exchange_rate ?? 1));
    setRateClosing(String(defaultCurr?.exchange_rate ?? 1));
    setRateSource('manual');
    setRateNotes('');
    setRateModal(true);
  }

  function openEditPeriodRate(r: CurrencyPeriodRateItem) {
    setEditingRate(r);
    setRateCurrencyCode(r.currency_code);
    setRateFiscalPeriodId(r.fiscal_period_id ? String(r.fiscal_period_id) : '');
    setRateFromDate(r.effective_from);
    setRateToDate(r.effective_to);
    setRateBooking(String(r.exchange_rate));
    setRateClosing(String(r.closing_rate || r.exchange_rate));
    setRateSource(r.rate_source || 'manual');
    setRateNotes(r.notes || '');
    setRateModal(true);
  }

  function handleRatePeriodSelect(fpIdStr: string) {
    setRateFiscalPeriodId(fpIdStr);
    const matched = activePeriods.find((p) => String(p.id) === fpIdStr);
    if (matched) {
      setRateFromDate(matched.start_date);
      setRateToDate(matched.end_date);
    }
  }

  async function handleSavePeriodRate(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        currencyCode: rateCurrencyCode,
        fiscalPeriodId: rateFiscalPeriodId ? Number(rateFiscalPeriodId) : null,
        effectiveFrom: rateFromDate,
        effectiveTo: rateToDate,
        exchangeRate: Number(rateBooking),
        closingRate: Number(rateClosing) || Number(rateBooking),
        rateSource,
        notes: rateNotes,
      };
      if (editingRate) {
        await apiRequest(`/api/finance/currency-rates/${editingRate.id}`, {
          method: 'PUT',
          body: payload,
        });
        onNotify(`Period FX rate updated for ${editingRate.currency_code}.`);
      } else {
        await apiRequest('/api/finance/currency-rates', {
          method: 'POST',
          body: payload,
        });
        onNotify(`Period FX rate defined for ${rateCurrencyCode}.`);
      }
      setRateModal(false);
      await loadFxWorkspace();
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save period exchange rate.', 'error');
    }
  }

  async function handleExportPeriodRates() {
    try {
      const qs = new URLSearchParams();
      if (periodFilter !== 'all') qs.set('fiscalPeriodId', periodFilter);
      if (currencyFilter !== 'ALL') qs.set('currencyCode', currencyFilter);
      const res = await apiRequest<{ filename: string; csv: string }>(
        `/api/finance/currency-rates/export${qs.toString() ? `?${qs.toString()}` : ''}`
      );
      downloadCsvBlob(res.filename, res.csv);
      onNotify('Period FX schedule CSV downloaded.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Export failed.', 'error');
    }
  }

  async function handlePostFxRevaluation() {
    if (!fxWorkspace) return;
    setRevaluing(true);
    try {
      const res = await apiRequest<{
        postedEntry: { ref: string; amount: number } | null;
        message?: string;
      }>('/api/finance/currency-service/revalue', {
        method: 'POST',
        body: {
          fiscalPeriodId: fxWorkspace.revaluationPeriod?.id ?? null,
          postToLedger: true,
        },
      });
      if (res.postedEntry) {
        onNotify(`FX revaluation posted as ${res.postedEntry.ref} (${baseCurrency.code} ${res.postedEntry.amount.toFixed(2)}).`);
        await loadFxWorkspace();
        await onReload();
      } else {
        onNotify(res.message || 'No material unrealized FX variance to post.');
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to post FX revaluation.', 'error');
    } finally {
      setRevaluing(false);
    }
  }

  const foreignCurrencies = activeCurrencies.filter((c) => !c.is_base);
  const netFxDiff = fxWorkspace?.summary.netUnrealizedFxGainLoss ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-0.5">
          {(
            [
              ['taxes', `Tax Frameworks (${taxRates.length})`],
              ['currencies', `Multi-Currency & FX (${currencies.length})`],
              ['margins', 'Commercial Margins & VAT'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSubTab(key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 ${
                subTab === key
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {subTab === 'taxes' && (
            <>
              <button
                type="button"
                onClick={handleExportTaxes}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
              {canWrite && (
                <button
                  type="button"
                  onClick={openCreateTax}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Tax Code</span>
                </button>
              )}
            </>
          )}
          {subTab === 'currencies' && (
            <>
              <button
                type="button"
                onClick={handleExportPeriodRates}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Rates CSV</span>
              </button>
              {canWrite && (
                <>
                  <button
                    type="button"
                    onClick={openCreatePeriodRate}
                    disabled={foreignCurrencies.length === 0}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs font-medium whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    <span>Define Period Rate</span>
                  </button>
                  <button
                    type="button"
                    onClick={openCreateCurrency}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Currency</span>
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {subTab === 'taxes' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Output Tax / VAT Collected</div>
              <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                {formatCurrency(marginStats.vat_collected)}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Input Tax / VAT Deductible</div>
              <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                {formatCurrency(marginStats.vat_deductible)}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Net Tax Return Position</div>
              <div
                className={`mt-1 text-xl font-semibold font-mono tabular-nums ${
                  netVat >= 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {formatCurrency(netVat)}
              </div>
              <div className="text-[11px] text-zinc-500">{netVat >= 0 ? 'Payable to tax authority' : 'Net tax credit'}</div>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-2.5 px-4 font-medium">Code</th>
                    <th className="py-2.5 px-4 font-medium">Tax Name &amp; Scope</th>
                    <th className="py-2.5 px-4 font-medium text-right">Rate</th>
                    <th className="py-2.5 px-4 font-medium">Applies To</th>
                    <th className="py-2.5 px-4 font-medium">Status</th>
                    <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {taxRates.map((t) => (
                    <tr key={t.id}>
                      <td className="py-2.5 px-4 font-mono font-medium text-orange-700 dark:text-orange-400">{t.code}</td>
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">{t.name}</div>
                        <div className="text-[11px] capitalize text-zinc-500">{t.tax_type} ledger</div>
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-right font-semibold">{t.rate.toFixed(2)}%</td>
                      <td className="py-2.5 px-4 text-zinc-600 dark:text-zinc-400">{t.applies_to}</td>
                      <td className="py-2.5 px-4">
                        <StatusText status={t.is_active ? 'active' : 'inactive'} />
                      </td>
                      <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => openEditTax(t)}
                            title="Edit tax code"
                            aria-label={`Edit ${t.code}`}
                            className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center align-middle"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => onPromptDelete(`/api/finance/tax-rates/${t.id}`, 'Delete Tax Code', `${t.code} — ${t.name}`)}
                            title="Delete tax code"
                            aria-label={`Delete ${t.code}`}
                            className="text-zinc-400 hover:text-red-600 inline-flex items-center align-middle"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {subTab === 'currencies' && (
        <div className="space-y-5">
          {/* Multi-Currency Service KPI Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="text-xs text-zinc-500">Base Reporting Currency</div>
              <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                {baseCurrency.code} ({baseCurrency.symbol})
              </div>
              <div className="mt-1 text-[11px] text-zinc-500">
                {activeCurrencies.length} currencies · {fxWorkspace?.summary.periodRatesCount ?? 0} period schedules
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="text-xs text-zinc-500">Open FX Exposure ({baseCurrency.code})</div>
              <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                {formatCurrency(fxWorkspace?.summary.foreignExposureBaseTotal ?? 0)}
              </div>
              <div className="mt-1 text-[11px] text-zinc-500">
                {fxWorkspace?.summary.activeForeignInvoicesCount ?? 0} open foreign invoices
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="text-xs text-zinc-500">Unrealized FX Position</div>
              <div
                className={`mt-1 inline-flex items-center gap-1.5 text-xl font-semibold font-mono tabular-nums ${
                  netFxDiff > 0.005
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : netFxDiff < -0.005
                      ? 'text-red-700 dark:text-red-400'
                      : 'text-zinc-900 dark:text-zinc-100'
                }`}
              >
                {netFxDiff > 0.005 ? (
                  <TrendingUp className="w-4 h-4 shrink-0" />
                ) : netFxDiff < -0.005 ? (
                  <TrendingDown className="w-4 h-4 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-zinc-400" />
                )}
                <span>
                  {netFxDiff >= 0 ? '+' : ''}
                  {formatCurrency(netFxDiff)}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-zinc-500">
                {fxWorkspace?.revaluationPeriod ? `Closing rate: ${fxWorkspace.revaluationPeriod.code}` : 'Spot close comparison'}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="text-xs text-zinc-500">FX Journal Conversions</div>
              <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                {formatCurrency(fxWorkspace?.summary.foreignJournalEntriesBaseTotal ?? 0)}
              </div>
              <div className="mt-1 text-[11px] text-zinc-500">
                {fxWorkspace?.summary.foreignJournalEntriesCount ?? 0} foreign-denominated GL postings
              </div>
            </div>
          </div>

          {/* Period-Aware FX Conversion Service Widget */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Period-Aware Currency Translation Service</h3>
                <p className="text-xs text-zinc-500">
                  Resolves period-specific average or closing FX rates automatically for any transaction date or fiscal period.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void runLiveConversion()}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${converting ? 'animate-spin' : ''}`} />
                <span>Recalculate</span>
              </button>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-[11px] font-medium text-zinc-500 mb-1">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  value={fxAmount}
                  onChange={(e) => setFxAmount(e.target.value)}
                  className="w-32 h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-zinc-500 mb-1">From</label>
                <select
                  value={fxFrom}
                  onChange={(e) => setFxFrom(e.target.value)}
                  className="h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
                >
                  {activeCurrencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </select>
              </div>
              <ArrowLeftRight className="w-4 h-4 text-zinc-400 mb-2" />
              <div>
                <label className="block text-[11px] font-medium text-zinc-500 mb-1">To</label>
                <select
                  value={fxTo}
                  onChange={(e) => setFxTo(e.target.value)}
                  className="h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
                >
                  {activeCurrencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-zinc-500 mb-1">Fiscal Period (Optional)</label>
                <select
                  value={fxPeriodId}
                  onChange={(e) => setFxPeriodId(e.target.value)}
                  className="h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
                >
                  <option value="">Resolve by Date</option>
                  {activePeriods.map((fp) => (
                    <option key={fp.id} value={fp.id}>
                      {fp.code} ({fp.start_date} – {fp.end_date})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-zinc-500 mb-1">Transaction Date</label>
                <input
                  type="date"
                  value={fxDate}
                  onChange={(e) => setFxDate(e.target.value)}
                  disabled={Boolean(fxPeriodId)}
                  className="h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs disabled:opacity-60"
                />
              </div>
              <label className="inline-flex items-center gap-1.5 h-9 text-xs text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={fxPreferClosing}
                  onChange={(e) => setFxPreferClosing(e.target.checked)}
                />
                <span>Use Closing Rate</span>
              </label>
              <div className="pb-1 pl-2">
                <div className="text-[11px] text-zinc-500">
                  Converted Equivalent{' '}
                  {conversion?.periodCode
                    ? `· Period ${conversion.periodCode}`
                    : conversion?.rateSource === 'spot_fallback'
                      ? '· Spot Fallback'
                      : ''}
                </div>
                <div className="text-base font-semibold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                  {fxTo}{' '}
                  {(conversion?.convertedAmount ?? 0).toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
                {conversion && (
                  <div className="text-[11px] font-mono tabular-nums text-zinc-500">
                    1 {fxFrom} = {conversion.crossRate.toFixed(4)} {fxTo} · Base ({conversion.baseCurrencyCode}):{' '}
                    {formatCurrency(conversion.baseAmount)}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Period-Specific Exchange Rates Schedule */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Period Exchange Rate Schedules</h3>
                <p className="text-xs text-zinc-500">
                  Historical and active FX tables applied automatically to invoices, bills, and GL journal postings by date.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={periodFilter}
                  onChange={(e) => setPeriodFilter(e.target.value)}
                  className="h-8 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
                >
                  <option value="all">All Fiscal Periods</option>
                  {activePeriods.map((fp) => (
                    <option key={fp.id} value={fp.id}>
                      {fp.code} — {fp.name}
                    </option>
                  ))}
                </select>
                <select
                  value={currencyFilter}
                  onChange={(e) => setCurrencyFilter(e.target.value)}
                  className="h-8 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
                >
                  <option value="ALL">All Currencies</option>
                  {foreignCurrencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-2.5 px-4 font-medium">Currency</th>
                    <th className="py-2.5 px-4 font-medium">Fiscal Period &amp; Window</th>
                    <th className="py-2.5 px-4 font-medium text-right">Booking Rate (per 1 {baseCurrency.code})</th>
                    <th className="py-2.5 px-4 font-medium text-right">Closing Rate</th>
                    <th className="py-2.5 px-4 font-medium text-right">1 Foreign = {baseCurrency.code}</th>
                    <th className="py-2.5 px-4 font-medium">Source &amp; Notes</th>
                    <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {fxLoading && !fxWorkspace ? (
                    <tr>
                      <td colSpan={7} className="py-6 px-4 text-center text-zinc-500">
                        Loading period exchange rates...
                      </td>
                    </tr>
                  ) : (fxWorkspace?.periodRates ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 px-4 text-center text-zinc-500">
                        No period exchange rates match this filter. Define a period rate to automate date-based conversions.
                      </td>
                    </tr>
                  ) : (
                    (fxWorkspace?.periodRates ?? []).map((r) => (
                      <tr key={r.id}>
                        <td className="py-2.5 px-4">
                          <div className="font-mono font-semibold text-orange-700 dark:text-orange-400">
                            {r.currency_code} {r.currency_symbol ? `(${r.currency_symbol})` : ''}
                          </div>
                          <div className="text-[11px] text-zinc-500">{r.currency_name || r.currency_code}</div>
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-mono font-medium text-zinc-900 dark:text-zinc-100">
                            {r.period_code || 'Custom Range'}
                            {r.period_status ? ` · ${r.period_status}` : ''}
                          </div>
                          <div className="text-[11px] font-mono text-zinc-500">
                            {formatDate(r.effective_from)} → {formatDate(r.effective_to)}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-right font-semibold">
                          {r.exchange_rate.toFixed(4)}
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-right text-zinc-600 dark:text-zinc-300">
                          {r.closing_rate.toFixed(4)}
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-right text-zinc-500">
                          {r.inverse_rate.toFixed(4)}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-medium text-zinc-700 dark:text-zinc-300">
                            {RATE_SOURCE_LABELS[r.rate_source] || r.rate_source}
                          </div>
                          {r.notes && <div className="text-[11px] text-zinc-500 truncate max-w-xs">{r.notes}</div>}
                        </td>
                        <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => openEditPeriodRate(r)}
                              title="Edit period rate"
                              aria-label={`Edit ${r.currency_code} rate`}
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
                                  `/api/finance/currency-rates/${r.id}`,
                                  'Delete Period FX Rate',
                                  `${r.currency_code} (${r.period_code || `${r.effective_from}..${r.effective_to}`})`
                                )
                              }
                              title="Delete period rate"
                              aria-label={`Delete ${r.currency_code} rate`}
                              className="text-zinc-400 hover:text-red-600 inline-flex items-center align-middle"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Open Foreign Exposure & Period-End FX Revaluation */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Open Foreign Currency Exposure &amp; Period Revaluation
                </h3>
                <p className="text-xs text-zinc-500">
                  Compares booked historical rates on open foreign AR/AP balances against period closing rates.
                </p>
              </div>
              {canValidate && (
                <button
                  type="button"
                  disabled={revaluing || Math.abs(netFxDiff) < 0.01}
                  onClick={() => void handlePostFxRevaluation()}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${revaluing ? 'animate-spin' : ''}`} />
                  <span>{revaluing ? 'Posting Revaluation...' : 'Post Period FX Revaluation'}</span>
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-2.5 px-4 font-medium">Document / Account</th>
                    <th className="py-2.5 px-4 font-medium text-right">Foreign Balance</th>
                    <th className="py-2.5 px-4 font-medium text-right">Booked ({baseCurrency.code})</th>
                    <th className="py-2.5 px-4 font-medium text-right">Closing ({baseCurrency.code})</th>
                    <th className="py-2.5 px-4 font-medium text-right">Unrealized FX Gain/Loss</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {(fxWorkspace?.exposures ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 px-4 text-center text-zinc-500">
                        No open foreign-currency invoices or foreign bank balances currently require revaluation.
                      </td>
                    </tr>
                  ) : (
                    (fxWorkspace?.exposures ?? []).map((ex) => (
                      <tr key={`${ex.docType}-${ex.id}`}>
                        <td className="py-2.5 px-4">
                          <div className="font-mono font-medium text-orange-700 dark:text-orange-400">{ex.ref}</div>
                          <div className="text-zinc-900 dark:text-zinc-100">{ex.partyOrBank}</div>
                          <div className="text-[11px] text-zinc-500">
                            {ex.docType.replace('_', ' ')} · {formatDate(ex.issueDate)}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-right">
                          <div>
                            {ex.currency}{' '}
                            {ex.foreignBalance.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </div>
                          <div className="text-[11px] text-zinc-500">@ {ex.bookedRate.toFixed(4)}</div>
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-right">
                          {formatCurrency(ex.bookedBaseAmount)}
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-right">
                          <div>{formatCurrency(ex.revaluedBaseAmount)}</div>
                          <div className="text-[11px] text-zinc-500">
                            Close @ {ex.closingRate.toFixed(4)} {ex.periodCode ? `(${ex.periodCode})` : ''}
                          </div>
                        </td>
                        <td
                          className={`py-2.5 px-4 font-mono tabular-nums text-right font-semibold ${
                            ex.unrealizedFxGainLoss > 0.005
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : ex.unrealizedFxGainLoss < -0.005
                                ? 'text-red-700 dark:text-red-400'
                                : 'text-zinc-500'
                          }`}
                        >
                          {ex.unrealizedFxGainLoss >= 0 ? '+' : ''}
                          {formatCurrency(ex.unrealizedFxGainLoss)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Chart of Currencies (Base & Spot Fallback Table) */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Chart of Currencies &amp; Spot Fallbacks</h3>
              <p className="text-xs text-zinc-500">
                Active reporting and transaction currencies. Spot rates serve as fallback outside defined period schedules.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-2.5 px-4 font-medium">Code</th>
                    <th className="py-2.5 px-4 font-medium">Currency Name</th>
                    <th className="py-2.5 px-4 font-medium">Symbol</th>
                    <th className="py-2.5 px-4 font-medium text-right">Default Spot Rate (per 1 {baseCurrency.code})</th>
                    <th className="py-2.5 px-4 font-medium">Role</th>
                    <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {activeCurrencies.map((c) => (
                    <tr key={c.id}>
                      <td className="py-2.5 px-4 font-mono font-medium text-orange-700 dark:text-orange-400">{c.code}</td>
                      <td className="py-2.5 px-4 font-medium text-zinc-900 dark:text-zinc-100">{c.name}</td>
                      <td className="py-2.5 px-4 font-mono">{c.symbol}</td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-right font-semibold">{c.exchange_rate.toFixed(4)}</td>
                      <td className="py-2.5 px-4">
                        <StatusText status={c.is_base ? 'active' : 'open'} />
                      </td>
                      <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
                        {canWrite && !c.is_base && (
                          <button
                            type="button"
                            onClick={() => handleSetBaseCurrency(c)}
                            className="font-medium text-orange-700 dark:text-orange-400 hover:underline"
                          >
                            Set Base
                          </button>
                        )}
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => openEditCurrency(c)}
                            title="Edit currency"
                            aria-label={`Edit ${c.code}`}
                            className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center align-middle"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            disabled={Boolean(c.is_base)}
                            onClick={() =>
                              onPromptDelete(
                                `/api/finance/currencies/${c.id}`,
                                'Delete Currency',
                                `${c.code} — ${c.name}`,
                                'Base currency cannot be deleted while active.'
                              )
                            }
                            title={c.is_base ? 'Base currency cannot be deleted' : 'Delete currency'}
                            aria-label={`Delete ${c.code}`}
                            className={`inline-flex items-center align-middle ${
                              c.is_base ? 'text-zinc-300 dark:text-zinc-700 cursor-not-allowed' : 'text-zinc-400 hover:text-red-600'
                            }`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {subTab === 'margins' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
            <div className="text-xs text-zinc-500">Net Revenue (Excl. Tax)</div>
            <div className="text-2xl font-bold font-mono tabular-nums mt-1 text-zinc-900 dark:text-zinc-100">
              {formatCurrency(netRevenue)}
            </div>
            <div className="text-[11px] text-zinc-500 mt-1">
              After {formatCurrency(marginStats.credit_notes_ht)} credit notes
            </div>
          </div>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
            <div className="text-xs text-zinc-500">Supplier Purchases (Excl. Tax)</div>
            <div className="text-2xl font-bold font-mono tabular-nums mt-1 text-zinc-900 dark:text-zinc-100">
              {formatCurrency(marginStats.purchases_ht)}
            </div>
            <div className="text-[11px] text-zinc-500 mt-1">Validated &amp; draft supplier bills</div>
          </div>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
            <div className="text-xs text-zinc-500">Gross Commercial Margin</div>
            <div
              className={`text-2xl font-bold font-mono tabular-nums mt-1 ${
                grossMargin >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
              }`}
            >
              {formatCurrency(grossMargin)}
            </div>
            <div className="text-[11px] text-zinc-500 mt-1">{marginPct}% operating margin</div>
          </div>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
            <div className="text-xs text-zinc-500">Net VAT / Sales Tax Position</div>
            <div className="text-2xl font-bold font-mono tabular-nums mt-1 text-amber-700 dark:text-amber-400">
              {formatCurrency(netVat)}
            </div>
            <div className="text-[11px] text-zinc-500 mt-1">
              Collected {formatCurrency(marginStats.vat_collected)} − Deductible {formatCurrency(marginStats.vat_deductible)}
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <Modal open={taxModal} onClose={() => setTaxModal(false)} title={editingTax ? `Edit Tax Code ${editingTax.code}` : 'New Tax Rate'} maxWidthClass="max-w-md">
        <form onSubmit={handleSaveTax} className="space-y-3.5">
          {!editingTax && (
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Tax Code</label>
              <input type="text" value={taxCode} onChange={(e) => setTaxCode(e.target.value)} required placeholder="VAT-15" className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Display Name</label>
            <input type="text" value={taxName} onChange={(e) => setTaxName(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Rate (%)</label>
              <input type="number" step="0.01" min="0" max="100" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Ledger Scope</label>
              <select value={taxType} onChange={(e) => setTaxType(e.target.value as 'sales' | 'purchase' | 'both')} className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs">
                <option value="both">Sales &amp; Purchase</option>
                <option value="sales">Sales Only</option>
                <option value="purchase">Purchase Only</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Applies To</label>
            <input type="text" value={taxApplies} onChange={(e) => setTaxApplies(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={taxActive} onChange={(e) => setTaxActive(e.target.checked)} />
            <span>Active on invoice and bill selectors</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setTaxModal(false)} className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs">Cancel</button>
            <button type="submit" className="h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">Save Tax Code</button>
          </div>
        </form>
      </Modal>

      <Modal open={currModal} onClose={() => setCurrModal(false)} title={editingCurr ? `Edit Currency ${editingCurr.code}` : 'Add Currency'} maxWidthClass="max-w-md">
        <form onSubmit={handleSaveCurrency} className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            {!editingCurr && (
              <div>
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">ISO Code</label>
                <input type="text" value={currCode} onChange={(e) => setCurrCode(e.target.value)} required placeholder="SGD" maxLength={8} className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Symbol</label>
              <input type="text" value={currSymbol} onChange={(e) => setCurrSymbol(e.target.value)} required placeholder="S$" maxLength={4} className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Currency Name</label>
            <input type="text" value={currName} onChange={(e) => setCurrName(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Exchange Rate (per 1 {baseCurrency.code})</label>
            <input type="number" step="0.0001" min="0.0001" disabled={currBase} value={currBase ? '1' : currRate} onChange={(e) => setCurrRate(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono disabled:opacity-60" />
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={currBase} onChange={(e) => setCurrBase(e.target.checked)} />
            <span>Set as functional base currency (rate locked to 1.0000)</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setCurrModal(false)} className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs">Cancel</button>
            <button type="submit" className="h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">Save Currency</button>
          </div>
        </form>
      </Modal>

      <Modal
        open={rateModal}
        onClose={() => setRateModal(false)}
        title={editingRate ? `Edit ${editingRate.currency_code} Period FX Rate` : 'Define Period Exchange Rate'}
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handleSavePeriodRate} className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Foreign Currency</label>
              <select
                value={rateCurrencyCode}
                disabled={Boolean(editingRate)}
                onChange={(e) => setRateCurrencyCode(e.target.value)}
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs disabled:opacity-60"
              >
                {foreignCurrencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Fiscal Period</label>
              <select
                value={rateFiscalPeriodId}
                onChange={(e) => handleRatePeriodSelect(e.target.value)}
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              >
                <option value="">Custom Date Window</option>
                {activePeriods.map((fp) => (
                  <option key={fp.id} value={fp.id}>
                    {fp.code} ({fp.name})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Effective From</label>
              <input
                type="date"
                value={rateFromDate}
                onChange={(e) => setRateFromDate(e.target.value)}
                required
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Effective To</label>
              <input
                type="date"
                value={rateToDate}
                onChange={(e) => setRateToDate(e.target.value)}
                required
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Booking Rate (/{baseCurrency.code})
              </label>
              <input
                type="number"
                step="0.0001"
                min="0.0001"
                value={rateBooking}
                onChange={(e) => setRateBooking(e.target.value)}
                required
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Closing Rate (/{baseCurrency.code})
              </label>
              <input
                type="number"
                step="0.0001"
                min="0.0001"
                value={rateClosing}
                onChange={(e) => setRateClosing(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Rate Source</label>
              <select
                value={rateSource}
                onChange={(e) => setRateSource(e.target.value)}
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              >
                <option value="manual">Treasury Manual</option>
                <option value="ecb">ECB Reference</option>
                <option value="bsp">BSP Reference</option>
                <option value="fed">Fed / H.10 Desk</option>
                <option value="spot_override">Spot Override</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Notes</label>
            <input
              type="text"
              value={rateNotes}
              onChange={(e) => setRateNotes(e.target.value)}
              placeholder="Period FX guidance or central bank reference note"
              className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setRateModal(false)} className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs">
              Cancel
            </button>
            <button type="submit" className="h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">
              Save Period Rate
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

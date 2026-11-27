import { useMemo, useState, type FormEvent } from 'react';
import { ArrowLeftRight, Download, Pencil, Plus, Trash2 } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import type { CurrencyRateItem, TaxRateItem } from '../../types/erp';
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
  taxRates: TaxRateItem[];
  marginStats: MarginStats;
  canWrite: boolean;
  canDelete: boolean;
  onReload: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPromptDelete: (url: string, title: string, itemLabel: string, warning?: string) => void;
}

export function FinanceTaxCurrencySection({
  currencies,
  taxRates,
  marginStats,
  canWrite,
  canDelete,
  onReload,
  onNotify,
  onPromptDelete,
}: FinanceTaxCurrencySectionProps) {
  const [subTab, setSubTab] = useState<'taxes' | 'currencies' | 'margins'>('taxes');

  // Currency converter widget
  const [fxAmount, setFxAmount] = useState('1000');
  const [fxFrom, setFxFrom] = useState('USD');
  const [fxTo, setFxTo] = useState('EUR');

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

  const netRevenue = marginStats.revenue_ht - marginStats.credit_notes_ht;
  const grossMargin = netRevenue - marginStats.purchases_ht;
  const marginPct = netRevenue > 0 ? ((grossMargin / netRevenue) * 100).toFixed(1) : '0.0';
  const netVat = marginStats.vat_collected - marginStats.vat_deductible;

  const convertedValue = useMemo(() => {
    const amt = Number(fxAmount) || 0;
    const fromRate = currencies.find((c) => c.code === fxFrom)?.exchange_rate || 1;
    const toRate = currencies.find((c) => c.code === fxTo)?.exchange_rate || 1;
    return (amt / fromRate) * toRate;
  }, [fxAmount, fxFrom, fxTo, currencies]);

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
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update base currency.', 'error');
    }
  }

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
          {subTab === 'currencies' && canWrite && (
            <button
              type="button"
              onClick={openCreateCurrency}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Currency</span>
            </button>
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
          {/* Live FX Converter */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-[11px] font-medium text-zinc-500 mb-1">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  value={fxAmount}
                  onChange={(e) => setFxAmount(e.target.value)}
                  className="w-32 h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-zinc-500 mb-1">From</label>
                <select
                  value={fxFrom}
                  onChange={(e) => setFxFrom(e.target.value)}
                  className="h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
                >
                  {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
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
                  {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select>
              </div>
              <div className="pb-1.5 pl-2">
                <div className="text-[11px] text-zinc-500">Converted Equivalent</div>
                <div className="text-base font-semibold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                  {fxTo} {convertedValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-2.5 px-4 font-medium">Code</th>
                    <th className="py-2.5 px-4 font-medium">Currency Name</th>
                    <th className="py-2.5 px-4 font-medium">Symbol</th>
                    <th className="py-2.5 px-4 font-medium text-right">FX Rate (per 1 Base)</th>
                    <th className="py-2.5 px-4 font-medium">Role</th>
                    <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {currencies.map((c) => (
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
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Exchange Rate (per 1 Base)</label>
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
    </div>
  );
}

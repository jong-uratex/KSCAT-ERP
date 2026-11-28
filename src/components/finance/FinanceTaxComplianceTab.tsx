import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  RefreshCw,
  Scale,
  Search,
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatDate } from '../../lib/format';
import type {
  TaxComplianceDocumentRow,
  TaxCompliancePayload,
} from '../../types/erp';
import { Modal } from '../Modal';
import { StatusText } from '../StatusText';
import { downloadCsvBlob, formatMoneyWithCode } from './financeHelpers';

interface FinanceTaxComplianceTabProps {
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

type ComplianceViewTab = 'documents' | 'rates' | 'timeline';

function bucketDisplayLabel(bucket: TaxComplianceDocumentRow['vat_bucket']): {
  label: string;
  colorClass: string;
} {
  if (bucket === 'output') {
    return {
      label: 'Output Tax Collected',
      colorClass: 'text-orange-700 dark:text-orange-400',
    };
  }
  if (bucket === 'input_recognized') {
    return {
      label: 'Recognized Input Credit',
      colorClass: 'text-emerald-700 dark:text-emerald-400',
    };
  }
  return {
    label: 'Upcoming PO Input Credit',
    colorClass: 'text-amber-700 dark:text-amber-400',
  };
}

export function FinanceTaxComplianceTab({ onNotify }: FinanceTaxComplianceTabProps) {
  const [payload, setPayload] = useState<TaxCompliancePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const [viewTab, setViewTab] = useState<ComplianceViewTab>('documents');
  const [fiscalPeriod, setFiscalPeriod] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'invoices' | 'purchase_orders'>('all');
  const [taxBucket, setTaxBucket] = useState<'all' | 'output' | 'input_recognized' | 'input_pending_po'>('all');
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [search, setSearch] = useState('');
  const [inspectedDoc, setInspectedDoc] = useState<TaxComplianceDocumentRow | null>(null);

  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams();
    if (fiscalPeriod !== 'all') params.set('fiscalPeriod', fiscalPeriod);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (sourceFilter !== 'all') params.set('sourceFilter', sourceFilter);
    if (taxBucket !== 'all') params.set('taxBucket', taxBucket);
    if (includeDrafts) params.set('includeDrafts', 'true');
    if (search.trim()) params.set('search', search.trim());
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [fiscalPeriod, dateFrom, dateTo, sourceFilter, taxBucket, includeDrafts, search]);

  const loadCompliance = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest<TaxCompliancePayload>(
        `/api/finance/tax-compliance${buildQueryString()}`
      );
      setPayload(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to load tax compliance calculations.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [buildQueryString]);

  useEffect(() => {
    loadCompliance();
  }, [loadCompliance]);

  function handlePeriodSelect(code: string) {
    setFiscalPeriod(code);
    if (code === 'all') {
      setDateFrom('');
      setDateTo('');
      return;
    }
    const matched = payload?.fiscalPeriods.find((p) => p.code === code);
    if (matched) {
      setDateFrom(matched.start_date);
      setDateTo(matched.end_date);
    }
  }

  function handleResetFilters() {
    setFiscalPeriod('all');
    setDateFrom('');
    setDateTo('');
    setSourceFilter('all');
    setTaxBucket('all');
    setIncludeDrafts(false);
    setSearch('');
  }

  async function handleExportCsv() {
    setExporting(true);
    try {
      const res = await apiRequest<{ filename: string; csv: string }>(
        `/api/finance/tax-compliance/export${buildQueryString()}`
      );
      downloadCsvBlob(res.filename, res.csv);
      onNotify('Tax compliance schedule CSV downloaded.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to export tax compliance CSV.', 'error');
    } finally {
      setExporting(false);
    }
  }

  const summary = payload?.summary;
  const baseCcy = summary?.baseCurrency || 'USD';
  const hasFilters =
    fiscalPeriod !== 'all' ||
    Boolean(dateFrom) ||
    Boolean(dateTo) ||
    sourceFilter !== 'all' ||
    taxBucket !== 'all' ||
    includeDrafts ||
    Boolean(search.trim());

  const glReconciled = summary ? Math.abs(summary.glVariance) < 0.05 : true;

  return (
    <div className="space-y-5">
      {/* KPI Summary Strip */}
      {loading && !payload ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 animate-pulse space-y-2"
            >
              <div className="h-3 w-28 rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-7 w-36 rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-3 w-40 rounded bg-zinc-100 dark:bg-zinc-800/70" />
            </div>
          ))}
        </div>
      ) : error && !payload ? (
        <div className="rounded-xl border border-red-200 dark:border-red-900/60 bg-white dark:bg-zinc-900 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Tax Compliance Calculation Unavailable
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">{error}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={loadCompliance}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      ) : summary ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <div className="text-xs text-zinc-500">Output VAT / Sales Tax Collected</div>
            <div className="text-2xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100 mt-1">
              {formatMoneyWithCode(summary.netOutputVat, baseCcy)}
            </div>
            <div className="text-xs text-zinc-500 mt-1.5 flex items-center justify-between gap-2">
              <span>{summary.customerInvoiceCount} customer doc(s)</span>
              <span className="font-mono tabular-nums">
                Base {formatMoneyWithCode(summary.taxableSalesBase, baseCcy)}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <div className="text-xs text-zinc-500">Deductible Input VAT &amp; PO Credits</div>
            <div className="text-2xl font-semibold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-1">
              {formatMoneyWithCode(summary.recognizedInputVat, baseCcy)}
            </div>
            <div className="text-xs text-zinc-500 mt-1.5 flex items-center justify-between gap-2">
              <span>{summary.supplierBillCount} bill(s)</span>
              <span className="font-mono tabular-nums text-amber-700 dark:text-amber-400">
                +{formatMoneyWithCode(summary.pendingPoInputVat, baseCcy)} from {summary.openPoCount} open PO
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-zinc-500">Net Statutory Tax Payable</span>
              <span
                className={`text-[11px] font-medium whitespace-nowrap ${
                  summary.netStatutoryPayable >= 0
                    ? 'text-orange-700 dark:text-orange-400'
                    : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {summary.netStatutoryPayable >= 0 ? 'Liability Due' : 'Credit Balance'}
              </span>
            </div>
            <div
              className={`text-2xl font-semibold font-mono tabular-nums mt-1 ${
                summary.netStatutoryPayable >= 0
                  ? 'text-orange-700 dark:text-orange-400'
                  : 'text-emerald-700 dark:text-emerald-400'
              }`}
            >
              {formatMoneyWithCode(summary.netStatutoryPayable, baseCcy)}
            </div>
            <div className="text-xs text-zinc-500 mt-1.5 flex items-center justify-between gap-2">
              <span>Projected after open POs</span>
              <span className="font-mono tabular-nums font-medium text-zinc-700 dark:text-zinc-300">
                {formatMoneyWithCode(summary.projectedNetLiability, baseCcy)}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-zinc-500">GL 2200 VAT Payable Check</span>
              <span
                className={`inline-flex items-center gap-1 text-[11px] font-medium whitespace-nowrap ${
                  glReconciled
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-amber-700 dark:text-amber-400'
                }`}
              >
                {glReconciled ? (
                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                ) : (
                  <AlertCircle className="w-3 h-3 shrink-0" />
                )}
                {glReconciled ? 'Reconciled' : 'Variance'}
              </span>
            </div>
            <div className="text-2xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100 mt-1">
              {formatMoneyWithCode(summary.glVatPayableBalance, baseCcy)}
            </div>
            <div className="text-xs text-zinc-500 mt-1.5 flex items-center justify-between gap-2">
              <span>Computed vs GL diff</span>
              <span className="font-mono tabular-nums">
                {summary.glVariance >= 0 ? '+' : ''}
                {formatMoneyWithCode(summary.glVariance, baseCcy)}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {/* Filter & Actions Toolbar */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-0.5">
            {(
              [
                ['documents', `Document Schedule (${payload?.documents.length ?? 0})`],
                ['rates', `By Tax Rate (${payload?.rateBreakdown.length ?? 0})`],
                ['timeline', `Monthly Forecast (${payload?.monthlyTimeline.length ?? 0})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setViewTab(key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  viewTab === key
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer whitespace-nowrap shrink-0">
              <input
                type="checkbox"
                checked={includeDrafts}
                onChange={(e) => setIncludeDrafts(e.target.checked)}
                className="rounded border-zinc-300 text-orange-700 focus:ring-orange-600"
              />
              <span>Include Drafts</span>
            </label>

            {hasFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
              >
                Reset
              </button>
            )}

            <button
              type="button"
              onClick={loadCompliance}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={exporting || !payload}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              {exporting ? 'Exporting...' : 'Export CSV'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
          <div className="relative lg:col-span-2">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search invoice, PO ref, partner, tax ID..."
              aria-label="Search tax compliance documents"
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100"
            />
          </div>

          <select
            value={fiscalPeriod}
            onChange={(e) => handlePeriodSelect(e.target.value)}
            aria-label="Fiscal period filter"
            className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100"
          >
            <option value="all">All Fiscal Periods</option>
            {(payload?.fiscalPeriods ?? []).map((fp) => (
              <option key={fp.id} value={fp.code}>
                {fp.code} ({fp.status})
              </option>
            ))}
          </select>

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as 'all' | 'invoices' | 'purchase_orders')}
            aria-label="Source document filter"
            className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100"
          >
            <option value="all">All Document Sources</option>
            <option value="invoices">Invoices &amp; Credit Notes</option>
            <option value="purchase_orders">Open Purchase Orders</option>
          </select>

          <select
            value={taxBucket}
            onChange={(e) =>
              setTaxBucket(
                e.target.value as 'all' | 'output' | 'input_recognized' | 'input_pending_po'
              )
            }
            aria-label="Tax bucket filter"
            className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100"
          >
            <option value="all">All Tax Buckets</option>
            <option value="output">Output VAT Collected</option>
            <option value="input_recognized">Recognized Input VAT</option>
            <option value="input_pending_po">Pending PO Input Credits</option>
          </select>

          <div className="grid grid-cols-2 gap-1.5">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setFiscalPeriod('all');
                setDateFrom(e.target.value);
              }}
              aria-label="From date"
              className="px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setFiscalPeriod('all');
                setDateTo(e.target.value);
              }}
              aria-label="To date"
              className="px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100"
            />
          </div>
        </div>

        {summary && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-zinc-500 border-t border-zinc-100 dark:border-zinc-800/80">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                Functional currency: <strong className="font-mono text-zinc-700 dark:text-zinc-300">{baseCcy}</strong>
              </span>
              {summary.creditNoteOutputOffset > 0 && (
                <span>
                  Credit note output offset:{' '}
                  <strong className="font-mono text-zinc-700 dark:text-zinc-300">
                    -{formatMoneyWithCode(summary.creditNoteOutputOffset, baseCcy)}
                  </strong>
                </span>
              )}
              {summary.billedPoExcludedCount > 0 && (
                <span>
                  {summary.billedPoExcludedCount} already-billed PO(s) excluded to prevent double counting
                </span>
              )}
              {summary.draftExcludedCount > 0 && !includeDrafts && (
                <span>
                  {summary.draftExcludedCount} draft document(s) excluded
                </span>
              )}
            </div>
            <div className="inline-flex items-center gap-1.5 text-zinc-500">
              <Scale className="w-3.5 h-3.5" />
              <span>Statutory payable = Output VAT − Recognized Supplier Input VAT</span>
            </div>
          </div>
        )}
      </div>

      {/* Main Content View */}
      {viewTab === 'documents' && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-950/60 border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium whitespace-nowrap">Document</th>
                <th className="text-left px-4 py-2.5 font-medium whitespace-nowrap">Tax Bucket</th>
                <th className="text-left px-4 py-2.5 font-medium">Counterparty / Tax ID</th>
                <th className="text-left px-4 py-2.5 font-medium whitespace-nowrap">Date / Due</th>
                <th className="text-left px-4 py-2.5 font-medium whitespace-nowrap">Status</th>
                <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">Taxable Base</th>
                <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">Eff. Rate</th>
                <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">Liability Impact</th>
                <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">Lines</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {!payload || payload.documents.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center">
                    <div className="inline-flex flex-col items-center gap-2 text-zinc-500">
                      <FileText className="w-5 h-5 text-zinc-400" />
                      <span className="text-xs">
                        No invoices or purchase orders match the selected tax compliance filters.
                      </span>
                      {hasFilters && (
                        <button
                          type="button"
                          onClick={handleResetFilters}
                          className="mt-1 px-3 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                        >
                          Clear Filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                payload.documents.map((doc) => {
                  const bucketInfo = bucketDisplayLabel(doc.vat_bucket);
                  return (
                    <tr
                      key={doc.uid}
                      className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40 transition-colors"
                    >
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                          {doc.ref}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          {doc.doc_type_label}
                          {doc.source_ref ? ` · ${doc.source_ref}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={`text-xs font-medium ${bucketInfo.colorClass}`}>
                          {bucketInfo.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                          {doc.party_name}
                        </div>
                        <div className="text-[11px] font-mono text-zinc-500">
                          {doc.party_tax_id ? `Tax ID: ${doc.party_tax_id}` : 'No Tax ID on file'}
                          {doc.currency !== baseCcy ? ` · ${doc.currency} @ ${doc.exchange_rate}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400">
                        <div>{formatDate(doc.doc_date)}</div>
                        <div className="text-[11px] text-zinc-400">
                          Due {formatDate(doc.due_or_expected_date)}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <StatusText status={doc.status} />
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-xs text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                        {formatMoneyWithCode(doc.taxable_base_usd, baseCcy)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                        {doc.effective_rate_pct.toFixed(1)}%
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-mono tabular-nums text-xs font-semibold whitespace-nowrap ${
                          doc.liability_impact_usd > 0
                            ? 'text-orange-700 dark:text-orange-400'
                            : doc.liability_impact_usd < 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-zinc-500'
                        }`}
                      >
                        {doc.liability_impact_usd > 0 ? '+' : ''}
                        {formatMoneyWithCode(doc.liability_impact_usd, baseCcy)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setInspectedDoc(doc)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap"
                        >
                          <Eye className="w-3 h-3" />
                          Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {viewTab === 'rates' && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-950/60 border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Tax Code</th>
                <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">Rate</th>
                <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">Sales Base</th>
                <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">Output Tax</th>
                <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">Purchases Base</th>
                <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">Recognized Input</th>
                <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">Pending PO Credits</th>
                <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">Net Statutory VAT</th>
                <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">Projected Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {!payload || payload.rateBreakdown.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-xs text-zinc-500">
                    No tax rate activity recorded in the selected period.
                  </td>
                </tr>
              ) : (
                payload.rateBreakdown.map((rb) => (
                  <tr key={`${rb.tax_code}-${rb.rate}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        {rb.tax_code}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {rb.tax_name} · {rb.doc_count} doc(s)
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-xs text-zinc-700 dark:text-zinc-300">
                      {rb.rate.toFixed(1)}%
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-xs text-zinc-600 dark:text-zinc-400">
                      {formatMoneyWithCode(rb.sales_base_usd, baseCcy)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-xs font-medium text-orange-700 dark:text-orange-400">
                      {formatMoneyWithCode(rb.output_vat_usd, baseCcy)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-xs text-zinc-600 dark:text-zinc-400">
                      {formatMoneyWithCode(rb.purchases_base_usd, baseCcy)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      {formatMoneyWithCode(rb.recognized_input_vat_usd, baseCcy)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-xs text-amber-700 dark:text-amber-400">
                      {formatMoneyWithCode(rb.pending_po_input_vat_usd, baseCcy)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      {formatMoneyWithCode(rb.net_vat_usd, baseCcy)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                      {formatMoneyWithCode(rb.projected_net_vat_usd, baseCcy)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {viewTab === 'timeline' && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-950/60 border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Tax Month</th>
                <th className="text-right px-4 py-2.5 font-medium">Documents</th>
                <th className="text-right px-4 py-2.5 font-medium">Output VAT Collected</th>
                <th className="text-right px-4 py-2.5 font-medium">Recognized Input VAT</th>
                <th className="text-right px-4 py-2.5 font-medium">Pending PO Credits</th>
                <th className="text-right px-4 py-2.5 font-medium">Net Statutory Payable</th>
                <th className="text-right px-4 py-2.5 font-medium">Projected After POs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {!payload || payload.monthlyTimeline.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-xs text-zinc-500">
                    No monthly VAT periods recorded in the selected date range.
                  </td>
                </tr>
              ) : (
                payload.monthlyTimeline.map((row) => (
                  <tr key={row.period_month}>
                    <td className="px-4 py-2.5 font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      {row.period_month}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-xs text-zinc-600 dark:text-zinc-400">
                      {row.doc_count}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-xs font-medium text-orange-700 dark:text-orange-400">
                      {formatMoneyWithCode(row.output_vat_usd, baseCcy)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      {formatMoneyWithCode(row.recognized_input_vat_usd, baseCcy)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-xs text-amber-700 dark:text-amber-400">
                      {formatMoneyWithCode(row.pending_po_input_vat_usd, baseCcy)}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right font-mono tabular-nums text-xs font-semibold ${
                        row.net_payable_usd >= 0
                          ? 'text-orange-700 dark:text-orange-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {formatMoneyWithCode(row.net_payable_usd, baseCcy)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      {formatMoneyWithCode(row.projected_payable_usd, baseCcy)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Line-level Tax Breakdown Modal */}
      <Modal
        open={Boolean(inspectedDoc)}
        onClose={() => setInspectedDoc(null)}
        title={inspectedDoc ? `${inspectedDoc.ref} — Tax Calculation Breakdown` : 'Document Tax Details'}
        maxWidthClass="max-w-2xl"
      >
        {inspectedDoc && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <div className="text-zinc-500">Document Type</div>
                <div className="font-medium text-zinc-900 dark:text-zinc-100 mt-0.5">
                  {inspectedDoc.doc_type_label}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Counterparty</div>
                <div className="font-medium text-zinc-900 dark:text-zinc-100 mt-0.5">
                  {inspectedDoc.party_name}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Document Date</div>
                <div className="font-mono text-zinc-900 dark:text-zinc-100 mt-0.5">
                  {formatDate(inspectedDoc.doc_date)}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">FX Basis</div>
                <div className="font-mono text-zinc-900 dark:text-zinc-100 mt-0.5">
                  {inspectedDoc.currency} (rate {inspectedDoc.exchange_rate})
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50 dark:bg-zinc-950/60 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Line Item</th>
                    <th className="text-right px-3 py-2 font-medium">Qty</th>
                    <th className="text-right px-3 py-2 font-medium">Taxable Base ({baseCcy})</th>
                    <th className="text-right px-3 py-2 font-medium">Tax Rate</th>
                    <th className="text-right px-3 py-2 font-medium">Tax Amount ({baseCcy})</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {inspectedDoc.line_details.map((line, idx) => (
                    <tr key={`${line.ref}-${idx}`}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">{line.label}</div>
                        {line.ref && (
                          <div className="text-[11px] font-mono text-zinc-500">{line.ref}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                        {line.qty}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                        {formatMoneyWithCode(line.netBaseUsd, baseCcy)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                        {line.taxRate.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                        {formatMoneyWithCode(line.taxAmountUsd, baseCcy)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-zinc-50 dark:bg-zinc-950/60 border-t border-zinc-200 dark:border-zinc-800 font-semibold">
                  <tr>
                    <td colSpan={2} className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                      Net Liability Contribution
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                      {formatMoneyWithCode(inspectedDoc.taxable_base_usd, baseCcy)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                      {inspectedDoc.effective_rate_pct.toFixed(1)}%
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono tabular-nums ${
                        inspectedDoc.liability_impact_usd >= 0
                          ? 'text-orange-700 dark:text-orange-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {inspectedDoc.liability_impact_usd > 0 ? '+' : ''}
                      {formatMoneyWithCode(inspectedDoc.liability_impact_usd, baseCcy)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

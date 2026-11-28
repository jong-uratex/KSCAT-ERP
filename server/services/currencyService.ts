import type { DbClient } from '../db_adapter.ts';

export interface BaseCurrencyInfo {
  id: number;
  code: string;
  name: string;
  symbol: string;
  exchange_rate: number;
  is_base: number;
}

export interface CurrencyRow extends BaseCurrencyInfo {
  updated_at: string;
}

export interface CurrencyPeriodRateRow {
  id: number;
  currency_code: string;
  currency_name?: string;
  currency_symbol?: string;
  fiscal_period_id: number | null;
  period_code: string;
  period_name?: string;
  period_status?: 'open' | 'closed';
  effective_from: string;
  effective_to: string;
  exchange_rate: number;
  closing_rate: number;
  inverse_rate: number;
  rate_source: string;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type RateResolutionSource = 'base' | 'period_rate' | 'spot_fallback' | 'explicit_override';

export interface ResolvedRateResult {
  currencyCode: string;
  baseCurrencyCode: string;
  exchangeRate: number;
  closingRate: number;
  inverseRate: number;
  source: RateResolutionSource;
  rateId: number | null;
  fiscalPeriodId: number | null;
  periodCode: string;
  effectiveFrom: string;
  effectiveTo: string;
}

export interface CurrencyConversionResult {
  originalAmount: number;
  fromCurrency: string;
  toCurrency: string;
  baseCurrencyCode: string;
  baseAmount: number;
  convertedAmount: number;
  fromRate: number;
  toRate: number;
  crossRate: number;
  inverseCrossRate: number;
  rateSource: RateResolutionSource;
  periodCode: string;
  effectiveFrom: string;
  effectiveTo: string;
  txDate: string;
}

export interface NormalizedBaseTransaction {
  currency: string;
  baseCurrencyCode: string;
  originalAmount: number;
  exchangeRate: number;
  baseAmount: number;
  rateSource: RateResolutionSource;
  periodCode: string;
}

export interface SettlementFxImpact {
  invoiceCurrency: string;
  baseCurrencyCode: string;
  settlementAmountOriginal: number;
  bookedRate: number;
  settlementRate: number;
  bookedBaseAmount: number;
  settledBaseAmount: number;
  fxGainLoss: number;
  fxDirection: 'gain' | 'loss' | 'none';
  rateSource: RateResolutionSource;
  periodCode: string;
}

export interface FxExposureRow {
  docType: 'customer_invoice' | 'supplier_bill' | 'bank_account';
  id: number;
  ref: string;
  partyOrBank: string;
  currency: string;
  issueDate: string;
  foreignBalance: number;
  bookedRate: number;
  bookedBaseAmount: number;
  closingRate: number;
  revaluedBaseAmount: number;
  unrealizedFxGainLoss: number;
  rateSource: RateResolutionSource;
  periodCode: string;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function round6(n: number): number {
  return Math.round((n + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function createCurrencyService(db: DbClient) {
  async function getBaseCurrency(): Promise<BaseCurrencyInfo> {
    const row = (await db
      .prepare('SELECT id, code, name, symbol, exchange_rate, is_base FROM currencies WHERE is_base = 1 LIMIT 1')
      .get()) as BaseCurrencyInfo | undefined;
    if (row) {
      return { ...row, exchange_rate: 1 };
    }
    const usd = (await db
      .prepare("SELECT id, code, name, symbol, exchange_rate, is_base FROM currencies WHERE code = 'USD' LIMIT 1")
      .get()) as BaseCurrencyInfo | undefined;
    if (usd) {
      return { ...usd, exchange_rate: 1 };
    }
    return { id: 0, code: 'USD', name: 'US Dollar (Base)', symbol: '$', exchange_rate: 1, is_base: 1 };
  }

  async function resolveExchangeRate(
    currencyCode: string,
    options: { txDate?: string; fiscalPeriodId?: number | null; preferClosing?: boolean } = {}
  ): Promise<ResolvedRateResult> {
    const base = await getBaseCurrency();
    const cleanCode = String(currencyCode || base.code).trim().toUpperCase().slice(0, 8) || base.code;

    if (cleanCode === base.code) {
      return {
        currencyCode: cleanCode,
        baseCurrencyCode: base.code,
        exchangeRate: 1,
        closingRate: 1,
        inverseRate: 1,
        source: 'base',
        rateId: null,
        fiscalPeriodId: options.fiscalPeriodId ?? null,
        periodCode: '',
        effectiveFrom: '',
        effectiveTo: '',
      };
    }

    const preferClosing = Boolean(options.preferClosing);
    const periodId = options.fiscalPeriodId && options.fiscalPeriodId > 0 ? Number(options.fiscalPeriodId) : null;
    const txDate = String(options.txDate || '').trim();

    type PeriodMatchRow = {
      id: number;
      fiscal_period_id: number | null;
      period_code: string;
      effective_from: string;
      effective_to: string;
      exchange_rate: number;
      closing_rate: number;
    };

    let periodRow: PeriodMatchRow | undefined;

    if (periodId) {
      periodRow = (await db
        .prepare(
          `SELECT id, fiscal_period_id, period_code, effective_from, effective_to, exchange_rate, closing_rate
           FROM currency_period_rates
           WHERE currency_code = ? AND fiscal_period_id = ?
           ORDER BY id DESC
           LIMIT 1`
        )
        .get(cleanCode, periodId)) as PeriodMatchRow | undefined;

      if (!periodRow) {
        const fp = (await db
          .prepare('SELECT start_date, end_date FROM fiscal_periods WHERE id = ?')
          .get(periodId)) as { start_date: string; end_date: string } | undefined;
        if (fp) {
          periodRow = (await db
            .prepare(
              `SELECT id, fiscal_period_id, period_code, effective_from, effective_to, exchange_rate, closing_rate
               FROM currency_period_rates
               WHERE currency_code = ? AND effective_from <= ? AND effective_to >= ?
               ORDER BY id DESC
               LIMIT 1`
            )
            .get(cleanCode, fp.end_date, fp.start_date)) as PeriodMatchRow | undefined;
        }
      }
    }

    if (!periodRow && txDate) {
      periodRow = (await db
        .prepare(
          `SELECT id, fiscal_period_id, period_code, effective_from, effective_to, exchange_rate, closing_rate
           FROM currency_period_rates
           WHERE currency_code = ? AND effective_from <= ? AND effective_to >= ?
           ORDER BY (julianday(effective_to) - julianday(effective_from)) ASC, id DESC
           LIMIT 1`
        )
        .get(cleanCode, txDate, txDate)) as PeriodMatchRow | undefined;
    }

    if (periodRow && Number.isFinite(periodRow.exchange_rate) && periodRow.exchange_rate > 0) {
      const closing = periodRow.closing_rate > 0 ? periodRow.closing_rate : periodRow.exchange_rate;
      const effective = preferClosing ? closing : periodRow.exchange_rate;
      return {
        currencyCode: cleanCode,
        baseCurrencyCode: base.code,
        exchangeRate: effective,
        closingRate: closing,
        inverseRate: round6(1 / effective),
        source: 'period_rate',
        rateId: periodRow.id,
        fiscalPeriodId: periodRow.fiscal_period_id,
        periodCode: periodRow.period_code,
        effectiveFrom: periodRow.effective_from,
        effectiveTo: periodRow.effective_to,
      };
    }

    const currRow = (await db
      .prepare('SELECT exchange_rate FROM currencies WHERE code = ? LIMIT 1')
      .get(cleanCode)) as { exchange_rate: number } | undefined;

    if (currRow && Number.isFinite(currRow.exchange_rate) && currRow.exchange_rate > 0) {
      return {
        currencyCode: cleanCode,
        baseCurrencyCode: base.code,
        exchangeRate: currRow.exchange_rate,
        closingRate: currRow.exchange_rate,
        inverseRate: round6(1 / currRow.exchange_rate),
        source: 'spot_fallback',
        rateId: null,
        fiscalPeriodId: periodId,
        periodCode: '',
        effectiveFrom: '',
        effectiveTo: '',
      };
    }

    throw new Error(`Currency "${cleanCode}" is not configured in the chart of currencies.`);
  }

  async function convertAmount(params: {
    amount: number;
    fromCurrency: string;
    toCurrency?: string;
    txDate?: string;
    fiscalPeriodId?: number | null;
    explicitRate?: number | null;
    preferClosing?: boolean;
  }): Promise<CurrencyConversionResult> {
    const base = await getBaseCurrency();
    const amount = Number(params.amount);
    if (!Number.isFinite(amount)) {
      throw new Error('Conversion amount must be a valid finite number.');
    }

    const fromCode = String(params.fromCurrency || base.code).trim().toUpperCase().slice(0, 8) || base.code;
    const toCode = String(params.toCurrency || base.code).trim().toUpperCase().slice(0, 8) || base.code;
    const txDate = String(params.txDate || new Date().toISOString().slice(0, 10)).trim();

    if (fromCode === toCode) {
      return {
        originalAmount: round2(amount),
        fromCurrency: fromCode,
        toCurrency: toCode,
        baseCurrencyCode: base.code,
        baseAmount: fromCode === base.code ? round2(amount) : round2(amount / (await resolveExchangeRate(fromCode, { txDate, fiscalPeriodId: params.fiscalPeriodId, preferClosing: params.preferClosing })).exchangeRate),
        convertedAmount: round2(amount),
        fromRate: 1,
        toRate: 1,
        crossRate: 1,
        inverseCrossRate: 1,
        rateSource: 'base',
        periodCode: '',
        effectiveFrom: '',
        effectiveTo: '',
        txDate,
      };
    }

    const fromResolved = await resolveExchangeRate(fromCode, {
      txDate,
      fiscalPeriodId: params.fiscalPeriodId,
      preferClosing: params.preferClosing,
    });
    const toResolved = await resolveExchangeRate(toCode, {
      txDate,
      fiscalPeriodId: params.fiscalPeriodId,
      preferClosing: params.preferClosing,
    });

    const explicit = params.explicitRate !== undefined && params.explicitRate !== null ? Number(params.explicitRate) : NaN;
    const useExplicit = Number.isFinite(explicit) && explicit > 0 && fromCode !== base.code && toCode === base.code;

    const fromRate = useExplicit ? explicit : fromResolved.exchangeRate;
    const toRate = toResolved.exchangeRate;
    const baseAmount = fromCode === base.code ? round2(amount) : round2(amount / fromRate);
    const rawBase = fromCode === base.code ? amount : amount / fromRate;
    const convertedAmount = toCode === base.code ? round2(rawBase) : round2(rawBase * toRate);
    const crossRate = round6(toRate / fromRate);

    return {
      originalAmount: round2(amount),
      fromCurrency: fromCode,
      toCurrency: toCode,
      baseCurrencyCode: base.code,
      baseAmount,
      convertedAmount,
      fromRate,
      toRate,
      crossRate,
      inverseCrossRate: round6(fromRate / toRate),
      rateSource: useExplicit ? 'explicit_override' : fromCode !== base.code ? fromResolved.source : toResolved.source,
      periodCode: fromResolved.periodCode || toResolved.periodCode,
      effectiveFrom: fromResolved.effectiveFrom || toResolved.effectiveFrom,
      effectiveTo: fromResolved.effectiveTo || toResolved.effectiveTo,
      txDate,
    };
  }

  async function normalizeTransactionToBase(params: {
    currency?: string;
    originalAmount: number;
    txDate?: string;
    fiscalPeriodId?: number | null;
    explicitRate?: number | null;
  }): Promise<NormalizedBaseTransaction> {
    const base = await getBaseCurrency();
    const cleanCurrency = String(params.currency || base.code).trim().toUpperCase().slice(0, 8) || base.code;
    const originalAmount = Number(params.originalAmount);
    if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
      throw new Error('Transaction amount must be greater than zero.');
    }

    if (cleanCurrency === base.code) {
      const rounded = round2(originalAmount);
      return {
        currency: cleanCurrency,
        baseCurrencyCode: base.code,
        originalAmount: rounded,
        exchangeRate: 1,
        baseAmount: rounded,
        rateSource: 'base',
        periodCode: '',
      };
    }

    const resolved = await resolveExchangeRate(cleanCurrency, {
      txDate: params.txDate,
      fiscalPeriodId: params.fiscalPeriodId,
    });
    const explicit = params.explicitRate !== undefined && params.explicitRate !== null ? Number(params.explicitRate) : NaN;
    const useExplicit = Number.isFinite(explicit) && explicit > 0;
    const effectiveRate = useExplicit ? explicit : resolved.exchangeRate;

    return {
      currency: cleanCurrency,
      baseCurrencyCode: base.code,
      originalAmount: round2(originalAmount),
      exchangeRate: effectiveRate,
      baseAmount: round2(originalAmount / effectiveRate),
      rateSource: useExplicit ? 'explicit_override' : resolved.source,
      periodCode: resolved.periodCode,
    };
  }

  async function computeSettlementFxImpact(params: {
    invoiceType: 'customer' | 'supplier';
    invoiceCurrency: string;
    invoiceRate: number;
    settlementAmount: number;
    paymentDate: string;
  }): Promise<SettlementFxImpact> {
    const base = await getBaseCurrency();
    const ccy = String(params.invoiceCurrency || base.code).trim().toUpperCase() || base.code;
    const bookedRate = params.invoiceRate > 0 ? params.invoiceRate : 1;
    const amount = round2(params.settlementAmount);

    if (ccy === base.code) {
      return {
        invoiceCurrency: ccy,
        baseCurrencyCode: base.code,
        settlementAmountOriginal: amount,
        bookedRate: 1,
        settlementRate: 1,
        bookedBaseAmount: amount,
        settledBaseAmount: amount,
        fxGainLoss: 0,
        fxDirection: 'none',
        rateSource: 'base',
        periodCode: '',
      };
    }

    const resolved = await resolveExchangeRate(ccy, { txDate: params.paymentDate });
    const bookedBaseAmount = round2(amount / bookedRate);
    const settledBaseAmount = round2(amount / resolved.exchangeRate);

    // For customer AR: collecting more base currency than booked is a Gain.
    // For supplier AP: paying less base currency than booked is a Gain.
    const rawDiff =
      params.invoiceType === 'customer'
        ? settledBaseAmount - bookedBaseAmount
        : bookedBaseAmount - settledBaseAmount;
    const fxGainLoss = round2(rawDiff);

    return {
      invoiceCurrency: ccy,
      baseCurrencyCode: base.code,
      settlementAmountOriginal: amount,
      bookedRate,
      settlementRate: resolved.exchangeRate,
      bookedBaseAmount,
      settledBaseAmount,
      fxGainLoss,
      fxDirection: fxGainLoss > 0.005 ? 'gain' : fxGainLoss < -0.005 ? 'loss' : 'none',
      rateSource: resolved.source,
      periodCode: resolved.periodCode,
    };
  }

  async function computePeriodRevaluation(fiscalPeriodId?: number | null): Promise<{
    baseCurrency: BaseCurrencyInfo;
    targetPeriod: { id: number; code: string; name: string; start_date: string; end_date: string; status: 'open' | 'closed' } | null;
    exposures: FxExposureRow[];
    netUnrealizedFxGainLoss: number;
    totalExposureBase: number;
  }> {
    const base = await getBaseCurrency();

    type PeriodRow = { id: number; code: string; name: string; start_date: string; end_date: string; status: 'open' | 'closed' };
    let targetPeriod: PeriodRow | null = null;

    if (fiscalPeriodId && fiscalPeriodId > 0) {
      targetPeriod = ((await db
        .prepare('SELECT id, code, name, start_date, end_date, status FROM fiscal_periods WHERE id = ?')
        .get(Number(fiscalPeriodId))) as PeriodRow | undefined) ?? null;
    } else {
      targetPeriod = ((await db
        .prepare("SELECT id, code, name, start_date, end_date, status FROM fiscal_periods WHERE status = 'open' ORDER BY start_date ASC LIMIT 1")
        .get()) as PeriodRow | undefined) ?? null;
    }

    const openInvoices = (await db
      .prepare(
        `SELECT i.id, i.ref, i.invoice_type, i.invoice_kind, i.currency, i.exchange_rate,
                i.issue_date, i.total_ttc, i.amount_paid, tp.name AS party_name
         FROM invoices i
         JOIN third_parties tp ON tp.id = i.third_party_id
         WHERE i.status IN ('validated', 'partial') AND UPPER(i.currency) != ?
         ORDER BY i.issue_date DESC, i.id DESC`
      )
      .all(base.code)) as Array<{
      id: number;
      ref: string;
      invoice_type: 'customer' | 'supplier';
      invoice_kind: string;
      currency: string;
      exchange_rate: number;
      issue_date: string;
      total_ttc: number;
      amount_paid: number;
      party_name: string;
    }>;

    const foreignBanks = (await db
      .prepare(
        `SELECT id, ref, name, bank_name, currency, balance
         FROM bank_accounts
         WHERE status = 'active' AND UPPER(currency) != ?
         ORDER BY id ASC`
      )
      .all(base.code)) as Array<{
      id: number;
      ref: string;
      name: string;
      bank_name: string;
      currency: string;
      balance: number;
    }>;

    const exposures: FxExposureRow[] = [];

    for (const inv of openInvoices) {
      const sign = inv.invoice_kind === 'credit_note' ? -1 : 1;
      const foreignBal = round2((inv.total_ttc - inv.amount_paid) * sign);
      if (Math.abs(foreignBal) <= 0.005) continue;

      const bookedRate = inv.exchange_rate > 0 ? inv.exchange_rate : 1;
      const bookedBaseAmount = round2(foreignBal / bookedRate);
      let resolved: ResolvedRateResult;
      try {
        resolved = await resolveExchangeRate(inv.currency, {
          txDate: targetPeriod?.end_date,
          fiscalPeriodId: targetPeriod?.id ?? null,
          preferClosing: true,
        });
      } catch {
        continue;
      }

      const closingRate = resolved.closingRate > 0 ? resolved.closingRate : resolved.exchangeRate;
      const revaluedBaseAmount = round2(foreignBal / closingRate);
      const unrealizedFxGainLoss =
        inv.invoice_type === 'customer'
          ? round2(revaluedBaseAmount - bookedBaseAmount)
          : round2(bookedBaseAmount - revaluedBaseAmount);

      exposures.push({
        docType: inv.invoice_type === 'supplier' ? 'supplier_bill' : 'customer_invoice',
        id: inv.id,
        ref: inv.ref,
        partyOrBank: inv.party_name,
        currency: inv.currency.toUpperCase(),
        issueDate: inv.issue_date,
        foreignBalance: foreignBal,
        bookedRate,
        bookedBaseAmount,
        closingRate,
        revaluedBaseAmount,
        unrealizedFxGainLoss,
        rateSource: resolved.source,
        periodCode: resolved.periodCode || targetPeriod?.code || '',
      });
    }

    for (const bk of foreignBanks) {
      if (Math.abs(bk.balance) <= 0.005) continue;
      let spotResolved: ResolvedRateResult;
      let closingResolved: ResolvedRateResult;
      try {
        spotResolved = await resolveExchangeRate(bk.currency, {});
        closingResolved = await resolveExchangeRate(bk.currency, {
          txDate: targetPeriod?.end_date,
          fiscalPeriodId: targetPeriod?.id ?? null,
          preferClosing: true,
        });
      } catch {
        continue;
      }
      const bookedRate = spotResolved.exchangeRate;
      const closingRate = closingResolved.closingRate > 0 ? closingResolved.closingRate : closingResolved.exchangeRate;
      const bookedBaseAmount = round2(bk.balance / bookedRate);
      const revaluedBaseAmount = round2(bk.balance / closingRate);
      const unrealizedFxGainLoss = round2(revaluedBaseAmount - bookedBaseAmount);

      exposures.push({
        docType: 'bank_account',
        id: bk.id,
        ref: bk.ref,
        partyOrBank: `${bk.name} (${bk.bank_name})`,
        currency: bk.currency.toUpperCase(),
        issueDate: targetPeriod?.end_date || new Date().toISOString().slice(0, 10),
        foreignBalance: round2(bk.balance),
        bookedRate,
        bookedBaseAmount,
        closingRate,
        revaluedBaseAmount,
        unrealizedFxGainLoss,
        rateSource: closingResolved.source,
        periodCode: closingResolved.periodCode || targetPeriod?.code || '',
      });
    }

    const totalExposureBase = round2(exposures.reduce((sum, x) => sum + Math.abs(x.revaluedBaseAmount), 0));
    const netUnrealizedFxGainLoss = round2(exposures.reduce((sum, x) => sum + x.unrealizedFxGainLoss, 0));

    return {
      baseCurrency: base,
      targetPeriod,
      exposures,
      netUnrealizedFxGainLoss,
      totalExposureBase,
    };
  }

  async function getMultiCurrencyWorkspace(filters: { fiscalPeriodId?: number | null; currencyCode?: string } = {}) {
    const baseCurrency = await getBaseCurrency();
    const currencies = (await db
      .prepare('SELECT * FROM currencies ORDER BY is_base DESC, code ASC')
      .all()) as CurrencyRow[];
    const fiscalPeriods = (await db
      .prepare('SELECT id, code, name, start_date, end_date, status FROM fiscal_periods ORDER BY start_date DESC, id DESC')
      .all()) as Array<{
      id: number;
      code: string;
      name: string;
      start_date: string;
      end_date: string;
      status: 'open' | 'closed';
    }>;

    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (filters.fiscalPeriodId && Number(filters.fiscalPeriodId) > 0) {
      conditions.push('r.fiscal_period_id = ?');
      params.push(Number(filters.fiscalPeriodId));
    }
    if (filters.currencyCode && filters.currencyCode !== 'ALL') {
      conditions.push('r.currency_code = ?');
      params.push(filters.currencyCode.trim().toUpperCase());
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rawPeriodRates = (await db
      .prepare(
        `SELECT r.*, c.name AS currency_name, c.symbol AS currency_symbol,
                fp.name AS period_name, fp.status AS period_status
         FROM currency_period_rates r
         LEFT JOIN currencies c ON c.code = r.currency_code
         LEFT JOIN fiscal_periods fp ON fp.id = r.fiscal_period_id
         ${whereClause}
         ORDER BY r.effective_from DESC, r.currency_code ASC`
      )
      .all(...params)) as Array<Omit<CurrencyPeriodRateRow, 'inverse_rate'>>;

    const periodRates: CurrencyPeriodRateRow[] = rawPeriodRates.map((r) => ({
      ...r,
      closing_rate: r.closing_rate > 0 ? r.closing_rate : r.exchange_rate,
      inverse_rate: round6(r.exchange_rate > 0 ? 1 / r.exchange_rate : 1),
    }));

    const revaluation = await computePeriodRevaluation(filters.fiscalPeriodId ?? null);

    const foreignJournalStats = (await db
      .prepare(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS base_total
         FROM journal_entries
         WHERE UPPER(currency) != ?`
      )
      .get(baseCurrency.code)) as { cnt: number; base_total: number };

    return {
      baseCurrency,
      currencies,
      fiscalPeriods,
      periodRates,
      revaluationPeriod: revaluation.targetPeriod,
      exposures: revaluation.exposures,
      summary: {
        totalCurrencies: currencies.length,
        periodRatesCount: periodRates.length,
        foreignExposureBaseTotal: revaluation.totalExposureBase,
        netUnrealizedFxGainLoss: revaluation.netUnrealizedFxGainLoss,
        activeForeignInvoicesCount: revaluation.exposures.filter((e) => e.docType !== 'bank_account').length,
        foreignJournalEntriesCount: foreignJournalStats.cnt,
        foreignJournalEntriesBaseTotal: round2(foreignJournalStats.base_total),
      },
    };
  }

  return {
    getBaseCurrency,
    resolveExchangeRate,
    convertAmount,
    normalizeTransactionToBase,
    computeSettlementFxImpact,
    computePeriodRevaluation,
    getMultiCurrencyWorkspace,
  };
}

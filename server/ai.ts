import { GoogleGenAI } from '@google/genai';
import type { AppEnv, DbClient } from './db_adapter.ts';

function createClient(env: AppEnv): GoogleGenAI {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('GEMINI_API_KEY is not configured in server environment secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function gatherLiveErpSummary(db: DbClient): Promise<string> {
  const inv = (await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN invoice_type = 'customer' AND status != 'cancelled' THEN total_ttc ELSE 0 END), 0) AS billed,
         COALESCE(SUM(CASE WHEN invoice_type = 'customer' AND status IN ('validated', 'partial') THEN total_ttc - amount_paid ELSE 0 END), 0) AS receivables,
         COALESCE(SUM(CASE WHEN invoice_type = 'supplier' AND status IN ('validated', 'partial') THEN total_ttc - amount_paid ELSE 0 END), 0) AS payables
       FROM invoices`
    )
    .get()) as { billed: number; receivables: number; payables: number };

  const lowStock = (await db
    .prepare(
      `SELECT p.ref, p.name, p.min_stock, COALESCE(SUM(sl.quantity), 0) AS qty
       FROM products p LEFT JOIN stock_levels sl ON sl.product_id = p.id
       WHERE p.product_type = 'product'
       GROUP BY p.id
       HAVING qty < p.min_stock`
    )
    .all()) as Array<{ ref: string; name: string; min_stock: number; qty: number }>;

  const openOpps = (await db
    .prepare(`SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS val FROM opportunities WHERE stage NOT IN ('won', 'lost')`)
    .get()) as { cnt: number; val: number };

  const openTickets = (await db
    .prepare(`SELECT COUNT(*) AS cnt FROM tickets WHERE status != 'closed'`)
    .get()) as { cnt: number };

  const openMo = (await db
    .prepare(`SELECT COUNT(*) AS cnt FROM manufacturing_orders WHERE status IN ('draft', 'validated', 'in_progress')`)
    .get()) as { cnt: number };

  const bankCash = (await db
    .prepare(`SELECT COALESCE(SUM(balance), 0) AS bal FROM bank_accounts WHERE status = 'active'`)
    .get()) as { bal: number };

  return JSON.stringify({
    cashBalanceUsd: bankCash.bal,
    totalCustomerBilledUsd: inv.billed,
    openReceivablesUsd: inv.receivables,
    openPayablesUsd: inv.payables,
    openPipelineOpportunities: openOpps,
    openSupportTickets: openTickets.cnt,
    pendingManufacturingOrders: openMo.cnt,
    lowStockSkus: lowStock,
  });
}

async function gatherFinancePartnerContext(db: DbClient): Promise<string> {
  const accounts = (await db
    .prepare(`SELECT code, label, account_class, balance FROM accounting_accounts ORDER BY code ASC`)
    .all()) as Array<{ code: string; label: string; account_class: string; balance: number }>;

  const classTotals = accounts.reduce<Record<string, number>>((acc, row) => {
    acc[row.account_class] = Math.round(((acc[row.account_class] ?? 0) + row.balance) * 100) / 100;
    return acc;
  }, {});

  const recon = (await db
    .prepare(
      `SELECT
         COUNT(CASE WHEN reconciled = 0 THEN 1 END) AS unreconciled_count,
         COALESCE(SUM(CASE WHEN reconciled = 0 AND direction = 'credit' THEN amount ELSE 0 END), 0) AS unreconciled_inflow,
         COALESCE(SUM(CASE WHEN reconciled = 0 AND direction = 'debit' THEN amount ELSE 0 END), 0) AS unreconciled_outflow,
         COUNT(CASE WHEN reconciled = 1 THEN 1 END) AS reconciled_count
       FROM bank_transactions`
    )
    .get()) as Record<string, number>;

  const openDocs = (await db
    .prepare(
      `SELECT i.ref, i.invoice_type, tp.name AS party_name, i.due_date, (i.total_ttc - i.amount_paid) AS balance_due, i.status
       FROM invoices i
       JOIN third_parties tp ON tp.id = i.third_party_id
       WHERE i.status IN ('validated', 'partial')
       ORDER BY i.due_date ASC
       LIMIT 15`
    )
    .all());

  const assets = (await db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(purchase_cost), 0) AS gross_cost,
              COALESCE(SUM(accumulated_depreciation), 0) AS accum_depr
       FROM fixed_assets WHERE status = 'active'`
    )
    .get()) as { count: number; gross_cost: number; accum_depr: number };

  const payroll = (await db
    .prepare(`SELECT ref, pay_date, total_gross, total_net, status FROM payroll_runs ORDER BY id DESC LIMIT 3`)
    .all());

  const mileage = (await db
    .prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS total_amount FROM mileage_claims WHERE status IN ('submitted', 'approved')`)
    .get());

  return JSON.stringify({
    glClassTotals: classTotals,
    glAccounts: accounts,
    bankReconciliation: recon,
    openInvoicesAndBills: openDocs,
    fixedAssetsSummary: {
      activeCount: assets.count,
      grossCost: assets.gross_cost,
      accumulatedDepreciation: assets.accum_depr,
      netBookValue: Math.round((assets.gross_cost - assets.accum_depr) * 100) / 100,
    },
    recentPayrollRuns: payroll,
    pendingMileageClaims: mileage,
  });
}

export async function runErpAiAssist(
  db: DbClient,
  env: AppEnv,
  params: {
    taskType: 'executive_brief' | 'ticket_reply' | 'proposal_scope' | 'email_campaign' | 'custom_qa' | 'finance_partner';
    prompt: string;
    contextRef?: string;
  }
): Promise<{ text: string; model: string }> {
  const ai = createClient(env);
  const model = 'gemini-4-hydrogen';
  const erpSnapshot = await gatherLiveErpSummary(db);

  let extraContext = '';
  if (params.taskType === 'ticket_reply' && params.contextRef) {
    const ticket = await db
      .prepare('SELECT ref, subject, category, severity, message FROM tickets WHERE ref = ? OR id = ?')
      .get(params.contextRef, Number(params.contextRef) || -1);
    if (ticket) {
      extraContext = `\nTarget Ticket:\n${JSON.stringify(ticket)}`;
    }
  } else if (params.taskType === 'finance_partner') {
    extraContext = `\nDetailed Accounting & Treasury Context:\n${await gatherFinancePartnerContext(db)}`;
  }

  const systemInstruction =
    params.taskType === 'finance_partner'
      ? 'You are the AI Finance Partner for KSCAT-ERP (KS Cross Asia Technologies Inc.). Analyze live accounting ledgers, P&L, cash position, unreconciled bank feeds, AR/AP aging, fixed assets, payroll, and mileage claims. Give crisp, factual, executive-ready recommendations grounded strictly in the numbers provided. Use clean plain text with structured bullet points.'
      : 'You are the KSCAT-ERP Operations & Finance Copilot for KS Cross Asia Technologies Inc. Be concise, factual, practical, and reference only numbers present in the supplied live ERP snapshot or user prompt. Format output clearly in plain text without unnecessary filler.';

  const fullPrompt = [
    `Task Type: ${params.taskType}`,
    `Live ERP Snapshot: ${erpSnapshot}`,
    extraContext,
    `User Request: ${params.prompt}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const response = await ai.models.generateContent({
    model,
    contents: fullPrompt,
    config: {
      systemInstruction,
    },
  });

  const text = (response.text ?? '').trim();
  if (!text) {
    throw new Error('Model returned an empty response.');
  }

  return { text, model };
}

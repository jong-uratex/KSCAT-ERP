import { GoogleGenAI } from '@google/genai';
import { db } from './db.ts';

function createClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
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

function gatherLiveErpSummary(): string {
  const inv = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN invoice_type = 'customer' AND status != 'cancelled' THEN total_ttc ELSE 0 END), 0) AS billed,
         COALESCE(SUM(CASE WHEN invoice_type = 'customer' AND status IN ('validated', 'partial') THEN total_ttc - amount_paid ELSE 0 END), 0) AS receivables,
         COALESCE(SUM(CASE WHEN invoice_type = 'supplier' AND status IN ('validated', 'partial') THEN total_ttc - amount_paid ELSE 0 END), 0) AS payables
       FROM invoices`
    )
    .get() as { billed: number; receivables: number; payables: number };

  const lowStock = db
    .prepare(
      `SELECT p.ref, p.name, p.min_stock, COALESCE(SUM(sl.quantity), 0) AS qty
       FROM products p LEFT JOIN stock_levels sl ON sl.product_id = p.id
       WHERE p.product_type = 'product'
       GROUP BY p.id
       HAVING qty < p.min_stock`
    )
    .all() as Array<{ ref: string; name: string; min_stock: number; qty: number }>;

  const openOpps = db
    .prepare(`SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS val FROM opportunities WHERE stage NOT IN ('won', 'lost')`)
    .get() as { cnt: number; val: number };

  const openTickets = db
    .prepare(`SELECT COUNT(*) AS cnt FROM tickets WHERE status != 'closed'`)
    .get() as { cnt: number };

  const openMo = db
    .prepare(`SELECT COUNT(*) AS cnt FROM manufacturing_orders WHERE status IN ('draft', 'validated', 'in_progress')`)
    .get() as { cnt: number };

  const bankCash = db
    .prepare(`SELECT COALESCE(SUM(balance), 0) AS bal FROM bank_accounts WHERE status = 'active'`)
    .get() as { bal: number };

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

export async function runErpAiAssist(params: {
  taskType: 'executive_brief' | 'ticket_reply' | 'proposal_scope' | 'email_campaign' | 'custom_qa';
  prompt: string;
  contextRef?: string;
}): Promise<{ text: string; model: string }> {
  const ai = createClient();
  const model = 'gemini-4-hydrogen';
  const erpSnapshot = gatherLiveErpSummary();

  let extraContext = '';
  if (params.taskType === 'ticket_reply' && params.contextRef) {
    const ticket = db
      .prepare('SELECT ref, subject, category, severity, message FROM tickets WHERE ref = ? OR id = ?')
      .get(params.contextRef, Number(params.contextRef) || -1);
    if (ticket) {
      extraContext = `\nTarget Ticket:\n${JSON.stringify(ticket)}`;
    }
  }

  const systemInstruction =
    'You are the KSCAT-ERP Operations & Finance Copilot for KS Cross Asia Technologies Inc. Be concise, factual, practical, and reference only numbers present in the supplied live ERP snapshot or user prompt. Format output clearly in plain text without unnecessary filler.';

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

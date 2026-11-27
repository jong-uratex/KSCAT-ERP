import { formatCurrency, formatDate } from '../../lib/format';
import type { DocumentLine, Invoice } from '../../types/erp';

export function escapeHtml(raw: unknown): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function parseDocumentLines(raw?: string): DocumentLine[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DocumentLine[]) : [];
  } catch {
    return [];
  }
}

export function formatMoneyWithCode(amount: number, currencyCode = 'USD'): string {
  const code = (currencyCode || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(amount) ? amount : 0);
  } catch {
    return `${code} ${formatCurrency(amount).replace('$', '')}`;
  }
}

export function downloadCsvBlob(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadInvoiceStatement(inv: Invoice): void {
  const lines = parseDocumentLines(inv.lines_json);
  const ccy = inv.currency || 'USD';
  const remaining = Math.max(0, (inv.total_ttc || 0) - (inv.amount_paid || 0));
  const titleLabel =
    inv.invoice_kind === 'credit_note'
      ? inv.invoice_type === 'supplier'
        ? 'Supplier Credit Note'
        : 'Customer Credit Note'
      : inv.invoice_type === 'supplier'
        ? 'Supplier Bill Statement'
        : 'Customer Invoice';

  const lineRows = lines
    .map((l) => {
      const ht = (Number(l.qty) || 0) * (Number(l.unitPrice) || 0) * (1 - (Number(l.discountPct) || 0) / 100);
      return `<tr>
        <td>${escapeHtml(l.ref ? `${l.ref} — ` : '')}${escapeHtml(l.label)}</td>
        <td class="num">${escapeHtml(l.qty)}</td>
        <td class="num">${escapeHtml(formatMoneyWithCode(l.unitPrice, ccy))}</td>
        <td class="num">${escapeHtml(l.discountPct || 0)}%</td>
        <td class="num">${escapeHtml(l.taxRate || 0)}%</td>
        <td class="num">${escapeHtml(formatMoneyWithCode(ht, ccy))}</td>
      </tr>`;
    })
    .join('');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(inv.ref)} — ${escapeHtml(titleLabel)}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; color: #18181b; padding: 32px; max-width: 780px; margin: 0 auto; }
    .head { display: flex; justify-content: space-between; border-bottom: 2px solid #c2410c; padding-bottom: 16px; margin-bottom: 24px; }
    .brand { font-size: 18px; font-weight: 700; }
    .muted { color: #71717a; font-size: 12px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
    th, td { padding: 9px 8px; border-bottom: 1px solid #e4e4e7; text-align: left; }
    th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .totals { margin-left: auto; width: 320px; font-size: 13px; }
    .totals td { border-bottom: 1px solid #e4e4e7; padding: 6px 8px; }
    .grand { font-size: 15px; font-weight: 700; color: #c2410c; }
  </style>
</head>
<body>
  <div class="head">
    <div>
      <div class="brand">KSCAT-ERP · ${escapeHtml(titleLabel)}</div>
      <div class="muted">KS Cross Asia Technologies Inc. · Finance &amp; Accounting</div>
    </div>
    <div style="text-align:right">
      <div style="font-weight:700; font-size:16px;">${escapeHtml(inv.ref)}</div>
      <div class="muted">Status: ${escapeHtml(inv.status.toUpperCase())} · Currency: ${escapeHtml(ccy)}</div>
    </div>
  </div>
  <div class="grid">
    <div>
      <div><strong>Counterparty:</strong> ${escapeHtml(inv.party_name)} (${escapeHtml(inv.party_ref)})</div>
      <div><strong>Project / Cost Center:</strong> ${escapeHtml(inv.project_ref ? `${inv.project_ref} — ${inv.project_title || ''}` : 'General Operating')}</div>
      ${inv.source_ref ? `<div><strong>Source Ref:</strong> ${escapeHtml(inv.source_ref)}</div>` : ''}
    </div>
    <div>
      <div><strong>Issue Date:</strong> ${escapeHtml(formatDate(inv.issue_date))}</div>
      <div><strong>Due Date:</strong> ${escapeHtml(formatDate(inv.due_date))}</div>
      <div><strong>FX Rate (vs USD):</strong> ${escapeHtml(inv.exchange_rate || 1)}</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Line Description</th>
        <th class="num">Qty</th>
        <th class="num">Unit Price</th>
        <th class="num">Disc</th>
        <th class="num">Tax</th>
        <th class="num">Net Amount</th>
      </tr>
    </thead>
    <tbody>
      ${lineRows || '<tr><td colspan="6">No line items recorded.</td></tr>'}
    </tbody>
  </table>
  <table class="totals">
    <tr><td>Subtotal (Excl. Tax)</td><td class="num">${escapeHtml(formatMoneyWithCode(inv.subtotal_ht, ccy))}</td></tr>
    <tr><td>Tax Total</td><td class="num">${escapeHtml(formatMoneyWithCode(inv.tax_total, ccy))}</td></tr>
    <tr><td class="grand">Total (Incl. Tax)</td><td class="num grand">${escapeHtml(formatMoneyWithCode(inv.total_ttc, ccy))}</td></tr>
    <tr><td>Settled / Paid</td><td class="num">${escapeHtml(formatMoneyWithCode(inv.amount_paid, ccy))}</td></tr>
    <tr><td><strong>Remaining Balance Due</strong></td><td class="num"><strong>${escapeHtml(formatMoneyWithCode(remaining, ccy))}</strong></td></tr>
  </table>
  ${inv.notes ? `<div class="muted"><strong>Notes:</strong> ${escapeHtml(inv.notes)}</div>` : ''}
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${inv.ref}-statement.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

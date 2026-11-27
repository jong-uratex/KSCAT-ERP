import type { JobHistoryEntry, KpiMetricItem, PayslipItem, TaxDocumentEntry } from '../../types/erp';
import { formatCurrency } from '../../lib/format';

export function parseJobHistory(raw?: string): JobHistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseTaxDocuments(raw?: string): TaxDocumentEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseKpiMetrics(raw?: string): KpiMetricItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function computeClientKpiScore(metrics: KpiMetricItem[]): { score: number; rating: string } {
  if (metrics.length === 0) return { score: 0, rating: 'Needs Improvement' };
  const totalWeight = metrics.reduce((acc, m) => acc + (Number(m.weightPct) || 0), 0);
  const rawScore =
    totalWeight > 0
      ? metrics.reduce((acc, m) => acc + (Number(m.score) || 0) * (Number(m.weightPct) || 0), 0) / totalWeight
      : metrics.reduce((acc, m) => acc + (Number(m.score) || 0), 0) / metrics.length;
  const score = Number(Math.max(0, Math.min(100, rawScore)).toFixed(1));
  const rating =
    score >= 90
      ? 'Exceeds Expectations'
      : score >= 75
        ? 'Meets Expectations'
        : score >= 60
          ? 'Developing'
          : 'Needs Improvement';
  return { score, rating };
}

function escapeHtml(raw: unknown): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function downloadPayslipDocument(slip: PayslipItem): void {
  const totalDed =
    (Number(slip.tax_deduction) || 0) +
    (Number(slip.social_deduction) || 0) +
    (Number(slip.health_deduction) || 0) +
    (Number(slip.other_deductions) || 0);

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Payslip ${escapeHtml(slip.ref)} — ${escapeHtml(slip.employee_name)}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; color: #18181b; padding: 32px; max-width: 720px; margin: 0 auto; }
    .head { display: flex; justify-content: space-between; border-bottom: 2px solid #c2410c; padding-bottom: 16px; margin-bottom: 24px; }
    .brand { font-size: 18px; font-weight: 700; }
    .muted { color: #71717a; font-size: 12px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
    th, td { padding: 10px 8px; border-bottom: 1px solid #e4e4e7; text-align: left; }
    th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .net { font-size: 16px; font-weight: 700; color: #15803d; }
  </style>
</head>
<body>
  <div class="head">
    <div>
      <div class="brand">KSCAT-ERP · Earnings Statement</div>
      <div class="muted">KS Cross Asia Technologies Inc.</div>
    </div>
    <div style="text-align:right">
      <div style="font-weight:700">${escapeHtml(slip.ref)}</div>
      <div class="muted">Pay Period: ${escapeHtml(slip.pay_period)} · Status: ${escapeHtml(slip.status.toUpperCase())}</div>
    </div>
  </div>
  <div class="grid">
    <div>
      <div><strong>Employee:</strong> ${escapeHtml(slip.employee_name)} (${escapeHtml(slip.employee_ref || '')})</div>
      <div><strong>Department:</strong> ${escapeHtml(slip.department || '—')}</div>
      <div><strong>Role:</strong> ${escapeHtml(slip.job_title || '—')}</div>
    </div>
    <div>
      <div><strong>Tax ID:</strong> ${escapeHtml(slip.tax_id || 'On File')}</div>
      <div><strong>Payment Method:</strong> ${escapeHtml(slip.payment_method)}</div>
      <div><strong>Deposit Ref:</strong> ${escapeHtml(slip.direct_deposit_ref || '—')} (${escapeHtml(slip.bank_account || 'Bank on file')})</div>
    </div>
  </div>
  <table>
    <thead>
      <tr><th>Component</th><th class="num">Amount</th></tr>
    </thead>
    <tbody>
      <tr><td>Gross Earnings (Base + Approved Overtime)</td><td class="num">${escapeHtml(formatCurrency(slip.gross_pay))}</td></tr>
      <tr><td>Statutory Income Tax Withholding</td><td class="num">-${escapeHtml(formatCurrency(slip.tax_deduction))}</td></tr>
      <tr><td>Social Security / Statutory Contribution</td><td class="num">-${escapeHtml(formatCurrency(slip.social_deduction))}</td></tr>
      <tr><td>Health &amp; Benefits Plan Contribution</td><td class="num">-${escapeHtml(formatCurrency(slip.health_deduction))}</td></tr>
      <tr><td>Other Deductions</td><td class="num">-${escapeHtml(formatCurrency(slip.other_deductions))}</td></tr>
      <tr><td><strong>Total Deductions</strong></td><td class="num"><strong>-${escapeHtml(formatCurrency(totalDed))}</strong></td></tr>
      <tr><td class="net">Net Pay Disbursed</td><td class="num net">${escapeHtml(formatCurrency(slip.net_pay))}</td></tr>
    </tbody>
  </table>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slip.ref}-${slip.pay_period}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

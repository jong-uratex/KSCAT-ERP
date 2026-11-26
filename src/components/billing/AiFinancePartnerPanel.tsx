import { useState, type FormEvent } from 'react';
import { Copy, Send, Sparkles, X } from 'lucide-react';
import { apiRequest } from '../../lib/api';

interface AiFinancePartnerPanelProps {
  open: boolean;
  onClose: () => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

const PRESET_PROMPTS = [
  {
    label: 'Cashflow & Working Capital',
    prompt:
      'Summarize our current cash balance, receivables vs payables ratio, and recommend top 3 working capital actions for the next 30 days.',
  },
  {
    label: 'Bank Reconciliation Focus',
    prompt:
      'Review our unreconciled bank feed items and open invoices/bills, and list which items should be matched or followed up first.',
  },
  {
    label: 'P&L & Margin Health',
    prompt:
      'Analyze our Profit & Loss statement, fixed asset book value, payroll overhead, and net VAT position. Highlight risks or cost opportunities.',
  },
  {
    label: 'Overdue Collections Plan',
    prompt:
      'Draft a prioritized collection and payment schedule for all open and overdue customer invoices and supplier bills.',
  },
];

export function AiFinancePartnerPanel({ open, onClose, onNotify }: AiFinancePartnerPanelProps) {
  const [prompt, setPrompt] = useState(PRESET_PROMPTS[0].prompt);
  const [answer, setAnswer] = useState('');
  const [modelName, setModelName] = useState('');
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  async function runQuery(textPrompt: string) {
    if (!textPrompt.trim()) return;
    setLoading(true);
    try {
      const res = await apiRequest<{ text: string; model: string }>('/api/billing/ai-partner', {
        method: 'POST',
        body: { prompt: textPrompt },
      });
      setAnswer(res.text);
      setModelName(res.model);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'AI Finance Partner request failed.', 'error');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    runQuery(prompt);
  }

  async function handleCopy() {
    if (!answer) return;
    try {
      await navigator.clipboard.writeText(answer);
      onNotify('Financial brief copied to clipboard.');
    } catch {
      onNotify('Unable to copy text.', 'error');
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            <Sparkles className="w-4 h-4 text-orange-700 dark:text-orange-400" />
            <span>AI Finance Partner</span>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            Ask questions across your live General Ledger, bank reconciliation queue, AR/AP aging, fixed assets, and payroll.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close AI Finance Partner"
          className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {PRESET_PROMPTS.map((item) => (
          <button
            key={item.label}
            type="button"
            disabled={loading}
            onClick={() => {
              setPrompt(item.prompt);
              runQuery(item.prompt);
            }}
            className="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
          >
            {item.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask your AI Finance Partner about cashflow, margins, overdue invoices, or taxes..."
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
        />
        <button
          type="submit"
          disabled={loading || !prompt.trim()}
          className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
        >
          <Send className="w-3.5 h-3.5" />
          <span>{loading ? 'Analyzing...' : 'Analyze Financials'}</span>
        </button>
      </form>

      {answer && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>Financial Insights {modelName ? `· ${modelName}` : ''}</span>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 text-zinc-600 dark:text-zinc-300 hover:underline"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </button>
          </div>
          <div className="text-xs leading-relaxed text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">{answer}</div>
        </div>
      )}
    </div>
  );
}

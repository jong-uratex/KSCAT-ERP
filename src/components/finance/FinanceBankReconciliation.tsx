import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  Download,
  FilePlus2,
  FileSpreadsheet,
  Link2,
  Link2Off,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatDate } from '../../lib/format';
import type {
  BankReconciliationPayload,
  BankStatementLineItem,
  ReconcilableJournalEntry,
} from '../../types/erp';
import { Modal } from '../Modal';
import { StatusText } from '../StatusText';
import { downloadCsvBlob, formatMoneyWithCode } from './financeHelpers';

interface FinanceBankReconciliationProps {
  canWrite: boolean;
  canRecordPay: boolean;
  canDelete: boolean;
  refreshTick?: number;
  onReload: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPromptDelete: (url: string, title: string, itemLabel: string, warning?: string) => void;
}

type MatchStatusFilter = 'all' | 'unmatched' | 'matched' | 'ignored';
type ManualLineDraft = {
  txDate: string;
  description: string;
  reference: string;
  direction: 'credit' | 'debit';
  amount: string;
};

type CsvPreviewLine = {
  txDate: string;
  description: string;
  reference: string;
  direction: 'credit' | 'debit';
  amount: number;
};

function parseClientCsvPreview(csvText: string): { rows: CsvPreviewLine[]; error: string } {
  const rawLines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (rawLines.length < 2) {
    return { rows: [], error: rawLines.length === 0 ? '' : 'Include a header row and at least one transaction row.' };
  }

  const headerRaw = rawLines[0];
  const delimiter =
    headerRaw.split(';').length > headerRaw.split(',').length
      ? ';'
      : headerRaw.split('\t').length > headerRaw.split(',').length
        ? '\t'
        : ',';

  const splitRow = (line: string): string[] => {
    const cells: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = !inQ;
        }
      } else if (ch === delimiter && !inQ) {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  };

  const headers = splitRow(headerRaw).map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, '_'));
  const findCol = (names: string[]) => headers.findIndex((h) => names.some((n) => h === n || h.includes(n)));

  const dateIdx = findCol(['tx_date', 'transaction_date', 'posting_date', 'value_date', 'date']);
  const descIdx = findCol(['description', 'memo', 'label', 'narrative', 'details', 'particulars', 'payee']);
  const refIdx = findCol(['reference', 'ref', 'check', 'tx_id', 'transaction_id', 'doc_ref']);
  const debitIdx = findCol(['debit', 'withdrawal', 'outflow']);
  const creditIdx = findCol(['credit', 'deposit', 'inflow']);
  const amtIdx = findCol(['amount', 'net', 'value']);
  const dirIdx = findCol(['direction', 'type', 'dr_cr', 'side']);

  if (dateIdx === -1 || descIdx === -1 || (amtIdx === -1 && debitIdx === -1 && creditIdx === -1)) {
    return { rows: [], error: 'Missing required columns: Date, Description, and Amount (or Debit/Credit).' };
  }

  const parseNum = (raw?: string): number | null => {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    const neg = /^\(.*\)$/.test(s);
    const cleaned = s.replace(/[(),$\s€£₱¥]/g, '');
    if (!cleaned || !/^[+-]?\d+(\.\d+)?$/.test(cleaned)) return null;
    const num = Number(cleaned);
    if (!Number.isFinite(num)) return null;
    return neg ? -Math.abs(num) : num;
  };

  const rows: CsvPreviewLine[] = [];
  for (let i = 1; i < Math.min(rawLines.length, 501); i++) {
    const cells = splitRow(rawLines[i]);
    if (cells.every((c) => !c)) continue;
    const txDate = cells[dateIdx] ?? '';
    const description = cells[descIdx] ?? '';
    if (!txDate || !description) continue;

    const dr = debitIdx >= 0 ? parseNum(cells[debitIdx]) : null;
    const cr = creditIdx >= 0 ? parseNum(cells[creditIdx]) : null;
    let direction: 'credit' | 'debit' = 'debit';
    let amount = 0;

    if (dr !== null && Math.abs(dr) > 0) {
      direction = 'debit';
      amount = Math.abs(dr);
    } else if (cr !== null && Math.abs(cr) > 0) {
      direction = 'credit';
      amount = Math.abs(cr);
    } else if (amtIdx >= 0) {
      const val = parseNum(cells[amtIdx]);
      if (val === null || Math.abs(val) <= 0) continue;
      const dirTxt = dirIdx >= 0 ? (cells[dirIdx] ?? '').toLowerCase() : '';
      if (['credit', 'cr', 'deposit', 'inflow', 'in'].includes(dirTxt)) direction = 'credit';
      else if (['debit', 'dr', 'withdrawal', 'outflow', 'out'].includes(dirTxt)) direction = 'debit';
      else direction = val >= 0 ? 'credit' : 'debit';
      amount = Math.abs(val);
    } else {
      continue;
    }

    rows.push({
      txDate,
      description,
      reference: refIdx >= 0 ? cells[refIdx] ?? '' : '',
      direction,
      amount: Math.round(amount * 100) / 100,
    });
  }

  return { rows, error: rows.length === 0 ? 'No valid transaction rows parsed yet.' : '' };
}

function dayDiffBetween(a: string, b: string): number {
  const t1 = Date.parse(`${a}T00:00:00Z`);
  const t2 = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return 999;
  return Math.round(Math.abs(t1 - t2) / 86400000);
}

export function FinanceBankReconciliation({
  canWrite,
  canRecordPay,
  canDelete,
  refreshTick = 0,
  onReload,
  onNotify,
  onPromptDelete,
}: FinanceBankReconciliationProps) {
  const [data, setData] = useState<BankReconciliationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [selectedStatementId, setSelectedStatementId] = useState<string>('');
  const [bankAccountFilter, setBankAccountFilter] = useState<string>('all');
  const [matchStatus, setMatchStatus] = useState<MatchStatusFilter>('all');
  const [search, setSearch] = useState('');
  const [journalScope, setJournalScope] = useState<'unmatched' | 'all'>('unmatched');
  const [journalSearch, setJournalSearch] = useState('');

  const [activeLineId, setActiveLineId] = useState<number | null>(null);
  const [busyActionId, setBusyActionId] = useState<string>('');
  const [autoMatching, setAutoMatching] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Upload / Manual Statement modal
  const [statementModal, setStatementModal] = useState(false);
  const [entryMode, setEntryMode] = useState<'csv' | 'manual'>('csv');
  const [stmtBankId, setStmtBankId] = useState('');
  const [stmtName, setStmtName] = useState('');
  const [stmtDate, setStmtDate] = useState(new Date().toISOString().slice(0, 10));
  const [stmtOpeningBal, setStmtOpeningBal] = useState('0');
  const [stmtClosingBal, setStmtClosingBal] = useState('');
  const [stmtNotes, setStmtNotes] = useState('');
  const [csvText, setCsvText] = useState('');
  const [manualRows, setManualRows] = useState<ManualLineDraft[]>([
    {
      txDate: new Date().toISOString().slice(0, 10),
      description: '',
      reference: '',
      direction: 'debit',
      amount: '',
    },
  ]);
  const [savingStatement, setSavingStatement] = useState(false);

  // Add Single Line modal
  const [addLineModal, setAddLineModal] = useState(false);
  const [newLineDate, setNewLineDate] = useState(new Date().toISOString().slice(0, 10));
  const [newLineDesc, setNewLineDesc] = useState('');
  const [newLineRef, setNewLineRef] = useState('');
  const [newLineDir, setNewLineDir] = useState<'credit' | 'debit'>('debit');
  const [newLineAmt, setNewLineAmt] = useState('');
  const [savingLine, setSavingLine] = useState(false);

  // Create Balancing Journal modal
  const [postLineTarget, setPostLineTarget] = useState<BankStatementLineItem | null>(null);
  const [cashAccountCode, setCashAccountCode] = useState('1010');
  const [counterAccountCode, setCounterAccountCode] = useState('6100');
  const [postJournalCode, setPostJournalCode] = useState('BNK');
  const [postDescription, setPostDescription] = useState('');
  const [postingJournal, setPostingJournal] = useState(false);

  const fetchReconciliation = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const qs = new URLSearchParams({
        matchStatus,
        search: search.trim(),
        journalScope,
      });
      if (selectedStatementId) qs.set('statementId', selectedStatementId);
      if (bankAccountFilter !== 'all') qs.set('bankAccountId', bankAccountFilter);

      const res = await apiRequest<BankReconciliationPayload>(`/api/bank-reconciliation?${qs.toString()}`);
      setData(res);
      if (res.activeStatement && String(res.activeStatement.id) !== selectedStatementId) {
        setSelectedStatementId(String(res.activeStatement.id));
      } else if (!res.activeStatement && selectedStatementId) {
        setSelectedStatementId('');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to load bank reconciliation workspace.';
      setLoadError(msg);
      onNotify(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedStatementId, bankAccountFilter, matchStatus, search, journalScope, onNotify]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchReconciliation();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [fetchReconciliation, refreshTick]);

  const activeStatement = data?.activeStatement ?? null;
  const statements = data?.statements ?? [];
  const bankAccounts = data?.bankAccounts ?? [];
  const lines = data?.lines ?? [];
  const journalEntries = data?.journalEntries ?? [];
  const glAccounts = data?.accounts ?? [];
  const summary = data?.summary ?? {
    totalStatements: 0,
    totalLines: 0,
    matchedCount: 0,
    unmatchedCount: 0,
    ignoredCount: 0,
    totalInflows: 0,
    totalOutflows: 0,
    statementNetFlow: 0,
    matchedNet: 0,
    unmatchedVolume: 0,
    openingBalance: 0,
    closingBalance: 0,
    computedEndingBalance: 0,
    reconciledEndingBalance: 0,
    reconciliationGap: 0,
  };

  const currency = activeStatement?.currency || 'USD';

  const selectedLine = useMemo(() => {
    if (!lines.length) return null;
    if (activeLineId !== null) {
      const found = lines.find((l) => l.id === activeLineId);
      if (found) return found;
    }
    return lines.find((l) => l.match_status === 'unmatched') ?? null;
  }, [lines, activeLineId]);

  const candidateJournals = useMemo(() => {
    const q = journalSearch.trim().toLowerCase();
    const base = journalEntries.filter((je) => {
      if (!q) return true;
      return (
        je.ref.toLowerCase().includes(q) ||
        je.description.toLowerCase().includes(q) ||
        je.journal_code.toLowerCase().includes(q) ||
        je.source_ref.toLowerCase().includes(q) ||
        je.debit_account_code.toLowerCase().includes(q) ||
        je.credit_account_code.toLowerCase().includes(q)
      );
    });

    if (!selectedLine) return base;

    return [...base]
      .map((je) => {
        const amtDiff = Math.abs(Number(je.amount) - Number(selectedLine.amount));
        const exactAmount = amtDiff < 0.01;
        const dDiff = dayDiffBetween(selectedLine.tx_date, je.entry_date);
        const refMatch =
          Boolean(selectedLine.reference && je.source_ref && selectedLine.reference.toLowerCase() === je.source_ref.toLowerCase()) ||
          Boolean(je.source_ref && selectedLine.description.toLowerCase().includes(je.source_ref.toLowerCase())) ||
          Boolean(selectedLine.reference && je.description.toLowerCase().includes(selectedLine.reference.toLowerCase()));
        let score = 0;
        if (!je.is_matched) score += 100;
        if (exactAmount) score += 60;
        else if (amtDiff <= 5) score += 20;
        if (refMatch) score += 35;
        if (dDiff <= 3) score += 20;
        else if (dDiff <= 10) score += 10;
        return { je, score, exactAmount, amtDiff, dDiff, refMatch };
      })
      .sort((a, b) => b.score - a.score || a.amtDiff - b.amtDiff || a.dDiff - b.dDiff)
      .map((item) => item.je);
  }, [journalEntries, journalSearch, selectedLine]);

  const csvPreview = useMemo(() => parseClientCsvPreview(csvText), [csvText]);

  const manualComputedNet = useMemo(() => {
    return manualRows.reduce((acc, r) => {
      const amt = Number(r.amount) || 0;
      if (amt <= 0) return acc;
      return acc + (r.direction === 'credit' ? amt : -amt);
    }, 0);
  }, [manualRows]);

  function openNewStatementModal(defaultMode: 'csv' | 'manual' = 'csv') {
    const defaultBank =
      bankAccountFilter !== 'all'
        ? bankAccounts.find((b) => String(b.id) === bankAccountFilter) ?? bankAccounts[0]
        : bankAccounts[0];
    setEntryMode(defaultMode);
    setStmtBankId(defaultBank ? String(defaultBank.id) : '');
    setStmtName(`${new Date().toISOString().slice(0, 7)} Bank Statement`);
    setStmtDate(new Date().toISOString().slice(0, 10));
    setStmtOpeningBal(defaultBank ? String(defaultBank.balance) : '0');
    setStmtClosingBal('');
    setStmtNotes('');
    setCsvText('');
    setManualRows([
      {
        txDate: new Date().toISOString().slice(0, 10),
        description: '',
        reference: '',
        direction: 'debit',
        amount: '',
      },
    ]);
    setStatementModal(true);
  }

  function handleCsvFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512_000) {
      onNotify('CSV file exceeds 512 KB limit.', 'error');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setCsvText(text);
      if (!stmtName.trim()) {
        setStmtName(file.name.replace(/\.[^.]+$/, ''));
      }
    };
    reader.onerror = () => {
      onNotify('Unable to read selected CSV file.', 'error');
    };
    reader.readAsText(file);
  }

  function handleDownloadSampleCsv() {
    const sample = [
      'Date,Description,Reference,Direction,Amount,Running Balance',
      '2026-11-12,CUSTOMER INVOICE IN2611-0001 SETTLEMENT,IN2611-0001,credit,7364.00,150093.00',
      '2026-11-14,SUPPLIER BILL SI2611-0001 INVENTORY,SI2611-0001,debit,7040.00,143053.00',
      '2026-11-25,BANK MONTHLY MAINTENANCE FEE,FEE-NOV26,debit,35.00,143018.00',
    ].join('\n');
    downloadCsvBlob('sample-bank-statement.csv', sample);
  }

  async function handleSaveStatement(e: FormEvent) {
    e.preventDefault();
    if (!stmtBankId) {
      onNotify('Select a bank account first.', 'error');
      return;
    }
    setSavingStatement(true);
    try {
      const payload =
        entryMode === 'csv'
          ? {
              bankAccountId: Number(stmtBankId),
              statementName: stmtName,
              statementDate: stmtDate,
              openingBalance: Number(stmtOpeningBal) || 0,
              closingBalance: stmtClosingBal.trim() !== '' ? Number(stmtClosingBal) : undefined,
              sourceType: 'csv',
              csvText,
              notes: stmtNotes,
            }
          : {
              bankAccountId: Number(stmtBankId),
              statementName: stmtName,
              statementDate: stmtDate,
              openingBalance: Number(stmtOpeningBal) || 0,
              closingBalance: stmtClosingBal.trim() !== '' ? Number(stmtClosingBal) : undefined,
              sourceType: 'manual',
              lines: manualRows.map((r) => ({
                txDate: r.txDate,
                description: r.description,
                reference: r.reference,
                direction: r.direction,
                amount: Number(r.amount),
              })),
              notes: stmtNotes,
            };

      const created = await apiRequest<{ id: number; ref: string }>('/api/bank-reconciliation/statements', {
        method: 'POST',
        body: payload,
      });
      onNotify(`Bank statement ${created.ref} imported and ready for reconciliation.`);
      setStatementModal(false);
      setSelectedStatementId(String(created.id));
      await fetchReconciliation();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save bank statement.', 'error');
    } finally {
      setSavingStatement(false);
    }
  }

  async function handleAddSingleLine(e: FormEvent) {
    e.preventDefault();
    if (!activeStatement) return;
    setSavingLine(true);
    try {
      await apiRequest(`/api/bank-reconciliation/statements/${activeStatement.id}/lines`, {
        method: 'POST',
        body: {
          txDate: newLineDate,
          description: newLineDesc,
          reference: newLineRef,
          direction: newLineDir,
          amount: Number(newLineAmt),
        },
      });
      onNotify(`Added statement line to ${activeStatement.ref}.`);
      setAddLineModal(false);
      setNewLineDesc('');
      setNewLineRef('');
      setNewLineAmt('');
      await fetchReconciliation();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to add statement line.', 'error');
    } finally {
      setSavingLine(false);
    }
  }

  async function handleMatchToJournal(line: BankStatementLineItem, je: ReconcilableJournalEntry) {
    setBusyActionId(`match-${line.id}-${je.id}`);
    try {
      await apiRequest(`/api/bank-reconciliation/lines/${line.id}/match`, {
        method: 'POST',
        body: {
          journalEntryId: je.id,
          note:
            Math.abs(line.amount - je.amount) < 0.01
              ? 'Matched exact amount'
              : `Matched with ${formatMoneyWithCode(line.amount - je.amount, currency)} difference`,
        },
      });
      onNotify(`Matched statement line to journal ${je.ref}.`);
      setActiveLineId(null);
      await fetchReconciliation();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to match statement line.', 'error');
    } finally {
      setBusyActionId('');
    }
  }

  async function handleUnmatch(line: BankStatementLineItem) {
    setBusyActionId(`unmatch-${line.id}`);
    try {
      await apiRequest(`/api/bank-reconciliation/lines/${line.id}/unmatch`, { method: 'POST', body: {} });
      onNotify(`Unmatched statement line from ${line.matched_journal_ref || 'journal entry'}.`);
      await fetchReconciliation();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to unmatch line.', 'error');
    } finally {
      setBusyActionId('');
    }
  }

  async function handleToggleIgnore(line: BankStatementLineItem, ignored: boolean) {
    setBusyActionId(`ignore-${line.id}`);
    try {
      await apiRequest(`/api/bank-reconciliation/lines/${line.id}/ignore`, {
        method: 'POST',
        body: { ignored },
      });
      onNotify(ignored ? 'Statement line marked ignored.' : 'Statement line restored to unmatched.');
      await fetchReconciliation();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update line status.', 'error');
    } finally {
      setBusyActionId('');
    }
  }

  async function handleAutoMatch() {
    if (!activeStatement) return;
    setAutoMatching(true);
    try {
      const res = await apiRequest<{ matchedCount: number }>(`/api/bank-reconciliation/statements/${activeStatement.id}/auto-match`, {
        method: 'POST',
        body: {},
      });
      if (res.matchedCount > 0) {
        onNotify(`Auto-matched ${res.matchedCount} statement line(s) against journal entries.`);
      } else {
        onNotify('No unambiguous automatic matches found for remaining lines.');
      }
      await fetchReconciliation();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Auto-match failed.', 'error');
    } finally {
      setAutoMatching(false);
    }
  }

  function openPostJournalModal(line: BankStatementLineItem) {
    setPostLineTarget(line);
    setCashAccountCode(glAccounts.find((a) => a.code === '1010')?.code || glAccounts.find((a) => a.account_class === 'asset')?.code || '1010');
    const defaultOffset =
      line.direction === 'debit'
        ? glAccounts.find((a) => a.code === '6100')?.code || glAccounts.find((a) => a.account_class === 'expense')?.code || '6100'
        : glAccounts.find((a) => a.code === '4100')?.code || glAccounts.find((a) => a.account_class === 'revenue')?.code || '4000';
    setCounterAccountCode(defaultOffset);
    setPostJournalCode('BNK');
    setPostDescription(line.description);
  }

  async function handleCreateJournalAndMatch(e: FormEvent) {
    e.preventDefault();
    if (!postLineTarget) return;
    setPostingJournal(true);
    try {
      const res = await apiRequest<{ journalEntry: { ref: string } }>(
        `/api/bank-reconciliation/lines/${postLineTarget.id}/create-journal`,
        {
          method: 'POST',
          body: {
            cashAccountCode,
            counterAccountCode,
            journalCode: postJournalCode,
            description: postDescription,
          },
        }
      );
      onNotify(`Posted journal ${res.journalEntry.ref} and matched statement line.`);
      setPostLineTarget(null);
      await Promise.all([fetchReconciliation(), onReload()]);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to post balancing journal entry.', 'error');
    } finally {
      setPostingJournal(false);
    }
  }

  async function handleExportCsv() {
    if (!activeStatement) return;
    setExporting(true);
    try {
      const res = await apiRequest<{ count: number; filename: string; csv: string }>(
        `/api/bank-reconciliation/statements/${activeStatement.id}/export`
      );
      downloadCsvBlob(res.filename, res.csv);
      onNotify(`Exported ${res.count} reconciled statement line(s).`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Statement export failed.', 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* 4-Column Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Statement Closing Balance
          </div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatMoneyWithCode(summary.closingBalance, currency)}
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
            Opening {formatMoneyWithCode(summary.openingBalance, currency)}
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Matched Lines &amp; Net Flow
          </div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
            {summary.matchedCount} / {summary.totalLines}
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
            Matched net {formatMoneyWithCode(summary.matchedNet, currency)}
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Unmatched Statement Items
          </div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-amber-700 dark:text-amber-400">
            {summary.unmatchedCount} · {formatMoneyWithCode(summary.unmatchedVolume, currency)}
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Select a row to pair with a journal entry
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Reconciliation Variance
          </div>
          <div
            className={`mt-1.5 text-2xl font-semibold font-mono tabular-nums ${
              Math.abs(summary.reconciliationGap) < 0.01 && activeStatement
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-zinc-900 dark:text-zinc-100'
            }`}
          >
            {formatMoneyWithCode(summary.reconciliationGap, currency)}
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {!activeStatement
              ? 'No active statement selected'
              : Math.abs(summary.reconciliationGap) < 0.01
                ? 'Statement closing balance reconciled'
                : 'Remaining unmatched difference'}
          </div>
        </div>
      </div>

      {/* Statement Controls & Actions Bar */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <div>
              <label htmlFor="recon-bank-filter" className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                Bank Account
              </label>
              <select
                id="recon-bank-filter"
                value={bankAccountFilter}
                onChange={(e) => {
                  setBankAccountFilter(e.target.value);
                  setSelectedStatementId('');
                  setActiveLineId(null);
                }}
                className="h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100"
              >
                <option value="all">All Bank Accounts</option>
                {bankAccounts.map((ba) => (
                  <option key={ba.id} value={String(ba.id)}>
                    {ba.ref} — {ba.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-[260px]">
              <label htmlFor="recon-statement-select" className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                Active Bank Statement
              </label>
              <select
                id="recon-statement-select"
                value={activeStatement ? String(activeStatement.id) : ''}
                onChange={(e) => {
                  setSelectedStatementId(e.target.value);
                  setActiveLineId(null);
                }}
                disabled={statements.length === 0}
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100 disabled:opacity-60"
              >
                {statements.length === 0 ? (
                  <option value="">No statements uploaded yet</option>
                ) : (
                  statements.map((st) => (
                    <option key={st.id} value={String(st.id)}>
                      {st.ref} · {st.statement_name} ({st.matched_count}/{st.line_count} matched)
                    </option>
                  ))
                )}
              </select>
            </div>

            {activeStatement && (
              <div className="pt-4 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <StatusText status={activeStatement.status} />
                <span aria-hidden="true">·</span>
                <span className="font-mono">{activeStatement.account_ref}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {formatDate(activeStatement.period_start)} – {formatDate(activeStatement.period_end)}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={fetchReconciliation}
              disabled={loading}
              className="h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>

            {activeStatement && canRecordPay && (
              <button
                type="button"
                onClick={handleAutoMatch}
                disabled={autoMatching || summary.unmatchedCount === 0}
                className="h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5 shrink-0 text-orange-700 dark:text-orange-400" />
                <span>{autoMatching ? 'Matching...' : 'Auto-Match'}</span>
              </button>
            )}

            {activeStatement && canWrite && (
              <button
                type="button"
                onClick={() => {
                  setNewLineDate(activeStatement.period_end || new Date().toISOString().slice(0, 10));
                  setNewLineDesc('');
                  setNewLineRef('');
                  setNewLineDir('debit');
                  setNewLineAmt('');
                  setAddLineModal(true);
                }}
                className="h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>Add Line</span>
              </button>
            )}

            {activeStatement && (
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={exporting || summary.totalLines === 0}
                className="h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>{exporting ? 'Exporting...' : 'Export CSV'}</span>
              </button>
            )}

            {activeStatement && canDelete && (
              <button
                type="button"
                onClick={() =>
                  onPromptDelete(
                    `/api/bank-reconciliation/statements/${activeStatement.id}`,
                    'Delete Bank Statement',
                    `${activeStatement.ref} — ${activeStatement.statement_name}`,
                    'All statement lines and reconciliation links for this statement will be removed. Posted journal entries remain intact.'
                  )
                }
                aria-label={`Delete statement ${activeStatement.ref}`}
                className="h-9 px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-red-600 hover:border-red-300 dark:hover:border-red-800 inline-flex items-center whitespace-nowrap shrink-0"
                title="Delete active statement"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}

            {canWrite && (
              <button
                type="button"
                onClick={() => openNewStatementModal('csv')}
                className="h-9 px-3.5 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5 shrink-0" />
                <span>Upload / New Statement</span>
              </button>
            )}
          </div>
        </div>

        {activeStatement && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
            <div className="inline-flex items-center p-1 rounded-lg bg-zinc-100 dark:bg-zinc-800/80">
              {(
                [
                  ['all', `All Lines (${summary.totalLines})`],
                  ['unmatched', `Unmatched (${summary.unmatchedCount})`],
                  ['matched', `Matched (${summary.matchedCount})`],
                  ['ignored', `Ignored (${summary.ignoredCount})`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMatchStatus(key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    matchStatus === key
                      ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search description, ref, journal..."
                className="w-full h-9 pl-8 pr-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100"
              />
            </div>
          </div>
        )}
      </div>

      {/* Main Content States */}
      {loadError ? (
        <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-white dark:bg-zinc-900 p-6 text-center space-y-3">
          <p className="text-sm text-red-700 dark:text-red-400">{loadError}</p>
          <button
            type="button"
            onClick={fetchReconciliation}
            className="h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
          >
            Retry Loading
          </button>
        </div>
      ) : loading && !data ? (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          <div className="xl:col-span-7 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-3">
            {[1, 2, 3, 4].map((row) => (
              <div key={row} className="h-11 rounded-lg bg-zinc-100 dark:bg-zinc-800/70 animate-pulse" />
            ))}
          </div>
          <div className="xl:col-span-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-3">
            {[1, 2, 3, 4].map((row) => (
              <div key={row} className="h-11 rounded-lg bg-zinc-100 dark:bg-zinc-800/70 animate-pulse" />
            ))}
          </div>
        </div>
      ) : !activeStatement ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-10 text-center space-y-3">
          <FileSpreadsheet className="w-8 h-8 text-zinc-400 mx-auto" />
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              No Bank Statements Found
            </h3>
            <p className="text-xs text-zinc-500 max-w-md mx-auto">
              Upload a bank statement CSV file or enter statement lines manually to start matching bank activity against posted journal entries.
            </p>
          </div>
          {canWrite && (
            <div className="flex items-center justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => openNewStatementModal('csv')}
                className="h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Upload CSV Statement</span>
              </button>
              <button
                type="button"
                onClick={() => openNewStatementModal('manual')}
                className="h-9 px-4 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-1.5"
              >
                <FilePlus2 className="w-3.5 h-3.5" />
                <span>Enter Manually</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* Left 7 Columns: Bank Statement Lines */}
          <div className="xl:col-span-7 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Bank Statement Lines
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {activeStatement.account_name} · Select an unmatched row to pair it with a journal entry
                </p>
              </div>
              <span className="text-xs font-mono tabular-nums text-zinc-500">
                {lines.length} shown
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-2.5 px-3.5 font-medium">Date</th>
                    <th className="py-2.5 px-3.5 font-medium">Description &amp; Ref</th>
                    <th className="py-2.5 px-3.5 font-medium text-right">Amount</th>
                    <th className="py-2.5 px-3.5 font-medium">Status &amp; Match</th>
                    <th className="py-2.5 px-3.5 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {lines.map((line) => {
                    const isSelected = selectedLine?.id === line.id;
                    return (
                      <tr
                        key={line.id}
                        onClick={() => {
                          if (line.match_status === 'unmatched') setActiveLineId(line.id);
                        }}
                        className={`transition-colors ${
                          line.match_status === 'unmatched' ? 'cursor-pointer' : ''
                        } ${
                          isSelected
                            ? 'bg-orange-50/70 dark:bg-orange-950/20'
                            : 'hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40'
                        }`}
                      >
                        <td className="py-2.5 px-3.5 font-mono tabular-nums text-zinc-500 whitespace-nowrap">
                          {formatDate(line.tx_date)}
                        </td>
                        <td className="py-2.5 px-3.5 min-w-[190px]">
                          <div className="font-medium text-zinc-900 dark:text-zinc-100">
                            {line.description}
                          </div>
                          <div className="text-[11px] text-zinc-500 font-mono">
                            {line.reference ? line.reference : 'No bank ref'}
                            {line.running_balance !== null && line.running_balance !== undefined
                              ? ` · Bal ${formatMoneyWithCode(line.running_balance, currency)}`
                              : ''}
                          </div>
                        </td>
                        <td
                          className={`py-2.5 px-3.5 font-mono tabular-nums text-right font-semibold whitespace-nowrap ${
                            line.direction === 'credit'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-red-700 dark:text-red-400'
                          }`}
                        >
                          {line.direction === 'credit' ? '+' : '-'}
                          {formatMoneyWithCode(line.amount, currency)}
                        </td>
                        <td className="py-2.5 px-3.5">
                          <StatusText status={line.match_status} />
                          {line.match_status === 'matched' && line.matched_journal_ref && (
                            <div className="mt-0.5 text-[11px] font-mono text-zinc-600 dark:text-zinc-300">
                              {line.matched_journal_ref}
                              {line.debit_account_code && line.credit_account_code
                                ? ` · ${line.debit_account_code}/${line.credit_account_code}`
                                : ''}
                            </div>
                          )}
                        </td>
                        <td
                          className="py-2.5 px-3.5 text-right whitespace-nowrap space-x-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {line.match_status === 'unmatched' && (
                            <>
                              <button
                                type="button"
                                onClick={() => setActiveLineId(line.id)}
                                className={`text-xs font-medium whitespace-nowrap ${
                                  isSelected
                                    ? 'text-orange-700 dark:text-orange-400 underline'
                                    : 'text-orange-700 dark:text-orange-400 hover:underline'
                                }`}
                              >
                                {isSelected ? 'Matching' : 'Match'}
                              </button>
                              {canWrite && (
                                <button
                                  type="button"
                                  onClick={() => openPostJournalModal(line)}
                                  className="text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white whitespace-nowrap"
                                  title="Post a balancing journal entry for this bank line"
                                >
                                  Post GL
                                </button>
                              )}
                              {canRecordPay && (
                                <button
                                  type="button"
                                  disabled={busyActionId === `ignore-${line.id}`}
                                  onClick={() => handleToggleIgnore(line, true)}
                                  className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 whitespace-nowrap"
                                >
                                  Ignore
                                </button>
                              )}
                            </>
                          )}
                          {line.match_status === 'matched' && canRecordPay && (
                            <button
                              type="button"
                              disabled={busyActionId === `unmatch-${line.id}`}
                              onClick={() => handleUnmatch(line)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:text-red-600 whitespace-nowrap"
                            >
                              <Link2Off className="w-3 h-3" />
                              <span>Unmatch</span>
                            </button>
                          )}
                          {line.match_status === 'ignored' && canRecordPay && (
                            <button
                              type="button"
                              disabled={busyActionId === `ignore-${line.id}`}
                              onClick={() => handleToggleIgnore(line, false)}
                              className="text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline whitespace-nowrap"
                            >
                              Restore
                            </button>
                          )}
                          {line.match_status !== 'matched' && canDelete && (
                            <button
                              type="button"
                              onClick={() =>
                                onPromptDelete(
                                  `/api/bank-reconciliation/lines/${line.id}`,
                                  'Delete Statement Line',
                                  line.description
                                )
                              }
                              aria-label={`Delete statement line ${line.id}`}
                              className="text-zinc-400 hover:text-red-600 inline-flex items-center align-middle"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-zinc-500">
                        No statement lines match the active filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right 5 Columns: Existing Journal Entries Match Queue */}
          <div className="xl:col-span-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Journal Entries Match Queue
                  </h3>
                  {selectedLine ? (
                    <p className="text-xs text-orange-700 dark:text-orange-400 mt-0.5">
                      Matching line: <span className="font-medium">{selectedLine.description}</span> ·{' '}
                      <span className="font-mono tabular-nums font-semibold">
                        {selectedLine.direction === 'credit' ? '+' : '-'}
                        {formatMoneyWithCode(selectedLine.amount, currency)}
                      </span>
                    </p>
                  ) : (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                      All unmatched statement rows cleared, or select an unmatched row on the left.
                    </p>
                  )}
                </div>
                <div className="inline-flex items-center p-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 shrink-0">
                  <button
                    type="button"
                    onClick={() => setJournalScope('unmatched')}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md whitespace-nowrap ${
                      journalScope === 'unmatched'
                        ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                        : 'text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    Unmatched
                  </button>
                  <button
                    type="button"
                    onClick={() => setJournalScope('all')}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md whitespace-nowrap ${
                      journalScope === 'all'
                        ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                        : 'text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    All
                  </button>
                </div>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={journalSearch}
                  onChange={(e) => setJournalSearch(e.target.value)}
                  placeholder="Filter journal ref, description, source, GL code..."
                  className="w-full h-8 pl-8 pr-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100"
                />
              </div>
            </div>

            <div className="divide-y divide-zinc-100 dark:divide-zinc-800 max-h-[540px] overflow-y-auto">
              {candidateJournals.map((je) => {
                const exactAmt = selectedLine ? Math.abs(Number(je.amount) - Number(selectedLine.amount)) < 0.01 : false;
                const dDiff = selectedLine ? dayDiffBetween(selectedLine.tx_date, je.entry_date) : null;
                const canLinkNow = Boolean(selectedLine && !je.is_matched && canRecordPay);
                const busy = selectedLine ? busyActionId === `match-${selectedLine.id}-${je.id}` : false;

                return (
                  <div
                    key={je.id}
                    className="px-4 py-3 flex items-start justify-between gap-3 hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="font-mono font-semibold text-orange-700 dark:text-orange-400">{je.ref}</span>
                        <span aria-hidden="true" className="text-zinc-400">·</span>
                        <span className="font-mono text-zinc-500">{formatDate(je.entry_date)}</span>
                        <span aria-hidden="true" className="text-zinc-400">·</span>
                        <span className="font-mono text-zinc-500">{je.journal_code}</span>
                        {exactAmt && !je.is_matched && selectedLine && (
                          <>
                            <span aria-hidden="true" className="text-zinc-400">·</span>
                            <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                              Exact amount{dDiff !== null && dDiff <= 14 ? ` (${dDiff}d diff)` : ''}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {je.description}
                      </div>
                      <div className="text-[11px] font-mono text-zinc-500">
                        DR {je.debit_account_code} / CR {je.credit_account_code}
                        {je.source_ref ? ` · ${je.source_ref}` : ''}
                      </div>
                    </div>

                    <div className="shrink-0 text-right space-y-1.5">
                      <div className="text-xs font-mono tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                        {formatMoneyWithCode(je.amount, currency)}
                      </div>
                      {je.is_matched ? (
                        <div className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Linked ({je.matched_statement_ref})</span>
                        </div>
                      ) : canLinkNow && selectedLine ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleMatchToJournal(selectedLine, je)}
                          className={`h-7 px-2.5 rounded-md text-[11px] font-medium inline-flex items-center gap-1 whitespace-nowrap transition-colors ${
                            exactAmt
                              ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                              : 'border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                          }`}
                        >
                          <Link2 className="w-3 h-3" />
                          <span>{busy ? 'Linking...' : 'Match'}</span>
                        </button>
                      ) : (
                        <span className="text-[11px] text-zinc-400">Available</span>
                      )}
                    </div>
                  </div>
                );
              })}

              {candidateJournals.length === 0 && (
                <div className="py-8 px-4 text-center text-xs text-zinc-500">
                  No journal entries match the current filter. Switch to <strong>All</strong> or post a balancing GL entry from a bank line.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Upload CSV / Manual Bank Statement Modal */}
      <Modal
        open={statementModal}
        onClose={() => setStatementModal(false)}
        title="Upload or Enter Bank Statement"
        maxWidthClass="max-w-3xl"
      >
        <form onSubmit={handleSaveStatement} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex p-1 rounded-lg bg-zinc-100 dark:bg-zinc-800">
              <button
                type="button"
                onClick={() => setEntryMode('csv')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap ${
                  entryMode === 'csv'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Upload / Paste CSV</span>
              </button>
              <button
                type="button"
                onClick={() => setEntryMode('manual')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap ${
                  entryMode === 'manual'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <FilePlus2 className="w-3.5 h-3.5" />
                <span>Manual Statement Entry</span>
              </button>
            </div>

            {entryMode === 'csv' && (
              <button
                type="button"
                onClick={handleDownloadSampleCsv}
                className="text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline inline-flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Sample CSV</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Bank Account
              </label>
              <select
                value={stmtBankId}
                onChange={(e) => setStmtBankId(e.target.value)}
                required
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              >
                {bankAccounts.map((ba) => (
                  <option key={ba.id} value={String(ba.id)}>
                    {ba.ref} — {ba.name} ({ba.currency})
                  </option>
                ))}
              </select>
            </div>
            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Statement Name
              </label>
              <input
                type="text"
                value={stmtName}
                onChange={(e) => setStmtName(e.target.value)}
                required
                placeholder="e.g. November 2026 Checking Statement"
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Statement Date
              </label>
              <input
                type="date"
                value={stmtDate}
                onChange={(e) => setStmtDate(e.target.value)}
                required
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Opening Balance
              </label>
              <input
                type="number"
                step="0.01"
                value={stmtOpeningBal}
                onChange={(e) => setStmtOpeningBal(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Closing Balance (optional)
              </label>
              <input
                type="number"
                step="0.01"
                value={stmtClosingBal}
                onChange={(e) => setStmtClosingBal(e.target.value)}
                placeholder="Auto-computed if blank"
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Notes
              </label>
              <input
                type="text"
                value={stmtNotes}
                onChange={(e) => setStmtNotes(e.target.value)}
                placeholder="Optional memo"
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              />
            </div>
          </div>

          {entryMode === 'csv' ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Choose CSV File or Paste CSV Rows (Columns: Date, Description, Reference, Debit/Credit or Amount)
                </label>
                <input
                  type="file"
                  accept=".csv,.txt,text/csv"
                  onChange={handleCsvFileUpload}
                  className="text-xs text-zinc-600 dark:text-zinc-300 file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border file:border-zinc-300 dark:file:border-zinc-700 file:text-xs file:font-medium file:bg-zinc-50 dark:file:bg-zinc-800"
                />
              </div>
              <textarea
                rows={5}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={`Date,Description,Reference,Direction,Amount\n2026-11-12,CUSTOMER SETTLEMENT,IN2611-0001,credit,7364.00\n2026-11-14,BANK WIRE FEE,FEE-01,debit,35.00`}
                className="w-full p-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono"
              />
              {csvPreview.error && csvText.trim() && (
                <p className="text-xs text-red-600 dark:text-red-400">{csvPreview.error}</p>
              )}
              {csvPreview.rows.length > 0 && (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                  <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-950 text-[11px] font-medium text-zinc-600 dark:text-zinc-400 flex items-center justify-between">
                    <span>Parsed Preview ({csvPreview.rows.length} rows)</span>
                    <span className="font-mono tabular-nums">
                      Net Flow:{' '}
                      {formatMoneyWithCode(
                        csvPreview.rows.reduce((s, r) => s + (r.direction === 'credit' ? r.amount : -r.amount), 0),
                        currency
                      )}
                    </span>
                  </div>
                  <div className="max-h-40 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
                    {csvPreview.rows.slice(0, 8).map((r, idx) => (
                      <div key={idx} className="px-3 py-1.5 text-xs flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-zinc-500 shrink-0">{r.txDate}</span>
                          <span className="truncate text-zinc-900 dark:text-zinc-100">{r.description}</span>
                          {r.reference && <span className="font-mono text-[11px] text-zinc-400 shrink-0">{r.reference}</span>}
                        </div>
                        <span
                          className={`font-mono tabular-nums font-medium shrink-0 ${
                            r.direction === 'credit' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                          }`}
                        >
                          {r.direction === 'credit' ? '+' : '-'}
                          {r.amount.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Statement Transaction Lines (Net:{' '}
                  <span className="font-mono tabular-nums">{formatMoneyWithCode(manualComputedNet, currency)}</span>)
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setManualRows((rows) => [
                      ...rows,
                      {
                        txDate: stmtDate || new Date().toISOString().slice(0, 10),
                        description: '',
                        reference: '',
                        direction: 'debit',
                        amount: '',
                      },
                    ])
                  }
                  className="text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline inline-flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Row</span>
                </button>
              </div>
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {manualRows.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <input
                      type="date"
                      value={row.txDate}
                      onChange={(e) =>
                        setManualRows((prev) => prev.map((r, i) => (i === idx ? { ...r, txDate: e.target.value } : r)))
                      }
                      required
                      aria-label={`Line ${idx + 1} date`}
                      className="col-span-3 h-8 px-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
                    />
                    <input
                      type="text"
                      value={row.description}
                      onChange={(e) =>
                        setManualRows((prev) => prev.map((r, i) => (i === idx ? { ...r, description: e.target.value } : r)))
                      }
                      required
                      placeholder="Bank description"
                      aria-label={`Line ${idx + 1} description`}
                      className="col-span-3 h-8 px-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
                    />
                    <input
                      type="text"
                      value={row.reference}
                      onChange={(e) =>
                        setManualRows((prev) => prev.map((r, i) => (i === idx ? { ...r, reference: e.target.value } : r)))
                      }
                      placeholder="Ref"
                      aria-label={`Line ${idx + 1} reference`}
                      className="col-span-2 h-8 px-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono"
                    />
                    <select
                      value={row.direction}
                      onChange={(e) =>
                        setManualRows((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, direction: e.target.value as 'credit' | 'debit' } : r))
                        )
                      }
                      aria-label={`Line ${idx + 1} direction`}
                      className="col-span-2 h-8 px-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
                    >
                      <option value="debit">Debit (-)</option>
                      <option value="credit">Credit (+)</option>
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={row.amount}
                      onChange={(e) =>
                        setManualRows((prev) => prev.map((r, i) => (i === idx ? { ...r, amount: e.target.value } : r)))
                      }
                      required
                      placeholder="0.00"
                      aria-label={`Line ${idx + 1} amount`}
                      className="col-span-1 h-8 px-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono"
                    />
                    <button
                      type="button"
                      disabled={manualRows.length <= 1}
                      onClick={() => setManualRows((prev) => prev.filter((_, i) => i !== idx))}
                      className="col-span-1 text-zinc-400 hover:text-red-600 disabled:opacity-30 flex justify-center"
                      aria-label={`Remove line ${idx + 1}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setStatementModal(false)}
              className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingStatement || (entryMode === 'csv' && csvPreview.rows.length === 0)}
              className="h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 disabled:opacity-50 text-white text-xs font-medium"
            >
              {savingStatement ? 'Importing...' : 'Save Bank Statement'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Manual Line to Existing Statement Modal */}
      <Modal
        open={addLineModal}
        onClose={() => setAddLineModal(false)}
        title={`Add Statement Line — ${activeStatement?.ref || ''}`}
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleAddSingleLine} className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Transaction Date
              </label>
              <input
                type="date"
                value={newLineDate}
                onChange={(e) => setNewLineDate(e.target.value)}
                required
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Direction
              </label>
              <select
                value={newLineDir}
                onChange={(e) => setNewLineDir(e.target.value as 'credit' | 'debit')}
                className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
              >
                <option value="debit">Debit (Outflow)</option>
                <option value="credit">Credit (Inflow)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
              Bank Description
            </label>
            <input
              type="text"
              value={newLineDesc}
              onChange={(e) => setNewLineDesc(e.target.value)}
              required
              placeholder="e.g. ACH WIRE TRANSFER FEE"
              className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Reference
              </label>
              <input
                type="text"
                value={newLineRef}
                onChange={(e) => setNewLineRef(e.target.value)}
                placeholder="Optional check/wire ref"
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                Amount
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={newLineAmt}
                onChange={(e) => setNewLineAmt(e.target.value)}
                required
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setAddLineModal(false)}
              className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingLine}
              className="h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 disabled:opacity-50 text-white text-xs font-medium"
            >
              {savingLine ? 'Adding...' : 'Add Statement Line'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Post Balancing Journal Entry & Match Modal */}
      <Modal
        open={Boolean(postLineTarget)}
        onClose={() => setPostLineTarget(null)}
        title="Post & Match Journal Entry"
        maxWidthClass="max-w-md"
      >
        {postLineTarget && (
          <form onSubmit={handleCreateJournalAndMatch} className="space-y-3.5">
            <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-mono text-zinc-500">{formatDate(postLineTarget.tx_date)}</span>
                <span
                  className={`font-mono tabular-nums font-semibold ${
                    postLineTarget.direction === 'credit'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-red-700 dark:text-red-400'
                  }`}
                >
                  {postLineTarget.direction === 'credit' ? '+' : '-'}
                  {formatMoneyWithCode(postLineTarget.amount, currency)}
                </span>
              </div>
              <div className="font-medium text-zinc-900 dark:text-zinc-100">{postLineTarget.description}</div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                  Bank / Cash GL Account ({postLineTarget.direction === 'credit' ? 'DR' : 'CR'})
                </label>
                <select
                  value={cashAccountCode}
                  onChange={(e) => setCashAccountCode(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
                >
                  {glAccounts.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} · {a.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                  Offset GL Account ({postLineTarget.direction === 'credit' ? 'CR' : 'DR'})
                </label>
                <select
                  value={counterAccountCode}
                  onChange={(e) => setCounterAccountCode(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
                >
                  {glAccounts.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} · {a.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                  Journal Code
                </label>
                <input
                  type="text"
                  value={postJournalCode}
                  onChange={(e) => setPostJournalCode(e.target.value)}
                  required
                  className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono uppercase"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                  Journal Description
                </label>
                <input
                  type="text"
                  value={postDescription}
                  onChange={(e) => setPostDescription(e.target.value)}
                  required
                  className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPostLineTarget(null)}
                className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={postingJournal}
                className="h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 disabled:opacity-50 text-white text-xs font-medium inline-flex items-center gap-1.5"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                <span>{postingJournal ? 'Posting...' : 'Post GL & Match'}</span>
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

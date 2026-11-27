import { useMemo, useState, type FormEvent } from 'react';
import { CheckSquare, Download, Landmark, Pencil, Plus, Square, Trash2 } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import type { BankAccount, BankTransaction, SepaBatch } from '../../types/erp';
import { Modal } from '../Modal';
import { StatusText } from '../StatusText';
import { downloadCsvBlob } from './financeHelpers';

interface FinanceTreasurySectionProps {
  accounts: BankAccount[];
  transactions: BankTransaction[];
  sepaBatches: SepaBatch[];
  canWrite: boolean;
  canRecordPay: boolean;
  canDelete: boolean;
  onReload: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPromptDelete: (url: string, title: string, itemLabel: string, warning?: string) => void;
}

export function FinanceTreasurySection({
  accounts,
  transactions,
  sepaBatches,
  canWrite,
  canRecordPay,
  canDelete,
  onReload,
  onNotify,
  onPromptDelete,
}: FinanceTreasurySectionProps) {
  const [subTab, setSubTab] = useState<'ledger' | 'sepa'>('ledger');
  const [recFilter, setRecFilter] = useState<'all' | 'reconciled' | 'unreconciled'>('all');
  const [acctFilter, setAcctFilter] = useState('all');

  // Bank Account modal
  const [bankModal, setBankModal] = useState(false);
  const [editingBank, setEditingBank] = useState<BankAccount | null>(null);
  const [bRef, setBRef] = useState('');
  const [bName, setBName] = useState('');
  const [bBank, setBBank] = useState('');
  const [bNumber, setBNumber] = useState('');
  const [bType, setBType] = useState<'checking' | 'savings' | 'cash'>('checking');
  const [bStatus, setBStatus] = useState<'active' | 'closed'>('active');
  const [bBalance, setBBalance] = useState('0');

  // Transaction modal
  const [txModal, setTxModal] = useState(false);
  const [editingTx, setEditingTx] = useState<BankTransaction | null>(null);
  const [txAccountId, setTxAccountId] = useState(accounts[0] ? String(accounts[0].id) : '');
  const [txDate, setTxDate] = useState(new Date().toISOString().slice(0, 10));
  const [txLabel, setTxLabel] = useState('');
  const [txCategory, setTxCategory] = useState('Operations');
  const [txAmount, setTxAmount] = useState('');
  const [txDirection, setTxDirection] = useState<'credit' | 'debit'>('debit');

  // Reconcile modal
  const [recTx, setRecTx] = useState<BankTransaction | null>(null);
  const [stmtRef, setStmtRef] = useState(`STMT-${new Date().toISOString().slice(0, 7)}`);

  // SEPA modal
  const [sepaModal, setSepaModal] = useState(false);
  const [editingSepa, setEditingSepa] = useState<SepaBatch | null>(null);
  const [sepaType, setSepaType] = useState<'credit_transfer' | 'direct_debit'>('credit_transfer');
  const [sepaBankId, setSepaBankId] = useState(accounts[0] ? String(accounts[0].id) : '');
  const [sepaExecDate, setSepaExecDate] = useState(new Date().toISOString().slice(0, 10));
  const [sepaParty, setSepaParty] = useState('');
  const [sepaIban, setSepaIban] = useState('DE89370400440532013000');
  const [sepaAmount, setSepaAmount] = useState('1200');
  const [sepaInvRef, setSepaInvRef] = useState('');
  const [sepaStatus, setSepaStatus] = useState<SepaBatch['status']>('prepared');
  const [xmlPreview, setXmlPreview] = useState<{ ref: string; xml: string } | null>(null);

  const summary = useMemo(() => {
    const bookTotal = accounts.reduce((s, a) => s + a.balance, 0);
    const reconciledNet = transactions
      .filter((t) => Boolean(t.reconciled))
      .reduce((s, t) => s + (t.direction === 'credit' ? t.amount : -t.amount), 0);
    const unreconciledCount = transactions.filter((t) => !t.reconciled).length;
    const unreconciledVolume = transactions
      .filter((t) => !t.reconciled)
      .reduce((s, t) => s + t.amount, 0);
    return { bookTotal, reconciledNet, unreconciledCount, unreconciledVolume };
  }, [accounts, transactions]);

  const filteredTx = useMemo(() => {
    return transactions
      .filter((t) => (acctFilter === 'all' ? true : String(t.bank_account_id) === acctFilter))
      .filter((t) =>
        recFilter === 'all' ? true : recFilter === 'reconciled' ? Boolean(t.reconciled) : !t.reconciled
      );
  }, [transactions, acctFilter, recFilter]);

  function openCreateBank() {
    setEditingBank(null);
    setBRef(`BNK-${accounts.length + 1}`);
    setBName('');
    setBBank('');
    setBNumber('');
    setBType('checking');
    setBStatus('active');
    setBBalance('0');
    setBankModal(true);
  }

  function openEditBank(a: BankAccount) {
    setEditingBank(a);
    setBRef(a.ref);
    setBName(a.name);
    setBBank(a.bank_name);
    setBNumber(a.account_number);
    setBType(a.account_type);
    setBStatus(a.status);
    setBBalance(String(a.balance));
    setBankModal(true);
  }

  async function handleSaveBank(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingBank) {
        await apiRequest(`/api/bank-accounts/${editingBank.id}`, {
          method: 'PUT',
          body: { name: bName, bankName: bBank, accountNumber: bNumber, accountType: bType, status: bStatus },
        });
        onNotify(`Account ${editingBank.ref} updated.`);
      } else {
        await apiRequest('/api/bank-accounts', {
          method: 'POST',
          body: { ref: bRef, name: bName, bankName: bBank, accountNumber: bNumber, accountType: bType, initialBalance: Number(bBalance) || 0 },
        });
        onNotify('Treasury account created.');
      }
      setBankModal(false);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save bank account.', 'error');
    }
  }

  function openCreateTx() {
    setEditingTx(null);
    setTxAccountId(accounts[0] ? String(accounts[0].id) : '');
    setTxDate(new Date().toISOString().slice(0, 10));
    setTxLabel('');
    setTxCategory('Operations');
    setTxAmount('');
    setTxDirection('debit');
    setTxModal(true);
  }

  function openEditTx(t: BankTransaction) {
    setEditingTx(t);
    setTxAccountId(String(t.bank_account_id));
    setTxDate(t.tx_date);
    setTxLabel(t.label);
    setTxCategory(t.category);
    setTxAmount(String(t.amount));
    setTxDirection(t.direction);
    setTxModal(true);
  }

  async function handleSaveTx(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingTx) {
        await apiRequest(`/api/bank-transactions/${editingTx.id}`, {
          method: 'PUT',
          body: { txDate, label: txLabel, category: txCategory, amount: Number(txAmount), direction: txDirection },
        });
        onNotify('Bank transaction updated.');
      } else {
        await apiRequest('/api/bank-transactions', {
          method: 'POST',
          body: { bankAccountId: Number(txAccountId || accounts[0]?.id), txDate, label: txLabel, category: txCategory, amount: Number(txAmount), direction: txDirection },
        });
        onNotify('Bank transaction posted.');
      }
      setTxModal(false);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save transaction.', 'error');
    }
  }

  async function handleReconcileConfirm(e: FormEvent) {
    e.preventDefault();
    if (!recTx) return;
    try {
      await apiRequest(`/api/bank-transactions/${recTx.id}/reconcile`, {
        method: 'POST',
        body: { reconciled: true, statementRef: stmtRef },
      });
      onNotify(`Transaction #${recTx.id} reconciled against ${stmtRef}.`);
      setRecTx(null);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Reconciliation failed.', 'error');
    }
  }

  async function handleUnreconcile(t: BankTransaction) {
    try {
      await apiRequest(`/api/bank-transactions/${t.id}/reconcile`, {
        method: 'POST',
        body: { reconciled: false },
      });
      onNotify(`Transaction #${t.id} marked unreconciled.`);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to update reconciliation.', 'error');
    }
  }

  async function handleExportBankCsv() {
    try {
      const res = await apiRequest<{ filename: string; csv: string }>('/api/bank-transactions/export');
      downloadCsvBlob(res.filename, res.csv);
      onNotify('Bank ledger CSV downloaded.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'CSV export failed.', 'error');
    }
  }

  function openCreateSepa() {
    setEditingSepa(null);
    setSepaType('credit_transfer');
    setSepaBankId(accounts[0] ? String(accounts[0].id) : '');
    setSepaExecDate(new Date().toISOString().slice(0, 10));
    setSepaParty('');
    setSepaIban('DE89370400440532013000');
    setSepaAmount('1200');
    setSepaInvRef('');
    setSepaStatus('prepared');
    setSepaModal(true);
  }

  function openEditSepa(b: SepaBatch) {
    let first = { partyName: '', iban: '', invoiceRef: '', amount: b.total_amount };
    try {
      const parsed = JSON.parse(b.items_json || '[]');
      if (Array.isArray(parsed) && parsed[0]) first = parsed[0];
    } catch {
      // ignore
    }
    setEditingSepa(b);
    setSepaType(b.batch_type);
    setSepaBankId(String(b.bank_account_id));
    setSepaExecDate(b.execution_date);
    setSepaParty(first.partyName);
    setSepaIban(first.iban);
    setSepaAmount(String(first.amount || b.total_amount));
    setSepaInvRef(first.invoiceRef || '');
    setSepaStatus(b.status);
    setSepaModal(true);
  }

  async function handleSaveSepa(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        batchType: sepaType,
        bankAccountId: Number(sepaBankId || accounts[0]?.id),
        executionDate: sepaExecDate,
        partyName: sepaParty,
        iban: sepaIban,
        invoiceRef: sepaInvRef,
        amount: Number(sepaAmount),
        status: sepaStatus,
      };
      if (editingSepa) {
        await apiRequest(`/api/sepa-batches/${editingSepa.id}`, { method: 'PUT', body: payload });
        onNotify(`SEPA batch ${editingSepa.ref} updated.`);
      } else {
        await apiRequest('/api/sepa-batches', { method: 'POST', body: payload });
        onNotify('SEPA ISO 20022 batch prepared.');
      }
      setSepaModal(false);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save SEPA batch.', 'error');
    }
  }

  async function handleViewSepaXml(id: number) {
    try {
      const res = await apiRequest<{ ref: string; xml: string }>(`/api/sepa-batches/${id}/xml`);
      setXmlPreview(res);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to load SEPA XML.', 'error');
    }
  }

  return (
    <div className="space-y-5">
      {/* Sub-navigation & Summary */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-0.5">
          <button
            type="button"
            onClick={() => setSubTab('ledger')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 ${
              subTab === 'ledger'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            Bank Accounts &amp; Reconciliation
          </button>
          <button
            type="button"
            onClick={() => setSubTab('sepa')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 ${
              subTab === 'sepa'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            SEPA ISO 20022 Transfers ({sepaBatches.length})
          </button>
        </div>

        <div className="flex items-center gap-2">
          {subTab === 'ledger' ? (
            <>
              <button
                type="button"
                onClick={handleExportBankCsv}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
              {canWrite && (
                <button
                  type="button"
                  onClick={openCreateBank}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium whitespace-nowrap shrink-0"
                >
                  <Landmark className="w-3.5 h-3.5" />
                  <span>Add Account</span>
                </button>
              )}
              {canRecordPay && (
                <button
                  type="button"
                  onClick={openCreateTx}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Post Transaction</span>
                </button>
              )}
            </>
          ) : (
            canWrite && (
              <button
                type="button"
                onClick={openCreateSepa}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New SEPA Batch</span>
              </button>
            )
          )}
        </div>
      </div>

      {subTab === 'ledger' ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Consolidated Book Cash</div>
              <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                {formatCurrency(summary.bookTotal)}
              </div>
              <div className="text-[11px] text-zinc-500">{accounts.length} treasury accounts</div>
            </div>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="text-[11px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                Cleared Statement Flow
              </div>
              <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                {formatCurrency(summary.reconciledNet)}
              </div>
              <div className="text-[11px] text-zinc-500">Matched to bank statements</div>
            </div>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="text-[11px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
                Pending Reconciliation
              </div>
              <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                {summary.unreconciledCount} entries ({formatCurrency(summary.unreconciledVolume)})
              </div>
              <div className="text-[11px] text-zinc-500">Verify against monthly statement</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {accounts.map((a) => (
              <div key={a.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-mono text-orange-700 dark:text-orange-400">{a.ref} · {a.account_type.toUpperCase()}</div>
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{a.name}</div>
                    <div className="text-xs text-zinc-500">{a.bank_name} · {a.account_number}</div>
                  </div>
                  <StatusText status={a.status} />
                </div>
                <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                  <span className="text-lg font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                    {formatCurrency(a.balance)}
                  </span>
                  <div className="space-x-2">
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => openEditBank(a)}
                        title="Edit bank account"
                        aria-label={`Edit ${a.ref}`}
                        className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() =>
                          onPromptDelete(
                            `/api/bank-accounts/${a.id}`,
                            'Delete Bank Account',
                            `${a.ref} — ${a.name}`,
                            'Accounts with posted transactions or linked SEPA batches cannot be deleted.'
                          )
                        }
                        title="Delete bank account"
                        aria-label={`Delete ${a.ref}`}
                        className="text-zinc-400 hover:text-red-600 inline-flex items-center"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Treasury Ledger &amp; Bank Reconciliation</h3>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={acctFilter}
                  onChange={(e) => setAcctFilter(e.target.value)}
                  aria-label="Filter account"
                  className="h-8 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
                >
                  <option value="all">All Accounts</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={String(a.id)}>
                      {a.ref} — {a.name}
                    </option>
                  ))}
                </select>
                <select
                  value={recFilter}
                  onChange={(e) => setRecFilter(e.target.value as 'all' | 'reconciled' | 'unreconciled')}
                  aria-label="Filter reconciliation status"
                  className="h-8 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
                >
                  <option value="all">All Entries</option>
                  <option value="reconciled">Reconciled Only</option>
                  <option value="unreconciled">Unreconciled Only</option>
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-2.5 px-4 font-medium">Date · Account</th>
                    <th className="py-2.5 px-4 font-medium">Label &amp; Category</th>
                    <th className="py-2.5 px-4 font-medium text-right">Amount</th>
                    <th className="py-2.5 px-4 font-medium">Reconciliation</th>
                    <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {filteredTx.map((t) => (
                    <tr key={t.id}>
                      <td className="py-2.5 px-4 font-mono text-zinc-500">
                        <div>{formatDate(t.tx_date)}</div>
                        <div className="text-[11px] text-orange-700 dark:text-orange-400">{t.account_ref}</div>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">{t.label}</div>
                        <div className="text-[11px] text-zinc-500">
                          {t.category}
                          {t.invoice_ref ? ` · ${t.invoice_ref}` : ''}
                        </div>
                      </td>
                      <td
                        className={`py-2.5 px-4 font-mono tabular-nums text-right font-semibold ${
                          t.direction === 'credit' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                        }`}
                      >
                        {t.direction === 'credit' ? '+' : '-'}
                        {formatCurrency(t.amount)}
                      </td>
                      <td className="py-2.5 px-4">
                        <StatusText status={t.reconciled ? 'reconciled' : 'unreconciled'} />
                        {Boolean(t.reconciled) && t.statement_ref && (
                          <div className="text-[11px] font-mono text-zinc-500">{t.statement_ref}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
                        {canRecordPay && (
                          <button
                            type="button"
                            onClick={() =>
                              t.reconciled
                                ? handleUnreconcile(t)
                                : (() => {
                                    setRecTx(t);
                                    setStmtRef(t.statement_ref || `STMT-${t.tx_date.slice(0, 7)}`);
                                  })()
                            }
                            title={t.reconciled ? 'Mark unreconciled' : 'Match to bank statement'}
                            aria-label={`Reconcile TX-${t.id}`}
                            className="text-emerald-700 dark:text-emerald-400 hover:opacity-80 inline-flex items-center align-middle"
                          >
                            {t.reconciled ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                          </button>
                        )}
                        {canRecordPay && (
                          <button
                            type="button"
                            onClick={() => openEditTx(t)}
                            title="Edit transaction"
                            aria-label={`Edit TX-${t.id}`}
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
                                `/api/bank-transactions/${t.id}`,
                                'Delete Transaction',
                                t.label,
                                'Deleting this transaction automatically reverses its impact on the bank account balance.'
                              )
                            }
                            title="Delete transaction"
                            aria-label={`Delete TX-${t.id}`}
                            className="text-zinc-400 hover:text-red-600 inline-flex items-center align-middle"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredTx.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-zinc-500">
                        No transactions match the selected filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                  <th className="py-3 px-4 font-medium">Batch Ref</th>
                  <th className="py-3 px-4 font-medium">Type · Bank</th>
                  <th className="py-3 px-4 font-medium">Execution Date</th>
                  <th className="py-3 px-4 font-medium text-right">Total</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {sepaBatches.map((b) => (
                  <tr key={b.id}>
                    <td className="py-3 px-4 font-mono font-medium text-orange-700 dark:text-orange-400">{b.ref}</td>
                    <td className="py-3 px-4">
                      <div className="font-medium capitalize text-zinc-900 dark:text-zinc-100">
                        {b.batch_type.replace('_', ' ')}
                      </div>
                      <div className="text-[11px] text-zinc-500">{b.bank_name}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-zinc-500">{formatDate(b.execution_date)}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-right font-semibold">{formatCurrency(b.total_amount)}</td>
                    <td className="py-3 px-4">
                      <StatusText status={b.status} />
                    </td>
                    <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleViewSepaXml(b.id)}
                        className="font-medium text-orange-700 dark:text-orange-400 hover:underline"
                      >
                        ISO XML
                      </button>
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => openEditSepa(b)}
                          title="Edit SEPA batch"
                          aria-label={`Edit ${b.ref}`}
                          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center align-middle"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => onPromptDelete(`/api/sepa-batches/${b.id}`, 'Delete SEPA Batch', b.ref)}
                          title="Delete SEPA batch"
                          aria-label={`Delete ${b.ref}`}
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
      )}

      {/* Modals */}
      <Modal open={Boolean(recTx)} onClose={() => setRecTx(null)} title="Reconcile Bank Entry" maxWidthClass="max-w-sm">
        <form onSubmit={handleReconcileConfirm} className="space-y-4">
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Confirm statement match for <strong>{recTx?.label}</strong> ({formatCurrency(recTx?.amount || 0)}).
          </p>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Bank Statement Reference</label>
            <input
              type="text"
              value={stmtRef}
              onChange={(e) => setStmtRef(e.target.value)}
              required
              className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setRecTx(null)} className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs">
              Cancel
            </button>
            <button type="submit" className="h-9 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium">
              Mark Reconciled
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={bankModal} onClose={() => setBankModal(false)} title={editingBank ? `Edit ${editingBank.ref}` : 'Add Bank / Cash Account'} maxWidthClass="max-w-md">
        <form onSubmit={handleSaveBank} className="space-y-3.5">
          {!editingBank && (
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Account Ref</label>
              <input type="text" value={bRef} onChange={(e) => setBRef(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Account Name</label>
            <input type="text" value={bName} onChange={(e) => setBName(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Bank Institution</label>
              <input type="text" value={bBank} onChange={(e) => setBBank(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Account Number / Mask</label>
              <input type="text" value={bNumber} onChange={(e) => setBNumber(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Type</label>
              <select value={bType} onChange={(e) => setBType(e.target.value as BankAccount['account_type'])} className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs">
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
                <option value="cash">Petty Cash</option>
              </select>
            </div>
            {editingBank ? (
              <div>
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Status</label>
                <select value={bStatus} onChange={(e) => setBStatus(e.target.value as 'active' | 'closed')} className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs">
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Opening Balance</label>
                <input type="number" step="0.01" value={bBalance} onChange={(e) => setBBalance(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setBankModal(false)} className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs">Cancel</button>
            <button type="submit" className="h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">Save Account</button>
          </div>
        </form>
      </Modal>

      <Modal open={txModal} onClose={() => setTxModal(false)} title={editingTx ? `Edit Transaction #${editingTx.id}` : 'Post Bank Transaction'} maxWidthClass="max-w-md">
        <form onSubmit={handleSaveTx} className="space-y-3.5">
          {!editingTx && (
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Bank Account</label>
              <select value={txAccountId} onChange={(e) => setTxAccountId(e.target.value)} className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs">
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.ref} · {a.name}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Date</label>
              <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} required className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Direction</label>
              <select value={txDirection} onChange={(e) => setTxDirection(e.target.value as 'credit' | 'debit')} className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs">
                <option value="debit">Debit (Outflow)</option>
                <option value="credit">Credit (Inflow)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Description</label>
            <input type="text" value={txLabel} onChange={(e) => setTxLabel(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Category</label>
              <input type="text" value={txCategory} onChange={(e) => setTxCategory(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Amount</label>
              <input type="number" step="0.01" min="0.01" value={txAmount} onChange={(e) => setTxAmount(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setTxModal(false)} className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs">Cancel</button>
            <button type="submit" className="h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">Save Entry</button>
          </div>
        </form>
      </Modal>

      <Modal open={sepaModal} onClose={() => setSepaModal(false)} title={editingSepa ? `Edit ${editingSepa.ref}` : 'New SEPA ISO 20022 Batch'} maxWidthClass="max-w-md">
        <form onSubmit={handleSaveSepa} className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Batch Type</label>
              <select value={sepaType} onChange={(e) => setSepaType(e.target.value as 'credit_transfer' | 'direct_debit')} className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs">
                <option value="credit_transfer">Credit Transfer (pain.001)</option>
                <option value="direct_debit">Direct Debit (pain.008)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Execution Date</label>
              <input type="date" value={sepaExecDate} onChange={(e) => setSepaExecDate(e.target.value)} required className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Counterparty Name</label>
            <input type="text" value={sepaParty} onChange={(e) => setSepaParty(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Counterparty IBAN</label>
            <input type="text" value={sepaIban} onChange={(e) => setSepaIban(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Amount</label>
              <input type="number" step="0.01" min="0.01" value={sepaAmount} onChange={(e) => setSepaAmount(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Invoice Reference</label>
              <input type="text" value={sepaInvRef} onChange={(e) => setSepaInvRef(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
          </div>
          {editingSepa && (
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Batch Status</label>
              <select value={sepaStatus} onChange={(e) => setSepaStatus(e.target.value as SepaBatch['status'])} className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs">
                <option value="prepared">Prepared</option>
                <option value="transmitted">Transmitted</option>
                <option value="settled">Settled</option>
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setSepaModal(false)} className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs">Cancel</button>
            <button type="submit" className="h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">Save Batch</button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(xmlPreview)} onClose={() => setXmlPreview(null)} title={`SEPA XML — ${xmlPreview?.ref || ''}`} maxWidthClass="max-w-2xl">
        <pre className="p-3 rounded-lg bg-zinc-950 text-emerald-300 text-[11px] font-mono overflow-x-auto max-h-96">
          {xmlPreview?.xml}
        </pre>
      </Modal>
    </div>
  );
}

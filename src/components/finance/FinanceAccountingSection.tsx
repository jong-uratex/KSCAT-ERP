import { useState, type FormEvent } from 'react';
import {
  Calculator,
  CheckCircle2,
  Download,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Unlock,
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import type {
  AccountingAccount,
  FinancialStatementsPayload,
  FiscalPeriodItem,
  FixedAssetItem,
  JournalEntry,
  Project,
} from '../../types/erp';
import { Modal } from '../Modal';
import { StatusText } from '../StatusText';
import { downloadCsvBlob } from './financeHelpers';

interface FinanceAccountingSectionProps {
  accounts: AccountingAccount[];
  journalEntries: JournalEntry[];
  fiscalPeriods: FiscalPeriodItem[];
  fixedAssets: FixedAssetItem[];
  financialStatements: FinancialStatementsPayload;
  projects: Project[];
  canWrite: boolean;
  canValidate: boolean;
  canDelete: boolean;
  onReload: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPromptDelete: (url: string, title: string, itemLabel: string, warning?: string) => void;
}

type AccountingSubTab = 'ledger' | 'statements' | 'periods' | 'assets';

export function FinanceAccountingSection({
  accounts,
  journalEntries,
  fiscalPeriods,
  fixedAssets,
  financialStatements,
  projects,
  canWrite,
  canValidate,
  canDelete,
  onReload,
  onNotify,
  onPromptDelete,
}: FinanceAccountingSectionProps) {
  const [subTab, setSubTab] = useState<AccountingSubTab>('ledger');

  // GL Account modal
  const [glModal, setGlModal] = useState(false);
  const [editingGl, setEditingGl] = useState<AccountingAccount | null>(null);
  const [glCode, setGlCode] = useState('');
  const [glLabel, setGlLabel] = useState('');
  const [glClass, setGlClass] = useState<AccountingAccount['account_class']>('expense');

  // Journal Entry modal
  const [jrnModal, setJrnModal] = useState(false);
  const [editingJrn, setEditingJrn] = useState<JournalEntry | null>(null);
  const [jrnDate, setJrnDate] = useState(new Date().toISOString().slice(0, 10));
  const [jrnCode, setJrnCode] = useState('GEN');
  const [jrnDesc, setJrnDesc] = useState('');
  const [jrnDebit, setJrnDebit] = useState(accounts[0]?.code || '6100');
  const [jrnCredit, setJrnCredit] = useState(accounts[1]?.code || '1010');
  const [jrnAmount, setJrnAmount] = useState('500');
  const [jrnSource, setJrnSource] = useState('');
  const [jrnProjectId, setJrnProjectId] = useState('');

  // Fiscal Period modal
  const [fpModal, setFpModal] = useState(false);
  const [editingFp, setEditingFp] = useState<FiscalPeriodItem | null>(null);
  const [fpCode, setFpCode] = useState('');
  const [fpName, setFpName] = useState('');
  const [fpStart, setFpStart] = useState(new Date().toISOString().slice(0, 8) + '01');
  const [fpEnd, setFpEnd] = useState(new Date().toISOString().slice(0, 8) + '28');

  // Fixed Asset modal
  const [assetModal, setAssetModal] = useState(false);
  const [editingAsset, setEditingAsset] = useState<FixedAssetItem | null>(null);
  const [faName, setFaName] = useState('');
  const [faCategory, setFaCategory] = useState('Machinery & Equipment');
  const [faAcqDate, setFaAcqDate] = useState(new Date().toISOString().slice(0, 10));
  const [faCost, setFaCost] = useState('15000');
  const [faSalvage, setFaSalvage] = useState('1500');
  const [faLife, setFaLife] = useState('60');
  const [faMethod, setFaMethod] = useState<'straight_line' | 'declining_balance'>('straight_line');
  const [faLocation, setFaLocation] = useState('Chicago Main Plant');
  const [faStatus, setFaStatus] = useState<FixedAssetItem['status']>('active');
  const [faNotes, setFaNotes] = useState('');

  function openCreateGl() {
    setEditingGl(null);
    setGlCode('');
    setGlLabel('');
    setGlClass('expense');
    setGlModal(true);
  }

  function openEditGl(a: AccountingAccount) {
    setEditingGl(a);
    setGlCode(a.code);
    setGlLabel(a.label);
    setGlClass(a.account_class);
    setGlModal(true);
  }

  async function handleSaveGl(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingGl) {
        await apiRequest(`/api/accounting/accounts/${editingGl.id}`, {
          method: 'PUT',
          body: { label: glLabel, accountClass: glClass },
        });
        onNotify(`GL Account ${editingGl.code} updated.`);
      } else {
        await apiRequest('/api/accounting/accounts', {
          method: 'POST',
          body: { code: glCode, label: glLabel, accountClass: glClass },
        });
        onNotify('GL Account created.');
      }
      setGlModal(false);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save GL account.', 'error');
    }
  }

  function openCreateJrn() {
    setEditingJrn(null);
    setJrnDate(new Date().toISOString().slice(0, 10));
    setJrnCode('GEN');
    setJrnDesc('');
    setJrnDebit(accounts[0]?.code || '');
    setJrnCredit(accounts[1]?.code || '');
    setJrnAmount('500');
    setJrnSource('');
    setJrnProjectId('');
    setJrnModal(true);
  }

  function openEditJrn(j: JournalEntry) {
    setEditingJrn(j);
    setJrnDate(j.entry_date);
    setJrnCode(j.journal_code);
    setJrnDesc(j.description);
    setJrnDebit(j.debit_account_code);
    setJrnCredit(j.credit_account_code);
    setJrnAmount(String(j.amount));
    setJrnSource(j.source_ref || '');
    setJrnProjectId(j.project_id ? String(j.project_id) : '');
    setJrnModal(true);
  }

  async function handleSaveJrn(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        entryDate: jrnDate,
        journalCode: jrnCode,
        description: jrnDesc,
        debitAccountCode: jrnDebit,
        creditAccountCode: jrnCredit,
        amount: Number(jrnAmount),
        sourceRef: jrnSource,
        projectId: jrnProjectId ? Number(jrnProjectId) : null,
      };
      if (editingJrn) {
        await apiRequest(`/api/accounting/journal/${editingJrn.id}`, { method: 'PUT', body: payload });
        onNotify(`Journal entry ${editingJrn.ref} updated.`);
      } else {
        await apiRequest('/api/accounting/journal', { method: 'POST', body: payload });
        onNotify('Double-entry journal posted.');
      }
      setJrnModal(false);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Journal entry failed.', 'error');
    }
  }

  async function handleReverseJrn(j: JournalEntry) {
    try {
      await apiRequest(`/api/accounting/journal/${j.id}/reverse`, { method: 'POST', body: {} });
      onNotify(`Reversal entry posted for ${j.ref}.`);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to reverse entry.', 'error');
    }
  }

  async function handleExportStatements() {
    try {
      const res = await apiRequest<{ filename: string; csv: string }>('/api/accounting/export');
      downloadCsvBlob(res.filename, res.csv);
      onNotify('Trial balance CSV downloaded.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Export failed.', 'error');
    }
  }

  function openCreateFp() {
    setEditingFp(null);
    setFpCode(`FY2027-01`);
    setFpName('January 2027 Operating Period');
    setFpStart('2027-01-01');
    setFpEnd('2027-01-31');
    setFpModal(true);
  }

  function openEditFp(fp: FiscalPeriodItem) {
    setEditingFp(fp);
    setFpCode(fp.code);
    setFpName(fp.name);
    setFpStart(fp.start_date);
    setFpEnd(fp.end_date);
    setFpModal(true);
  }

  async function handleSaveFp(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingFp) {
        await apiRequest(`/api/accounting/fiscal-periods/${editingFp.id}`, {
          method: 'PUT',
          body: { name: fpName, startDate: fpStart, endDate: fpEnd },
        });
        onNotify(`Fiscal period ${editingFp.code} updated.`);
      } else {
        await apiRequest('/api/accounting/fiscal-periods', {
          method: 'POST',
          body: { code: fpCode, name: fpName, startDate: fpStart, endDate: fpEnd },
        });
        onNotify('Fiscal period created.');
      }
      setFpModal(false);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save fiscal period.', 'error');
    }
  }

  async function handleToggleFp(fp: FiscalPeriodItem) {
    try {
      await apiRequest(`/api/accounting/fiscal-periods/${fp.id}/toggle`, { method: 'POST', body: {} });
      onNotify(`Fiscal period ${fp.code} ${fp.status === 'open' ? 'closed & locked' : 'reopened'}.`);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Period toggle failed.', 'error');
    }
  }

  function openCreateAsset() {
    setEditingAsset(null);
    setFaName('');
    setFaCategory('Machinery & Production');
    setFaAcqDate(new Date().toISOString().slice(0, 10));
    setFaCost('15000');
    setFaSalvage('1500');
    setFaLife('60');
    setFaMethod('straight_line');
    setFaLocation('Chicago Main Plant');
    setFaStatus('active');
    setFaNotes('');
    setAssetModal(true);
  }

  function openEditAsset(a: FixedAssetItem) {
    setEditingAsset(a);
    setFaName(a.name);
    setFaCategory(a.category);
    setFaAcqDate(a.acquisition_date);
    setFaCost(String(a.purchase_cost));
    setFaSalvage(String(a.salvage_value));
    setFaLife(String(a.useful_life_months));
    setFaMethod(a.depreciation_method);
    setFaLocation(a.location);
    setFaStatus(a.status);
    setFaNotes(a.notes || '');
    setAssetModal(true);
  }

  async function handleSaveAsset(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        name: faName,
        category: faCategory,
        acquisitionDate: faAcqDate,
        purchaseCost: Number(faCost) || 0,
        salvageValue: Number(faSalvage) || 0,
        usefulLifeMonths: Number(faLife) || 60,
        depreciationMethod: faMethod,
        location: faLocation,
        status: faStatus,
        notes: faNotes,
      };
      if (editingAsset) {
        await apiRequest(`/api/finance/fixed-assets/${editingAsset.id}`, { method: 'PUT', body: payload });
        onNotify(`Fixed asset ${editingAsset.ref} updated.`);
      } else {
        await apiRequest('/api/finance/fixed-assets', { method: 'POST', body: payload });
        onNotify('Fixed asset registered.');
      }
      setAssetModal(false);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save fixed asset.', 'error');
    }
  }

  async function handleDepreciateAsset(a: FixedAssetItem) {
    try {
      const res = await apiRequest<{ journalRef: string; charge: number }>(
        `/api/finance/fixed-assets/${a.id}/depreciate`,
        { method: 'POST', body: {} }
      );
      onNotify(`Posted ${formatCurrency(res.charge)} monthly depreciation (${res.journalRef}).`);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Depreciation run failed.', 'error');
    }
  }

  const { trialBalance, profitAndLoss, balanceSheet } = financialStatements;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-0.5 overflow-x-auto">
          {(
            [
              ['ledger', 'Chart of Accounts & Journal'],
              ['statements', 'Financial Statements'],
              ['periods', `Fiscal Periods (${fiscalPeriods.length})`],
              ['assets', `Fixed Assets (${fixedAssets.length})`],
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
          {subTab === 'ledger' && canWrite && (
            <>
              <button
                type="button"
                onClick={openCreateGl}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add GL Account</span>
              </button>
              <button
                type="button"
                onClick={openCreateJrn}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Post Journal Entry</span>
              </button>
            </>
          )}
          {subTab === 'statements' && (
            <button
              type="button"
              onClick={handleExportStatements}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Trial Balance CSV</span>
            </button>
          )}
          {subTab === 'periods' && canWrite && (
            <button
              type="button"
              onClick={openCreateFp}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Fiscal Period</span>
            </button>
          )}
          {subTab === 'assets' && canWrite && (
            <button
              type="button"
              onClick={openCreateAsset}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Register Asset</span>
            </button>
          )}
        </div>
      </div>

      {subTab === 'ledger' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Chart of Accounts</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-2.5 px-4 font-medium">Code</th>
                    <th className="py-2.5 px-4 font-medium">Label</th>
                    <th className="py-2.5 px-4 font-medium">Class</th>
                    <th className="py-2.5 px-4 font-medium text-right">Balance</th>
                    <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {accounts.map((a) => (
                    <tr key={a.id}>
                      <td className="py-2.5 px-4 font-mono font-medium text-orange-700 dark:text-orange-400">{a.code}</td>
                      <td className="py-2.5 px-4 font-medium text-zinc-900 dark:text-zinc-100">{a.label}</td>
                      <td className="py-2.5 px-4 capitalize text-zinc-500">{a.account_class}</td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-right font-medium">{formatCurrency(a.balance)}</td>
                      <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => openEditGl(a)}
                            title="Edit GL account"
                            aria-label={`Edit GL ${a.code}`}
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
                                `/api/accounting/accounts/${a.id}`,
                                'Delete GL Account',
                                `${a.code} — ${a.label}`,
                                'Accounts referenced by existing journal entries cannot be deleted.'
                              )
                            }
                            title="Delete GL account"
                            aria-label={`Delete GL ${a.code}`}
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

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Double-Entry Journal Ledger</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-2.5 px-4 font-medium">Ref · Date</th>
                    <th className="py-2.5 px-4 font-medium">Description</th>
                    <th className="py-2.5 px-4 font-medium">DR / CR</th>
                    <th className="py-2.5 px-4 font-medium text-right">Amount</th>
                    <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {journalEntries.map((j) => (
                    <tr key={j.id}>
                      <td className="py-2.5 px-4 font-mono text-zinc-500">
                        <div className="text-orange-700 dark:text-orange-400 font-medium">{j.ref}</div>
                        <div>{formatDate(j.entry_date)}</div>
                      </td>
                      <td className="py-2.5 px-4 text-zinc-800 dark:text-zinc-200">
                        {j.description}
                        <div className="text-[11px] font-mono text-zinc-400">
                          {j.journal_code}
                          {j.project_ref ? ` · ${j.project_ref}` : ''}
                          {j.reversed_entry_ref ? ` · Reverses ${j.reversed_entry_ref}` : ''}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px]">
                        <div>DR {j.debit_account_code}</div>
                        <div className="text-zinc-500">CR {j.credit_account_code}</div>
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-right font-semibold">{formatCurrency(j.amount)}</td>
                      <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
                        {canWrite && !j.is_reversal && (
                          <button
                            type="button"
                            onClick={() => handleReverseJrn(j)}
                            title="Post reversing journal entry"
                            aria-label={`Reverse ${j.ref}`}
                            className="text-amber-700 dark:text-amber-400 hover:opacity-80 inline-flex items-center align-middle"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => openEditJrn(j)}
                            title="Edit journal entry"
                            aria-label={`Edit ${j.ref}`}
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
                                `/api/accounting/journal/${j.id}`,
                                'Delete Journal Entry',
                                j.ref,
                                'Deleting this entry reverses its debit and credit impact on GL account balances (blocked if period is closed).'
                              )
                            }
                            title="Delete journal entry"
                            aria-label={`Delete ${j.ref}`}
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

      {subTab === 'statements' && (
        <div className="space-y-6">
          {/* P&L and Balance Sheet Side-by-Side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Income Statement */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Income Statement (Profit &amp; Loss)</h3>
                  <p className="text-xs text-zinc-500">Automated from General Ledger revenue &amp; expense accounts</p>
                </div>
                <span className="text-xs font-mono font-semibold text-zinc-600 dark:text-zinc-300">
                  {profitAndLoss.netMarginPct.toFixed(1)}% Net Margin
                </span>
              </div>
              <div className="p-5 space-y-4 text-xs">
                <div>
                  <div className="font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">Operating Revenue</div>
                  <div className="space-y-1">
                    {profitAndLoss.revenueItems.map((r) => (
                      <div key={r.code} className="flex justify-between py-1 border-b border-zinc-100 dark:border-zinc-800/70">
                        <span><span className="font-mono text-zinc-500 mr-2">{r.code}</span>{r.label}</span>
                        <span className="font-mono tabular-nums">{formatCurrency(r.amount)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between pt-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
                      <span>Total Revenue</span>
                      <span className="font-mono tabular-nums">{formatCurrency(profitAndLoss.totalRevenue)}</span>
                    </div>
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">Operating &amp; Direct Expenses</div>
                  <div className="space-y-1">
                    {profitAndLoss.expenseItems.map((e) => (
                      <div key={e.code} className="flex justify-between py-1 border-b border-zinc-100 dark:border-zinc-800/70">
                        <span><span className="font-mono text-zinc-500 mr-2">{e.code}</span>{e.label}</span>
                        <span className="font-mono tabular-nums">{formatCurrency(e.amount)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between pt-1.5 font-semibold text-zinc-900 dark:text-zinc-100">
                      <span>Total Expenses</span>
                      <span className="font-mono tabular-nums">{formatCurrency(profitAndLoss.totalExpenses)}</span>
                    </div>
                  </div>
                </div>
                <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 flex justify-between text-sm font-bold">
                  <span>Net Income</span>
                  <span
                    className={`font-mono tabular-nums ${
                      profitAndLoss.netIncome >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                    }`}
                  >
                    {formatCurrency(profitAndLoss.netIncome)}
                  </span>
                </div>
              </div>
            </div>

            {/* Balance Sheet */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Balance Sheet</h3>
                  <p className="text-xs text-zinc-500">Assets = Liabilities + Equity + Current Net Income</p>
                </div>
                <span
                  className={`inline-flex items-center gap-1 text-xs font-medium ${
                    balanceSheet.isBalanced ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {balanceSheet.isBalanced ? 'Balanced' : 'Variance Detected'}
                </span>
              </div>
              <div className="p-5 space-y-4 text-xs">
                <div>
                  <div className="font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">Assets</div>
                  {balanceSheet.assetItems.map((a) => (
                    <div key={a.code} className="flex justify-between py-1 border-b border-zinc-100 dark:border-zinc-800/70">
                      <span><span className="font-mono text-zinc-500 mr-2">{a.code}</span>{a.label}</span>
                      <span className="font-mono tabular-nums">{formatCurrency(a.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between pt-1.5 font-semibold text-zinc-900 dark:text-zinc-100">
                    <span>Total Assets</span>
                    <span className="font-mono tabular-nums">{formatCurrency(balanceSheet.totalAssets)}</span>
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">Liabilities &amp; Equity</div>
                  {balanceSheet.liabilityItems.map((l) => (
                    <div key={l.code} className="flex justify-between py-1 border-b border-zinc-100 dark:border-zinc-800/70">
                      <span><span className="font-mono text-zinc-500 mr-2">{l.code}</span>{l.label}</span>
                      <span className="font-mono tabular-nums">{formatCurrency(l.amount)}</span>
                    </div>
                  ))}
                  {balanceSheet.equityItems.map((eq) => (
                    <div key={eq.code} className="flex justify-between py-1 border-b border-zinc-100 dark:border-zinc-800/70">
                      <span><span className="font-mono text-zinc-500 mr-2">{eq.code}</span>{eq.label}</span>
                      <span className="font-mono tabular-nums">{formatCurrency(eq.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between py-1 border-b border-zinc-100 dark:border-zinc-800/70">
                    <span>Current Period Net Income</span>
                    <span className="font-mono tabular-nums">{formatCurrency(balanceSheet.netIncome)}</span>
                  </div>
                  <div className="flex justify-between pt-2 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    <span>Total Liabilities &amp; Equity</span>
                    <span className="font-mono tabular-nums">{formatCurrency(balanceSheet.totalLiabilitiesAndEquity)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Trial Balance */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Trial Balance</h3>
              <span
                className={`text-xs font-medium ${
                  trialBalance.isBalanced ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                }`}
              >
                {trialBalance.isBalanced
                  ? 'Debits = Credits (In Equilibrium)'
                  : `Out of balance by ${formatCurrency(Math.abs(trialBalance.totalDebits - trialBalance.totalCredits))}`}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-2.5 px-4 font-medium">Code</th>
                    <th className="py-2.5 px-4 font-medium">Account</th>
                    <th className="py-2.5 px-4 font-medium">Class</th>
                    <th className="py-2.5 px-4 font-medium text-right">Debit</th>
                    <th className="py-2.5 px-4 font-medium text-right">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {trialBalance.rows.map((r) => (
                    <tr key={r.code}>
                      <td className="py-2 px-4 font-mono text-orange-700 dark:text-orange-400">{r.code}</td>
                      <td className="py-2 px-4 font-medium text-zinc-900 dark:text-zinc-100">{r.label}</td>
                      <td className="py-2 px-4 capitalize text-zinc-500">{r.account_class}</td>
                      <td className="py-2 px-4 font-mono tabular-nums text-right">
                        {r.debit > 0 ? formatCurrency(r.debit) : '—'}
                      </td>
                      <td className="py-2 px-4 font-mono tabular-nums text-right">
                        {r.credit > 0 ? formatCurrency(r.credit) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-bold">
                    <td colSpan={3} className="py-2.5 px-4">Trial Balance Totals</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right">{formatCurrency(trialBalance.totalDebits)}</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right">{formatCurrency(trialBalance.totalCredits)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {subTab === 'periods' && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Fiscal Periods &amp; Accounting Close Locks</h3>
            <p className="text-xs text-zinc-500">Closed periods prevent backdated journal postings, edits, or deletions; use journal reversals instead.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                  <th className="py-2.5 px-4 font-medium">Code</th>
                  <th className="py-2.5 px-4 font-medium">Period Name</th>
                  <th className="py-2.5 px-4 font-medium">Date Range</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium">Closed By</th>
                  <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {fiscalPeriods.map((fp) => (
                  <tr key={fp.id}>
                    <td className="py-2.5 px-4 font-mono font-medium text-orange-700 dark:text-orange-400">{fp.code}</td>
                    <td className="py-2.5 px-4 font-medium text-zinc-900 dark:text-zinc-100">{fp.name}</td>
                    <td className="py-2.5 px-4 font-mono text-zinc-500">
                      {formatDate(fp.start_date)} → {formatDate(fp.end_date)}
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusText status={fp.status} />
                    </td>
                    <td className="py-2.5 px-4 text-zinc-500">{fp.closed_by || '—'}</td>
                    <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
                      {canValidate && (
                        <button
                          type="button"
                          onClick={() => handleToggleFp(fp)}
                          className="inline-flex items-center gap-1 font-medium text-orange-700 dark:text-orange-400 hover:underline align-middle"
                        >
                          {fp.status === 'open' ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                          {fp.status === 'open' ? 'Close' : 'Reopen'}
                        </button>
                      )}
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => openEditFp(fp)}
                          title="Edit fiscal period"
                          aria-label={`Edit ${fp.code}`}
                          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center align-middle"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          disabled={fp.status === 'closed'}
                          onClick={() =>
                            onPromptDelete(
                              `/api/accounting/fiscal-periods/${fp.id}`,
                              'Delete Fiscal Period',
                              `${fp.code} — ${fp.name}`,
                              'Closed fiscal periods must be reopened before deletion.'
                            )
                          }
                          title={fp.status === 'closed' ? 'Reopen period before deleting' : 'Delete period'}
                          aria-label={`Delete ${fp.code}`}
                          className={`inline-flex items-center align-middle ${
                            fp.status === 'closed' ? 'text-zinc-300 dark:text-zinc-700 cursor-not-allowed' : 'text-zinc-400 hover:text-red-600'
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
      )}

      {subTab === 'assets' && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Fixed Assets &amp; Depreciation Register</h3>
            <p className="text-xs text-zinc-500">Track acquisition cost, salvage value, Net Book Value (NBV), and post monthly GL depreciation.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                  <th className="py-2.5 px-4 font-medium">Asset</th>
                  <th className="py-2.5 px-4 font-medium">Method · Life</th>
                  <th className="py-2.5 px-4 font-medium text-right">Purchase Cost</th>
                  <th className="py-2.5 px-4 font-medium text-right">Accum. Depr.</th>
                  <th className="py-2.5 px-4 font-medium text-right">Net Book Value</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {fixedAssets.map((a) => (
                  <tr key={a.id}>
                    <td className="py-2.5 px-4">
                      <div className="font-mono font-medium text-orange-700 dark:text-orange-400">{a.ref}</div>
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{a.name}</div>
                      <div className="text-[11px] text-zinc-500">{a.category} · {a.location}</div>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="capitalize">{a.depreciation_method.replace('_', ' ')}</div>
                      <div className="text-[11px] font-mono text-zinc-500">
                        {a.useful_life_months} mos · ~{formatCurrency(a.monthly_depreciation)}/mo
                      </div>
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right">{formatCurrency(a.purchase_cost)}</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right text-amber-700 dark:text-amber-400">
                      {formatCurrency(a.accumulated_depreciation)}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right font-semibold text-zinc-900 dark:text-zinc-100">
                      {formatCurrency(a.net_book_value)}
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusText status={a.status} />
                    </td>
                    <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
                      {canWrite && a.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => handleDepreciateAsset(a)}
                          className="inline-flex items-center gap-1 font-medium text-orange-700 dark:text-orange-400 hover:underline align-middle"
                        >
                          <Calculator className="w-3.5 h-3.5" /> Depreciate
                        </button>
                      )}
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => openEditAsset(a)}
                          title="Edit fixed asset"
                          aria-label={`Edit ${a.ref}`}
                          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center align-middle"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => onPromptDelete(`/api/finance/fixed-assets/${a.id}`, 'Delete Fixed Asset', `${a.ref} — ${a.name}`)}
                          title="Delete fixed asset"
                          aria-label={`Delete ${a.ref}`}
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
      <Modal open={glModal} onClose={() => setGlModal(false)} title={editingGl ? `Edit GL ${editingGl.code}` : 'New GL Account'} maxWidthClass="max-w-md">
        <form onSubmit={handleSaveGl} className="space-y-3.5">
          {!editingGl && (
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Account Code</label>
              <input type="text" value={glCode} onChange={(e) => setGlCode(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Label</label>
            <input type="text" value={glLabel} onChange={(e) => setGlLabel(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Account Class</label>
            <select value={glClass} onChange={(e) => setGlClass(e.target.value as AccountingAccount['account_class'])} className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs">
              <option value="asset">Asset</option>
              <option value="liability">Liability</option>
              <option value="equity">Equity</option>
              <option value="revenue">Revenue</option>
              <option value="expense">Expense</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setGlModal(false)} className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs">Cancel</button>
            <button type="submit" className="h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">Save Account</button>
          </div>
        </form>
      </Modal>

      <Modal open={jrnModal} onClose={() => setJrnModal(false)} title={editingJrn ? `Edit Journal ${editingJrn.ref}` : 'Post Journal Entry'} maxWidthClass="max-w-lg">
        <form onSubmit={handleSaveJrn} className="space-y-3.5">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Entry Date</label>
              <input type="date" value={jrnDate} onChange={(e) => setJrnDate(e.target.value)} required className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Journal Code</label>
              <input type="text" value={jrnCode} onChange={(e) => setJrnCode(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Amount ($)</label>
              <input type="number" step="0.01" min="0.01" value={jrnAmount} onChange={(e) => setJrnAmount(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Description</label>
            <input type="text" value={jrnDesc} onChange={(e) => setJrnDesc(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Debit Account (DR)</label>
              <select value={jrnDebit} onChange={(e) => setJrnDebit(e.target.value)} className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs">
                {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Credit Account (CR)</label>
              <select value={jrnCredit} onChange={(e) => setJrnCredit(e.target.value)} className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs">
                {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Project Allocation (Optional)</label>
              <select value={jrnProjectId} onChange={(e) => setJrnProjectId(e.target.value)} className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs">
                <option value="">None</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.ref} — {p.title}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Source Doc Ref</label>
              <input type="text" value={jrnSource} onChange={(e) => setJrnSource(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setJrnModal(false)} className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs">Cancel</button>
            <button type="submit" className="h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">Post Entry</button>
          </div>
        </form>
      </Modal>

      <Modal open={fpModal} onClose={() => setFpModal(false)} title={editingFp ? `Edit Period ${editingFp.code}` : 'New Fiscal Period'} maxWidthClass="max-w-md">
        <form onSubmit={handleSaveFp} className="space-y-3.5">
          {!editingFp && (
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Period Code</label>
              <input type="text" value={fpCode} onChange={(e) => setFpCode(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Period Name</label>
            <input type="text" value={fpName} onChange={(e) => setFpName(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Start Date</label>
              <input type="date" value={fpStart} onChange={(e) => setFpStart(e.target.value)} required className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">End Date</label>
              <input type="date" value={fpEnd} onChange={(e) => setFpEnd(e.target.value)} required className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setFpModal(false)} className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs">Cancel</button>
            <button type="submit" className="h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">Save Period</button>
          </div>
        </form>
      </Modal>

      <Modal open={assetModal} onClose={() => setAssetModal(false)} title={editingAsset ? `Edit Asset ${editingAsset.ref}` : 'Register Fixed Asset'} maxWidthClass="max-w-lg">
        <form onSubmit={handleSaveAsset} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Asset Name</label>
            <input type="text" value={faName} onChange={(e) => setFaName(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Category</label>
              <input type="text" value={faCategory} onChange={(e) => setFaCategory(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Acquisition Date</label>
              <input type="date" value={faAcqDate} onChange={(e) => setFaAcqDate(e.target.value)} required className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Purchase Cost ($)</label>
              <input type="number" step="0.01" min="1" value={faCost} onChange={(e) => setFaCost(e.target.value)} required className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Salvage Value ($)</label>
              <input type="number" step="0.01" min="0" value={faSalvage} onChange={(e) => setFaSalvage(e.target.value)} className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Life (Months)</label>
              <input type="number" min="1" value={faLife} onChange={(e) => setFaLife(e.target.value)} required className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Depreciation Method</label>
              <select value={faMethod} onChange={(e) => setFaMethod(e.target.value as 'straight_line' | 'declining_balance')} className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs">
                <option value="straight_line">Straight-Line</option>
                <option value="declining_balance">Double Declining Balance</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Location</label>
              <input type="text" value={faLocation} onChange={(e) => setFaLocation(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
            </div>
          </div>
          {editingAsset && (
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Lifecycle Status</label>
              <select value={faStatus} onChange={(e) => setFaStatus(e.target.value as FixedAssetItem['status'])} className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs">
                <option value="active">Active</option>
                <option value="fully_depreciated">Fully Depreciated</option>
                <option value="disposed">Disposed</option>
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Notes</label>
            <input type="text" value={faNotes} onChange={(e) => setFaNotes(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setAssetModal(false)} className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs">Cancel</button>
            <button type="submit" className="h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">Save Asset</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

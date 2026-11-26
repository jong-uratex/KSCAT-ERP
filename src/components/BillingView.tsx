import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeftRight,
  BookOpen,
  Building2,
  Car,
  CreditCard,
  Download,
  FileSpreadsheet,
  FolderKanban,
  HeartHandshake,
  Landmark,
  Mail,
  Pencil,
  Plus,
  Receipt,
  Send,
  Sparkles,
  Trash2,
  Users,
  Wallet,
} from 'lucide-react';
import { apiRequest, can } from '../lib/api';
import { formatCurrency, formatDate } from '../lib/format';
import type {
  AccountingAccount,
  AccountingReports,
  BankAccount,
  BankTransaction,
  DocumentLine,
  DonationItem,
  EnabledModulesMap,
  FixedAssetItem,
  Invoice,
  JournalEntry,
  LoanItem,
  MileageClaimItem,
  PayrollRunItem,
  PermissionMap,
  ProductItem,
  SearchFocusHint,
  SepaBatch,
  ThirdParty,
} from '../types/erp';
import { ConfirmDeleteModal, Modal } from './Modal';
import { StatusText } from './StatusText';
import { AiFinancePartnerPanel } from './billing/AiFinancePartnerPanel';
import { FixedAssetsPanel, MileagePanel, PayrollPanel } from './billing/AssetsPayrollMileage';
import { BankReconciliationPanel, FinancialReportsPanel } from './billing/ReconciliationAndReports';

interface BillingViewProps {
  permissions: PermissionMap;
  enabledModules: EnabledModulesMap;
  focusHint?: SearchFocusHint | null;
  onNavigateModule?: (moduleKey: 'commerce' | 'hr' | 'projects', subTab?: string) => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

interface MarginStats {
  revenue_ht: number;
  credit_notes_ht: number;
  purchases_ht: number;
  vat_collected: number;
  vat_deductible: number;
}

interface EmployeeBrief {
  id: number;
  ref: string;
  full_name: string;
  department: string;
  annual_salary: number;
  status: string;
}

type BillingTab =
  | 'customer_invoices'
  | 'supplier_bills'
  | 'treasury'
  | 'accounting'
  | 'reports'
  | 'fixed_assets'
  | 'payroll'
  | 'mileage'
  | 'sepa'
  | 'donations_loans';

export function BillingView({
  permissions,
  enabledModules,
  focusHint,
  onNavigateModule,
  onNotify,
}: BillingViewProps) {
  const [tab, setTab] = useState<BillingTab>('customer_invoices');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [thirdParties, setThirdParties] = useState<ThirdParty[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);

  const [sepaBatches, setSepaBatches] = useState<SepaBatch[]>([]);
  const [glAccounts, setGlAccounts] = useState<AccountingAccount[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [donations, setDonations] = useState<DonationItem[]>([]);
  const [loans, setLoans] = useState<LoanItem[]>([]);
  const [fixedAssets, setFixedAssets] = useState<FixedAssetItem[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRunItem[]>([]);
  const [mileageClaims, setMileageClaims] = useState<MileageClaimItem[]>([]);
  const [employees, setEmployees] = useState<EmployeeBrief[]>([]);
  const [reports, setReports] = useState<AccountingReports | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

  const [marginStats, setMarginStats] = useState<MarginStats>({
    revenue_ht: 0,
    credit_notes_ht: 0,
    purchases_ht: 0,
    vat_collected: 0,
    vat_deductible: 0,
  });
  const [loading, setLoading] = useState(true);

  const [paymentModal, setPaymentModal] = useState<Invoice | null>(null);
  const [payAccountId, setPayAccountId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payLabel, setPayLabel] = useState('');

  const [sendModal, setSendModal] = useState<Invoice | null>(null);
  const [sendEmail, setSendEmail] = useState('');
  const [sendMessage, setSendMessage] = useState('');
  const [sendingInv, setSendingInv] = useState(false);

  // Invoice Create / Edit modal
  const [invoiceModal, setInvoiceModal] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [invType, setInvType] = useState<'customer' | 'supplier'>('customer');
  const [invKind, setInvKind] = useState<'standard' | 'credit_note'>('standard');
  const [invPartyId, setInvPartyId] = useState('');
  const [invIssueDate, setInvIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [invDueDate, setInvDueDate] = useState(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  const [invStatus, setInvStatus] = useState<Invoice['status']>('draft');
  const [invLines, setInvLines] = useState<DocumentLine[]>([
    { productId: null, ref: '', label: '', qty: 1, unitPrice: 0, discountPct: 0, taxRate: 20 },
  ]);
  const [invNotes, setInvNotes] = useState('');

  // Bank Account Create / Edit modal
  const [bankModal, setBankModal] = useState(false);
  const [editingBank, setEditingBank] = useState<BankAccount | null>(null);
  const [bRef, setBRef] = useState('');
  const [bName, setBName] = useState('');
  const [bBank, setBBank] = useState('');
  const [bNumber, setBNumber] = useState('');
  const [bType, setBType] = useState<'checking' | 'savings' | 'cash'>('checking');
  const [bStatus, setBStatus] = useState<'active' | 'closed'>('active');
  const [bBalance, setBBalance] = useState('0');

  // Bank Transaction Create / Edit modal
  const [txModal, setTxModal] = useState(false);
  const [editingTx, setEditingTx] = useState<BankTransaction | null>(null);
  const [txAccountId, setTxAccountId] = useState('');
  const [txDate, setTxDate] = useState(new Date().toISOString().slice(0, 10));
  const [txLabel, setTxLabel] = useState('');
  const [txCategory, setTxCategory] = useState('Operations');
  const [txAmount, setTxAmount] = useState('');
  const [txDirection, setTxDirection] = useState<'credit' | 'debit'>('debit');

  // SEPA Batch modal
  const [sepaModal, setSepaModal] = useState(false);
  const [editingSepa, setEditingSepa] = useState<SepaBatch | null>(null);
  const [sepaType, setSepaType] = useState<'credit_transfer' | 'direct_debit'>('credit_transfer');
  const [sepaBankId, setSepaBankId] = useState('');
  const [sepaExecDate, setSepaExecDate] = useState(new Date().toISOString().slice(0, 10));
  const [sepaParty, setSepaParty] = useState('');
  const [sepaIban, setSepaIban] = useState('FR7630006000011234567890189');
  const [sepaAmount, setSepaAmount] = useState('1200');
  const [sepaInvRef, setSepaInvRef] = useState('');
  const [sepaStatus, setSepaStatus] = useState<SepaBatch['status']>('prepared');
  const [xmlPreview, setXmlPreview] = useState<{ ref: string; xml: string } | null>(null);

  // Accounting modals
  const [glModal, setGlModal] = useState(false);
  const [editingGl, setEditingGl] = useState<AccountingAccount | null>(null);
  const [glCode, setGlCode] = useState('');
  const [glLabel, setGlLabel] = useState('');
  const [glClass, setGlClass] = useState<AccountingAccount['account_class']>('expense');

  const [jrnModal, setJrnModal] = useState(false);
  const [editingJrn, setEditingJrn] = useState<JournalEntry | null>(null);
  const [jrnDate, setJrnDate] = useState(new Date().toISOString().slice(0, 10));
  const [jrnCode, setJrnCode] = useState('GEN');
  const [jrnDesc, setJrnDesc] = useState('');
  const [jrnDebit, setJrnDebit] = useState('');
  const [jrnCredit, setJrnCredit] = useState('');
  const [jrnAmount, setJrnAmount] = useState('500');

  // Donation & Loan modals
  const [donModal, setDonModal] = useState(false);
  const [editingDon, setEditingDon] = useState<DonationItem | null>(null);
  const [donName, setDonName] = useState('');
  const [donEmail, setDonEmail] = useState('');
  const [donAmount, setDonAmount] = useState('500');
  const [donDate, setDonDate] = useState(new Date().toISOString().slice(0, 10));
  const [donMode, setDonMode] = useState('Bank Transfer');
  const [donStatus, setDonStatus] = useState<DonationItem['status']>('promised');
  const [donNotes, setDonNotes] = useState('');

  const [loanModal, setLoanModal] = useState(false);
  const [editingLoan, setEditingLoan] = useState<LoanItem | null>(null);
  const [loanLabel, setLoanLabel] = useState('');
  const [loanLender, setLoanLender] = useState('');
  const [loanPrincipal, setLoanPrincipal] = useState('50000');
  const [loanRemaining, setLoanRemaining] = useState('50000');
  const [loanRate, setLoanRate] = useState('4.2');
  const [loanTerm, setLoanTerm] = useState('36');
  const [loanStartDate, setLoanStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [loanStatus, setLoanStatus] = useState<LoanItem['status']>('active');

  const [repayLoan, setRepayLoan] = useState<LoanItem | null>(null);
  const [repayAmt, setRepayAmt] = useState('1500');

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<{
    url: string;
    title: string;
    itemLabel: string;
    warning?: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const canWrite = can(permissions, 'billing', 'write');
  const canValidate = can(permissions, 'billing', 'validate');
  const canRecordPay = can(permissions, 'billing', 'record_payment');
  const canDelete = can(permissions, 'billing', 'delete');
  const showAccounting = enabledModules.accounting !== false;

  async function loadBilling() {
    setLoading(true);
    try {
      const [invRes, bankRes, tpRes, prodRes, finRes] = await Promise.all([
        apiRequest<{ invoices: Invoice[] }>('/api/invoices'),
        apiRequest<{ accounts: BankAccount[]; transactions: BankTransaction[] }>('/api/bank-accounts'),
        apiRequest<{ thirdParties: ThirdParty[] }>('/api/third-parties'),
        apiRequest<{ products: ProductItem[] }>('/api/products'),
        apiRequest<{
          sepaBatches: SepaBatch[];
          accounts: AccountingAccount[];
          journalEntries: JournalEntry[];
          donations: DonationItem[];
          loans: LoanItem[];
          marginStats: MarginStats;
          fixedAssets?: FixedAssetItem[];
          payrollRuns?: PayrollRunItem[];
          mileageClaims?: MileageClaimItem[];
          employees?: EmployeeBrief[];
          reports?: AccountingReports;
        }>('/api/finance-extensions'),
      ]);
      setInvoices(invRes.invoices);
      setAccounts(bankRes.accounts);
      setTransactions(bankRes.transactions);
      setThirdParties(tpRes.thirdParties);
      setProducts(prodRes.products);
      setSepaBatches(finRes.sepaBatches);
      setGlAccounts(finRes.accounts);
      setJournalEntries(finRes.journalEntries);
      setDonations(finRes.donations);
      setLoans(finRes.loans);
      if (finRes.marginStats) setMarginStats(finRes.marginStats);
      if (finRes.fixedAssets) setFixedAssets(finRes.fixedAssets);
      if (finRes.payrollRuns) setPayrollRuns(finRes.payrollRuns);
      if (finRes.mileageClaims) setMileageClaims(finRes.mileageClaims);
      if (finRes.employees) setEmployees(finRes.employees);
      if (finRes.reports) setReports(finRes.reports);

      if (bankRes.accounts[0]) {
        if (!payAccountId) setPayAccountId(String(bankRes.accounts[0].id));
        if (!sepaBankId) setSepaBankId(String(bankRes.accounts[0].id));
        if (!txAccountId) setTxAccountId(String(bankRes.accounts[0].id));
      }
      if (tpRes.thirdParties[0] && !invPartyId) setInvPartyId(String(tpRes.thirdParties[0].id));
      if (finRes.accounts.length >= 2) {
        if (!jrnDebit) setJrnDebit(finRes.accounts[0].code);
        if (!jrnCredit) setJrnCredit(finRes.accounts[1].code);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to load billing data.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBilling();
  }, []);

  useEffect(() => {
    if (!focusHint?.subTab) return;
    if (focusHint.subTab === 'customer_invoices' || focusHint.subTab === 'supplier_bills') {
      setTab(focusHint.subTab);
    }
  }, [focusHint?.ts]);

  function promptDelete(url: string, title: string, itemLabel: string, warning?: string) {
    setDeleteError('');
    setDeleteTarget({ url, title, itemLabel, warning });
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await apiRequest(deleteTarget.url, { method: 'DELETE' });
      onNotify(`${deleteTarget.itemLabel} deleted.`);
      setDeleteTarget(null);
      await loadBilling();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unable to delete record.');
    } finally {
      setDeleting(false);
    }
  }

  async function handleValidateInvoice(id: number) {
    try {
      await apiRequest(`/api/invoices/${id}/validate`, { method: 'POST', body: {} });
      onNotify('Document validated and ready for settlement.');
      await loadBilling();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Validation failed.', 'error');
    }
  }

  async function handleRecordPayment(e: FormEvent) {
    e.preventDefault();
    if (!paymentModal) return;
    try {
      await apiRequest(`/api/invoices/${paymentModal.id}/payments`, {
        method: 'POST',
        body: {
          bankAccountId: Number(payAccountId),
          amount: Number(payAmount),
          label: payLabel,
        },
      });
      setPaymentModal(null);
      setPayLabel('');
      onNotify('Payment recorded and bank ledger updated.');
      await loadBilling();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Payment failed.', 'error');
    }
  }

  function openSendInvoice(inv: Invoice) {
    const party = thirdParties.find((tp) => tp.id === inv.third_party_id);
    setSendModal(inv);
    setSendEmail(party?.email ?? '');
    setSendMessage(`Please find invoice ${inv.ref} for ${formatCurrency(inv.total_ttc)} due ${formatDate(inv.due_date)}.`);
  }

  async function handleSendInvoice(e: FormEvent) {
    e.preventDefault();
    if (!sendModal) return;
    setSendingInv(true);
    try {
      const res = await apiRequest<{ sentTo: string; paymentCode: string }>(
        `/api/invoices/${sendModal.id}/send`,
        {
          method: 'POST',
          body: { recipientEmail: sendEmail, message: sendMessage },
        }
      );
      onNotify(`Sent ${sendModal.ref} to ${res.sentTo} (Ref ${res.paymentCode}).`);
      setSendModal(null);
      await loadBilling();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to send invoice.', 'error');
    } finally {
      setSendingInv(false);
    }
  }

  function openCreateInvoice(type: 'customer' | 'supplier') {
    setEditingInvoice(null);
    setInvType(type);
    setInvKind('standard');
    setInvPartyId(thirdParties[0] ? String(thirdParties[0].id) : '');
    setInvIssueDate(new Date().toISOString().slice(0, 10));
    setInvDueDate(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
    setInvStatus('draft');
    const firstProd = products[0];
    setInvLines(
      firstProd
        ? [
            {
              productId: firstProd.id,
              ref: firstProd.ref,
              label: firstProd.name,
              qty: 1,
              unitPrice: type === 'supplier' ? firstProd.cost_price : firstProd.sell_price,
              discountPct: 0,
              taxRate: firstProd.tax_rate,
            },
          ]
        : [{ productId: null, ref: '', label: '', qty: 1, unitPrice: 0, discountPct: 0, taxRate: 20 }]
    );
    setInvNotes('');
    setInvoiceModal(true);
  }

  function openEditInvoice(inv: Invoice) {
    let parsed: DocumentLine[] = [];
    try {
      parsed = JSON.parse(inv.lines_json || '[]') as DocumentLine[];
    } catch {
      parsed = [];
    }
    setEditingInvoice(inv);
    setInvType(inv.invoice_type);
    setInvKind(inv.invoice_kind ?? 'standard');
    setInvPartyId(String(inv.third_party_id));
    setInvIssueDate(inv.issue_date);
    setInvDueDate(inv.due_date);
    setInvStatus(inv.status);
    setInvLines(
      parsed.length > 0
        ? parsed
        : [{ productId: null, ref: '', label: '', qty: 1, unitPrice: 0, discountPct: 0, taxRate: 20 }]
    );
    setInvNotes(inv.notes || '');
    setInvoiceModal(true);
  }

  function handleSelectInvLineProduct(idx: number, prodIdStr: string) {
    const prod = products.find((p) => p.id === Number(prodIdStr));
    setInvLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        if (!prod) return { ...l, productId: null };
        return {
          ...l,
          productId: prod.id,
          ref: prod.ref,
          label: prod.name,
          unitPrice: invType === 'supplier' ? prod.cost_price : prod.sell_price,
          taxRate: prod.tax_rate,
        };
      })
    );
  }

  async function handleSaveInvoice(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingInvoice) {
        await apiRequest(`/api/invoices/${editingInvoice.id}`, {
          method: 'PUT',
          body: {
            thirdPartyId: Number(invPartyId),
            issueDate: invIssueDate,
            dueDate: invDueDate,
            lines: invLines,
            notes: invNotes,
            status: editingInvoice.status !== 'paid' && editingInvoice.status !== 'partial' ? invStatus : undefined,
          },
        });
        onNotify(`${editingInvoice.ref} updated.`);
      } else {
        await apiRequest('/api/invoices', {
          method: 'POST',
          body: {
            invoiceType: invType,
            invoiceKind: invKind,
            thirdPartyId: Number(invPartyId),
            issueDate: invIssueDate,
            dueDate: invDueDate,
            lines: invLines,
            notes: invNotes,
          },
        });
        onNotify(`${invKind === 'credit_note' ? 'Credit note' : 'Draft invoice'} created.`);
      }
      setInvoiceModal(false);
      setEditingInvoice(null);
      setInvNotes('');
      await loadBilling();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save invoice.', 'error');
    }
  }

  function openCreateBank() {
    setEditingBank(null);
    setBRef('');
    setBName('');
    setBBank('');
    setBNumber('');
    setBType('checking');
    setBStatus('active');
    setBBalance('0');
    setBankModal(true);
  }

  function openEditBank(acc: BankAccount) {
    setEditingBank(acc);
    setBRef(acc.ref);
    setBName(acc.name);
    setBBank(acc.bank_name || '');
    setBNumber(acc.account_number || '');
    setBType(acc.account_type);
    setBStatus(acc.status);
    setBBalance(String(acc.balance));
    setBankModal(true);
  }

  async function handleSaveBankAccount(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingBank) {
        await apiRequest(`/api/bank-accounts/${editingBank.id}`, {
          method: 'PUT',
          body: {
            name: bName,
            bankName: bBank,
            accountNumber: bNumber,
            accountType: bType,
            status: bStatus,
          },
        });
        onNotify(`Treasury account ${editingBank.ref} updated.`);
      } else {
        await apiRequest('/api/bank-accounts', {
          method: 'POST',
          body: {
            ref: bRef,
            name: bName,
            bankName: bBank,
            accountNumber: bNumber,
            accountType: bType,
            initialBalance: Number(bBalance) || 0,
          },
        });
        onNotify('Treasury account added.');
      }
      setBankModal(false);
      setEditingBank(null);
      await loadBilling();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save account.', 'error');
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

  function openEditTx(tx: BankTransaction) {
    setEditingTx(tx);
    setTxAccountId(String(tx.bank_account_id));
    setTxDate(tx.tx_date);
    setTxLabel(tx.label);
    setTxCategory(tx.category || 'Operations');
    setTxAmount(String(tx.amount));
    setTxDirection(tx.direction);
    setTxModal(true);
  }

  async function handleSaveTx(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingTx) {
        await apiRequest(`/api/bank-transactions/${editingTx.id}`, {
          method: 'PUT',
          body: {
            txDate,
            label: txLabel,
            category: txCategory,
            amount: Number(txAmount),
            direction: txDirection,
          },
        });
        onNotify('Bank transaction updated and account balance recalculated.');
      } else {
        await apiRequest('/api/bank-transactions', {
          method: 'POST',
          body: {
            bankAccountId: Number(txAccountId),
            txDate,
            label: txLabel,
            category: txCategory,
            amount: Number(txAmount),
            direction: txDirection,
          },
        });
        onNotify('Bank transaction recorded.');
      }
      setTxModal(false);
      setEditingTx(null);
      await loadBilling();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save transaction.', 'error');
    }
  }

  function openCreateSepa() {
    setEditingSepa(null);
    setSepaType('credit_transfer');
    setSepaBankId(accounts[0] ? String(accounts[0].id) : '');
    setSepaExecDate(new Date().toISOString().slice(0, 10));
    setSepaParty('');
    setSepaIban('FR7630006000011234567890189');
    setSepaAmount('1200');
    setSepaInvRef('');
    setSepaStatus('prepared');
    setSepaModal(true);
  }

  function openEditSepa(b: SepaBatch) {
    let first = { partyName: '', iban: '', invoiceRef: '', amount: b.total_amount };
    try {
      const items = JSON.parse(b.items_json || '[]') as Array<typeof first>;
      if (items[0]) first = items[0];
    } catch {
      // keep default
    }
    setEditingSepa(b);
    setSepaType(b.batch_type);
    setSepaBankId(String(b.bank_account_id));
    setSepaExecDate(b.execution_date);
    setSepaParty(first.partyName || '');
    setSepaIban(first.iban || '');
    setSepaInvRef(first.invoiceRef || '');
    setSepaAmount(String(first.amount || b.total_amount));
    setSepaStatus(b.status);
    setSepaModal(true);
  }

  async function handleSaveSepa(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingSepa) {
        await apiRequest(`/api/sepa-batches/${editingSepa.id}`, {
          method: 'PUT',
          body: {
            batchType: sepaType,
            bankAccountId: Number(sepaBankId),
            executionDate: sepaExecDate,
            partyName: sepaParty,
            iban: sepaIban,
            invoiceRef: sepaInvRef,
            amount: Number(sepaAmount),
            status: sepaStatus,
          },
        });
        onNotify(`SEPA batch ${editingSepa.ref} updated.`);
      } else {
        await apiRequest('/api/sepa-batches', {
          method: 'POST',
          body: {
            batchType: sepaType,
            bankAccountId: Number(sepaBankId),
            executionDate: sepaExecDate,
            partyName: sepaParty,
            iban: sepaIban,
            invoiceRef: sepaInvRef,
            amount: Number(sepaAmount),
          },
        });
        onNotify('SEPA ISO 20022 batch prepared.');
      }
      setSepaModal(false);
      setEditingSepa(null);
      await loadBilling();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save SEPA batch.', 'error');
    }
  }

  async function handleViewSepaXml(id: number) {
    try {
      const res = await apiRequest<{ ref: string; xml: string }>(`/api/sepa-batches/${id}/xml`);
      setXmlPreview(res);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to generate SEPA XML.', 'error');
    }
  }

  function downloadXml(ref: string, xml: string) {
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${ref}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }

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

  async function handleSaveGlAccount(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingGl) {
        await apiRequest(`/api/accounting/accounts/${editingGl.id}`, {
          method: 'PUT',
          body: { label: glLabel, accountClass: glClass },
        });
        onNotify(`GL account ${editingGl.code} updated.`);
      } else {
        await apiRequest('/api/accounting/accounts', {
          method: 'POST',
          body: { code: glCode, label: glLabel, accountClass: glClass },
        });
        onNotify('Chart of Accounts entry added.');
      }
      setGlModal(false);
      setEditingGl(null);
      await loadBilling();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save GL account.', 'error');
    }
  }

  function openCreateJrn() {
    setEditingJrn(null);
    setJrnDate(new Date().toISOString().slice(0, 10));
    setJrnCode('GEN');
    setJrnDesc('');
    setJrnDebit(glAccounts[0]?.code ?? '');
    setJrnCredit(glAccounts[1]?.code ?? glAccounts[0]?.code ?? '');
    setJrnAmount('500');
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
    setJrnModal(true);
  }

  async function handleSaveJournal(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingJrn) {
        await apiRequest(`/api/accounting/journal/${editingJrn.id}`, {
          method: 'PUT',
          body: {
            entryDate: jrnDate,
            journalCode: jrnCode,
            description: jrnDesc,
            debitAccountCode: jrnDebit,
            creditAccountCode: jrnCredit,
            amount: Number(jrnAmount),
          },
        });
        onNotify(`Journal entry ${editingJrn.ref} updated and GL balances adjusted.`);
      } else {
        await apiRequest('/api/accounting/journal', {
          method: 'POST',
          body: {
            entryDate: jrnDate,
            journalCode: jrnCode,
            description: jrnDesc,
            debitAccountCode: jrnDebit,
            creditAccountCode: jrnCredit,
            amount: Number(jrnAmount),
          },
        });
        onNotify('Balanced double-entry journal posted.');
      }
      setJrnModal(false);
      setEditingJrn(null);
      await loadBilling();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Journal post failed.', 'error');
    }
  }

  function openCreateDon() {
    setEditingDon(null);
    setDonName('');
    setDonEmail('');
    setDonAmount('500');
    setDonDate(new Date().toISOString().slice(0, 10));
    setDonMode('Bank Transfer');
    setDonStatus('promised');
    setDonNotes('');
    setDonModal(true);
  }

  function openEditDon(d: DonationItem) {
    setEditingDon(d);
    setDonName(d.donor_name);
    setDonEmail(d.donor_email || '');
    setDonAmount(String(d.amount));
    setDonDate(d.donation_date);
    setDonMode(d.payment_mode || 'Bank Transfer');
    setDonStatus(d.status);
    setDonNotes(d.notes || '');
    setDonModal(true);
  }

  async function handleSaveDonation(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingDon) {
        await apiRequest(`/api/donations/${editingDon.id}`, {
          method: 'PUT',
          body: {
            donorName: donName,
            donorEmail: donEmail,
            amount: Number(donAmount),
            donationDate: donDate,
            paymentMode: donMode,
            status: donStatus,
            notes: donNotes,
          },
        });
        onNotify(`Donation ${editingDon.ref} updated.`);
      } else {
        await apiRequest('/api/donations', {
          method: 'POST',
          body: {
            donorName: donName,
            donorEmail: donEmail,
            amount: Number(donAmount),
            donationDate: donDate,
            paymentMode: donMode,
            notes: donNotes,
          },
        });
        onNotify('Donation pledge logged.');
      }
      setDonModal(false);
      setEditingDon(null);
      await loadBilling();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save donation.', 'error');
    }
  }

  async function handleReceiveDonation(id: number) {
    try {
      await apiRequest(`/api/donations/${id}/receive`, { method: 'POST', body: {} });
      onNotify('Donation marked as received.');
      await loadBilling();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Update failed.', 'error');
    }
  }

  function openCreateLoan() {
    setEditingLoan(null);
    setLoanLabel('');
    setLoanLender('');
    setLoanPrincipal('50000');
    setLoanRemaining('50000');
    setLoanRate('4.2');
    setLoanTerm('36');
    setLoanStartDate(new Date().toISOString().slice(0, 10));
    setLoanStatus('active');
    setLoanModal(true);
  }

  function openEditLoan(l: LoanItem) {
    setEditingLoan(l);
    setLoanLabel(l.label);
    setLoanLender(l.lender_name);
    setLoanPrincipal(String(l.principal_amount));
    setLoanRemaining(String(l.remaining_principal));
    setLoanRate(String(l.interest_rate));
    setLoanTerm(String(l.term_months));
    setLoanStartDate(l.start_date);
    setLoanStatus(l.status);
    setLoanModal(true);
  }

  async function handleSaveLoan(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingLoan) {
        await apiRequest(`/api/loans/${editingLoan.id}`, {
          method: 'PUT',
          body: {
            label: loanLabel,
            lenderName: loanLender,
            principalAmount: Number(loanPrincipal),
            remainingPrincipal: Number(loanRemaining),
            interestRate: Number(loanRate),
            termMonths: Number(loanTerm) || 12,
            startDate: loanStartDate,
            status: loanStatus,
          },
        });
        onNotify(`Loan ${editingLoan.ref} updated.`);
      } else {
        await apiRequest('/api/loans', {
          method: 'POST',
          body: {
            label: loanLabel,
            lenderName: loanLender,
            principalAmount: Number(loanPrincipal),
            interestRate: Number(loanRate),
            termMonths: Number(loanTerm) || 12,
            startDate: loanStartDate,
          },
        });
        onNotify('Loan schedule registered.');
      }
      setLoanModal(false);
      setEditingLoan(null);
      await loadBilling();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save loan.', 'error');
    }
  }

  async function handleRepayLoan(e: FormEvent) {
    e.preventDefault();
    if (!repayLoan) return;
    try {
      await apiRequest(`/api/loans/${repayLoan.id}/payment`, {
        method: 'POST',
        body: { amount: Number(repayAmt) },
      });
      setRepayLoan(null);
      onNotify('Loan principal repayment recorded.');
      await loadBilling();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Repayment failed.', 'error');
    }
  }

  const customerInvoices = invoices.filter((i) => i.invoice_type === 'customer');
  const supplierBills = invoices.filter((i) => i.invoice_type === 'supplier');
  const displayedInvoices = tab === 'customer_invoices' ? customerInvoices : supplierBills;
  const unreconciledCount = transactions.filter((t) => !t.reconciled).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-zinc-200/70 dark:bg-zinc-800 self-start">
          <button
            type="button"
            onClick={() => setTab('customer_invoices')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
              tab === 'customer_invoices'
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>Invoices ({customerInvoices.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('supplier_bills')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
              tab === 'supplier_bills'
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>Pay Bills ({supplierBills.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('treasury')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
              tab === 'treasury'
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <Landmark className="w-3.5 h-3.5" />
            <span>
              Bank & Reconcile ({unreconciledCount > 0 ? `${unreconciledCount} due` : accounts.length})
            </span>
          </button>
          {showAccounting && (
            <>
              <button
                type="button"
                onClick={() => setTab('reports')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'reports'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Reports</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('accounting')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'accounting'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Ledger ({glAccounts.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('fixed_assets')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'fixed_assets'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>Fixed Assets ({fixedAssets.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('payroll')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'payroll'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Payroll ({payrollRuns.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('mileage')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'mileage'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <Car className="w-3.5 h-3.5" />
                <span>Mileage ({mileageClaims.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('sepa')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'sepa'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                <span>SEPA ({sepaBatches.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('donations_loans')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'donations_loans'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <HeartHandshake className="w-3.5 h-3.5" />
                <span>Donations & Loans</span>
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={() => setAiOpen((prev) => !prev)}
            className={`px-3.5 py-2 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              aiOpen
                ? 'border-orange-700 bg-orange-50 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300'
                : 'border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-orange-700 dark:text-orange-400" />
            <span>AI Finance Partner</span>
          </button>

          {canWrite && (tab === 'customer_invoices' || tab === 'supplier_bills') && (
            <button
              type="button"
              onClick={() => openCreateInvoice(tab === 'supplier_bills' ? 'supplier' : 'customer')}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{tab === 'supplier_bills' ? 'New Bill / Credit Note' : 'New Invoice / Credit Note'}</span>
            </button>
          )}
          {tab === 'treasury' && (
            <>
              {canRecordPay && (
                <button
                  type="button"
                  onClick={openCreateTx}
                  disabled={accounts.length === 0}
                  className="px-3.5 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium disabled:opacity-50 whitespace-nowrap"
                >
                  + Record Statement Line
                </button>
              )}
              {canWrite && (
                <button
                  type="button"
                  onClick={openCreateBank}
                  className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Bank Account</span>
                </button>
              )}
            </>
          )}
          {canWrite && tab === 'sepa' && (
            <button
              type="button"
              onClick={openCreateSepa}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Prepare SEPA Batch</span>
            </button>
          )}
          {canWrite && tab === 'accounting' && (
            <>
              <button
                type="button"
                onClick={openCreateGl}
                className="px-3.5 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium whitespace-nowrap"
              >
                + GL Account
              </button>
              <button
                type="button"
                onClick={openCreateJrn}
                className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Post Journal Entry</span>
              </button>
            </>
          )}
          {canWrite && tab === 'donations_loans' && (
            <>
              <button
                type="button"
                onClick={openCreateDon}
                className="px-3.5 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium whitespace-nowrap"
              >
                + Log Donation
              </button>
              <button
                type="button"
                onClick={openCreateLoan}
                className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Register Loan</span>
              </button>
            </>
          )}
        </div>
      </div>

      {onNavigateModule && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs">
          <span className="text-zinc-500 font-medium">Connected Accounting Workflows:</span>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onNavigateModule('commerce', 'proposals')}
              className="text-zinc-700 dark:text-zinc-300 hover:text-orange-700 dark:hover:text-orange-400 font-medium whitespace-nowrap"
            >
              Send Quotes →
            </button>
            <button
              type="button"
              onClick={() => onNavigateModule('commerce', 'purchase_orders')}
              className="text-zinc-700 dark:text-zinc-300 hover:text-orange-700 dark:hover:text-orange-400 font-medium whitespace-nowrap"
            >
              Create Purchase Orders →
            </button>
            <button
              type="button"
              onClick={() => onNavigateModule('hr')}
              className="text-zinc-700 dark:text-zinc-300 hover:text-orange-700 dark:hover:text-orange-400 font-medium whitespace-nowrap"
            >
              Claim Expenses →
            </button>
            <button
              type="button"
              onClick={() => onNavigateModule('projects')}
              className="inline-flex items-center gap-1 text-zinc-700 dark:text-zinc-300 hover:text-orange-700 dark:hover:text-orange-400 font-medium whitespace-nowrap"
            >
              <FolderKanban className="w-3.5 h-3.5" />
              <span>Track Projects →</span>
            </button>
          </div>
        </div>
      )}

      <AiFinancePartnerPanel open={aiOpen} onClose={() => setAiOpen(false)} onNotify={onNotify} />

      {loading ? (
        <div className="p-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-center text-sm text-zinc-500">
          Loading financial ledger...
        </div>
      ) : tab === 'customer_invoices' || tab === 'supplier_bills' ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-xs text-zinc-500">
                  <th className="py-3 px-4 font-medium">Ref</th>
                  <th className="py-3 px-4 font-medium">Third Party</th>
                  <th className="py-3 px-4 font-medium">Issue · Due</th>
                  <th className="py-3 px-4 font-medium text-right">Total (TTC)</th>
                  <th className="py-3 px-4 font-medium text-right">Paid</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {displayedInvoices.map((inv) => {
                  const remaining = Math.max(0, Math.round((inv.total_ttc - inv.amount_paid) * 100) / 100);
                  return (
                    <tr key={inv.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <td className="py-3 px-4 font-mono text-xs font-medium text-orange-700 dark:text-orange-400">
                        {inv.ref}
                        {inv.invoice_kind === 'credit_note' && (
                          <span className="ml-1.5 text-[10px] text-amber-700 dark:text-amber-400">CR NOTE</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100 text-xs">{inv.party_name}</div>
                        {inv.source_ref && (
                          <div className="text-[11px] font-mono text-zinc-400">Source: {inv.source_ref}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-zinc-500">
                        {formatDate(inv.issue_date)} · {formatDate(inv.due_date)}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-right font-medium text-zinc-900 dark:text-zinc-100">
                        {formatCurrency(inv.total_ttc)}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-right text-zinc-600 dark:text-zinc-400">
                        {formatCurrency(inv.amount_paid)}
                      </td>
                      <td className="py-3 px-4">
                        <StatusText status={inv.status} />
                      </td>
                      <td className="py-3 px-4 text-right space-x-2.5 whitespace-nowrap">
                        {canValidate && inv.status === 'draft' && (
                          <button
                            type="button"
                            onClick={() => handleValidateInvoice(inv.id)}
                            className="text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline"
                          >
                            Validate
                          </button>
                        )}
                        {canWrite && inv.invoice_type === 'customer' && inv.status !== 'cancelled' && (
                          <button
                            type="button"
                            onClick={() => openSendInvoice(inv)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:text-orange-700 dark:hover:text-orange-400"
                          >
                            <Send className="w-3 h-3" />
                            <span>Send</span>
                          </button>
                        )}
                        {canRecordPay && (inv.status === 'validated' || inv.status === 'partial') && (
                          <button
                            type="button"
                            onClick={() => {
                              setPaymentModal(inv);
                              setPayAmount(String(remaining));
                            }}
                            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
                          >
                            <Wallet className="w-3.5 h-3.5" />
                            <span>{inv.invoice_type === 'supplier' ? 'Pay Bill' : 'Accept Payment'}</span>
                          </button>
                        )}
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => openEditInvoice(inv)}
                            title="Edit invoice"
                            aria-label={`Edit ${inv.ref}`}
                            className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center align-middle"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && inv.status !== 'paid' && inv.status !== 'partial' && (
                          <button
                            type="button"
                            onClick={() =>
                              promptDelete(
                                `/api/invoices/${inv.id}`,
                                'Delete Invoice / Bill',
                                inv.ref,
                                `Remove ${inv.ref} (${inv.party_name}) permanently.`
                              )
                            }
                            title="Delete invoice"
                            aria-label={`Delete ${inv.ref}`}
                            className="text-zinc-400 hover:text-red-600 inline-flex items-center align-middle"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === 'treasury' ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {accounts.map((acc) => (
              <div
                key={acc.id}
                className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-orange-700 dark:text-orange-400">{acc.ref}</span>
                  <div className="flex items-center gap-2">
                    <span className="capitalize text-zinc-500">{acc.account_type}</span>
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => openEditBank(acc)}
                        title="Edit bank account"
                        aria-label={`Edit ${acc.name}`}
                        className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() =>
                          promptDelete(
                            `/api/bank-accounts/${acc.id}`,
                            'Delete Bank Account',
                            `${acc.ref} — ${acc.name}`,
                            'Accounts with existing ledger transactions or SEPA batches cannot be deleted.'
                          )
                        }
                        title="Delete bank account"
                        aria-label={`Delete ${acc.name}`}
                        className="text-zinc-400 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{acc.name}</div>
                  {acc.status === 'closed' && <StatusText status={acc.status} />}
                </div>
                <div className="text-xs text-zinc-500">
                  {acc.bank_name || 'Treasury'} {acc.account_number ? `· ${acc.account_number}` : ''}
                </div>
                <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800 text-xl font-mono tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                  {formatCurrency(acc.balance, acc.currency)}
                </div>
              </div>
            ))}
          </div>

          <BankReconciliationPanel
            accounts={accounts}
            transactions={transactions}
            invoices={invoices}
            glAccounts={glAccounts}
            canRecordPay={canRecordPay}
            canDelete={canDelete}
            onEditTx={openEditTx}
            onPromptDeleteTx={(tx) =>
              promptDelete(
                `/api/bank-transactions/${tx.id}`,
                'Delete Bank Transaction',
                tx.label,
                'Deleting this entry automatically reverses its cash impact on the linked bank account.'
              )
            }
            onReload={loadBilling}
            onNotify={onNotify}
          />
        </div>
      ) : tab === 'sepa' ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-xs text-zinc-500">
                  <th className="py-3 px-4 font-medium">Batch Ref</th>
                  <th className="py-3 px-4 font-medium">Type</th>
                  <th className="py-3 px-4 font-medium">Bank Account</th>
                  <th className="py-3 px-4 font-medium">Execution Date</th>
                  <th className="py-3 px-4 font-medium text-right">Total</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {sepaBatches.map((b) => (
                  <tr key={b.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="py-3 px-4 font-mono text-xs font-medium text-orange-700 dark:text-orange-400">
                      {b.ref}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      {b.batch_type === 'direct_debit' ? 'SEPA Direct Debit (pain.008)' : 'SEPA Credit Transfer (pain.001)'}
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-600 dark:text-zinc-400">
                      {b.bank_ref} · {b.bank_name}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-zinc-500">{formatDate(b.execution_date)}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-right font-medium">
                      {formatCurrency(b.total_amount)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusText status={b.status} />
                    </td>
                    <td className="py-3 px-4 text-right space-x-2.5 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleViewSepaXml(b.id)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>XML</span>
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
                          onClick={() =>
                            promptDelete('/api/sepa-batches/' + b.id, 'Delete SEPA Batch', b.ref)
                          }
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
      ) : tab === 'accounting' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Chart of Accounts (GL)</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-2.5 px-4 font-medium">Code</th>
                    <th className="py-2.5 px-4 font-medium">Account Label</th>
                    <th className="py-2.5 px-4 font-medium">Class</th>
                    <th className="py-2.5 px-4 font-medium text-right">Balance</th>
                    <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {glAccounts.map((a) => (
                    <tr key={a.id}>
                      <td className="py-2.5 px-4 font-mono font-medium text-orange-700 dark:text-orange-400">{a.code}</td>
                      <td className="py-2.5 px-4 font-medium text-zinc-900 dark:text-zinc-100">{a.label}</td>
                      <td className="py-2.5 px-4 capitalize text-zinc-500">{a.account_class}</td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-right font-medium">
                        {formatCurrency(a.balance)}
                      </td>
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
                              promptDelete(
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
                        <div className="text-[11px] font-mono text-zinc-400">{j.journal_code}</div>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px]">
                        <div>DR {j.debit_account_code}</div>
                        <div className="text-zinc-500">CR {j.credit_account_code}</div>
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-right font-semibold">
                        {formatCurrency(j.amount)}
                      </td>
                      <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
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
                              promptDelete(
                                `/api/accounting/journal/${j.id}`,
                                'Delete Journal Entry',
                                j.ref,
                                'Deleting this entry reverses its debit and credit impact on GL account balances.'
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
      ) : tab === 'donations_loans' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Donations & Grants</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-2.5 px-4 font-medium">Ref</th>
                    <th className="py-2.5 px-4 font-medium">Donor</th>
                    <th className="py-2.5 px-4 font-medium text-right">Amount</th>
                    <th className="py-2.5 px-4 font-medium">Status</th>
                    <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {donations.map((d) => (
                    <tr key={d.id}>
                      <td className="py-2.5 px-4 font-mono text-orange-700 dark:text-orange-400">{d.ref}</td>
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">{d.donor_name}</div>
                        <div className="text-[11px] text-zinc-500">{d.donor_email}</div>
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-right font-medium">
                        {formatCurrency(d.amount)}
                      </td>
                      <td className="py-2.5 px-4">
                        <StatusText status={d.status} />
                      </td>
                      <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
                        {canRecordPay && d.status === 'promised' && (
                          <button
                            type="button"
                            onClick={() => handleReceiveDonation(d.id)}
                            className="font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
                          >
                            Mark Received
                          </button>
                        )}
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => openEditDon(d)}
                            title="Edit donation"
                            aria-label={`Edit ${d.ref}`}
                            className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center align-middle"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() =>
                              promptDelete(`/api/donations/${d.id}`, 'Delete Donation', `${d.ref} — ${d.donor_name}`)
                            }
                            title="Delete donation"
                            aria-label={`Delete ${d.ref}`}
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
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Loans & Credit Facilities</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-2.5 px-4 font-medium">Loan</th>
                    <th className="py-2.5 px-4 font-medium">Rate</th>
                    <th className="py-2.5 px-4 font-medium text-right">Remaining</th>
                    <th className="py-2.5 px-4 font-medium">Status</th>
                    <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {loans.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">{l.label}</div>
                        <div className="font-mono text-[11px] text-zinc-500">
                          {l.ref} · {l.lender_name}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 font-mono">{l.interest_rate}%</td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-right font-medium">
                        {formatCurrency(l.remaining_principal)}
                      </td>
                      <td className="py-2.5 px-4">
                        <StatusText status={l.status} />
                      </td>
                      <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
                        {canRecordPay && l.status === 'active' && (
                          <button
                            type="button"
                            onClick={() => {
                              setRepayLoan(l);
                              setRepayAmt(String(Math.min(1500, l.remaining_principal)));
                            }}
                            className="font-medium text-orange-700 dark:text-orange-400 hover:underline"
                          >
                            Record Payment
                          </button>
                        )}
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => openEditLoan(l)}
                            title="Edit loan"
                            aria-label={`Edit ${l.ref}`}
                            className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center align-middle"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() =>
                              promptDelete(`/api/loans/${l.id}`, 'Delete Loan Facility', `${l.ref} — ${l.label}`)
                            }
                            title="Delete loan"
                            aria-label={`Delete ${l.ref}`}
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
      ) : tab === 'reports' ? (
        <FinancialReportsPanel reports={reports} marginStats={marginStats} onNotify={onNotify} />
      ) : tab === 'fixed_assets' ? (
        <FixedAssetsPanel
          assets={fixedAssets}
          canWrite={canWrite}
          canDelete={canDelete}
          onPromptDelete={promptDelete}
          onReload={loadBilling}
          onNotify={onNotify}
        />
      ) : tab === 'payroll' ? (
        <PayrollPanel
          runs={payrollRuns}
          employees={employees}
          accounts={accounts}
          canWrite={canWrite}
          canRecordPay={canRecordPay}
          canDelete={canDelete}
          onPromptDelete={promptDelete}
          onReload={loadBilling}
          onNotify={onNotify}
        />
      ) : (
        <MileagePanel
          claims={mileageClaims}
          employees={employees}
          accounts={accounts}
          canWrite={canWrite}
          canRecordPay={canRecordPay}
          canDelete={canDelete}
          onPromptDelete={promptDelete}
          onReload={loadBilling}
          onNotify={onNotify}
        />
      )}

      {/* Record Payment Modal */}
      <Modal
        open={Boolean(paymentModal)}
        onClose={() => setPaymentModal(null)}
        title={paymentModal ? `Record Payment — ${paymentModal.ref}` : ''}
        subtitle={paymentModal ? `${paymentModal.party_name} · Total ${formatCurrency(paymentModal.total_ttc)}` : ''}
      >
        {paymentModal && (
          <form onSubmit={handleRecordPayment} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Bank / Treasury Account
              </label>
              <select
                required
                value={payAccountId}
                onChange={(e) => setPayAccountId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.ref} — {a.name} ({formatCurrency(a.balance)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Payment Amount (USD)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Payment Memo / Wire Reference
              </label>
              <input
                type="text"
                value={payLabel}
                onChange={(e) => setPayLabel(e.target.value)}
                placeholder="e.g. Wire transfer #ACH-9921"
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPaymentModal(null)}
                className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
              >
                Post Payment
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Create / Edit Invoice Modal */}
      <Modal
        open={invoiceModal}
        onClose={() => {
          setInvoiceModal(false);
          setEditingInvoice(null);
        }}
        title={
          editingInvoice
            ? `Edit ${editingInvoice.ref}`
            : invType === 'supplier'
              ? 'New Supplier Bill / Credit Note'
              : 'New Customer Invoice / Credit Note'
        }
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleSaveInvoice} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Document Kind</label>
              <select
                disabled={Boolean(editingInvoice)}
                value={invKind}
                onChange={(e) => setInvKind(e.target.value as 'standard' | 'credit_note')}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-60"
              >
                <option value="standard">Standard Invoice</option>
                <option value="credit_note">Credit Note</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Third Party</label>
              <select
                required
                disabled={Boolean(editingInvoice && editingInvoice.status !== 'draft')}
                value={invPartyId}
                onChange={(e) => setInvPartyId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-60"
              >
                {thirdParties.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.ref} — {tp.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Issue Date</label>
              <input
                type="date"
                required
                disabled={Boolean(editingInvoice && editingInvoice.status !== 'draft')}
                value={invIssueDate}
                onChange={(e) => setInvIssueDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Due Date</label>
              <input
                type="date"
                required
                value={invDueDate}
                onChange={(e) => setInvDueDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            {editingInvoice && editingInvoice.status !== 'paid' && editingInvoice.status !== 'partial' && (
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Status</label>
                <select
                  value={invStatus}
                  onChange={(e) => setInvStatus(e.target.value as Invoice['status'])}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  <option value="draft">Draft</option>
                  <option value="validated">Validated</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Line Items</span>
              {(!editingInvoice || editingInvoice.status === 'draft') && (
                <button
                  type="button"
                  onClick={() =>
                    setInvLines((prev) => [
                      ...prev,
                      { productId: null, ref: '', label: '', qty: 1, unitPrice: 0, discountPct: 0, taxRate: 20 },
                    ])
                  }
                  className="text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline"
                >
                  + Add Line
                </button>
              )}
            </div>
            {editingInvoice && editingInvoice.status !== 'draft' && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                Line items and party are locked after validation; you can still update due date, status, and notes.
              </p>
            )}
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {invLines.map((line, idx) => {
                const locked = Boolean(editingInvoice && editingInvoice.status !== 'draft');
                return (
                  <div
                    key={idx}
                    className="grid grid-cols-12 gap-2 items-end p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/50"
                  >
                    <div className="col-span-5">
                      <label className="block text-[11px] text-zinc-500 mb-1">Product / Label</label>
                      <select
                        disabled={locked}
                        value={line.productId ?? ''}
                        onChange={(e) => handleSelectInvLineProduct(idx, e.target.value)}
                        className="w-full px-2 py-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 mb-1 disabled:opacity-60"
                      >
                        <option value="">Custom Item</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.ref} — {p.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        required
                        disabled={locked}
                        value={line.label}
                        onChange={(e) =>
                          setInvLines((prev) => prev.map((l, i) => (i === idx ? { ...l, label: e.target.value } : l)))
                        }
                        placeholder="Line description"
                        className="w-full px-2 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-60"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[11px] text-zinc-500 mb-1">Qty</label>
                      <input
                        type="number"
                        min={1}
                        required
                        disabled={locked}
                        value={line.qty}
                        onChange={(e) =>
                          setInvLines((prev) =>
                            prev.map((l, i) => (i === idx ? { ...l, qty: Number(e.target.value) || 1 } : l))
                          )
                        }
                        className="w-full px-2 py-1.5 text-xs font-mono rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-60"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[11px] text-zinc-500 mb-1">Unit Price</label>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        required
                        disabled={locked}
                        value={line.unitPrice}
                        onChange={(e) =>
                          setInvLines((prev) =>
                            prev.map((l, i) => (i === idx ? { ...l, unitPrice: Number(e.target.value) || 0 } : l))
                          )
                        }
                        className="w-full px-2 py-1.5 text-xs font-mono rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-60"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[11px] text-zinc-500 mb-1">VAT %</label>
                      <input
                        type="number"
                        step="0.5"
                        min={0}
                        disabled={locked}
                        value={line.taxRate}
                        onChange={(e) =>
                          setInvLines((prev) =>
                            prev.map((l, i) => (i === idx ? { ...l, taxRate: Number(e.target.value) || 0 } : l))
                          )
                        }
                        className="w-full px-2 py-1.5 text-xs font-mono rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-60"
                      />
                    </div>
                    <div className="col-span-1 text-right">
                      {!locked && invLines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setInvLines((prev) => prev.filter((_, i) => i !== idx))}
                          className="p-1 text-zinc-400 hover:text-red-600"
                          aria-label="Remove line"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Notes</label>
            <input
              type="text"
              value={invNotes}
              onChange={(e) => setInvNotes(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setInvoiceModal(false);
                setEditingInvoice(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              {editingInvoice ? 'Save Changes' : 'Create Draft'}
            </button>
          </div>
        </form>
      </Modal>

      {/* New / Edit Bank Account Modal */}
      <Modal
        open={bankModal}
        onClose={() => {
          setBankModal(false);
          setEditingBank(null);
        }}
        title={editingBank ? `Edit Account — ${editingBank.ref}` : 'New Bank or Cash Account'}
      >
        <form onSubmit={handleSaveBankAccount} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Ref</label>
              <input
                type="text"
                required
                disabled={Boolean(editingBank)}
                value={bRef}
                onChange={(e) => setBRef(e.target.value)}
                placeholder="BNK-EU"
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Type</label>
              <select
                value={bType}
                onChange={(e) => setBType(e.target.value as typeof bType)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
                <option value="cash">Petty Cash</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Account Label</label>
            <input
              type="text"
              required
              value={bName}
              onChange={(e) => setBName(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Institution</label>
              <input
                type="text"
                value={bBank}
                onChange={(e) => setBBank(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Account Number / IBAN</label>
              <input
                type="text"
                value={bNumber}
                onChange={(e) => setBNumber(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          {editingBank ? (
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Status</label>
              <select
                value={bStatus}
                onChange={(e) => setBStatus(e.target.value as 'active' | 'closed')}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="active">Active</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Opening Balance</label>
              <input
                type="number"
                step="0.01"
                value={bBalance}
                onChange={(e) => setBBalance(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setBankModal(false);
                setEditingBank(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              {editingBank ? 'Save Changes' : 'Add Account'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Bank Transaction Create / Edit Modal */}
      <Modal
        open={txModal}
        onClose={() => {
          setTxModal(false);
          setEditingTx(null);
        }}
        title={editingTx ? `Edit Treasury Entry — TX-${editingTx.id}` : 'Record Manual Bank Entry'}
      >
        <form onSubmit={handleSaveTx} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Bank Account</label>
              <select
                required
                disabled={Boolean(editingTx)}
                value={txAccountId}
                onChange={(e) => setTxAccountId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-60"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.ref} — {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Direction</label>
              <select
                value={txDirection}
                onChange={(e) => setTxDirection(e.target.value as 'credit' | 'debit')}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="credit">Credit (+ Inflow)</option>
                <option value="debit">Debit (- Outflow)</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Date</label>
              <input
                type="date"
                required
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Amount</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={txAmount}
                onChange={(e) => setTxAmount(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Description</label>
              <input
                type="text"
                required
                value={txLabel}
                onChange={(e) => setTxLabel(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Category</label>
              <input
                type="text"
                value={txCategory}
                onChange={(e) => setTxCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setTxModal(false);
                setEditingTx(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              {editingTx ? 'Save Changes' : 'Record Entry'}
            </button>
          </div>
        </form>
      </Modal>

      {/* SEPA Modal */}
      <Modal
        open={sepaModal}
        onClose={() => {
          setSepaModal(false);
          setEditingSepa(null);
        }}
        title={editingSepa ? `Edit SEPA Batch — ${editingSepa.ref}` : 'Prepare SEPA ISO 20022 Batch'}
      >
        <form onSubmit={handleSaveSepa} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Order Type</label>
              <select
                value={sepaType}
                onChange={(e) => setSepaType(e.target.value as typeof sepaType)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="credit_transfer">Credit Transfer (pain.001)</option>
                <option value="direct_debit">Direct Debit (pain.008)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Bank Account</label>
              <select
                required
                value={sepaBankId}
                onChange={(e) => setSepaBankId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.ref} — {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Counterparty Name
              </label>
              <input
                type="text"
                required
                value={sepaParty}
                onChange={(e) => setSepaParty(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">IBAN</label>
              <input
                type="text"
                required
                value={sepaIban}
                onChange={(e) => setSepaIban(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Amount</label>
              <input
                type="number"
                step="0.01"
                required
                value={sepaAmount}
                onChange={(e) => setSepaAmount(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Execution Date</label>
              <input
                type="date"
                required
                value={sepaExecDate}
                onChange={(e) => setSepaExecDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Invoice Ref
              </label>
              <input
                type="text"
                value={sepaInvRef}
                onChange={(e) => setSepaInvRef(e.target.value)}
                placeholder="Optional"
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          {editingSepa && (
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Status</label>
              <select
                value={sepaStatus}
                onChange={(e) => setSepaStatus(e.target.value as SepaBatch['status'])}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="prepared">Prepared</option>
                <option value="transmitted">Transmitted</option>
                <option value="settled">Settled</option>
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setSepaModal(false);
                setEditingSepa(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              {editingSepa ? 'Save Changes' : 'Prepare Batch'}
            </button>
          </div>
        </form>
      </Modal>

      {/* SEPA XML Preview Modal */}
      <Modal
        open={Boolean(xmlPreview)}
        onClose={() => setXmlPreview(null)}
        title={xmlPreview ? `ISO 20022 SEPA XML — ${xmlPreview.ref}` : ''}
        maxWidthClass="max-w-2xl"
      >
        {xmlPreview && (
          <div className="space-y-4">
            <pre className="p-3 rounded-lg bg-zinc-950 text-zinc-100 text-[11px] font-mono overflow-x-auto max-h-80">
              {xmlPreview.xml}
            </pre>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setXmlPreview(null)}
                className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => downloadXml(xmlPreview.ref, xmlPreview.xml)}
                className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download .xml</span>
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* GL Account Modal */}
      <Modal
        open={glModal}
        onClose={() => {
          setGlModal(false);
          setEditingGl(null);
        }}
        title={editingGl ? `Edit GL Account — ${editingGl.code}` : 'Add Chart of Accounts Entry'}
      >
        <form onSubmit={handleSaveGlAccount} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Account Code</label>
              <input
                type="text"
                required
                disabled={Boolean(editingGl)}
                value={glCode}
                onChange={(e) => setGlCode(e.target.value)}
                placeholder="6250"
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Class</label>
              <select
                value={glClass}
                onChange={(e) => setGlClass(e.target.value as AccountingAccount['account_class'])}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="asset">Asset</option>
                <option value="liability">Liability</option>
                <option value="equity">Equity</option>
                <option value="revenue">Revenue</option>
                <option value="expense">Expense</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Label</label>
            <input
              type="text"
              required
              value={glLabel}
              onChange={(e) => setGlLabel(e.target.value)}
              placeholder="Cloud Infrastructure Expense"
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setGlModal(false);
                setEditingGl(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              {editingGl ? 'Save Changes' : 'Create GL Account'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Journal Entry Modal */}
      <Modal
        open={jrnModal}
        onClose={() => {
          setJrnModal(false);
          setEditingJrn(null);
        }}
        title={editingJrn ? `Edit Journal Entry — ${editingJrn.ref}` : 'Post Balanced Journal Entry'}
      >
        <form onSubmit={handleSaveJournal} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Journal</label>
              <input
                type="text"
                required
                value={jrnCode}
                onChange={(e) => setJrnCode(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Entry Date</label>
              <input
                type="date"
                required
                value={jrnDate}
                onChange={(e) => setJrnDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Amount</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={jrnAmount}
                onChange={(e) => setJrnAmount(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Description</label>
            <input
              type="text"
              required
              value={jrnDesc}
              onChange={(e) => setJrnDesc(e.target.value)}
              placeholder="e.g. Monthly depreciation accrual"
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Debit Account</label>
              <select
                value={jrnDebit}
                onChange={(e) => setJrnDebit(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                {glAccounts.map((a) => (
                  <option key={a.id} value={a.code}>
                    {a.code} — {a.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Credit Account
              </label>
              <select
                value={jrnCredit}
                onChange={(e) => setJrnCredit(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                {glAccounts.map((a) => (
                  <option key={a.id} value={a.code}>
                    {a.code} — {a.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setJrnModal(false);
                setEditingJrn(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              {editingJrn ? 'Save Changes' : 'Post Entry'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Donation Modal */}
      <Modal
        open={donModal}
        onClose={() => {
          setDonModal(false);
          setEditingDon(null);
        }}
        title={editingDon ? `Edit Donation — ${editingDon.ref}` : 'Log Donation Pledge'}
      >
        <form onSubmit={handleSaveDonation} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Donor Name</label>
            <input
              type="text"
              required
              value={donName}
              onChange={(e) => setDonName(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Email</label>
              <input
                type="email"
                value={donEmail}
                onChange={(e) => setDonEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Amount</label>
              <input
                type="number"
                step="0.01"
                required
                value={donAmount}
                onChange={(e) => setDonAmount(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Date</label>
              <input
                type="date"
                value={donDate}
                onChange={(e) => setDonDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Payment Mode</label>
              <input
                type="text"
                value={donMode}
                onChange={(e) => setDonMode(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          {editingDon && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Status</label>
                <select
                  value={donStatus}
                  onChange={(e) => setDonStatus(e.target.value as DonationItem['status'])}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  <option value="promised">Promised</option>
                  <option value="received">Received</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Notes</label>
                <input
                  type="text"
                  value={donNotes}
                  onChange={(e) => setDonNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setDonModal(false);
                setEditingDon(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              {editingDon ? 'Save Changes' : 'Save Pledge'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Loan Modal */}
      <Modal
        open={loanModal}
        onClose={() => {
          setLoanModal(false);
          setEditingLoan(null);
        }}
        title={editingLoan ? `Edit Loan — ${editingLoan.ref}` : 'Register Loan Facility'}
      >
        <form onSubmit={handleSaveLoan} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Facility Label</label>
              <input
                type="text"
                required
                value={loanLabel}
                onChange={(e) => setLoanLabel(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Lender</label>
              <input
                type="text"
                required
                value={loanLender}
                onChange={(e) => setLoanLender(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Principal</label>
              <input
                type="number"
                step="0.01"
                required
                value={loanPrincipal}
                onChange={(e) => setLoanPrincipal(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Interest Rate (%)
              </label>
              <input
                type="number"
                step="0.1"
                value={loanRate}
                onChange={(e) => setLoanRate(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Term (Months)</label>
              <input
                type="number"
                min="1"
                value={loanTerm}
                onChange={(e) => setLoanTerm(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Start Date</label>
              <input
                type="date"
                value={loanStartDate}
                onChange={(e) => setLoanStartDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          {editingLoan && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Remaining Principal
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={loanRemaining}
                  onChange={(e) => setLoanRemaining(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Status</label>
                <select
                  value={loanStatus}
                  onChange={(e) => setLoanStatus(e.target.value as LoanItem['status'])}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  <option value="active">Active</option>
                  <option value="paid_off">Paid Off</option>
                </select>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setLoanModal(false);
                setEditingLoan(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              {editingLoan ? 'Save Changes' : 'Register Loan'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Loan Repayment Modal */}
      <Modal
        open={Boolean(repayLoan)}
        onClose={() => setRepayLoan(null)}
        title={repayLoan ? `Principal Repayment — ${repayLoan.ref}` : ''}
      >
        <form onSubmit={handleRepayLoan} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Repayment Amount
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              value={repayAmt}
              onChange={(e) => setRepayAmt(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRepayLoan(null)}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium"
            >
              Apply Payment
            </button>
          </div>
        </form>
      </Modal>

      {/* Send Invoice Modal */}
      <Modal
        open={Boolean(sendModal)}
        onClose={() => setSendModal(null)}
        title={sendModal ? `Send Invoice — ${sendModal.ref}` : ''}
        subtitle={
          sendModal
            ? `${sendModal.party_name} · Amount Due ${formatCurrency(Math.max(0, sendModal.total_ttc - sendModal.amount_paid))}`
            : ''
        }
      >
        {sendModal && (
          <form onSubmit={handleSendInvoice} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Recipient Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={sendEmail}
                  onChange={(e) => setSendEmail(e.target.value)}
                  placeholder="billing@customer.example"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Message & Payment Instructions
              </label>
              <textarea
                rows={3}
                value={sendMessage}
                onChange={(e) => setSendMessage(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSendModal(null)}
                className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={sendingInv}
                className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{sendingInv ? 'Sending...' : 'Send Invoice'}</span>
              </button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title={deleteTarget?.title ?? ''}
        itemLabel={deleteTarget?.itemLabel ?? ''}
        warning={deleteTarget?.warning}
        loading={deleting}
        error={deleteError}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError('');
        }}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

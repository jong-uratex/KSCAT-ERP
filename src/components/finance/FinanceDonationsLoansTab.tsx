import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import type { DonationItem, LoanItem } from '../../types/erp';
import { Modal } from '../Modal';
import { StatusText } from '../StatusText';

interface FinanceDonationsLoansTabProps {
  donations: DonationItem[];
  loans: LoanItem[];
  canWrite: boolean;
  canRecordPay: boolean;
  canDelete: boolean;
  onReload: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPromptDelete: (url: string, title: string, itemLabel: string, warning?: string) => void;
}

export function FinanceDonationsLoansTab({
  donations,
  loans,
  canWrite,
  canRecordPay,
  canDelete,
  onReload,
  onNotify,
  onPromptDelete,
}: FinanceDonationsLoansTabProps) {
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
    setDonEmail(d.donor_email);
    setDonAmount(String(d.amount));
    setDonDate(d.donation_date);
    setDonMode(d.payment_mode);
    setDonStatus(d.status);
    setDonNotes(d.notes);
    setDonModal(true);
  }

  async function handleSaveDon(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        donorName: donName,
        donorEmail: donEmail,
        amount: Number(donAmount),
        donationDate: donDate,
        paymentMode: donMode,
        status: donStatus,
        notes: donNotes,
      };
      if (editingDon) {
        await apiRequest(`/api/donations/${editingDon.id}`, { method: 'PUT', body: payload });
        onNotify(`Donation ${editingDon.ref} updated.`);
      } else {
        await apiRequest('/api/donations', { method: 'POST', body: payload });
        onNotify('Donation recorded.');
      }
      setDonModal(false);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save donation.', 'error');
    }
  }

  async function handleReceiveDonation(id: number) {
    try {
      await apiRequest(`/api/donations/${id}/receive`, { method: 'POST', body: {} });
      onNotify('Donation marked as received.');
      await onReload();
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
      const payload = {
        label: loanLabel,
        lenderName: loanLender,
        principalAmount: Number(loanPrincipal),
        remainingPrincipal: Number(loanRemaining),
        interestRate: Number(loanRate),
        termMonths: Number(loanTerm),
        startDate: loanStartDate,
        status: loanStatus,
      };
      if (editingLoan) {
        await apiRequest(`/api/loans/${editingLoan.id}`, { method: 'PUT', body: payload });
        onNotify(`Loan ${editingLoan.ref} updated.`);
      } else {
        await apiRequest('/api/loans', { method: 'POST', body: payload });
        onNotify('Loan facility recorded.');
      }
      setLoanModal(false);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save loan.', 'error');
    }
  }

  async function handleRepayLoan(e: FormEvent) {
    e.preventDefault();
    if (!repayLoan) return;
    try {
      await apiRequest(`/api/loans/${repayLoan.id}/payment`, { method: 'POST', body: { amount: Number(repayAmt) } });
      onNotify(`Principal repayment posted on ${repayLoan.ref}.`);
      setRepayLoan(null);
      await onReload();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Repayment failed.', 'error');
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Donations &amp; Grants</h3>
            {canWrite && (
              <button
                type="button"
                onClick={openCreateDon}
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Grant</span>
              </button>
            )}
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
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right font-medium">{formatCurrency(d.amount)}</td>
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
                          onClick={() => onPromptDelete(`/api/donations/${d.id}`, 'Delete Donation', `${d.ref} — ${d.donor_name}`)}
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
          <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Loans &amp; Credit Facilities</h3>
            {canWrite && (
              <button
                type="button"
                onClick={openCreateLoan}
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Loan</span>
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-zinc-500">
                  <th className="py-2.5 px-4 font-medium">Facility</th>
                  <th className="py-2.5 px-4 font-medium text-right">Remaining</th>
                  <th className="py-2.5 px-4 font-medium text-right">APR</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {loans.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2.5 px-4">
                      <div className="font-mono text-orange-700 dark:text-orange-400 font-medium">{l.ref}</div>
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{l.label}</div>
                      <div className="text-[11px] text-zinc-500">{l.lender_name}</div>
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right font-semibold">
                      {formatCurrency(l.remaining_principal)}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right">{l.interest_rate}%</td>
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
                          className="font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
                        >
                          Repay
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
                          onClick={() => onPromptDelete(`/api/loans/${l.id}`, 'Delete Loan', `${l.ref} — ${l.label}`)}
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

      {/* Modals */}
      <Modal open={donModal} onClose={() => setDonModal(false)} title={editingDon ? `Edit ${editingDon.ref}` : 'Record Donation / Grant'} maxWidthClass="max-w-md">
        <form onSubmit={handleSaveDon} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Donor / Foundation</label>
            <input type="text" value={donName} onChange={(e) => setDonName(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Email</label>
              <input type="email" value={donEmail} onChange={(e) => setDonEmail(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Amount ($)</label>
              <input type="number" step="0.01" min="0.01" value={donAmount} onChange={(e) => setDonAmount(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Date</label>
              <input type="date" value={donDate} onChange={(e) => setDonDate(e.target.value)} className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Payment Mode</label>
              <input type="text" value={donMode} onChange={(e) => setDonMode(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
            </div>
          </div>
          {editingDon && (
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Status</label>
              <select value={donStatus} onChange={(e) => setDonStatus(e.target.value as DonationItem['status'])} className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs">
                <option value="promised">Promised</option>
                <option value="received">Received</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setDonModal(false)} className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs">Cancel</button>
            <button type="submit" className="h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">Save Grant</button>
          </div>
        </form>
      </Modal>

      <Modal open={loanModal} onClose={() => setLoanModal(false)} title={editingLoan ? `Edit ${editingLoan.ref}` : 'New Credit Facility'} maxWidthClass="max-w-md">
        <form onSubmit={handleSaveLoan} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Facility Label</label>
            <input type="text" value={loanLabel} onChange={(e) => setLoanLabel(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Lender</label>
            <input type="text" value={loanLender} onChange={(e) => setLoanLender(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Principal ($)</label>
              <input type="number" step="0.01" min="1" value={loanPrincipal} onChange={(e) => setLoanPrincipal(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Remaining ($)</label>
              <input type="number" step="0.01" min="0" value={loanRemaining} onChange={(e) => setLoanRemaining(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">APR (%)</label>
              <input type="number" step="0.05" value={loanRate} onChange={(e) => setLoanRate(e.target.value)} className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Term (Mos)</label>
              <input type="number" min="1" value={loanTerm} onChange={(e) => setLoanTerm(e.target.value)} className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Start Date</label>
              <input type="date" value={loanStartDate} onChange={(e) => setLoanStartDate(e.target.value)} className="w-full h-9 px-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs" />
            </div>
          </div>
          {editingLoan && (
            <div>
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Status</label>
              <select value={loanStatus} onChange={(e) => setLoanStatus(e.target.value as LoanItem['status'])} className="w-full h-9 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs">
                <option value="active">Active</option>
                <option value="paid_off">Paid Off</option>
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setLoanModal(false)} className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs">Cancel</button>
            <button type="submit" className="h-9 px-4 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">Save Facility</button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(repayLoan)} onClose={() => setRepayLoan(null)} title={`Loan Repayment — ${repayLoan?.ref || ''}`} maxWidthClass="max-w-sm">
        <form onSubmit={handleRepayLoan} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Principal Payment ($)</label>
            <input type="number" step="0.01" min="0.01" value={repayAmt} onChange={(e) => setRepayAmt(e.target.value)} required className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-mono" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setRepayLoan(null)} className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs">Cancel</button>
            <button type="submit" className="h-9 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium">Post Payment</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

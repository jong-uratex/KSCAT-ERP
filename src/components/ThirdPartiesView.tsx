import { useEffect, useState, type FormEvent } from 'react';
import { Award, Building2, Handshake, Pencil, PhoneCall, Plus, RefreshCw, Search, Trash2, UserPlus, Users } from 'lucide-react';
import { apiRequest, can } from '../lib/api';
import { formatCurrency, formatDate } from '../lib/format';
import type {
  ContactPerson,
  EnabledModulesMap,
  Invoice,
  MemberItem,
  PartnershipItem,
  PermissionMap,
  Project,
  Proposal,
  SearchFocusHint,
  ThirdParty,
} from '../types/erp';
import { ConfirmDeleteModal, Modal } from './Modal';
import { StatusText } from './StatusText';

interface ThirdPartiesViewProps {
  permissions: PermissionMap;
  enabledModules: EnabledModulesMap;
  focusHint?: SearchFocusHint | null;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

const PARTY_LABELS: Record<string, string> = {
  customer: 'Customer',
  prospect: 'Prospect',
  supplier: 'Supplier',
  customer_supplier: 'Customer & Supplier',
};

function safeHttpHref(url?: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function ThirdPartiesView({ permissions, enabledModules, focusHint, onNotify }: ThirdPartiesViewProps) {
  const showMembers = enabledModules.members !== false;
  const showPartnerships = enabledModules.partnerships !== false;

  const [tab, setTab] = useState<'companies' | 'contacts' | 'members' | 'partnerships'>('companies');
  const [filterType, setFilterType] = useState<'all' | 'customer' | 'prospect' | 'supplier'>('all');
  const [search, setSearch] = useState('');
  const [thirdParties, setThirdParties] = useState<ThirdParty[]>([]);
  const [contacts, setContacts] = useState<ContactPerson[]>([]);
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [partnerships, setPartnerships] = useState<PartnershipItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingParty, setEditingParty] = useState<ThirdParty | null>(null);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<ContactPerson | null>(null);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<MemberItem | null>(null);
  const [partnerModalOpen, setPartnerModalOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState<PartnershipItem | null>(null);
  const [detailData, setDetailData] = useState<{
    party: ThirdParty;
    contacts: ContactPerson[];
    proposals: Proposal[];
    invoices: Invoice[];
    projects: Project[];
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    endpoint: string;
    label: string;
    warning?: string;
    closeDetail?: boolean;
  } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Party form
  const [name, setName] = useState('');
  const [partyType, setPartyType] = useState<'customer' | 'prospect' | 'supplier' | 'customer_supplier'>('customer');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [taxId, setTaxId] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('Net 30');
  const [creditLimit, setCreditLimit] = useState('25000');
  const [partyStatus, setPartyStatus] = useState<'active' | 'inactive'>('active');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [notes, setNotes] = useState('');

  // Contact form
  const [contactCompanyId, setContactCompanyId] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactPrimary, setContactPrimary] = useState(false);

  // Member form
  const [mFullName, setMFullName] = useState('');
  const [mOrg, setMOrg] = useState('');
  const [mType, setMType] = useState<'Individual' | 'Corporate' | 'Foundation Patron' | 'Student'>('Individual');
  const [mEmail, setMEmail] = useState('');
  const [mPhone, setMPhone] = useState('');
  const [mFee, setMFee] = useState('150');
  const [mExpiry, setMExpiry] = useState('');
  const [mStatus, setMStatus] = useState<'draft' | 'active' | 'expired' | 'resiliated'>('active');

  // Partnership form
  const [ptPartyId, setPtPartyId] = useState('');
  const [ptTier, setPtTier] = useState<'Referral' | 'Silver' | 'Gold' | 'Strategic'>('Silver');
  const [ptComm, setPtComm] = useState('10');
  const [ptEndDate, setPtEndDate] = useState('');
  const [ptStatus, setPtStatus] = useState<'pending' | 'active' | 'paused' | 'closed'>('active');
  const [ptNotes, setPtNotes] = useState('');

  const canWrite = can(permissions, 'crm', 'write');
  const canDelete = can(permissions, 'crm', 'delete');

  async function loadData() {
    setLoading(true);
    try {
      const [tpRes, memRes] = await Promise.all([
        apiRequest<{ thirdParties: ThirdParty[]; contacts: ContactPerson[] }>('/api/third-parties'),
        apiRequest<{ members: MemberItem[]; partnerships: PartnershipItem[] }>('/api/members'),
      ]);
      setThirdParties(tpRes.thirdParties);
      setContacts(tpRes.contacts);
      setMembers(memRes.members);
      setPartnerships(memRes.partnerships);
      if (tpRes.thirdParties.length > 0) {
        if (!contactCompanyId) setContactCompanyId(String(tpRes.thirdParties[0].id));
        if (!ptPartyId) setPtPartyId(String(tpRes.thirdParties[0].id));
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to load directory.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!focusHint) return;
    setTab('companies');
    setFilterType('all');
    setSearch(focusHint.ref);
    openDetail(focusHint.recordId);
  }, [focusHint?.ts]);

  async function openDetail(id: number) {
    try {
      const res = await apiRequest<{
        party: ThirdParty;
        contacts: ContactPerson[];
        proposals: Proposal[];
        invoices: Invoice[];
        projects: Project[];
      }>(`/api/third-parties/${id}`);
      setDetailData(res);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to load company card.', 'error');
    }
  }

  function openCreateParty() {
    setEditingParty(null);
    setName('');
    setPartyType('customer');
    setEmail('');
    setPhone('');
    setCity('');
    setCountry('');
    setTaxId('');
    setPaymentTerms('Net 30');
    setCreditLimit('25000');
    setPartyStatus('active');
    setLinkedinUrl('');
    setNotes('');
    setCreateOpen(true);
  }

  function openEditParty(tp: ThirdParty) {
    let li = '';
    try {
      const parsed = tp.social_json ? (JSON.parse(tp.social_json) as Record<string, string>) : {};
      li = parsed.linkedin ?? '';
    } catch {
      li = '';
    }
    setEditingParty(tp);
    setName(tp.name);
    setPartyType(tp.party_type);
    setEmail(tp.email);
    setPhone(tp.phone);
    setCity(tp.city);
    setCountry(tp.country);
    setTaxId(tp.tax_id);
    setPaymentTerms(tp.payment_terms);
    setCreditLimit(String(tp.credit_limit));
    setPartyStatus(tp.status);
    setLinkedinUrl(li);
    setNotes(tp.notes);
    setCreateOpen(true);
  }

  async function handleSaveParty(e: FormEvent) {
    e.preventDefault();
    try {
      const body = {
        name,
        partyType,
        email,
        phone,
        city,
        country,
        taxId,
        paymentTerms,
        creditLimit: Number(creditLimit) || 0,
        status: partyStatus,
        socialJson: JSON.stringify(linkedinUrl ? { linkedin: linkedinUrl } : {}),
        notes,
      };
      if (editingParty) {
        await apiRequest(`/api/third-parties/${editingParty.id}`, { method: 'PUT', body });
        onNotify(`Updated ${editingParty.ref}.`);
        if (detailData?.party.id === editingParty.id) {
          openDetail(editingParty.id);
        }
      } else {
        await apiRequest('/api/third-parties', { method: 'POST', body });
        onNotify('Third party created successfully.');
      }
      setCreateOpen(false);
      setEditingParty(null);
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Save failed.', 'error');
    }
  }

  function openCreateContact() {
    setEditingContact(null);
    if (thirdParties[0]) setContactCompanyId(String(thirdParties[0].id));
    setFirstName('');
    setLastName('');
    setJobTitle('');
    setContactEmail('');
    setContactPhone('');
    setContactPrimary(false);
    setContactModalOpen(true);
  }

  function openEditContact(c: ContactPerson) {
    setEditingContact(c);
    setContactCompanyId(String(c.third_party_id));
    setFirstName(c.first_name);
    setLastName(c.last_name);
    setJobTitle(c.job_title);
    setContactEmail(c.email);
    setContactPhone(c.phone);
    setContactPrimary(c.is_primary === 1);
    setContactModalOpen(true);
  }

  async function handleSaveContact(e: FormEvent) {
    e.preventDefault();
    try {
      const body = {
        thirdPartyId: Number(contactCompanyId),
        firstName,
        lastName,
        jobTitle,
        email: contactEmail,
        phone: contactPhone,
        isPrimary: contactPrimary,
      };
      if (editingContact) {
        await apiRequest(`/api/contacts/${editingContact.id}`, { method: 'PUT', body });
        onNotify('Contact updated.');
      } else {
        await apiRequest('/api/contacts', { method: 'POST', body });
        onNotify('Contact added.');
      }
      setContactModalOpen(false);
      setEditingContact(null);
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save contact.', 'error');
    }
  }

  function openCreateMember() {
    setEditingMember(null);
    setMFullName('');
    setMOrg('');
    setMType('Individual');
    setMEmail('');
    setMPhone('');
    setMFee('150');
    setMExpiry('');
    setMStatus('active');
    setMemberModalOpen(true);
  }

  function openEditMember(m: MemberItem) {
    setEditingMember(m);
    setMFullName(m.full_name);
    setMOrg(m.organization);
    setMType(m.member_type);
    setMEmail(m.email);
    setMPhone(m.phone);
    setMFee(String(m.subscription_fee));
    setMExpiry(m.expiry_date);
    setMStatus(m.status);
    setMemberModalOpen(true);
  }

  async function handleSaveMember(e: FormEvent) {
    e.preventDefault();
    try {
      const body = {
        fullName: mFullName,
        organization: mOrg,
        memberType: mType,
        email: mEmail,
        phone: mPhone,
        subscriptionFee: Number(mFee) || 0,
        expiryDate: mExpiry || undefined,
        status: mStatus,
      };
      if (editingMember) {
        await apiRequest(`/api/members/${editingMember.id}`, { method: 'PUT', body });
        onNotify(`Updated member ${editingMember.ref}.`);
      } else {
        await apiRequest('/api/members', { method: 'POST', body });
        onNotify('Member enrolled.');
      }
      setMemberModalOpen(false);
      setEditingMember(null);
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save member.', 'error');
    }
  }

  async function handleRenewMember(id: number) {
    try {
      await apiRequest(`/api/members/${id}/renew`, { method: 'POST', body: {} });
      onNotify('Membership renewed for 12 months.');
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Renewal failed.', 'error');
    }
  }

  function openCreatePartnership() {
    setEditingPartner(null);
    if (thirdParties[0]) setPtPartyId(String(thirdParties[0].id));
    setPtTier('Silver');
    setPtComm('10');
    setPtEndDate('');
    setPtStatus('active');
    setPtNotes('');
    setPartnerModalOpen(true);
  }

  function openEditPartnership(pt: PartnershipItem) {
    setEditingPartner(pt);
    setPtPartyId(String(pt.third_party_id));
    setPtTier(pt.partner_tier);
    setPtComm(String(pt.commission_pct));
    setPtEndDate(pt.end_date);
    setPtStatus(pt.status);
    setPtNotes(pt.notes);
    setPartnerModalOpen(true);
  }

  async function handleSavePartnership(e: FormEvent) {
    e.preventDefault();
    try {
      const body = {
        thirdPartyId: Number(ptPartyId),
        partnerTier: ptTier,
        commissionPct: Number(ptComm) || 0,
        endDate: ptEndDate || undefined,
        status: ptStatus,
        notes: ptNotes,
      };
      if (editingPartner) {
        await apiRequest(`/api/partnerships/${editingPartner.id}`, { method: 'PUT', body });
        onNotify(`Updated partnership ${editingPartner.ref}.`);
      } else {
        await apiRequest('/api/partnerships', { method: 'POST', body });
        onNotify('Partnership agreement created.');
      }
      setPartnerModalOpen(false);
      setEditingPartner(null);
      await loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save partnership.', 'error');
    }
  }

  function promptDelete(endpoint: string, label: string, warning?: string, closeDetail = false) {
    setDeleteError('');
    setDeleteTarget({ endpoint, label, warning, closeDetail });
  }

  async function executeDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setDeleteError('');
    try {
      await apiRequest(deleteTarget.endpoint, { method: 'DELETE' });
      onNotify(`${deleteTarget.label} deleted.`);
      if (deleteTarget.closeDetail) setDetailData(null);
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setDeleteLoading(false);
    }
  }

  const filteredParties = thirdParties.filter((tp) => {
    const matchesSearch =
      tp.name.toLowerCase().includes(search.toLowerCase()) ||
      tp.ref.toLowerCase().includes(search.toLowerCase()) ||
      tp.email.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (filterType === 'all') return true;
    if (filterType === 'customer') return tp.party_type === 'customer' || tp.party_type === 'customer_supplier';
    if (filterType === 'supplier') return tp.party_type === 'supplier' || tp.party_type === 'customer_supplier';
    return tp.party_type === filterType;
  });

  const filteredContacts = contacts.filter(
    (c) =>
      `${c.first_name} ${c.last_name}`.toLowerCase().includes(search.toLowerCase()) ||
      (c.company_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase())
  );

  const parsedDetailSocial = (() => {
    try {
      return detailData?.party.social_json ? (JSON.parse(detailData.party.social_json) as Record<string, string>) : {};
    } catch {
      return {};
    }
  })();

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex flex-wrap items-center p-1 rounded-lg bg-zinc-200/70 dark:bg-zinc-800">
            <button
              type="button"
              onClick={() => setTab('companies')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                tab === 'companies'
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Third Parties ({thirdParties.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('contacts')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                tab === 'contacts'
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Contacts ({contacts.length})</span>
            </button>
            {showMembers && (
              <button
                type="button"
                onClick={() => setTab('members')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'members'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
                }`}
              >
                <Award className="w-3.5 h-3.5" />
                <span>Memberships ({members.length})</span>
              </button>
            )}
            {showPartnerships && (
              <button
                type="button"
                onClick={() => setTab('partnerships')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                  tab === 'partnerships'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
                }`}
              >
                <Handshake className="w-3.5 h-3.5" />
                <span>Partnerships ({partnerships.length})</span>
              </button>
            )}
          </div>

          {tab === 'companies' && (
            <div className="inline-flex items-center p-1 rounded-lg bg-zinc-100 dark:bg-zinc-800/70">
              {(['all', 'customer', 'prospect', 'supplier'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilterType(f)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap ${
                    filterType === f
                      ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {(tab === 'companies' || tab === 'contacts') && (
            <div className="relative flex-1 md:w-60">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search ref, name, email..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-600"
              />
            </div>
          )}

          {canWrite && tab === 'companies' && (
            <button
              type="button"
              onClick={openCreateParty}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Third Party</span>
            </button>
          )}
          {canWrite && tab === 'contacts' && (
            <button
              type="button"
              onClick={openCreateContact}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Add Contact</span>
            </button>
          )}
          {canWrite && tab === 'members' && (
            <button
              type="button"
              onClick={openCreateMember}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Enroll Member</span>
            </button>
          )}
          {canWrite && tab === 'partnerships' && (
            <button
              type="button"
              onClick={openCreatePartnership}
              className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Partnership</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-zinc-500">Loading directory...</div>
        ) : tab === 'companies' ? (
          filteredParties.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">No matching third parties found</p>
              <p className="mt-1 text-xs text-zinc-500">
                Add customers, prospects, or suppliers to start issuing commercial proposals and invoices.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-xs text-zinc-500 dark:text-zinc-400">
                    <th className="py-3 px-4 font-medium">Reference</th>
                    <th className="py-3 px-4 font-medium">Organization</th>
                    <th className="py-3 px-4 font-medium">Classification</th>
                    <th className="py-3 px-4 font-medium">Click-to-Dial</th>
                    <th className="py-3 px-4 font-medium">Location</th>
                    <th className="py-3 px-4 font-medium text-right">Credit Limit</th>
                    <th className="py-3 px-4 font-medium text-right">Status</th>
                    {(canWrite || canDelete) && <th className="py-3 px-4 font-medium text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {filteredParties.map((tp) => (
                    <tr
                      key={tp.id}
                      onClick={() => openDetail(tp.id)}
                      className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
                    >
                      <td className="py-3 px-4 font-mono text-xs font-medium text-orange-700 dark:text-orange-400">
                        {tp.ref}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">{tp.name}</div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">{tp.email || '—'}</div>
                      </td>
                      <td className="py-3 px-4 text-xs text-zinc-700 dark:text-zinc-300">
                        {PARTY_LABELS[tp.party_type] ?? tp.party_type}
                      </td>
                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        {tp.phone ? (
                          <a
                            href={`tel:${tp.phone.replace(/[^+\d]/g, '')}`}
                            className="inline-flex items-center gap-1 font-mono text-xs text-orange-700 dark:text-orange-400 hover:underline"
                          >
                            <PhoneCall className="w-3 h-3" />
                            <span>{tp.phone}</span>
                          </a>
                        ) : (
                          <span className="text-xs text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-zinc-600 dark:text-zinc-400">
                        {[tp.city, tp.country].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-right text-zinc-900 dark:text-zinc-100">
                        {formatCurrency(tp.credit_limit)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <StatusText status={tp.status} />
                      </td>
                      {(canWrite || canDelete) && (
                        <td className="py-3 px-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex items-center gap-1.5">
                            {canWrite && (
                              <button
                                type="button"
                                onClick={() => openEditParty(tp)}
                                title="Edit third party"
                                aria-label={`Edit ${tp.name}`}
                                className="p-1.5 rounded-md text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() =>
                                  promptDelete(
                                    `/api/third-parties/${tp.id}`,
                                    `${tp.ref} (${tp.name})`,
                                    'Records linked to existing proposals, orders, or invoices cannot be deleted.'
                                  )
                                }
                                title="Delete third party"
                                aria-label={`Delete ${tp.name}`}
                                className="p-1.5 rounded-md text-zinc-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : tab === 'contacts' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-xs text-zinc-500">
                  <th className="py-3 px-4 font-medium">Name</th>
                  <th className="py-3 px-4 font-medium">Role / Title</th>
                  <th className="py-3 px-4 font-medium">Company</th>
                  <th className="py-3 px-4 font-medium">Email</th>
                  <th className="py-3 px-4 font-medium">Click-to-Dial</th>
                  {(canWrite || canDelete) && <th className="py-3 px-4 font-medium text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filteredContacts.map((c) => (
                  <tr key={c.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="py-3 px-4 font-medium text-zinc-900 dark:text-zinc-100">
                      {c.first_name} {c.last_name}
                      {c.is_primary === 1 && (
                        <span className="ml-2 text-[11px] font-normal text-orange-700 dark:text-orange-400">· Primary</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-600 dark:text-zinc-400">{c.job_title || '—'}</td>
                    <td className="py-3 px-4 text-xs font-medium text-zinc-800 dark:text-zinc-200">{c.company_name}</td>
                    <td className="py-3 px-4 text-xs text-zinc-600 dark:text-zinc-400">{c.email || '—'}</td>
                    <td className="py-3 px-4">
                      {c.phone ? (
                        <a
                          href={`tel:${c.phone.replace(/[^+\d]/g, '')}`}
                          className="inline-flex items-center gap-1 font-mono text-xs text-orange-700 dark:text-orange-400 hover:underline"
                        >
                          <PhoneCall className="w-3 h-3" />
                          <span>{c.phone}</span>
                        </a>
                      ) : (
                        <span className="text-xs text-zinc-400">—</span>
                      )}
                    </td>
                    {(canWrite || canDelete) && (
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => openEditContact(c)}
                              title="Edit contact"
                              aria-label={`Edit ${c.first_name} ${c.last_name}`}
                              className="p-1.5 rounded-md text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => promptDelete(`/api/contacts/${c.id}`, `${c.first_name} ${c.last_name}`)}
                              title="Delete contact"
                              aria-label={`Delete ${c.first_name} ${c.last_name}`}
                              className="p-1.5 rounded-md text-zinc-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : tab === 'members' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-xs text-zinc-500">
                  <th className="py-3 px-4 font-medium">Member Ref</th>
                  <th className="py-3 px-4 font-medium">Member & Organization</th>
                  <th className="py-3 px-4 font-medium">Tier</th>
                  <th className="py-3 px-4 font-medium">Valid Until</th>
                  <th className="py-3 px-4 font-medium text-right">Annual Fee</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {members.map((m) => (
                  <tr key={m.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="py-3 px-4 font-mono text-xs text-orange-700 dark:text-orange-400">{m.ref}</td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{m.full_name}</div>
                      <div className="text-xs text-zinc-500">{m.organization || m.email}</div>
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-700 dark:text-zinc-300">{m.member_type}</td>
                    <td className="py-3 px-4 font-mono text-xs text-zinc-600 dark:text-zinc-400">{formatDate(m.expiry_date)}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-right">{formatCurrency(m.subscription_fee)}</td>
                    <td className="py-3 px-4"><StatusText status={m.status} /></td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => handleRenewMember(m.id)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline"
                          >
                            <RefreshCw className="w-3 h-3" />
                            <span>Renew +1 Yr</span>
                          </button>
                        )}
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => openEditMember(m)}
                            title="Edit member"
                            aria-label={`Edit ${m.full_name}`}
                            className="p-1.5 rounded-md text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => promptDelete(`/api/members/${m.id}`, `${m.ref} (${m.full_name})`)}
                            title="Delete member"
                            aria-label={`Delete ${m.full_name}`}
                            className="p-1.5 rounded-md text-zinc-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-xs text-zinc-500">
                  <th className="py-3 px-4 font-medium">Ref</th>
                  <th className="py-3 px-4 font-medium">Partner Organization</th>
                  <th className="py-3 px-4 font-medium">Tier</th>
                  <th className="py-3 px-4 font-medium text-right">Commission</th>
                  <th className="py-3 px-4 font-medium">Term</th>
                  <th className="py-3 px-4 font-medium text-right">Status</th>
                  {(canWrite || canDelete) && <th className="py-3 px-4 font-medium text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {partnerships.map((pt) => (
                  <tr key={pt.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="py-3 px-4 font-mono text-xs text-orange-700 dark:text-orange-400">{pt.ref}</td>
                    <td className="py-3 px-4 font-medium text-zinc-900 dark:text-zinc-100">{pt.party_name}</td>
                    <td className="py-3 px-4 text-xs text-zinc-700 dark:text-zinc-300">{pt.partner_tier}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-right">{pt.commission_pct}%</td>
                    <td className="py-3 px-4 font-mono text-xs text-zinc-500">{formatDate(pt.start_date)} → {formatDate(pt.end_date)}</td>
                    <td className="py-3 px-4 text-right"><StatusText status={pt.status} /></td>
                    {(canWrite || canDelete) && (
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => openEditPartnership(pt)}
                              title="Edit partnership"
                              aria-label={`Edit ${pt.ref}`}
                              className="p-1.5 rounded-md text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => promptDelete(`/api/partnerships/${pt.id}`, `${pt.ref} (${pt.party_name})`)}
                              title="Delete partnership"
                              aria-label={`Delete ${pt.ref}`}
                              className="p-1.5 rounded-md text-zinc-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit Third Party Modal */}
      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setEditingParty(null);
        }}
        title={editingParty ? `Edit Third Party — ${editingParty.ref}` : 'New Third Party'}
        subtitle={editingParty ? 'Update organization profile, payment terms, and classification.' : 'Create a customer, prospect, or supplier record.'}
      >
        <form onSubmit={handleSaveParty} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Company / Organization Name</label>
              <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Type</label>
              <select value={partyType} onChange={(e) => setPartyType(e.target.value as typeof partyType)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                <option value="customer">Customer</option>
                <option value="prospect">Prospect</option>
                <option value="supplier">Supplier</option>
                <option value="customer_supplier">Customer & Supplier</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Tax / VAT ID</label>
              <input type="text" value={taxId} onChange={(e) => setTaxId(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Phone</label>
              <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">City</label>
              <input type="text" value={city} onChange={(e) => setCity(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Country</label>
              <input type="text" value={country} onChange={(e) => setCountry(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Payment Terms</label>
              <select value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                <option value="Due on Receipt">Due on Receipt</option>
                <option value="Net 15">Net 15</option>
                <option value="Net 30">Net 30</option>
                <option value="Net 45">Net 45</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Credit Limit (USD)</label>
              <input type="number" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            {editingParty && (
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Status</label>
                <select value={partyStatus} onChange={(e) => setPartyStatus(e.target.value as 'active' | 'inactive')} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            )}
            <div className={editingParty ? '' : 'sm:col-span-2'}>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">LinkedIn / Social Profile URL</label>
              <input type="url" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="https://www.linkedin.com/company/..." className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Notes</label>
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setCreateOpen(false)} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">
              {editingParty ? 'Save Changes' : 'Create Third Party'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Add / Edit Contact Modal */}
      <Modal
        open={contactModalOpen}
        onClose={() => {
          setContactModalOpen(false);
          setEditingContact(null);
        }}
        title={editingContact ? 'Edit Contact Person' : 'Add Contact Person'}
        subtitle="Associate a stakeholder contact with an existing third party."
      >
        <form onSubmit={handleSaveContact} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Company</label>
            <select required value={contactCompanyId} onChange={(e) => setContactCompanyId(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
              {thirdParties.map((tp) => <option key={tp.id} value={tp.id}>{tp.ref} — {tp.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">First Name</label>
              <input type="text" required value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Last Name</label>
              <input type="text" required value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Job Title</label>
            <input type="text" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Email</label>
              <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Phone</label>
              <input type="text" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={contactPrimary} onChange={(e) => setContactPrimary(e.target.checked)} className="rounded border-zinc-300" />
            <span>Primary contact</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setContactModalOpen(false)} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">
              {editingContact ? 'Save Changes' : 'Save Contact'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Enroll / Edit Member Modal */}
      <Modal
        open={memberModalOpen}
        onClose={() => {
          setMemberModalOpen(false);
          setEditingMember(null);
        }}
        title={editingMember ? `Edit Member — ${editingMember.ref}` : 'Enroll Foundation / Association Member'}
        subtitle="Manage member tier, subscription fee, and renewal window."
      >
        <form onSubmit={handleSaveMember} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Full Name</label>
              <input type="text" required value={mFullName} onChange={(e) => setMFullName(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Membership Type</label>
              <select value={mType} onChange={(e) => setMType(e.target.value as typeof mType)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                <option value="Individual">Individual</option>
                <option value="Corporate">Corporate</option>
                <option value="Foundation Patron">Foundation Patron</option>
                <option value="Student">Student</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Annual Fee (USD)</label>
              <input type="number" required value={mFee} onChange={(e) => setMFee(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Organization</label>
              <input type="text" value={mOrg} onChange={(e) => setMOrg(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Email</label>
              <input type="email" value={mEmail} onChange={(e) => setMEmail(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Phone</label>
              <input type="text" value={mPhone} onChange={(e) => setMPhone(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            {editingMember && (
              <>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Valid Until</label>
                  <input type="date" value={mExpiry} onChange={(e) => setMExpiry(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Status</label>
                  <select value={mStatus} onChange={(e) => setMStatus(e.target.value as typeof mStatus)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="expired">Expired</option>
                    <option value="resiliated">Resiliated</option>
                  </select>
                </div>
              </>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setMemberModalOpen(false)} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">
              {editingMember ? 'Save Changes' : 'Enroll Member'}
            </button>
          </div>
        </form>
      </Modal>

      {/* New / Edit Partnership Modal */}
      <Modal
        open={partnerModalOpen}
        onClose={() => {
          setPartnerModalOpen(false);
          setEditingPartner(null);
        }}
        title={editingPartner ? `Edit Partnership — ${editingPartner.ref}` : 'New Partnership Agreement'}
        subtitle="Register or update a reseller or referral tier with a third party."
      >
        <form onSubmit={handleSavePartnership} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Partner Third Party</label>
            <select required value={ptPartyId} onChange={(e) => setPtPartyId(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
              {thirdParties.map((tp) => <option key={tp.id} value={tp.id}>{tp.ref} — {tp.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Partner Tier</label>
              <select value={ptTier} onChange={(e) => setPtTier(e.target.value as typeof ptTier)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                <option value="Referral">Referral</option>
                <option value="Silver">Silver</option>
                <option value="Gold">Gold</option>
                <option value="Strategic">Strategic</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Commission (%)</label>
              <input type="number" step="0.5" value={ptComm} onChange={(e) => setPtComm(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
            </div>
            {editingPartner && (
              <>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">End Date</label>
                  <input type="date" value={ptEndDate} onChange={(e) => setPtEndDate(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Status</label>
                  <select value={ptStatus} onChange={(e) => setPtStatus(e.target.value as typeof ptStatus)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950">
                    <option value="pending">Pending</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
              </>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Agreement Notes</label>
            <textarea rows={2} value={ptNotes} onChange={(e) => setPtNotes(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setPartnerModalOpen(false)} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium">
              {editingPartner ? 'Save Changes' : 'Save Partnership'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Third Party Detail Card Modal */}
      <Modal
        open={Boolean(detailData)}
        onClose={() => setDetailData(null)}
        title={detailData ? `${detailData.party.ref} — ${detailData.party.name}` : ''}
        subtitle={
          detailData
            ? `${PARTY_LABELS[detailData.party.party_type]} · ${detailData.party.payment_terms} · Tax ID: ${detailData.party.tax_id || 'N/A'}`
            : ''
        }
        maxWidthClass="max-w-2xl"
      >
        {detailData && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs border-b border-zinc-200 dark:border-zinc-800 pb-4">
              <div>
                <div className="text-zinc-500">Email</div>
                <div className="mt-0.5 font-medium text-zinc-900 dark:text-zinc-100">{detailData.party.email || '—'}</div>
              </div>
              <div>
                <div className="text-zinc-500">Phone (Click-to-Dial)</div>
                <div className="mt-0.5 font-mono text-zinc-900 dark:text-zinc-100">
                  {detailData.party.phone ? (
                    <a href={`tel:${detailData.party.phone.replace(/[^+\d]/g, '')}`} className="text-orange-700 dark:text-orange-400 hover:underline">
                      {detailData.party.phone}
                    </a>
                  ) : (
                    '—'
                  )}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Credit Limit</div>
                <div className="mt-0.5 font-mono font-medium text-zinc-900 dark:text-zinc-100">
                  {formatCurrency(detailData.party.credit_limit)}
                </div>
              </div>
              <div className="col-span-2 sm:col-span-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-zinc-500">Address</div>
                  <div className="mt-0.5 text-zinc-800 dark:text-zinc-200">
                    {[detailData.party.address, detailData.party.city, detailData.party.country].filter(Boolean).join(', ') || '—'}
                  </div>
                </div>
                {safeHttpHref(parsedDetailSocial.linkedin) && (
                  <a
                    href={safeHttpHref(parsedDetailSocial.linkedin)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline"
                  >
                    LinkedIn Profile →
                  </a>
                )}
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
                Linked Contacts ({detailData.contacts.length})
              </h4>
              {detailData.contacts.length === 0 ? (
                <p className="text-xs text-zinc-500">No contacts linked.</p>
              ) : (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-lg">
                  {detailData.contacts.map((c) => (
                    <div key={c.id} className="px-3 py-2 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">{c.first_name} {c.last_name}</span>
                        <span className="text-zinc-500"> · {c.job_title || 'Contact'}</span>
                      </div>
                      <span className="text-zinc-600 dark:text-zinc-400">{c.email}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
                Recent Proposals & Invoices
              </h4>
              {detailData.proposals.length === 0 && detailData.invoices.length === 0 ? (
                <p className="text-xs text-zinc-500">No linked commercial documents yet.</p>
              ) : (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs">
                  {detailData.proposals.map((pr) => (
                    <div key={`p-${pr.id}`} className="px-3 py-2 flex items-center justify-between">
                      <div>
                        <span className="font-mono font-medium">{pr.ref}</span>
                        <span className="text-zinc-500"> · Proposal · {formatDate(pr.issue_date)}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono">{formatCurrency(pr.total_ttc)}</span>
                        <StatusText status={pr.status} />
                      </div>
                    </div>
                  ))}
                  {detailData.invoices.map((inv) => (
                    <div key={`i-${inv.id}`} className="px-3 py-2 flex items-center justify-between">
                      <div>
                        <span className="font-mono font-medium">{inv.ref}</span>
                        <span className="text-zinc-500"> · Invoice · Due {formatDate(inv.due_date)}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono">{formatCurrency(inv.total_ttc)}</span>
                        <StatusText status={inv.status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {(canWrite || canDelete) && (
              <div className="flex justify-end gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => openEditParty(detailData.party)}
                    className="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 inline-flex items-center gap-1.5"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Edit Third Party</span>
                  </button>
                )}
                {canDelete && (
                  <button
                    type="button"
                    onClick={() =>
                      promptDelete(
                        `/api/third-parties/${detailData.party.id}`,
                        `${detailData.party.ref} (${detailData.party.name})`,
                        'Records linked to existing proposals, orders, or invoices cannot be deleted.',
                        true
                      )
                    }
                    className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 inline-flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Third Party</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        itemLabel={deleteTarget?.label ?? ''}
        warning={deleteTarget?.warning}
        loading={deleteLoading}
        error={deleteError}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={executeDelete}
      />
    </div>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { BookOpen, LifeBuoy, Pencil, Plus, Send, Sparkles, Trash2 } from 'lucide-react';
import { apiRequest, can } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { KbArticle, PermissionMap, SearchFocusHint, ThirdParty, TicketItem } from '../types/erp';
import { ConfirmDeleteModal, Modal } from './Modal';
import { StatusText } from './StatusText';

interface SupportViewProps {
  permissions: PermissionMap;
  focusHint?: SearchFocusHint | null;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export function SupportView({ permissions, focusHint, onNotify }: SupportViewProps) {
  const [tab, setTab] = useState<'tickets' | 'kb'>('tickets');
  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [articles, setArticles] = useState<KbArticle[]>([]);
  const [thirdParties, setThirdParties] = useState<ThirdParty[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyStatus, setReplyStatus] = useState<TicketItem['status']>('in_progress');
  const [aiDrafting, setAiDrafting] = useState(false);
  const [loading, setLoading] = useState(true);

  const [tckModal, setTckModal] = useState(false);
  const [editingTicket, setEditingTicket] = useState<TicketItem | null>(null);
  const [tPartyId, setTPartyId] = useState('');
  const [tSubject, setTSubject] = useState('');
  const [tCategory, setTCategory] = useState('Technical Support');
  const [tSeverity, setTSeverity] = useState<TicketItem['severity']>('normal');
  const [tStatus, setTStatus] = useState<TicketItem['status']>('open');
  const [tAssignee, setTAssignee] = useState('');
  const [tMessage, setTMessage] = useState('');

  const [kbModal, setKbModal] = useState(false);
  const [editingKb, setEditingKb] = useState<KbArticle | null>(null);
  const [kbTitle, setKbTitle] = useState('');
  const [kbCat, setKbCat] = useState('Operations');
  const [kbContent, setKbContent] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<{ endpoint: string; label: string; resetTicketId?: number } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const canWrite = can(permissions, 'support', 'write');
  const canDelete = can(permissions, 'support', 'delete');
  const canUseAi = can(permissions, 'tools', 'write');

  async function loadSupport() {
    setLoading(true);
    try {
      const [supRes, tpRes] = await Promise.all([
        apiRequest<{ tickets: TicketItem[]; articles: KbArticle[] }>('/api/support'),
        apiRequest<{ thirdParties: ThirdParty[] }>('/api/third-parties'),
      ]);
      setTickets(supRes.tickets);
      setArticles(supRes.articles);
      setThirdParties(tpRes.thirdParties);
      if (supRes.tickets[0] && !selectedTicketId) {
        setSelectedTicketId(supRes.tickets[0].id);
        setReplyStatus(supRes.tickets[0].status);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to load support desk.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSupport();
  }, []);

  useEffect(() => {
    if (!focusHint) return;
    setTab('tickets');
    setSelectedTicketId(focusHint.recordId);
  }, [focusHint?.ts]);

  const activeTicket = tickets.find((t) => t.id === selectedTicketId) ?? tickets[0] ?? null;

  function openCreateTicket() {
    setEditingTicket(null);
    setTPartyId('');
    setTSubject('');
    setTCategory('Technical Support');
    setTSeverity('normal');
    setTStatus('open');
    setTAssignee('');
    setTMessage('');
    setTckModal(true);
  }

  function openEditTicket(t: TicketItem) {
    setEditingTicket(t);
    setTPartyId(t.third_party_id ? String(t.third_party_id) : '');
    setTSubject(t.subject);
    setTCategory(t.category);
    setTSeverity(t.severity);
    setTStatus(t.status);
    setTAssignee(t.assignee_name);
    setTMessage(t.message);
    setTckModal(true);
  }

  async function handleSaveTicket(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingTicket) {
        await apiRequest(`/api/tickets/${editingTicket.id}`, {
          method: 'PUT',
          body: {
            thirdPartyId: tPartyId ? Number(tPartyId) : null,
            subject: tSubject,
            category: tCategory,
            severity: tSeverity,
            status: tStatus,
            assigneeName: tAssignee,
            message: tMessage,
          },
        });
        onNotify(`Updated ticket ${editingTicket.ref}.`);
      } else {
        const created = await apiRequest<TicketItem>('/api/tickets', {
          method: 'POST',
          body: {
            thirdPartyId: tPartyId ? Number(tPartyId) : null,
            subject: tSubject,
            category: tCategory,
            severity: tSeverity,
            message: tMessage,
          },
        });
        setSelectedTicketId(created.id);
        onNotify(`Support ticket ${created.ref} created.`);
      }
      setTckModal(false);
      setEditingTicket(null);
      await loadSupport();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save ticket.', 'error');
    }
  }

  async function handleSendReply(e: FormEvent) {
    e.preventDefault();
    if (!activeTicket) return;
    try {
      await apiRequest(`/api/tickets/${activeTicket.id}/reply`, {
        method: 'POST',
        body: { text: replyText, status: replyStatus },
      });
      setReplyText('');
      onNotify(`Updated ticket ${activeTicket.ref}.`);
      await loadSupport();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to post reply.', 'error');
    }
  }

  async function handleAiDraftReply() {
    if (!activeTicket) return;
    setAiDrafting(true);
    try {
      const res = await apiRequest<{ text: string; model: string }>('/api/ai/assist', {
        method: 'POST',
        body: {
          taskType: 'ticket_reply',
          contextRef: activeTicket.ref,
          prompt: `Draft a concise, helpful customer support reply for ticket ${activeTicket.ref} ("${activeTicket.subject}"). Customer issue: ${activeTicket.message}`,
        },
      });
      setReplyText(res.text);
      onNotify('AI reply draft generated.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'AI assist unavailable.', 'error');
    } finally {
      setAiDrafting(false);
    }
  }

  function openCreateKb() {
    setEditingKb(null);
    setKbTitle('');
    setKbCat('Operations');
    setKbContent('');
    setKbModal(true);
  }

  function openEditKb(a: KbArticle) {
    setEditingKb(a);
    setKbTitle(a.title);
    setKbCat(a.category);
    setKbContent(a.content);
    setKbModal(true);
  }

  async function handleSaveKb(e: FormEvent) {
    e.preventDefault();
    try {
      if (editingKb) {
        await apiRequest(`/api/kb-articles/${editingKb.id}`, {
          method: 'PUT',
          body: { title: kbTitle, category: kbCat, content: kbContent, isPublic: true },
        });
        onNotify(`Updated KB article ${editingKb.ref}.`);
      } else {
        await apiRequest('/api/kb-articles', {
          method: 'POST',
          body: { title: kbTitle, category: kbCat, content: kbContent, isPublic: true },
        });
        onNotify('Knowledge Base article published.');
      }
      setKbModal(false);
      setEditingKb(null);
      await loadSupport();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save article.', 'error');
    }
  }

  async function executeDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setDeleteError('');
    try {
      await apiRequest(deleteTarget.endpoint, { method: 'DELETE' });
      onNotify(`${deleteTarget.label} deleted.`);
      if (deleteTarget.resetTicketId && selectedTicketId === deleteTarget.resetTicketId) {
        setSelectedTicketId(null);
      }
      setDeleteTarget(null);
      await loadSupport();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-zinc-200/70 dark:bg-zinc-800 self-start">
          <button
            type="button"
            onClick={() => setTab('tickets')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
              tab === 'tickets'
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <LifeBuoy className="w-3.5 h-3.5" />
            <span>Support Tickets ({tickets.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('kb')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
              tab === 'kb'
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Knowledge Base ({articles.length})</span>
          </button>
        </div>

        {canWrite && (
          <button
            type="button"
            onClick={() => (tab === 'tickets' ? openCreateTicket() : openCreateKb())}
            className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap self-start sm:self-auto"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{tab === 'tickets' ? 'Open Ticket' : 'New KB Article'}</span>
          </button>
        )}
      </div>

      {loading ? (
        <div className="p-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-center text-sm text-zinc-500">
          Loading support desk...
        </div>
      ) : tab === 'tickets' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-3">
            {tickets.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setSelectedTicketId(t.id);
                  setReplyStatus(t.status);
                }}
                className={`w-full text-left p-4 rounded-xl border transition-colors ${
                  activeTicket?.id === t.id
                    ? 'border-orange-600 bg-white dark:bg-zinc-900 ring-1 ring-orange-600/20'
                    : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300'
                }`}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-orange-700 dark:text-orange-400">{t.ref}</span>
                  <StatusText status={t.status} />
                </div>
                <div className="mt-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t.subject}</div>
                <div className="mt-1 flex items-center justify-between text-xs text-zinc-500">
                  <span>{t.customer_name || 'Internal'}</span>
                  <StatusText status={t.severity} />
                </div>
              </button>
            ))}
          </div>

          <div className="lg:col-span-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
            {!activeTicket ? (
              <div className="py-12 text-center text-sm text-zinc-500">Select a ticket to inspect thread.</div>
            ) : (
              <div className="space-y-5">
                <div className="pb-4 border-b border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs text-orange-700 dark:text-orange-400">
                      {activeTicket.ref} · {activeTicket.category}
                    </span>
                    <div className="flex items-center gap-2">
                      <StatusText status={activeTicket.status} />
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => openEditTicket(activeTicket)}
                          title="Edit ticket"
                          aria-label={`Edit ${activeTicket.ref}`}
                          className="p-1.5 rounded-md text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError('');
                            setDeleteTarget({
                              endpoint: `/api/tickets/${activeTicket.id}`,
                              label: `${activeTicket.ref} (${activeTicket.subject})`,
                              resetTicketId: activeTicket.id,
                            });
                          }}
                          title="Delete ticket"
                          aria-label={`Delete ${activeTicket.ref}`}
                          className="p-1.5 rounded-md text-zinc-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <h3 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                    {activeTicket.subject}
                  </h3>
                  <div className="mt-1 text-xs text-zinc-500">
                    Account: {activeTicket.customer_name || 'Internal'} · Opened{' '}
                    {formatDateTime(activeTicket.created_at)} · Assignee: {activeTicket.assignee_name}
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">
                  {activeTicket.message}
                </div>

                <div className="space-y-3">
                  {(JSON.parse(activeTicket.replies_json || '[]') as Array<{
                    author: string;
                    date: string;
                    text: string;
                  }>).map((r, i) => (
                    <div
                      key={i}
                      className="p-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs space-y-1"
                    >
                      <div className="flex justify-between text-zinc-500">
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100">{r.author}</span>
                        <span className="font-mono">{r.date}</span>
                      </div>
                      <p className="text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">{r.text}</p>
                    </div>
                  ))}
                </div>

                {canWrite && (
                  <form onSubmit={handleSendReply} className="space-y-3 pt-3 border-t border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold">Post Response & Update Status</span>
                      {canUseAi && (
                        <button
                          type="button"
                          disabled={aiDrafting}
                          onClick={handleAiDraftReply}
                          className="text-xs font-medium text-orange-700 dark:text-orange-400 hover:underline inline-flex items-center gap-1"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>{aiDrafting ? 'Drafting...' : 'Draft Reply with AI'}</span>
                        </button>
                      )}
                    </div>
                    <textarea
                      rows={3}
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Write technical resolution or status note..."
                      className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <select
                        value={replyStatus}
                        onChange={(e) => setReplyStatus(e.target.value as TicketItem['status'])}
                        className="px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                      >
                        <option value="open">Open</option>
                        <option value="in_progress">In Progress</option>
                        <option value="waiting_customer">Waiting Customer</option>
                        <option value="closed">Closed</option>
                      </select>
                      <button
                        type="submit"
                        className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Update Ticket</span>
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {articles.map((a) => (
            <div
              key={a.id}
              className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-mono text-orange-700 dark:text-orange-400">
                  {a.ref} · {a.category}
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-zinc-400">{a.views} views</span>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => openEditKb(a)}
                      title="Edit article"
                      aria-label={`Edit ${a.title}`}
                      className="p-1 rounded-md text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError('');
                        setDeleteTarget({
                          endpoint: `/api/kb-articles/${a.id}`,
                          label: `${a.ref} (${a.title})`,
                        });
                      }}
                      title="Delete article"
                      aria-label={`Delete ${a.title}`}
                      className="p-1 rounded-md text-zinc-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{a.title}</h3>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">
                {a.content}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Open / Edit Ticket Modal */}
      <Modal
        open={tckModal}
        onClose={() => {
          setTckModal(false);
          setEditingTicket(null);
        }}
        title={editingTicket ? `Edit Ticket — ${editingTicket.ref}` : 'Open Support Ticket'}
      >
        <form onSubmit={handleSaveTicket} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Customer (Optional)</label>
              <select
                value={tPartyId}
                onChange={(e) => setTPartyId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="">Internal Request</option>
                {thirdParties.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Severity</label>
              <select
                value={tSeverity}
                onChange={(e) => setTSeverity(e.target.value as TicketItem['severity'])}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>
          {editingTicket && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Status</label>
                <select
                  value={tStatus}
                  onChange={(e) => setTStatus(e.target.value as TicketItem['status'])}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="waiting_customer">Waiting Customer</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Assignee</label>
                <input
                  type="text"
                  value={tAssignee}
                  onChange={(e) => setTAssignee(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              </div>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1">Subject</label>
              <input
                type="text"
                required
                value={tSubject}
                onChange={(e) => setTSubject(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Category</label>
              <input
                type="text"
                value={tCategory}
                onChange={(e) => setTCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Issue Description</label>
            <textarea
              rows={3}
              required
              value={tMessage}
              onChange={(e) => setTMessage(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setTckModal(false)}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium"
            >
              {editingTicket ? 'Save Changes' : 'Submit Ticket'}
            </button>
          </div>
        </form>
      </Modal>

      {/* New / Edit KB Article Modal */}
      <Modal
        open={kbModal}
        onClose={() => {
          setKbModal(false);
          setEditingKb(null);
        }}
        title={editingKb ? `Edit KB Article — ${editingKb.ref}` : 'Publish Knowledge Base Article'}
      >
        <form onSubmit={handleSaveKb} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1">Title</label>
              <input
                type="text"
                required
                value={kbTitle}
                onChange={(e) => setKbTitle(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Category</label>
              <input
                type="text"
                value={kbCat}
                onChange={(e) => setKbCat(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Article Body</label>
            <textarea
              rows={5}
              required
              value={kbContent}
              onChange={(e) => setKbContent(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setKbModal(false)}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium"
            >
              {editingKb ? 'Save Changes' : 'Publish Article'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        itemLabel={deleteTarget?.label ?? ''}
        loading={deleteLoading}
        error={deleteError}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={executeDelete}
      />
    </div>
  );
}

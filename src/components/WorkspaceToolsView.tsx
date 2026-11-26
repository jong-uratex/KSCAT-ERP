import { useEffect, useState, type FormEvent } from 'react';
import {
  Bookmark,
  Check,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileText,
  Inbox,
  Mail,
  Pencil,
  Plus,
  Rss,
  Send,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { apiRequest, can } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type {
  BookmarkItem,
  CollectedEmail,
  EdmDocument,
  EmailCampaign,
  EnabledModulesMap,
  PermissionMap,
} from '../types/erp';
import { ConfirmDeleteModal, Modal } from './Modal';
import { StatusText } from './StatusText';

interface WorkspaceToolsViewProps {
  permissions: PermissionMap;
  enabledModules: EnabledModulesMap;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

type ToolsTab = 'edm' | 'bookmarks' | 'data' | 'campaigns' | 'collector' | 'rss' | 'ai';

export function WorkspaceToolsView({ permissions, enabledModules, onNotify }: WorkspaceToolsViewProps) {
  const showEdm = enabledModules.edm !== false;
  const showTools = enabledModules.tools !== false;
  const showAi = enabledModules.ai_assistant !== false;

  const availableTabs: Array<{ key: ToolsTab; label: string; Icon: typeof FileText }> = [
    ...(showEdm ? [{ key: 'edm' as const, label: 'EDM Documents', Icon: FileText }] : []),
    ...(showTools
      ? [
          { key: 'bookmarks' as const, label: 'Bookmarks', Icon: Bookmark },
          { key: 'data' as const, label: 'Import / Export', Icon: Database },
          { key: 'campaigns' as const, label: 'Mass Emailing', Icon: Mail },
          { key: 'collector' as const, label: 'Email Collector', Icon: Inbox },
          { key: 'rss' as const, label: 'RSS Feeds', Icon: Rss },
        ]
      : []),
    ...(showAi ? [{ key: 'ai' as const, label: 'AI Copilot', Icon: Sparkles }] : []),
  ];

  const [tab, setTab] = useState<ToolsTab>(availableTabs[0]?.key ?? 'edm');
  const [documents, setDocuments] = useState<EdmDocument[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [collectedEmails, setCollectedEmails] = useState<CollectedEmail[]>([]);
  const [loading, setLoading] = useState(true);

  const canWrite = can(permissions, 'tools', 'write');
  const canDelete = can(permissions, 'tools', 'delete');
  const canExport = can(permissions, 'tools', 'export');
  const canConvertTicket = can(permissions, 'support', 'write');

  const [deleteTarget, setDeleteTarget] = useState<{ url: string; label: string; warning?: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // EDM Modal & Viewer
  const [edmModal, setEdmModal] = useState(false);
  const [editingDoc, setEditingDoc] = useState<EdmDocument | null>(null);
  const [docTitle, setDocTitle] = useState('');
  const [docFolder, setDocFolder] = useState('Operations');
  const [docTags, setDocTags] = useState('');
  const [docBody, setDocBody] = useState('');
  const [viewDoc, setViewDoc] = useState<EdmDocument | null>(null);

  // Bookmark Modal
  const [bmModal, setBmModal] = useState(false);
  const [editingBm, setEditingBm] = useState<BookmarkItem | null>(null);
  const [bmTitle, setBmTitle] = useState('');
  const [bmUrl, setBmUrl] = useState('https://');
  const [bmCat, setBmCat] = useState('Finance & Tax');

  // CSV Import/Export
  const [exportDataset, setExportDataset] = useState<'third_parties' | 'products' | 'invoices'>('third_parties');
  const [exportedCsv, setExportedCsv] = useState('');
  const [importDataset, setImportDataset] = useState<'third_parties' | 'products'>('third_parties');
  const [importCsvText, setImportCsvText] = useState(
    'name,party_type,email,phone,city,country\nNordic Freight Partners,supplier,ops@nordicfreight.example,+45 32 10 22 44,Copenhagen,Denmark'
  );

  // Mass Email Modal
  const [campModal, setCampModal] = useState(false);
  const [editingCamp, setEditingCamp] = useState<EmailCampaign | null>(null);
  const [campSubject, setCampSubject] = useState('');
  const [campSegment, setCampSegment] = useState<'all_customers' | 'prospects' | 'all_members'>('all_customers');
  const [campBody, setCampBody] = useState('');

  // Collector Modal
  const [colModal, setColModal] = useState(false);
  const [editingCol, setEditingCol] = useState<CollectedEmail | null>(null);
  const [colSender, setColSender] = useState('');
  const [colSubject, setColSubject] = useState('');
  const [colSnippet, setColSnippet] = useState('');
  const [colStatus, setColStatus] = useState<CollectedEmail['status']>('unprocessed');

  // RSS Feed Reader
  const [rssUrl, setRssUrl] = useState('https://www.dolibarr.org/rss-news.xml');
  const [rssLoading, setRssLoading] = useState(false);
  const [rssItems, setRssItems] = useState<Array<{ title: string; link: string; published: string }>>([]);

  // AI Copilot
  const [aiTask, setAiTask] = useState<'executive_brief' | 'proposal_scope' | 'email_campaign' | 'ticket_reply' | 'custom_qa'>('executive_brief');
  const [aiRef, setAiRef] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiOutput, setAiOutput] = useState('');
  const [aiRunning, setAiRunning] = useState(false);
  const [copiedAi, setCopiedAi] = useState(false);

  async function loadTools() {
    setLoading(true);
    try {
      const res = await apiRequest<{
        documents: EdmDocument[];
        bookmarks: BookmarkItem[];
        campaigns: EmailCampaign[];
        collectedEmails: CollectedEmail[];
      }>('/api/tools');
      setDocuments(res.documents);
      setBookmarks(res.bookmarks);
      setCampaigns(res.campaigns);
      setCollectedEmails(res.collectedEmails);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to load workspace tools.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTools();
  }, []);

  useEffect(() => {
    if (!availableTabs.some((t) => t.key === tab) && availableTabs[0]) {
      setTab(availableTabs[0].key);
    }
  }, [showEdm, showTools, showAi]);

  function promptDelete(url: string, label: string, warning?: string) {
    setDeleteError('');
    setDeleteTarget({ url, label, warning });
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await apiRequest(deleteTarget.url, { method: 'DELETE' });
      onNotify(`Deleted ${deleteTarget.label}.`);
      setDeleteTarget(null);
      await loadTools();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unable to delete record.');
    } finally {
      setDeleting(false);
    }
  }

  function openCreateDoc() {
    setEditingDoc(null);
    setDocTitle('');
    setDocFolder('Operations');
    setDocTags('');
    setDocBody('');
    setEdmModal(true);
  }

  function openEditDoc(d: EdmDocument) {
    setEditingDoc(d);
    setDocTitle(d.title);
    setDocFolder(d.folder);
    setDocTags(d.tags ?? '');
    setDocBody(d.content_text ?? '');
    setEdmModal(true);
  }

  async function handleSaveDoc(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = { title: docTitle, folder: docFolder, mimeType: 'text/plain', tags: docTags, contentText: docBody };
      if (editingDoc) {
        await apiRequest(`/api/edm-documents/${editingDoc.id}`, { method: 'PUT', body: payload });
        onNotify(`Document ${editingDoc.ref} updated.`);
      } else {
        await apiRequest('/api/edm-documents', { method: 'POST', body: payload });
        onNotify('Document stored in EDM vault.');
      }
      setEdmModal(false);
      setEditingDoc(null);
      await loadTools();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save document.', 'error');
    }
  }

  function openCreateBm() {
    setEditingBm(null);
    setBmTitle('');
    setBmUrl('https://');
    setBmCat('Finance & Tax');
    setBmModal(true);
  }

  function openEditBm(b: BookmarkItem) {
    setEditingBm(b);
    setBmTitle(b.title);
    setBmUrl(b.url);
    setBmCat(b.category);
    setBmModal(true);
  }

  async function handleSaveBookmark(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = { title: bmTitle, url: bmUrl, category: bmCat };
      if (editingBm) {
        await apiRequest(`/api/bookmarks/${editingBm.id}`, { method: 'PUT', body: payload });
        onNotify('Bookmark updated.');
      } else {
        await apiRequest('/api/bookmarks', { method: 'POST', body: payload });
        onNotify('Bookmark saved.');
      }
      setBmModal(false);
      setEditingBm(null);
      await loadTools();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save bookmark.', 'error');
    }
  }

  async function handleExportCsv() {
    try {
      const res = await apiRequest<{ dataset: string; count: number; csv: string }>(
        `/api/data/export-csv?dataset=${encodeURIComponent(exportDataset)}`
      );
      setExportedCsv(res.csv);
      const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kscat-${res.dataset}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      onNotify(`Exported ${res.count} ${res.dataset} rows.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Export failed.', 'error');
    }
  }

  async function handleImportCsv(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await apiRequest<{ imported: number }>('/api/data/import-csv', {
        method: 'POST',
        body: { dataset: importDataset, csvText: importCsvText },
      });
      onNotify(`Imported ${res.imported} record(s) into ${importDataset}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Import failed.', 'error');
    }
  }

  function openCreateCamp() {
    setEditingCamp(null);
    setCampSubject('');
    setCampSegment('all_customers');
    setCampBody('');
    setCampModal(true);
  }

  function openEditCamp(c: EmailCampaign) {
    setEditingCamp(c);
    setCampSubject(c.subject);
    setCampSegment((c.target_segment as typeof campSegment) || 'all_customers');
    setCampBody(c.body_text ?? '');
    setCampModal(true);
  }

  async function handleSaveCampaign(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = { subject: campSubject, targetSegment: campSegment, bodyText: campBody };
      if (editingCamp) {
        await apiRequest(`/api/email-campaigns/${editingCamp.id}`, { method: 'PUT', body: payload });
        onNotify(`Campaign ${editingCamp.ref} updated.`);
      } else {
        await apiRequest('/api/email-campaigns', { method: 'POST', body: payload });
        onNotify('Campaign draft created.');
      }
      setCampModal(false);
      setEditingCamp(null);
      await loadTools();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save campaign.', 'error');
    }
  }

  async function handleSendCampaign(id: number) {
    try {
      const res = await apiRequest<EmailCampaign>(`/api/email-campaigns/${id}/send`, { method: 'POST', body: {} });
      onNotify(`Dispatched campaign to ${res.recipient_count} recipients.`);
      await loadTools();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to dispatch campaign.', 'error');
    }
  }

  function openCreateCol() {
    setEditingCol(null);
    setColSender('');
    setColSubject('');
    setColSnippet('');
    setColStatus('unprocessed');
    setColModal(true);
  }

  function openEditCol(em: CollectedEmail) {
    setEditingCol(em);
    setColSender(em.sender_email);
    setColSubject(em.subject);
    setColSnippet(em.snippet ?? '');
    setColStatus(em.status);
    setColModal(true);
  }

  async function handleSaveCollectedEmail(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        senderEmail: colSender,
        subject: colSubject,
        snippet: colSnippet,
        ...(editingCol ? { status: colStatus } : {}),
      };
      if (editingCol) {
        await apiRequest(`/api/collected-emails/${editingCol.id}`, { method: 'PUT', body: payload });
        onNotify('Collected email updated.');
      } else {
        await apiRequest('/api/collected-emails', { method: 'POST', body: payload });
        onNotify('Inbound email ingested into collector queue.');
      }
      setColModal(false);
      setEditingCol(null);
      await loadTools();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save email.', 'error');
    }
  }

  async function handleConvertToTicket(id: number) {
    try {
      const res = await apiRequest<{ ticketRef: string }>(`/api/collected-emails/${id}/convert-ticket`, {
        method: 'POST',
        body: {},
      });
      onNotify(`Converted inbound message to support ticket ${res.ticketRef}.`);
      await loadTools();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Conversion failed.', 'error');
    }
  }

  async function handleFetchRss(e: FormEvent) {
    e.preventDefault();
    setRssLoading(true);
    try {
      const res = await apiRequest<{ url: string; items: Array<{ title: string; link: string; published: string }> }>(
        '/api/rss/fetch',
        { method: 'POST', body: { url: rssUrl } }
      );
      setRssItems(res.items);
      onNotify(`Loaded ${res.items.length} feed entries.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to load RSS feed.', 'error');
    } finally {
      setRssLoading(false);
    }
  }

  async function handleRunAi(e: FormEvent) {
    e.preventDefault();
    setAiRunning(true);
    try {
      const res = await apiRequest<{ text: string; model: string }>('/api/ai/assist', {
        method: 'POST',
        body: { taskType: aiTask, contextRef: aiRef || undefined, prompt: aiPrompt },
      });
      setAiOutput(res.text);
      onNotify('AI response generated.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'AI assistant error.', 'error');
    } finally {
      setAiRunning(false);
    }
  }

  const currentTab = availableTabs.find((t) => t.key === tab)?.key ?? availableTabs[0]?.key;

  return (
    <div className="space-y-5">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-zinc-200/70 dark:bg-zinc-800 self-start">
          {availableTabs.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap ${
                currentTab === key
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {canWrite && (
          <div className="flex items-center gap-2">
            {currentTab === 'edm' && (
              <button
                type="button"
                onClick={openCreateDoc}
                className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Document</span>
              </button>
            )}
            {currentTab === 'bookmarks' && (
              <button
                type="button"
                onClick={openCreateBm}
                className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Bookmark</span>
              </button>
            )}
            {currentTab === 'campaigns' && (
              <button
                type="button"
                onClick={openCreateCamp}
                className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Draft Campaign</span>
              </button>
            )}
            {currentTab === 'collector' && (
              <button
                type="button"
                onClick={openCreateCol}
                className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Ingest Email</span>
              </button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="p-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-center text-sm text-zinc-500">
          Loading workspace utilities...
        </div>
      ) : (
        <>
          {currentTab === 'edm' && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-50 dark:bg-zinc-950 text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                  <tr>
                    <th className="px-4 py-3 font-medium">Ref</th>
                    <th className="px-4 py-3 font-medium">Document Title</th>
                    <th className="px-4 py-3 font-medium">Folder</th>
                    <th className="px-4 py-3 font-medium">Tags</th>
                    <th className="px-4 py-3 font-medium text-right">Size</th>
                    <th className="px-4 py-3 font-medium">Uploaded</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {documents.map((d) => (
                    <tr key={d.id}>
                      <td className="px-4 py-3 font-mono text-orange-700 dark:text-orange-400">{d.ref}</td>
                      <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">{d.title}</td>
                      <td className="px-4 py-3">{d.folder}</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-zinc-500">{d.tags || '—'}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{d.size_bytes} B</td>
                      <td className="px-4 py-3 text-zinc-500">{formatDateTime(d.created_at)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setViewDoc(d)}
                            className="text-orange-700 dark:text-orange-400 font-medium hover:underline"
                          >
                            Open
                          </button>
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => openEditDoc(d)}
                              aria-label={`Edit ${d.title}`}
                              className="p-1 text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => promptDelete(`/api/edm-documents/${d.id}`, `${d.ref} (${d.title})`)}
                              aria-label={`Delete ${d.title}`}
                              className="p-1 text-zinc-400 hover:text-red-600"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {documents.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                        Electronic Document Vault is empty.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {currentTab === 'bookmarks' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {bookmarks.map((b) => (
                <div
                  key={b.id}
                  className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="text-[11px] font-medium text-zinc-500">{b.category}</div>
                    <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{b.title}</div>
                    <div className="mt-1 text-xs font-mono text-zinc-500 truncate">{b.url}</div>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-zinc-100 dark:border-zinc-800 text-xs">
                    <a
                      href={b.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-orange-700 dark:text-orange-400 font-medium hover:underline inline-flex items-center gap-1"
                    >
                      <span>Open Link</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <div className="inline-flex items-center gap-1.5">
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => openEditBm(b)}
                          aria-label={`Edit ${b.title}`}
                          className="p-1 text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => promptDelete(`/api/bookmarks/${b.id}`, b.title)}
                          aria-label={`Remove ${b.title}`}
                          className="p-1 text-zinc-400 hover:text-red-600"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {currentTab === 'data' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">CSV Data Export</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Generate formula-sanitized CSV exports for ERP migration or audit review.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    value={exportDataset}
                    onChange={(e) => setExportDataset(e.target.value as typeof exportDataset)}
                    className="flex-1 px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                  >
                    <option value="third_parties">Third Parties Directory</option>
                    <option value="products">Products & Barcodes Catalog</option>
                    <option value="invoices">Customer & Supplier Invoices</option>
                  </select>
                  <button
                    type="button"
                    disabled={!canExport}
                    onClick={handleExportCsv}
                    className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 disabled:opacity-50 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export CSV</span>
                  </button>
                </div>
                {exportedCsv && (
                  <pre className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-[11px] font-mono overflow-x-auto max-h-56">
                    {exportedCsv}
                  </pre>
                )}
              </div>

              <form
                onSubmit={handleImportCsv}
                className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-4"
              >
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Batch CSV Import</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Paste CSV rows with header line (max 200 records per batch).
                  </p>
                </div>
                <select
                  value={importDataset}
                  onChange={(e) => {
                    const ds = e.target.value as 'third_parties' | 'products';
                    setImportDataset(ds);
                    setImportCsvText(
                      ds === 'products'
                        ? 'ref,name,product_type,category,cost_price,sell_price,barcode\nIMP-SW24,24-Port PoE Switch,product,Networking,185,349,3700001122334'
                        : 'name,party_type,email,phone,city,country\nNordic Freight Partners,supplier,ops@nordicfreight.example,+45 32 10 22 44,Copenhagen,Denmark'
                    );
                  }}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  <option value="third_parties">Third Parties (name,party_type,email,phone,city,country)</option>
                  <option value="products">Products (ref,name,product_type,category,cost_price,sell_price,barcode)</option>
                </select>
                <textarea
                  rows={5}
                  value={importCsvText}
                  onChange={(e) => setImportCsvText(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={!canExport}
                    className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 disabled:opacity-50 text-white text-xs font-medium inline-flex items-center gap-1.5"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Import Records</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {currentTab === 'campaigns' && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-50 dark:bg-zinc-950 text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                  <tr>
                    <th className="px-4 py-3 font-medium">Ref</th>
                    <th className="px-4 py-3 font-medium">Subject</th>
                    <th className="px-4 py-3 font-medium">Audience Segment</th>
                    <th className="px-4 py-3 font-medium text-right">Recipients</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Sent At</th>
                    <th className="px-4 py-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {campaigns.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-3 font-mono text-orange-700 dark:text-orange-400">{c.ref}</td>
                      <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">{c.subject}</td>
                      <td className="px-4 py-3 font-mono">{c.target_segment}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{c.recipient_count}</td>
                      <td className="px-4 py-3"><StatusText status={c.status} /></td>
                      <td className="px-4 py-3 text-zinc-500">{c.sent_at ? formatDateTime(c.sent_at) : '—'}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {c.status === 'draft' && canWrite && (
                            <button
                              type="button"
                              onClick={() => handleSendCampaign(c.id)}
                              className="text-orange-700 dark:text-orange-400 font-medium hover:underline inline-flex items-center gap-1"
                            >
                              <Send className="w-3 h-3" />
                              <span>Dispatch Now</span>
                            </button>
                          )}
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => openEditCamp(c)}
                              title={`Edit ${c.ref}`}
                              className="p-1 text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => promptDelete(`/api/email-campaigns/${c.id}`, `${c.ref} (${c.subject})`)}
                              title={`Delete ${c.ref}`}
                              className="p-1 text-zinc-400 hover:text-red-600"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {campaigns.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                        No mass email campaigns created.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {currentTab === 'collector' && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-50 dark:bg-zinc-950 text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                  <tr>
                    <th className="px-4 py-3 font-medium">Sender</th>
                    <th className="px-4 py-3 font-medium">Matched Account</th>
                    <th className="px-4 py-3 font-medium">Subject & Snippet</th>
                    <th className="px-4 py-3 font-medium">Received</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Workflow</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {collectedEmails.map((em) => (
                    <tr key={em.id}>
                      <td className="px-4 py-3 font-mono">{em.sender_email}</td>
                      <td className="px-4 py-3 font-medium">{em.matched_party || 'Unmatched'}</td>
                      <td className="px-4 py-3 max-w-md">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">{em.subject}</div>
                        <div className="text-[11px] text-zinc-500 truncate">{em.snippet}</div>
                      </td>
                      <td className="px-4 py-3 text-zinc-500">{formatDateTime(em.received_at)}</td>
                      <td className="px-4 py-3"><StatusText status={em.status} /></td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {em.status === 'unprocessed' && canConvertTicket && (
                            <button
                              type="button"
                              onClick={() => handleConvertToTicket(em.id)}
                              className="text-orange-700 dark:text-orange-400 font-medium hover:underline"
                            >
                              Convert to Ticket
                            </button>
                          )}
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => openEditCol(em)}
                              title={`Edit ${em.subject}`}
                              className="p-1 text-zinc-500 hover:text-orange-700 dark:hover:text-orange-400"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => promptDelete(`/api/collected-emails/${em.id}`, em.subject)}
                              title={`Delete ${em.subject}`}
                              className="p-1 text-zinc-400 hover:text-red-600"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {collectedEmails.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                        Email collector queue is empty.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {currentTab === 'rss' && (
            <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-4">
              <form onSubmit={handleFetchRss} className="flex flex-col sm:flex-row gap-3">
                <input
                  type="url"
                  required
                  value={rssUrl}
                  onChange={(e) => setRssUrl(e.target.value)}
                  placeholder="https://example.com/feed.xml"
                  className="flex-1 px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
                />
                <button
                  type="submit"
                  disabled={rssLoading}
                  className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 disabled:opacity-50 text-white text-xs font-medium whitespace-nowrap"
                >
                  {rssLoading ? 'Fetching Feed...' : 'Fetch RSS / Atom Feed'}
                </button>
              </form>
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {rssItems.map((item, idx) => (
                  <div key={idx} className="py-3 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.title}</div>
                      {item.published && <div className="text-xs text-zinc-500 mt-0.5">{item.published}</div>}
                    </div>
                    {item.link && (
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-orange-700 dark:text-orange-400 font-medium hover:underline inline-flex items-center gap-1 shrink-0"
                      >
                        <span>Read</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                ))}
                {rssItems.length === 0 && (
                  <div className="py-6 text-center text-xs text-zinc-500">
                    Enter an external RSS or Atom feed URL above to inspect recent updates inside KSCAT-ERP.
                  </div>
                )}
              </div>
            </div>
          )}

          {currentTab === 'ai' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <form
                onSubmit={handleRunAi}
                className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-4"
              >
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">ERP AI Assistant</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Generate executive summaries, proposal scopes, campaign copy, or operational answers via server-side Gemini API.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">Task Mode</label>
                    <select
                      value={aiTask}
                      onChange={(e) => setAiTask(e.target.value as typeof aiTask)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                    >
                      <option value="executive_brief">Executive Operations Brief</option>
                      <option value="proposal_scope">Commercial Proposal Scope</option>
                      <option value="email_campaign">Mass Email Copy</option>
                      <option value="ticket_reply">Support Ticket Response</option>
                      <option value="custom_qa">Custom ERP Q&A</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Record Reference (Optional)</label>
                    <input
                      type="text"
                      value={aiRef}
                      onChange={(e) => setAiRef(e.target.value)}
                      placeholder="e.g. PR2611-0001"
                      className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Prompt / Context</label>
                  <textarea
                    rows={5}
                    required
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="Summarize overdue receivables, open manufacturing orders, and key client actions..."
                    className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={aiRunning || !canWrite}
                    className="px-4 py-2 rounded-lg bg-orange-700 hover:bg-orange-800 disabled:opacity-50 text-white text-xs font-medium inline-flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{aiRunning ? 'Generating...' : 'Run AI Assist'}</span>
                  </button>
                </div>
              </form>

              <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col justify-between gap-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Generated Output</h3>
                    {aiOutput && (
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(aiOutput);
                          setCopiedAi(true);
                          setTimeout(() => setCopiedAi(false), 1600);
                        }}
                        className="text-xs text-orange-700 dark:text-orange-400 hover:underline inline-flex items-center gap-1"
                      >
                        {copiedAi ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedAi ? 'Copied' : 'Copy'}</span>
                      </button>
                    )}
                  </div>
                  <div className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap min-h-[220px] leading-relaxed">
                    {aiOutput || 'Run an AI task on the left to generate operational copy or executive summaries.'}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Upload / Edit EDM Document Modal */}
      <Modal
        open={edmModal}
        onClose={() => {
          setEdmModal(false);
          setEditingDoc(null);
        }}
        title={editingDoc ? `Edit ${editingDoc.ref}` : 'Register EDM Document'}
      >
        <form onSubmit={handleSaveDoc} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Title</label>
              <input
                type="text"
                required
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Folder</label>
              <input
                type="text"
                value={docFolder}
                onChange={(e) => setDocFolder(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Tags (comma-separated)</label>
            <input
              type="text"
              value={docTags}
              onChange={(e) => setDocTags(e.target.value)}
              placeholder="iso, sop, contract"
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Document Content / Notes</label>
            <textarea
              rows={4}
              value={docBody}
              onChange={(e) => setDocBody(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setEdmModal(false);
                setEditingDoc(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium">
              {editingDoc ? 'Save Document' : 'Store Document'}
            </button>
          </div>
        </form>
      </Modal>

      {/* View EDM Document Modal */}
      <Modal open={Boolean(viewDoc)} onClose={() => setViewDoc(null)} title={viewDoc ? `${viewDoc.ref} — ${viewDoc.title}` : ''}>
        {viewDoc && (
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between text-zinc-500">
              <span>Folder: {viewDoc.folder}</span>
              <span>Uploaded by: {viewDoc.uploaded_by}</span>
            </div>
            <pre className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 whitespace-pre-wrap font-mono text-xs max-h-80 overflow-y-auto">
              {viewDoc.content_text || '(No text content)'}
            </pre>
          </div>
        )}
      </Modal>

      {/* Bookmark Modal */}
      <Modal
        open={bmModal}
        onClose={() => {
          setBmModal(false);
          setEditingBm(null);
        }}
        title={editingBm ? 'Edit Bookmark' : 'Add Shared Bookmark'}
      >
        <form onSubmit={handleSaveBookmark} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Title</label>
            <input
              type="text"
              required
              value={bmTitle}
              onChange={(e) => setBmTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">URL (https://)</label>
            <input
              type="url"
              required
              value={bmUrl}
              onChange={(e) => setBmUrl(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Category</label>
            <input
              type="text"
              value={bmCat}
              onChange={(e) => setBmCat(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setBmModal(false);
                setEditingBm(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium">
              {editingBm ? 'Save Bookmark' : 'Save Bookmark'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Email Campaign Modal */}
      <Modal
        open={campModal}
        onClose={() => {
          setCampModal(false);
          setEditingCamp(null);
        }}
        title={editingCamp ? `Edit ${editingCamp.ref}` : 'Draft Mass Email Campaign'}
      >
        <form onSubmit={handleSaveCampaign} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Subject Line</label>
            <input
              type="text"
              required
              value={campSubject}
              onChange={(e) => setCampSubject(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Target Audience</label>
            <select
              value={campSegment}
              onChange={(e) => setCampSegment(e.target.value as typeof campSegment)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            >
              <option value="all_customers">Active Customers</option>
              <option value="prospects">Qualified Prospects / Leads</option>
              <option value="all_members">Foundation & Association Members</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Email Body</label>
            <textarea
              rows={4}
              required
              value={campBody}
              onChange={(e) => setCampBody(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setCampModal(false);
                setEditingCamp(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium">
              {editingCamp ? 'Save Campaign' : 'Save Draft'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Ingest / Edit Email Collector Modal */}
      <Modal
        open={colModal}
        onClose={() => {
          setColModal(false);
          setEditingCol(null);
        }}
        title={editingCol ? 'Edit Collected Email' : 'Ingest Inbound Email'}
      >
        <form onSubmit={handleSaveCollectedEmail} className="space-y-4">
          <div className={editingCol ? 'grid grid-cols-2 gap-3' : ''}>
            <div>
              <label className="block text-xs font-medium mb-1">Sender Email</label>
              <input
                type="email"
                required
                value={colSender}
                onChange={(e) => setColSender(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
            {editingCol && (
              <div>
                <label className="block text-xs font-medium mb-1">Status</label>
                <select
                  value={colStatus}
                  onChange={(e) => setColStatus(e.target.value as CollectedEmail['status'])}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                >
                  <option value="unprocessed">Unprocessed</option>
                  <option value="converted_ticket">Converted to Ticket</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Subject</label>
            <input
              type="text"
              required
              value={colSubject}
              onChange={(e) => setColSubject(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Message Snippet</label>
            <textarea
              rows={3}
              value={colSnippet}
              onChange={(e) => setColSnippet(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setColModal(false);
                setEditingCol(null);
              }}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-orange-700 text-white text-xs font-medium">
              {editingCol ? 'Save Email' : 'Collect Email'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        itemLabel={deleteTarget?.label ?? ''}
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

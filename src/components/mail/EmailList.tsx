import React, { useCallback, useEffect, useState } from 'react';
import { Search, ChevronLeft, ChevronRight, Loader2, Inbox, Paperclip, Link2, ArrowDownWideNarrow } from 'lucide-react';
import type { EmailListQuery, EmailListResult, EmailProviderId, EmailRecord } from '../../types';
import { mailApi } from '../../api/client';
import { Notice, EmptyState } from '../ui/primitives';
import { AnalyzedTag, ProviderChip, RiskStatus, formatDateTime } from './shared';

const FILTERS: Array<{ id: NonNullable<EmailListQuery['filter']>; label: string; cls: string }> = [
  { id: 'all', label: 'All', cls: 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-white' },
  { id: 'safe', label: 'Safe', cls: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' },
  { id: 'low', label: 'Low', cls: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' },
  { id: 'medium', label: 'Medium', cls: 'bg-amber-500/15 text-amber-900 dark:text-amber-300' },
  { id: 'high', label: 'High', cls: 'bg-orange-500/15 text-orange-900 dark:text-orange-300' },
  { id: 'critical', label: 'Critical', cls: 'bg-rose-500/15 text-rose-900 dark:text-rose-300' },
  { id: 'analyzed', label: 'Analysed', cls: 'bg-sky-500/15 text-sky-900 dark:text-sky-300' },
  { id: 'not_analyzed', label: 'Not analysed', cls: 'bg-slate-500/15 text-slate-800 dark:text-slate-300' },
];

interface Props {
  provider: EmailProviderId | 'all';
  selectedId: string | null;
  onSelect: (record: EmailRecord) => void;
  /** Bumped by the parent to force a reload (after sync / analysis / delete). */
  refreshKey: number;
  defaultSort?: 'received' | 'risk';
  emptyTitle?: string;
  emptyBody?: string;
  onCountChange?: (total: number) => void;
}

export const EmailList: React.FC<Props> = ({ provider, selectedId, onSelect, refreshKey, defaultSort = 'received', emptyTitle, emptyBody, onCountChange }) => {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<NonNullable<EmailListQuery['filter']>>('all');
  const [sort, setSort] = useState<'received' | 'risk'>(defaultSort);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<EmailListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debounced, filter, sort, provider]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await mailApi.list({ provider, search: debounced, filter, page, pageSize: 20, sort });
    setLoading(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setError(null);
    setResult(res.data);
    onCountChange?.(res.data.total);
  }, [provider, debounced, filter, page, sort, onCountChange]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const items = result?.items || [];

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            id="mail-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search subject, sender or threat category"
            aria-label="Search emails"
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-white dark:bg-slate-950/90 border border-slate-300 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/40"
          />
        </div>
        <button type="button" onClick={() => setSort(sort === 'received' ? 'risk' : 'received')} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap" title="Toggle sort order">
          <ArrowDownWideNarrow className="w-3.5 h-3.5" aria-hidden="true" /> {sort === 'received' ? 'Newest first' : 'Highest risk first'}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" id={`mail-filter-${f.id}`} onClick={() => setFilter(f.id)} aria-pressed={filter === f.id} className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors cursor-pointer ${filter === f.id ? `${f.cls} border-transparent shadow-xs` : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/85 dark:bg-slate-900/80 overflow-hidden">
        {loading && !result ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-600 dark:text-slate-400"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading…</div>
        ) : items.length === 0 ? (
          <EmptyState icon={Inbox} title={emptyTitle || 'No emails here yet'} body={emptyBody || (debounced || filter !== 'all' ? 'Nothing matches this search or filter.' : 'Sync your mailbox or analyse an email from the Outlook add-in to populate this list.')} />
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800" aria-busy={loading}>
            {items.map((r) => {
              const on = r.id === selectedId;
              return (
                <li key={r.id}>
                  <button type="button" onClick={() => onSelect(r)} aria-current={on ? 'true' : undefined} className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors cursor-pointer ${on ? 'bg-rose-50/70 dark:bg-rose-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {provider === 'all' && <ProviderChip provider={r.provider} />}
                        <span className={`text-sm truncate ${r.isRead === false ? 'font-bold text-slate-900 dark:text-white' : 'font-semibold text-slate-800 dark:text-slate-100'}`}>{r.subject || '(no subject)'}</span>
                        {r.hasAttachments && <Paperclip className="w-3 h-3 text-amber-600 flex-shrink-0" aria-label="Has attachment" />}
                        {r.urls.length > 0 && <Link2 className="w-3 h-3 text-blue-600 flex-shrink-0" aria-label="Contains links" />}
                      </div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-400 truncate">{r.senderName ? `${r.senderName} · ` : ''}{r.senderEmail || 'unknown sender'}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-500 flex items-center gap-2 flex-wrap mt-0.5">
                        <span>{formatDateTime(r.receivedAt)}</span>
                        {r.threatCategory && r.riskLevel !== 'LOW' && <span className="text-slate-700 dark:text-slate-300 font-medium">· {r.threatCategory}</span>}
                        <AnalyzedTag record={r} />
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-right"><RiskStatus record={r} /></div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {result && result.pageCount > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
          <span>{result.total.toLocaleString()} email{result.total === 1 ? '' : 's'} · page {result.page} of {result.pageCount}</span>
          <div className="flex items-center gap-1">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer" aria-label="Previous page"><ChevronLeft className="w-4 h-4" aria-hidden="true" /></button>
            <button type="button" disabled={page >= result.pageCount} onClick={() => setPage((p) => Math.min(result.pageCount, p + 1))} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer" aria-label="Next page"><ChevronRight className="w-4 h-4" aria-hidden="true" /></button>
          </div>
        </div>
      )}
    </div>
  );
};

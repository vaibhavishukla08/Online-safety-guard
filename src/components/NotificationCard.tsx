import React from 'react';
import { AlertTriangle, ShieldAlert, Eye, FileSearch, X, OctagonAlert, Info } from 'lucide-react';
import type { NotificationItem } from '../types';
import { LEVEL_TOKENS } from '../utils/risk';
import { RiskBadge } from './ui/primitives';
import { ProviderChip, timeAgo } from './mail/shared';

interface Props {
  item: NotificationItem;
  onNavigate: (to: string) => void;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
  compact?: boolean;
}

const ICONS = { CRITICAL: OctagonAlert, HIGH: ShieldAlert, MEDIUM: AlertTriangle, LOW: Info } as const;

export const NotificationCard: React.FC<Props> = ({ item, onNavigate, onMarkRead, onDismiss, compact }) => {
  const t = LEVEL_TOKENS[item.level];
  const Icon = ICONS[item.level];
  const open = (view: 'summary' | 'investigation') => {
    if (item.status === 'unread') onMarkRead(item.id);
    onNavigate(`/dashboard/${item.provider}?email=${encodeURIComponent(item.emailId)}${view === 'investigation' ? '&view=investigation' : ''}`);
  };
  return (
    <div className={`rounded-xl border p-3.5 ${t.border} ${item.status === 'unread' ? t.bg : 'bg-white/70 dark:bg-slate-900/60'} ${item.status === 'dismissed' ? 'opacity-60' : ''}`} role="article" aria-label={item.title}>
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${t.text}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-slate-900 dark:text-white">{item.status === 'unread' ? '⚠️ ' : ''}{item.title}</span>
            <RiskBadge level={item.level} size="sm" />
            <span className="text-[11px] font-mono font-bold text-slate-700 dark:text-slate-300">{item.riskScore}/100</span>
            <ProviderChip provider={item.provider} />
            {item.status === 'unread' && <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300">new</span>}
          </div>
          {item.sender && <div className="text-xs text-slate-700 dark:text-slate-300 mt-1 break-all"><span className="text-slate-500">Sender:</span> {item.sender}</div>}
          <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{item.body}</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-500 mt-1">{timeAgo(item.createdAt)}</div>
          {!compact && (
            <div className="flex items-center gap-2 flex-wrap mt-2.5">
              <button type="button" onClick={() => open('summary')} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 cursor-pointer"><Eye className="w-3.5 h-3.5" aria-hidden="true" /> View Email</button>
              <button type="button" onClick={() => open('investigation')} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"><FileSearch className="w-3.5 h-3.5" aria-hidden="true" /> View Investigation</button>
              {item.status !== 'dismissed' && <button type="button" onClick={() => onDismiss(item.id)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"><X className="w-3.5 h-3.5" aria-hidden="true" /> Dismiss</button>}
            </div>
          )}
        </div>
        {compact && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button type="button" onClick={() => open('summary')} title="View email" aria-label="View email" className="p-1.5 rounded-lg hover:bg-white/60 dark:hover:bg-slate-800 cursor-pointer"><Eye className="w-4 h-4" aria-hidden="true" /></button>
            <button type="button" onClick={() => open('investigation')} title="View investigation" aria-label="View investigation" className="p-1.5 rounded-lg hover:bg-white/60 dark:hover:bg-slate-800 cursor-pointer"><FileSearch className="w-4 h-4" aria-hidden="true" /></button>
            <button type="button" onClick={() => onDismiss(item.id)} title="Dismiss" aria-label="Dismiss" className="p-1.5 rounded-lg hover:bg-white/60 dark:hover:bg-slate-800 cursor-pointer"><X className="w-4 h-4" aria-hidden="true" /></button>
          </div>
        )}
      </div>
    </div>
  );
};

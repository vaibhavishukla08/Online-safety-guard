import React from 'react';
import { Inbox, Mail, LogIn, Loader2, CheckCircle2, Clock, XCircle, type LucideIcon } from 'lucide-react';
import type { EmailProviderId, EmailRecord } from '../../types';
import { RiskBadge, PrimaryButton, Card } from '../ui/primitives';
import { useAuth } from '../../auth/AuthContext';

export const PROVIDER_META: Record<EmailProviderId, { label: string; icon: LucideIcon; tone: string; chip: string; connectLabel: string; description: string }> = {
  outlook: { label: 'Outlook', icon: Mail, tone: 'text-blue-700 dark:text-blue-300', chip: 'bg-blue-500/10 border-blue-500/30 text-blue-800 dark:text-blue-200', connectLabel: 'Connect Outlook', description: 'Sign in with Microsoft and allow read-only access to your own mailbox (Mail.Read). Only you can see it.' },
  gmail: { label: 'Gmail', icon: Inbox, tone: 'text-red-700 dark:text-red-300', chip: 'bg-red-500/10 border-red-500/30 text-red-800 dark:text-red-200', connectLabel: 'Connect Gmail', description: 'Sign in with Google and allow read-only access to your own Gmail (gmail.readonly). Only you can see it.' },
};

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return 'unknown';
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export const ProviderChip: React.FC<{ provider: EmailProviderId; className?: string }> = ({ provider, className = '' }) => {
  const m = PROVIDER_META[provider];
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold border ${m.chip} ${className}`}>
      <Icon className="w-3 h-3" aria-hidden="true" /> {m.label}
    </span>
  );
};

/** Risk badge for analysed emails; status pill otherwise. */
export const RiskStatus: React.FC<{ record: EmailRecord; size?: 'sm' | 'md' }> = ({ record, size = 'sm' }) => {
  if (record.analysisStatus === 'analyzed' && record.riskLevel) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <RiskBadge level={record.riskLevel} size={size} />
        <span className="text-[11px] font-mono font-bold text-slate-700 dark:text-slate-300 tabular-nums">{record.riskScore}/100</span>
      </span>
    );
  }
  if (record.analysisStatus === 'analyzing') return <span className="inline-flex items-center gap-1 text-[11px] text-rose-700 dark:text-rose-300 font-semibold"><Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> Analysing…</span>;
  if (record.analysisStatus === 'failed') return <span className="inline-flex items-center gap-1 text-[11px] text-amber-800 dark:text-amber-300 font-semibold" title={record.analysisError || ''}><XCircle className="w-3 h-3" aria-hidden="true" /> Analysis failed</span>;
  return <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 font-medium"><Clock className="w-3 h-3" aria-hidden="true" /> Not analysed</span>;
};

export const AnalyzedTag: React.FC<{ record: EmailRecord }> = ({ record }) =>
  record.analysisStatus === 'analyzed' ? (
    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="w-3 h-3" aria-hidden="true" /> Analysed {timeAgo(record.analyzedAt)}</span>
  ) : null;

/** Renders children only for signed-in users; otherwise a sign-in prompt. */
export const RequireAuth: React.FC<React.PropsWithChildren<{ onNavigate: (to: string) => void; feature: string }>> = ({ onNavigate, feature, children }) => {
  const { status } = useAuth();
  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-600 dark:text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Checking your session…
      </div>
    );
  }
  if (status === 'anonymous') {
    return (
      <Card className="max-w-xl mx-auto text-center space-y-4 py-10">
        <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-500 mx-auto flex items-center justify-center">
          <LogIn className="w-7 h-7" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Sign in to use {feature}</h2>
        <p className="text-xs text-slate-600 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
          Mailbox history, saved analyses and notifications are tied to your account so that only you can see your own emails. Investigations without an account still work from the Investigate tab.
        </p>
        <PrimaryButton onClick={() => onNavigate(`/login?next=${encodeURIComponent(window.location.pathname)}`)}>
          <LogIn className="w-4 h-4" aria-hidden="true" /> Sign in or create an account
        </PrimaryButton>
      </Card>
    );
  }
  return <>{children}</>;
};

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Loader2, Unplug, Link as LinkIcon, Clock, AlertTriangle, CheckCircle2, Info, PlugZap, Puzzle } from 'lucide-react';
import type { ConnectionStatus, EmailProviderId, EmailRecord, EmailRecordDetail } from '../types';
import { connectionsApi, getHealth } from '../api/client';
import { Card, Notice, PrimaryButton, SecondaryButton } from '../components/ui/primitives';
import { EmailList } from '../components/mail/EmailList';
import { EmailDetail } from '../components/mail/EmailDetail';
import { PROVIDER_META, RequireAuth, timeAgo, formatDateTime } from '../components/mail/shared';

interface Props {
  provider: EmailProviderId;
  search: URLSearchParams;
  onNavigate: (to: string, opts?: { replace?: boolean }) => void;
  onOpenCoach: () => void;
}

export const MailboxPage: React.FC<Props> = (props) => (
  <RequireAuth onNavigate={props.onNavigate} feature={`${PROVIDER_META[props.provider].label} history`}>
    <MailboxInner {...props} />
  </RequireAuth>
);

const MailboxInner: React.FC<Props> = ({ provider, search, onNavigate, onOpenCoach }) => {
  const meta = PROVIDER_META[provider];
  const Icon = meta.icon;
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [flash, setFlash] = useState<{ tone: 'info' | 'success' | 'error' | 'warn'; text: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<string | null>(search.get('email'));
  const [initialView, setInitialView] = useState<'summary' | 'investigation'>(search.get('view') === 'investigation' ? 'investigation' : 'summary');
  const [syncInterval, setSyncInterval] = useState<number | null>(null);

  const loadStatus = useCallback(async () => {
    const res = await connectionsApi.list();
    if (res.ok) setStatus(res.data.connections.find((c) => c.provider === provider) || null);
  }, [provider]);

  useEffect(() => {
    void loadStatus();
    getHealth().then((h) => setSyncInterval(h?.sync?.enabled ? h.sync.intervalMinutes : 0));
  }, [loadStatus]);

  // Messages coming back from the OAuth redirect.
  useEffect(() => {
    if (search.get('connected') === '1') {
      setFlash({ tone: 'success', text: `${meta.label} connected. Click "Sync ${meta.label}" to fetch your recent messages.` });
      onNavigate(`/dashboard/${provider}`, { replace: true });
    } else if (search.get('error')) {
      setFlash({ tone: 'error', text: search.get('error') || 'Connection failed.' });
      onNavigate(`/dashboard/${provider}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, provider]);

  useEffect(() => {
    const id = search.get('email');
    if (id) {
      setSelected(id);
      setInitialView(search.get('view') === 'investigation' ? 'investigation' : 'summary');
    }
  }, [search]);

  const sync = async () => {
    setSyncing(true);
    setFlash(null);
    const res = await connectionsApi.sync(provider);
    setSyncing(false);
    if (!res.ok) {
      setFlash({ tone: res.error.code === 'expired' ? 'warn' : 'error', text: res.error.message });
      await loadStatus();
      return;
    }
    const r = res.data.result;
    setStatus(res.data.status);
    setRefreshKey((k) => k + 1);
    setFlash({ tone: r.autoAnalyzed ? 'success' : 'info', text: `Sync complete: ${r.fetched} message${r.fetched === 1 ? '' : 's'} checked, ${r.newRecords} new, ${r.autoAnalyzed} analysed automatically${r.notificationsCreated ? `, ${r.notificationsCreated} notification${r.notificationsCreated === 1 ? '' : 's'} created` : ''}${r.skippedByPolicy ? `. ${r.skippedByPolicy} message${r.skippedByPolicy === 1 ? '' : 's'} did not meet the pre-filter threshold — open one and click "Analyze Email" to check it manually.` : '.'}` });
  };

  const disconnect = async () => {
    const wipe = window.confirm(`Disconnect ${meta.label}?\n\nOK = disconnect and also delete the stored ${meta.label} history.\nCancel = keep going.`);
    if (!wipe) return;
    const res = await connectionsApi.disconnect(provider, true);
    if (!res.ok) {
      setFlash({ tone: 'error', text: res.error.message });
      return;
    }
    setStatus(res.data.status);
    setRefreshKey((k) => k + 1);
    setSelected(null);
    setFlash({ tone: 'info', text: `${meta.label} disconnected. Access tokens were removed${res.data.deletedHistory ? ` and ${res.data.deletedHistory} stored email${res.data.deletedHistory === 1 ? '' : 's'} deleted` : ''}.` });
  };

  const onSelect = (r: EmailRecord) => {
    setInitialView('summary');
    setSelected(r.id);
    document.getElementById('email-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const onChanged = (_record: EmailRecordDetail | null) => {
    setRefreshKey((k) => k + 1);
    void loadStatus();
  };

  const connected = status?.state === 'active';
  const expired = status?.state === 'expired';

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white flex items-center gap-2"><Icon className={`w-7 h-7 ${meta.tone}`} aria-hidden="true" /> {meta.label} history</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Recent messages from your connected mailbox and every analysis saved for them. Detection is periodic — it runs when you sync{syncInterval ? ` and automatically every ${syncInterval} minutes` : ''}, not in real time.</p>
        </div>
      </div>

      {/* Connection card */}
      <Card>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${connected ? 'bg-emerald-500/15 text-emerald-600' : expired ? 'bg-amber-500/15 text-amber-600' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'}`}>
              {connected ? <PlugZap className="w-5 h-5" aria-hidden="true" /> : expired ? <AlertTriangle className="w-5 h-5" aria-hidden="true" /> : <Unplug className="w-5 h-5" aria-hidden="true" />}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-slate-900 dark:text-white">
                {status === null ? 'Checking connection…' : connected ? `Connected as ${status.accountEmail || 'your account'}` : expired ? `${meta.label} connection expired` : status.state === 'not_configured' ? `${meta.label} sign-in is not configured on this server` : `${meta.label} not connected`}
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                {status?.state === 'not_configured' ? `The server needs ${provider === 'outlook' ? 'MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET' : 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET'} before ${meta.label} can be connected.` : connected || expired ? (
                  <span className="flex items-center gap-3 flex-wrap">
                    <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" aria-hidden="true" /> Last sync: {status?.lastSyncAt ? `${timeAgo(status.lastSyncAt)} (${formatDateTime(status.lastSyncAt)})` : 'never'}</span>
                    <span>{status?.messageCount} stored · {status?.analyzedCount} analysed</span>
                    {status?.lastSyncSummary && <span className="text-slate-500">· {status.lastSyncSummary}</span>}
                  </span>
                ) : meta.description}
                {status?.lastSyncError && <span className="block text-amber-800 dark:text-amber-300 mt-0.5">{status.lastSyncError}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {connected ? (
              <>
                <PrimaryButton id="btn-sync" onClick={sync} disabled={syncing} className="px-4 py-2 text-xs">{syncing ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-4 h-4" aria-hidden="true" />} {syncing ? 'Syncing…' : `Sync ${meta.label}`}</PrimaryButton>
                <SecondaryButton onClick={() => { setRefreshKey((k) => k + 1); void loadStatus(); }}><RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Refresh history</SecondaryButton>
                <SecondaryButton onClick={disconnect} className="text-rose-700 dark:text-rose-300"><Unplug className="w-3.5 h-3.5" aria-hidden="true" /> Disconnect</SecondaryButton>
              </>
            ) : status?.state === 'not_configured' ? null : (
              <>
                <a id="btn-connect" href={connectionsApi.startUrl(provider)} className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 via-rose-500 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-bold text-xs shadow-md cursor-pointer">
                  <LinkIcon className="w-4 h-4" aria-hidden="true" /> {expired ? `Reconnect ${meta.label}` : meta.connectLabel}
                </a>
                {expired && <SecondaryButton onClick={disconnect}><Unplug className="w-3.5 h-3.5" aria-hidden="true" /> Remove</SecondaryButton>}
              </>
            )}
          </div>
        </div>
        {connected && status && (
          <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-1.5"><Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" /> Permissions granted: {status.scopes.join(', ') || meta.label}. Read-only; revoke any time with Disconnect or from your {provider === 'outlook' ? 'Microsoft' : 'Google'} account.</p>
        )}
      </Card>

      {provider === 'outlook' && !connected && status?.state !== 'not_configured' && (
        <Notice tone="info"><Puzzle className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" /> You can also fill this history without connecting the mailbox: link the <strong>Outlook add-in</strong> to your account in <button type="button" onClick={() => onNavigate('/settings')} className="underline font-semibold cursor-pointer">Settings</button> and every email you analyse inside Outlook is saved here.</Notice>
      )}

      {flash && <Notice tone={flash.tone}>{flash.tone === 'success' ? <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" /> : null}{flash.text}</Notice>}

      <div className={`grid gap-5 ${selected ? 'lg:grid-cols-5' : ''}`}>
        <div className={selected ? 'lg:col-span-2' : ''}>
          <EmailList provider={provider} selectedId={selected} onSelect={onSelect} refreshKey={refreshKey} emptyTitle={`No ${meta.label} emails yet`} emptyBody={connected ? `Click "Sync ${meta.label}" to fetch your most recent messages.` : provider === 'outlook' ? 'Connect Outlook to sync recent mail, or link the Outlook add-in in Settings to save the emails you analyse there.' : 'Connect Gmail to sync your recent messages.'} />
        </div>
        {selected && (
          <div className="lg:col-span-3">
            <EmailDetail recordId={selected} initialView={initialView} onClose={() => { setSelected(null); if (search.get('email')) onNavigate(`/dashboard/${provider}`, { replace: true }); }} onChanged={onChanged} onOpenCoach={onOpenCoach} />
          </div>
        )}
      </div>
    </div>
  );
};

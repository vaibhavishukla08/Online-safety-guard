import React, { useEffect, useState } from 'react';
import { Settings, User, Bell, BellRing, Puzzle, Mail, Inbox, Trash2, Loader2, Copy, Check, RefreshCw, Unplug, LogOut, KeyRound, ShieldCheck } from 'lucide-react';
import type { AddinTokenInfo, ConnectionStatus, NotifyPolicy } from '../types';
import { accountApi, connectionsApi, mailApi } from '../api/client';
import { BROWSER_NOTIFY_KEY, useAuth } from '../auth/AuthContext';
import { Card, Notice, PrimaryButton, SecondaryButton, SectionTitle } from '../components/ui/primitives';
import { PROVIDER_META, RequireAuth, formatDateTime, timeAgo } from '../components/mail/shared';

interface Props {
  onNavigate: (to: string, opts?: { replace?: boolean }) => void;
}

const POLICIES: Array<{ id: NotifyPolicy; label: string; body: string }> = [
  { id: 'high_only', label: 'High risk only', body: 'Alert for HIGH and CRITICAL verdicts (recommended).' },
  { id: 'suspicious_and_high', label: 'Suspicious + high risk', body: 'Also alert for MEDIUM verdicts that deserve a closer look.' },
  { id: 'all', label: 'All threats', body: 'Alert for every analysed email that shows any risk signal.' },
  { id: 'off', label: 'Disable notifications', body: 'Analyses are still saved; no alerts are created.' },
];

export const SettingsPage: React.FC<Props> = ({ onNavigate }) => (
  <RequireAuth onNavigate={onNavigate} feature="settings">
    <SettingsInner onNavigate={onNavigate} />
  </RequireAuth>
);

const SettingsInner: React.FC<Props> = ({ onNavigate }) => {
  const { user, updateUser, logout } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [tokens, setTokens] = useState<AddinTokenInfo[]>([]);
  const [linkCode, setLinkCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [browserNotify, setBrowserNotify] = useState<boolean>(() => {
    try {
      return localStorage.getItem(BROWSER_NOTIFY_KEY) === 'on';
    } catch {
      return false;
    }
  });
  const notificationSupported = typeof Notification !== 'undefined';
  const permission = notificationSupported ? Notification.permission : 'unsupported';

  const load = async () => {
    const [c, t] = await Promise.all([connectionsApi.list(), accountApi.addinTokens()]);
    if (c.ok) setConnections(c.data.connections);
    if (t.ok) setTokens(t.data.tokens);
  };
  useEffect(() => {
    void load();
  }, []);

  const saveName = async () => {
    setSaving(true);
    const err = await updateUser({ name });
    setSaving(false);
    setFlash(err ? { tone: 'error', text: err } : { tone: 'success', text: 'Profile updated.' });
  };

  const setPolicy = async (policy: NotifyPolicy) => {
    const err = await updateUser({ notifyPolicy: policy });
    setFlash(err ? { tone: 'error', text: err } : { tone: 'success', text: 'Notification setting saved.' });
  };

  const toggleBrowserNotify = async () => {
    if (!notificationSupported) return;
    if (browserNotify) {
      localStorage.setItem(BROWSER_NOTIFY_KEY, 'off');
      setBrowserNotify(false);
      return;
    }
    const result = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (result === 'granted') {
      localStorage.setItem(BROWSER_NOTIFY_KEY, 'on');
      setBrowserNotify(true);
      try {
        new Notification('Online Safety Guard', { body: 'Browser notifications are on. You will be alerted when a sync finds a high-risk email.' });
      } catch {
        /* ignore */
      }
    } else {
      setFlash({ tone: 'info', text: 'Browser notification permission was not granted. In-app notifications still work.' });
    }
  };

  const generateCode = async () => {
    const res = await accountApi.linkCode();
    if (res.ok) setLinkCode(res.data);
    else setFlash({ tone: 'error', text: res.error.message });
  };

  const copyCode = () => {
    if (!linkCode) return;
    navigator.clipboard.writeText(linkCode.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => undefined);
  };

  const revoke = async (id: string) => {
    const res = await accountApi.revokeAddinToken(id);
    if (res.ok) setTokens((prev) => prev.filter((t) => t.id !== id));
  };

  const disconnect = async (provider: 'outlook' | 'gmail') => {
    if (!window.confirm(`Disconnect ${PROVIDER_META[provider].label}? Stored history is kept; use "Delete history" to remove it.`)) return;
    const res = await connectionsApi.disconnect(provider, false);
    if (res.ok) {
      setFlash({ tone: 'success', text: `${PROVIDER_META[provider].label} disconnected.` });
      void load();
    } else setFlash({ tone: 'error', text: res.error.message });
  };

  const deleteHistory = async (provider?: 'outlook' | 'gmail') => {
    if (!window.confirm(`Delete ${provider ? PROVIDER_META[provider].label : 'all'} email history and its analyses? This cannot be undone.`)) return;
    const res = await mailApi.deleteHistory(provider);
    if (res.ok) {
      setFlash({ tone: 'success', text: `Deleted ${res.data.deleted} stored email${res.data.deleted === 1 ? '' : 's'}.` });
      void load();
    } else setFlash({ tone: 'error', text: res.error.message });
  };

  const input = 'w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950/90 border border-slate-300 dark:border-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/40';

  return (
    <div className="space-y-5 animate-fadeIn max-w-4xl mx-auto">
      <div>
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white flex items-center gap-2"><Settings className="w-7 h-7 text-slate-600" aria-hidden="true" /> Settings</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Account, mailbox connections, notifications and the Outlook add-in link.</p>
      </div>
      {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}

      <Card>
        <SectionTitle icon={User} title="Account" subtitle={user?.email} right={user?.role === 'ADMIN' ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300"><ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" /> Administrator</span> : null} />
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <label className="flex-1 text-xs font-semibold text-slate-700 dark:text-slate-300">Display name<input className={`${input} mt-1`} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <SecondaryButton onClick={saveName} disabled={saving || !name.trim() || name === user?.name}>{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Check className="w-3.5 h-3.5" aria-hidden="true" />} Save</SecondaryButton>
          <SecondaryButton id="btn-logout-settings" onClick={() => { void logout(); onNavigate('/'); }}><LogOut className="w-3.5 h-3.5" aria-hidden="true" /> Sign out</SecondaryButton>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">Member since {formatDateTime(user?.createdAt)}.</p>
      </Card>

      <Card>
        <SectionTitle icon={Bell} title="Notifications" subtitle="Which analysed emails should raise an alert on your dashboard" iconClass="text-purple-600" />
        <div className="grid sm:grid-cols-2 gap-2">
          {POLICIES.map((p) => (
            <label key={p.id} className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${user?.notifyPolicy === p.id ? 'border-rose-400 bg-rose-50/60 dark:bg-rose-500/10' : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}>
              <input type="radio" name="notify-policy" className="mt-0.5" checked={user?.notifyPolicy === p.id} onChange={() => setPolicy(p.id)} />
              <span><span className="text-sm font-semibold text-slate-900 dark:text-white block">{p.label}</span><span className="text-[11px] text-slate-600 dark:text-slate-400">{p.body}</span></span>
            </label>
          ))}
        </div>
        <div className="mt-4 flex items-start justify-between gap-3 flex-wrap p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-700 dark:text-slate-300">
            <div className="font-semibold flex items-center gap-1.5"><BellRing className="w-3.5 h-3.5 text-purple-600" aria-hidden="true" /> Browser notifications</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Shows a desktop notification when a <em>new</em> alert is found while this site is open. Alerts are discovered by periodic polling (about once a minute while the tab is open, plus mailbox syncs) — not in real time.</div>
            {!notificationSupported && <div className="text-[11px] text-amber-800 dark:text-amber-300 mt-1">This browser does not support notifications; in-app alerts are used instead.</div>}
            {notificationSupported && permission === 'denied' && <div className="text-[11px] text-amber-800 dark:text-amber-300 mt-1">Permission is blocked in the browser settings for this site.</div>}
          </div>
          <SecondaryButton onClick={toggleBrowserNotify} disabled={!notificationSupported || permission === 'denied'}>{browserNotify ? 'Turn off' : 'Turn on'}</SecondaryButton>
        </div>
      </Card>

      <Card>
        <SectionTitle icon={Puzzle} title="Outlook add-in" subtitle="Link the add-in so emails you analyse inside Outlook are saved to your history" iconClass="text-blue-600" />
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
            <ol className="list-decimal ml-4 space-y-1">
              <li>Generate a link code here (valid 10 minutes, single use).</li>
              <li>In Outlook open any email → <strong>Analyze with Online Safety Guard</strong>.</li>
              <li>In the pane choose <strong>Link account</strong> and enter the code.</li>
            </ol>
            <div className="flex items-center gap-2 pt-1">
              <PrimaryButton id="btn-link-code" onClick={generateCode} className="px-4 py-2 text-xs"><KeyRound className="w-4 h-4" aria-hidden="true" /> {linkCode ? 'New code' : 'Generate link code'}</PrimaryButton>
              {linkCode && (
                <button type="button" onClick={copyCode} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-base font-bold tracking-widest text-slate-900 dark:text-white cursor-pointer" title="Copy code">
                  {linkCode.code} {copied ? <Check className="w-4 h-4 text-emerald-600" aria-hidden="true" /> : <Copy className="w-4 h-4 text-slate-400" aria-hidden="true" />}
                </button>
              )}
            </div>
            {linkCode && <p className="text-[11px] text-slate-500">Expires {formatDateTime(linkCode.expiresAt)}.</p>}
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1.5">Linked add-ins ({tokens.length})</div>
            {tokens.length === 0 ? <p className="text-[11px] text-slate-500">No add-in linked yet.</p> : (
              <ul className="space-y-1.5">
                {tokens.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 text-xs p-2 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                    <span className="min-w-0"><span className="font-semibold text-slate-900 dark:text-white block truncate">{t.label}</span><span className="text-[11px] text-slate-500">Linked {timeAgo(t.createdAt)} · last used {timeAgo(t.lastUsedAt)}</span></span>
                    <button type="button" onClick={() => revoke(t.id)} className="text-[11px] font-semibold text-rose-700 dark:text-rose-300 hover:underline cursor-pointer">Revoke</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle icon={Mail} title="Mailbox connections" subtitle="Read-only access to your own mailboxes; revoke at any time" iconClass="text-blue-600" />
        <div className="space-y-2">
          {connections.map((c) => {
            const m = PROVIDER_META[c.provider];
            const Icon = c.provider === 'outlook' ? Mail : Inbox;
            return (
              <div key={c.provider} className="flex items-center justify-between gap-3 flex-wrap p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon className={`w-5 h-5 ${m.tone}`} aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">{m.label} {c.state === 'active' ? <span className="text-emerald-700 dark:text-emerald-300 text-[11px] font-bold">· connected</span> : c.state === 'expired' ? <span className="text-amber-700 dark:text-amber-300 text-[11px] font-bold">· expired</span> : c.state === 'not_configured' ? <span className="text-slate-500 text-[11px]">· not configured on server</span> : <span className="text-slate-500 text-[11px]">· not connected</span>}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{c.accountEmail || m.description} · {c.messageCount} stored, {c.analyzedCount} analysed</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <SecondaryButton onClick={() => onNavigate(`/dashboard/${c.provider}`)}><RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Open</SecondaryButton>
                  {(c.state === 'active' || c.state === 'expired') && <SecondaryButton onClick={() => disconnect(c.provider)}><Unplug className="w-3.5 h-3.5" aria-hidden="true" /> Disconnect</SecondaryButton>}
                  {c.messageCount > 0 && <SecondaryButton onClick={() => deleteHistory(c.provider)} className="text-rose-700 dark:text-rose-300"><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Delete history</SecondaryButton>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap text-[11px] text-slate-500 dark:text-slate-400">
          <span>Only sender, subject, dates, links, risk verdicts and the analysis are stored — never full email bodies.</span>
          <SecondaryButton onClick={() => deleteHistory()} className="text-rose-700 dark:text-rose-300"><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Delete all analysis history</SecondaryButton>
        </div>
      </Card>
    </div>
  );
};

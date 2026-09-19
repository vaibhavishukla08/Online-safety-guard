import React, { useEffect, useState } from 'react';
import { ShieldCheck, Users, Radar, Activity, ScrollText, Loader2, Lock, Mail, Inbox, Bell, AlertTriangle, CheckCircle2, XCircle, HelpCircle, MinusCircle, Database, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import type { AdminOverview, AdminUserRow, AuditEntry, ServiceHealthReport, ThreatAnalytics } from '../types';
import { adminApi } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Card, EmptyState, Notice, RiskBadge, SecondaryButton, SectionTitle, Meter } from '../components/ui/primitives';
import { LEVEL_TOKENS } from '../utils/risk';
import { ProviderChip, RequireAuth, formatDateTime, timeAgo } from '../components/mail/shared';

type Section = 'overview' | 'users' | 'threats' | 'health' | 'audit';

interface Props {
  section: Section;
  onNavigate: (to: string, opts?: { replace?: boolean }) => void;
}

const SECTIONS: Array<{ id: Section; label: string; icon: React.ElementType; path: string }> = [
  { id: 'overview', label: 'Admin Dashboard', icon: ShieldCheck, path: '/admin' },
  { id: 'users', label: 'Users', icon: Users, path: '/admin/users' },
  { id: 'threats', label: 'Threat Analytics', icon: Radar, path: '/admin/threats' },
  { id: 'health', label: 'Service Health', icon: Activity, path: '/admin/health' },
  { id: 'audit', label: 'Audit Logs', icon: ScrollText, path: '/admin/audit' },
];

export const AdminPage: React.FC<Props> = ({ section, onNavigate }) => (
  <RequireAuth onNavigate={onNavigate} feature="the admin area">
    <AdminGate section={section} onNavigate={onNavigate} />
  </RequireAuth>
);

const AdminGate: React.FC<Props> = ({ section, onNavigate }) => {
  const { user } = useAuth();
  if (user?.role !== 'ADMIN') {
    return (
      <Card className="max-w-lg mx-auto">
        <EmptyState icon={Lock} title="Administrator access required" body="Your account does not have the ADMIN role. Administrators are configured through the ADMIN_EMAILS environment variable or promoted by an existing administrator." action={<SecondaryButton onClick={() => onNavigate('/')}>Back to dashboard</SecondaryButton>} />
      </Card>
    );
  }
  return (
    <div className="space-y-5 animate-fadeIn">
      <div>
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white flex items-center gap-2"><ShieldCheck className="w-7 h-7 text-emerald-600" aria-hidden="true" /> Administration</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Aggregate platform view. Private email content is never shown here.</p>
      </div>
      <nav className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none" aria-label="Admin sections">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const on = s.id === section;
          return (
            <button key={s.id} type="button" id={`admin-nav-${s.id}`} onClick={() => onNavigate(s.path)} aria-current={on ? 'page' : undefined} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap border cursor-pointer ${on ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30' : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'}`}>
              <Icon className="w-4 h-4" aria-hidden="true" /> {s.label}
            </button>
          );
        })}
      </nav>
      {section === 'overview' && <Overview />}
      {section === 'users' && <UsersSection />}
      {section === 'threats' && <ThreatsSection />}
      {section === 'health' && <HealthSection />}
      {section === 'audit' && <AuditSection />}
    </div>
  );
};

function useLoad<T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: { message: string } }>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    fn().then((res) => {
      if (cancelled) return;
      if (res.ok) setData(res.data);
      else setError(res.error.message);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}

const Stat: React.FC<{ label: string; value: number | string; icon: React.ElementType; tone?: string }> = ({ label, value, icon: Icon, tone = 'text-slate-600 dark:text-slate-300' }) => (
  <div className="p-4 rounded-xl bg-white/85 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800">
    <div className="flex items-center justify-between"><span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</span><Icon className={`w-4 h-4 ${tone}`} aria-hidden="true" /></div>
    <div className="text-2xl font-extrabold tabular-nums text-slate-900 dark:text-white mt-1">{value}</div>
  </div>
);

const Loading: React.FC = () => <Card className="flex items-center justify-center gap-2 py-10 text-sm text-slate-600 dark:text-slate-400"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading…</Card>;

const STATE_ICON = { ok: CheckCircle2, degraded: AlertTriangle, down: XCircle, not_configured: MinusCircle, unknown: HelpCircle } as const;
const STATE_CLS = { ok: 'text-emerald-600', degraded: 'text-amber-600', down: 'text-rose-600', not_configured: 'text-slate-400', unknown: 'text-slate-400' } as const;

const ServiceGrid: React.FC<{ health: ServiceHealthReport }> = ({ health }) => (
  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
    {health.services.map((s) => {
      const Icon = STATE_ICON[s.state];
      return (
        <div key={s.id} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/85 dark:bg-slate-900/80">
          <div className="flex items-center justify-between gap-2"><span className="text-xs font-bold text-slate-900 dark:text-white">{s.label}</span><span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${STATE_CLS[s.state]}`}><Icon className="w-3.5 h-3.5" aria-hidden="true" /> {s.state.replace('_', ' ')}</span></div>
          <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">{s.detail}</div>
          {s.lastFailure && <div className="text-[11px] text-rose-700 dark:text-rose-300 mt-1 truncate" title={s.lastFailure}>Last failure {timeAgo(s.lastFailureAt)}: {s.lastFailure}</div>}
        </div>
      );
    })}
  </div>
);

const Overview: React.FC = () => {
  const { data, error, reload } = useLoad<AdminOverview>(adminApi.overview);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Total users" value={data.totalUsers} icon={Users} />
        <Stat label="Active (7 days)" value={data.activeUsers7d} icon={Activity} tone="text-emerald-600" />
        <Stat label="Outlook connected" value={data.connectedOutlook} icon={Mail} tone="text-blue-600" />
        <Stat label="Gmail connected" value={data.connectedGmail} icon={Inbox} tone="text-red-600" />
        <Stat label="Emails stored" value={data.emailsStored} icon={Database} />
        <Stat label="Emails analysed" value={data.emailsAnalyzed} icon={Radar} tone="text-cyan-600" />
        <Stat label="High-risk detections" value={data.highRiskDetections} icon={AlertTriangle} tone="text-rose-600" />
        <Stat label="Suspicious detections" value={data.suspiciousDetections} icon={AlertTriangle} tone="text-amber-600" />
      </div>
      <Card>
        <SectionTitle icon={Activity} title="Service health" subtitle={`Error rate ${data.serviceHealth.errorRate}% over the last hour · ${data.notificationsSent} notifications sent in total`} iconClass="text-emerald-600" right={<SecondaryButton onClick={reload}><RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Refresh</SecondaryButton>} />
        <ServiceGrid health={data.serviceHealth} />
      </Card>
    </div>
  );
};

const UsersSection: React.FC = () => {
  const { user: me } = useAuth();
  const { data, error, reload } = useLoad<{ users: AdminUserRow[] }>(adminApi.users);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Loading />;
  const act = async (u: AdminUserRow, patch: { status?: 'active' | 'suspended'; role?: 'USER' | 'ADMIN' }) => {
    if (patch.status === 'suspended' && !window.confirm(`Suspend ${u.email}? Their sessions and add-in links will be revoked.`)) return;
    setBusy(u.id);
    const res = await adminApi.updateUser(u.id, patch);
    setBusy(null);
    setMsg(res.ok ? `Updated ${u.email}.` : res.error.message);
    reload();
  };
  return (
    <Card>
      <SectionTitle icon={Users} title={`Users (${data.users.length})`} subtitle="Account status, connected providers and activity — no email content" />
      {msg && <Notice tone="info" className="mb-3">{msg}</Notice>}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 text-left">
            <tr><th className="py-2 pr-3">User</th><th className="py-2 pr-3">Role</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Providers</th><th className="py-2 pr-3">Analyses</th><th className="py-2 pr-3">Last active</th><th className="py-2">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.users.map((u) => (
              <tr key={u.id}>
                <td className="py-2 pr-3"><div className="font-semibold text-slate-900 dark:text-white">{u.name}</div><div className="text-slate-500">{u.email}</div></td>
                <td className="py-2 pr-3"><span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${u.role === 'ADMIN' ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'}`}>{u.role}</span></td>
                <td className="py-2 pr-3"><span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${u.status === 'active' ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' : 'bg-rose-500/15 text-rose-800 dark:text-rose-300'}`}>{u.status}</span></td>
                <td className="py-2 pr-3">{u.providers.length ? u.providers.map((p) => <ProviderChip key={p} provider={p} className="mr-1" />) : <span className="text-slate-400">—</span>}</td>
                <td className="py-2 pr-3 tabular-nums">{u.analysisCount}{u.highRiskCount ? <span className="text-rose-700 dark:text-rose-300"> ({u.highRiskCount} high)</span> : null}</td>
                <td className="py-2 pr-3 text-slate-500">{timeAgo(u.lastActiveAt)}</td>
                <td className="py-2">
                  {u.id === me?.id ? <span className="text-slate-400">you</span> : (
                    <div className="flex gap-1 flex-wrap">
                      <button type="button" disabled={busy === u.id} onClick={() => act(u, { status: u.status === 'active' ? 'suspended' : 'active' })} className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50">{u.status === 'active' ? 'Suspend' : 'Reactivate'}</button>
                      <button type="button" disabled={busy === u.id} onClick={() => act(u, { role: u.role === 'ADMIN' ? 'USER' : 'ADMIN' })} className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50">{u.role === 'ADMIN' ? 'Make user' : 'Make admin'}</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

const ThreatsSection: React.FC = () => {
  const { data, error } = useLoad<ThreatAnalytics>(adminApi.threats);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Loading />;
  const maxTrend = Math.max(1, ...data.trend.map((t) => t.analyzed));
  const levels = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Analysed (last 1000)" value={data.totalAnalyzed} icon={Radar} tone="text-cyan-600" />
        <Stat label="Threats (MEDIUM+)" value={data.totalThreats} icon={AlertTriangle} tone="text-rose-600" />
        <Stat label="Critical" value={data.riskDistribution.CRITICAL} icon={XCircle} tone="text-rose-600" />
        <Stat label="High" value={data.riskDistribution.HIGH} icon={AlertTriangle} tone="text-orange-600" />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <SectionTitle icon={Radar} title="Risk distribution" />
          <div className="space-y-2">
            {levels.map((l) => (
              <div key={l} className="flex items-center gap-2 text-xs"><RiskBadge level={l} size="sm" className="w-24 justify-center" /><Meter value={data.riskDistribution[l]} max={Math.max(1, data.totalAnalyzed)} barClass={LEVEL_TOKENS[l].solid} className="flex-1" label={l} /><span className="w-8 text-right tabular-nums">{data.riskDistribution[l]}</span></div>
            ))}
          </div>
        </Card>
        <Card>
          <SectionTitle icon={Activity} title="14-day trend" subtitle="Analyses per day (dark = threats)" />
          <div className="flex items-end gap-1 h-28" role="img" aria-label="Analyses per day">
            {data.trend.map((t) => (
              <div key={t.day} className="flex-1 flex flex-col justify-end gap-0.5" title={`${t.day}: ${t.analyzed} analysed, ${t.threats} threats`}>
                <div className="bg-slate-300 dark:bg-slate-700 rounded-t" style={{ height: `${Math.max(2, ((t.analyzed - t.threats) / maxTrend) * 100)}%` }} />
                <div className="bg-rose-500 rounded-t" style={{ height: `${(t.threats / maxTrend) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-slate-500 mt-1"><span>{data.trend[0]?.day}</span><span>{data.trend[data.trend.length - 1]?.day}</span></div>
        </Card>
        <Card>
          <SectionTitle icon={AlertTriangle} title="Threat categories" />
          {data.byCategory.length === 0 ? <p className="text-xs text-slate-500">No threats yet.</p> : <ul className="space-y-1.5 text-xs">{data.byCategory.map((c) => <li key={c.label} className="flex items-center justify-between"><span>{c.label}</span><span className="font-bold tabular-nums">{c.count}</span></li>)}</ul>}
        </Card>
        <Card>
          <SectionTitle icon={Radar} title="Common signals" />
          {data.commonSignals.length === 0 ? <p className="text-xs text-slate-500">No signals yet.</p> : <ul className="space-y-1.5 text-xs">{data.commonSignals.map((c) => <li key={c.label} className="flex items-center justify-between"><span>{c.label}</span><span className="font-bold tabular-nums">{c.count}</span></li>)}</ul>}
        </Card>
        <Card>
          <SectionTitle icon={AlertTriangle} title="Suspicious domains" subtitle="Hostnames seen in flagged emails (never visited)" />
          {data.suspiciousDomains.length === 0 ? <p className="text-xs text-slate-500">None yet.</p> : <ul className="space-y-1.5 text-xs font-mono">{data.suspiciousDomains.map((d) => <li key={d.domain} className="flex items-center justify-between gap-2"><span className="truncate">{d.domain}</span><span className="font-bold tabular-nums whitespace-nowrap">{d.count}× · max {d.maxScore}</span></li>)}</ul>}
        </Card>
        <Card>
          <SectionTitle icon={Bell} title="Recent detections" />
          {data.recent.length === 0 ? <p className="text-xs text-slate-500">None yet.</p> : (
            <ul className="space-y-2 text-xs">
              {data.recent.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-2">
                  <span className="min-w-0"><span className="font-semibold text-slate-900 dark:text-white block truncate">{r.subject || '(no subject)'}</span><span className="text-slate-500 block truncate">{r.senderEmail || 'unknown sender'} · {r.threatCategory || '—'} · {timeAgo(r.analyzedAt)}</span></span>
                  <span className="flex items-center gap-1 flex-shrink-0"><ProviderChip provider={r.provider} /><RiskBadge level={r.riskLevel} size="sm" /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
};

const HealthSection: React.FC = () => {
  const { data, error, reload } = useLoad<ServiceHealthReport>(adminApi.health);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="API error rate (1h)" value={`${data.errorRate}%`} icon={Activity} tone={data.errorRate > 5 ? 'text-rose-600' : 'text-emerald-600'} />
        <Stat label="Database" value={data.database.ok ? 'OK' : 'DOWN'} icon={Database} tone={data.database.ok ? 'text-emerald-600' : 'text-rose-600'} />
        <Stat label="Rate limit / min" value={data.rateLimit.perMinute} icon={Lock} />
        <Stat label="Blocked (1h)" value={data.rateLimit.blockedLastHour} icon={XCircle} tone="text-amber-600" />
      </div>
      <Card>
        <SectionTitle icon={Activity} title="Services" subtitle={`${data.database.kind} · uptime ${Math.floor(data.uptimeSec / 3600)}h ${Math.floor((data.uptimeSec % 3600) / 60)}m · mailbox sync ${data.sync.enabled ? `every ${data.sync.intervalMinutes} min${data.sync.lastRunAt ? ` (last run ${timeAgo(data.sync.lastRunAt)}: ${data.sync.lastRunSummary})` : ''}` : 'disabled'}`} iconClass="text-emerald-600" right={<SecondaryButton onClick={reload}><RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Refresh</SecondaryButton>} />
        <ServiceGrid health={data} />
      </Card>
      <Card>
        <SectionTitle icon={XCircle} title="Recent failures" subtitle="Last 20 external-service or API failures (messages only — no secrets or bodies)" iconClass="text-rose-600" />
        {data.recentFailures.length === 0 ? <p className="text-xs text-slate-500">No failures recorded since the server started.</p> : (
          <ul className="space-y-1.5 text-xs">{data.recentFailures.map((f, i) => <li key={i} className="flex items-start justify-between gap-2"><span><span className="font-semibold">{f.service}</span> — {f.message}</span><span className="text-slate-500 whitespace-nowrap">{timeAgo(f.at)}</span></li>)}</ul>
        )}
      </Card>
    </div>
  );
};

const AuditSection: React.FC = () => {
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const { data, error } = useLoad<{ items: AuditEntry[]; total: number }>(() => adminApi.audit(limit, offset), [offset]);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Loading />;
  return (
    <Card>
      <SectionTitle icon={ScrollText} title={`Audit log (${data.total.toLocaleString()})`} subtitle="Logins, connections, syncs, analyses, notifications, admin actions — identifiers and counts only" right={<div className="flex items-center gap-1 text-xs"><button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer" aria-label="Newer"><ChevronLeft className="w-4 h-4" aria-hidden="true" /></button><span>{offset + 1}–{Math.min(data.total, offset + limit)}</span><button type="button" disabled={offset + limit >= data.total} onClick={() => setOffset(offset + limit)} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer" aria-label="Older"><ChevronRight className="w-4 h-4" aria-hidden="true" /></button></div>} />
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 text-left"><tr><th className="py-2 pr-3">Time</th><th className="py-2 pr-3">Action</th><th className="py-2 pr-3">User</th><th className="py-2 pr-3">Role</th><th className="py-2 pr-3">Detail</th><th className="py-2">IP</th></tr></thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.items.map((e) => (
              <tr key={e.id}>
                <td className="py-1.5 pr-3 whitespace-nowrap text-slate-500">{formatDateTime(e.createdAt)}</td>
                <td className="py-1.5 pr-3 font-semibold text-slate-900 dark:text-white whitespace-nowrap">{e.action.replace(/_/g, ' ')}</td>
                <td className="py-1.5 pr-3 font-mono text-[10px] text-slate-500">{e.userId ? e.userId.slice(0, 8) : '—'}</td>
                <td className="py-1.5 pr-3">{e.actorRole || '—'}</td>
                <td className="py-1.5 pr-3 font-mono text-[10px] text-slate-600 dark:text-slate-400 break-all">{Object.keys(e.detail).length ? JSON.stringify(e.detail) : '—'}</td>
                <td className="py-1.5 text-slate-500 whitespace-nowrap">{e.ip || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

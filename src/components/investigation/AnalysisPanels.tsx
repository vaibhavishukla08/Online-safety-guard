import React from 'react';
import { Drama, Fingerprint, Radar, Dna, MessagesSquare, Wallet, Link2, CheckCircle2, XCircle, CloudOff, MinusCircle, KeyRound } from 'lucide-react';
import type { InvestigationReport, ScamDna } from '../../types';
import { LEVEL_TOKENS } from '../../utils/risk';
import { Card, SectionTitle, SourceTag, Meter, Pill } from '../ui/primitives';

// ---------------------------------------------------------------------------
// Social engineering
// ---------------------------------------------------------------------------
export const SocialEngineeringPanel: React.FC<{ report: InvestigationReport }> = ({ report }) => {
  const se = report.socialEngineering;
  if (!se) return null;
  const none = !se.primaryTactics.length && !se.secondaryTactics.length;
  return (
    <Card>
      <SectionTitle icon={Drama} iconClass="text-purple-600 dark:text-purple-400" title="Psychological Attack" subtitle="Social-engineering techniques identified in the message." right={<SourceTag source={se.source} />} />
      {none ? (
        <p className="text-xs text-slate-600 dark:text-slate-400 italic">No manipulation tactics identified.</p>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">Primary tactic</div>
            <div className="text-lg font-bold text-purple-800 dark:text-purple-300">{se.primaryTactics.join(' + ') || '—'}</div>
          </div>
          {se.secondaryTactics.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">Secondary tactics</div>
              <div className="flex flex-wrap gap-1.5">
                {se.secondaryTactics.map((t) => (
                  <Pill key={t} className="bg-purple-50 dark:bg-purple-500/10 text-purple-800 dark:text-purple-300 border-purple-200 dark:border-purple-500/30">{t}</Pill>
                ))}
              </div>
            </div>
          )}
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Attacker goal</div>
              <p className="text-xs text-slate-800 dark:text-slate-200 font-medium mt-0.5">{se.attackerGoal}</p>
            </div>
            {se.explanation && <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{se.explanation}</p>}
          </div>
        </div>
      )}
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Identity / brand impersonation
// ---------------------------------------------------------------------------
export const IdentityPanel: React.FC<{ report: InvestigationReport }> = ({ report }) => {
  const id = report.identity;
  if (!id || (!id.claimedOrganization && !id.observedDomains.length)) return null;
  return (
    <Card>
      <SectionTitle icon={Fingerprint} iconClass="text-indigo-600 dark:text-indigo-400" title="Identity Check" subtitle="Claimed organization vs. what can actually be observed." right={<SourceTag source={id.source} />} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Claimed</div>
          <div className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">{id.claimedOrganization || 'No organization named'}</div>
          {id.organizationCategory && <div className="text-[11px] text-slate-500 capitalize">{id.organizationCategory}</div>}
          {id.officialDomains.length > 0 && (
            <div className="mt-2 text-[11px] text-slate-600 dark:text-slate-400">
              Official: <span className="font-mono text-emerald-700 dark:text-emerald-400 break-all">{id.officialDomains.slice(0, 3).join(', ')}</span>
            </div>
          )}
        </div>
        <div className={`p-3 rounded-xl border ${id.mismatch ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-600/40' : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800'}`}>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Observed</div>
          {id.observedDomains.length ? (
            <ul className="mt-0.5 space-y-0.5">
              {id.observedDomains.map((d) => (
                <li key={d} className={`font-mono text-sm font-bold break-all ${id.mismatch ? 'text-rose-700 dark:text-rose-300' : 'text-slate-900 dark:text-white'}`}>{d}</li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-slate-500 mt-0.5">No domain to compare</div>
          )}
          {id.observedSender && <div className="mt-1 text-[11px] text-slate-500 font-mono break-all">Sender: {id.observedSender}</div>}
        </div>
      </div>
      <div className={`flex items-start gap-2 text-xs p-3 rounded-xl border ${id.mismatch ? 'bg-rose-50/70 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-900 dark:text-rose-200' : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'}`}>
        {id.mismatch ? <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-rose-600" aria-hidden="true" /> : <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-600" aria-hidden="true" />}
        <span><strong>{id.mismatch ? 'Potential brand impersonation.' : 'No mismatch established.'}</strong> {id.verdict}</span>
      </div>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// External evidence (threat intelligence)
// ---------------------------------------------------------------------------
const INTEL_STATUS: Record<string, { icon: React.ElementType; className: string; label: string }> = {
  ok: { icon: CheckCircle2, className: 'text-emerald-600 dark:text-emerald-400', label: 'Retrieved' },
  not_configured: { icon: MinusCircle, className: 'text-slate-400', label: 'Not configured' },
  unavailable: { icon: CloudOff, className: 'text-amber-500', label: 'Unavailable' },
  error: { icon: XCircle, className: 'text-rose-500', label: 'Error' },
  skipped: { icon: MinusCircle, className: 'text-slate-400', label: 'Skipped' },
};

export const ExternalEvidencePanel: React.FC<{ report: InvestigationReport }> = ({ report }) => {
  const ex = report.external;
  if (!ex) return null;
  const ageLabel = ex.domainAgeDays === null ? 'Unknown' : ex.domainAgeDays < 30 ? `${ex.domainAgeDays} days (very new)` : ex.domainAgeDays < 365 ? `${ex.domainAgeDays} days` : `${(ex.domainAgeDays / 365).toFixed(1)} years`;
  return (
    <Card>
      <SectionTitle icon={Radar} iconClass="text-cyan-600 dark:text-cyan-400" title="External Evidence" subtitle="Retrieved from third-party sources — shown exactly as returned, never inferred." right={<SourceTag source="external" />} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <Stat label="Domain" value={ex.domain || '—'} mono />
        <Stat label="Domain age" value={ageLabel} highlight={ex.domainAgeDays !== null && ex.domainAgeDays < 30} />
        <Stat label="Threat reports" value={ex.threatReports === null ? 'No source' : String(ex.threatReports)} highlight={(ex.threatReports || 0) > 0} />
        <Stat label="Brand mismatch" value={report.identity?.mismatch ? 'Detected' : report.identity?.claimedOrganization ? 'Not detected' : 'N/A'} highlight={Boolean(report.identity?.mismatch)} />
      </div>
      <ul className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {ex.sources.map((s) => {
          const st = INTEL_STATUS[s.status] || INTEL_STATUS.skipped;
          const Icon = st.icon;
          return (
            <li key={s.source} className="flex items-start gap-3 p-3 bg-slate-50/60 dark:bg-slate-950/40 text-xs">
              <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${st.className}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-slate-900 dark:text-white">{s.source}</span>
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">{st.label}</span>
                </div>
                <p className="text-slate-700 dark:text-slate-300 mt-0.5">{s.summary}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
        {ex.availableSources} of {ex.sources.length} sources returned data. Keyed sources (VirusTotal, Safe Browsing, urlscan, AbuseIPDB) activate when their API keys are set in <code className="font-mono">.env</code>.
      </p>
    </Card>
  );
};

const Stat: React.FC<{ label: string; value: string; mono?: boolean; highlight?: boolean }> = ({ label, value, mono, highlight }) => (
  <div className={`p-2.5 rounded-lg border ${highlight ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30' : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800'}`}>
    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
    <div className={`text-xs font-bold mt-0.5 break-all ${mono ? 'font-mono' : ''} ${highlight ? 'text-rose-700 dark:text-rose-300' : 'text-slate-900 dark:text-white'}`}>{value}</div>
  </div>
);

// ---------------------------------------------------------------------------
// Scam DNA
// ---------------------------------------------------------------------------
const DNA_ROWS: Array<{ key: keyof ScamDna; label: string; color: string }> = [
  { key: 'urgency', label: 'Urgency', color: 'bg-amber-500' },
  { key: 'impersonation', label: 'Impersonation', color: 'bg-indigo-500' },
  { key: 'credentialTheft', label: 'Credential theft', color: 'bg-rose-500' },
  { key: 'paymentRequest', label: 'Payment request', color: 'bg-orange-500' },
  { key: 'linkDeception', label: 'Link deception', color: 'bg-blue-500' },
  { key: 'emotionalManipulation', label: 'Emotional manipulation', color: 'bg-purple-500' },
  { key: 'fakeReward', label: 'Fake reward', color: 'bg-emerald-500' },
  { key: 'authority', label: 'Authority', color: 'bg-slate-500' },
];

export const ScamDnaPanel: React.FC<{ dna: ScamDna; level: InvestigationReport['verdict']['level']; compact?: boolean }> = ({ dna, level, compact }) => {
  const t = LEVEL_TOKENS[level];
  const dominant = DNA_ROWS.filter((r) => dna[r.key] >= 6).map((r) => r.label);
  return (
    <Card>
      <SectionTitle icon={Dna} iconClass={t.text} title="Scam DNA" subtitle={dominant.length ? `Dominant traits: ${dominant.join(', ')}` : 'Attack profile generated from detected signals.'} />
      <div className={`grid gap-x-6 gap-y-2.5 ${compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
        {DNA_ROWS.map((row) => {
          const v = dna[row.key];
          return (
            <div key={row.key} className="flex items-center gap-3">
              <span className="w-40 text-xs font-medium text-slate-700 dark:text-slate-300 flex-shrink-0">{row.label}</span>
              <Meter value={v} barClass={v === 0 ? 'bg-slate-300 dark:bg-slate-700' : row.color} label={`${row.label} ${v} of 10`} />
              <span className="w-10 text-right font-mono text-xs tabular-nums text-slate-600 dark:text-slate-400" aria-hidden="true">{v}/10</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Conversation stages
// ---------------------------------------------------------------------------
export const ConversationPanel: React.FC<{ report: InvestigationReport }> = ({ report }) => {
  const c = report.conversation;
  if (!c) return null;
  return (
    <Card>
      <SectionTitle icon={MessagesSquare} iconClass="text-teal-600 dark:text-teal-400" title="Scam Conversation Analysis" subtitle={`${c.turnCount} messages analysed as a whole · ${c.scamType}`} right={<SourceTag source={c.source} />} />
      {c.stages.length ? (
        <ol className="relative ml-2 border-l-2 border-teal-200 dark:border-teal-500/30 space-y-3 mb-4">
          {c.stages.map((s) => (
            <li key={s.stage} className="pl-5 relative">
              <span className="absolute -left-[11px] top-0.5 w-5 h-5 rounded-full bg-teal-600 text-white text-[10px] font-bold flex items-center justify-center" aria-hidden="true">{s.stage}</span>
              <div className="text-xs font-bold text-slate-900 dark:text-white">Stage {s.stage}: {s.label}</div>
              <p className="text-xs text-slate-700 dark:text-slate-300">{s.description}</p>
              {s.quote && <p className="text-[11px] font-mono italic text-slate-500 dark:text-slate-400 mt-0.5 break-words">"{s.quote}"</p>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-slate-500 italic mb-4">No progression stages were identified.</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Escalation pattern</div>
          <p className="text-xs text-slate-800 dark:text-slate-200 mt-1">{c.escalationPattern}</p>
        </div>
        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Manipulation techniques</div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {c.manipulationTechniques.length ? c.manipulationTechniques.map((m) => <Pill key={m} className="bg-teal-50 dark:bg-teal-500/10 text-teal-800 dark:text-teal-300 border-teal-200 dark:border-teal-500/30">{m}</Pill>) : <span className="text-xs text-slate-500">None identified</span>}
          </div>
        </div>
      </div>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Financial exposure + URLs (compact side panel)
// ---------------------------------------------------------------------------
export const ExposurePanel: React.FC<{ report: InvestigationReport }> = ({ report }) => {
  const f = report.financial;
  const urls = report.urls;
  if (!f && !urls.length) return null;
  return (
    <Card>
      <SectionTitle icon={Wallet} iconClass="text-amber-600 dark:text-amber-400" title="Exposure" subtitle="What the message is trying to obtain, and where it points." />
      <div className="space-y-3">
        {f && (
          <div className="grid grid-cols-2 gap-2">
            <div className={`p-2.5 rounded-lg border ${f.credentialRequested ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30' : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800'}`}>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500"><KeyRound className="w-3 h-3" aria-hidden="true" /> Credentials</div>
              <div className="text-xs font-bold mt-0.5 text-slate-900 dark:text-white">{f.credentialRequested ? f.credentialTypes.join(', ') || 'Requested' : 'Not requested'}</div>
            </div>
            <div className={`p-2.5 rounded-lg border ${f.paymentRequested ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30' : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800'}`}>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500"><Wallet className="w-3 h-3" aria-hidden="true" /> Money</div>
              <div className="text-xs font-bold mt-0.5 text-slate-900 dark:text-white">{f.paymentRequested ? [...f.amounts.slice(0, 2), ...f.paymentMethods].join(' · ') || 'Requested' : 'Not requested'}</div>
            </div>
          </div>
        )}
        {urls.length > 0 && (
          <ul className="space-y-2">
            {urls.map((u) => (
              <li key={u.normalized} className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1"><Link2 className="w-3 h-3" aria-hidden="true" /> Link (not opened)</div>
                <div className="font-mono text-xs font-bold text-slate-900 dark:text-white break-all">{u.hostname}</div>
                {u.flags.length ? (
                  <ul className="mt-1 space-y-0.5">
                    {u.flags.map((fl) => <li key={fl} className="text-[11px] text-rose-700 dark:text-rose-300">• {fl}</li>)}
                  </ul>
                ) : (
                  <div className="text-[11px] text-slate-500 mt-1">No structural red flags</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
};

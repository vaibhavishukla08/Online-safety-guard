import React, { useEffect, useMemo, useState } from 'react';
import { LayoutDashboard, ShieldAlert, Link2, KeyRound, Banknote, Fingerprint, Drama, Database, Sparkles, Loader2, Trash2, Cpu } from 'lucide-react';
import type { AnalysisResult, DashboardStats, PatternRecord } from '../types';
import { requestDashboardSummary } from '../api/client';
import { computeDashboardStats, describeIndicator, getPatternRecords, clearPatternRecords } from '../utils/patternMemory';
import { LEVEL_TOKENS } from '../utils/risk';
import { Card, EmptyState, SectionTitle, SourceTag, SecondaryButton, RiskBadge } from './ui/primitives';

interface Props {
  history: AnalysisResult[];
  onNewScan: () => void;
}

export const SafetyDashboard: React.FC<Props> = ({ history, onNewScan }) => {
  const [records, setRecords] = useState<PatternRecord[]>(() => getPatternRecords());
  const stats: DashboardStats = useMemo(() => computeDashboardStats(records), [records]);
  const [summary, setSummary] = useState<{ text: string; source: 'ai' | 'rule' } | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  useEffect(() => {
    setRecords(getPatternRecords());
  }, [history]);

  useEffect(() => {
    let cancelled = false;
    if (!stats.messagesAnalyzed) { setSummary(null); return; }
    setLoadingSummary(true);
    requestDashboardSummary(stats).then((res) => {
      if (cancelled) return;
      setLoadingSummary(false);
      if (res.ok) setSummary({ text: res.data.summary, source: res.data.source });
      else setSummary({ text: 'Summary unavailable right now — the statistics below are computed on-device.', source: 'rule' });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats.messagesAnalyzed, stats.highRisk, stats.mostCommonScamType]);

  if (!records.length) {
    return <EmptyState icon={LayoutDashboard} title="No data yet" body="Your Safety Dashboard fills up as you investigate messages. Only anonymized patterns are stored — never the message text." action={<button type="button" onClick={onNewScan} className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer">Run your first investigation</button>} />;
  }

  const levelCounts = (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((l) => ({ level: l, count: records.filter((r) => r.level === l).length }));
  const typeCounts = countBy(records.filter((r) => r.level !== 'LOW').map((r) => r.scamType)).slice(0, 6);
  const tacticCounts = countBy(records.flatMap((r) => r.tactics)).slice(0, 6);
  const indicatorCounts = countBy(records.flatMap((r) => r.indicatorIds)).slice(0, 8);

  return (
    <div className="space-y-5 max-w-5xl mx-auto animate-fadeIn">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center"><LayoutDashboard className="w-5 h-5" aria-hidden="true" /></div>
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Personal Safety Dashboard</h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">Built from {records.length} anonymized scan record{records.length === 1 ? '' : 's'} stored on this device.</p>
          </div>
        </div>
        <SecondaryButton onClick={() => { if (window.confirm('Clear anonymized pattern memory? Scan history is kept.')) { clearPatternRecords(); setRecords([]); } }}><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Clear pattern memory</SecondaryButton>
      </div>

      {/* AI summary */}
      <Card className="border-blue-200 dark:border-blue-500/30">
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">AI summary</span>
              {summary && <span className="inline-flex items-center gap-1"><Cpu className="w-3 h-3 text-slate-400" aria-hidden="true" /><SourceTag source={summary.source} /></span>}
            </div>
            {loadingSummary && !summary ? <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Summarising your recent activity…</p> : <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">{summary?.text}</p>}
          </div>
        </div>
      </Card>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Tile icon={Database} label="Messages analyzed" value={stats.messagesAnalyzed} tone="text-slate-700 dark:text-slate-200" />
        <Tile icon={ShieldAlert} label="High risk" value={stats.highRisk} tone="text-rose-600 dark:text-rose-400" />
        <Tile icon={Link2} label="Suspicious URLs" value={stats.suspiciousUrls} tone="text-blue-600 dark:text-blue-400" />
        <Tile icon={Fingerprint} label="Phishing attempts" value={stats.phishingAttempts} tone="text-indigo-600 dark:text-indigo-400" />
        <Tile icon={KeyRound} label="Credential attacks" value={stats.credentialAttacks} tone="text-purple-600 dark:text-purple-400" />
        <Tile icon={Banknote} label="Financial scams" value={stats.financialScams} tone="text-amber-600 dark:text-amber-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Most common */}
        <Card>
          <SectionTitle icon={ShieldAlert} iconClass="text-rose-600 dark:text-rose-400" title="Most common threats" subtitle={stats.mostCommonScamType ? `Top threat: ${stats.mostCommonScamType}` : 'No risky scans yet'} />
          <BarList rows={typeCounts} total={records.length} color="bg-rose-500" empty="No high or medium risk scans yet." />
        </Card>
        <Card>
          <SectionTitle icon={Drama} iconClass="text-purple-600 dark:text-purple-400" title="Manipulation techniques" subtitle={stats.mostCommonTactic ? `Most common: ${stats.mostCommonTactic}` : 'Tactics appear once AI profiling has run'} />
          <BarList rows={tacticCounts} total={records.length} color="bg-purple-500" empty="No tactics recorded yet." />
        </Card>
        <Card>
          <SectionTitle icon={LayoutDashboard} iconClass="text-slate-600 dark:text-slate-400" title="Risk distribution" />
          <div className="space-y-2">
            {levelCounts.map(({ level, count }) => (
              <div key={level} className="flex items-center gap-3">
                <RiskBadge level={level} size="sm" className="w-24 justify-center" />
                <div className="flex-1 h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden"><div className={`h-full ${LEVEL_TOKENS[level].solid}`} style={{ width: `${records.length ? (count / records.length) * 100 : 0}%` }} /></div>
                <span className="w-8 text-right font-mono text-xs tabular-nums text-slate-600 dark:text-slate-400">{count}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <SectionTitle icon={Database} iconClass="text-cyan-600 dark:text-cyan-400" title="Scam pattern memory" subtitle="Recurring indicator combinations across your scans — the signature of a campaign." />
          {stats.recurringPatterns.length ? (
            <ul className="space-y-2">
              {stats.recurringPatterns.map((p) => (
                <li key={p.label} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                  <span className="text-xs font-semibold text-slate-900 dark:text-white">{p.label}</span>
                  <span className="text-[11px] font-mono text-slate-500 tabular-nums">seen {p.count}×</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500 italic">No recurring pattern yet — patterns appear once two or more risky scans share the same signals.</p>
          )}
          {indicatorCounts.length > 0 && (
            <div className="mt-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Most frequent signals</div>
              <div className="flex flex-wrap gap-1.5">
                {indicatorCounts.map(([id, n]) => <span key={id} className="px-2 py-0.5 rounded-md text-[11px] bg-white/80 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">{describeIndicator(id)} <span className="font-mono text-slate-400">×{n}</span></span>)}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

const Tile: React.FC<{ icon: React.ElementType; label: string; value: number; tone: string }> = ({ icon: Icon, label, value, tone }) => (
  <div className="p-3.5 rounded-2xl bg-white/85 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 backdrop-blur-sm shadow-xs">
    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"><Icon className={`w-3.5 h-3.5 ${tone}`} aria-hidden="true" /> {label}</div>
    <div className={`text-2xl font-extrabold tabular-nums mt-1 ${tone}`}>{value}</div>
  </div>
);

const BarList: React.FC<{ rows: Array<[string, number]>; total: number; color: string; empty: string }> = ({ rows, total, color, empty }) => {
  if (!rows.length) return <p className="text-xs text-slate-500 italic">{empty}</p>;
  const max = Math.max(...rows.map((r) => r[1]), 1);
  return (
    <ul className="space-y-2">
      {rows.map(([label, n]) => (
        <li key={label} className="flex items-center gap-3">
          <span className="w-40 text-xs text-slate-700 dark:text-slate-300 truncate" title={label}>{label}</span>
          <div className="flex-1 h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${(n / max) * 100}%` }} /></div>
          <span className="w-14 text-right font-mono text-[11px] tabular-nums text-slate-500">{n} · {Math.round((n / total) * 100)}%</span>
        </li>
      ))}
    </ul>
  );
};

function countBy(arr: string[]): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const a of arr) m.set(a, (m.get(a) || 0) + 1);
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
}

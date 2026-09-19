import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Cpu, ListChecks, ShieldAlert, ShieldCheck, AlertTriangle, OctagonAlert, Eye } from 'lucide-react';
import type { InvestigationReport } from '../../types';
import { ENGINE_LABEL, LEVEL_TOKENS } from '../../utils/risk';
import { Pill, RiskBadge, SourceTag } from '../ui/primitives';

interface Props {
  report: InvestigationReport;
  onShowWhy: () => void;
}

const LEVEL_ICON = { LOW: ShieldCheck, MEDIUM: AlertTriangle, HIGH: ShieldAlert, CRITICAL: OctagonAlert } as const;

const LEVEL_HEADLINE = {
  LOW: 'No strong scam indicators',
  MEDIUM: 'Suspicious — verify before acting',
  HIGH: 'High-risk scam indicators',
  CRITICAL: 'Critical — treat as a scam',
} as const;

export const VerdictCard: React.FC<Props> = ({ report, onShowWhy }) => {
  const { verdict, indicators } = report;
  const t = LEVEL_TOKENS[verdict.level];
  const Icon = LEVEL_ICON[verdict.level];
  const [breakdownOpen, setBreakdownOpen] = useState(true);
  const positive = indicators.filter((i) => i.points > 0).sort((a, b) => b.points - a.points);
  const negative = indicators.filter((i) => i.points < 0);
  const rawSum = indicators.reduce((a, i) => a + i.points, 0);

  return (
    <section className={`rounded-2xl bg-white/90 dark:bg-slate-900/90 border ${t.border} shadow-md dark:shadow-xl backdrop-blur-sm overflow-hidden transition-colors`} aria-labelledby="verdict-heading">
      <div className={`h-1.5 bg-gradient-to-r ${t.bar}`} aria-hidden="true" />
      <div className="p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          {/* Verdict */}
          <div className="space-y-3 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <RiskBadge level={verdict.level} />
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-full border border-slate-200 dark:border-slate-700/60">{verdict.scamType}</span>
              <Pill className="bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800" title={report.model ? `Model: ${report.model}` : undefined}>
                <Cpu className="w-3 h-3" aria-hidden="true" /> {ENGINE_LABEL[report.engine] || report.engine}
              </Pill>
            </div>
            <h2 id="verdict-heading" className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white leading-snug flex items-start gap-2">
              <Icon className={`w-6 h-6 mt-0.5 flex-shrink-0 ${t.text}`} aria-hidden="true" />
              <span>{LEVEL_HEADLINE[verdict.level]}</span>
            </h2>
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{verdict.summary}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              <strong className="text-slate-800 dark:text-slate-200">Confidence: {verdict.confidence}.</strong> {verdict.confidenceNote}
            </p>
            <button
              type="button"
              id="btn-show-me-why"
              onClick={onShowWhy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/60"
            >
              <Eye className="w-4 h-4" aria-hidden="true" />
              Show Me Why
            </button>
          </div>

          {/* Score */}
          <div className="bg-slate-50/90 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-xl p-4 min-w-[200px] shadow-xs">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Risk Score</div>
            <div className="flex items-end gap-1 my-1">
              <span className={`text-5xl font-extrabold tracking-tight tabular-nums ${t.text}`}>{verdict.riskScore}</span>
              <span className="text-sm text-slate-400 font-bold pb-2">/100</span>
            </div>
            <div className="w-full bg-slate-200 dark:bg-slate-800 h-2 rounded-full overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={verdict.riskScore} aria-label="Risk score">
              <div className={`h-full bg-gradient-to-r ${t.bar} transition-[width] duration-700`} style={{ width: `${Math.max(3, verdict.riskScore)}%` }} />
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-1 font-mono">
              <span>LOW</span><span>MED</span><span>HIGH</span><span>CRIT</span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
              {positive.length} indicator{positive.length === 1 ? '' : 's'}{negative.length ? `, ${negative.length} mitigating` : ''}{rawSum > 100 ? ' · capped at 100' : ''}
            </p>
          </div>
        </div>

        {/* Score breakdown */}
        <div className="mt-5 border-t border-slate-200 dark:border-slate-800 pt-4">
          <button type="button" onClick={() => setBreakdownOpen((v) => !v)} className="w-full flex items-center justify-between text-left cursor-pointer group" aria-expanded={breakdownOpen} aria-controls="score-breakdown">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
              <ListChecks className="w-4 h-4 text-slate-500" aria-hidden="true" /> Score breakdown
            </span>
            {breakdownOpen ? <ChevronUp className="w-4 h-4 text-slate-500" aria-hidden="true" /> : <ChevronDown className="w-4 h-4 text-slate-500" aria-hidden="true" />}
          </button>

          {breakdownOpen && (
            <div id="score-breakdown" className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-1.5">
              {[...positive, ...negative].map((ind) => {
                const share = Math.min(100, (Math.abs(ind.points) / 25) * 100);
                const isNeg = ind.points < 0;
                return (
                  <div key={ind.id} className="flex items-center gap-3 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">{ind.label}</span>
                        <SourceTag source={ind.source} />
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate" title={ind.evidence}>{ind.evidence}</div>
                    </div>
                    <div className="w-16 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden hidden sm:block" aria-hidden="true">
                      <div className={`h-full ${isNeg ? 'bg-emerald-500' : t.solid}`} style={{ width: `${share}%` }} />
                    </div>
                    <span className={`w-10 text-right font-mono text-sm font-bold tabular-nums ${isNeg ? 'text-emerald-600 dark:text-emerald-400' : t.text}`}>{isNeg ? '' : '+'}{ind.points}</span>
                  </div>
                );
              })}
              {indicators.length === 0 && <p className="text-xs text-slate-500 italic">No indicators contributed to the score.</p>}
            </div>
          )}
        </div>

        {/* Why this was flagged */}
        <div className="mt-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 mb-2">{verdict.level === 'LOW' ? 'Why this looks safe' : 'Why this was flagged'}</h4>
          <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
            {report.whyFlagged.map((w, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${verdict.level === 'LOW' ? 'bg-emerald-500' : t.solid}`} aria-hidden="true" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
};

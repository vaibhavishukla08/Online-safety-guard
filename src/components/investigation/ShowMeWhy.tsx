import React from 'react';
import { Eye, X } from 'lucide-react';
import type { InvestigationReport } from '../../types';
import { AGENT_META, LEVEL_TOKENS } from '../../utils/risk';
import { Card, SectionTitle, SourceTag } from '../ui/primitives';

interface Props {
  report: InvestigationReport;
  onClose: () => void;
}

const SEVERITY_CLASS = {
  high: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/30',
  medium: 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/30',
  low: 'bg-slate-200 text-slate-800 border-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600',
};

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

/** "Show Me Why" — numbered evidence breakdown grouped by contributing agent. */
export const ShowMeWhy: React.FC<Props> = ({ report, onClose }) => {
  const t = LEVEL_TOKENS[report.verdict.level];
  const items = [...report.evidence].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const bySource = {
    rule: items.filter((e) => e.source === 'rule').length,
    ai: items.filter((e) => e.source === 'ai').length,
    external: items.filter((e) => e.source === 'external').length,
  };

  return (
    <Card id="show-me-why" className={`ring-2 ${t.ring}`}>
      <SectionTitle
        icon={Eye}
        iconClass="text-slate-900 dark:text-white"
        title="Show Me Why"
        subtitle={`Risk score ${report.verdict.riskScore}/100 · ${items.length} evidence item${items.length === 1 ? '' : 's'} · ${bySource.rule} rule-based, ${bySource.ai} AI, ${bySource.external} external`}
        right={
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer" aria-label="Close evidence breakdown">
            <X className="w-4 h-4" />
          </button>
        }
      />

      {items.length === 0 ? (
        <p className="text-xs text-slate-500 italic">No specific evidence items were recorded. The message did not trigger any rule, AI, or external checks.</p>
      ) : (
        <ol className="space-y-2.5">
          {items.map((e, i) => {
            const meta = AGENT_META[e.agent];
            const Icon = meta.icon;
            return (
              <li key={e.id} className="flex gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                <span className="w-6 h-6 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-xs font-bold flex items-center justify-center flex-shrink-0 tabular-nums" aria-hidden="true">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">{e.title}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${SEVERITY_CLASS[e.severity]}`}>{e.severity}</span>
                    <SourceTag source={e.source} />
                    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${meta.chip}`}>
                      <Icon className="w-3 h-3" aria-hidden="true" /> {meta.label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{e.description}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-4 text-[11px] text-slate-500 dark:text-slate-400">
        Rule-based items are reproducible pattern checks. AI items are Gemini's interpretation of context. External items were retrieved from third-party services and are shown exactly as returned.
      </p>
    </Card>
  );
};

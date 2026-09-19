import React, { useState } from 'react';
import { Activity, CheckCircle2, ChevronDown, ChevronUp, Loader2, SkipForward, XCircle, CloudOff } from 'lucide-react';
import type { TraceStep } from '../../types';
import { AGENT_META, formatClock } from '../../utils/risk';
import { Card, SectionTitle } from '../ui/primitives';

interface Props {
  steps: TraceStep[];
  live?: boolean;
  compact?: boolean;
  agentsRunCount?: number;
}

const STATUS_ICON: Record<TraceStep['status'], { icon: React.ElementType; className: string; label: string }> = {
  running: { icon: Loader2, className: 'text-rose-500 animate-spin', label: 'Running' },
  completed: { icon: CheckCircle2, className: 'text-emerald-600 dark:text-emerald-400', label: 'Completed' },
  skipped: { icon: SkipForward, className: 'text-slate-400', label: 'Skipped by orchestrator' },
  unavailable: { icon: CloudOff, className: 'text-amber-500', label: 'Source unavailable' },
  failed: { icon: XCircle, className: 'text-rose-600', label: 'Failed' },
};

export const InvestigationTrace: React.FC<Props> = ({ steps, live = false, compact = false, agentsRunCount }) => {
  const [showSkipped, setShowSkipped] = useState(!compact);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const visible = showSkipped ? steps : steps.filter((s) => s.status !== 'skipped');
  const skippedCount = steps.filter((s) => s.status === 'skipped').length;
  const distinctAgents = agentsRunCount ?? new Set(steps.filter((s) => s.status === 'completed').map((s) => s.agent)).size;

  return (
    <Card>
      <SectionTitle
        icon={Activity}
        iconClass="text-rose-600 dark:text-rose-400"
        title="AI Investigation Trace"
        subtitle={live ? 'Agents are working — steps appear as they complete.' : `${distinctAgents} agents collaborated on this investigation. Summaries only — no private reasoning is shown.`}
        right={
          skippedCount > 0 ? (
            <button type="button" onClick={() => setShowSkipped((v) => !v)} className="text-[11px] font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer underline-offset-2 hover:underline">
              {showSkipped ? 'Hide' : 'Show'} {skippedCount} skipped
            </button>
          ) : null
        }
      />

      <ol className="relative ml-2 border-l border-slate-200 dark:border-slate-800 space-y-1" aria-live={live ? 'polite' : undefined}>
        {visible.map((step) => {
          const meta = AGENT_META[step.agent];
          const Icon = meta.icon;
          const status = STATUS_ICON[step.status];
          const StatusIcon = status.icon;
          const isSkipped = step.status === 'skipped';
          const hasDetails = Boolean(step.details && step.details.length);
          const open = expanded[step.id];
          return (
            <li key={step.id} className={`relative pl-6 py-2 ${isSkipped ? 'opacity-60' : ''}`}>
              <span className={`absolute -left-[13px] top-2.5 w-6 h-6 rounded-lg flex items-center justify-center ${meta.chip} ring-2 ring-white dark:ring-slate-900`} aria-hidden="true">
                <Icon className="w-3.5 h-3.5" />
              </span>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">{formatClock(step.timestamp)}</span>
                    <span className="text-xs font-bold text-slate-900 dark:text-white">{meta.label}</span>
                    {typeof step.durationMs === 'number' && step.status !== 'skipped' && (
                      <span className="font-mono text-[10px] text-slate-400 tabular-nums">{step.durationMs < 1000 ? `${step.durationMs}ms` : `${(step.durationMs / 1000).toFixed(1)}s`}</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed mt-0.5">{step.summary}</p>
                  {hasDetails && open && (
                    <ul className="mt-1.5 space-y-1 text-[11px] text-slate-600 dark:text-slate-400 font-mono">
                      {step.details!.map((d, i) => (
                        <li key={i} className="pl-2 border-l-2 border-slate-200 dark:border-slate-700 break-words">{d}</li>
                      ))}
                    </ul>
                  )}
                  {hasDetails && (
                    <button type="button" onClick={() => setExpanded((e) => ({ ...e, [step.id]: !open }))} className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer" aria-expanded={open}>
                      {open ? <ChevronUp className="w-3 h-3" aria-hidden="true" /> : <ChevronDown className="w-3 h-3" aria-hidden="true" />}
                      {open ? 'Hide evidence' : `Evidence (${step.details!.length})`}
                    </button>
                  )}
                </div>
                <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400 flex-shrink-0" title={status.label}>
                  <StatusIcon className={`w-3.5 h-3.5 ${status.className}`} aria-hidden="true" />
                  <span className="hidden sm:inline">{status.label}</span>
                </span>
              </div>
            </li>
          );
        })}
        {live && steps.length === 0 && (
          <li className="pl-6 py-2 text-xs text-slate-500 flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Contacting the Safety Orchestrator…
          </li>
        )}
      </ol>
    </Card>
  );
};

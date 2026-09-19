import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Copy, Check, Flag, Database, GraduationCap, ScanEye } from 'lucide-react';
import type { InvestigationReport } from '../../types';
import { HighlightedMessage } from '../HighlightedMessage';
import { VerdictCard } from './VerdictCard';
import { ShowMeWhy } from './ShowMeWhy';
import { InvestigationTrace } from './InvestigationTrace';
import { SocialEngineeringPanel, IdentityPanel, ExternalEvidencePanel, ScamDnaPanel, ConversationPanel, ExposurePanel } from './AnalysisPanels';
import { ProtectionPlanPanel } from './ProtectionPlanPanel';
import { IncidentResponsePanel } from './IncidentResponsePanel';
import { Card, SectionTitle, SecondaryButton, Notice, PrimaryButton } from '../ui/primitives';
import { AGENT_META } from '../../utils/risk';

interface Props {
  report: InvestigationReport;
  /** Number of earlier scans on this device sharing the same pattern. */
  memoryMatch?: { similar: number; sharedLabel: string | null };
  onScanAnother: () => void;
  onOpenCoach: () => void;
}

export const InvestigationReportView: React.FC<Props> = ({ report, memoryMatch, onScanAnother, onOpenCoach }) => {
  const [showWhy, setShowWhy] = useState(false);
  const [copied, setCopied] = useState(false);
  const whyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showWhy) whyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [showWhy]);

  const copyReport = () => {
    const v = report.verdict;
    const text = `[ONLINE SAFETY GUARD — INVESTIGATION REPORT]
Time: ${new Date(report.timestamp).toLocaleString()}
Verdict: ${v.level} (${v.riskScore}/100) — ${v.scamType}
Confidence: ${v.confidence} — ${v.confidenceNote}
Engine: ${report.engine}${report.model ? ` (${report.model})` : ''}

SUMMARY
${v.summary}

SCORE BREAKDOWN
${report.indicators.map((i) => `${i.points >= 0 ? '+' : ''}${i.points}  ${i.label} [${i.source}] — ${i.evidence}`).join('\n')}

WHY THIS WAS FLAGGED
${report.whyFlagged.map((w) => `- ${w}`).join('\n')}

EVIDENCE
${report.evidence.map((e, i) => `${i + 1}. ${e.title} (${e.severity}, ${e.source}): ${e.description}`).join('\n')}

${report.identity ? `IDENTITY\n${report.identity.verdict}\n\n` : ''}${report.socialEngineering ? `PSYCHOLOGICAL ATTACK\nPrimary: ${report.socialEngineering.primaryTactics.join(' + ')}\nGoal: ${report.socialEngineering.attackerGoal}\n\n` : ''}${report.external ? `EXTERNAL EVIDENCE\n${report.external.sources.map((s) => `- ${s.source}: ${s.summary}`).join('\n')}\n\n` : ''}PROTECTION PLAN
Immediate: ${report.protectionPlan.immediateActions.join(' | ')}
Do not: ${report.protectionPlan.whatNotToDo.join(' | ')}
Account: ${report.protectionPlan.accountProtection.join(' | ')}
Payment: ${report.protectionPlan.paymentProtection.join(' | ')}
Report: ${report.protectionPlan.reporting.join(' | ')}
Evidence: ${report.protectionPlan.evidencePreservation.join(' | ')}

INVESTIGATION TRACE
${report.trace.map((t) => `${new Date(t.timestamp).toLocaleTimeString()}  ${AGENT_META[t.agent].label} — ${t.status}: ${t.summary}`).join('\n')}
`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => undefined);
  };

  const incidentContext = {
    scamType: report.verdict.scamType,
    claimedOrganization: report.identity?.claimedOrganization ?? null,
    organizationCategory: report.identity?.organizationCategory ?? null,
    level: report.verdict.level,
    paymentMethods: report.financial?.paymentMethods || [],
    platform: report.input.platform,
    urls: report.urls.map((u) => u.hostname),
  };

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-200 dark:border-slate-800">
        <SecondaryButton id="btn-scan-another-top" onClick={onScanAnother}>
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> New investigation
        </SecondaryButton>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">{new Date(report.timestamp).toLocaleString()}</span>
          <SecondaryButton id="btn-copy-report" onClick={copyReport}>
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
            {copied ? 'Report copied' : 'Copy full report'}
          </SecondaryButton>
        </div>
      </div>

      {report.notices.length > 0 && (
        <Notice tone={report.engine === 'deterministic' ? 'warn' : 'info'}>
          <ul className="space-y-0.5">{report.notices.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </Notice>
      )}

      <VerdictCard report={report} onShowWhy={() => setShowWhy(true)} />

      {showWhy && (
        <div ref={whyRef}>
          <ShowMeWhy report={report} onClose={() => setShowWhy(false)} />
        </div>
      )}

      {memoryMatch && memoryMatch.similar > 0 && (
        <Notice tone="info">
          <span className="inline-flex items-center gap-1.5 font-semibold"><Database className="w-3.5 h-3.5" aria-hidden="true" /> Pattern memory:</span> this matches the pattern <em>{memoryMatch.sharedLabel}</em> seen in {memoryMatch.similar} earlier scan{memoryMatch.similar === 1 ? '' : 's'} on this device. Recurring combinations like this usually come from the same scam campaign.
        </Notice>
      )}

      {/* Screenshot extraction summary */}
      {report.input.extracted && (
        <Card>
          <SectionTitle icon={ScanEye} iconClass="text-sky-600 dark:text-sky-400" title="Extracted from screenshot" subtitle="The Vision Agent read these facts; every downstream agent worked from them." />
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            {[
              ['Sender', report.input.extracted.senderName || report.input.extracted.phoneNumber || report.input.extracted.emailAddress || '—'],
              ['Platform', report.input.extracted.platform || '—'],
              ['Claimed org', report.input.extracted.claimedOrganization || '—'],
              ['Links', report.input.extracted.urls.length ? report.input.extracted.urls.join(', ') : 'None'],
              ['Payment request', report.input.extracted.paymentRequest || 'None'],
              ['Credential request', report.input.extracted.credentialRequest || 'None'],
            ].map(([k, v]) => (
              <div key={k} className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 min-w-0">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{k}</dt>
                <dd className="font-medium text-slate-900 dark:text-white break-words mt-0.5">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      <InvestigationTrace steps={report.trace} agentsRunCount={report.agentsRun.length} compact />

      {/* Message breakdown */}
      <Card>
        <SectionTitle icon={Flag} title="Message Breakdown" subtitle={`${report.highlightPhrases.length} flagged element${report.highlightPhrases.length === 1 ? '' : 's'} — click a highlight to see why.`} />
        <HighlightedMessage message={report.input.message} sender={report.input.sender || undefined} platform={report.input.platform || undefined} highlights={report.highlightPhrases} />
      </Card>

      {report.conversation && <ConversationPanel report={report} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SocialEngineeringPanel report={report} />
        <IdentityPanel report={report} />
        <ScamDnaPanel dna={report.scamDna} level={report.verdict.level} compact />
        <ExposurePanel report={report} />
      </div>

      {report.external && <ExternalEvidencePanel report={report} />}

      <ProtectionPlanPanel report={report} />

      <IncidentResponsePanel context={incidentContext} />

      {/* Learn */}
      <Card className="bg-gradient-to-r from-purple-50 to-white dark:from-purple-950/30 dark:to-slate-900/80">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-500/15 text-purple-600 dark:text-purple-400 flex items-center justify-center flex-shrink-0"><GraduationCap className="w-5 h-5" aria-hidden="true" /></div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Learn to spot this yourself</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">The Safety Coach will generate a similar {report.verdict.scamType.toLowerCase()} scenario and quiz you on the safest response.</p>
            </div>
          </div>
          <PrimaryButton onClick={onOpenCoach} className="w-full sm:w-auto"><GraduationCap className="w-4 h-4" aria-hidden="true" /> Train with Safety Coach</PrimaryButton>
        </div>
      </Card>

      <div className="flex justify-center pt-2">
        <PrimaryButton id="btn-scan-another-bottom" onClick={onScanAnother}>Investigate another message</PrimaryButton>
      </div>
    </div>
  );
};

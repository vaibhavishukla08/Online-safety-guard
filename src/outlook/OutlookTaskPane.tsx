/**
 * Outlook task pane — "Analyze with Online Safety Guard".
 *
 * Reads the currently opened email via Office.js, sends it to the existing
 * /api/analyze-email channel (same Safety Orchestrator + agents + Gemini), and
 * renders a compact result. All text is rendered as React text nodes (never
 * innerHTML), links are never opened, attachments are never downloaded.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldAlert, ShieldCheck, AlertTriangle, OctagonAlert, Loader2, Mail, Paperclip, CheckCircle2, ChevronDown, ChevronUp, RefreshCw, Drama, Link2, ExternalLink, Cpu, Info } from 'lucide-react';
import type { InvestigationReport, TraceStep } from '../types';
import { analyzeEmailStream } from '../api/client';
import { LEVEL_TOKENS, ENGINE_LABEL, AGENT_META } from '../utils/risk';
import { RiskBadge, SourceTag, Notice, PrimaryButton, SecondaryButton } from '../components/ui/primitives';
import { InvestigationTrace } from '../components/investigation/InvestigationTrace';
import { ScamDnaPanel } from '../components/investigation/AnalysisPanels';
import { readCurrentEmail, waitForOffice, officeAvailable, extractUrlsFromText, MAX_BODY_CHARS, type EmailPayload } from './officeEmail';

type Phase = 'booting' | 'no_office' | 'ready' | 'analyzing' | 'done' | 'error';

const LEVEL_ICON = { LOW: ShieldCheck, MEDIUM: AlertTriangle, HIGH: ShieldAlert, CRITICAL: OctagonAlert } as const;
const LEVEL_HEADLINE = { LOW: 'No strong scam indicators', MEDIUM: 'Suspicious — verify before acting', HIGH: 'High-risk email', CRITICAL: 'Critical — treat as a scam' } as const;

/** Human-readable summary of what each agent did, in the simplified trace. */
const TRACE_LABELS: Partial<Record<TraceStep['agent'], string>> = {
  orchestrator: 'Email received and investigation planned',
  message: 'Message language analysed',
  url: 'Links extracted and inspected (not opened)',
  identity: 'Sender / claimed organization checked',
  social_engineering: 'Social-engineering tactics profiled',
  financial: 'Money and credential requests assessed',
  threat_intel: 'External threat intelligence consulted',
  conversation: 'Conversation analysed',
  risk: 'Risk indicators combined',
  protection: 'Protection plan generated',
};

export const OutlookTaskPane: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('booting');
  const [email, setEmail] = useState<EmailPayload | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [report, setReport] = useState<InvestigationReport | null>(null);
  const [showInvestigation, setShowInvestigation] = useState(false);
  const [manual, setManual] = useState({ subject: '', sender: '', body: '' });
  const autoRan = useRef(false);

  // ---------------------------------------------------------------- Office.js
  const loadEmail = useCallback(async () => {
    const result = await readCurrentEmail();
    if (result.ok) {
      setEmail(result.email);
      setReadError(null);
    } else {
      setEmail(null);
      setReadError(result.message);
    }
    return result;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ready = await waitForOffice();
      if (cancelled) return;
      if (!ready) {
        setPhase('no_office');
        return;
      }
      setPhase('ready');
      const result = await loadEmail();
      // Re-read when the user switches messages in a pinned pane.
      try {
        window.Office?.context?.mailbox?.addHandlerAsync(window.Office.EventType.ItemChanged, () => {
          setReport(null);
          setTrace([]);
          setError(null);
          setPhase('ready');
          autoRan.current = false;
          void loadEmail();
        });
      } catch {
        /* handler registration is best-effort (needs Mailbox 1.5) */
      }
      // The ribbon click is the user's intent to analyse: run once automatically.
      if (result.ok && !autoRan.current) {
        autoRan.current = true;
        void runAnalysis(result.email);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- analysis
  const runAnalysis = useCallback(async (payload: EmailPayload) => {
    setPhase('analyzing');
    setError(null);
    setTrace([]);
    setReport(null);
    setShowInvestigation(false);
    const res = await analyzeEmailStream(payload, (step) => {
      setTrace((prev) => {
        const idx = prev.findIndex((s) => s.id === step.id);
        if (idx === -1) return [...prev, step];
        const next = prev.slice();
        next[idx] = step;
        return next;
      });
    });
    if (res.ok) {
      setReport(res.data);
      setPhase('done');
    } else {
      setError(friendlyError(res.error.code, res.error.message));
      setPhase('error');
    }
  }, []);

  const analyzeCurrent = async () => {
    const result = officeAvailable() ? await loadEmail() : null;
    if (result && result.ok) {
      await runAnalysis(result.email);
    } else if (!officeAvailable() && (manual.subject.trim() || manual.body.trim())) {
      const body = manual.body.slice(0, MAX_BODY_CHARS);
      await runAnalysis({ subject: manual.subject.trim(), sender: '', senderEmail: manual.sender.trim(), body, urls: extractUrlsFromText(`${manual.subject}\n${body}`), recipientCount: null, attachments: [], truncated: manual.body.length > MAX_BODY_CHARS });
    }
  };

  // ------------------------------------------------------------------ render
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 text-[13px]">
      <header className="sticky top-0 z-10 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-rose-600 via-rose-500 to-amber-500 flex items-center justify-center text-white shadow-md shadow-rose-600/20 flex-shrink-0">
            <ShieldAlert className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold tracking-tight leading-tight">Online Safety Guard</h1>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">AI-powered protection against phishing, scams and social engineering.</p>
          </div>
        </div>
      </header>

      <main className="px-4 py-4 space-y-4">
        {phase === 'booting' && (
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Connecting to Outlook…
          </div>
        )}

        {phase === 'no_office' && (
          <div className="space-y-3">
            <Notice tone="warn">
              <strong>Office.js is not available.</strong> This page is designed to run inside Outlook. Open a message in Outlook and click <em>Analyze with Online Safety Guard</em>. For local testing you can paste an email below — it runs the same real analysis.
            </Notice>
            <div className="space-y-2">
              <input aria-label="Subject" value={manual.subject} onChange={(e) => setManual({ ...manual, subject: e.target.value })} placeholder="Subject" className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm" />
              <input aria-label="Sender email" value={manual.sender} onChange={(e) => setManual({ ...manual, sender: e.target.value })} placeholder="Sender email (e.g. alerts@sbi-secure-login.xyz)" className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm font-mono" />
              <textarea aria-label="Email body" value={manual.body} onChange={(e) => setManual({ ...manual, body: e.target.value })} rows={6} placeholder="Email body" className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm font-mono" />
              <PrimaryButton id="btn-analyze-email" onClick={analyzeCurrent} disabled={!manual.subject.trim() && !manual.body.trim()} className="w-full">
                <Mail className="w-4 h-4" aria-hidden="true" /> Analyze This Email
              </PrimaryButton>
            </div>
          </div>
        )}

        {(phase === 'ready' || phase === 'error') && (
          <div className="space-y-3">
            {email ? <EmailSummary email={email} /> : readError ? <Notice tone="warn">{readError}</Notice> : null}
            {error && <Notice tone="error">{error}</Notice>}
            <PrimaryButton id="btn-analyze-email" onClick={analyzeCurrent} className="w-full">
              {error ? <RefreshCw className="w-4 h-4" aria-hidden="true" /> : <Mail className="w-4 h-4" aria-hidden="true" />}
              {error ? 'Try again' : 'Analyze This Email'}
            </PrimaryButton>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-1.5"><Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" /> Only this email's subject, sender, body text and attachment names are sent to the Online Safety Guard server. Links are never opened and attachments are never downloaded.</p>
          </div>
        )}

        {phase === 'analyzing' && (
          <div className="space-y-3" aria-live="polite">
            {email && <EmailSummary email={email} compact />}
            <div className="flex items-center gap-2 text-sm font-semibold text-rose-700 dark:text-rose-300">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Analyzing email…
            </div>
            <SimplifiedTrace steps={trace} />
          </div>
        )}

        {phase === 'done' && report && (
          <ResultView report={report} email={email} trace={trace.length ? trace : report.trace} showInvestigation={showInvestigation} onToggleInvestigation={() => setShowInvestigation((v) => !v)} onReanalyze={analyzeCurrent} />
        )}
      </main>

      <footer className="px-4 py-3 text-[10px] text-slate-500 dark:text-slate-500 border-t border-slate-200 dark:border-slate-800">
        Results combine deterministic rules, external checks and Gemini analysis. Verify important requests through official channels.
      </footer>
    </div>
  );
};

// ---------------------------------------------------------------------------

const EmailSummary: React.FC<{ email: EmailPayload; compact?: boolean }> = ({ email, compact }) => (
  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
    <div className="flex items-start gap-2">
      <Mail className="w-4 h-4 mt-0.5 text-slate-500 flex-shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-slate-900 dark:text-white break-words">{email.subject || '(no subject)'}</div>
        <div className="text-[11px] text-slate-600 dark:text-slate-400 break-all">From: {email.sender ? `${email.sender} ` : ''}{email.senderEmail ? `<${email.senderEmail}>` : email.sender ? '' : 'unknown sender'}</div>
        {!compact && (
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">{email.body.length.toLocaleString()} chars{email.truncated ? ' (truncated)' : ''}</span>
            {email.urls.length > 0 && <span className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-500/10 text-blue-800 dark:text-blue-300 inline-flex items-center gap-1"><Link2 className="w-3 h-3" aria-hidden="true" /> {email.urls.length} link{email.urls.length === 1 ? '' : 's'}</span>}
            {email.attachments.length > 0 && <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 inline-flex items-center gap-1"><Paperclip className="w-3 h-3" aria-hidden="true" /> {email.attachments.length} attachment{email.attachments.length === 1 ? '' : 's'}</span>}
          </div>
        )}
      </div>
    </div>
  </div>
);

const SimplifiedTrace: React.FC<{ steps: TraceStep[] }> = ({ steps }) => {
  const visible = steps.filter((s) => s.status !== 'skipped');
  return (
    <ul className="space-y-1.5">
      {visible.length === 0 && <li className="text-slate-500 text-xs flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Contacting the Safety Orchestrator…</li>}
      {visible.map((s) => (
        <li key={s.id} className="flex items-start gap-2 text-xs">
          {s.status === 'running' ? <Loader2 className="w-3.5 h-3.5 mt-0.5 animate-spin text-rose-500 flex-shrink-0" aria-hidden="true" /> : s.status === 'failed' ? <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-rose-500 flex-shrink-0" aria-hidden="true" /> : <CheckCircle2 className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${s.status === 'unavailable' ? 'text-amber-500' : 'text-emerald-600'}`} aria-hidden="true" />}
          <span className="text-slate-700 dark:text-slate-300">
            {TRACE_LABELS[s.agent] || AGENT_META[s.agent].label}
            {s.status === 'unavailable' && s.agent === 'threat_intel' && <span className="text-amber-700 dark:text-amber-300"> — threat intelligence lookup unavailable</span>}
          </span>
        </li>
      ))}
    </ul>
  );
};

interface ResultProps {
  report: InvestigationReport;
  email: EmailPayload | null;
  trace: TraceStep[];
  showInvestigation: boolean;
  onToggleInvestigation: () => void;
  onReanalyze: () => void;
}

const ResultView: React.FC<ResultProps> = ({ report, email, trace, showInvestigation, onToggleInvestigation, onReanalyze }) => {
  const v = report.verdict;
  const t = LEVEL_TOKENS[v.level];
  const Icon = LEVEL_ICON[v.level];
  const tactics = [...(report.socialEngineering?.primaryTactics || []), ...(report.socialEngineering?.secondaryTactics || [])];
  const intelUnavailable = report.external ? report.external.availableSources === 0 : false;
  const attachments = report.input.email?.attachments || email?.attachments.map((a) => ({ ...a, risky: false })) || [];

  return (
    <div className="space-y-3 animate-fadeIn" aria-live="polite">
      {report.notices.length > 0 && <Notice tone={report.engine === 'deterministic' ? 'warn' : 'info'}>{report.notices[0]}</Notice>}

      {/* Verdict */}
      <section className={`rounded-xl border ${t.border} ${t.bg} p-4`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Risk level</div>
            <div className="mt-1"><RiskBadge level={v.level} /></div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Risk score</div>
            <div className={`text-3xl font-extrabold tabular-nums leading-none mt-1 ${t.text}`}>{v.riskScore}<span className="text-sm text-slate-400 font-bold"> /100</span></div>
          </div>
        </div>
        <h2 className="mt-3 text-base font-bold flex items-start gap-2 text-slate-900 dark:text-white">
          <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${t.text}`} aria-hidden="true" /> {LEVEL_HEADLINE[v.level]}
        </h2>
        <div className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Scam type</div>
        <div className="text-sm font-semibold text-slate-900 dark:text-white">{v.scamType}</div>
        <p className="mt-2 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{v.summary}</p>
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Confidence: {v.confidence}. {v.confidenceNote}</p>
      </section>

      {/* Why flagged */}
      <section className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 mb-2">{v.level === 'LOW' ? 'Why this looks safe' : 'Why this email was flagged'}</h3>
        <ul className="space-y-1.5">
          {report.whyFlagged.map((w, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300">
              {v.level === 'LOW' ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-emerald-600 flex-shrink-0" aria-hidden="true" /> : <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${t.text}`} aria-hidden="true" />}
              <span>{w}</span>
            </li>
          ))}
        </ul>
        {report.indicators.filter((i) => i.points > 0).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {report.indicators.filter((i) => i.points > 0).sort((a, b) => b.points - a.points).slice(0, 8).map((i) => (
              <span key={i.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-700 dark:text-slate-300" title={i.evidence}>
                {i.label} <span className={`font-mono font-bold ${t.text}`}>+{i.points}</span>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Links + attachments */}
      {(report.urls.length > 0 || attachments.length > 0) && (
        <section className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 space-y-2">
          {report.urls.map((u) => (
            <div key={u.normalized} className="text-xs">
              <div className="flex items-center gap-1.5 font-mono font-semibold text-slate-900 dark:text-white break-all"><Link2 className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" aria-hidden="true" /> {u.hostname}</div>
              {u.flags.length > 0 ? <ul className="ml-5 mt-0.5 text-[11px] text-rose-700 dark:text-rose-300">{u.flags.map((f) => <li key={f}>• {f}</li>)}</ul> : <div className="ml-5 text-[11px] text-slate-500">No structural red flags</div>}
            </div>
          ))}
          {report.external && (
            <div className="text-[11px] text-slate-600 dark:text-slate-400 ml-5">
              {intelUnavailable ? 'Threat intelligence lookup unavailable.' : `External evidence: ${report.external.sources.filter((s) => s.status === 'ok').map((s) => `${s.source} — ${s.summary}`).join(' · ')}`}
            </div>
          )}
          {attachments.map((a) => (
            <div key={a.name} className={`flex items-start gap-2 text-xs p-2 rounded-lg ${a.risky ? 'bg-rose-50 dark:bg-rose-500/10' : 'bg-amber-50 dark:bg-amber-500/10'}`}>
              <Paperclip className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${a.risky ? 'text-rose-600' : 'text-amber-600'}`} aria-hidden="true" />
              <div className="min-w-0">
                <div className="font-semibold text-slate-900 dark:text-white">⚠ Attachment detected</div>
                <div className="font-mono break-all">{a.name}</div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400">{a.risky ? 'File type commonly used for malware — do not open.' : 'Attachment requires separate analysis. Do not open it unless you trust the sender.'}</div>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Social engineering */}
      {tactics.length > 0 && (
        <section className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 mb-2 flex items-center gap-1.5"><Drama className="w-3.5 h-3.5 text-purple-600" aria-hidden="true" /> Social engineering {report.socialEngineering && <SourceTag source={report.socialEngineering.source} />}</h3>
          <ul className="flex flex-wrap gap-1.5">
            {tactics.map((x) => <li key={x} className="px-2 py-0.5 rounded-md text-[11px] bg-purple-50 dark:bg-purple-500/10 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-500/30">• {x}</li>)}
          </ul>
          {report.socialEngineering?.attackerGoal && <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-400"><strong>Attacker goal:</strong> {report.socialEngineering.attackerGoal}</p>}
        </section>
      )}

      {/* Recommended action */}
      <section className="rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-500/20 p-4">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-emerald-900 dark:text-emerald-200 mb-2 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" /> Recommended action <SourceTag source={report.protectionPlan.source} /></h3>
        <ul className="space-y-1.5 text-xs text-slate-800 dark:text-slate-200">
          {report.protectionPlan.immediateActions.slice(0, 3).map((a, i) => <li key={i} className="flex items-start gap-2"><CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-emerald-600 flex-shrink-0" aria-hidden="true" /> {a}</li>)}
          {report.protectionPlan.whatNotToDo.slice(0, 2).map((a, i) => <li key={`n${i}`} className="flex items-start gap-2"><OctagonAlert className="w-3.5 h-3.5 mt-0.5 text-rose-600 flex-shrink-0" aria-hidden="true" /> {a}</li>)}
        </ul>
        <p className="mt-2 text-[11px] text-slate-700 dark:text-slate-300"><strong>Verify:</strong> {report.protectionPlan.officialVerificationStep}</p>
      </section>

      {/* Investigation toggle */}
      <SecondaryButton onClick={onToggleInvestigation} className="w-full" aria-expanded={showInvestigation}>
        {showInvestigation ? <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />}
        {showInvestigation ? 'Hide investigation' : 'Show Investigation'}
      </SecondaryButton>
      {showInvestigation && (
        <div className="space-y-3">
          <InvestigationTrace steps={trace} agentsRunCount={report.agentsRun.length} compact />
          <ScamDnaPanel dna={report.scamDna} level={v.level} compact />
          {report.identity && (
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 text-xs">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 mb-1">Identity check <SourceTag source={report.identity.source} /></h3>
              <p className="text-slate-700 dark:text-slate-300">{report.identity.verdict}</p>
            </div>
          )}
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 text-xs">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 mb-2">Evidence ({report.evidence.length})</h3>
            <ol className="space-y-1.5">
              {report.evidence.map((e, i) => (
                <li key={e.id} className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5" aria-hidden="true">{i + 1}</span>
                  <span className="min-w-0"><span className="font-semibold">{e.title}</span> <SourceTag source={e.source} /><br /><span className="text-slate-600 dark:text-slate-400">{e.description}</span></span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="inline-flex items-center gap-1 text-[10px] text-slate-500"><Cpu className="w-3 h-3" aria-hidden="true" /> {ENGINE_LABEL[report.engine] || report.engine}</span>
        <div className="flex items-center gap-2">
          <a href="/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"><ExternalLink className="w-3 h-3" aria-hidden="true" /> Open full app</a>
          <SecondaryButton onClick={onReanalyze}><RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Re-analyze</SecondaryButton>
        </div>
      </div>
    </div>
  );
};

function friendlyError(code: string, fallback: string): string {
  switch (code) {
    case 'network':
      return 'Online Safety Guard could not reach the analysis server. Please check the server is running and try again.';
    case 'timeout':
      return 'The analysis took too long and was stopped. Please try again.';
    case 'rate_limited':
      return 'Too many analyses in a short time. Please wait a minute and try again.';
    case 'empty_input':
      return 'This email has no readable content to analyse.';
    case 'too_large':
      return 'This email is too large to analyse in one go. Try forwarding the relevant part.';
    default:
      return fallback || 'Analysis failed. Please try again.';
  }
}

import React, { useCallback, useEffect, useState } from 'react';
import { X, Loader2, Play, RefreshCw, Trash2, ExternalLink, Paperclip, Link2, AlertTriangle, CheckCircle2, OctagonAlert, ShieldCheck, FileSearch, ChevronUp, Mail, Fingerprint } from 'lucide-react';
import type { EmailRecordDetail, InvestigationReport, TraceStep } from '../../types';
import { analyzeStoredEmailStream, mailApi } from '../../api/client';
import { LEVEL_TOKENS, ENGINE_LABEL } from '../../utils/risk';
import { Card, Notice, PrimaryButton, SecondaryButton, RiskBadge, SourceTag } from '../ui/primitives';
import { InvestigationTrace } from '../investigation/InvestigationTrace';
import { ScamDnaPanel } from '../investigation/AnalysisPanels';
import { InvestigationReportView } from '../investigation/InvestigationReportView';
import { ProviderChip, RiskStatus, formatDateTime, timeAgo } from './shared';

interface Props {
  recordId: string;
  initialView?: 'summary' | 'investigation';
  onClose: () => void;
  onChanged: (record: EmailRecordDetail | null) => void;
  onOpenCoach: () => void;
}

export const EmailDetail: React.FC<Props> = ({ recordId, initialView = 'summary', onClose, onChanged, onOpenCoach }) => {
  const [record, setRecord] = useState<EmailRecordDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'summary' | 'investigation'>(initialView);
  const [analyzing, setAnalyzing] = useState(false);
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await mailApi.get(recordId);
    setLoading(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setRecord(res.data.record);
    setError(null);
  }, [recordId]);

  useEffect(() => {
    setView(initialView);
    void load();
  }, [load, initialView]);

  const run = async (force: boolean) => {
    setAnalyzing(true);
    setError(null);
    setFlash(null);
    setTrace([]);
    const res = await analyzeStoredEmailStream(recordId, force, (step) => {
      setTrace((prev) => {
        const idx = prev.findIndex((s) => s.id === step.id);
        if (idx === -1) return [...prev, step];
        const next = prev.slice();
        next[idx] = step;
        return next;
      });
    });
    setAnalyzing(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    if (res.data.meta?.cached) setFlash('An analysis already existed for this email, so it was not run again. Use Re-analyze to run it afresh.');
    else if (res.data.meta?.notified) setFlash('Analysis saved. A notification was added to your dashboard.');
    else setFlash('Analysis saved to your history.');
    const refreshed = await mailApi.get(recordId);
    if (refreshed.ok) {
      setRecord(refreshed.data.record);
      onChanged(refreshed.data.record);
    }
  };

  const remove = async () => {
    if (!window.confirm('Delete this email and its analysis from your history?')) return;
    const res = await mailApi.remove(recordId);
    if (res.ok) {
      onChanged(null);
      onClose();
    } else setError(res.error.message);
  };

  if (loading && !record) {
    return (
      <Card className="flex items-center justify-center gap-2 py-12 text-sm text-slate-600 dark:text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading email…
      </Card>
    );
  }
  if (!record) {
    return (
      <Card>
        <Notice tone="error">{error || 'Email not found.'}</Notice>
        <SecondaryButton onClick={onClose} className="mt-3"><X className="w-3.5 h-3.5" aria-hidden="true" /> Close</SecondaryButton>
      </Card>
    );
  }

  const report: InvestigationReport | null = record.analysis;
  const analyzed = record.analysisStatus === 'analyzed' && report;

  if (view === 'investigation' && analyzed) {
    return (
      <div className="space-y-3 animate-fadeIn">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">Full investigation</div>
            <div className="text-sm font-bold text-slate-900 dark:text-white truncate">{record.subject || '(no subject)'}</div>
          </div>
          <div className="flex items-center gap-2">
            <SecondaryButton onClick={() => setView('summary')}><ChevronUp className="w-3.5 h-3.5" aria-hidden="true" /> Back to summary</SecondaryButton>
            <SecondaryButton onClick={onClose}><X className="w-3.5 h-3.5" aria-hidden="true" /> Close</SecondaryButton>
          </div>
        </div>
        <Notice tone="info">This report was saved on {formatDateTime(record.analyzedAt)} ({ENGINE_LABEL[report.engine] || report.engine}). The message text shown is a short excerpt — full email bodies are not stored.</Notice>
        <InvestigationReportView report={report} onScanAnother={() => setView('summary')} onOpenCoach={onOpenCoach} />
      </div>
    );
  }

  const t = report ? LEVEL_TOKENS[report.verdict.level] : null;
  const positive = report ? report.indicators.filter((i) => i.points > 0).sort((a, b) => b.points - a.points) : [];

  return (
    <Card className="space-y-4 animate-fadeIn" id="email-detail">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <ProviderChip provider={record.provider} />
            {record.isRead === false && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-800 dark:text-sky-300 border border-sky-500/30">Unread</span>}
            {record.hasAttachments && <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/30"><Paperclip className="w-3 h-3" aria-hidden="true" /> Attachment</span>}
            {record.urls.length > 0 && <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-800 dark:text-blue-300 border border-blue-500/30"><Link2 className="w-3 h-3" aria-hidden="true" /> {record.urls.length} link{record.urls.length === 1 ? '' : 's'}</span>}
          </div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white break-words">{record.subject || '(no subject)'}</h2>
          <div className="text-xs text-slate-600 dark:text-slate-400 break-all mt-0.5"><Mail className="w-3 h-3 inline mr-1" aria-hidden="true" />From: {record.senderName ? `${record.senderName} ` : ''}{record.senderEmail ? `<${record.senderEmail}>` : record.senderName ? '' : 'unknown sender'}</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Received {formatDateTime(record.receivedAt)}{record.internetMessageId ? <> · <span className="font-mono">ID {record.internetMessageId.slice(0, 40)}{record.internetMessageId.length > 40 ? '…' : ''}</span></> : null}</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer flex-shrink-0"><X className="w-4 h-4" aria-hidden="true" /></button>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {flash && <Notice tone="success">{flash}</Notice>}

      {/* Live analysis */}
      {analyzing && (
        <div className="space-y-2" aria-live="polite">
          <div className="flex items-center gap-2 text-sm font-semibold text-rose-700 dark:text-rose-300"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Analysing email…</div>
          <InvestigationTrace steps={trace} agentsRunCount={trace.filter((s) => s.status === 'completed').length} compact />
        </div>
      )}

      {/* Not analysed yet */}
      {!analyzing && !analyzed && (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-5 text-center space-y-3">
          <FileSearch className="w-8 h-8 mx-auto text-slate-400" aria-hidden="true" />
          <p className="text-sm text-slate-700 dark:text-slate-300">This email has not been analysed yet.</p>
          {record.analysisStatus === 'failed' && record.analysisError && <Notice tone="warn">Last attempt failed: {record.analysisError}</Notice>}
          {record.snippet && <p className="text-xs text-slate-500 dark:text-slate-400 italic">“{record.snippet}”</p>}
          <PrimaryButton id="btn-analyze-stored" onClick={() => run(false)}><Play className="w-4 h-4" aria-hidden="true" /> Analyze Email</PrimaryButton>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">The body is fetched from your mailbox for this analysis only; links are never opened and attachments are never downloaded.</p>
        </div>
      )}

      {/* Stored analysis summary */}
      {!analyzing && analyzed && report && t && (
        <div className="space-y-3">
          <section className={`rounded-xl border ${t.border} ${t.bg} p-4`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Risk level</div>
                <div className="mt-1"><RiskBadge level={report.verdict.level} /></div>
                <div className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Threat category</div>
                <div className="text-sm font-semibold text-slate-900 dark:text-white">{report.verdict.scamType}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Risk score</div>
                <div className={`text-3xl font-extrabold tabular-nums leading-none mt-1 ${t.text}`}>{report.verdict.riskScore}<span className="text-sm text-slate-400 font-bold"> /100</span></div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">{ENGINE_LABEL[report.engine] || report.engine}</div>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{report.verdict.summary}</p>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Confidence: {report.verdict.confidence}. {report.verdict.confidenceNote} Analysed {timeAgo(record.analyzedAt)}.</p>
            {report.notices.length > 0 && <p className="mt-2 text-[11px] text-amber-800 dark:text-amber-300">{report.notices[0]}</p>}
          </section>

          <div className="grid sm:grid-cols-2 gap-3">
            <section className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 mb-2 flex items-center gap-1.5"><AlertTriangle className={`w-3.5 h-3.5 ${t.text}`} aria-hidden="true" /> Detected signals</h3>
              {positive.length === 0 ? <p className="text-xs text-slate-500">No positive risk indicators.</p> : (
                <ul className="space-y-1">
                  {positive.slice(0, 8).map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2 text-xs text-slate-700 dark:text-slate-300" title={i.evidence}>
                      <span className="truncate">{i.label} <SourceTag source={i.source} className="ml-1" /></span>
                      <span className={`font-mono font-bold ${t.text}`}>+{i.points}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <ScamDnaPanel dna={report.scamDna} level={report.verdict.level} compact />
          </div>

          <section className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 mb-2 flex items-center gap-1.5"><Fingerprint className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" /> Evidence ({report.evidence.length})</h3>
            <ol className="space-y-1.5">
              {report.evidence.slice(0, 5).map((e, i) => (
                <li key={e.id} className="flex items-start gap-2 text-xs">
                  <span className="w-4 h-4 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5" aria-hidden="true">{i + 1}</span>
                  <span className="min-w-0"><span className="font-semibold text-slate-900 dark:text-white">{e.title}</span> <SourceTag source={e.source} /><br /><span className="text-slate-600 dark:text-slate-400">{e.description}</span></span>
                </li>
              ))}
            </ol>
            {report.evidence.length > 5 && <p className="text-[11px] text-slate-500 mt-2">+{report.evidence.length - 5} more in the full investigation.</p>}
          </section>

          <section className="rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-500/20 p-4">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-emerald-900 dark:text-emerald-200 mb-2 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" /> Recommended action <SourceTag source={report.protectionPlan.source} /></h3>
            <ul className="space-y-1.5 text-xs text-slate-800 dark:text-slate-200">
              {report.protectionPlan.immediateActions.slice(0, 3).map((a, i) => <li key={i} className="flex items-start gap-2"><CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-emerald-600 flex-shrink-0" aria-hidden="true" /> {a}</li>)}
              {report.protectionPlan.whatNotToDo.slice(0, 2).map((a, i) => <li key={`n${i}`} className="flex items-start gap-2"><OctagonAlert className="w-3.5 h-3.5 mt-0.5 text-rose-600 flex-shrink-0" aria-hidden="true" /> {a}</li>)}
            </ul>
            <p className="mt-2 text-[11px] text-slate-700 dark:text-slate-300"><strong>Verify:</strong> {report.protectionPlan.officialVerificationStep}</p>
          </section>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 flex-wrap pt-1 border-t border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2 flex-wrap pt-3">
          {analyzed && <PrimaryButton id="btn-view-investigation" onClick={() => setView('investigation')} className="px-4 py-2 text-xs"><FileSearch className="w-4 h-4" aria-hidden="true" /> View Investigation</PrimaryButton>}
          {analyzed && !analyzing && <SecondaryButton id="btn-reanalyze" onClick={() => run(true)}><RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Re-analyze</SecondaryButton>}
          {record.webLink && <a href={record.webLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"><ExternalLink className="w-3 h-3" aria-hidden="true" /> Open in {record.provider === 'outlook' ? 'Outlook' : 'Gmail'}</a>}
        </div>
        <div className="pt-3 flex items-center gap-2">
          <RiskStatus record={record} />
          <button type="button" onClick={remove} className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-rose-600 cursor-pointer" title="Delete from history"><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Delete</button>
        </div>
      </div>
    </Card>
  );
};

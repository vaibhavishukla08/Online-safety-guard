import React, { useState } from 'react';
import { ShieldCheck, CheckCircle2, XCircle, KeyRound, CreditCard, Megaphone, Archive, PhoneCall, Copy, Check, Share2 } from 'lucide-react';
import type { InvestigationReport } from '../../types';
import { Card, SectionTitle, SourceTag, BulletList } from '../ui/primitives';

const Section: React.FC<React.PropsWithChildren<{ icon: React.ElementType; title: string; tone: string; iconClass: string }>> = ({ icon: Icon, title, tone, iconClass, children }) => (
  <div className={`rounded-xl border p-4 space-y-2.5 ${tone}`}>
    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
      <Icon className={`w-4 h-4 ${iconClass}`} aria-hidden="true" />
      {title}
    </div>
    {children}
  </div>
);

export const ProtectionPlanPanel: React.FC<{ report: InvestigationReport }> = ({ report }) => {
  const p = report.protectionPlan;
  const [copied, setCopied] = useState(false);

  const copyResponse = () => {
    navigator.clipboard.writeText(report.recommendedResponse).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => undefined);
  };

  return (
    <Card>
      <SectionTitle icon={ShieldCheck} iconClass="text-emerald-600 dark:text-emerald-400" title="Personalized Protection Plan" subtitle="Generated from the specific evidence in this investigation." right={<SourceTag source={p.source} />} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section icon={CheckCircle2} title="Immediate actions" tone="bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-500/20" iconClass="text-emerald-600 dark:text-emerald-400">
          <BulletList items={p.immediateActions} marker="check" />
        </Section>
        <Section icon={XCircle} title="What NOT to do" tone="bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-500/20" iconClass="text-rose-600 dark:text-rose-400">
          <BulletList items={p.whatNotToDo} marker="cross" />
        </Section>
        <Section icon={KeyRound} title="Account protection" tone="bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800" iconClass="text-indigo-600 dark:text-indigo-400">
          <BulletList items={p.accountProtection} />
        </Section>
        <Section icon={CreditCard} title="Payment protection" tone="bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800" iconClass="text-amber-600 dark:text-amber-400">
          <BulletList items={p.paymentProtection} />
        </Section>
        <Section icon={Megaphone} title="Reporting" tone="bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800" iconClass="text-blue-600 dark:text-blue-400">
          <BulletList items={p.reporting} />
        </Section>
        <Section icon={Archive} title="Evidence preservation" tone="bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800" iconClass="text-slate-600 dark:text-slate-400">
          <BulletList items={p.evidencePreservation} />
        </Section>
      </div>

      <div className="mt-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0 mt-0.5">
          <PhoneCall className="w-4 h-4" aria-hidden="true" />
        </div>
        <div className="space-y-1 min-w-0">
          <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">Independent verification</h4>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{p.officialVerificationStep}</p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2"><Share2 className="w-4 h-4 text-slate-500" aria-hidden="true" /> Recommended response</h4>
          <button type="button" id="btn-copy-response" onClick={copyResponse} className="text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-mono text-xs text-slate-800 dark:text-slate-300 leading-relaxed">{report.recommendedResponse}</div>
      </div>
    </Card>
  );
};

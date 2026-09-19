import React, { useState } from 'react';
import { Siren, MousePointerClick, KeyRound, Smartphone, Banknote, Download, Reply, Loader2, AlertTriangle, CheckCircle2, XCircle, Cpu, Megaphone, Archive, CreditCard, ShieldCheck } from 'lucide-react';
import type { IncidentContext, IncidentPlan, InteractionAction } from '../../types';
import { requestIncidentPlan } from '../../api/client';
import { Card, SectionTitle, SourceTag, BulletList, PrimaryButton, Notice } from '../ui/primitives';

interface Props {
  context: IncidentContext;
  /** When true the panel renders as a standalone page section (larger heading). */
  standalone?: boolean;
}

const ACTIONS: Array<{ id: InteractionAction; label: string; icon: React.ElementType; hint: string }> = [
  { id: 'clicked_link', label: 'I clicked the link', icon: MousePointerClick, hint: 'Opened the page but did not enter anything' },
  { id: 'entered_password', label: 'I entered my password', icon: KeyRound, hint: 'Typed a password or login details on the page' },
  { id: 'shared_otp', label: 'I shared an OTP', icon: Smartphone, hint: 'Gave a one-time code to the sender or a caller' },
  { id: 'sent_money', label: 'I sent money', icon: Banknote, hint: 'Paid a fee, transferred funds, or approved a UPI request' },
  { id: 'downloaded_file', label: 'I downloaded a file', icon: Download, hint: 'Downloaded or installed an app/attachment' },
  { id: 'replied', label: 'I replied to the sender', icon: Reply, hint: 'Responded to the message or call' },
];

const URGENCY_TONE: Record<IncidentPlan['urgency'], string> = {
  low: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-500/40 text-emerald-900 dark:text-emerald-200',
  medium: 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-500/40 text-amber-900 dark:text-amber-200',
  high: 'bg-orange-50 dark:bg-orange-950/30 border-orange-300 dark:border-orange-500/40 text-orange-900 dark:text-orange-200',
  critical: 'bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-500/40 text-rose-900 dark:text-rose-200',
};

export const IncidentResponsePanel: React.FC<Props> = ({ context, standalone = false }) => {
  const [selected, setSelected] = useState<InteractionAction[]>([]);
  const [plan, setPlan] = useState<IncidentPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: InteractionAction) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setPlan(null);
  };

  const generate = async () => {
    if (!selected.length) return;
    setLoading(true);
    setError(null);
    const res = await requestIncidentPlan(selected, context);
    setLoading(false);
    if (res.ok) setPlan(res.data.plan);
    else setError(res.error.message);
  };

  return (
    <Card id="incident-response" className={standalone ? '' : 'border-amber-200 dark:border-amber-500/30'}>
      <SectionTitle
        icon={Siren}
        iconClass="text-amber-600 dark:text-amber-400"
        title="I Already Interacted With It"
        subtitle={context.claimedOrganization ? `Select what happened and get a response plan tailored to this ${context.scamType || 'incident'} involving ${context.claimedOrganization}.` : 'Select what happened and get a step-by-step incident response plan.'}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2" role="group" aria-label="What did you do?">
        {ACTIONS.map((a) => {
          const Icon = a.icon;
          const on = selected.includes(a.id);
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => toggle(a.id)}
              aria-pressed={on}
              className={`flex items-start gap-2.5 p-3 rounded-xl border text-left transition-all cursor-pointer min-h-[56px] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 ${on ? 'bg-amber-50 dark:bg-amber-500/15 border-amber-400 dark:border-amber-500/60 shadow-xs' : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'}`}
            >
              <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${on ? 'bg-amber-500 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`} aria-hidden="true">
                <Icon className="w-4 h-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-bold text-slate-900 dark:text-white">{a.label}</span>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">{a.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3">
        <span className="text-xs text-slate-600 dark:text-slate-400">{selected.length ? `${selected.length} action${selected.length === 1 ? '' : 's'} selected` : 'Select everything that applies.'}</span>
        <PrimaryButton id="btn-generate-incident-plan" onClick={generate} disabled={!selected.length || loading} className="w-full sm:w-auto">
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Building response plan…</> : <><Siren className="w-4 h-4" aria-hidden="true" /> Generate Incident Response Plan</>}
        </PrimaryButton>
      </div>

      {error && <Notice tone="error" className="mt-3">{error}</Notice>}

      {plan && (
        <div className="mt-5 space-y-4 animate-fadeIn" aria-live="polite">
          <div className={`p-4 rounded-xl border flex items-start gap-3 ${URGENCY_TONE[plan.urgency]}`}>
            <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-wider">Urgency: {plan.urgency}</span>
                <span className="inline-flex items-center gap-1 text-[10px] font-medium"><Cpu className="w-3 h-3" aria-hidden="true" /><SourceTag source={plan.source} /></span>
              </div>
              <p className="text-sm font-bold mt-1">{plan.headline}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PlanSection icon={CheckCircle2} iconClass="text-emerald-600 dark:text-emerald-400" title="Immediate actions" tone="bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-500/20"><BulletList items={plan.immediateActions} marker="check" /></PlanSection>
            <PlanSection icon={XCircle} iconClass="text-rose-600 dark:text-rose-400" title="What NOT to do" tone="bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-500/20"><BulletList items={plan.whatNotToDo} marker="cross" /></PlanSection>
            {plan.accountProtection.length > 0 && <PlanSection icon={KeyRound} iconClass="text-indigo-600 dark:text-indigo-400" title="Account protection"><BulletList items={plan.accountProtection} /></PlanSection>}
            {plan.paymentProtection.length > 0 && <PlanSection icon={CreditCard} iconClass="text-amber-600 dark:text-amber-400" title="Payment protection"><BulletList items={plan.paymentProtection} /></PlanSection>}
            {plan.deviceProtection.length > 0 && <PlanSection icon={ShieldCheck} iconClass="text-sky-600 dark:text-sky-400" title="Device protection"><BulletList items={plan.deviceProtection} /></PlanSection>}
            <PlanSection icon={Megaphone} iconClass="text-blue-600 dark:text-blue-400" title="Reporting"><BulletList items={plan.reporting} /></PlanSection>
            <PlanSection icon={Archive} iconClass="text-slate-600 dark:text-slate-400" title="Evidence preservation"><BulletList items={plan.evidencePreservation} /></PlanSection>
          </div>
        </div>
      )}
    </Card>
  );
};

const PlanSection: React.FC<React.PropsWithChildren<{ icon: React.ElementType; iconClass: string; title: string; tone?: string }>> = ({ icon: Icon, iconClass, title, tone = 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800', children }) => (
  <div className={`rounded-xl border p-4 space-y-2.5 ${tone}`}>
    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
      <Icon className={`w-4 h-4 ${iconClass}`} aria-hidden="true" /> {title}
    </div>
    {children}
  </div>
);

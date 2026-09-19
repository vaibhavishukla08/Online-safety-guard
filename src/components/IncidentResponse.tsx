import React from 'react';
import { Siren } from 'lucide-react';
import type { AnalysisResult } from '../types';
import { IncidentResponsePanel } from './investigation/IncidentResponsePanel';
import { EmergencyGuide } from './EmergencyGuide';

interface Props {
  /** Most recent investigation — used to tailor the plan if present. */
  latest: AnalysisResult | null;
}

/**
 * Incident Response page: the interactive "I Already Interacted" planner on top,
 * the original static Emergency Guide underneath as an always-available reference.
 */
export const IncidentResponse: React.FC<Props> = ({ latest }) => {
  const inv = latest?.investigation;
  const context = inv
    ? {
        scamType: inv.verdict.scamType,
        claimedOrganization: inv.identity?.claimedOrganization ?? null,
        organizationCategory: inv.identity?.organizationCategory ?? null,
        level: inv.verdict.level,
        paymentMethods: inv.financial?.paymentMethods || [],
        platform: inv.input.platform,
        urls: inv.urls.map((u) => u.hostname),
      }
    : {};

  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-fadeIn">
      <div className="text-center max-w-2xl mx-auto space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-800 dark:text-amber-300 text-xs font-semibold">
          <Siren className="w-3.5 h-3.5" aria-hidden="true" /> Incident Response
        </div>
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Already clicked, paid or shared something?</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {inv ? `The plan will be tailored to your latest investigation (${inv.verdict.scamType}${inv.identity?.claimedOrganization ? `, ${inv.identity.claimedOrganization}` : ''}).` : 'Tell us what happened and get a prioritised, step-by-step containment plan.'}
        </p>
      </div>

      <IncidentResponsePanel context={context} standalone />

      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">General reference</h3>
        <EmergencyGuide />
      </div>
    </div>
  );
};

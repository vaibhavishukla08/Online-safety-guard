import React, { useState } from 'react';
import { Radar, Search } from 'lucide-react';
import type { EmailProviderId, EmailRecord } from '../types';
import { EmailList } from '../components/mail/EmailList';
import { EmailDetail } from '../components/mail/EmailDetail';
import { RequireAuth } from '../components/mail/shared';
import { SecondaryButton } from '../components/ui/primitives';

interface Props {
  onNavigate: (to: string, opts?: { replace?: boolean }) => void;
  onOpenCoach: () => void;
  onOpenLocalHistory: () => void;
}

export const ThreatsPage: React.FC<Props> = ({ onNavigate, onOpenCoach, onOpenLocalHistory }) => {
  const [provider, setProvider] = useState<EmailProviderId | 'all'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <RequireAuth onNavigate={onNavigate} feature="the threat overview">
      <div className="space-y-5 animate-fadeIn">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white flex items-center gap-2"><Radar className="w-7 h-7 text-amber-600" aria-hidden="true" /> Threats</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Every email analysed for your account across Outlook and Gmail, highest risk first. Use the filters to narrow down to critical or high-risk detections.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-xs font-semibold" role="group" aria-label="Provider">
              {(['all', 'outlook', 'gmail'] as const).map((p) => (
                <button key={p} type="button" onClick={() => { setProvider(p); setSelected(null); }} aria-pressed={provider === p} className={`px-3 py-1.5 capitalize cursor-pointer ${provider === p ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>{p}</button>
              ))}
            </div>
            <SecondaryButton onClick={onOpenLocalHistory}><Search className="w-3.5 h-3.5" aria-hidden="true" /> Manual scans</SecondaryButton>
          </div>
        </div>
        <div className={`grid gap-5 ${selected ? 'lg:grid-cols-5' : ''}`}>
          <div className={selected ? 'lg:col-span-2' : ''}>
            <EmailList provider={provider} selectedId={selected} onSelect={(r: EmailRecord) => setSelected(r.id)} refreshKey={refreshKey} defaultSort="risk" emptyTitle="No analysed emails yet" emptyBody="Connect a mailbox and sync, or analyse emails from the Outlook add-in — results appear here ranked by risk." />
          </div>
          {selected && (
            <div className="lg:col-span-3">
              <EmailDetail recordId={selected} onClose={() => setSelected(null)} onChanged={() => setRefreshKey((k) => k + 1)} onOpenCoach={onOpenCoach} />
            </div>
          )}
        </div>
      </div>
    </RequireAuth>
  );
};

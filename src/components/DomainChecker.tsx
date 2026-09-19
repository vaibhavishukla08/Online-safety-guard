import React, { useState } from 'react';
import { DomainInspectionResult } from '../types';
import { Globe, ShieldAlert, AlertTriangle, Loader2, Search, Workflow } from 'lucide-react';

interface DomainCheckerProps {
  /** Hand the URL to the full agentic investigation (URL → Identity → Threat Intel …). */
  onFullInvestigation?: (url: string) => void;
}

export const DomainChecker: React.FC<DomainCheckerProps> = ({ onFullInvestigation }) => {
  const [urlInput, setUrlInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<DomainInspectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sampleUrls = [
    'https://usps-post-redelivery.top/tracking',
    'https://chase-security-restore.cc/auth',
    'https://meta-appeal-form-verify.xyz',
    'https://www.paypal.com',
  ];

  const handleInspect = async (urlToTest?: string) => {
    const target = (urlToTest || urlInput).trim();
    if (!target) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/inspect-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target }),
      });

      if (!res.ok) {
        throw new Error('Inspection service error');
      }

      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Failed to inspect domain');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Intro info banner */}
      <div className="bg-white/85 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-3 backdrop-blur-sm shadow-xs transition-colors">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Quick Link & Domain Inspector</h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Fast single-shot check for brand spoofing and typosquatting. For external threat intelligence and a full evidence trail, run the agentic investigation.
            </p>
          </div>
        </div>

        {/* Input box */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleInspect();
          }}
          className="pt-2 flex flex-col sm:flex-row items-center gap-2"
        >
          <div className="relative flex-1 w-full">
            <input
              id="domain-input"
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Paste suspicious URL or domain (e.g. usps-track-fee.top, chase-login-restore.cc)"
              className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-950/90 border border-slate-300 dark:border-slate-800 text-slate-900 dark:text-slate-100 text-sm placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-rose-500/40 font-mono transition-colors"
            />
          </div>

          <button
            type="submit"
            id="btn-inspect-domain"
            disabled={isLoading || !urlInput.trim()}
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Inspect Link
          </button>
        </form>

        {/* Quick Sample Links */}
        <div className="flex items-center gap-2 flex-wrap pt-1 text-xs">
          <span className="text-slate-500">Try sample:</span>
          {sampleUrls.map((sUrl, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setUrlInput(sUrl);
                handleInspect(sUrl);
              }}
              className="font-mono text-[11px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-950 px-2 py-1 rounded border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-colors cursor-pointer"
            >
              {sUrl.replace('https://', '').split('/')[0]}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-600/50 text-rose-800 dark:text-rose-200 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Result Card */}
      {result && (
        <div className="bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4 shadow-md dark:shadow-xl animate-fadeIn backdrop-blur-sm transition-colors">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400 uppercase font-semibold">Analyzed Domain</span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                    result.threatLevel === 'HIGH'
                      ? 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300 border border-rose-300 dark:border-rose-500/40'
                      : result.threatLevel === 'MEDIUM'
                      ? 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-300 border border-amber-300 dark:border-amber-500/40'
                      : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/40'
                  }`}
                >
                  {result.threatLevel} Threat
                </span>
              </div>
              <p className="text-lg font-mono font-bold text-slate-900 dark:text-white pt-1">{result.domain}</p>
            </div>

            <div className="text-right">
              <span className="text-xs text-slate-500 dark:text-slate-400 block">Status Verdict</span>
              <span className={`text-sm font-bold ${result.isSuspicious ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {result.isSuspicious ? 'Deceptive / Do Not Open' : 'Likely Authentic Domain'}
              </span>
            </div>
          </div>

          {/* Spoofed brand comparison */}
          {result.spoofedBrand && (
            <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-600/40 space-y-2">
              <div className="flex items-center gap-2 text-rose-800 dark:text-rose-300 text-xs font-bold uppercase tracking-wider">
                <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                Impersonation Alert: Spoofing {result.spoofedBrand}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
                <div className="p-2.5 rounded-lg bg-white dark:bg-slate-950/80 border border-rose-200 dark:border-rose-500/30 font-mono shadow-2xs">
                  <span className="text-rose-600 dark:text-rose-400 font-bold block mb-0.5">Fake / Scam Link:</span>
                  <span className="text-slate-800 dark:text-slate-300 break-all">{result.domain}</span>
                </div>
                <div className="p-2.5 rounded-lg bg-white dark:bg-slate-950/80 border border-emerald-200 dark:border-emerald-500/30 font-mono shadow-2xs">
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold block mb-0.5">Real Official Site:</span>
                  <span className="text-slate-800 dark:text-slate-300 break-all">{result.officialDomain || 'Official verified domain'}</span>
                </div>
              </div>
            </div>
          )}

          {/* Detailed Reason */}
          <div className="space-y-1.5">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-300 uppercase tracking-wider">Analysis Findings</h4>
            <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed bg-slate-50 dark:bg-slate-950/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
              {result.reason}
            </p>
          </div>

          {/* Escalate to the full agentic pipeline */}
          {onFullInvestigation && (
            <button
              type="button"
              id="btn-full-investigation"
              onClick={() => onFullInvestigation(result.fullUrl || result.domain)}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 transition-colors cursor-pointer"
            >
              <Workflow className="w-4 h-4" aria-hidden="true" />
              Run full agentic investigation (URL → Identity → Threat Intel)
            </button>
          )}

          {/* Safety rules for links */}
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 space-y-1">
            <span className="text-slate-900 dark:text-slate-200 font-semibold block">Safety Guard Rule:</span>
            Never log in or type credentials into a page opened from an unverified text message or email link. Always open a fresh browser tab and manually search or type the official organization address.
          </div>
        </div>
      )}
    </div>
  );
};

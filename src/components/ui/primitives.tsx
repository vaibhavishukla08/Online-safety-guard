import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Info } from 'lucide-react';
import type { EvidenceSource, RiskLevel } from '../../types';
import { LEVEL_TOKENS, SOURCE_TOKENS } from '../../utils/risk';

/** Standard surface used by every panel — matches the existing card language. */
export const Card: React.FC<React.PropsWithChildren<{ className?: string; id?: string }>> = ({ className = '', id, children }) => (
  <section id={id} className={`bg-white/85 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 backdrop-blur-sm shadow-xs transition-colors ${className}`}>
    {children}
  </section>
);

export const SectionTitle: React.FC<{ icon: LucideIcon; title: string; subtitle?: string; iconClass?: string; right?: React.ReactNode }> = ({ icon: Icon, title, subtitle, iconClass = 'text-rose-600 dark:text-rose-400', right }) => (
  <div className="flex items-start justify-between gap-3 mb-4">
    <div className="flex items-start gap-2.5">
      <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${iconClass}`} aria-hidden="true" />
      <div>
        <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">{title}</h3>
        {subtitle && <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
    {right && <div className="flex-shrink-0">{right}</div>}
  </div>
);

export const RiskBadge: React.FC<{ level: RiskLevel; className?: string; size?: 'sm' | 'md' }> = ({ level, className = '', size = 'md' }) => {
  const t = LEVEL_TOKENS[level];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-bold uppercase tracking-wider ${t.bg} ${t.text} ${t.border} ${size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${t.solid}`} aria-hidden="true" />
      {level}
    </span>
  );
};

export const SourceTag: React.FC<{ source: EvidenceSource; className?: string }> = ({ source, className = '' }) => {
  const t = SOURCE_TOKENS[source];
  return (
    <span title={t.description} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${t.className} ${className}`}>
      {t.label}
    </span>
  );
};

export const Pill: React.FC<React.PropsWithChildren<{ className?: string; title?: string }>> = ({ className = '', title, children }) => (
  <span title={title} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${className}`}>{children}</span>
);

export const Notice: React.FC<React.PropsWithChildren<{ tone?: 'info' | 'warn' | 'error' | 'success'; className?: string }>> = ({ tone = 'info', className = '', children }) => {
  const tones = {
    info: 'bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-500/10 dark:border-blue-500/30 dark:text-blue-200',
    warn: 'bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-950/30 dark:border-amber-600/40 dark:text-amber-200',
    error: 'bg-rose-50 border-rose-300 text-rose-900 dark:bg-rose-950/40 dark:border-rose-600/50 dark:text-rose-200',
    success: 'bg-emerald-50 border-emerald-300 text-emerald-900 dark:bg-emerald-950/30 dark:border-emerald-600/40 dark:text-emerald-200',
  };
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs leading-relaxed ${tones[tone]} ${className}`}>
      <Info className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
};

export const Meter: React.FC<{ value: number; max?: number; className?: string; barClass?: string; label?: string }> = ({ value, max = 10, className = '', barClass = 'bg-rose-500', label }) => {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden ${className}`} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <div className={`h-full rounded-full transition-[width] duration-500 ${barClass}`} style={{ width: `${pct}%` }} />
    </div>
  );
};

export const EmptyState: React.FC<{ icon: LucideIcon; title: string; body: string; action?: React.ReactNode }> = ({ icon: Icon, title, body, action }) => (
  <div className="max-w-md mx-auto py-12 text-center space-y-3">
    <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 mx-auto flex items-center justify-center">
      <Icon className="w-7 h-7" aria-hidden="true" />
    </div>
    <h3 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h3>
    <p className="text-xs text-slate-600 dark:text-slate-400">{body}</p>
    {action}
  </div>
);

export const PrimaryButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className = '', children, ...props }) => (
  <button
    {...props}
    className={`inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-rose-600 via-rose-500 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-bold text-sm shadow-md shadow-rose-600/20 dark:shadow-rose-950/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/60 ${className}`}
  >
    {children}
  </button>
);

export const SecondaryButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className = '', children, ...props }) => (
  <button
    {...props}
    className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/60 ${className}`}
  >
    {children}
  </button>
);

export const BulletList: React.FC<{ items: string[]; marker?: 'check' | 'cross' | 'dot'; className?: string }> = ({ items, marker = 'dot', className = '' }) => (
  <ul className={`space-y-2 text-xs text-slate-700 dark:text-slate-300 ${className}`}>
    {items.map((item, i) => (
      <li key={i} className="flex items-start gap-2">
        <span className={`font-bold mt-0.5 flex-shrink-0 ${marker === 'cross' ? 'text-rose-600 dark:text-rose-400' : marker === 'check' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`} aria-hidden="true">
          {marker === 'cross' ? '✕' : marker === 'check' ? '✓' : '•'}
        </span>
        <span>{item}</span>
      </li>
    ))}
  </ul>
);

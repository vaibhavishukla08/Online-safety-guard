import React from 'react';
import {
  ShieldAlert,
  History,
  Globe,
  GraduationCap,
  Siren,
  Sun,
  Moon,
  Layers,
  Home,
  Search,
  LayoutDashboard,
  Cpu,
  type LucideIcon,
} from 'lucide-react';
import type { AppTab } from '../types';

interface HeaderProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  historyCount: number;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  watermarkIntensity?: 'subtle' | 'balanced' | 'vivid';
  onCycleWatermark?: () => void;
  /** null = unknown (health check pending) */
  aiConfigured: boolean | null;
}

const NAV: Array<{ id: AppTab; label: string; icon: LucideIcon; active: string; iconClass?: string }> = [
  { id: 'home', label: 'Home', icon: Home, active: 'bg-slate-200 text-slate-900 border-slate-300 dark:bg-slate-800 dark:text-white dark:border-slate-700' },
  { id: 'investigate', label: 'Investigate', icon: Search, active: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30' },
  { id: 'domain', label: 'Links', icon: Globe, active: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30' },
  { id: 'incident', label: 'Incident', icon: Siren, active: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30', iconClass: 'text-amber-600 dark:text-amber-400' },
  { id: 'coach', label: 'Coach', icon: GraduationCap, active: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30' },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, active: 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-300 border-cyan-500/30' },
  { id: 'history', label: 'History', icon: History, active: 'bg-slate-200 text-slate-900 border-slate-300 dark:bg-slate-800 dark:text-white dark:border-slate-700' },
];

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onSelectTab,
  historyCount,
  theme,
  onToggleTheme,
  watermarkIntensity,
  onCycleWatermark,
  aiConfigured,
}) => {
  const status = aiConfigured === null
    ? { dot: 'bg-slate-400', text: 'Checking…', short: '…', cls: 'bg-slate-500/10 border-slate-500/20 text-slate-600 dark:text-slate-300' }
    : aiConfigured
      ? { dot: 'bg-emerald-500 animate-pulse', text: 'Gemini + rules', short: 'AI on', cls: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400' }
      : { dot: 'bg-amber-500', text: 'Rules-only mode', short: 'Rules only', cls: 'bg-amber-500/10 border-amber-500/20 text-amber-800 dark:text-amber-300' };

  return (
    <header className="border-b border-slate-200/90 dark:border-slate-800/90 bg-white/85 dark:bg-slate-900/90 backdrop-blur-md sticky top-0 z-30 transition-colors duration-200 shadow-xs">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3">
        <div className="flex flex-col xl:flex-row items-center justify-between gap-3">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3 w-full xl:w-auto justify-between xl:justify-start">
            <button
              type="button"
              onClick={() => onSelectTab('home')}
              className="flex items-center gap-3 cursor-pointer group text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/60 rounded-lg"
              title="Return to Home"
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-rose-600 via-rose-500 to-amber-500 flex items-center justify-center shadow-md shadow-rose-600/20 dark:shadow-rose-950/40 text-white group-hover:scale-105 transition-transform duration-200">
                <ShieldAlert className="w-5 h-5 text-white" aria-hidden="true" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">
                    Online Safety Guard
                  </h1>
                  <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/25 hidden sm:inline">
                    Agentic AI
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Cyber defense assistant — investigate, verify, protect</p>
              </div>
            </button>

            {/* Mobile controls */}
            <div className="xl:hidden flex items-center gap-2">
              <button type="button" onClick={onToggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer min-w-[40px] min-h-[40px] flex items-center justify-center">
                {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
              </button>
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] font-medium whitespace-nowrap ${status.cls}`} title={`AI engine status: ${status.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} aria-hidden="true" />
                <span>{status.short}</span>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex items-center gap-1.5 w-full xl:w-auto overflow-x-auto pb-1 xl:pb-0 scrollbar-none" aria-label="Primary">
            {NAV.map((item) => {
              const Icon = item.icon;
              const on = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  id={`nav-${item.id}-btn`}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  aria-current={on ? 'page' : undefined}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer border min-h-[36px] focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/60 ${
                    on ? `${item.active} shadow-xs` : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60 border-transparent'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${item.iconClass || ''}`} aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.id === 'history' && historyCount > 0 && (
                    <span className="min-w-4 h-4 px-1 rounded-full bg-slate-300 text-slate-800 dark:bg-slate-700 dark:text-slate-200 text-[10px] flex items-center justify-center font-bold">{historyCount}</span>
                  )}
                </button>
              );
            })}

            {/* Watermark chip (light mode only) */}
            {theme === 'light' && onCycleWatermark && (
              <button
                type="button"
                id="btn-watermark-intensity"
                onClick={onCycleWatermark}
                title="Cycle watermark visibility: Subtle → Balanced → Vivid"
                className="hidden 2xl:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-blue-200 bg-blue-50/90 text-blue-800 hover:bg-blue-100 transition-all cursor-pointer shadow-2xs"
              >
                <Layers className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                <span>Watermark: <strong className="capitalize">{watermarkIntensity || 'balanced'}</strong></span>
              </button>
            )}

            {/* Desktop status + theme */}
            <div className="hidden xl:flex items-center ml-1 border-l border-slate-200 dark:border-slate-800 pl-2 gap-2">
              <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded-full border text-[11px] font-medium ${status.cls}`} title="AI engine status">
                <Cpu className="w-3 h-3" aria-hidden="true" />
                <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} aria-hidden="true" />
                <span>{status.text}</span>
              </div>
              <button
                id="theme-toggle-btn"
                type="button"
                onClick={onToggleTheme}
                aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border border-slate-200 dark:border-slate-700 bg-slate-100/90 hover:bg-slate-200/90 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 cursor-pointer shadow-xs"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" aria-hidden="true" /> : <Moon className="w-4 h-4 text-slate-700" aria-hidden="true" />}
                <span className="hidden 2xl:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
              </button>
            </div>
          </nav>
        </div>
      </div>
    </header>
  );
};

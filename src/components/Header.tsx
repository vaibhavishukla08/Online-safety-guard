import React, { useEffect, useRef, useState } from 'react';
import {
  ShieldAlert,
  History,
  Globe,
  GraduationCap,
  Siren,
  Sun,
  Moon,
  Layers,
  Search,
  LayoutDashboard,
  Cpu,
  Mail,
  Inbox,
  Bell,
  Settings,
  ShieldCheck,
  Wrench,
  ChevronDown,
  LogIn,
  LogOut,
  Radar,
  type LucideIcon,
} from 'lucide-react';
import type { AppTab, PublicUser } from '../types';
import type { Page } from '../router';

interface HeaderProps {
  page: Page;
  onNavigate: (to: string) => void;
  onSelectTab: (tab: AppTab) => void;
  historyCount: number;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  watermarkIntensity?: 'subtle' | 'balanced' | 'vivid';
  onCycleWatermark?: () => void;
  /** null = unknown (health check pending) */
  aiConfigured: boolean | null;
  user: PublicUser | null;
  authStatus: 'loading' | 'anonymous' | 'authenticated';
  unreadNotifications: number;
  onLogout: () => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  to: string;
  active: string;
  iconClass?: string;
  isActive: (page: Page) => boolean;
  requires?: 'user' | 'admin';
}

const PRIMARY: NavItem[] = [
  { id: 'home', label: 'Dashboard', icon: LayoutDashboard, to: '/#home', active: 'bg-slate-200 text-slate-900 border-slate-300 dark:bg-slate-800 dark:text-white dark:border-slate-700', isActive: (p) => p.kind === 'tabs' && p.tab === 'home' },
  { id: 'investigate', label: 'Investigate', icon: Search, to: '/#investigate', active: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30', isActive: (p) => p.kind === 'tabs' && p.tab === 'investigate' },
  { id: 'outlook', label: 'Outlook', icon: Mail, to: '/dashboard/outlook', active: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30', isActive: (p) => p.kind === 'mailbox' && p.provider === 'outlook' },
  { id: 'gmail', label: 'Gmail', icon: Inbox, to: '/dashboard/gmail', active: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30', isActive: (p) => p.kind === 'mailbox' && p.provider === 'gmail' },
  { id: 'threats', label: 'Threats', icon: Radar, to: '/threats', active: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30', isActive: (p) => p.kind === 'threats' },
  { id: 'notifications', label: 'Notifications', icon: Bell, to: '/notifications', active: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30', isActive: (p) => p.kind === 'notifications' },
  { id: 'settings', label: 'Settings', icon: Settings, to: '/settings', active: 'bg-slate-200 text-slate-900 border-slate-300 dark:bg-slate-800 dark:text-white dark:border-slate-700', isActive: (p) => p.kind === 'settings' },
  { id: 'admin', label: 'Admin', icon: ShieldCheck, to: '/admin', active: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30', isActive: (p) => p.kind === 'admin', requires: 'admin' },
];

const TOOLS: Array<{ id: AppTab; label: string; icon: LucideIcon; iconClass?: string; hint: string }> = [
  { id: 'domain', label: 'Link Inspector', icon: Globe, iconClass: 'text-blue-600 dark:text-blue-400', hint: 'Quick URL / domain check' },
  { id: 'incident', label: 'Incident Response', icon: Siren, iconClass: 'text-amber-600 dark:text-amber-400', hint: '"I already interacted" plan' },
  { id: 'coach', label: 'Safety Coach', icon: GraduationCap, iconClass: 'text-purple-600 dark:text-purple-400', hint: 'Adaptive training scenarios' },
  { id: 'dashboard', label: 'Safety Stats', icon: Cpu, iconClass: 'text-cyan-700 dark:text-cyan-400', hint: 'On-device pattern memory & KPIs' },
  { id: 'history', label: 'Scan History', icon: History, hint: 'Investigations run in this browser' },
];

export const Header: React.FC<HeaderProps> = ({ page, onNavigate, onSelectTab, historyCount, theme, onToggleTheme, watermarkIntensity, onCycleWatermark, aiConfigured, user, authStatus, unreadNotifications, onLogout }) => {
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!toolsOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) setToolsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setToolsOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [toolsOpen]);

  const status = aiConfigured === null
    ? { dot: 'bg-slate-400', text: 'Checking…', short: '…', cls: 'bg-slate-500/10 border-slate-500/20 text-slate-600 dark:text-slate-300' }
    : aiConfigured
      ? { dot: 'bg-emerald-500 animate-pulse', text: 'Gemini + rules', short: 'AI on', cls: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400' }
      : { dot: 'bg-amber-500', text: 'Rules-only mode', short: 'Rules only', cls: 'bg-amber-500/10 border-amber-500/20 text-amber-800 dark:text-amber-300' };

  const toolActive = page.kind === 'tabs' && TOOLS.some((t) => t.id === page.tab);
  const visible = PRIMARY.filter((item) => !item.requires || (item.requires === 'admin' && user?.role === 'ADMIN') || (item.requires === 'user' && user));

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
              title="Return to Dashboard"
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
            {visible.map((item) => {
              const Icon = item.icon;
              const on = item.isActive(page);
              return (
                <button
                  key={item.id}
                  id={`nav-${item.id}-btn`}
                  type="button"
                  onClick={() => (item.to.startsWith('/#') ? onSelectTab(item.to.slice(2) as AppTab) : onNavigate(item.to))}
                  aria-current={on ? 'page' : undefined}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer border min-h-[36px] focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/60 ${
                    on ? `${item.active} shadow-xs` : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60 border-transparent'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${item.iconClass || ''}`} aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.id === 'notifications' && unreadNotifications > 0 && (
                    <span className="min-w-4 h-4 px-1 rounded-full bg-rose-600 text-white text-[10px] flex items-center justify-center font-bold" aria-label={`${unreadNotifications} unread`}>{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>
                  )}
                </button>
              );
            })}

            {/* Tools menu: the original tabs stay one click away */}
            <div className="relative" ref={toolsRef}>
              <button
                type="button"
                id="nav-tools-btn"
                onClick={() => setToolsOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={toolsOpen}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer border min-h-[36px] focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/60 ${
                  toolActive ? 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-300 border-cyan-500/30 shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60 border-transparent'
                }`}
              >
                <Wrench className="w-4 h-4" aria-hidden="true" />
                <span>Tools</span>
                {historyCount > 0 && <span className="min-w-4 h-4 px-1 rounded-full bg-slate-300 text-slate-800 dark:bg-slate-700 dark:text-slate-200 text-[10px] flex items-center justify-center font-bold">{historyCount}</span>}
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${toolsOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
              {toolsOpen && (
                <div role="menu" className="absolute right-0 xl:left-0 mt-1 w-64 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg p-1.5 z-40 animate-fadeIn">
                  {TOOLS.map((t) => {
                    const Icon = t.icon;
                    const on = page.kind === 'tabs' && page.tab === t.id;
                    return (
                      <button
                        key={t.id}
                        role="menuitem"
                        id={`nav-${t.id}-btn`}
                        type="button"
                        onClick={() => {
                          setToolsOpen(false);
                          onSelectTab(t.id);
                        }}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-xs transition-colors cursor-pointer ${on ? 'bg-slate-100 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'}`}
                      >
                        <Icon className={`w-4 h-4 flex-shrink-0 ${t.iconClass || 'text-slate-500'}`} aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="font-semibold text-slate-900 dark:text-white block">{t.label}{t.id === 'history' && historyCount > 0 ? ` (${historyCount})` : ''}</span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 block">{t.hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

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

            {/* Desktop status + theme + account */}
            <div className="flex items-center ml-1 border-l border-slate-200 dark:border-slate-800 pl-2 gap-2">
              <div className={`hidden xl:flex items-center gap-1.5 px-2 py-1.5 rounded-full border text-[11px] font-medium ${status.cls}`} title="AI engine status">
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
                className="hidden xl:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border border-slate-200 dark:border-slate-700 bg-slate-100/90 hover:bg-slate-200/90 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 cursor-pointer shadow-xs"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" aria-hidden="true" /> : <Moon className="w-4 h-4 text-slate-700" aria-hidden="true" />}
              </button>
              {authStatus === 'authenticated' && user ? (
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => onNavigate('/settings')} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 max-w-[160px]" title={user.email}>
                    <span className="w-5 h-5 rounded-full bg-gradient-to-tr from-rose-500 to-amber-500 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0" aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span>
                    <span className="truncate">{user.name}</span>
                    {user.role === 'ADMIN' && <span className="text-[9px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300 font-bold">admin</span>}
                  </button>
                  <button id="btn-logout" type="button" onClick={onLogout} title="Sign out" aria-label="Sign out" className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-rose-600 cursor-pointer">
                    <LogOut className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <button id="btn-signin" type="button" onClick={() => onNavigate('/login')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 cursor-pointer transition-colors whitespace-nowrap">
                  <LogIn className="w-4 h-4" aria-hidden="true" /> Sign in
                </button>
              )}
            </div>
          </nav>
        </div>
      </div>
    </header>
  );
};

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Header } from './components/Header';
import { HomeDashboard } from './components/HomeDashboard';
import { InvestigationConsole } from './components/InvestigationConsole';
import { InvestigationReportView } from './components/investigation/InvestigationReportView';
import { AnalysisReport } from './components/AnalysisReport';
import { DomainChecker } from './components/DomainChecker';
import { IncidentResponse } from './components/IncidentResponse';
import { SafetyCoach } from './components/SafetyCoach';
import { SafetyDashboard } from './components/SafetyDashboard';
import { ScanHistoryView } from './components/ScanHistoryView';
import { NotificationCard } from './components/NotificationCard';
import { AuthPage } from './pages/AuthPage';
import { MailboxPage } from './pages/MailboxPage';
import { ThreatsPage } from './pages/ThreatsPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { SettingsPage } from './pages/SettingsPage';
import { AdminPage } from './pages/AdminPage';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { useRouter } from './router';
import { reportToAnalysisResult, type AnalysisResult, type AppTab, type InvestigationReport, type InvestigationSeed } from './types';
import { getScanHistory, saveScanToHistory, clearScanHistory } from './utils/storage';
import { getPatternRecords, matchAgainstMemory, savePatternRecord, toPatternRecord } from './utils/patternMemory';
import { getHealth } from './api/client';
import { Lock, Download, Bell, ArrowRight, Mail, Inbox } from 'lucide-react';
import { Card, EmptyState, SecondaryButton } from './components/ui/primitives';

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}

function AppShell() {
  const router = useRouter();
  const { page, navigate, setTab, search } = router;
  const { user, status: authStatus, unread, notifications, markRead, dismiss, logout } = useAuth();
  const [currentAnalysis, setCurrentAnalysis] = useState<AnalysisResult | null>(null);
  const [memoryMatch, setMemoryMatch] = useState<{ similar: number; sharedLabel: string | null } | undefined>(undefined);
  const [seed, setSeed] = useState<InvestigationSeed | null>(null);
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);

  // Theme state: default to 'light' to immediately showcase the requested watermark image
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('online_guard_theme');
      if (saved === 'dark' || saved === 'light') return saved;
      return 'light';
    }
    return 'light';
  });

  // Watermark intensity state for light mode: 'subtle' (15%), 'balanced' (28%), 'vivid' (45%)
  const [watermarkIntensity, setWatermarkIntensity] = useState<'subtle' | 'balanced' | 'vivid'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('watermark_intensity');
      if (saved === 'subtle' || saved === 'balanced' || saved === 'vivid') return saved;
    }
    return 'balanced';
  });

  // Keep <html> element in sync with dark mode
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('online_guard_theme', theme);
  }, [theme]);

  useEffect(() => {
    setHistory(getScanHistory());
    getHealth().then((h) => setAiConfigured(h ? h.hasGeminiKey : false));
  }, []);

  const activeTab: AppTab = page.kind === 'tabs' ? page.tab : 'home';

  /** Deep-linkable tabs via the URL hash (#investigate, #coach, …) — unchanged behaviour. */
  const setActiveTab = useCallback((tab: AppTab) => setTab(tab), [setTab]);

  const toggleTheme = () => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));

  const cycleWatermarkIntensity = () => {
    const next = watermarkIntensity === 'subtle' ? 'balanced' : watermarkIntensity === 'balanced' ? 'vivid' : 'subtle';
    setWatermarkIntensity(next);
    localStorage.setItem('watermark_intensity', next);
  };

  const watermarkOpacityValue = { subtle: 0.16, balanced: 0.28, vivid: 0.42 }[watermarkIntensity];

  /** A new agentic investigation finished: persist (history + anonymized pattern memory) and show it. */
  const handleInvestigationComplete = useCallback((report: InvestigationReport) => {
    const match = matchAgainstMemory(report, getPatternRecords());
    savePatternRecord(toPatternRecord(report));
    const result = reportToAnalysisResult(report);
    saveScanToHistory(result);
    setHistory(getScanHistory());
    setMemoryMatch(match);
    setCurrentAnalysis(result);
    setActiveTab('investigate');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [setActiveTab]);

  const startInvestigation = useCallback((s: InvestigationSeed) => {
    setCurrentAnalysis(null);
    setMemoryMatch(undefined);
    setSeed(s);
    setActiveTab('investigate');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [setActiveTab]);

  const handleClearHistory = () => {
    clearScanHistory();
    setHistory([]);
  };

  const handleSelectFromHistory = (scan: AnalysisResult) => {
    setCurrentAnalysis(scan);
    setMemoryMatch(scan.investigation ? matchAgainstMemory(scan.investigation, getPatternRecords()) : undefined);
    setActiveTab('investigate');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const latestInvestigation = useMemo(() => currentAnalysis?.investigation ? currentAnalysis : history.find((h) => h.investigation) || null, [currentAnalysis, history]);
  const openCoach = () => setActiveTab('coach');
  const unreadItems = notifications.filter((n) => n.status === 'unread').slice(0, 3);

  return (
    <div className={`min-h-dvh flex flex-col relative transition-colors duration-200 selection:bg-rose-500 selection:text-white ${theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'}`}>
      {/* Light Mode Cyber Security Watermark Background */}
      {theme === 'light' && (
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden select-none transition-opacity duration-500" style={{ opacity: watermarkOpacityValue }} aria-hidden="true">
          <img src="/cyber_security_bg.jpg" alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover object-center mix-blend-multiply filter contrast-110 saturate-125" />
          <div className="absolute inset-0 bg-gradient-to-b from-slate-50/40 via-transparent to-slate-50/70" />
        </div>
      )}

      {/* Dark Mode subtle cyber ambient background */}
      {theme === 'dark' && (
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden select-none opacity-20" aria-hidden="true">
          <img src="/cyber_security_bg.jpg" alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover object-center filter contrast-125 brightness-75" />
          <div className="absolute inset-0 bg-slate-950/75" />
        </div>
      )}

      <Header
        page={page}
        onNavigate={navigate}
        onSelectTab={setActiveTab}
        historyCount={history.length}
        theme={theme}
        onToggleTheme={toggleTheme}
        watermarkIntensity={watermarkIntensity}
        onCycleWatermark={cycleWatermarkIntensity}
        aiConfigured={aiConfigured}
        user={user}
        authStatus={authStatus}
        unreadNotifications={unread}
        onLogout={handleLogout}
      />

      <main id="main" className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 relative z-10">
        {page.kind === 'tabs' && activeTab === 'home' && (
          <div className="space-y-6">
            {/* Security notifications for signed-in users (polling-based, one per email) */}
            {authStatus === 'authenticated' && unreadItems.length > 0 && (
              <section aria-label="Security notifications" className="space-y-2 animate-fadeIn">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2"><Bell className="w-4 h-4 text-purple-600" aria-hidden="true" /> Security notifications <span className="min-w-4 h-4 px-1 rounded-full bg-rose-600 text-white text-[10px] flex items-center justify-center font-bold">{unread}</span></h2>
                  <button type="button" onClick={() => navigate('/notifications')} className="text-xs font-semibold text-rose-700 dark:text-rose-300 hover:underline cursor-pointer inline-flex items-center gap-1">All notifications <ArrowRight className="w-3 h-3" aria-hidden="true" /></button>
                </div>
                {unreadItems.map((n) => <NotificationCard key={n.id} item={n} onNavigate={navigate} onMarkRead={markRead} onDismiss={dismiss} />)}
              </section>
            )}
            {authStatus === 'authenticated' && (
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="text-slate-500 dark:text-slate-400">Mailbox protection:</span>
                <SecondaryButton onClick={() => navigate('/dashboard/outlook')}><Mail className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" /> Outlook history</SecondaryButton>
                <SecondaryButton onClick={() => navigate('/dashboard/gmail')}><Inbox className="w-3.5 h-3.5 text-red-600" aria-hidden="true" /> Gmail history</SecondaryButton>
                <SecondaryButton onClick={() => navigate('/threats')}>Threats</SecondaryButton>
              </div>
            )}
            <HomeDashboard history={history} aiConfigured={aiConfigured} onStart={startInvestigation} onNavigate={setActiveTab} onOpenScan={handleSelectFromHistory} />
          </div>
        )}

        {page.kind === 'tabs' && activeTab === 'investigate' && (
          currentAnalysis ? (
            currentAnalysis.investigation ? (
              <InvestigationReportView
                report={currentAnalysis.investigation}
                memoryMatch={memoryMatch}
                onScanAnother={() => { setCurrentAnalysis(null); setMemoryMatch(undefined); }}
                onOpenCoach={openCoach}
              />
            ) : (
              <AnalysisReport result={currentAnalysis} onScanAnother={() => setCurrentAnalysis(null)} />
            )
          ) : (
            <div className="space-y-6">
              <div className="text-center max-w-2xl mx-auto space-y-2 pb-1">
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Investigation Console</h2>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  Paste a message, upload a screenshot, enter a link or drop in a whole conversation. The orchestrator decides which agents to run and shows its work.
                </p>
              </div>
              <InvestigationConsole seed={seed} onSeedConsumed={() => setSeed(null)} onComplete={handleInvestigationComplete} aiConfigured={aiConfigured} />
            </div>
          )
        )}

        {page.kind === 'tabs' && activeTab === 'domain' && <DomainChecker onFullInvestigation={(url) => startInvestigation({ mode: 'url', url, autoRun: true })} />}

        {page.kind === 'tabs' && activeTab === 'incident' && <IncidentResponse latest={latestInvestigation} />}

        {page.kind === 'tabs' && activeTab === 'coach' && <SafetyCoach focusCategory={latestInvestigation?.investigation?.verdict.scamType || null} />}

        {page.kind === 'tabs' && activeTab === 'dashboard' && <SafetyDashboard history={history} onNewScan={() => startInvestigation({ mode: 'message' })} />}

        {page.kind === 'tabs' && activeTab === 'history' && (
          <ScanHistoryView
            history={history}
            onSelectScan={handleSelectFromHistory}
            onClearHistory={handleClearHistory}
            onNewScan={() => startInvestigation({ mode: 'message' })}
          />
        )}

        {page.kind === 'login' && <AuthPage next={search.get('next')} onNavigate={navigate} />}
        {page.kind === 'mailbox' && <MailboxPage key={page.provider} provider={page.provider} search={search} onNavigate={navigate} onOpenCoach={openCoach} />}
        {page.kind === 'threats' && <ThreatsPage onNavigate={navigate} onOpenCoach={openCoach} onOpenLocalHistory={() => setActiveTab('history')} />}
        {page.kind === 'notifications' && <NotificationsPage onNavigate={navigate} />}
        {page.kind === 'settings' && <SettingsPage onNavigate={navigate} />}
        {page.kind === 'admin' && <AdminPage section={page.section} onNavigate={navigate} />}
        {page.kind === 'not_found' && (
          <Card className="max-w-lg mx-auto"><EmptyState icon={Lock} title="Page not found" body="That address does not exist in Online Safety Guard." action={<SecondaryButton onClick={() => navigate('/')}>Back to dashboard</SecondaryButton>} /></Card>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200/80 dark:border-slate-800/90 bg-white/70 dark:bg-slate-950/90 backdrop-blur-md py-6 mt-12 relative z-10 transition-colors">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-600 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
            <span>Online Safety Guard — Privacy first: manual scans stay in your browser; mailbox analyses are private to your account and never keep full email bodies.</span>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <button onClick={() => setActiveTab('incident')} className="hover:text-amber-600 dark:hover:text-amber-400 transition-colors font-medium cursor-pointer">Incident Response</button>
            <span aria-hidden="true">•</span>
            <button onClick={() => setActiveTab('coach')} className="hover:text-slate-900 dark:hover:text-slate-200 transition-colors font-medium cursor-pointer">Safety Coach</button>
            <span aria-hidden="true">•</span>
            <button onClick={() => setActiveTab('domain')} className="hover:text-slate-900 dark:hover:text-slate-200 transition-colors font-medium cursor-pointer">Link Inspector</button>
            <span aria-hidden="true">•</span>
            <a
              href="/online-safety-guard.zip"
              download="online-safety-guard.zip"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-400 font-semibold border border-rose-500/25 transition-colors cursor-pointer"
              title="Download project zip file"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Export ZIP</span>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

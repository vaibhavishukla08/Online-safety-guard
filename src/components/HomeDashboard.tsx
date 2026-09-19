import React from 'react';
import { MessageSquare, ScanEye, Link2, MessagesSquare, Play, ShieldAlert, Workflow, Brain, Radar, Gauge, ShieldCheck, Cpu, Database, GraduationCap, LayoutDashboard, ArrowRight, Siren } from 'lucide-react';
import { DEMO_SCENARIOS } from '../data/demoScenarios';
import type { AnalysisResult, AppTab, InvestigateMode, InvestigationSeed } from '../types';
import { LEVEL_TOKENS, levelForScore } from '../utils/risk';
import { Card, RiskBadge } from './ui/primitives';

interface Props {
  history: AnalysisResult[];
  aiConfigured: boolean | null;
  onStart: (seed: InvestigationSeed) => void;
  onNavigate: (tab: AppTab) => void;
  onOpenScan: (scan: AnalysisResult) => void;
}

const ENTRY_POINTS: Array<{ mode: InvestigateMode; label: string; body: string; icon: React.ElementType; tone: string }> = [
  { mode: 'message', label: 'Analyze Message', body: 'Paste a text, email or DM.', icon: MessageSquare, tone: 'bg-rose-500/15 text-rose-600 dark:text-rose-400' },
  { mode: 'screenshot', label: 'Analyze Screenshot', body: 'Upload an image — agents extract everything.', icon: ScanEye, tone: 'bg-sky-500/15 text-sky-600 dark:text-sky-400' },
  { mode: 'url', label: 'Analyze URL', body: 'Investigate a link without opening it.', icon: Link2, tone: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  { mode: 'conversation', label: 'Conversation Analyzer', body: 'Paste a whole chat to map the scam arc.', icon: MessagesSquare, tone: 'bg-teal-500/15 text-teal-600 dark:text-teal-400' },
];

const PIPELINE: Array<{ icon: React.ElementType; label: string }> = [
  { icon: Workflow, label: 'Orchestrator' },
  { icon: Brain, label: 'Understand' },
  { icon: Radar, label: 'Investigate & verify' },
  { icon: Gauge, label: 'Correlate & score' },
  { icon: ShieldCheck, label: 'Protect & educate' },
];

export const HomeDashboard: React.FC<Props> = ({ history, aiConfigured, onStart, onNavigate, onOpenScan }) => {
  const recent = history.slice(0, 3);
  const highRisk = history.filter((h) => h.riskScore >= 50).length;

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Hero */}
      <div className="text-center max-w-3xl mx-auto space-y-3 pt-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/25 text-rose-700 dark:text-rose-400 text-xs font-semibold shadow-xs">
          <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Agentic AI Cyber Defense Assistant</span>
        </div>
        <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Investigate suspicious messages, links, screenshots &amp; conversations
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed max-w-2xl mx-auto">
          A Safety Orchestrator dispatches specialised agents that gather evidence, verify identities against known organizations, consult external threat intelligence, explain their reasoning and generate a personalised protection plan.
        </p>
        <div className="flex items-center justify-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 flex-wrap pt-1">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/70 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800"><Cpu className="w-3 h-3" aria-hidden="true" /> {aiConfigured === false ? 'Rules-only mode (no Gemini key)' : 'Gemini 3.8 Flash + deterministic rules'}</span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/70 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800"><Radar className="w-3 h-3" aria-hidden="true" /> RDAP · DNS · VirusTotal · Safe Browsing</span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/70 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800"><Database className="w-3 h-3" aria-hidden="true" /> Privacy-first, on-device history</span>
        </div>
      </div>

      {/* Entry points */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {ENTRY_POINTS.map((e) => {
          const Icon = e.icon;
          return (
            <button key={e.mode} type="button" id={`home-start-${e.mode}`} onClick={() => onStart({ mode: e.mode })} className="text-left p-4 rounded-2xl bg-white/85 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 hover:border-rose-300 dark:hover:border-rose-500/50 hover:shadow-md transition-all cursor-pointer group backdrop-blur-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/60">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${e.tone}`} aria-hidden="true"><Icon className="w-5 h-5" /></div>
              <div className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors flex items-center gap-1">{e.label} <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" /></div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{e.body}</p>
            </button>
          );
        })}
      </div>

      {/* Pipeline strip */}
      <Card className="py-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 md:w-40 flex-shrink-0">How it works</div>
          <ol className="flex-1 flex flex-wrap items-center gap-x-1 gap-y-2">
            {PIPELINE.map((p, i) => {
              const Icon = p.icon;
              return (
                <li key={p.label} className="flex items-center gap-1">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-800 dark:text-slate-200"><Icon className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" aria-hidden="true" /> {p.label}</span>
                  {i < PIPELINE.length - 1 && <ArrowRight className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />}
                </li>
              );
            })}
          </ol>
        </div>
      </Card>

      {/* Demo mode */}
      <section aria-labelledby="demo-heading">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Play className="w-4 h-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            <h3 id="demo-heading" className="text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-white">Demo mode</h3>
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:inline">Each scenario runs the real pipeline and shows a different agent path</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {DEMO_SCENARIOS.map((d) => {
            const t = LEVEL_TOKENS[d.expectedLevel];
            return (
              <button key={d.id} type="button" id={`demo-${d.id}`} onClick={() => onStart(d.seed)} className="text-left p-4 rounded-2xl bg-white/85 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-md transition-all cursor-pointer group backdrop-blur-sm flex flex-col focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/60">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">{d.title}</span>
                  <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${t.bg} ${t.text} ${t.border}`}>{d.expectedLevel}</span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed flex-1">{d.showcase}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400"><Play className="w-3 h-3" aria-hidden="true" /> Run investigation</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Recent + shortcuts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-white">Recent investigations</h3>
            {history.length > 0 && <button type="button" onClick={() => onNavigate('history')} className="text-[11px] font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer">View all ({history.length})</button>}
          </div>
          {recent.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">No investigations yet. Run a demo scenario or paste a message to start.</p>
          ) : (
            <ul className="space-y-2">
              {recent.map((scan) => {
                const level = scan.investigation?.verdict.level || levelForScore(scan.riskScore);
                return (
                  <li key={scan.id}>
                    <button type="button" onClick={() => onOpenScan(scan)} className="w-full text-left flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 cursor-pointer">
                      <RiskBadge level={level} size="sm" />
                      <span className="text-xs font-semibold text-slate-900 dark:text-white truncate flex-1">{scan.scamType}</span>
                      <span className="font-mono text-xs text-slate-500 tabular-nums">{scan.riskScore}/100</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <div className="space-y-3">
          <button type="button" onClick={() => onNavigate('dashboard')} className="w-full text-left p-4 rounded-2xl bg-white/85 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 hover:border-slate-300 cursor-pointer flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center" aria-hidden="true"><LayoutDashboard className="w-4 h-4" /></span>
            <span><span className="block text-xs font-bold text-slate-900 dark:text-white">Safety Dashboard</span><span className="block text-[11px] text-slate-500">{history.length} scans · {highRisk} high-risk</span></span>
          </button>
          <button type="button" onClick={() => onNavigate('coach')} className="w-full text-left p-4 rounded-2xl bg-white/85 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 hover:border-slate-300 cursor-pointer flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-purple-500/15 text-purple-600 dark:text-purple-400 flex items-center justify-center" aria-hidden="true"><GraduationCap className="w-4 h-4" /></span>
            <span><span className="block text-xs font-bold text-slate-900 dark:text-white">AI Safety Coach</span><span className="block text-[11px] text-slate-500">Adaptive scenarios that target your weak spots</span></span>
          </button>
          <button type="button" onClick={() => onNavigate('incident')} className="w-full text-left p-4 rounded-2xl bg-white/85 dark:bg-slate-900/80 border border-amber-200 dark:border-amber-500/30 hover:border-amber-300 cursor-pointer flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center" aria-hidden="true"><Siren className="w-4 h-4" /></span>
            <span><span className="block text-xs font-bold text-slate-900 dark:text-white">I already interacted</span><span className="block text-[11px] text-slate-500">Clicked, paid or shared an OTP? Get a response plan.</span></span>
          </button>
        </div>
      </div>
    </div>
  );
};

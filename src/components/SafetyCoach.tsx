import React, { useCallback, useEffect, useState } from 'react';
import { GraduationCap, Loader2, CheckCircle2, XCircle, ArrowRight, RotateCcw, Target, Trophy, Lightbulb, Cpu, HelpCircle } from 'lucide-react';
import type { CoachCategory, CoachProgress, CoachScenario } from '../types';
import { requestCoachScenario } from '../api/client';
import { getCoachProgress, resetCoachProgress, saveCoachProgress } from '../utils/storage';
import { RedFlagQuiz } from './RedFlagQuiz';
import { Card, Notice, PrimaryButton, SecondaryButton, SectionTitle, SourceTag, Meter } from './ui/primitives';

const CATEGORY_LABELS: Record<CoachCategory, string> = {
  phishing: 'Phishing',
  job_scam: 'Job scams',
  delivery_scam: 'Delivery scams',
  payment_scam: 'Payment / UPI scams',
  government_impersonation: 'Government impersonation',
  account_takeover: 'Account takeover',
  investment_scam: 'Investment / crypto',
  otp_fraud: 'OTP fraud',
  legitimate: 'Recognising genuine messages',
};

interface Props {
  /** Category hint from the last investigation (steers the first scenario). */
  focusCategory?: string | null;
}

export const SafetyCoach: React.FC<Props> = ({ focusCategory }) => {
  const [tab, setTab] = useState<'coach' | 'quiz'>('coach');
  const [progress, setProgress] = useState<CoachProgress>(() => getCoachProgress());
  const [scenario, setScenario] = useState<CoachScenario | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seenIds, setSeenIds] = useState<string[]>([]);

  const loadScenario = useCallback(async (current: CoachProgress) => {
    setLoading(true);
    setError(null);
    setSelected(null);
    // Nudge the coach toward the category of the last investigation on the first question.
    const steered: CoachProgress = focusCategory && current.answered === 0 ? { ...current, recentMistakes: [mapFocus(focusCategory)] } : current;
    const res = await requestCoachScenario(steered, seenIds);
    setLoading(false);
    if (res.ok) {
      setScenario(res.data.scenario);
      setSeenIds((ids) => [...ids, res.data.scenario.id].slice(-30));
    } else {
      setError(res.error.message);
    }
  }, [focusCategory, seenIds]);

  useEffect(() => {
    if (tab === 'coach' && !scenario && !loading) void loadScenario(progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const answer = (optionId: string) => {
    if (!scenario || selected) return;
    setSelected(optionId);
    const correct = scenario.options.find((o) => o.id === optionId)?.isCorrect ?? false;
    const cat = progress.byCategory[scenario.category] || { attempts: 0, correct: 0 };
    const next: CoachProgress = {
      answered: progress.answered + 1,
      correct: progress.correct + (correct ? 1 : 0),
      streak: correct ? progress.streak + 1 : 0,
      byCategory: { ...progress.byCategory, [scenario.category]: { attempts: cat.attempts + 1, correct: cat.correct + (correct ? 1 : 0) } },
      recentMistakes: correct ? progress.recentMistakes : [...progress.recentMistakes, scenario.category].slice(-5),
      difficulty: progress.difficulty,
    };
    // Adaptive difficulty: 3 correct in a row → harder; a mistake at a higher level → easier.
    if (correct && next.streak >= 3 && next.difficulty < 3) { next.difficulty = (next.difficulty + 1) as 1 | 2 | 3; next.streak = 0; }
    else if (!correct && next.difficulty > 1) next.difficulty = (next.difficulty - 1) as 1 | 2 | 3;
    setProgress(next);
    saveCoachProgress(next);
  };

  const reset = () => {
    resetCoachProgress();
    const fresh = getCoachProgress();
    setProgress(fresh);
    setScenario(null);
    setSelected(null);
    setSeenIds([]);
    void loadScenario(fresh);
  };

  const accuracy = progress.answered ? Math.round((progress.correct / progress.answered) * 100) : 0;
  const weak = Object.entries(progress.byCategory).filter(([, s]) => s.attempts >= 1 && s.correct / s.attempts < 0.7).map(([c]) => c as CoachCategory);
  const chosen = scenario?.options.find((o) => o.id === selected);

  return (
    <div className="space-y-5 max-w-4xl mx-auto animate-fadeIn">
      <div className="flex items-center gap-2" role="tablist" aria-label="Coach mode">
        <button role="tab" aria-selected={tab === 'coach'} type="button" onClick={() => setTab('coach')} className={`px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors ${tab === 'coach' ? 'bg-purple-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'}`}>AI Safety Coach</button>
        <button role="tab" aria-selected={tab === 'quiz'} type="button" onClick={() => setTab('quiz')} className={`px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors ${tab === 'quiz' ? 'bg-purple-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'}`}>30-second self-assessment</button>
      </div>

      {tab === 'quiz' && <RedFlagQuiz />}

      {tab === 'coach' && (
        <>
          {/* Progress */}
          <Card>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/15 text-purple-600 dark:text-purple-400 flex items-center justify-center flex-shrink-0"><GraduationCap className="w-5 h-5" aria-hidden="true" /></div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">AI Cyber Safety Coach</h2>
                  <p className="text-xs text-slate-600 dark:text-slate-400">Realistic scenarios that adapt to your mistakes. Difficulty rises after 3 correct answers in a row.</p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-center">
                <Stat label="Answered" value={String(progress.answered)} />
                <Stat label="Accuracy" value={`${accuracy}%`} />
                <Stat label="Streak" value={String(progress.streak)} icon={Trophy} />
                <Stat label="Level" value={`${progress.difficulty}/3`} icon={Target} />
              </div>
            </div>
            {weak.length > 0 && (
              <div className="mt-4 flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300">
                <Target className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
                <span><strong>Weak areas the coach is targeting:</strong> {weak.map((w) => CATEGORY_LABELS[w] || w).join(', ')}</span>
              </div>
            )}
            {Object.keys(progress.byCategory).length > 0 && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                {Object.entries(progress.byCategory).map(([c, s]) => (
                  <div key={c} className="flex items-center gap-3">
                    <span className="w-44 text-[11px] text-slate-600 dark:text-slate-400 truncate">{CATEGORY_LABELS[c as CoachCategory] || c}</span>
                    <Meter value={s.attempts ? s.correct / s.attempts : 0} max={1} barClass={s.correct / s.attempts >= 0.7 ? 'bg-emerald-500' : 'bg-amber-500'} label={`${CATEGORY_LABELS[c as CoachCategory] || c} accuracy`} />
                    <span className="w-12 text-right font-mono text-[11px] tabular-nums text-slate-500">{s.correct}/{s.attempts}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {error && <Notice tone="error">{error} <button type="button" onClick={() => loadScenario(progress)} className="underline font-semibold cursor-pointer ml-1">Retry</button></Notice>}

          {/* Scenario */}
          {loading && !scenario ? (
            <Card><div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400 py-6 justify-center"><Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Generating a scenario tailored to you…</div></Card>
          ) : scenario ? (
            <Card className={loading ? 'opacity-60' : ''}>
              <SectionTitle
                icon={HelpCircle}
                iconClass="text-purple-600 dark:text-purple-400"
                title={`Scenario · ${CATEGORY_LABELS[scenario.category] || scenario.category}`}
                subtitle={`Difficulty ${scenario.difficulty}/3 · ${scenario.channel} · from ${scenario.sender}`}
                right={<span className="inline-flex items-center gap-1 text-[10px] text-slate-500"><Cpu className="w-3 h-3" aria-hidden="true" /><SourceTag source={scenario.source} /></span>}
              />
              <div className="p-4 rounded-xl bg-slate-100/90 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 font-mono text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">{scenario.scenario}</div>
              <p className="text-sm font-bold text-slate-900 dark:text-white mt-4 mb-2">{scenario.question}</p>
              <div className="space-y-2" role="group" aria-label="Answer options">
                {scenario.options.map((o) => {
                  const isChosen = selected === o.id;
                  const reveal = Boolean(selected);
                  const tone = !reveal
                    ? 'bg-white dark:bg-slate-900/70 border-slate-200 dark:border-slate-800 hover:border-purple-300 dark:hover:border-purple-500/50'
                    : o.isCorrect
                      ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-400 dark:border-emerald-500/50'
                      : isChosen
                        ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-400 dark:border-rose-500/50'
                        : 'bg-slate-50 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800 opacity-70';
                  return (
                    <button key={o.id} type="button" disabled={reveal} onClick={() => answer(o.id)} className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-start gap-3 cursor-pointer disabled:cursor-default min-h-[48px] focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/60 ${tone}`}>
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 uppercase ${reveal && o.isCorrect ? 'bg-emerald-600 text-white' : reveal && isChosen ? 'bg-rose-600 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'}`} aria-hidden="true">
                        {reveal && o.isCorrect ? <CheckCircle2 className="w-4 h-4" /> : reveal && isChosen ? <XCircle className="w-4 h-4" /> : o.id}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm text-slate-900 dark:text-white">{o.text}</span>
                        {reveal && (o.isCorrect || isChosen) && <span className="block text-xs text-slate-600 dark:text-slate-400 mt-1">{o.feedback}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>

              {selected && (
                <div className="mt-4 space-y-3 animate-fadeIn" aria-live="polite">
                  <div className={`p-4 rounded-xl border ${chosen?.isCorrect ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-500/40' : 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-500/40'}`}>
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 mb-1">{chosen?.isCorrect ? 'Correct — safest choice' : 'Not the safest choice'}</div>
                    <p className="text-sm text-slate-800 dark:text-slate-200 flex items-start gap-2"><Lightbulb className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600" aria-hidden="true" /> {scenario.lesson}</p>
                    {scenario.redFlags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {scenario.redFlags.map((r) => <span key={r} className="px-2 py-0.5 rounded-md text-[11px] bg-white/80 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">{r}</span>)}
                      </div>
                    )}
                    {scenario.redFlags.length === 0 && <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-400">This one was genuine — no red flags. Knowing what "normal" looks like is part of the skill.</p>}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <SecondaryButton onClick={reset}><RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Reset progress</SecondaryButton>
                    <PrimaryButton id="btn-next-scenario" onClick={() => loadScenario(progress)} disabled={loading}>
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="w-4 h-4" aria-hidden="true" />} Next scenario
                    </PrimaryButton>
                  </div>
                </div>
              )}
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; icon?: React.ElementType }> = ({ label, value, icon: Icon }) => (
  <div className="min-w-[64px]">
    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center justify-center gap-1">{Icon && <Icon className="w-3 h-3" aria-hidden="true" />}{label}</div>
    <div className="text-lg font-extrabold text-slate-900 dark:text-white tabular-nums">{value}</div>
  </div>
);

function mapFocus(scamType: string): CoachCategory {
  const s = scamType.toLowerCase();
  if (/job|task|advance/.test(s)) return 'job_scam';
  if (/deliver|parcel|smish/.test(s)) return 'delivery_scam';
  if (/upi|payment/.test(s)) return 'payment_scam';
  if (/govern|tax|police|authority/.test(s)) return 'government_impersonation';
  if (/account|takeover|social/.test(s)) return 'account_takeover';
  if (/invest|crypto|giveaway/.test(s)) return 'investment_scam';
  if (/otp/.test(s)) return 'otp_fraud';
  if (/legit|no scam/.test(s)) return 'legitimate';
  return 'phishing';
}

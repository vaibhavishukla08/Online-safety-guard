/**
 * Social Engineering Agent — identifies the psychological levers being pulled.
 *
 * Gemini performs the analysis (it is genuinely good at intent and tone); the
 * deterministic tactic list from the signal scan is the fallback and the floor.
 * Its score contribution is bounded (max +8) so tone alone can't condemn a message.
 */
import { Type } from '@google/genai';
import { generateJson } from '../gemini/client';
import { addEvidence, addIndicator, beginStep, noteAiFailure, type AgentContext } from './context';
import type { SocialEngineeringFinding } from '../../shared/investigation';

const TACTIC_VOCAB = ['Fear', 'Urgency', 'Authority', 'Greed', 'Curiosity', 'Scarcity', 'Emotional manipulation', 'Threats', 'Fake rewards', 'Impersonation', 'Trust building', 'Pressure to act quickly', 'Isolation', 'Reciprocity', 'Social proof'];

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    primaryTactics: { type: Type.ARRAY, items: { type: Type.STRING }, description: `1–2 dominant tactics from: ${TACTIC_VOCAB.join(', ')}. Empty if none.` },
    secondaryTactics: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Supporting tactics from the same vocabulary.' },
    attackerGoal: { type: Type.STRING, description: 'One sentence: what behaviour the sender is trying to cause (or "No manipulative goal identified").' },
    explanation: { type: Type.STRING, description: 'Two concise sentences, user-facing, describing how the manipulation works in this message.' },
    manipulationIntensity: { type: Type.INTEGER, description: '0 (none) to 10 (extreme psychological pressure).' },
  },
  required: ['primaryTactics', 'secondaryTactics', 'attackerGoal', 'explanation', 'manipulationIntensity'],
};

export function socialEngineeringNeeded(ctx: AgentContext): { needed: boolean; reason: string } {
  const ruleTactics = ctx.signals.filter((s) => s.tactic).length;
  const aiSuspicious = (ctx.messageAssessment?.scamConfidence ?? 0) >= 0.4;
  if (ruleTactics > 0 || aiSuspicious || ctx.input.conversationTurns > 1) return { needed: true, reason: 'pressure or persuasion cues present' };
  return { needed: false, reason: 'no persuasion cues detected' };
}

export async function runSocialEngineeringAgent(ctx: AgentContext): Promise<void> {
  const finish = beginStep(ctx, 'social_engineering', 'Social Engineering Agent', 'Profiling the psychological tactics in use…');
  const ruleTactics = Array.from(new Set(ctx.signals.map((s) => s.tactic).filter((t): t is string => Boolean(t))));

  const result = await generateJson<SocialEngineeringFinding & { manipulationIntensity: number }>({
    systemInstruction: 'You are the Social Engineering Agent of a cyber-safety system. Identify psychological manipulation techniques used against the recipient. Use only the provided tactic vocabulary. Be precise and avoid speculation.',
    prompt: `Message${ctx.input.conversationTurns > 1 ? ' / conversation' : ''} (${ctx.input.platform || 'unknown platform'}):
"""
${ctx.input.message}
"""
Rule-based detectors already flagged: ${ruleTactics.length ? ruleTactics.join(', ') : 'nothing'}.
Return the structured analysis described by the schema.`,
    schema: SCHEMA,
    temperature: 0.2,
  });

  if (result.ok) {
    ctx.aiCallsSucceeded += 1;
    const d = result.data;
    const normalize = (arr: unknown) => (Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()).slice(0, 4) : []);
    const primary = normalize(d.primaryTactics);
    const secondary = normalize(d.secondaryTactics).filter((t) => !primary.includes(t));
    const intensity = Math.max(0, Math.min(10, Math.round(Number(d.manipulationIntensity) || 0)));

    ctx.socialEngineering = {
      primaryTactics: primary.length ? primary : ruleTactics.slice(0, 2),
      secondaryTactics: secondary,
      attackerGoal: String(d.attackerGoal || 'No manipulative goal identified'),
      explanation: String(d.explanation || ''),
      source: 'ai',
    };

    if (intensity >= 7) {
      addIndicator(ctx, { id: 'ai_manipulation', label: 'Strong psychological pressure (AI)', points: 8, evidence: `Intensity ${intensity}/10 · ${primary.join(' + ') || 'unspecified'}`, source: 'ai', agent: 'social_engineering' });
    } else if (intensity >= 4) {
      addIndicator(ctx, { id: 'ai_manipulation', label: 'Moderate psychological pressure (AI)', points: 4, evidence: `Intensity ${intensity}/10 · ${primary.join(' + ') || 'unspecified'}`, source: 'ai', agent: 'social_engineering' });
    }
    if (primary.length) {
      addEvidence(ctx, { id: 'ev-manipulation', title: `Manipulation: ${primary.join(' + ')}`, description: ctx.socialEngineering.explanation || ctx.socialEngineering.attackerGoal, source: 'ai', agent: 'social_engineering', severity: intensity >= 7 ? 'high' : intensity >= 4 ? 'medium' : 'low' });
    }
    finish('completed', primary.length ? `Primary tactic: ${primary.join(' + ')} · intensity ${intensity}/10` : 'No dominant manipulation tactic identified', [ctx.socialEngineering.attackerGoal]);
    return;
  }

  noteAiFailure(ctx, result.code);
  // Deterministic fallback — derived purely from the signals that fired.
  ctx.socialEngineering = {
    primaryTactics: ruleTactics.slice(0, 2),
    secondaryTactics: ruleTactics.slice(2, 5),
    attackerGoal: ruleTactics.length ? fallbackGoal(ruleTactics) : 'No manipulative goal identified',
    explanation: ruleTactics.length ? `Rule-based detectors found ${ruleTactics.join(', ').toLowerCase()} cues. AI profiling was unavailable, so this is a pattern-based summary.` : 'No persuasion cues were detected by rule-based analysis.',
    source: 'rule',
  };
  if (ruleTactics.length) {
    addEvidence(ctx, { id: 'ev-manipulation', title: `Manipulation cues: ${ruleTactics.slice(0, 2).join(' + ')}`, description: ctx.socialEngineering.explanation, source: 'rule', agent: 'social_engineering', severity: ruleTactics.length >= 3 ? 'high' : 'medium' });
  }
  finish('completed', ruleTactics.length ? `Pattern-based: ${ruleTactics.slice(0, 2).join(' + ')} (AI unavailable)` : 'No tactics detected by rules (AI unavailable)');
}

function fallbackGoal(tactics: string[]): string {
  if (tactics.includes('Credential harvesting')) return 'Get the recipient to hand over codes or passwords before they can verify who is asking.';
  if (tactics.includes('Financial pressure') || tactics.includes('Irreversible payment')) return 'Get the recipient to send money quickly through a channel that cannot be reversed.';
  if (tactics.includes('Greed')) return 'Use excitement about a reward to lower the recipient’s guard before the real ask.';
  if (tactics.includes('Fear') || tactics.includes('Urgency')) return 'Make the recipient act before independently verifying the message.';
  return 'Build enough trust or pressure that the recipient complies without checking.';
}

/**
 * Conversation Analysis Agent — analyses a multi-message exchange as a whole:
 * scam progression stages, escalation pattern and manipulation arc.
 *
 * Gemini provides the stage narrative; a deterministic pass over the turns
 * provides the fallback and an evidence-backed "escalation" indicator.
 */
import { Type } from '@google/genai';
import { generateJson } from '../gemini/client';
import { scanSignals } from '../rules/signals';
import { addEvidence, addIndicator, beginStep, noteAiFailure, type AgentContext } from './context';
import type { ConversationFinding, ConversationStage } from '../../shared/investigation';

export interface ConversationTurn {
  index: number;
  speaker: string;
  text: string;
}

const SPEAKER_LINE = /^\s*(?:\[[^\]]{1,20}\]\s*)?([A-Za-z][A-Za-z0-9 _.'-]{0,24}?)\s*[:：>\-–]\s+(.*)$/;

/** Parse a pasted transcript into turns. Tolerates "Name: text" and plain alternating lines. */
export function parseConversation(raw: string): ConversationTurn[] {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const turns: ConversationTurn[] = [];
  let labelled = 0;
  for (const line of lines) {
    const m = line.match(SPEAKER_LINE);
    if (m && m[2]) {
      labelled += 1;
      turns.push({ index: turns.length, speaker: m[1].trim(), text: m[2].trim() });
    } else if (turns.length && labelled > 0) {
      // Continuation of the previous labelled message.
      turns[turns.length - 1].text += ' ' + line;
    } else {
      turns.push({ index: turns.length, speaker: turns.length % 2 === 0 ? 'Sender' : 'You', text: line });
    }
  }
  return turns;
}

/** Pick the speaker who is most likely the counterpart (not the user). */
function counterpartSpeaker(turns: ConversationTurn[]): string | null {
  const userLike = /^(me|you|user|myself|i)$/i;
  const counts = new Map<string, number>();
  for (const t of turns) if (!userLike.test(t.speaker)) counts.set(t.speaker, (counts.get(t.speaker) || 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [s, c] of counts) if (c > bestCount) { best = s; bestCount = c; }
  return best;
}

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    scamType: { type: Type.STRING, description: "e.g. 'Advance-Fee Job Scam', 'Investment / Crypto Scam', 'Romance Scam', 'Tech Support Scam', 'Legitimate Conversation'." },
    stages: {
      type: Type.ARRAY,
      description: 'Ordered progression stages actually observed (3–6). Do not invent stages that have not happened.',
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING, description: "Short label e.g. 'Trust building', 'Fake opportunity', 'Excessive reward', 'Financial request', 'Urgency escalation'." },
          description: { type: Type.STRING, description: 'One sentence describing what happened at this stage.' },
          quote: { type: Type.STRING, description: 'Short exact quote from the conversation illustrating the stage.' },
        },
        required: ['label', 'description', 'quote'],
      },
    },
    escalationPattern: { type: Type.STRING, description: 'One sentence describing how the conversation escalates (or "No escalation observed").' },
    manipulationTechniques: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Techniques used across the conversation.' },
    recommendedResponse: { type: Type.STRING, description: 'What the user should do or say next (specific, safe, 1–2 sentences).' },
    predictedNextStep: { type: Type.STRING, description: 'What the counterpart will most likely ask for next if the pattern continues, or empty string.' },
  },
  required: ['scamType', 'stages', 'escalationPattern', 'manipulationTechniques', 'recommendedResponse', 'predictedNextStep'],
};

export async function runConversationAgent(ctx: AgentContext, turns: ConversationTurn[]): Promise<void> {
  const finish = beginStep(ctx, 'conversation', 'Conversation Agent', `Analysing ${turns.length}-message exchange for scam progression…`);
  const counterpart = counterpartSpeaker(turns);

  // --- Deterministic escalation analysis ---------------------------------
  // Order of first occurrence of key stages across the counterpart's turns.
  const firstIndex: Record<string, number> = {};
  for (const t of turns) {
    if (counterpart && t.speaker !== counterpart) continue;
    const { signals } = scanSignals(t.text, null);
    for (const s of signals) if (!(s.id in firstIndex)) firstIndex[s.id] = t.index;
  }
  const hook = Math.min(...['trust_building', 'fake_reward', 'curiosity'].map((k) => firstIndex[k] ?? Infinity));
  const ask = Math.min(...['financial_request', 'credential_request', 'untraceable_payment', 'small_fee', 'personal_data_request'].map((k) => firstIndex[k] ?? Infinity));
  const escalates = Number.isFinite(hook) && Number.isFinite(ask) && ask > hook;

  if (escalates) {
    addIndicator(ctx, { id: 'conversation_escalation', label: 'Hook-then-ask escalation', points: 10, evidence: `Reward/trust cue at message ${hook + 1}, money/credential ask at message ${ask + 1}`, source: 'rule', agent: 'conversation' });
    addEvidence(ctx, { id: 'ev-conversation_escalation', title: 'Classic escalation pattern', description: `The counterpart first offered something appealing (message ${hook + 1}) and only later asked for money or details (message ${ask + 1}). Legitimate employers and services do not reverse this order.`, source: 'rule', agent: 'conversation', severity: 'high' });
  }

  const transcript = turns.map((t) => `${t.speaker}: ${t.text}`).join('\n');

  // --- AI narrative ---------------------------------------------------------
  const result = await generateJson<{ scamType: string; stages: ConversationStage[]; escalationPattern: string; manipulationTechniques: string[]; recommendedResponse: string; predictedNextStep: string }>({
    systemInstruction: 'You are the Conversation Analysis Agent of a cyber-safety system. Analyse the whole exchange, not single messages. Identify the progression of a scam if present. Quote exactly; never invent quotes.',
    prompt: `Conversation (${turns.length} messages${counterpart ? `, counterpart is "${counterpart}"` : ''}):
"""
${transcript}
"""
Return the structured analysis described by the schema.`,
    schema: SCHEMA,
    temperature: 0.2,
  });

  if (result.ok) {
    ctx.aiCallsSucceeded += 1;
    const d = result.data;
    const stages: ConversationStage[] = (Array.isArray(d.stages) ? d.stages : []).slice(0, 6).map((s, i) => ({
      stage: i + 1,
      label: String((s as ConversationStage).label || `Stage ${i + 1}`),
      description: String((s as ConversationStage).description || ''),
      quote: typeof (s as ConversationStage).quote === 'string' ? (s as ConversationStage).quote : undefined,
    }));
    const escalation = String(d.escalationPattern || '') + (d.predictedNextStep ? ` Likely next ask: ${d.predictedNextStep}` : '');
    ctx.conversation = {
      turnCount: turns.length,
      scamType: String(d.scamType || 'Unclassified'),
      stages,
      escalationPattern: escalation,
      manipulationTechniques: Array.isArray(d.manipulationTechniques) ? d.manipulationTechniques.filter((x): x is string => typeof x === 'string').slice(0, 6) : [],
      recommendedResponse: String(d.recommendedResponse || ''),
      source: 'ai',
    };
    finish('completed', `${stages.length} stages identified · ${ctx.conversation.scamType}`, stages.map((s) => `Stage ${s.stage}: ${s.label}`));
    return;
  }

  noteAiFailure(ctx, result.code);
  // Deterministic fallback stages from signal order.
  const stageDefs: Array<[string, string, string]> = [
    ['trust_building', 'Trust building', 'Friendly or flattering framing lowers suspicion.'],
    ['fake_reward', 'Fake opportunity / reward', 'An attractive offer or prize is introduced.'],
    ['urgency', 'Pressure', 'A deadline or urgency is applied.'],
    ['financial_request', 'Financial request', 'Money, a fee or a deposit is requested.'],
    ['credential_request', 'Credential request', 'Codes, passwords or PINs are requested.'],
    ['untraceable_payment', 'Irreversible payment channel', 'Gift cards, crypto or wire transfer are specified.'],
  ];
  const stages: ConversationStage[] = stageDefs
    .filter(([id]) => id in firstIndex)
    .sort((a, b) => firstIndex[a[0]] - firstIndex[b[0]])
    .map(([id, label, description], i) => ({ stage: i + 1, label, description, quote: turns[firstIndex[id]]?.text.slice(0, 120) }));

  ctx.conversation = {
    turnCount: turns.length,
    scamType: escalates ? 'Probable advance-fee / escalation scam (rule-based)' : stages.length ? 'Suspicious exchange (rule-based)' : 'No scam pattern detected by rules',
    stages,
    escalationPattern: escalates ? 'Hook first, ask later — the counterpart introduced a reward or rapport before requesting money or details.' : 'No clear escalation pattern detected by rules.',
    manipulationTechniques: Array.from(new Set(ctx.signals.map((s) => s.tactic).filter((t): t is string => Boolean(t)))).slice(0, 6),
    recommendedResponse: escalates ? 'Stop engaging. Do not pay any fee or share details; verify the offer through the organization’s official website or phone number.' : 'Verify the counterpart independently before sharing anything sensitive.',
    source: 'rule',
  };
  finish('completed', `${stages.length} stages from rules (AI narrative unavailable)`, stages.map((s) => `Stage ${s.stage}: ${s.label}`));
}

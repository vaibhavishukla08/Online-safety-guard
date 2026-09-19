/**
 * Shared investigation context passed between agents.
 *
 * Agents read from and append to this object; the orchestrator owns its lifecycle.
 * Trace steps are emitted through `emit` so the streaming endpoint can forward them
 * to the UI in real time.
 */
import type {
  AgentId,
  ConversationFinding,
  EvidenceItem,
  ExternalEvidence,
  FinancialFinding,
  HighlightPhrase,
  IdentityFinding,
  InvestigationInput,
  RiskIndicator,
  SocialEngineeringFinding,
  TraceStep,
  TraceStatus,
  UrlFinding,
} from '../../shared/investigation';
import type { Signal } from '../rules/signals';
import type { GeminiErrorCode } from '../gemini/client';

/** Structured understanding of the message produced by the Message Agent's LLM call. */
export interface MessageAssessment {
  scamType: string;
  summary: string;
  /** 0–1: how confident the model is that this is a scam. */
  scamConfidence: number;
  /** 0–1: how confident the model is that this is legitimate. */
  legitimacyConfidence: number;
  claimedOrganization: string | null;
  requestsCredentials: boolean;
  requestsPayment: boolean;
  highlightPhrases: HighlightPhrase[];
  senderNotes: string;
}

export interface AgentContext {
  input: InvestigationInput;
  image: { base64: string; mimeType: string } | null;

  // Accumulated evidence
  signals: Signal[];
  indicators: RiskIndicator[];
  evidence: EvidenceItem[];
  highlights: HighlightPhrase[];
  urls: UrlFinding[];
  identity: IdentityFinding | null;
  socialEngineering: SocialEngineeringFinding | null;
  financial: FinancialFinding | null;
  conversation: ConversationFinding | null;
  external: ExternalEvidence | null;
  messageAssessment: MessageAssessment | null;

  // AI availability bookkeeping
  aiCallsSucceeded: number;
  aiFailures: GeminiErrorCode[];
  model: string | null;
  notices: string[];

  // Trace
  trace: TraceStep[];
  agentsRun: AgentId[];
  agentsSkipped: Array<{ agent: AgentId; reason: string }>;
  emit: (step: TraceStep) => void;
}

export function createContext(input: InvestigationInput, image: AgentContext['image'], emit: (step: TraceStep) => void): AgentContext {
  return {
    input,
    image,
    signals: [],
    indicators: [],
    evidence: [],
    highlights: [],
    urls: [],
    identity: null,
    socialEngineering: null,
    financial: null,
    conversation: null,
    external: null,
    messageAssessment: null,
    aiCallsSucceeded: 0,
    aiFailures: [],
    model: null,
    notices: [],
    trace: [],
    agentsRun: [],
    agentsSkipped: [],
    emit,
  };
}

let traceCounter = 0;

/** Start a trace step (status: running). Returns a finisher that records the outcome. */
export function beginStep(ctx: AgentContext, agent: AgentId, title: string, summary: string) {
  const id = `${agent}-${Date.now()}-${++traceCounter}`;
  const startedAt = Date.now();
  const step: TraceStep = { id, agent, title, summary, status: 'running', timestamp: new Date().toISOString() };
  ctx.trace.push(step);
  ctx.emit({ ...step });

  return (status: TraceStatus, finalSummary: string, details?: string[]) => {
    step.status = status;
    step.summary = finalSummary;
    step.durationMs = Date.now() - startedAt;
    if (details && details.length) step.details = details.slice(0, 6);
    if (status === 'completed' && !ctx.agentsRun.includes(agent)) ctx.agentsRun.push(agent);
    ctx.emit({ ...step });
  };
}

/** Record that an agent was intentionally not run, with the orchestrator's reason. */
export function skipAgent(ctx: AgentContext, agent: AgentId, title: string, reason: string) {
  ctx.agentsSkipped.push({ agent, reason });
  const step: TraceStep = {
    id: `${agent}-skip-${Date.now()}-${++traceCounter}`,
    agent,
    title,
    summary: `Skipped — ${reason}`,
    status: 'skipped',
    timestamp: new Date().toISOString(),
  };
  ctx.trace.push(step);
  ctx.emit({ ...step });
}

export function addIndicator(ctx: AgentContext, indicator: RiskIndicator) {
  // One indicator per id — prevents double counting when two agents observe the same thing.
  if (ctx.indicators.some((i) => i.id === indicator.id)) return;
  ctx.indicators.push(indicator);
}

export function addEvidence(ctx: AgentContext, item: EvidenceItem) {
  if (ctx.evidence.some((e) => e.id === item.id)) return;
  ctx.evidence.push(item);
}

export function noteAiFailure(ctx: AgentContext, code: GeminiErrorCode) {
  ctx.aiFailures.push(code);
}

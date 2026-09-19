/**
 * Safety Orchestrator Agent
 *
 * Goal: "Determine whether this content represents a cyber-safety threat and
 * provide the safest response for the user."
 *
 * The orchestrator does not run every agent. It looks at what has been learned
 * so far and decides which investigations are warranted:
 *
 *   understand (vision / parse) → Message Agent → [URL → Threat Intel]
 *   → Identity (if an organization is claimed or a look-alike domain exists)
 *   → Social Engineering (if persuasion cues exist)
 *   → Financial (if money/credentials are requested)
 *   → Conversation (if multi-turn)
 *   → Risk Assessment → Protection
 *
 * Independent agents run in parallel once the Message Agent has produced the
 * shared understanding they depend on.
 */
import { LIMITS } from '../config';
import { isGeminiConfigured } from '../gemini/client';
import { extractUrls, hostnameOf } from '../utils/url';
import { createContext, beginStep, skipAgent, type AgentContext } from './context';
import { runVisionAgent } from './visionAgent';
import { runMessageAgent } from './messageAgent';
import { runUrlAgent } from './urlAgent';
import { identityCheckNeeded, runIdentityAgent } from './identityAgent';
import { runSocialEngineeringAgent, socialEngineeringNeeded } from './socialEngineeringAgent';
import { financialCheckNeeded, runFinancialAgent } from './financialAgent';
import { parseConversation, runConversationAgent } from './conversationAgent';
import { runThreatIntelAgent, threatIntelNeeded } from './threatIntelAgent';
import { runRiskAgent } from './riskAgent';
import { runProtectionAgent } from './protectionAgent';
import { addEvidence, addIndicator } from './context';
import type { EmailEnvelope, EngineMode, InputType, InvestigationInput, InvestigationReport, TraceStep } from '../../shared/investigation';

export interface InvestigationRequest {
  inputType: InputType;
  message?: string;
  sender?: string;
  platform?: string;
  url?: string;
  conversation?: string;
  imageBase64?: string;
  imageMime?: string;
  /** URLs already extracted by the client (e.g. Outlook task pane); merged with server extraction. */
  urls?: string[];
  /** Email envelope for the Outlook channel (metadata only — attachments are never fetched). */
  email?: EmailEnvelope | null;
}

export class InvestigationError extends Error {
  constructor(public readonly status: number, message: string, public readonly code: string) {
    super(message);
  }
}

/** Validate and normalize the raw request body. Throws InvestigationError on bad input. */
export function validateRequest(body: unknown): InvestigationRequest {
  if (!body || typeof body !== 'object') throw new InvestigationError(400, 'Request body must be a JSON object.', 'bad_request');
  const b = body as Record<string, unknown>;
  const inputType = b.inputType;
  if (!['message', 'url', 'conversation', 'screenshot', 'email'].includes(String(inputType))) {
    throw new InvestigationError(400, "inputType must be 'message', 'url', 'conversation', 'screenshot' or 'email'.", 'bad_request');
  }
  const str = (v: unknown, max: number, name: string) => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'string') throw new InvestigationError(400, `${name} must be a string.`, 'bad_request');
    if (v.length > max) throw new InvestigationError(413, `${name} is too long (max ${max.toLocaleString()} characters).`, 'too_large');
    return v;
  };
  const req: InvestigationRequest = {
    inputType: inputType as InputType,
    message: str(b.message, LIMITS.messageChars, 'message')?.trim(),
    sender: str(b.sender, LIMITS.senderChars, 'sender')?.trim(),
    platform: str(b.platform, 60, 'platform')?.trim(),
    url: str(b.url, LIMITS.urlChars, 'url')?.trim(),
    conversation: str(b.conversation, LIMITS.conversationChars, 'conversation')?.trim(),
    imageBase64: str(b.imageBase64, LIMITS.imageBase64Chars, 'imageBase64'),
    imageMime: str(b.imageMime, 60, 'imageMime'),
    urls: Array.isArray(b.urls) ? b.urls.filter((u): u is string => typeof u === 'string' && u.length <= LIMITS.urlChars).slice(0, LIMITS.maxUrlsInvestigated) : undefined,
    // The email envelope is produced server-side by services/email.ts (already validated); never trusted raw from clients.
    email: inputType === 'email' && b.email && typeof b.email === 'object' ? (b.email as EmailEnvelope) : null,
  };

  if (req.inputType === 'message' && !req.message) throw new InvestigationError(400, 'Please paste the message text to investigate.', 'empty_input');
  if (req.inputType === 'email' && !req.message) throw new InvestigationError(400, 'This email has no readable content to analyse.', 'empty_input');
  if (req.inputType === 'url' && !req.url) throw new InvestigationError(400, 'Please enter a URL or domain to investigate.', 'empty_input');
  if (req.inputType === 'url' && req.url) {
    const host = hostnameOf(req.url);
    if (!host || !host.includes('.')) throw new InvestigationError(400, 'That does not look like a valid URL or domain (e.g. https://example.com or example.com).', 'invalid_url');
  }
  if (req.inputType === 'conversation' && !req.conversation) throw new InvestigationError(400, 'Please paste the conversation to analyse.', 'empty_input');
  if (req.inputType === 'screenshot' && !req.imageBase64) throw new InvestigationError(400, 'Please upload a screenshot to investigate.', 'empty_input');
  if (req.imageMime && !/^image\/(png|jpe?g|webp|gif|heic|heif)$/i.test(req.imageMime)) throw new InvestigationError(400, 'Unsupported image type. Use PNG, JPG or WebP.', 'bad_request');
  return req;
}

/**
 * Run the full investigation. `onTrace` receives every trace update as it happens
 * so the streaming endpoint can forward it to the UI.
 */
export async function investigate(req: InvestigationRequest, onTrace: (step: TraceStep) => void = () => {}): Promise<InvestigationReport> {
  const image = req.inputType === 'screenshot' && req.imageBase64 ? { base64: req.imageBase64, mimeType: req.imageMime || 'image/png' } : null;

  // Provisional input; refined by the understanding stage below.
  const input: InvestigationInput = {
    inputType: req.inputType,
    message: req.message || '',
    sender: req.sender || null,
    platform: req.platform || null,
    urls: [],
    conversationTurns: 1,
    extracted: null,
    email: req.inputType === 'email' ? req.email || null : null,
  };
  const ctx = createContext(input, image, onTrace);

  const finishOrchestrator = beginStep(ctx, 'orchestrator', 'Safety Orchestrator', 'Understanding the input and planning the investigation…');

  // ---------------------------------------------------------------- UNDERSTAND
  if (req.inputType === 'screenshot' && image) {
    const finishVision = beginStep(ctx, 'vision', 'Vision Agent', 'Reading the screenshot…');
    const vision = await runVisionAgent(image);
    if (!vision.ok) {
      finishVision('failed', `Could not read screenshot (${vision.code.replace('_', ' ')})`);
      const hint = vision.code === 'not_configured' ? 'Screenshot reading needs a Gemini API key. Paste the message text instead.' : `Screenshot reading failed: ${vision.message} Paste the message text instead.`;
      throw new InvestigationError(vision.code === 'not_configured' ? 503 : 502, hint, vision.code);
    }
    ctx.aiCallsSucceeded += 1;
    ctx.model = vision.model;
    const ex = vision.data;
    input.extracted = ex;
    input.message = ex.messageText || req.message || '';
    input.sender = ex.senderName || ex.phoneNumber || ex.emailAddress || req.sender || null;
    input.platform = ex.platform || req.platform || null;
    if (!input.message.trim()) {
      finishVision('completed', 'No message text found in the screenshot');
      throw new InvestigationError(422, 'No readable message text was found in the screenshot. Try a clearer image or paste the text.', 'no_text');
    }
    const facts: string[] = [];
    if (ex.senderName || ex.phoneNumber || ex.emailAddress) facts.push(`sender: ${ex.senderName || ex.phoneNumber || ex.emailAddress}`);
    if (ex.urls.length) facts.push(`${ex.urls.length} URL${ex.urls.length === 1 ? '' : 's'}`);
    if (ex.claimedOrganization) facts.push(`claims ${ex.claimedOrganization}`);
    if (ex.paymentRequest) facts.push('payment request');
    if (ex.credentialRequest) facts.push('OTP/password request');
    finishVision('completed', `Extracted ${input.message.length} chars${facts.length ? ' · ' + facts.join(' · ') : ''}`, ex.otherSuspicious);
  }

  let turns: ReturnType<typeof parseConversation> = [];
  if (req.inputType === 'conversation' && req.conversation) {
    turns = parseConversation(req.conversation);
    input.message = req.conversation;
    input.conversationTurns = Math.max(1, turns.length);
  }
  if (req.inputType === 'url' && req.url) {
    input.message = req.message ? `${req.message}\n${req.url}` : req.url;
  }

  // URL discovery: from text, vision output and the explicit url field.
  const urlSet = new Set<string>([...extractUrls(input.message), ...(input.extracted?.urls || []), ...(req.urls || []), ...(req.url ? [req.url] : [])]);
  input.urls = Array.from(urlSet).slice(0, LIMITS.maxUrlsInvestigated);

  // Email attachments: metadata only. Never downloaded or opened — surfaced as evidence for the user.
  if (input.email?.attachments.length) {
    const risky = input.email.attachments.filter((a) => a.risky);
    if (risky.length) {
      addIndicator(ctx, { id: 'risky_attachment', label: 'Risky attachment type', points: 12, evidence: risky.map((a) => a.name).join(', '), source: 'rule', agent: 'orchestrator' });
      addEvidence(ctx, { id: 'ev-risky_attachment', title: 'Attachment type commonly used for malware', description: `${risky.map((a) => a.name).join(', ')} — executable, script, archive or HTML attachments are a common malware and phishing delivery method. The attachment was not opened or analysed.`, source: 'rule', agent: 'orchestrator', severity: 'high' });
    } else {
      addEvidence(ctx, { id: 'ev-attachment', title: 'Attachment detected', description: `${input.email.attachments.map((a) => a.name).join(', ')} — attachments require separate analysis and were not opened.`, source: 'rule', agent: 'orchestrator', severity: 'low' });
    }
  }

  const plan: string[] = ['Message Agent'];
  if (input.urls.length) plan.push('URL Agent', 'Threat Intelligence');
  if (input.conversationTurns > 1) plan.push('Conversation Agent');
  const attachmentNote = input.email?.attachments.length ? `, ${input.email.attachments.length} attachment${input.email.attachments.length === 1 ? '' : 's'} (not opened)` : '';
  finishOrchestrator('completed', `Input understood (${input.inputType === 'email' ? 'Outlook email' : input.inputType}${input.urls.length ? `, ${input.urls.length} link${input.urls.length === 1 ? '' : 's'}` : ''}${input.conversationTurns > 1 ? `, ${input.conversationTurns} messages` : ''}${attachmentNote}) · initial plan: ${plan.join(' → ')}`);

  // ------------------------------------------------------------- INVESTIGATE
  // Stage 1: the Message Agent builds the shared understanding everything else uses.
  await runMessageAgent(ctx);

  // Stage 2: URL agent is deterministic and fast; run it before deciding on identity checks.
  if (input.urls.length) {
    await runUrlAgent(ctx);
  } else {
    skipAgent(ctx, 'url', 'URL Agent', 'no links found in the input');
  }

  // Stage 3: conditional agents, run in parallel where independent.
  const parallel: Promise<void>[] = [];

  const identity = identityCheckNeeded(ctx);
  if (identity.needed) parallel.push(runIdentityAgent(ctx));
  else skipAgent(ctx, 'identity', 'Identity Agent', identity.reason);

  const se = socialEngineeringNeeded(ctx);
  if (se.needed) parallel.push(runSocialEngineeringAgent(ctx));
  else skipAgent(ctx, 'social_engineering', 'Social Engineering Agent', se.reason);

  const fin = financialCheckNeeded(ctx);
  if (fin.needed) parallel.push(runFinancialAgent(ctx));
  else skipAgent(ctx, 'financial', 'Financial Risk Agent', fin.reason);

  if (input.conversationTurns > 1) parallel.push(runConversationAgent(ctx, turns));
  else if (req.inputType === 'conversation') skipAgent(ctx, 'conversation', 'Conversation Agent', 'only one message could be parsed — analysed as a single message');
  else skipAgent(ctx, 'conversation', 'Conversation Agent', 'single message — no multi-turn context');

  const intel = threatIntelNeeded(ctx);
  if (intel.needed) parallel.push(runThreatIntelAgent(ctx));
  else skipAgent(ctx, 'threat_intel', 'Threat Intelligence Agent', intel.reason);

  await Promise.all(parallel.map((p) => p.catch((err) => {
    console.error('[orchestrator] agent failed:', err);
    ctx.notices.push('One investigation step failed unexpectedly; results reflect the remaining agents.');
  })));

  // ---------------------------------------------------------------- ASSESS
  const risk = await runRiskAgent(ctx);
  const protection = await runProtectionAgent(ctx, risk.verdict);

  // ---------------------------------------------------------------- REPORT
  const engine: EngineMode = !isGeminiConfigured() ? 'deterministic' : ctx.aiCallsSucceeded === 0 ? 'deterministic' : ctx.aiFailures.length ? 'hybrid' : 'gemini';
  if (!isGeminiConfigured()) ctx.notices.unshift('Gemini API key not configured — running deterministic rules and external checks only.');
  else if (ctx.aiCallsSucceeded === 0 && ctx.aiFailures.length) ctx.notices.unshift(`AI analysis unavailable (${ctx.aiFailures[0].replace('_', ' ')}) — results are rule-based.`);
  else if (ctx.aiFailures.length) ctx.notices.push(`${ctx.aiFailures.length} AI step${ctx.aiFailures.length === 1 ? '' : 's'} fell back to rules (${Array.from(new Set(ctx.aiFailures)).join(', ').replace(/_/g, ' ')}).`);

  const report: InvestigationReport = {
    id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    engine,
    model: ctx.model,
    input,
    verdict: risk.verdict,
    indicators: ctx.indicators,
    whyFlagged: risk.whyFlagged,
    evidence: ctx.evidence,
    highlightPhrases: ctx.highlights,
    urls: ctx.urls,
    identity: ctx.identity,
    socialEngineering: ctx.socialEngineering,
    financial: ctx.financial,
    conversation: ctx.conversation,
    external: ctx.external,
    scamDna: risk.scamDna,
    protectionPlan: protection.plan,
    recommendedResponse: protection.recommendedResponse,
    trace: ctx.trace,
    agentsRun: ctx.agentsRun,
    agentsSkipped: ctx.agentsSkipped,
    notices: Array.from(new Set(ctx.notices)),
  };
  return report;
}

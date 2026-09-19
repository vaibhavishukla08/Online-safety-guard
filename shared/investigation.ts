/**
 * Shared contracts for the agentic investigation pipeline.
 * Imported by both the Express backend (server/) and the React frontend (src/).
 * Keep this file free of runtime dependencies.
 */

/** Four-level risk state shown throughout the UI. */
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Where a piece of evidence came from. Always surfaced to the user. */
export type EvidenceSource = 'rule' | 'ai' | 'external';

export type InputType = 'message' | 'url' | 'conversation' | 'screenshot' | 'email';

export type AgentId =
  | 'orchestrator'
  | 'vision'
  | 'message'
  | 'url'
  | 'identity'
  | 'social_engineering'
  | 'financial'
  | 'conversation'
  | 'threat_intel'
  | 'risk'
  | 'protection'
  | 'memory';

export type TraceStatus = 'running' | 'completed' | 'skipped' | 'unavailable' | 'failed';

/** One row in the AI Investigation Trace timeline. */
export interface TraceStep {
  id: string;
  agent: AgentId;
  title: string;
  /** Concise, user-safe summary of what the agent did. Never chain-of-thought. */
  summary: string;
  status: TraceStatus;
  timestamp: string;
  durationMs?: number;
  /** Optional short bullet details (evidence-level, not reasoning). */
  details?: string[];
}

/** A transparent scoring signal contributing to the final risk score. */
export interface RiskIndicator {
  id: string;
  label: string;
  points: number;
  evidence: string;
  source: EvidenceSource;
  agent: AgentId;
}

/** "Show Me Why" evidence card. */
export interface EvidenceItem {
  id: string;
  title: string;
  description: string;
  source: EvidenceSource;
  agent: AgentId;
  severity: 'low' | 'medium' | 'high';
}

export interface HighlightPhrase {
  text: string;
  category: 'danger' | 'warning' | 'suspicious_link';
  explanation: string;
}

export interface UrlFinding {
  raw: string;
  normalized: string;
  hostname: string;
  registrableDomain: string;
  tld: string;
  isIpAddress: boolean;
  suspiciousTld: boolean;
  hyphenCount: number;
  isShortener: boolean;
  hasCredentialKeywords: boolean;
  lookalikeOf?: string | null;
  subdomainDepth: number;
  flags: string[];
}

export interface IdentityFinding {
  claimedOrganization: string | null;
  organizationCategory: string | null;
  observedDomains: string[];
  observedSender: string | null;
  officialDomains: string[];
  /** true = observed domain/sender does not match the claimed organization. */
  mismatch: boolean;
  verdict: string;
  source: EvidenceSource;
}

export interface SocialEngineeringFinding {
  primaryTactics: string[];
  secondaryTactics: string[];
  attackerGoal: string;
  explanation: string;
  source: EvidenceSource;
}

export interface FinancialFinding {
  paymentRequested: boolean;
  credentialRequested: boolean;
  amounts: string[];
  paymentMethods: string[];
  credentialTypes: string[];
  summary: string;
  source: EvidenceSource;
}

export interface ConversationStage {
  stage: number;
  label: string;
  description: string;
  quote?: string;
}

export interface ConversationFinding {
  turnCount: number;
  scamType: string;
  stages: ConversationStage[];
  escalationPattern: string;
  manipulationTechniques: string[];
  recommendedResponse: string;
  source: EvidenceSource;
}

export type IntelStatus = 'ok' | 'not_configured' | 'unavailable' | 'error' | 'skipped';

export interface IntelSourceResult {
  source: string;
  status: IntelStatus;
  /** Human readable one-liner (e.g. "Registered 11 days ago"). */
  summary: string;
  data?: Record<string, unknown>;
  error?: string;
  fetchedAt?: string;
}

export interface ExternalEvidence {
  domain: string | null;
  domainAgeDays: number | null;
  registeredAt: string | null;
  threatReports: number | null;
  resolves: boolean | null;
  sources: IntelSourceResult[];
  /** Number of sources that actually returned data. */
  availableSources: number;
}

export interface ScamDna {
  urgency: number;
  impersonation: number;
  credentialTheft: number;
  paymentRequest: number;
  linkDeception: number;
  emotionalManipulation: number;
  fakeReward: number;
  authority: number;
}

export interface ProtectionPlan {
  immediateActions: string[];
  whatNotToDo: string[];
  accountProtection: string[];
  paymentProtection: string[];
  reporting: string[];
  evidencePreservation: string[];
  officialVerificationStep: string;
  source: EvidenceSource;
}

export interface Verdict {
  level: RiskLevel;
  riskScore: number;
  scamType: string;
  summary: string;
  confidence: 'low' | 'medium' | 'high';
  /** Short statement about certainty, e.g. "Two independent sources agree". */
  confidenceNote: string;
}

export interface ExtractedScreenshot {
  messageText: string;
  senderName: string | null;
  phoneNumber: string | null;
  emailAddress: string | null;
  urls: string[];
  claimedOrganization: string | null;
  platform: string | null;
  paymentRequest: string | null;
  credentialRequest: string | null;
  otherSuspicious: string[];
}

/** Attachment metadata only — attachments are never downloaded or opened. */
export interface EmailAttachmentMeta {
  name: string;
  size: number | null;
  contentType: string | null;
  /** True for extensions commonly used to deliver malware (exe, js, html, iso, …). */
  risky: boolean;
}

/** Email envelope captured from Outlook (Office.js) — only what analysis needs. */
export interface EmailEnvelope {
  subject: string;
  senderName: string | null;
  senderEmail: string | null;
  recipientCount: number | null;
  attachments: EmailAttachmentMeta[];
  /** Body was truncated client-side to stay within limits. */
  truncated: boolean;
}

export interface InvestigationInput {
  inputType: InputType;
  message: string;
  sender: string | null;
  platform: string | null;
  urls: string[];
  conversationTurns: number;
  extracted?: ExtractedScreenshot | null;
  /** Present for the Outlook email channel. */
  email?: EmailEnvelope | null;
}

export type EngineMode = 'gemini' | 'hybrid' | 'deterministic';

export interface InvestigationReport {
  id: string;
  timestamp: string;
  engine: EngineMode;
  model: string | null;
  input: InvestigationInput;
  verdict: Verdict;
  indicators: RiskIndicator[];
  whyFlagged: string[];
  evidence: EvidenceItem[];
  highlightPhrases: HighlightPhrase[];
  urls: UrlFinding[];
  identity: IdentityFinding | null;
  socialEngineering: SocialEngineeringFinding | null;
  financial: FinancialFinding | null;
  conversation: ConversationFinding | null;
  external: ExternalEvidence | null;
  scamDna: ScamDna;
  protectionPlan: ProtectionPlan;
  recommendedResponse: string;
  trace: TraceStep[];
  agentsRun: AgentId[];
  agentsSkipped: Array<{ agent: AgentId; reason: string }>;
  /** Non-fatal notices (e.g. "Gemini unavailable; deterministic analysis only"). */
  notices: string[];
}

/** NDJSON event emitted by the streaming investigation endpoint. */
export type InvestigationStreamEvent =
  | { type: 'trace'; step: TraceStep }
  | { type: 'result'; report: InvestigationReport }
  | { type: 'error'; message: string; code?: string };

// ---------------------------------------------------------------------------
// Incident response
// ---------------------------------------------------------------------------

export type InteractionAction =
  | 'clicked_link'
  | 'entered_password'
  | 'shared_otp'
  | 'sent_money'
  | 'downloaded_file'
  | 'replied';

export interface IncidentContext {
  scamType?: string;
  claimedOrganization?: string | null;
  organizationCategory?: string | null;
  level?: RiskLevel;
  paymentMethods?: string[];
  platform?: string | null;
  urls?: string[];
}

export interface IncidentPlan {
  headline: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  immediateActions: string[];
  accountProtection: string[];
  paymentProtection: string[];
  deviceProtection: string[];
  reporting: string[];
  evidencePreservation: string[];
  whatNotToDo: string[];
  source: EvidenceSource;
}

// ---------------------------------------------------------------------------
// Safety coach
// ---------------------------------------------------------------------------

export type CoachCategory =
  | 'phishing'
  | 'job_scam'
  | 'delivery_scam'
  | 'payment_scam'
  | 'government_impersonation'
  | 'account_takeover'
  | 'investment_scam'
  | 'otp_fraud'
  | 'legitimate';

export interface CoachOption {
  id: string;
  text: string;
  isCorrect: boolean;
  feedback: string;
}

export interface CoachScenario {
  id: string;
  category: CoachCategory;
  difficulty: 1 | 2 | 3;
  channel: string;
  sender: string;
  scenario: string;
  question: string;
  options: CoachOption[];
  redFlags: string[];
  lesson: string;
  source: EvidenceSource;
}

export interface CoachProgress {
  answered: number;
  correct: number;
  streak: number;
  /** category -> {attempts, correct} */
  byCategory: Record<string, { attempts: number; correct: number }>;
  recentMistakes: CoachCategory[];
  difficulty: 1 | 2 | 3;
}

// ---------------------------------------------------------------------------
// Dashboard / pattern memory (anonymized — never contains message text)
// ---------------------------------------------------------------------------

export interface PatternRecord {
  id: string;
  timestamp: string;
  level: RiskLevel;
  riskScore: number;
  scamType: string;
  inputType: InputType;
  indicatorIds: string[];
  tactics: string[];
  organizationCategory: string | null;
  hasUrl: boolean;
  suspiciousUrl: boolean;
  credentialRequested: boolean;
  paymentRequested: boolean;
}

export interface DashboardStats {
  messagesAnalyzed: number;
  highRisk: number;
  suspiciousUrls: number;
  phishingAttempts: number;
  credentialAttacks: number;
  financialScams: number;
  mostCommonScamType: string | null;
  mostCommonTactic: string | null;
  recurringPatterns: Array<{ label: string; count: number; indicatorIds: string[] }>;
}

import type { InvestigationReport } from '../shared/investigation';

export type {
  InvestigationReport,
  InvestigationStreamEvent,
  TraceStep,
  RiskLevel,
  RiskIndicator,
  EvidenceItem,
  EvidenceSource,
  AgentId,
  InputType,
  ScamDna,
  ProtectionPlan,
  IncidentPlan,
  InteractionAction,
  IncidentContext,
  CoachScenario,
  CoachProgress,
  CoachCategory,
  PatternRecord,
  DashboardStats,
} from '../shared/investigation';

export type SafetyStatus = 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS_SCAM';

export interface RedFlag {
  flag: string;
  evidence: string;
  severity: 'high' | 'medium' | 'low';
}

export interface HighlightPhrase {
  text: string;
  category: 'danger' | 'warning' | 'suspicious_link';
  explanation: string;
}

export interface SafetyAdvice {
  immediateActions: string[];
  whatNeverToDo: string[];
  officialVerificationStep: string;
}

export interface SenderAssessment {
  isSenderSuspicious: boolean;
  notes: string;
}

/**
 * Stored scan record. Legacy scans (from the original single-shot analyzer) have
 * only the flat fields; agentic investigations additionally carry `investigation`.
 */
export interface AnalysisResult {
  id: string;
  timestamp: string;
  originalMessage: string;
  sender?: string;
  platform?: string;
  safetyStatus: SafetyStatus;
  riskScore: number;
  scamType: string;
  verdictSummary: string;
  redFlags: RedFlag[];
  tacticsUsed: string[];
  highlightPhrases: HighlightPhrase[];
  safetyAdvice: SafetyAdvice;
  recommendedResponse: string;
  senderAssessment: SenderAssessment;
  engine?: string;
  /** Full agentic investigation report (absent on legacy history entries). */
  investigation?: InvestigationReport;
}

export interface PresetMessage {
  id: string;
  title: string;
  category: string;
  platform: string;
  sender: string;
  text: string;
  expectedRisk: 'SAFE' | 'DANGEROUS';
  badge: string;
}

export interface DomainInspectionResult {
  domain: string;
  fullUrl: string;
  isSuspicious: boolean;
  threatLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  spoofedBrand?: string | null;
  reason: string;
  officialDomain?: string | null;
}

/** Top-level navigation destinations. */
export type AppTab = 'home' | 'investigate' | 'domain' | 'incident' | 'coach' | 'dashboard' | 'history';

/** Input modes of the Investigation Console. */
export type InvestigateMode = 'message' | 'screenshot' | 'url' | 'conversation';

/** Pre-filled request handed to the console (from Home / Demo / Link Inspector). */
export interface InvestigationSeed {
  mode: InvestigateMode;
  message?: string;
  sender?: string;
  platform?: string;
  url?: string;
  conversation?: string;
  /** Run immediately without waiting for the user to press the button. */
  autoRun?: boolean;
  /** Human-readable label for the demo card that triggered this seed. */
  demoTitle?: string;
}

/** Convert an agentic report to the legacy shape so history and older views keep working. */
export function reportToAnalysisResult(report: InvestigationReport): AnalysisResult {
  const level = report.verdict.level;
  const safetyStatus: SafetyStatus = level === 'CRITICAL' || level === 'HIGH' ? 'DANGEROUS_SCAM' : level === 'MEDIUM' ? 'SUSPICIOUS' : 'SAFE';
  return {
    id: report.id,
    timestamp: report.timestamp,
    originalMessage: report.input.message || '(Screenshot analysis)',
    sender: report.input.sender || undefined,
    platform: report.input.platform || undefined,
    safetyStatus,
    riskScore: report.verdict.riskScore,
    scamType: report.verdict.scamType,
    verdictSummary: report.verdict.summary,
    redFlags: report.evidence.map((e) => ({ flag: e.title, evidence: e.description, severity: e.severity })),
    tacticsUsed: [...(report.socialEngineering?.primaryTactics || []), ...(report.socialEngineering?.secondaryTactics || [])],
    highlightPhrases: report.highlightPhrases,
    safetyAdvice: {
      immediateActions: report.protectionPlan.immediateActions,
      whatNeverToDo: report.protectionPlan.whatNotToDo,
      officialVerificationStep: report.protectionPlan.officialVerificationStep,
    },
    recommendedResponse: report.recommendedResponse,
    senderAssessment: {
      isSenderSuspicious: report.indicators.some((i) => i.id === 'sender_anomaly') || Boolean(report.identity?.mismatch),
      notes: report.identity?.verdict || 'No sender anomaly established.',
    },
    engine: report.engine === 'gemini' ? 'gemini-3.8-flash' : report.engine,
    investigation: report,
  };
}

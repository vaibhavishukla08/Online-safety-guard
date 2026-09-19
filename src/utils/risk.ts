/**
 * UI metadata for risk levels, evidence sources and agents.
 * Keeps colour/icon decisions in one place so every panel reads consistently.
 */
import {
  Brain,
  Database,
  Drama,
  Fingerprint,
  Gauge,
  Link2,
  MessagesSquare,
  Radar,
  ScanEye,
  ShieldCheck,
  Wallet,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { AgentId, EvidenceSource, RiskLevel } from '../types';

export interface LevelTokens {
  label: string;
  text: string;
  bg: string;
  border: string;
  solid: string;
  bar: string;
  ring: string;
}

export const LEVEL_TOKENS: Record<RiskLevel, LevelTokens> = {
  LOW: {
    label: 'Low risk',
    text: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-50 dark:bg-emerald-500/10',
    border: 'border-emerald-300 dark:border-emerald-500/40',
    solid: 'bg-emerald-600',
    bar: 'from-emerald-500 to-teal-500',
    ring: 'ring-emerald-500/30',
  },
  MEDIUM: {
    label: 'Medium risk',
    text: 'text-amber-800 dark:text-amber-300',
    bg: 'bg-amber-50 dark:bg-amber-500/10',
    border: 'border-amber-300 dark:border-amber-500/40',
    solid: 'bg-amber-500',
    bar: 'from-amber-500 to-yellow-400',
    ring: 'ring-amber-500/30',
  },
  HIGH: {
    label: 'High risk',
    text: 'text-orange-800 dark:text-orange-300',
    bg: 'bg-orange-50 dark:bg-orange-500/10',
    border: 'border-orange-300 dark:border-orange-500/40',
    solid: 'bg-orange-600',
    bar: 'from-orange-500 to-rose-500',
    ring: 'ring-orange-500/30',
  },
  CRITICAL: {
    label: 'Critical risk',
    text: 'text-rose-800 dark:text-rose-300',
    bg: 'bg-rose-50 dark:bg-rose-500/10',
    border: 'border-rose-300 dark:border-rose-500/40',
    solid: 'bg-rose-600',
    bar: 'from-rose-600 to-red-500',
    ring: 'ring-rose-500/30',
  },
};

export function levelForScore(score: number): RiskLevel {
  if (score >= 75) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 25) return 'MEDIUM';
  return 'LOW';
}

export const SOURCE_TOKENS: Record<EvidenceSource, { label: string; className: string; description: string }> = {
  rule: {
    label: 'Rule-based',
    className: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600',
    description: 'Deterministic pattern check — reproducible and independent of the AI model.',
  },
  ai: {
    label: 'AI interpretation',
    className: 'bg-violet-50 text-violet-800 border-violet-300 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/40',
    description: 'Produced by Gemini from the message context. Bounded in how much it can move the score.',
  },
  external: {
    label: 'External source',
    className: 'bg-cyan-50 text-cyan-800 border-cyan-300 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/40',
    description: 'Retrieved from a third-party intelligence service (RDAP, DNS, VirusTotal…).',
  },
};

export interface AgentMeta {
  label: string;
  icon: LucideIcon;
  /** Tailwind classes for the icon chip. */
  chip: string;
  description: string;
}

export const AGENT_META: Record<AgentId, AgentMeta> = {
  orchestrator: { label: 'Safety Orchestrator', icon: Workflow, chip: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100', description: 'Understands the input and decides which agents to run.' },
  vision: { label: 'Vision Agent', icon: ScanEye, chip: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300', description: 'Extracts text, sender, links and requests from screenshots.' },
  message: { label: 'Message Agent', icon: Brain, chip: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300', description: 'Detects pressure, requests and claims in the text.' },
  url: { label: 'URL Agent', icon: Link2, chip: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300', description: 'Inspects link structure offline — never opens the link.' },
  identity: { label: 'Identity Agent', icon: Fingerprint, chip: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300', description: 'Compares the claimed organization with observed domains.' },
  social_engineering: { label: 'Social Engineering Agent', icon: Drama, chip: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300', description: 'Profiles the psychological tactics in use.' },
  financial: { label: 'Financial Risk Agent', icon: Wallet, chip: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300', description: 'Assesses money and credential exposure.' },
  conversation: { label: 'Conversation Agent', icon: MessagesSquare, chip: 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300', description: 'Analyses multi-message exchanges for scam progression.' },
  threat_intel: { label: 'Threat Intelligence Agent', icon: Radar, chip: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300', description: 'Queries external reputation and registration sources.' },
  risk: { label: 'Risk Assessment Agent', icon: Gauge, chip: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300', description: 'Fuses evidence into a transparent score.' },
  protection: { label: 'Protection Agent', icon: ShieldCheck, chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300', description: 'Generates the personalized protection plan.' },
  memory: { label: 'Pattern Memory', icon: Database, chip: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300', description: 'Compares with anonymized patterns from earlier scans on this device.' },
};

export const ENGINE_LABEL: Record<string, string> = {
  gemini: 'Gemini 3.8 Flash + rules',
  hybrid: 'Rules + partial AI',
  deterministic: 'Rules only (AI unavailable)',
};

export function formatClock(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

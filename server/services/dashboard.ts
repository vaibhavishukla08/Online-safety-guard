/**
 * Personal Safety Dashboard — AI summary of anonymized aggregate stats.
 * The client sends only counts and category names (never message text).
 */
import { Type } from '@google/genai';
import { generateJson } from '../gemini/client';
import type { DashboardStats } from '../../shared/investigation';

export function templateSummary(stats: DashboardStats): string {
  if (!stats.messagesAnalyzed) return 'No scans yet. Investigate a message, link, screenshot or conversation to start building your safety profile.';
  const parts: string[] = [];
  parts.push(`Across ${stats.messagesAnalyzed} scan${stats.messagesAnalyzed === 1 ? '' : 's'}, ${stats.highRisk} ${stats.highRisk === 1 ? 'was' : 'were'} high or critical risk.`);
  if (stats.mostCommonScamType) parts.push(`The most common threat is ${stats.mostCommonScamType.toLowerCase()}${stats.mostCommonTactic ? `, typically using ${stats.mostCommonTactic.toLowerCase()}` : ''}.`);
  if (stats.recurringPatterns.length) parts.push(`Recurring pattern: ${stats.recurringPatterns[0].label.toLowerCase()} (seen ${stats.recurringPatterns[0].count} times).`);
  return parts.join(' ');
}

export async function generateDashboardSummary(stats: DashboardStats): Promise<{ summary: string; source: 'ai' | 'rule' }> {
  if (!stats.messagesAnalyzed) return { summary: templateSummary(stats), source: 'rule' };
  const result = await generateJson<{ summary: string }>({
    systemInstruction: 'You write short, plain-language safety summaries for a personal dashboard. Two sentences maximum. Mention the dominant pattern and one practical habit.',
    prompt: `Anonymized statistics: ${JSON.stringify(stats)}\nWrite the summary.`,
    schema: { type: Type.OBJECT, properties: { summary: { type: Type.STRING } }, required: ['summary'] },
    temperature: 0.4,
  });
  if (result.ok && typeof result.data.summary === 'string' && result.data.summary.trim()) return { summary: result.data.summary.trim(), source: 'ai' };
  return { summary: templateSummary(stats), source: 'rule' };
}

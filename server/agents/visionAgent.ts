/**
 * Vision Agent — turns a screenshot into structured, investigable data.
 * Requires Gemini (multimodal). When unavailable the orchestrator reports that
 * clearly instead of guessing.
 */
import { Type } from '@google/genai';
import { generateJson } from '../gemini/client';
import { TIMEOUTS } from '../config';
import type { ExtractedScreenshot } from '../../shared/investigation';
import type { GeminiResult } from '../gemini/client';

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    messageText: { type: Type.STRING, description: 'The full message body exactly as written, preserving line breaks.' },
    senderName: { type: Type.STRING, description: 'Sender display name or handle, or empty string.' },
    phoneNumber: { type: Type.STRING, description: 'Phone number if visible, or empty string.' },
    emailAddress: { type: Type.STRING, description: 'Email address if visible, or empty string.' },
    urls: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Every URL or domain visible, exactly as shown.' },
    claimedOrganization: { type: Type.STRING, description: 'Organization the message claims to be from, or empty string.' },
    platform: { type: Type.STRING, description: "Interface detected: 'SMS / Text', 'Email / Inbox', 'WhatsApp', 'Instagram DM', 'Telegram', 'LinkedIn', or 'Other App'." },
    paymentRequest: { type: Type.STRING, description: 'Any payment/fee/transfer requested, quoted, or empty string.' },
    credentialRequest: { type: Type.STRING, description: 'Any OTP/password/PIN/card request, quoted, or empty string.' },
    otherSuspicious: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Other notable elements (attachments, QR codes, deadlines, threats).' },
  },
  required: ['messageText', 'senderName', 'phoneNumber', 'emailAddress', 'urls', 'claimedOrganization', 'platform', 'paymentRequest', 'credentialRequest', 'otherSuspicious'],
};

export async function runVisionAgent(image: { base64: string; mimeType: string }): Promise<GeminiResult<ExtractedScreenshot>> {
  const result = await generateJson<Record<string, unknown>>({
    systemInstruction: 'You are the Vision Agent of a cyber-safety investigation system. Extract facts from screenshots precisely. Never invent text that is not visible. Quote exactly.',
    prompt: `Inspect this screenshot of a message, email, chat or notification. Extract the structured facts requested by the schema. If a field is not visible, return an empty string or empty array.`,
    schema: SCHEMA,
    image,
    timeoutMs: TIMEOUTS.geminiVision,
    temperature: 0.1,
  });

  if (!result.ok) return result;
  const d = result.data;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : []);

  return {
    ok: true,
    model: result.model,
    data: {
      messageText: str(d.messageText) || '',
      senderName: str(d.senderName),
      phoneNumber: str(d.phoneNumber),
      emailAddress: str(d.emailAddress),
      urls: arr(d.urls).slice(0, 8),
      claimedOrganization: str(d.claimedOrganization),
      platform: str(d.platform),
      paymentRequest: str(d.paymentRequest),
      credentialRequest: str(d.credentialRequest),
      otherSuspicious: arr(d.otherSuspicious).slice(0, 6),
    },
  };
}

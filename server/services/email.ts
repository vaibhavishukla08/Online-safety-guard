/**
 * Outlook email channel — maps an email captured by the Office.js task pane into
 * the existing investigation request. No analysis logic lives here: the Safety
 * Orchestrator and the existing agents do all the work.
 *
 * Security: only the envelope + body text arrive here. Attachments are metadata
 * only (never downloaded), email bodies are never logged, and nothing is stored.
 */
import { LIMITS } from '../config';
import { InvestigationError, type InvestigationRequest } from '../agents/orchestrator';
import { normalizeUrl } from '../utils/url';
import type { EmailAttachmentMeta, EmailEnvelope } from '../../shared/investigation';

/** Extensions frequently used to deliver malware or credential-harvesting pages. */
const RISKY_EXTENSIONS = new Set(['exe', 'scr', 'bat', 'cmd', 'com', 'pif', 'msi', 'js', 'jse', 'vbs', 'vbe', 'wsf', 'ps1', 'hta', 'jar', 'iso', 'img', 'lnk', 'html', 'htm', 'shtml', 'svg', 'apk', 'dmg', 'zip', 'rar', '7z', 'one', 'docm', 'xlsm', 'pptm']);

export interface EmailAnalysisBody {
  subject?: unknown;
  sender?: unknown;
  senderEmail?: unknown;
  body?: unknown;
  urls?: unknown;
  recipientCount?: unknown;
  attachments?: unknown;
  truncated?: unknown;
}

export interface EmailRequest {
  request: InvestigationRequest;
  envelope: EmailEnvelope;
}

const str = (v: unknown, max: number, name: string): string => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new InvestigationError(400, `${name} must be a string.`, 'bad_request');
  if (v.length > max) throw new InvestigationError(413, `${name} is too long (max ${max.toLocaleString()} characters).`, 'too_large');
  return v.trim();
};

export function isRiskyAttachment(name: string): boolean {
  const ext = name.toLowerCase().split('.').pop() || '';
  return RISKY_EXTENSIONS.has(ext);
}

/** Validate the task-pane payload and build the request for the existing orchestrator. */
export function emailToInvestigationRequest(raw: unknown): EmailRequest {
  if (!raw || typeof raw !== 'object') throw new InvestigationError(400, 'Request body must be a JSON object.', 'bad_request');
  const b = raw as EmailAnalysisBody;

  const subject = str(b.subject, 500, 'subject');
  const senderName = str(b.sender, LIMITS.senderChars, 'sender');
  const senderEmail = str(b.senderEmail, LIMITS.senderChars, 'senderEmail');
  const body = str(b.body, LIMITS.messageChars, 'body');

  if (!subject && !body) throw new InvestigationError(400, 'This email has no readable subject or body to analyse.', 'empty_input');

  const urls = (Array.isArray(b.urls) ? b.urls : [])
    .filter((u): u is string => typeof u === 'string' && u.length <= LIMITS.urlChars)
    .map((u) => u.trim())
    .filter((u) => normalizeUrl(u) !== null)
    .slice(0, LIMITS.maxUrlsInvestigated);

  const attachments: EmailAttachmentMeta[] = (Array.isArray(b.attachments) ? b.attachments : [])
    .slice(0, 20)
    .map((a) => {
      const r = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
      const name = typeof r.name === 'string' ? r.name.slice(0, 200) : 'unnamed';
      return {
        name,
        size: typeof r.size === 'number' && Number.isFinite(r.size) ? Math.max(0, Math.floor(r.size)) : null,
        contentType: typeof r.contentType === 'string' ? r.contentType.slice(0, 100) : null,
        risky: isRiskyAttachment(name),
      };
    });

  const envelope: EmailEnvelope = {
    subject,
    senderName: senderName || null,
    senderEmail: senderEmail || null,
    recipientCount: typeof b.recipientCount === 'number' && Number.isFinite(b.recipientCount) ? Math.max(0, Math.floor(b.recipientCount)) : null,
    attachments,
    truncated: Boolean(b.truncated),
  };

  // Sender as "Name <address>" so the Identity Agent can read the email domain.
  const sender = senderEmail ? (senderName ? `${senderName} <${senderEmail}>` : senderEmail) : senderName || undefined;
  const message = subject ? `Subject: ${subject}\n\n${body}`.trim() : body;

  return {
    request: {
      inputType: 'email',
      message: message.slice(0, LIMITS.messageChars),
      sender,
      platform: 'Email / Inbox',
      urls,
      email: envelope,
    },
    envelope,
  };
}

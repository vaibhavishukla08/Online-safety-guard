/**
 * Reads the currently opened email through Office.js.
 *
 * Only the fields analysis needs are read (subject, sender, body text, recipient
 * count, attachment metadata). The mailbox is never enumerated and attachments
 * are never downloaded. The item is injectable so the logic is unit-testable
 * outside Outlook.
 */

/** Client-side body cap — keeps well inside the server limit after the subject is added. */
export const MAX_BODY_CHARS = 10_000;

export interface EmailPayload {
  subject: string;
  sender: string;
  senderEmail: string;
  body: string;
  urls: string[];
  recipientCount: number | null;
  attachments: Array<{ name: string; size: number | null; contentType: string | null }>;
  truncated: boolean;
}

export type ReadEmailResult = { ok: true; email: EmailPayload } | { ok: false; code: 'no_office' | 'no_item' | 'not_message' | 'body_failed' | 'empty'; message: string };

/** Office.js is available only when the page is hosted by Outlook. */
export function officeAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.Office !== 'undefined' && Boolean(window.Office?.context?.mailbox);
}

/** Wait for Office.onReady with a timeout so a broken host never hangs the pane. */
export function waitForOffice(timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof window.Office === 'undefined') {
      resolve(false);
      return;
    }
    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => done(officeAvailable()), timeoutMs);
    try {
      window.Office.onReady(() => {
        clearTimeout(timer);
        done(officeAvailable());
      });
    } catch {
      clearTimeout(timer);
      done(false);
    }
  });
}

/** Lightweight URL extraction for the client hint; the server re-extracts authoritatively. */
export function extractUrlsFromText(text: string): string[] {
  const found = new Set<string>();
  const re = /\b((?:https?:\/\/|www\.)[^\s<>"'`)\]]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|in|co|io|xyz|top|cc|buzz|club|link|info|online|shop|live|site|app|me|ly|gl|tk|ml|ga|cf|gq|zip|mov|uk|us|de|fr|au|ca|sg|ae)(?:\/[^\s<>"'`)\]]*)?)/gi;
  for (const m of text.match(re) || []) {
    const cleaned = m.replace(/[.,;:!?)]+$/g, '');
    if (cleaned.includes('@')) continue;
    found.add(cleaned);
    if (found.size >= 10) break;
  }
  return Array.from(found);
}

function getBodyText(item: Office.MessageRead): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    try {
      item.body.getAsync('text', (result) => {
        if (result.status === 'succeeded' || String(result.status) === 'succeeded') {
          resolve({ ok: true, text: typeof result.value === 'string' ? result.value : '' });
        } else {
          resolve({ ok: false, message: result.error?.message || 'Outlook did not return the email body.' });
        }
      });
    } catch (err) {
      resolve({ ok: false, message: err instanceof Error ? err.message : 'Outlook body access failed.' });
    }
  });
}

/**
 * Read the currently opened message. Pass an item explicitly for tests;
 * defaults to Office.context.mailbox.item.
 */
export async function readCurrentEmail(item?: Office.MessageRead | null): Promise<ReadEmailResult> {
  const target = item === undefined ? (officeAvailable() ? window.Office?.context?.mailbox?.item ?? null : null) : item;
  if (item === undefined && !officeAvailable()) {
    return { ok: false, code: 'no_office', message: 'Office.js is not available — open this pane from inside Outlook.' };
  }
  if (!target) {
    return { ok: false, code: 'no_item', message: 'No email is open. Select or open a message, then try again.' };
  }
  if (target.itemType && String(target.itemType).toLowerCase() !== 'message') {
    return { ok: false, code: 'not_message', message: 'Only email messages can be analysed (this item is not a message).' };
  }

  const bodyResult = await getBodyText(target);
  if (!bodyResult.ok) return { ok: false, code: 'body_failed', message: bodyResult.message };

  const subject = (target.subject || '').trim();
  const rawBody = bodyResult.text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!subject && !rawBody) return { ok: false, code: 'empty', message: 'This email has no readable subject or body.' };

  const truncated = rawBody.length > MAX_BODY_CHARS;
  const body = truncated ? rawBody.slice(0, MAX_BODY_CHARS) : rawBody;
  const from = target.from || target.sender;
  const attachments = (target.attachments || [])
    .filter((a) => !a.isInline)
    .slice(0, 20)
    .map((a) => ({ name: a.name || 'unnamed', size: typeof a.size === 'number' ? a.size : null, contentType: a.contentType || null }));

  return {
    ok: true,
    email: {
      subject,
      sender: from?.displayName?.trim() || '',
      senderEmail: from?.emailAddress?.trim() || '',
      body,
      urls: extractUrlsFromText(`${subject}\n${body}`),
      recipientCount: Array.isArray(target.to) ? target.to.length + (Array.isArray(target.cc) ? target.cc.length : 0) : null,
      attachments,
      truncated,
    },
  };
}

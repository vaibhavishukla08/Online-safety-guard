/**
 * "I Already Interacted" — incident response planning.
 *
 * A deterministic plan is composed from per-action playbooks (always available),
 * then Gemini tailors it to the specific scam context when configured.
 */
import { Type } from '@google/genai';
import { generateJson } from '../gemini/client';
import type { IncidentContext, IncidentPlan, InteractionAction } from '../../shared/investigation';

export const INTERACTION_ACTIONS: InteractionAction[] = ['clicked_link', 'entered_password', 'shared_otp', 'sent_money', 'downloaded_file', 'replied'];

interface Playbook {
  urgency: IncidentPlan['urgency'];
  immediateActions: string[];
  accountProtection: string[];
  paymentProtection: string[];
  deviceProtection: string[];
  evidencePreservation: string[];
  whatNotToDo: string[];
}

function playbookFor(action: InteractionAction, ctx: IncidentContext, india: boolean): Playbook {
  const org = ctx.claimedOrganization || 'the organization';
  switch (action) {
    case 'clicked_link':
      return {
        urgency: 'medium',
        immediateActions: ['Close the page immediately and do not enter anything if it is still open.', 'Check your downloads folder for any file that appeared after clicking; delete it without opening.'],
        accountProtection: ['If the page asked you to log in and you did not, no password change is required — but stay alert for follow-up messages.'],
        paymentProtection: [],
        deviceProtection: ['Run a full scan with your device’s built-in security (Play Protect / Windows Security / XProtect).', 'Clear the browser’s site data for that domain.', 'On Android, review recently installed apps and remove anything you did not choose to install.'],
        evidencePreservation: ['Copy the exact link you clicked (without opening it again).'],
        whatNotToDo: ['Do not revisit the page to "check" it.', 'Do not approve any permission or notification prompts from that site.'],
      };
    case 'entered_password':
      return {
        urgency: 'high',
        immediateActions: [`Change the password now — from inside the official ${org} app or by typing the site address yourself.`, 'If you reused that password anywhere else, change it on those services too, starting with email.'],
        accountProtection: ['Sign out of all other sessions/devices from the account’s security settings.', 'Enable two-factor authentication with an authenticator app (not SMS if you can avoid it).', 'Check that the recovery email and phone number on the account are still yours.', 'Review recent login activity and any new forwarding rules, linked apps or API tokens.'],
        paymentProtection: [`If ${org} holds payment methods, check recent transactions and set up alerts.`],
        deviceProtection: ['Make sure the device you used is up to date and run a security scan.'],
        evidencePreservation: ['Note the time you entered the password and the exact site address.'],
        whatNotToDo: ['Do not change the password through any link in the original message.', 'Do not ignore login-alert emails from the real service in the next few days.'],
      };
    case 'shared_otp':
      return {
        urgency: 'critical',
        immediateActions: [india ? `Call ${org === 'the organization' ? 'your bank' : org}’s official helpline (number on your card/app) or 1930 right now and ask them to block the transaction or account.` : `Call ${org === 'the organization' ? 'your bank' : org}’s official fraud line (number on your card/app) right now and ask them to freeze the account.`, 'Change the password of the account the OTP belonged to, from the official app.'],
        accountProtection: ['Assume the attacker is inside the account: sign out all sessions and re-enable two-factor authentication.', 'Check for changed contact details, new payees, added devices or SIM-swap requests.'],
        paymentProtection: ['Ask the bank to reverse or hold any transaction made in the last hour.', 'Check every linked wallet and UPI app for unauthorized payments or pending collect requests.', 'Temporarily reduce card and transfer limits.'],
        deviceProtection: ['If the OTP came via SMS, check that your SIM still has service — a lost signal can indicate SIM swap.'],
        evidencePreservation: ['Save the OTP message, the sender number and the exact time you shared the code.', 'Keep any transaction alerts you receive.'],
        whatNotToDo: ['Do not share any further codes, even if the caller says the first one "failed".', 'Do not install any "support" or "refund" app you are told to install.'],
      };
    case 'sent_money':
      return {
        urgency: 'critical',
        immediateActions: [india ? 'Call 1930 (national cyber-fraud helpline) and your bank immediately — the first hour matters most for freezing funds.' : 'Call your bank or payment provider immediately and ask for a recall, chargeback or fraud hold — the first hour matters most.', 'Contact the receiving platform (UPI app, wallet, exchange) to report the recipient account.'],
        accountProtection: ['Change your banking/UPI password and PIN if you entered them on any page or app the scammer provided.'],
        paymentProtection: [india ? 'File a complaint at cybercrime.gov.in — a police acknowledgement is usually needed for the bank to act.' : 'File a police / fraud report (IC3.gov, ReportFraud.ftc.gov, Action Fraud) — banks often require a report number.', 'If you paid by card, request a chargeback; if by gift card or crypto, report the codes/wallet anyway so they can be tracked.', 'Freeze the card or account used to pay until the bank confirms it is safe.'],
        deviceProtection: [],
        evidencePreservation: ['Save transaction IDs, UTR/UPI references, receipts and the recipient’s name, account or wallet address.', 'Screenshot the entire conversation, including the payment request.'],
        whatNotToDo: ['Do not pay again to "unlock" or "refund" the first payment — that is the follow-on scam.', 'Do not engage with anyone who contacts you offering recovery services for a fee.'],
      };
    case 'downloaded_file':
      return {
        urgency: 'high',
        immediateActions: ['Do not open the file. Delete it from downloads and empty the trash.', 'If you already opened or installed it, disconnect from the internet and run a full security scan.'],
        accountProtection: ['From a different, trusted device, change passwords for email, banking and any account used on the affected device.', 'Enable two-factor authentication and sign out other sessions.'],
        paymentProtection: ['Check bank and card statements for unfamiliar charges over the next weeks.'],
        deviceProtection: ['On Android: Settings → Apps → look for unknown apps or apps with Accessibility/SMS permissions; uninstall them (use Safe Mode if needed).', 'On Windows/Mac: run a full scan; if the file was an installer or script, consider a professional clean-up or factory reset.', 'Revoke any "device admin" or accessibility permissions granted recently.'],
        evidencePreservation: ['Note the file name, size and the link or message it came from.'],
        whatNotToDo: ['Do not open the file "just to see what it is".', 'Do not log in to bank or email on the affected device until it is scanned.'],
      };
    case 'replied':
      return {
        urgency: 'low',
        immediateActions: ['Stop replying. Block the sender and do not answer follow-ups from new numbers.'],
        accountProtection: ['If you shared any personal details, watch for targeted follow-up messages that use them.'],
        paymentProtection: [],
        deviceProtection: [],
        evidencePreservation: ['Keep the thread; it helps if the sender escalates.'],
        whatNotToDo: ['Do not try to "waste their time" — engaged targets get re-targeted.', 'Do not share any further personal information, photos or documents.'],
      };
  }
}

function isIndianContext(ctx: IncidentContext): boolean {
  const text = `${ctx.claimedOrganization || ''} ${(ctx.paymentMethods || []).join(' ')} ${(ctx.urls || []).join(' ')}`;
  return /upi|paytm|phonepe|sbi|hdfc|icici|aadhaar|\.in\b|₹/i.test(text);
}

const URGENCY_RANK: Record<IncidentPlan['urgency'], number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function buildBaseIncidentPlan(actions: InteractionAction[], ctx: IncidentContext): IncidentPlan {
  const india = isIndianContext(ctx);
  const merged: IncidentPlan = { headline: '', urgency: 'low', immediateActions: [], accountProtection: [], paymentProtection: [], deviceProtection: [], reporting: [], evidencePreservation: [], whatNotToDo: [], source: 'rule' };
  const push = (target: string[], items: string[]) => { for (const i of items) if (!target.includes(i)) target.push(i); };

  // Highest-urgency actions first so the most critical steps lead the list.
  const ordered = [...actions].sort((a, b) => URGENCY_RANK[playbookFor(b, ctx, india).urgency] - URGENCY_RANK[playbookFor(a, ctx, india).urgency]);
  for (const action of ordered) {
    const pb = playbookFor(action, ctx, india);
    if (URGENCY_RANK[pb.urgency] > URGENCY_RANK[merged.urgency]) merged.urgency = pb.urgency;
    push(merged.immediateActions, pb.immediateActions);
    push(merged.accountProtection, pb.accountProtection);
    push(merged.paymentProtection, pb.paymentProtection);
    push(merged.deviceProtection, pb.deviceProtection);
    push(merged.evidencePreservation, pb.evidencePreservation);
    push(merged.whatNotToDo, pb.whatNotToDo);
  }

  if (india) {
    merged.reporting.push('Report at cybercrime.gov.in or call 1930 (financial fraud helpline).', 'Report the number via the Sanchar Saathi "Chakshu" portal; forward scam SMS to 1909.');
  } else {
    merged.reporting.push('Report at ReportFraud.ftc.gov / IC3.gov (US) or Action Fraud (UK); forward scam texts to 7726.');
  }
  if (ctx.claimedOrganization) merged.reporting.push(`Tell ${ctx.claimedOrganization}'s official fraud team that their name was used.`);
  if (ctx.platform && /whatsapp|instagram|telegram|linkedin/i.test(ctx.platform)) merged.reporting.push(`Report the account in-app on ${ctx.platform}.`);

  const labels: Record<InteractionAction, string> = { clicked_link: 'clicked the link', entered_password: 'entered a password', shared_otp: 'shared an OTP', sent_money: 'sent money', downloaded_file: 'downloaded a file', replied: 'replied to the sender' };
  merged.headline = `You ${ordered.map((a) => labels[a]).join(', ')} — ${merged.urgency === 'critical' ? 'act in the next few minutes' : merged.urgency === 'high' ? 'act now' : merged.urgency === 'medium' ? 'take these precautions today' : 'low exposure, stay alert'}.`;
  return merged;
}

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    headline: { type: Type.STRING },
    immediateActions: { type: Type.ARRAY, items: { type: Type.STRING } },
    accountProtection: { type: Type.ARRAY, items: { type: Type.STRING } },
    paymentProtection: { type: Type.ARRAY, items: { type: Type.STRING } },
    deviceProtection: { type: Type.ARRAY, items: { type: Type.STRING } },
    reporting: { type: Type.ARRAY, items: { type: Type.STRING } },
    evidencePreservation: { type: Type.ARRAY, items: { type: Type.STRING } },
    whatNotToDo: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['headline', 'immediateActions', 'accountProtection', 'paymentProtection', 'deviceProtection', 'reporting', 'evidencePreservation', 'whatNotToDo'],
};

export async function generateIncidentPlan(actions: InteractionAction[], ctx: IncidentContext): Promise<IncidentPlan> {
  const base = buildBaseIncidentPlan(actions, ctx);
  const result = await generateJson<Omit<IncidentPlan, 'urgency' | 'source'>>({
    systemInstruction: 'You are the Incident Response Agent of a cyber-safety system. Tailor the draft plan to the user’s exact situation. Keep every step safe, specific and actionable in one sentence. Never suggest contacting the scammer, revisiting the link, or paying anything. Keep the given reporting channels.',
    prompt: `User actions: ${actions.join(', ')}.
Context: ${JSON.stringify({ scamType: ctx.scamType, organization: ctx.claimedOrganization, category: ctx.organizationCategory, risk: ctx.level, paymentMethods: ctx.paymentMethods, platform: ctx.platform, domains: (ctx.urls || []).slice(0, 3) })}
Draft plan to tailor (keep sections, 2–5 items each, keep reporting channels): ${JSON.stringify(base)}`,
    schema: SCHEMA,
    temperature: 0.3,
  });

  if (!result.ok) return base;
  const d = result.data;
  const list = (v: unknown, fallback: string[]) => (Array.isArray(v) && v.length ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 6) : fallback);
  return {
    headline: typeof d.headline === 'string' && d.headline.trim() ? d.headline : base.headline,
    urgency: base.urgency,
    immediateActions: list(d.immediateActions, base.immediateActions),
    accountProtection: list(d.accountProtection, base.accountProtection),
    paymentProtection: list(d.paymentProtection, base.paymentProtection),
    deviceProtection: list(d.deviceProtection, base.deviceProtection),
    reporting: list(d.reporting, base.reporting),
    evidencePreservation: list(d.evidencePreservation, base.evidencePreservation),
    whatNotToDo: list(d.whatNotToDo, base.whatNotToDo),
    source: 'ai',
  };
}

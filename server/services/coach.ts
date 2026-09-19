/**
 * AI Cyber Safety Coach — adaptive scenario generation.
 *
 * Gemini generates fresh scenarios targeted at the learner's weak categories and
 * current difficulty. A local scenario bank guarantees the coach works offline.
 */
import { Type } from '@google/genai';
import { generateJson } from '../gemini/client';
import type { CoachCategory, CoachProgress, CoachScenario } from '../../shared/investigation';

export const COACH_CATEGORIES: CoachCategory[] = ['phishing', 'job_scam', 'delivery_scam', 'payment_scam', 'government_impersonation', 'account_takeover', 'investment_scam', 'otp_fraud', 'legitimate'];

/** Offline scenario bank — realistic, region-mixed, with per-option feedback. */
const LOCAL_BANK: Omit<CoachScenario, 'id' | 'source'>[] = [
  {
    category: 'phishing', difficulty: 1, channel: 'SMS', sender: 'SBI-ALERT',
    scenario: 'Dear customer, your SBI account will be suspended today due to incomplete KYC. Update now: sbi-kyc-update.xyz',
    question: 'What should you do?',
    options: [
      { id: 'a', text: 'Open the link and complete KYC quickly.', isCorrect: false, feedback: 'The link goes to a look-alike domain, not sbi.co.in. Real KYC is done in the official app or branch.' },
      { id: 'b', text: 'Call the number that later texts you about it.', isCorrect: false, feedback: 'Scammers control every contact detail in the message chain.' },
      { id: 'c', text: 'Open the official SBI app or website yourself and check for any KYC notice.', isCorrect: true, feedback: 'Correct — verify through a channel you already trust, never through the message.' },
      { id: 'd', text: 'Reply STOP to unsubscribe.', isCorrect: false, feedback: 'Replying confirms your number is active and invites more attempts.' },
    ],
    redFlags: ['Urgency ("today")', 'Threat of suspension', 'Look-alike domain (.xyz)'],
    lesson: 'Banks never make you fix KYC through a link in a text. Go to the app or branch.',
  },
  {
    category: 'job_scam', difficulty: 1, channel: 'WhatsApp', sender: '+44 7911 204918',
    scenario: 'Hi! I am Priya from Amazon HR. Earn ₹4,000/day rating products from home. Pay ₹1,999 registration to activate your work ID.',
    question: 'What is the single strongest sign this is a scam?',
    options: [
      { id: 'a', text: 'Amazon HR would not use WhatsApp.', isCorrect: false, feedback: 'Channel choice is a hint, but recruiters do use messaging apps.' },
      { id: 'b', text: 'A real employer never asks you to pay to start working.', isCorrect: true, feedback: 'Correct — "pay to get paid" is the defining feature of advance-fee job scams.' },
      { id: 'c', text: 'The salary is in rupees.', isCorrect: false, feedback: 'Currency is not a red flag by itself.' },
      { id: 'd', text: 'The recruiter has an international number.', isCorrect: false, feedback: 'Suspicious, but not decisive; the payment demand is.' },
    ],
    redFlags: ['Unrealistic daily pay', 'Registration fee', 'Unsolicited offer'],
    lesson: 'Money flows from employer to employee — never the other way.',
  },
  {
    category: 'delivery_scam', difficulty: 1, channel: 'SMS', sender: 'INDPOST',
    scenario: 'India Post: your parcel is held at the warehouse due to an incomplete address. Pay ₹25 redelivery fee within 12h: indiapost-redeliver.top',
    question: 'You are actually expecting a parcel. What now?',
    options: [
      { id: 'a', text: 'Pay ₹25 — it is a small amount.', isCorrect: false, feedback: 'The fee is bait; the page harvests your full card details.' },
      { id: 'b', text: 'Track the parcel on the official India Post site or the retailer’s order page.', isCorrect: true, feedback: 'Correct — check the source you already trust; real couriers do not collect fees via random links.' },
      { id: 'c', text: 'Click to see if it looks legitimate first.', isCorrect: false, feedback: 'Phishing pages are pixel-perfect copies; looking tells you nothing and may trigger downloads.' },
      { id: 'd', text: 'Reply with your correct address.', isCorrect: false, feedback: 'You would be handing personal data to a scammer.' },
    ],
    redFlags: ['Small fee', 'Deadline', 'Domain is not indiapost.gov.in'],
    lesson: 'Tiny "fees" exist to capture card details, not to collect ₹25.',
  },
  {
    category: 'otp_fraud', difficulty: 2, channel: 'Phone call + SMS', sender: '"Bank fraud department"',
    scenario: 'A caller says a fraudulent ₹18,000 charge is being blocked. To cancel it, they need the 6-digit code that just arrived by SMS. The SMS reads: "Do not share this OTP with anyone."',
    question: 'What should you do?',
    options: [
      { id: 'a', text: 'Read them the code — they are stopping fraud.', isCorrect: false, feedback: 'The OTP authorizes a transaction. The caller is the fraud.' },
      { id: 'b', text: 'Hang up and call the number on the back of your card.', isCorrect: true, feedback: 'Correct — the SMS itself told you never to share it. Verify via the official number.' },
      { id: 'c', text: 'Ask the caller for their employee ID first.', isCorrect: false, feedback: 'Scammers happily invent IDs; verification must come from you calling the bank.' },
      { id: 'd', text: 'Share only the first three digits.', isCorrect: false, feedback: 'Any part of the code helps them; never share any of it.' },
    ],
    redFlags: ['Urgent caller', 'Request for OTP', 'The SMS explicitly says not to share'],
    lesson: 'An OTP is a key. Anyone asking for it is asking to spend your money.',
  },
  {
    category: 'government_impersonation', difficulty: 2, channel: 'Video call', sender: '"Cyber Crime Officer"',
    scenario: 'A man in uniform on a video call says a parcel in your name contained drugs and you are under "digital arrest". You must stay on the call and transfer your savings to a "safe RBI account" for verification.',
    question: 'What is the safest action?',
    options: [
      { id: 'a', text: 'Comply — refusing could make things worse legally.', isCorrect: false, feedback: 'No police or court process works over a video call with money transfers. This is the "digital arrest" scam.' },
      { id: 'b', text: 'Transfer a smaller amount to show good faith.', isCorrect: false, feedback: 'Any transfer is lost. There is no "verification account".' },
      { id: 'c', text: 'End the call, tell a family member, and report to 1930 / the local police station.', isCorrect: true, feedback: 'Correct — real agencies serve notices in writing and never ask for transfers to "safe" accounts.' },
      { id: 'd', text: 'Ask them to email an official notice while staying on the call.', isCorrect: false, feedback: 'Staying on the call is the isolation tactic; end it.' },
    ],
    redFlags: ['Authority + fear', 'Isolation ("stay on the call")', '"Safe account" transfer'],
    lesson: 'No government agency arrests people over video calls or asks for money transfers.',
  },
  {
    category: 'account_takeover', difficulty: 2, channel: 'Instagram DM', sender: '@meta_copyright_support',
    scenario: '"Your account violated copyright and will be deleted in 24 hours. Appeal here: meta-appeal-center.xyz/verify" The page asks for your Instagram password to "confirm ownership".',
    question: 'Which detail proves this is phishing?',
    options: [
      { id: 'a', text: 'Instagram sends copyright notices only by email.', isCorrect: false, feedback: 'Real notices appear in-app under Settings → Account Status, and Meta never asks for your password on a third-party page.' },
      { id: 'b', text: 'A real appeal never asks for your password on an external site.', isCorrect: true, feedback: 'Correct — you appeal inside the app while already logged in. A password field on another domain is the giveaway.' },
      { id: 'c', text: 'The account name has underscores.', isCorrect: false, feedback: 'Handle formatting is not decisive.' },
      { id: 'd', text: '24 hours is too short for a deadline.', isCorrect: false, feedback: 'Urgency is a tactic, but the password request is the proof.' },
    ],
    redFlags: ['Deadline', 'External domain', 'Password request'],
    lesson: 'Any page outside the app asking for your password is trying to take the account.',
  },
  {
    category: 'investment_scam', difficulty: 3, channel: 'Telegram group', sender: 'Crypto Signals VIP',
    scenario: 'For three weeks a friendly "mentor" shared accurate-looking trade screenshots. Your ₹5,000 test deposit "grew" to ₹9,400 and you withdrew ₹2,000 successfully. Now they urge a ₹1,50,000 deposit before a "guaranteed 3x listing" tonight.',
    question: 'What does the successful ₹2,000 withdrawal tell you?',
    options: [
      { id: 'a', text: 'The platform is legitimate — withdrawals work.', isCorrect: false, feedback: 'Small early withdrawals are a deliberate trust-building step before the large deposit that is never returned.' },
      { id: 'b', text: 'Nothing conclusive — small payouts are a standard hook; guaranteed 3x returns do not exist.', isCorrect: true, feedback: 'Correct — this is the "pig-butchering" pattern: rapport, small win, big ask, then the wallet is frozen with "tax" demands.' },
      { id: 'c', text: 'You should deposit a medium amount to test again.', isCorrect: false, feedback: 'Every deposit after the hook is lost.' },
      { id: 'd', text: 'The mentor is trustworthy because they were right for three weeks.', isCorrect: false, feedback: 'Screenshots are fabricated; the time invested is the manipulation.' },
    ],
    redFlags: ['Guaranteed returns', 'Trust-building over weeks', 'Deadline ("tonight")', 'Escalating deposit'],
    lesson: 'A small successful withdrawal is the bait, not the proof.',
  },
  {
    category: 'payment_scam', difficulty: 2, channel: 'UPI app', sender: 'Buyer on marketplace',
    scenario: 'A buyer for your used phone sends a UPI "request" for ₹12,000 and says "just approve it and enter your PIN to receive the money".',
    question: 'What happens if you enter your PIN?',
    options: [
      { id: 'a', text: 'You receive ₹12,000.', isCorrect: false, feedback: 'You never need a PIN to receive money. Entering it approves a payment OUT of your account.' },
      { id: 'b', text: 'You send ₹12,000 to the "buyer".', isCorrect: true, feedback: 'Correct — a collect request plus PIN is an outgoing payment. Receiving money never requires a PIN.' },
      { id: 'c', text: 'The transaction is held for verification.', isCorrect: false, feedback: 'There is no hold; the money leaves instantly.' },
      { id: 'd', text: 'Nothing, requests are just notifications.', isCorrect: false, feedback: 'Approving a request with your PIN completes a debit.' },
    ],
    redFlags: ['Collect request to "receive" money', 'PIN required', 'Pressure to act'],
    lesson: 'PIN = paying. You never enter a PIN to receive money.',
  },
  {
    category: 'legitimate', difficulty: 2, channel: 'SMS', sender: 'HDFCBK',
    scenario: '"Rs.2,499.00 debited from a/c **4521 on 12-Mar at AMAZON. Not you? Call 18002586161 (number printed on your card). Never share OTP/PIN." You did buy something on Amazon this morning.',
    question: 'How should you treat this message?',
    options: [
      { id: 'a', text: 'It is a scam — it mentions OTP and PIN.', isCorrect: false, feedback: 'It tells you NOT to share them, contains no link, matches a real purchase and uses the bank’s official helpline — consistent with a genuine alert.' },
      { id: 'b', text: 'Likely genuine: matches a real purchase, no link, warns against sharing codes, official number — but still verify in the app if unsure.', isCorrect: true, feedback: 'Correct — genuine alerts inform; they do not ask you to click or send anything. Verifying in the app is always fine.' },
      { id: 'c', text: 'Call the number immediately to confirm the charge.', isCorrect: false, feedback: 'Not harmful here, but the better habit is checking the statement inside the official app first.' },
      { id: 'd', text: 'Reply to the SMS to confirm it was you.', isCorrect: false, feedback: 'Never reply to transaction alerts; use the app.' },
    ],
    redFlags: [],
    lesson: 'Not every alert is a scam. Genuine alerts have no link, no request, and match your own activity.',
  },
  {
    category: 'phishing', difficulty: 3, channel: 'Email', sender: 'it-support@company-secure-mail.com',
    scenario: 'An email that perfectly matches your company’s style says your mailbox is 98% full and links to "webmail.company-secure-mail.com/quota" to free space. Your real webmail is mail.company.com.',
    question: 'What is the decisive check?',
    options: [
      { id: 'a', text: 'The email design looks official, so it is fine.', isCorrect: false, feedback: 'Design is trivially copied; the domain is what matters.' },
      { id: 'b', text: 'The link’s domain (company-secure-mail.com) is not your real company domain.', isCorrect: true, feedback: 'Correct — read the registrable domain before the first single slash. Anything other than company.com is not you.' },
      { id: 'c', text: 'Mailbox-full warnings are always fake.', isCorrect: false, feedback: 'They can be real, but real ones come from your own domain.' },
      { id: 'd', text: 'Hover shows https, so it is secure.', isCorrect: false, feedback: 'HTTPS only means the connection is encrypted — to the scammer.' },
    ],
    redFlags: ['Look-alike domain', 'Credential harvesting page', 'Routine-sounding pretext'],
    lesson: 'Judge links by the registrable domain, never by design or "https".',
  },
];

function pickWeakCategory(progress: CoachProgress | null): CoachCategory | null {
  if (!progress) return null;
  const recent = progress.recentMistakes.slice(-3);
  if (recent.length) return recent[recent.length - 1];
  let worst: CoachCategory | null = null;
  let worstRate = 1.1;
  for (const [cat, stats] of Object.entries(progress.byCategory)) {
    if (stats.attempts === 0) continue;
    const rate = stats.correct / stats.attempts;
    if (rate < worstRate) { worstRate = rate; worst = cat as CoachCategory; }
  }
  return worstRate < 0.7 ? worst : null;
}

export function localScenario(progress: CoachProgress | null, excludeIds: string[]): CoachScenario {
  const difficulty = progress?.difficulty || 1;
  const weak = pickWeakCategory(progress);
  let pool = LOCAL_BANK.filter((s) => !excludeIds.includes(`local-${LOCAL_BANK.indexOf(s)}`));
  if (!pool.length) pool = LOCAL_BANK;
  const targeted = pool.filter((s) => s.category === weak);
  const byDifficulty = (targeted.length ? targeted : pool).filter((s) => s.difficulty === difficulty);
  const candidates = byDifficulty.length ? byDifficulty : targeted.length ? targeted : pool;
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  return { ...chosen, id: `local-${LOCAL_BANK.indexOf(chosen)}`, source: 'rule' };
}

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    category: { type: Type.STRING, description: `One of: ${COACH_CATEGORIES.join(', ')}` },
    channel: { type: Type.STRING, description: 'SMS, WhatsApp, Email, Phone call, Instagram DM, Telegram, UPI app, etc.' },
    sender: { type: Type.STRING, description: 'Realistic sender ID/handle/number (fictional).' },
    scenario: { type: Type.STRING, description: 'The message or situation the learner faces, 1–4 sentences, realistic and specific. For "legitimate", make it a genuine message with no red flags.' },
    question: { type: Type.STRING },
    options: {
      type: Type.ARRAY,
      description: 'Exactly 4 options; exactly one isCorrect. Wrong options must be plausible.',
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          isCorrect: { type: Type.BOOLEAN },
          feedback: { type: Type.STRING, description: 'One sentence explaining why this choice is right or wrong.' },
        },
        required: ['text', 'isCorrect', 'feedback'],
      },
    },
    redFlags: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Red flags present (empty for legitimate scenarios).' },
    lesson: { type: Type.STRING, description: 'One memorable sentence.' },
  },
  required: ['category', 'channel', 'sender', 'scenario', 'question', 'options', 'redFlags', 'lesson'],
};

export async function generateScenario(progress: CoachProgress | null, excludeIds: string[]): Promise<CoachScenario> {
  const difficulty = (progress?.difficulty || 1) as 1 | 2 | 3;
  const weak = pickWeakCategory(progress);
  const mastered = progress ? Object.entries(progress.byCategory).filter(([, s]) => s.attempts >= 2 && s.correct / s.attempts >= 0.8).map(([c]) => c) : [];
  const targetCategory = weak || COACH_CATEGORIES.filter((c) => !mastered.includes(c))[Math.floor(Math.random() * Math.max(1, COACH_CATEGORIES.length - mastered.length))] || 'phishing';

  const result = await generateJson<Omit<CoachScenario, 'id' | 'source' | 'difficulty' | 'options'> & { options: Array<{ text: string; isCorrect: boolean; feedback: string }> }>({
    systemInstruction: 'You are an adaptive cyber-safety coach. Create realistic, culturally plausible scam (or genuine) scenarios for ordinary users. Difficulty 1 = obvious red flags; 2 = mixed signals requiring one careful check; 3 = sophisticated (multi-step, trust-building, near-perfect impersonation, or a genuine message that looks suspicious). Never include real phone numbers or real people. Use fictional domains.',
    prompt: `Generate one new scenario.
Target category: ${targetCategory}. Difficulty: ${difficulty}/3.
Learner weak areas: ${progress?.recentMistakes.length ? progress.recentMistakes.slice(-3).join(', ') : 'none yet'}.
Mastered (avoid): ${mastered.join(', ') || 'none'}.
Mix Indian and international contexts. Make the correct option the genuinely safest behaviour.`,
    schema: SCHEMA,
    temperature: 0.9,
  });

  if (!result.ok) return localScenario(progress, excludeIds);
  const d = result.data;
  const options = (Array.isArray(d.options) ? d.options : []).slice(0, 4).map((o, i) => ({ id: String.fromCharCode(97 + i), text: String(o.text || ''), isCorrect: Boolean(o.isCorrect), feedback: String(o.feedback || '') }));
  const correctCount = options.filter((o) => o.isCorrect).length;
  if (options.length !== 4 || correctCount !== 1 || !d.scenario) return localScenario(progress, excludeIds);

  return {
    id: `ai-${Date.now()}`,
    category: (COACH_CATEGORIES.includes(d.category as CoachCategory) ? d.category : targetCategory) as CoachCategory,
    difficulty,
    channel: String(d.channel || 'Message'),
    sender: String(d.sender || 'Unknown'),
    scenario: String(d.scenario),
    question: String(d.question || 'What should you do?'),
    options,
    redFlags: Array.isArray(d.redFlags) ? d.redFlags.filter((x): x is string => typeof x === 'string').slice(0, 6) : [],
    lesson: String(d.lesson || ''),
    source: 'ai',
  };
}

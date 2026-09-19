/**
 * Deterministic signal detectors.
 *
 * Each detector looks for a specific, explainable pattern in the text and returns
 * a `Signal` with the exact evidence phrase. These are the transparent building
 * blocks of the risk score — the LLM can add context but cannot invent signals.
 */
import type { HighlightPhrase } from '../../shared/investigation';

export type SignalId =
  | 'urgency'
  | 'threat'
  | 'credential_request'
  | 'financial_request'
  | 'untraceable_payment'
  | 'small_fee'
  | 'fake_reward'
  | 'authority'
  | 'curiosity'
  | 'trust_building'
  | 'secrecy'
  | 'external_contact'
  | 'legit_otp_format'
  | 'personal_data_request'
  | 'verification_prompt';

export interface Signal {
  id: SignalId;
  label: string;
  /** Points contributed to the transparent risk score (negative for mitigating signals). */
  points: number;
  evidence: string;
  /** Social-engineering tactic name this signal maps to (if any). */
  tactic?: string;
  highlightCategory?: HighlightPhrase['category'];
  explanation: string;
}

interface Detector {
  id: SignalId;
  label: string;
  points: number;
  tactic?: string;
  highlightCategory?: HighlightPhrase['category'];
  explanation: string;
  patterns: RegExp[];
}

/**
 * Patterns are intentionally broad but explainable. Each detector fires at most once
 * so a single message cannot rack up points by repeating a phrase.
 */
const DETECTORS: Detector[] = [
  {
    id: 'urgency',
    label: 'Urgency / time pressure',
    points: 15,
    tactic: 'Urgency',
    highlightCategory: 'warning',
    explanation: 'Artificial deadlines push you to act before verifying.',
    patterns: [
      /\b(immediately|urgent(ly)?|right now|within \d+ ?(hours?|hrs?|minutes?|mins?|days?)|today only|last (chance|warning|reminder)|expires? (today|soon|in)|act now|asap|final notice|limited time|before (midnight|it'?s too late)|24 ?(hours|hrs)|will be (blocked|suspended|closed|deactivated|terminated|deleted) (today|within|in \d+))\b/i,
      /\b(time[- ]sensitive|respond (now|immediately)|don'?t delay|hurry|only \d+ (slots?|seats?|spots?|places|left)|(slots?|seats?|spots?) (left|remaining)|limited (slots?|seats?|offer|period)|offer (ends|expires)|do it now|right away|(close|closes|closing|expires?|ends?) in \d+ ?(minutes?|mins?|hours?|hrs?))\b/i,
    ],
  },
  {
    id: 'threat',
    label: 'Threat of loss or penalty',
    points: 12,
    tactic: 'Fear',
    highlightCategory: 'warning',
    explanation: 'Threatens account loss, legal action or penalties to trigger fear.',
    patterns: [
      /\b(account (will be|has been|is) (blocked|suspended|locked|restricted|deactivated|closed|terminated|disabled|deleted)|permanently (deleted|suspended|blocked)|legal action|arrest(ed)? warrant|police case|fir (will be )?(filed|registered)|penalty|fine of|lawsuit|court (notice|summons)|unauthori[sz]ed (access|login|transaction|charge)|suspicious (activity|login|charge)|your (number|sim|card) will be (blocked|deactivated))\b/i,
    ],
  },
  {
    id: 'credential_request',
    label: 'Credential / OTP request',
    points: 25,
    tactic: 'Credential harvesting',
    highlightCategory: 'danger',
    explanation: 'Asks for codes or secrets that legitimate organizations never request.',
    patterns: [
      /(?<!\b(?:not|never|don'?t|do not)\s)\b(share|send|enter|provide|confirm|verify|submit|tell|give)\b[^.!?\n]{0,40}\b(otp|one[- ]time (password|passcode|pin)|password|passcode|pin|cvv|cvc|2fa|verification code|security code|mpin|upi pin|atm pin|card number|login (details|credentials)|seed phrase|recovery phrase|private key)\b/i,
      /\b(otp|password|pin|cvv|upi pin|mpin)\b[^.!?\n]{0,30}\b(to|for)\b[^.!?\n]{0,30}\b(verify|confirm|unlock|activate|restore|release|complete)\b/i,
      /\b(verify (your )?(identity|account|details|kyc|card)( &| and)? (otp|pin|password|code))\b/i,
      /\b(login|log in|sign in)\b[^.!?\n]{0,25}\b(here|below|now|via (the|this) link)\b/i,
      /\b(confirm|verify|enter|re-?enter)\b[^.!?\n]{0,15}\b(your )?(login|log-?in|sign-?in)\b/i,
    ],
  },
  {
    id: 'verification_prompt',
    label: 'Verification prompt via link',
    points: 10,
    tactic: 'Credential harvesting',
    highlightCategory: 'danger',
    explanation: 'Pushes you to "verify" through the message instead of the official app — the page that follows usually asks for credentials.',
    patterns: [
      /\b(verify|confirm|update|validate|re-?activate|unlock|restore|complete)\b[^.!?\n]{0,30}\b(here|now|below|via (the|this) link|immediately)\b/i,
      /\b(click|tap|open)\b[^.!?\n]{0,20}\b(link|here|below)\b[^.!?\n]{0,30}\b(verify|confirm|update|validate|unlock|restore|kyc|account)\b/i,
      /\b(update|complete|verify)\b[^.!?\n]{0,10}\b(your )?(kyc|pan|aadhaar|account details|billing (details|information))\b/i,
      /\b(verify|confirm|update|validate)\b[^.!?\n]{0,40}\b(at|via|on|through|using)\s+(https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,})/i,
    ],
  },
  {
    id: 'financial_request',
    label: 'Payment or money request',
    points: 15,
    tactic: 'Financial pressure',
    highlightCategory: 'danger',
    explanation: 'Requests a payment, fee, deposit or transfer.',
    patterns: [
      /\b(pay|send|transfer|deposit|wire|remit)\b[^.!?\n]{0,30}((₹|rs\.?|inr|\$|usd|€|£|gbp|eur)\s?\d[\d,]*(\.\d+)?|\d[\d,]*(\.\d+)? ?(rupees|dollars|pounds|euros))/i,
      /(₹|rs\.?|inr|\$|usd|€|£)\s?\d[\d,]*(\.\d+)?[^.!?\n]{0,40}\b(fee|charge|registration|activation|processing|clearance|customs|tax|surcharge|redelivery|unlock|release|deposit|advance|penalty)\b/i,
      /\b(registration|activation|processing|clearance|customs|redelivery|handling|verification|joining|security) (fee|charge|deposit|amount)\b/i,
      /\b(pay(ment)? (now|first|to (join|proceed|activate|release|claim)))\b/i,
      /\b(bank transfer|upi id|send (money|funds)|make (a |the )?payment)\b/i,
      /\b(approve|accept)\b[^.!?\n]{0,25}\b(request|collect)\b|\b(upi|payment|collect|money) request\b[^.!?\n]{0,25}\b(₹|rs\.?|inr|\$|\d)/i,
    ],
  },
  {
    id: 'untraceable_payment',
    label: 'Untraceable payment method',
    points: 12,
    tactic: 'Irreversible payment',
    highlightCategory: 'danger',
    explanation: 'Gift cards, crypto and wire transfers cannot be reversed once sent.',
    patterns: [
      /\b(gift ?cards?|apple (gift )?cards?|google play (gift )?cards?|itunes cards?|steam cards?|amazon (gift )?cards?|bitcoin|btc|ethereum|eth\b|usdt|crypto(currency)?|western union|moneygram|wire transfer|prepaid card|paysafe|voucher code)\b/i,
    ],
  },
  {
    id: 'small_fee',
    label: 'Small "release" fee',
    points: 8,
    tactic: 'Low-friction hook',
    highlightCategory: 'warning',
    explanation: 'A tiny fee lowers your guard while harvesting card details.',
    patterns: [
      /(₹|rs\.?|inr)\s?(\d{1,2}|[1-4]\d{2})(\.\d+)?\b(?![\d,])/i,
      /(\$|usd|€|£)\s?([0-9]|1[0-9])(\.\d{2})?\b(?![\d,])/i,
    ],
  },
  {
    id: 'fake_reward',
    label: 'Unrealistic reward or prize',
    points: 15,
    tactic: 'Greed',
    highlightCategory: 'danger',
    explanation: 'Too-good-to-be-true offers exploit greed and excitement.',
    patterns: [
      /\b(congratulations?|you (have )?(been )?(selected|won|chosen)|winner|lucky (draw|winner)|lottery|jackpot|prize|cash ?back of|bonus of|claim your (reward|prize|gift|bonus|refund|cashback)|free (gift|iphone|recharge|vouchers?)|guaranteed (returns?|profit|income)|double your|earn (₹|rs\.?|\$|up to)|per day|daily (income|earning|pay)|work from home|part[- ]time job|no experience|(\d+x|2x|3x|10x) (returns?|back|profit)|refund of (₹|rs\.?|inr|\$|usd|€|£)\s?\d[\d,]*|(refund|cashback|prize|reward) (has been|is) (approved|credited|waiting|pending))\b/i,
    ],
  },
  {
    id: 'authority',
    label: 'Authority impersonation',
    points: 10,
    tactic: 'Authority',
    highlightCategory: 'warning',
    explanation: 'Claims official or legal authority so you comply without questioning.',
    patterns: [
      /\b(police|cyber ?crime|cbi|narcotics|customs|enforcement directorate|income tax|irs|court|officer|inspector|government|govt|ministry|rbi|reserve bank|federal|magistrate|legal department|fraud department|security team|compliance team|official notice|regulatory)\b/i,
    ],
  },
  {
    id: 'curiosity',
    label: 'Curiosity bait',
    points: 6,
    tactic: 'Curiosity',
    highlightCategory: 'warning',
    explanation: 'Vague hooks make you click to find out more.',
    patterns: [
      /\b(is this you|someone (tried|is trying) to|you (have )?(a )?new (voicemail|message|document|photo)|see who viewed|look what i found|check this out|you won'?t believe|your (photo|video) (is|was) (posted|leaked)|package (is )?waiting)\b/i,
    ],
  },
  {
    id: 'trust_building',
    label: 'Trust-building / rapport',
    points: 6,
    tactic: 'Trust building',
    highlightCategory: 'warning',
    explanation: 'Friendly framing lowers suspicion before the real ask.',
    patterns: [
      /\b(my (dear|love|friend)|dear (customer|user|sir|madam|valued)|trusted (partner|customer)|i (personally )?(guarantee|promise)|we (value|care about) you|100% (safe|genuine|legit|secure)|no risk|verified (partner|recruiter|team)|reviewed your profile)\b/i,
    ],
  },
  {
    id: 'secrecy',
    label: 'Secrecy / isolation',
    points: 8,
    tactic: 'Isolation',
    highlightCategory: 'warning',
    explanation: 'Asking you to keep quiet stops friends or the bank from warning you.',
    patterns: [
      /\b(do not (tell|inform|share with) (anyone|anybody|your (family|bank))|keep (this|it) (confidential|secret|private)|don'?t (tell|inform) anyone|confidential matter|between us)\b/i,
    ],
  },
  {
    id: 'external_contact',
    label: 'Move to another channel',
    points: 8,
    tactic: 'Channel shifting',
    highlightCategory: 'suspicious_link',
    explanation: 'Moving to Telegram/WhatsApp escapes platform fraud detection.',
    patterns: [
      /\b(contact (us|me|our team|hr) on (telegram|whatsapp|signal)|telegram ?@|whatsapp (me|us|number)|message (me|us) on (telegram|whatsapp)|join (our )?(telegram|whatsapp) (group|channel)|@[a-z0-9_]{4,}\b.*\b(telegram|tg)\b|\bt\.me\/)/i,
    ],
  },
  {
    id: 'personal_data_request',
    label: 'Personal data request',
    points: 10,
    tactic: 'Data harvesting',
    highlightCategory: 'danger',
    explanation: 'Requests identity documents or personal identifiers.',
    patterns: [
      /\b(aadhaar (number|card|details)|pan (card|number)|passport (number|copy)|ssn|social security number|date of birth|mother'?s maiden name|address proof|id proof|kyc (update|documents?|details|verification)|bank (account )?details|account number|ifsc( code)?)\b/i,
    ],
  },
  {
    // Mitigating signal: genuine OTP messages tell you NOT to share the code.
    id: 'legit_otp_format',
    label: 'Legitimate OTP warning format',
    points: -15,
    explanation: 'Genuine one-time-code messages warn you never to share the code and contain no links.',
    patterns: [
      /\b(do not share (this|the|your) (code|otp|password|pin)|never (share|ask for|disclose) (this|the|your) (code|otp|password|pin)|don'?t share (this|the|your) (code|otp|password|pin)|will never (call|text|ask) (you )?(to|for)|is your (verification|one[- ]time|otp|login|security) code)\b/i,
    ],
  },
];

export interface SignalScanResult {
  signals: Signal[];
  highlights: HighlightPhrase[];
  tactics: string[];
}

/** Run every detector against the message + sender. Deterministic and side-effect free. */
export function scanSignals(message: string, sender: string | null): SignalScanResult {
  const text = `${message}\n${sender || ''}`;
  const signals: Signal[] = [];
  const highlights: HighlightPhrase[] = [];
  const tactics = new Set<string>();

  for (const detector of DETECTORS) {
    let evidence: string | null = null;
    for (const pattern of detector.patterns) {
      const match = text.match(pattern);
      if (match && match[0]) {
        evidence = match[0].trim();
        break;
      }
    }
    if (!evidence) continue;

    // The mitigating OTP signal only applies when the message contains no link.
    if (detector.id === 'legit_otp_format' && /https?:\/\/|www\.|\.(com|in|xyz|top|cc|link|club)\b/i.test(message)) {
      continue;
    }

    signals.push({
      id: detector.id,
      label: detector.label,
      points: detector.points,
      evidence,
      tactic: detector.tactic,
      highlightCategory: detector.highlightCategory,
      explanation: detector.explanation,
    });
    if (detector.tactic) tactics.add(detector.tactic);
    if (detector.highlightCategory && message.toLowerCase().includes(evidence.toLowerCase())) {
      highlights.push({ text: evidence, category: detector.highlightCategory, explanation: detector.explanation });
    }
  }

  return { signals, highlights, tactics: Array.from(tactics) };
}

/** Extract currency amounts for the Financial Risk Agent. */
export function extractAmounts(text: string): string[] {
  const matches = text.match(/(₹|rs\.?\s?|inr\s?|\$|usd\s?|€|£|gbp\s?|eur\s?)\s?\d[\d,]*(\.\d+)?(\s?(lakh|lakhs|crore|k|m))?|\b\d[\d,]*(\.\d+)?\s?(rupees|dollars|pounds|euros|eth|btc|usdt)\b/gi) || [];
  return Array.from(new Set(matches.map((m) => m.trim()))).slice(0, 6);
}

/** Identify which payment rails are mentioned (deterministic, for the Financial Risk Agent). */
export function extractPaymentMethods(text: string): string[] {
  const lower = text.toLowerCase();
  const methods: string[] = [];
  const table: Array<[string, RegExp]> = [
    ['UPI', /\bupi\b|phonepe|google pay|gpay|paytm|bhim/],
    ['Gift card', /gift ?card|itunes card|google play card|steam card/],
    ['Cryptocurrency', /bitcoin|btc|ethereum|\beth\b|usdt|crypto|wallet address|smart[- ]contract/],
    ['Wire transfer', /wire transfer|western union|moneygram|swift/],
    ['Bank transfer', /bank transfer|neft|imps|rtgs|account number|ifsc/],
    ['Card payment', /card (number|details)|debit card|credit card|cvv/],
    ['Prepaid / voucher', /prepaid|voucher|recharge code/],
  ];
  for (const [label, re] of table) if (re.test(lower)) methods.push(label);
  return methods;
}

/** Identify which credential types are requested. */
export function extractCredentialTypes(text: string): string[] {
  const lower = text.toLowerCase();
  const types: string[] = [];
  const table: Array<[string, RegExp]> = [
    ['OTP / verification code', /\botp\b|one[- ]time (password|passcode|pin)|verification code|security code|2fa/],
    ['Password', /\bpassword\b|passcode|login (details|credentials)/],
    ['PIN', /\bpin\b|mpin|upi pin|atm pin/],
    ['Card details', /cvv|cvc|card number|expiry/],
    ['Identity documents', /aadhaar|pan card|passport|ssn|social security|id proof|kyc/],
    ['Crypto keys', /seed phrase|recovery phrase|private key/],
  ];
  for (const [label, re] of table) if (re.test(lower)) types.push(label);
  return types;
}

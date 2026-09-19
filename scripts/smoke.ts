/**
 * Smoke test for the agentic pipeline. Runs fully offline in deterministic mode
 * (no GEMINI_API_KEY required); external lookups are tolerated but not required.
 *
 *   npm test
 */
import { investigate, validateRequest, InvestigationError } from '../server/agents/orchestrator';
import { scanSignals } from '../server/rules/signals';
import { analyzeUrl } from '../server/agents/urlAgent';
import { parseConversation } from '../server/agents/conversationAgent';
import { buildBaseIncidentPlan } from '../server/services/incidentResponse';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  console.log('\n[1] Deterministic signal detectors');
  const sbi = scanSignals('Your SBI account will be blocked today. Verify here: sbi-security-update.xyz', 'SBI-ALERT');
  check('urgency detected', sbi.signals.some((s) => s.id === 'urgency'));
  check('threat detected', sbi.signals.some((s) => s.id === 'threat'));
  check('verification prompt detected', sbi.signals.some((s) => s.id === 'verification_prompt'));
  const otp = scanSignals('G-749102 is your Google verification code. Do not share this code with anyone.', null);
  check('legit OTP format is a mitigating signal', otp.signals.some((s) => s.id === 'legit_otp_format' && s.points < 0));
  check('legit OTP has no credential request', !otp.signals.some((s) => s.id === 'credential_request'));

  console.log('\n[2] URL analysis (offline)');
  const u = analyzeUrl('https://sbi-security-update.xyz/verify');
  check('parses hostname', u?.hostname === 'sbi-security-update.xyz');
  check('flags risky TLD', Boolean(u?.suspiciousTld));
  check('detects SBI look-alike', /State Bank/.test(u?.lookalikeOf || ''));
  check('official domain is not a look-alike', analyzeUrl('https://www.sbi.co.in/login')?.lookalikeOf === null);
  check('shortener flagged', Boolean(analyzeUrl('bit.ly/abc')?.isShortener));

  console.log('\n[3] Conversation parsing');
  const turns = parseConversation('Scammer: Hello\nUser: Hi\nScammer: Pay ₹1,999 now');
  check('three labelled turns', turns.length === 3 && turns[2].speaker === 'Scammer');

  console.log('\n[4] Request validation');
  const expectError = (body: unknown, code: string) => {
    try {
      validateRequest(body);
      return false;
    } catch (e) {
      return e instanceof InvestigationError && e.code === code;
    }
  };
  check('empty message rejected', expectError({ inputType: 'message', message: ' ' }, 'empty_input'));
  check('bad inputType rejected', expectError({ inputType: 'video' }, 'bad_request'));
  check('oversize rejected', expectError({ inputType: 'message', message: 'a'.repeat(20000) }, 'too_large'));
  check('invalid url rejected', expectError({ inputType: 'url', url: 'not a url' }, 'invalid_url'));

  console.log('\n[5] Full investigations (deterministic)');
  const bank = await investigate({ inputType: 'message', message: 'Dear customer, your SBI account will be blocked today due to incomplete KYC. Verify immediately: https://sbi-security-update.xyz/verify', sender: 'SBI-ALERT', platform: 'SMS / Text' });
  check('bank phishing is CRITICAL', bank.verdict.level === 'CRITICAL', `${bank.verdict.level} ${bank.verdict.riskScore}`);
  check('identity mismatch found', Boolean(bank.identity?.mismatch));
  check('score equals capped indicator sum', bank.verdict.riskScore === Math.min(100, bank.indicators.reduce((a, i) => a + i.points, 0)));
  check('conversation agent skipped for single message', bank.agentsSkipped.some((s) => s.agent === 'conversation'));
  check('threat intel agent ran', bank.trace.some((t) => t.agent === 'threat_intel' && t.status !== 'skipped'));
  check('protection plan has reporting channels', bank.protectionPlan.reporting.length > 0);
  check('no hidden reasoning in trace', bank.trace.every((t) => t.summary.length < 240));

  const legit = await investigate({ inputType: 'message', message: 'G-749102 is your Google verification code. Do not share this code with anyone. Google will never call or text to ask for this code.', sender: '22000 (Google)', platform: 'SMS / Text' });
  check('genuine OTP is LOW', legit.verdict.level === 'LOW', `${legit.verdict.level} ${legit.verdict.riskScore}`);
  check('url / intel / financial skipped for OTP', ['url', 'threat_intel', 'financial'].every((a) => legit.agentsSkipped.some((s) => s.agent === a)));

  const job = await investigate({ inputType: 'conversation', conversation: 'Scammer: Congratulations! You have been selected for an online job.\nUser: What is the salary?\nScammer: ₹4,000 per day.\nUser: How do I join?\nScammer: First pay ₹1,999 registration fee.' });
  check('job conversation is HIGH or above', job.verdict.level === 'HIGH' || job.verdict.level === 'CRITICAL', `${job.verdict.level} ${job.verdict.riskScore}`);
  check('escalation indicator present', job.indicators.some((i) => i.id === 'conversation_escalation'));
  check('conversation stages produced', (job.conversation?.stages.length || 0) >= 2);

  const url = await investigate({ inputType: 'url', url: 'https://usps-post-redelivery.top/tracking' });
  check('URL-only investigation flags USPS impersonation', url.identity?.claimedOrganization === 'USPS' && url.identity.mismatch);
  check('scam DNA has link deception', url.scamDna.linkDeception >= 5);

  console.log('\n[6] Incident response');
  const plan = buildBaseIncidentPlan(['shared_otp', 'clicked_link'], { claimedOrganization: 'State Bank of India (SBI)', paymentMethods: ['UPI'] });
  check('OTP sharing is critical urgency', plan.urgency === 'critical');
  check('India helpline included', plan.reporting.some((r) => r.includes('1930')));

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

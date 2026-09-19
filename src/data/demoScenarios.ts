/**
 * Demo Mode scenarios for hackathon presentation.
 * Each one exercises a different path through the agent orchestration.
 * Domains are fictional. Nothing here is fetched — links are only analysed.
 */
import type { InvestigationSeed } from '../types';

export interface DemoScenario {
  id: string;
  title: string;
  category: string;
  /** What the audience should watch for in the trace. */
  showcase: string;
  expectedLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  seed: InvestigationSeed;
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: 'bank-phishing',
    title: 'Bank phishing (SBI)',
    category: 'Bank Phishing',
    showcase: 'Message → URL → Identity mismatch → Threat intel → Critical verdict',
    expectedLevel: 'CRITICAL',
    seed: {
      mode: 'message',
      platform: 'SMS / Text',
      sender: 'SBI-ALERT',
      message: 'Dear customer, your SBI account will be blocked today due to incomplete KYC. Verify immediately to avoid suspension: https://sbi-security-update.xyz/verify',
      autoRun: true,
      demoTitle: 'Bank phishing (SBI)',
    },
  },
  {
    id: 'fake-job',
    title: 'Fake job conversation',
    category: 'Advance-Fee Job Scam',
    showcase: 'Conversation Agent maps the trust → reward → fee escalation',
    expectedLevel: 'HIGH',
    seed: {
      mode: 'conversation',
      platform: 'WhatsApp',
      conversation: `Scammer: Congratulations! You have been selected for an online part-time job with Amazon. No experience needed.
User: What is the salary?
Scammer: ₹4,000 per day for 1 hour of product rating work. Payment daily to your UPI.
User: How do I join?
Scammer: First pay ₹1,999 registration fee to activate your work ID. Refundable after your first task. Contact our HR on Telegram @Amazon_HR_Onboard to proceed today, only 3 slots left.`,
      autoRun: true,
      demoTitle: 'Fake job conversation',
    },
  },
  {
    id: 'delivery-scam',
    title: 'Delivery fee smishing',
    category: 'Delivery Fee Smishing',
    showcase: 'Small-fee hook, look-alike courier domain, Financial Risk Agent',
    expectedLevel: 'CRITICAL',
    seed: {
      mode: 'message',
      platform: 'SMS / Text',
      sender: 'INDPOST',
      message: 'India Post: Your parcel #IN7734910 is held at the sorting warehouse due to an incomplete address. Pay the ₹25 redelivery fee within 12 hours or it will be returned: https://indiapost-redelivery.top/track',
      autoRun: true,
      demoTitle: 'Delivery fee smishing',
    },
  },
  {
    id: 'upi-scam',
    title: 'UPI / payment scam',
    category: 'UPI Payment Scam',
    showcase: 'Credential + payment request detected without any link',
    expectedLevel: 'HIGH',
    seed: {
      mode: 'message',
      platform: 'WhatsApp',
      sender: '+91 98XXXX2210',
      message: 'Hi, I am buying your sofa from OLX. I have sent a UPI request of ₹15,000 to your PhonePe. Just approve the request and enter your UPI PIN to receive the money. Please do it now, I am at the bank and they close in 10 minutes.',
      autoRun: true,
      demoTitle: 'UPI / payment scam',
    },
  },
  {
    id: 'government-scam',
    title: 'Fake government notice',
    category: 'Government Impersonation',
    showcase: 'Authority + fear tactics, Income Tax impersonation, .in look-alike',
    expectedLevel: 'CRITICAL',
    seed: {
      mode: 'message',
      platform: 'Email / Inbox',
      sender: 'refunds@incometax-portal-gov.in',
      message: 'Income Tax Department — FINAL NOTICE. A refund of ₹34,560 has been approved for PAN ending 7K. Verify your bank details within 24 hours at https://incometax-portal-gov.in/refund or the refund will lapse and a penalty may be applied under Section 234F.',
      autoRun: true,
      demoTitle: 'Fake government notice',
    },
  },
  {
    id: 'account-takeover',
    title: 'Social media takeover',
    category: 'Account Takeover Phishing',
    showcase: 'Meta impersonation, deadline pressure, credential URL keywords',
    expectedLevel: 'CRITICAL',
    seed: {
      mode: 'message',
      platform: 'Instagram DM',
      sender: '@meta_copyright_appeals_center',
      message: 'Notice: Copyright infringement detected on your post. Your account will be permanently deleted within 24 hours. If you think this is a mistake, appeal through our verified partner portal and confirm your login: https://meta-appeal-form-verify.xyz/login',
      autoRun: true,
      demoTitle: 'Social media takeover',
    },
  },
  {
    id: 'crypto-scam',
    title: 'Investment / crypto scam',
    category: 'Investment / Crypto Scam',
    showcase: 'Greed + untraceable payment + fake reward, Telegram channel shift',
    expectedLevel: 'CRITICAL',
    seed: {
      mode: 'message',
      platform: 'Telegram',
      sender: 'Official Tesla & SpaceX Community',
      message: 'SPECIAL GIVEAWAY: Elon Musk is giving back 5,000 ETH! Send between 0.1 and 2.0 ETH to the official smart-contract wallet to verify your wallet and immediately receive 2x back. Guaranteed returns, limited time. Claim now: https://elon-eth-event2026.buzz',
      autoRun: true,
      demoTitle: 'Investment / crypto scam',
    },
  },
  {
    id: 'legit-otp',
    title: 'Genuine OTP (control)',
    category: 'Legitimate Notification',
    showcase: 'Shows the system does NOT over-flag: no link, no request, OTP warning format',
    expectedLevel: 'LOW',
    seed: {
      mode: 'message',
      platform: 'SMS / Text',
      sender: '22000 (Google)',
      message: 'G-749102 is your Google verification code. Do not share this code with anyone. Google will never call or text to ask for this code.',
      autoRun: true,
      demoTitle: 'Genuine OTP (control)',
    },
  },
];

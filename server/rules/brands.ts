/**
 * Known-organization registry used by the Identity / Brand Impersonation Agent.
 *
 * A match here is deterministic evidence: "the message claims to be X, and X's
 * official domains are Y". A mismatch is presented as a signal, never as proof.
 */

export type OrganizationCategory =
  | 'bank'
  | 'government'
  | 'ecommerce'
  | 'payment'
  | 'delivery'
  | 'social'
  | 'telecom'
  | 'tech'
  | 'employer'
  | 'university'
  | 'crypto'
  | 'streaming';

export interface KnownOrganization {
  name: string;
  category: OrganizationCategory;
  /** Lowercase aliases matched against message text and sender. */
  aliases: string[];
  officialDomains: string[];
}

export const KNOWN_ORGANIZATIONS: KnownOrganization[] = [
  // Indian banks
  { name: 'State Bank of India (SBI)', category: 'bank', aliases: ['sbi', 'state bank of india', 'sbi bank', 'yono'], officialDomains: ['sbi.co.in', 'onlinesbi.sbi', 'onlinesbi.com', 'sbicard.com'] },
  { name: 'HDFC Bank', category: 'bank', aliases: ['hdfc', 'hdfc bank'], officialDomains: ['hdfcbank.com'] },
  { name: 'ICICI Bank', category: 'bank', aliases: ['icici', 'icici bank'], officialDomains: ['icicibank.com'] },
  { name: 'Axis Bank', category: 'bank', aliases: ['axis bank'], officialDomains: ['axisbank.com'] },
  { name: 'Kotak Mahindra Bank', category: 'bank', aliases: ['kotak', 'kotak bank'], officialDomains: ['kotak.com'] },
  { name: 'Punjab National Bank', category: 'bank', aliases: ['pnb', 'punjab national bank'], officialDomains: ['pnbindia.in'] },
  { name: 'Bank of Baroda', category: 'bank', aliases: ['bank of baroda', 'bob bank'], officialDomains: ['bankofbaroda.in'] },
  // Global banks
  { name: 'Chase', category: 'bank', aliases: ['chase', 'jpmorgan chase', 'chase bank'], officialDomains: ['chase.com', 'jpmorganchase.com'] },
  { name: 'Bank of America', category: 'bank', aliases: ['bank of america', 'bofa'], officialDomains: ['bankofamerica.com'] },
  { name: 'Wells Fargo', category: 'bank', aliases: ['wells fargo'], officialDomains: ['wellsfargo.com'] },
  { name: 'Citibank', category: 'bank', aliases: ['citibank', 'citi bank', 'citi'], officialDomains: ['citi.com', 'citibank.com'] },
  { name: 'HSBC', category: 'bank', aliases: ['hsbc'], officialDomains: ['hsbc.com', 'hsbc.co.in', 'hsbc.co.uk'] },
  { name: 'Barclays', category: 'bank', aliases: ['barclays'], officialDomains: ['barclays.co.uk', 'barclays.com'] },
  // Payments
  { name: 'Paytm', category: 'payment', aliases: ['paytm'], officialDomains: ['paytm.com', 'paytmbank.com'] },
  { name: 'PhonePe', category: 'payment', aliases: ['phonepe', 'phone pe'], officialDomains: ['phonepe.com'] },
  { name: 'Google Pay', category: 'payment', aliases: ['google pay', 'gpay', 'g pay'], officialDomains: ['google.com', 'pay.google.com'] },
  { name: 'PayPal', category: 'payment', aliases: ['paypal'], officialDomains: ['paypal.com'] },
  { name: 'NPCI / UPI', category: 'payment', aliases: ['npci', 'bhim', 'bhim upi'], officialDomains: ['npci.org.in', 'bhimupi.org.in'] },
  { name: 'Venmo', category: 'payment', aliases: ['venmo'], officialDomains: ['venmo.com'] },
  { name: 'Cash App', category: 'payment', aliases: ['cash app', 'cashapp'], officialDomains: ['cash.app'] },
  { name: 'Zelle', category: 'payment', aliases: ['zelle'], officialDomains: ['zellepay.com'] },
  // E-commerce
  { name: 'Amazon', category: 'ecommerce', aliases: ['amazon'], officialDomains: ['amazon.com', 'amazon.in', 'amazon.co.uk', 'amazon.ca', 'amazon.de', 'amazon.jobs'] },
  { name: 'Flipkart', category: 'ecommerce', aliases: ['flipkart'], officialDomains: ['flipkart.com'] },
  { name: 'Myntra', category: 'ecommerce', aliases: ['myntra'], officialDomains: ['myntra.com'] },
  { name: 'eBay', category: 'ecommerce', aliases: ['ebay'], officialDomains: ['ebay.com', 'ebay.in', 'ebay.co.uk'] },
  { name: 'Walmart', category: 'ecommerce', aliases: ['walmart'], officialDomains: ['walmart.com'] },
  // Delivery
  { name: 'India Post', category: 'delivery', aliases: ['india post', 'indiapost', 'speed post'], officialDomains: ['indiapost.gov.in'] },
  { name: 'USPS', category: 'delivery', aliases: ['usps', 'united states postal service', 'us postal'], officialDomains: ['usps.com'] },
  { name: 'FedEx', category: 'delivery', aliases: ['fedex'], officialDomains: ['fedex.com'] },
  { name: 'UPS', category: 'delivery', aliases: ['ups'], officialDomains: ['ups.com'] },
  { name: 'DHL', category: 'delivery', aliases: ['dhl'], officialDomains: ['dhl.com', 'dhl.co.in'] },
  { name: 'Blue Dart', category: 'delivery', aliases: ['blue dart', 'bluedart'], officialDomains: ['bluedart.com'] },
  { name: 'Delhivery', category: 'delivery', aliases: ['delhivery'], officialDomains: ['delhivery.com'] },
  { name: 'Royal Mail', category: 'delivery', aliases: ['royal mail'], officialDomains: ['royalmail.com'] },
  // Government
  { name: 'Income Tax Department (India)', category: 'government', aliases: ['income tax', 'income tax department', 'itr refund', 'it department'], officialDomains: ['incometax.gov.in', 'incometaxindia.gov.in'] },
  { name: 'Reserve Bank of India', category: 'government', aliases: ['rbi', 'reserve bank of india', 'reserve bank'], officialDomains: ['rbi.org.in'] },
  { name: 'UIDAI / Aadhaar', category: 'government', aliases: ['uidai', 'aadhaar', 'aadhar'], officialDomains: ['uidai.gov.in'] },
  { name: 'EPFO', category: 'government', aliases: ['epfo', 'provident fund', 'pf account'], officialDomains: ['epfindia.gov.in'] },
  { name: 'TRAI', category: 'government', aliases: ['trai', 'telecom regulatory'], officialDomains: ['trai.gov.in'] },
  { name: 'Indian Police / Cyber Crime', category: 'government', aliases: ['cyber crime', 'cybercrime', 'police', 'cbi', 'narcotics', 'customs department', 'enforcement directorate'], officialDomains: ['cybercrime.gov.in', 'cbi.gov.in'] },
  { name: 'IRS', category: 'government', aliases: ['irs', 'internal revenue service'], officialDomains: ['irs.gov'] },
  { name: 'Social Security Administration', category: 'government', aliases: ['social security administration', 'ssa'], officialDomains: ['ssa.gov'] },
  { name: 'HMRC', category: 'government', aliases: ['hmrc'], officialDomains: ['gov.uk', 'hmrc.gov.uk'] },
  { name: 'DMV', category: 'government', aliases: ['dmv', 'motor vehicles'], officialDomains: ['dmv.ca.gov', 'dmv.ny.gov'] },
  // Tech / social
  { name: 'Google', category: 'tech', aliases: ['google', 'gmail', 'youtube'], officialDomains: ['google.com', 'gmail.com', 'youtube.com', 'goog.le', 'google.co.in'] },
  { name: 'Microsoft', category: 'tech', aliases: ['microsoft', 'outlook', 'office 365', 'onedrive', 'hotmail'], officialDomains: ['microsoft.com', 'live.com', 'outlook.com', 'office.com', 'hotmail.com', 'microsoftonline.com'] },
  { name: 'Apple', category: 'tech', aliases: ['apple', 'icloud', 'apple id', 'app store'], officialDomains: ['apple.com', 'icloud.com'] },
  { name: 'Meta / Facebook', category: 'social', aliases: ['facebook', 'meta', 'fb'], officialDomains: ['facebook.com', 'meta.com', 'fb.com', 'facebookmail.com'] },
  { name: 'Instagram', category: 'social', aliases: ['instagram', 'insta'], officialDomains: ['instagram.com'] },
  { name: 'WhatsApp', category: 'social', aliases: ['whatsapp'], officialDomains: ['whatsapp.com', 'wa.me'] },
  { name: 'Telegram', category: 'social', aliases: ['telegram'], officialDomains: ['telegram.org', 't.me'] },
  { name: 'LinkedIn', category: 'social', aliases: ['linkedin'], officialDomains: ['linkedin.com'] },
  { name: 'X / Twitter', category: 'social', aliases: ['twitter', 'x.com'], officialDomains: ['x.com', 'twitter.com'] },
  { name: 'Snapchat', category: 'social', aliases: ['snapchat'], officialDomains: ['snapchat.com'] },
  { name: 'Netflix', category: 'streaming', aliases: ['netflix'], officialDomains: ['netflix.com'] },
  { name: 'Spotify', category: 'streaming', aliases: ['spotify'], officialDomains: ['spotify.com'] },
  // Telecom
  { name: 'Airtel', category: 'telecom', aliases: ['airtel'], officialDomains: ['airtel.in'] },
  { name: 'Jio', category: 'telecom', aliases: ['jio', 'reliance jio'], officialDomains: ['jio.com'] },
  { name: 'Vi (Vodafone Idea)', category: 'telecom', aliases: ['vodafone', 'vi '], officialDomains: ['myvi.in', 'vodafoneidea.com'] },
  { name: 'Verizon', category: 'telecom', aliases: ['verizon'], officialDomains: ['verizon.com'] },
  { name: 'AT&T', category: 'telecom', aliases: ['at&t', 'att '], officialDomains: ['att.com'] },
  // Crypto / finance
  { name: 'Coinbase', category: 'crypto', aliases: ['coinbase'], officialDomains: ['coinbase.com'] },
  { name: 'Binance', category: 'crypto', aliases: ['binance'], officialDomains: ['binance.com'] },
  { name: 'Tesla / SpaceX (giveaway impersonation)', category: 'crypto', aliases: ['tesla', 'spacex', 'elon musk'], officialDomains: ['tesla.com', 'spacex.com'] },
  // Employers / travel
  { name: 'IRCTC', category: 'government', aliases: ['irctc', 'indian railways'], officialDomains: ['irctc.co.in', 'indianrail.gov.in'] },
  { name: 'Naukri', category: 'employer', aliases: ['naukri'], officialDomains: ['naukri.com'] },
  { name: 'Indeed', category: 'employer', aliases: ['indeed'], officialDomains: ['indeed.com'] },
];

export interface BrandMatch {
  organization: KnownOrganization;
  matchedAlias: string;
}

/** Find the organizations a message claims to represent (deterministic alias match). */
export function findClaimedOrganizations(text: string, sender: string | null): BrandMatch[] {
  const haystack = ` ${(text + ' ' + (sender || '')).toLowerCase()} `;
  const matches: BrandMatch[] = [];
  for (const org of KNOWN_ORGANIZATIONS) {
    for (const alias of org.aliases) {
      const needle = alias.toLowerCase();
      // Word-boundary match for short aliases to avoid "ups" matching "groups".
      const pattern = needle.length <= 4 ? new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}([^a-z0-9]|$)`, 'i') : null;
      const hit = pattern ? pattern.test(haystack) : haystack.includes(needle);
      if (hit) {
        matches.push({ organization: org, matchedAlias: alias });
        break;
      }
    }
  }
  return matches;
}

/** Does the observed registrable domain belong to (or sit under) an official domain? */
export function domainBelongsTo(observedHost: string, org: KnownOrganization): boolean {
  const host = observedHost.toLowerCase();
  return org.officialDomains.some((official) => host === official || host.endsWith('.' + official));
}

/** Does a hostname *contain* a brand token without being the official domain (e.g. sbi-secure-update.xyz)? */
export function brandTokenInHost(host: string, org: KnownOrganization): string | null {
  const lower = host.toLowerCase();
  for (const alias of org.aliases) {
    const token = alias.replace(/[^a-z0-9]/g, '');
    if (token.length >= 3 && lower.replace(/[^a-z0-9]/g, '').includes(token)) return alias;
  }
  return null;
}

/** Look up an organization by any alias (case-insensitive). */
export function findOrganizationByName(name: string): KnownOrganization | null {
  const lower = name.toLowerCase();
  return (
    KNOWN_ORGANIZATIONS.find(
      (o) => o.name.toLowerCase() === lower || o.aliases.some((a) => a.trim() === lower),
    ) || null
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

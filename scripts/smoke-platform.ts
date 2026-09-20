/**
 * Platform smoke test — accounts, add-in linking, saved email analyses,
 * per-user isolation, notifications, admin authorization, provider
 * normalisers and the Link Inspector fallback. Boots the real Express app
 * against an in-memory SQLite database; no network access or API keys needed.
 *
 *   npm run test:platform
 */
import http from 'node:http';
import { createApp, installErrorHandler } from '../server/app';
import { resetDbForTests } from '../server/db';
import { prefilterScore } from '../server/services/emailAnalysis';
import { policyAllows } from '../server/services/notifications';
import { normalizeGraphMessage } from '../server/providers/outlook';
import { normalizeGmailMessage, parseAddress } from '../server/providers/gmail';
import { htmlToText } from '../server/providers/http';
import { decryptSecret, encryptSecret, hashPassword, verifyPassword } from '../server/auth/crypto';
import { db } from '../server/db';
import { SCHEMA } from '../server/db/schema';

process.env.ADMIN_EMAILS = 'admin@example.test';
process.env.SESSION_SECRET = 'smoke-test-secret-value-1234567890';
process.env.SYNC_INTERVAL_MINUTES = '0';
delete process.env.GEMINI_API_KEY;

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

interface Client {
  cookie: string | null;
  bearer: string | null;
}

let base = '';

async function call(client: Client, method: string, path: string, body?: unknown): Promise<{ status: number; data: any; headers: Headers }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (client.cookie) headers.Cookie = client.cookie;
  if (client.bearer) headers.Authorization = `Bearer ${client.bearer}`;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) client.cookie = setCookie.includes('Max-Age=0') ? null : setCookie.split(';')[0];
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

const PHISH = {
  subject: 'URGENT: Your SBI account will be blocked today',
  sender: 'SBI Alerts',
  senderEmail: 'alerts@sbi-secure-login.xyz',
  body: 'Dear customer, your SBI account will be blocked today due to incomplete KYC. Verify immediately: https://sbi-security-update.xyz/verify and share the OTP you receive.',
  urls: ['https://sbi-security-update.xyz/verify'],
  recipientCount: 1,
  attachments: [{ name: 'KYC_Form.exe', size: 48213, contentType: 'application/octet-stream' }],
  truncated: false,
  internetMessageId: '<abc123@sbi-secure-login.xyz>',
  itemId: 'AAMkAGI2THVSAAA=',
  receivedAt: '2026-09-19T08:00:00.000Z',
  isRead: false,
};

async function main() {
  await resetDbForTests();
  const app = createApp();
  installErrorHandler(app);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  base = `http://127.0.0.1:${port}`;

  console.log('\n[P1] Crypto primitives');
  const hash = await hashPassword('correct horse battery');
  check('password verifies', await verifyPassword('correct horse battery', hash));
  check('wrong password rejected', !(await verifyPassword('wrong', hash)));
  check('token encryption round-trips', decryptSecret(encryptSecret('refresh-token-value')) === 'refresh-token-value');
  check('corrupt ciphertext returns null', decryptSecret('v1.bad.bad.bad') === null);

  console.log('\n[P2] Accounts & sessions');
  const alice: Client = { cookie: null, bearer: null };
  const bob: Client = { cookie: null, bearer: null };
  const admin: Client = { cookie: null, bearer: null };
  const anon: Client = { cookie: null, bearer: null };
  let r = await call(alice, 'POST', '/api/auth/register', { email: 'Alice@Example.test', password: 'password123', name: 'Alice' });
  check('register creates session cookie', r.status === 201 && Boolean(alice.cookie) && r.data.user.role === 'USER', `${r.status} ${JSON.stringify(r.data)}`);
  check('cookie is HttpOnly + SameSite', /HttpOnly/.test(r.headers.get('set-cookie') || '') && /SameSite=Lax/.test(r.headers.get('set-cookie') || ''));
  r = await call(alice, 'POST', '/api/auth/register', { email: 'alice@example.test', password: 'password123' });
  check('duplicate email rejected', r.status === 409);
  r = await call(anon, 'POST', '/api/auth/register', { email: 'not-an-email', password: 'password123' });
  check('invalid email rejected', r.status === 400);
  r = await call(anon, 'POST', '/api/auth/register', { email: 'short@example.test', password: 'short' });
  check('short password rejected', r.status === 400);
  await call(bob, 'POST', '/api/auth/register', { email: 'bob@example.test', password: 'password123', name: 'Bob' });
  r = await call(admin, 'POST', '/api/auth/register', { email: 'admin@example.test', password: 'password123', name: 'Admin' });
  check('ADMIN_EMAILS grants ADMIN role', r.data.user.role === 'ADMIN');
  r = await call(anon, 'GET', '/api/auth/me');
  check('anonymous /me is 401', r.status === 401);
  r = await call(alice, 'GET', '/api/auth/me');
  check('session /me returns the user', r.status === 200 && r.data.user.email === 'alice@example.test' && r.data.via === 'session');
  r = await call(anon, 'POST', '/api/auth/login', { email: 'alice@example.test', password: 'nope' });
  check('wrong password is 401 (generic message)', r.status === 401 && !/email/i.test(r.data.error) === false);
  r = await call(alice, 'PATCH', '/api/auth/me', { notifyPolicy: 'all', name: 'Alice A.' });
  check('settings update', r.status === 200 && r.data.user.notifyPolicy === 'all' && r.data.user.name === 'Alice A.');
  r = await call(alice, 'PATCH', '/api/auth/me', { notifyPolicy: 'bogus' });
  check('invalid notify policy rejected', r.status === 400);

  console.log('\n[P3] Outlook add-in linking');
  r = await call(alice, 'POST', '/api/auth/link-code');
  check('link code issued', r.status === 200 && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(r.data.code), JSON.stringify(r.data));
  const code = r.data.code as string;
  r = await call(anon, 'POST', '/api/auth/link-code/redeem', { code: 'ZZZZ-ZZZZ' });
  check('bad code rejected', r.status === 400 && r.data.code === 'invalid_code');
  r = await call(anon, 'POST', '/api/auth/link-code/redeem', { code: code.toLowerCase().replace('-', ' '), label: 'Outlook on the web' });
  check('code redeems for a bearer token', r.status === 200 && typeof r.data.token === 'string' && r.data.token.startsWith('osg_addin_'), JSON.stringify(r.data));
  const addin: Client = { cookie: null, bearer: r.data.token };
  r = await call(anon, 'POST', '/api/auth/link-code/redeem', { code });
  check('code is single-use', r.status === 400);
  r = await call(addin, 'GET', '/api/auth/me');
  check('bearer token authenticates as Alice', r.status === 200 && r.data.user.email === 'alice@example.test' && r.data.via === 'addin');
  r = await call(addin, 'POST', '/api/auth/link-code');
  check('bearer token cannot mint link codes', r.status === 403);
  r = await call(alice, 'GET', '/api/auth/addin-tokens');
  check('linked add-in listed', r.status === 200 && r.data.tokens.length === 1 && r.data.tokens[0].label === 'Outlook on the web');

  console.log('\n[P4] Add-in analysis is saved, de-duplicated and isolated');
  r = await call(anon, 'POST', '/api/analyze-email', PHISH);
  check('anonymous add-in analysis still works (not saved)', r.status === 200 && r.data.verdict.level === 'CRITICAL' && r.data.meta.saved === false && r.data.meta.reason === 'not_linked', `${r.status} ${JSON.stringify(r.data?.meta)}`);
  r = await call(addin, 'POST', '/api/analyze-email', PHISH);
  check('linked add-in analysis is saved', r.status === 200 && r.data.meta.saved === true && r.data.meta.cached === false && typeof r.data.meta.recordId === 'string', JSON.stringify(r.data?.meta));
  const recordId = r.data.meta.recordId as string;
  r = await call(addin, 'POST', '/api/analyze-email', PHISH);
  check('same email returns the stored analysis (no re-run)', r.status === 200 && r.data.meta.cached === true && r.data.meta.recordId === recordId);
  r = await call(addin, 'POST', '/api/analyze-email', { ...PHISH, force: true });
  check('force re-analyses', r.status === 200 && r.data.meta.cached === false && r.data.meta.recordId === recordId);
  r = await call(alice, 'GET', '/api/mail/messages?provider=outlook');
  check('Alice sees exactly one Outlook record', r.status === 200 && r.data.total === 1 && r.data.items[0].analysisStatus === 'analyzed' && r.data.items[0].riskLevel === 'CRITICAL', JSON.stringify(r.data).slice(0, 200));
  check('record carries sender/subject/message id', r.data.items[0].senderEmail === 'alerts@sbi-secure-login.xyz' && r.data.items[0].internetMessageId === 'abc123@sbi-secure-login.xyz' && r.data.items[0].source === 'addin');
  r = await call(alice, 'GET', `/api/mail/messages/${recordId}`);
  check('detail includes the stored investigation with excerpt only', r.status === 200 && r.data.record.analysis.verdict.riskScore === 100 && r.data.record.analysis.input.message.length <= 600 && r.data.record.analysis.evidence.length > 0);
  r = await call(bob, 'GET', '/api/mail/messages');
  check('Bob sees no records', r.status === 200 && r.data.total === 0);
  r = await call(bob, 'GET', `/api/mail/messages/${recordId}`);
  check("Bob cannot read Alice's record", r.status === 404);
  r = await call(bob, 'POST', `/api/mail/messages/${recordId}/analyze`, {});
  check("Bob cannot analyse Alice's record", r.status === 404);
  r = await call(bob, 'DELETE', `/api/mail/messages/${recordId}`);
  check("Bob cannot delete Alice's record", r.status === 404);
  r = await call(anon, 'GET', '/api/mail/messages');
  check('anonymous mail history is 401', r.status === 401);
  r = await call(alice, 'GET', '/api/mail/messages?search=sbi&filter=critical');
  check('search + filter', r.status === 200 && r.data.total === 1);
  r = await call(alice, 'GET', '/api/mail/messages?filter=not_analyzed');
  check('not-analysed filter empty', r.status === 200 && r.data.total === 0);
  r = await call(alice, 'POST', `/api/mail/messages/${recordId}/analyze`, {});
  check('web analyze returns cached result without a mailbox connection', r.status === 200 && r.data.cached === true);
  r = await call(alice, 'POST', `/api/mail/messages/${recordId}/analyze`, { force: true });
  check('forced web re-analysis without Outlook connection explains what to do', r.status === 409 && r.data.code === 'not_connected');

  console.log('\n[P5] Notifications');
  r = await call(alice, 'GET', '/api/notifications');
  check('Alice has one unread notification (deduplicated across 2 runs)', r.status === 200 && r.data.unread === 1 && r.data.items.length === 1 && r.data.items[0].level === 'CRITICAL', JSON.stringify(r.data));
  const notifId = r.data.items[0].id as string;
  r = await call(bob, 'GET', '/api/notifications');
  check('Bob has none', r.data.unread === 0 && r.data.items.length === 0);
  r = await call(bob, 'POST', `/api/notifications/${notifId}/read`);
  check("Bob cannot touch Alice's notification", r.status === 404);
  r = await call(alice, 'POST', `/api/notifications/${notifId}/read`);
  r = await call(alice, 'GET', '/api/notifications');
  check('mark read', r.data.unread === 0 && r.data.items[0].status === 'read');
  await call(alice, 'POST', `/api/notifications/${notifId}/dismiss`);
  r = await call(alice, 'GET', '/api/notifications');
  check('dismissed hidden from active list', r.data.items.length === 0);
  r = await call(alice, 'GET', '/api/notifications?status=all');
  check('dismissed still visible with status=all', r.data.items.length === 1 && r.data.items[0].status === 'dismissed');
  check('policy matrix', policyAllows('high_only', 'HIGH', 60) && !policyAllows('high_only', 'MEDIUM', 30) && policyAllows('suspicious_and_high', 'MEDIUM', 30) && !policyAllows('suspicious_and_high', 'LOW', 10) && policyAllows('all', 'LOW', 20) && !policyAllows('all', 'LOW', 5) && !policyAllows('off', 'CRITICAL', 100));

  console.log('\n[P6] Connections (no OAuth credentials configured)');
  r = await call(alice, 'GET', '/api/connections');
  check('both providers report not_configured', r.status === 200 && r.data.connections.every((c: any) => c.state === 'not_configured' && c.configured === false));
  r = await call(anon, 'GET', '/api/connections/outlook/start');
  check('anonymous connect redirects to login', r.status === 302 && String(r.headers.get('location')).startsWith('/login'));
  r = await call(alice, 'GET', '/api/connections/outlook/start');
  check('connect without credentials is a clear 503', r.status === 503 && r.data.code === 'not_configured');
  r = await call(alice, 'GET', '/api/connections/gmail/callback?error=access_denied');
  check('vendor error redirects back with message', r.status === 302 && /error=/.test(String(r.headers.get('location'))));
  r = await call(alice, 'POST', '/api/connections/gmail/sync');
  check('sync without connection explains', r.status === 404 && r.data.code === 'not_connected');
  r = await call(alice, 'GET', '/api/connections/nope/start');
  check('unknown provider 404', r.status === 404);

  console.log('\n[P7] Admin authorization');
  r = await call(anon, 'GET', '/api/admin/overview');
  check('anonymous admin is 401', r.status === 401);
  r = await call(alice, 'GET', '/api/admin/overview');
  check('USER role admin is 403', r.status === 403 && r.data.code === 'forbidden');
  r = await call(addin, 'GET', '/api/admin/users');
  check('add-in token of a USER is 403', r.status === 403);
  r = await call(admin, 'GET', '/api/admin/overview');
  check('ADMIN overview', r.status === 200 && r.data.totalUsers === 3 && r.data.emailsAnalyzed === 1 && r.data.highRiskDetections === 1 && r.data.serviceHealth.services.length > 0, JSON.stringify(r.data).slice(0, 200));
  check('health report exposes no secrets', !JSON.stringify(r.data).includes('smoke-test-secret'));
  r = await call(admin, 'GET', '/api/admin/users');
  check('user list with analysis counts', r.status === 200 && r.data.users.length === 3 && r.data.users.find((u: any) => u.email === 'alice@example.test').analysisCount === 1);
  const bobId = r.data.users.find((u: any) => u.email === 'bob@example.test').id;
  const adminId = r.data.users.find((u: any) => u.email === 'admin@example.test').id;
  r = await call(admin, 'GET', '/api/admin/threats');
  check('threat analytics', r.status === 200 && r.data.totalAnalyzed === 1 && r.data.riskDistribution.CRITICAL === 1 && r.data.suspiciousDomains[0].domain === 'sbi-security-update.xyz' && r.data.commonSignals.length > 0, JSON.stringify(r.data).slice(0, 200));
  check('threat analytics has no message bodies', !JSON.stringify(r.data).includes('Dear customer'));
  r = await call(admin, 'GET', '/api/admin/health');
  check('service health', r.status === 200 && r.data.database.ok === true && r.data.services.some((s: any) => s.id === 'gemini' && s.state === 'not_configured'));
  r = await call(admin, 'GET', '/api/admin/audit?limit=100');
  const actions = (r.data.items as any[]).map((i) => i.action);
  check('audit log recorded key events', r.status === 200 && ['user_registered', 'login', 'addin_linked', 'email_analyzed', 'notification_generated', 'settings_changed'].every((a) => actions.includes(a)), actions.join(','));
  check('audit log has no bodies or tokens', !JSON.stringify(r.data).includes('Dear customer') && !JSON.stringify(r.data).includes('osg_addin_'));
  r = await call(admin, 'PATCH', `/api/admin/users/${adminId}`, { status: 'suspended' });
  check('admin cannot suspend self', r.status === 400);
  r = await call(admin, 'PATCH', `/api/admin/users/${bobId}`, { status: 'suspended' });
  check('admin suspends Bob', r.status === 200);
  r = await call(bob, 'GET', '/api/auth/me');
  check('suspended session is revoked', r.status === 401);
  r = await call(anon, 'POST', '/api/auth/login', { email: 'bob@example.test', password: 'password123' });
  check('suspended login is 403', r.status === 403 && r.data.code === 'suspended');
  await call(admin, 'PATCH', `/api/admin/users/${bobId}`, { status: 'active', role: 'ADMIN' });
  r = await call(anon, 'POST', '/api/auth/login', { email: 'bob@example.test', password: 'password123' });
  check('reactivated + promoted', r.status === 200 && r.data.user.role === 'ADMIN');

  console.log('\n[P8] Link Inspector fallback (root cause of "Service error")');
  r = await call(anon, 'POST', '/api/inspect-domain', { url: 'not a url at all' });
  check('invalid URL is a 400 with a clear code', r.status === 400 && r.data.code === 'invalid_url', JSON.stringify(r.data));
  r = await call(anon, 'POST', '/api/inspect-domain', { url: 12345 });
  check('non-string input handled', r.status === 400);
  r = await call(anon, 'POST', '/api/inspect-domain', { url: 'chase-security-restore.cc/auth' });
  check('lookalike flagged deterministically without Gemini', r.status === 200 && r.data.threatLevel === 'HIGH' && r.data.spoofedBrand === 'Chase' && r.data.officialDomain === 'chase.com' && r.data.engine === 'rule-based' && typeof r.data.notice === 'string', JSON.stringify(r.data));
  r = await call(anon, 'POST', '/api/inspect-domain', { url: 'https://www.paypal.com' });
  check('official domain is LOW', r.status === 200 && r.data.threatLevel === 'LOW' && r.data.isSuspicious === false);

  console.log('\n[P9] Deletion, logout, hygiene');
  r = await call(alice, 'DELETE', '/api/mail/history');
  check('delete history', r.status === 200 && r.data.deleted === 1);
  r = await call(alice, 'GET', '/api/mail/messages');
  check('history empty afterwards', r.data.total === 0);
  r = await call(alice, 'GET', '/api/notifications?status=all');
  check('notifications removed with history', r.data.items.length === 0);
  r = await call(alice, 'GET', '/api/auth/addin-tokens');
  const tokenId = r.data.tokens[0].id;
  r = await call(alice, 'DELETE', `/api/auth/addin-tokens/${tokenId}`);
  check('revoke add-in token', r.status === 200);
  r = await call(addin, 'GET', '/api/auth/me');
  check('revoked token no longer works', r.status === 401);
  r = await call(alice, 'POST', '/api/auth/logout');
  check('logout clears cookie', r.status === 200 && alice.cookie === null);
  r = await call(alice, 'GET', '/api/auth/me');
  check('session gone after logout', r.status === 401);
  r = await call(anon, 'GET', '/api/does-not-exist');
  check('unknown API route is JSON 404', r.status === 404 && r.data.code === 'not_found');

  console.log('\n[P10] Provider normalisers & pre-filter (offline)');
  const graph = normalizeGraphMessage({ id: 'AAMk1', internetMessageId: '<X1@mail.example>', conversationId: 'conv1', subject: 'Invoice overdue — pay now', bodyPreview: 'Click http://pay-now-secure.top/x to avoid suspension', receivedDateTime: '2026-09-19T07:00:00Z', isRead: false, hasAttachments: true, webLink: 'https://outlook.live.com/x', from: { emailAddress: { name: 'Billing', address: 'Billing@Example.com' } }, toRecipients: [{ emailAddress: { address: 'me@example.test' } }] });
  check('Graph message normalised', graph?.providerMessageId === 'x1@mail.example' && graph.senderEmail === 'billing@example.com' && graph.urls?.length === 1 && graph.recipients?.length === 1 && graph.isRead === false);
  const gmail = normalizeGmailMessage({ id: '18f0', threadId: 't1', labelIds: ['INBOX', 'UNREAD'], snippet: 'Your parcel is waiting: usps-post-redelivery.top/tracking', internalDate: '1758265200000', payload: { headers: [{ name: 'From', value: '"USPS" <alerts@mail-usps.top>' }, { name: 'Subject', value: 'Delivery attempt failed' }, { name: 'To', value: 'me@example.test, other@example.test' }, { name: 'Message-ID', value: '<g1@mail-usps.top>' }] } });
  check('Gmail message normalised', gmail?.providerMessageId === '18f0' && gmail.senderName === 'USPS' && gmail.senderEmail === 'alerts@mail-usps.top' && gmail.isRead === false && gmail.recipients?.length === 2 && gmail.internetMessageId === 'g1@mail-usps.top');
  check('address parser', parseAddress('Jane <JANE@x.io>').email === 'jane@x.io' && parseAddress('bare@x.io').email === 'bare@x.io' && parseAddress('Just Name').email === null);
  check('html to text keeps link targets', /Reset \(https:\/\/evil\.top\/r\)/.test(htmlToText('<p>Hello<br><a href="https://evil.top/r">Reset</a></p><script>x()</script>')) && !htmlToText('<script>x()</script>ok').includes('x()'));
  const hot = prefilterScore({ subject: 'URGENT: account suspended — verify now', senderEmail: 'alerts@sbi-secure-login.xyz', senderName: 'SBI', snippet: 'Verify at https://sbi-security-update.xyz/verify or lose access', hasAttachments: true });
  const cold = prefilterScore({ subject: 'Lunch on Friday?', senderEmail: 'friend@gmail.com', senderName: 'Friend', snippet: 'Want to grab lunch on Friday?' });
  check('pre-filter separates phishing from benign', hot >= 40 && cold < 10, `hot=${hot} cold=${cold}`);

  await mockedOAuthFlows(alice);

  console.log('\n[P12] Add-in analysis survives a history/database failure');
  r = await call(alice, 'POST', '/api/auth/link-code');
  r = await call(anon, 'POST', '/api/auth/link-code/redeem', { code: r.data.code, label: 'Outlook (failure test)' });
  const addin2: Client = { cookie: null, bearer: r.data.token };
  await db().run('DROP TABLE email_records');
  r = await call(addin2, 'POST', '/api/analyze-email', { ...PHISH, internetMessageId: '<save-fail@example.test>' });
  check('analysis still returns the verdict when history cannot be written', r.status === 200 && r.data.verdict?.level === 'CRITICAL' && r.data.evidence?.length > 0, `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  check('failure is reported in meta, not as an error', r.data.meta?.saved === false && r.data.meta?.reason === 'save_failed' && r.data.meta?.recordId === null, JSON.stringify(r.data?.meta));
  for (const statement of SCHEMA) if (/email_records/.test(statement)) await db().run(statement);
  r = await call(addin2, 'POST', '/api/analyze-email', { ...PHISH, internetMessageId: '<save-fail@example.test>' });
  check('saving resumes once the database is back', r.status === 200 && r.data.meta?.saved === true && typeof r.data.meta?.recordId === 'string', JSON.stringify(r.data?.meta));
  r = await call(alice, 'GET', '/api/mail/messages?provider=outlook&search=blocked');
  check('recovered record is in the history', r.status === 200 && r.data.total === 1 && r.data.items[0].internetMessageId === 'save-fail@example.test' && r.data.items[0].riskLevel === 'CRITICAL', JSON.stringify(r.data).slice(0, 160));

  console.log('\n[P13] Auth rate limiting');
  let limited = false;
  for (let i = 0; i < 30 && !limited; i++) {
    const a = await call(anon, 'POST', '/api/auth/login', { email: 'alice@example.test', password: 'wrong' });
    if (a.status === 429) limited = true;
  }
  check('auth attempts are rate limited', limited);

  server.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll platform checks passed');
  process.exit(failures ? 1 : 0);
}

// ---------------------------------------------------------------------------
// [P11] Mailbox connections end-to-end with mocked Microsoft / Google endpoints.
// Vendor HTTP is intercepted at global fetch; everything else (our own API,
// intel lookups) passes through. No real tenant is contacted.
// ---------------------------------------------------------------------------
function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

async function mockedOAuthFlows(alice: Client) {
  console.log('\n[P11] Outlook & Gmail connections (mocked vendor APIs)');
  process.env.MICROSOFT_CLIENT_ID = 'ms-client';
  process.env.MICROSOFT_CLIENT_SECRET = 'ms-secret';
  process.env.GOOGLE_CLIENT_ID = 'g-client';
  process.env.GOOGLE_CLIENT_SECRET = 'g-secret';

  const realFetch = globalThis.fetch;
  const state = { msRefreshFails: false, msTokenCalls: 0, msRefreshCalls: 0, graphCalls: 0 };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const bodyText = typeof init?.body === 'string' ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : '';
    // ---- Microsoft identity platform
    if (url.startsWith('https://login.microsoftonline.com/')) {
      state.msTokenCalls += 1;
      if (bodyText.includes('grant_type=refresh_token')) {
        state.msRefreshCalls += 1;
        if (state.msRefreshFails) return json({ error: 'invalid_grant', error_description: 'AADSTS70000: refresh token expired' }, 400);
        return json({ access_token: 'ms-access-2', refresh_token: 'ms-refresh-2', expires_in: 3600, scope: 'Mail.Read User.Read' });
      }
      if (!bodyText.includes('code_verifier=')) return json({ error: 'invalid_request' }, 400);
      return json({ access_token: 'ms-access-1', refresh_token: 'ms-refresh-1', expires_in: 3600, scope: 'openid profile email offline_access User.Read Mail.Read' });
    }
    // ---- Microsoft Graph
    if (url.startsWith('https://graph.microsoft.com/v1.0/')) {
      state.graphCalls += 1;
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization || '';
      if (!/^Bearer ms-access-[12]$/.test(auth)) return json({ error: { code: 'InvalidAuthenticationToken', message: 'Access token has expired.' } }, 401);
      if (url.startsWith('https://graph.microsoft.com/v1.0/me?')) return json({ id: 'ms-user-1', mail: 'Alice@Outlook.com' });
      if (url.startsWith('https://graph.microsoft.com/v1.0/me/messages?')) {
        return json({
          value: [
            { id: 'M1', internetMessageId: '<phish-1@mail-usps.top>', conversationId: 'c1', subject: 'Delivery attempt failed — pay redelivery fee', bodyPreview: 'Your parcel is waiting. Pay the $2.99 fee at https://usps-post-redelivery.top/tracking within 24 hours', receivedDateTime: '2026-09-19T08:00:00Z', isRead: false, hasAttachments: true, webLink: 'https://outlook.live.com/M1', from: { emailAddress: { name: 'USPS', address: 'alerts@mail-usps.top' } }, toRecipients: [{ emailAddress: { address: 'alice@outlook.com' } }] },
            { id: 'M2', internetMessageId: '<benign-2@example.com>', conversationId: 'c2', subject: 'Lunch on Friday?', bodyPreview: 'Want to grab lunch on Friday at noon?', receivedDateTime: '2026-09-19T07:00:00Z', isRead: true, hasAttachments: false, from: { emailAddress: { name: 'Friend', address: 'friend@example.com' } }, toRecipients: [{ emailAddress: { address: 'alice@outlook.com' } }] },
          ],
        });
      }
      if (/\/me\/messages\/M1\/attachments/.test(url)) return json({ value: [{ name: 'Invoice.exe', size: 1234, contentType: 'application/octet-stream', isInline: false }] });
      if (/\/me\/messages\/M1\?/.test(url)) return json({ id: 'M1', subject: 'Delivery attempt failed — pay redelivery fee', hasAttachments: true, body: { contentType: 'html', content: '<p>Your parcel is waiting. Pay the $2.99 redelivery fee at <a href="https://usps-post-redelivery.top/tracking">USPS tracking</a> within 24 hours or it will be returned.</p>' }, toRecipients: [{ emailAddress: { address: 'alice@outlook.com' } }] });
      if (/\/me\/messages\/M2\?/.test(url)) return json({ id: 'M2', subject: 'Lunch on Friday?', hasAttachments: false, body: { contentType: 'text', content: 'Want to grab lunch on Friday at noon? Let me know.' }, toRecipients: [{ emailAddress: { address: 'alice@outlook.com' } }] });
      return json({ error: { code: 'ResourceNotFound', message: 'not found' } }, 404);
    }
    // ---- Google OAuth + Gmail
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      if (bodyText.includes('grant_type=refresh_token')) return json({ access_token: 'g-access-2', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.readonly' });
      return json({ access_token: 'g-access-1', refresh_token: 'g-refresh-1', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/gmail.readonly' });
    }
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) return json({});
    if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/')) {
      if (url.includes('/profile')) return json({ emailAddress: 'alice@gmail.com' });
      if (/\/messages\?/.test(url)) return json({ messages: [{ id: 'G1', threadId: 't1' }] });
      if (/\/messages\/G1\?format=metadata/.test(url)) return json({ id: 'G1', threadId: 't1', labelIds: ['INBOX', 'UNREAD'], snippet: 'Your account will be blocked today. Verify immediately: sbi-security-update.xyz/verify', internalDate: '1758265200000', payload: { headers: [{ name: 'From', value: '"SBI Alerts" <alerts@sbi-secure-login.xyz>' }, { name: 'Subject', value: 'URGENT: account blocked' }, { name: 'To', value: 'alice@gmail.com' }, { name: 'Message-ID', value: '<g1@sbi-secure-login.xyz>' }] } });
      if (/\/messages\/G1\?format=full/.test(url)) return json({ id: 'G1', threadId: 't1', labelIds: ['INBOX'], payload: { mimeType: 'multipart/alternative', headers: [{ name: 'Subject', value: 'URGENT: account blocked' }, { name: 'To', value: 'alice@gmail.com' }], parts: [{ mimeType: 'text/plain', body: { data: b64url('Dear customer, your SBI account will be blocked today. Verify immediately: https://sbi-security-update.xyz/verify and share the OTP.') } }, { mimeType: 'application/pdf', filename: 'statement.pdf', body: { size: 900 } }] } });
      return json({ error: { code: 404, message: 'not found' } }, 404);
    }
    return realFetch(input as never, init);
  }) as typeof fetch;

  try {
    let r = await call(alice, 'POST', '/api/auth/login', { email: 'alice@example.test', password: 'password123' });
    check('Alice signs back in', r.status === 200);
    r = await call(alice, 'GET', '/api/connections');
    check('providers now report not_connected (credentials configured)', r.data.connections.every((c: any) => c.state === 'not_connected' && c.configured === true));

    // --- Outlook connect
    r = await call(alice, 'GET', '/api/connections/outlook/start');
    const msLocation = String(r.headers.get('location'));
    check('start redirects to Microsoft with PKCE + state', r.status === 302 && msLocation.startsWith('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?') && /code_challenge_method=S256/.test(msLocation) && /scope=.*Mail\.Read/.test(msLocation), msLocation.slice(0, 120));
    const msState = new URL(msLocation).searchParams.get('state') || '';
    r = await call(alice, 'GET', `/api/connections/outlook/callback?code=abc&state=WRONG`);
    check('callback with a foreign state is rejected', r.status === 302 && /error=/.test(String(r.headers.get('location'))));
    r = await call(alice, 'GET', `/api/connections/outlook/callback?code=abc&state=${encodeURIComponent(msState)}`);
    check('callback stores the connection and returns to the dashboard', r.status === 302 && String(r.headers.get('location')) === '/dashboard/outlook?connected=1', String(r.headers.get('location')));
    r = await call(alice, 'GET', '/api/connections');
    const outlook = r.data.connections.find((c: any) => c.provider === 'outlook');
    check('Outlook connection active with account email', outlook.state === 'active' && outlook.accountEmail === 'alice@outlook.com');
    const encRow = await db().get<{ refresh_token_enc: string; access_token_enc: string }>("SELECT refresh_token_enc, access_token_enc FROM provider_connections WHERE provider = 'outlook'");
    check('tokens are stored encrypted', Boolean(encRow) && !encRow!.refresh_token_enc.includes('ms-refresh') && decryptSecret(encRow!.refresh_token_enc) === 'ms-refresh-1');

    // --- Outlook sync: policy-driven auto analysis
    r = await call(alice, 'POST', '/api/connections/outlook/sync');
    check('sync fetches, stores and auto-analyses the suspicious message only', r.status === 200 && r.data.result.fetched === 2 && r.data.result.newRecords === 2 && r.data.result.autoAnalyzed === 1 && r.data.result.skippedByPolicy === 1, JSON.stringify(r.data?.result || r.data));
    check('sync summary recorded on the connection', typeof r.data.status.lastSyncAt === 'string' && /2 fetched/.test(r.data.status.lastSyncSummary));
    r = await call(alice, 'GET', '/api/mail/messages?provider=outlook');
    const phish = r.data.items.find((i: any) => i.providerMessageId === 'phish-1@mail-usps.top');
    const benign = r.data.items.find((i: any) => i.providerMessageId === 'benign-2@example.com');
    check('records normalised from Graph', Boolean(phish && benign) && phish.senderEmail === 'alerts@mail-usps.top' && phish.isRead === false && phish.hasAttachments === true && benign.analysisStatus === 'not_analyzed' && typeof benign.prefilterScore === 'number');
    check('suspicious message analysed as HIGH/CRITICAL from the fetched body', phish.analysisStatus === 'analyzed' && ['HIGH', 'CRITICAL'].includes(phish.riskLevel) && phish.source === 'sync', `${phish?.analysisStatus} ${phish?.riskLevel}`);
    r = await call(alice, 'GET', `/api/mail/messages/${phish.id}`);
    check('stored analysis records the risky attachment from Graph metadata', r.data.record.analysis.input.email.attachments.some((a: any) => a.name === 'Invoice.exe' && a.risky === true));
    r = await call(alice, 'GET', '/api/notifications');
    check('sync raised a notification for the threat', r.data.unread >= 1 && r.data.items.some((n: any) => n.emailId === phish.id));
    r = await call(alice, 'POST', `/api/mail/messages/${benign.id}/analyze`, {});
    check('manual analysis of a skipped message fetches the body and stores LOW', r.status === 200 && r.data.cached === false && r.data.report.verdict.level === 'LOW', JSON.stringify(r.data).slice(0, 160));
    r = await call(alice, 'POST', '/api/connections/outlook/sync');
    check('second sync is idempotent (no new records, no re-analysis)', r.status === 200 && r.data.result.newRecords === 0 && r.data.result.autoAnalyzed === 0);

    // --- token refresh + expiry handling
    await db().run("UPDATE provider_connections SET token_expires_at = ? WHERE provider = 'outlook'", ['2000-01-01T00:00:00.000Z']);
    const refreshBefore = state.msRefreshCalls;
    r = await call(alice, 'POST', '/api/connections/outlook/sync');
    check('expired access token is refreshed silently', r.status === 200 && state.msRefreshCalls === refreshBefore + 1);
    await db().run("UPDATE provider_connections SET token_expires_at = ? WHERE provider = 'outlook'", ['2000-01-01T00:00:00.000Z']);
    state.msRefreshFails = true;
    r = await call(alice, 'POST', '/api/connections/outlook/sync');
    check('invalid refresh token → clear "reconnect Outlook" error', r.status === 401 && r.data.code === 'expired' && /reconnect Outlook/i.test(r.data.error), JSON.stringify(r.data));
    r = await call(alice, 'GET', '/api/connections');
    check('connection marked expired', r.data.connections.find((c: any) => c.provider === 'outlook').state === 'expired');
    state.msRefreshFails = false;

    // --- Gmail connect + sync
    r = await call(alice, 'GET', '/api/connections/gmail/start');
    const gLocation = String(r.headers.get('location'));
    check('Gmail start redirects to Google with offline access', r.status === 302 && gLocation.startsWith('https://accounts.google.com/o/oauth2/v2/auth?') && /access_type=offline/.test(gLocation) && /gmail\.readonly/.test(gLocation));
    const gState = new URL(gLocation).searchParams.get('state') || '';
    r = await call(alice, 'GET', `/api/connections/gmail/callback?code=xyz&state=${encodeURIComponent(gState)}`);
    check('Gmail callback stores the connection', r.status === 302 && String(r.headers.get('location')) === '/dashboard/gmail?connected=1');
    r = await call(alice, 'POST', '/api/connections/gmail/sync');
    check('Gmail sync analyses the phishing message', r.status === 200 && r.data.result.fetched === 1 && r.data.result.autoAnalyzed === 1, JSON.stringify(r.data?.result || r.data));
    r = await call(alice, 'GET', '/api/mail/messages?provider=gmail');
    const g = r.data.items[0];
    check('Gmail record normalised (sender, unread, message id) and CRITICAL', r.data.total === 1 && g.senderEmail === 'alerts@sbi-secure-login.xyz' && g.senderName === 'SBI Alerts' && g.isRead === false && g.internetMessageId === 'g1@sbi-secure-login.xyz' && g.riskLevel === 'CRITICAL', JSON.stringify(g).slice(0, 200));
    r = await call(alice, 'GET', `/api/mail/messages/${g.id}`);
    check('Gmail attachment metadata captured (never downloaded)', r.data.record.analysis.input.email.attachments.some((a: any) => a.name === 'statement.pdf'));
    r = await call(alice, 'GET', '/api/mail/messages?provider=all&filter=critical');
    check('cross-provider filter', r.data.total >= 1 && r.data.items.every((i: any) => i.riskLevel === 'CRITICAL'));

    // --- disconnect (with history) and audit
    r = await call(alice, 'DELETE', '/api/connections/gmail?history=1');
    check('disconnect Gmail removes tokens and history', r.status === 200 && r.data.removed === true && r.data.deletedHistory === 1 && r.data.status.state === 'not_connected');
    r = await call(alice, 'GET', '/api/mail/messages?provider=gmail');
    check('Gmail history gone', r.data.total === 0);
    const adminClient: Client = { cookie: null, bearer: null };
    await call(adminClient, 'POST', '/api/auth/login', { email: 'admin@example.test', password: 'password123' });
    r = await call(adminClient, 'GET', '/api/admin/audit?limit=200');
    const actions = (r.data.items as any[]).map((i) => i.action);
    check('audit trail covers connect / sync / disconnect', ['outlook_connected', 'gmail_connected', 'mailbox_synced', 'gmail_disconnected'].every((a) => actions.includes(a)), actions.filter((a, i) => actions.indexOf(a) === i).join(','));
    r = await call(adminClient, 'GET', '/api/admin/overview');
    check('admin overview counts the Outlook connection', r.data.connectedOutlook === 0 && r.data.connectedGmail === 0 && r.data.emailsAnalyzed >= 2);
    r = await call(adminClient, 'GET', '/api/admin/health');
    check('health tracked Microsoft Graph + OAuth calls', r.data.services.find((s: any) => s.id === 'microsoft_graph').calls > 0 && r.data.services.find((s: any) => s.id === 'microsoft_oauth').failures >= 1);
  } finally {
    globalThis.fetch = realFetch;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

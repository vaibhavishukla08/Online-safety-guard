# Online Safety Guard — Agentic AI Cyber Defense Assistant

> Investigates suspicious messages, screenshots, links and conversations; gathers and verifies evidence; explains its reasoning; identifies social-engineering techniques; and generates a personalised protection plan.

**Understand → Investigate → Verify → Correlate → Explain → Protect → Educate**

Built with React + TypeScript + Vite + Tailwind, Node/Express, and **Google Gemini 3.8 Flash**.

View the original applet in AI Studio: https://ai.studio/apps/5f7f0658-c84f-44bf-a773-f544fb172afa

---

## Hackathon summary

### Problem
Online scams increasingly rely on social engineering, brand impersonation, malicious links and psychological manipulation. Simple "is this spam?" classifiers give a verdict without evidence, do not verify who the sender claims to be, cannot follow a multi-message scam as it escalates, and leave the victim without concrete next steps.

### Solution
Online Safety Guard combines Gemini-powered language and vision understanding with an **agentic investigation architecture**. A Safety Orchestrator dispatches specialised agents that gather deterministic evidence, verify claimed identities against a known-organization registry, consult external threat intelligence, fuse everything into a transparent score, and guide the user toward the safest response.

### Key innovation
The system does not simply classify a message. It **understands → investigates → verifies → correlates → explains → protects**, and every step is visible in the *AI Investigation Trace* with the exact evidence behind it.

### Agentic AI
The **Safety Orchestrator** decides which agents to run from the evidence it finds — links trigger the URL and Threat-Intelligence agents, an organization claim triggers the Identity agent, money/credential requests trigger the Financial Risk agent, multi-turn input triggers the Conversation agent, persuasion cues trigger the Social-Engineering agent. Agents that are not needed are explicitly *skipped*, with the reason shown in the trace.

### LLM
Google **Gemini 3.8 Flash** (`@google/genai`, structured JSON output with response schemas) for natural-language understanding, screenshot extraction, scam classification, psychological analysis, conversation analysis, evidence-aware protection plans, adaptive coaching scenarios and dashboard summaries.

### Responsible AI
- **LLM output is combined with deterministic signals.** The risk score is a capped sum of named indicators; Gemini's holistic judgement can shift it by at most ±15–20 points and is labelled as such.
- **External evidence is clearly distinguished** from AI interpretation and rule-based checks (every evidence item carries a `Rule-based` / `AI interpretation` / `External source` tag).
- **No false certainty.** Confidence reflects how many independent sources agree; when rules and AI disagree the report says so and lowers confidence.
- **Graceful fallbacks.** Missing keys, rate limits, invalid keys, malformed responses and timeouts all degrade to rule-based results with a visible notice — never a crash, never fabricated intelligence.
- **Sensitive information is minimised.** Manual scans stay in the browser; pattern memory stores only anonymized indicator ids and categories, never message text, senders or images. Suspicious URLs are parsed offline and never fetched. Mailbox analyses are stored per account with a short excerpt only — never full bodies.
- **Honest detection.** Mailbox monitoring is periodic polling (manual *Sync* plus a background interval), and the UI says so; it never claims real-time detection.

---

## Architecture

```
User input (message | screenshot | URL | conversation)
        │
        ▼
┌──────────────────────┐
│  Safety Orchestrator │  understands input, plans, decides which agents run
└──────────┬───────────┘
           │  screenshot → Vision Agent (Gemini multimodal) → structured facts
           ▼
┌──────────────────────┐
│    Message Agent     │  deterministic signal scan + Gemini NLU (type, claims, requests)
└──────────┬───────────┘
           ├── links?            → URL Agent (offline) ─────► Threat Intelligence Agent
           ├── org claim?        → Identity Agent (registry ± Gemini)
           ├── persuasion cues?  → Social Engineering Agent (Gemini, rule fallback)
           ├── money/creds?      → Financial Risk Agent (deterministic)
           └── multi-turn?       → Conversation Agent (Gemini, rule fallback)
                                   (independent agents run in parallel)
           ▼
┌──────────────────────┐
│ Risk Assessment Agent│  evidence fusion → transparent score, level, confidence, Scam DNA
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│   Protection Agent   │  deterministic base plan → Gemini personalisation
└──────────┬───────────┘
           ▼
   Investigation Report + live trace (NDJSON stream)
```

### Accounts, mailboxes, notifications

```
Outlook add-in ──(bearer token from link code)──┐
Outlook mailbox ──(Microsoft Graph, Mail.Read)──┤        ┌── Outlook history   /dashboard/outlook
Gmail mailbox ────(Gmail API, gmail.readonly)───┼─► EmailRecord (provider-independent) ─► same orchestrator
                                                │        ├── Gmail history     /dashboard/gmail
   deterministic pre-filter → capped auto analyses      ├── Threats           /threats
                                                │        ├── Notifications    /notifications (+ home banner, optional browser alerts)
                                                └────────┴── Admin            /admin (overview, users, threat analytics, service health, audit)
```

- **One backend, one model.** Outlook (add-in or Graph) and Gmail messages are normalised into the same `EmailRecord` (`shared/accounts.ts`) and analysed by the existing Safety Orchestrator; results, Scam DNA, evidence, trace and protection plan are stored on the record.
- **No duplicate analyses.** Uniqueness is `(user, provider, providerMessageId)` — the Internet `Message-ID` for Outlook (identical in Office.js and Graph) and the Gmail message id. Re-opening an analysed email returns the stored result; *Re-analyze* forces a fresh run.
- **Add-in ↔ account link.** Outlook loads the task pane in an iframe where third-party cookies are unreliable, so the pane links to an account with a one-time code from *Settings → Outlook add-in* and then uses a revocable bearer token. Unlinked, the add-in behaves exactly as before (analysis only, nothing saved).

### Repository layout

```
server.ts                       entry: opens the DB, mounts server/app.ts, Vite (dev) / static dist (prod), sync scheduler
server/
  app.ts                        Express app factory (routes, auth middleware, JSON error handler)
  config.ts                     env access, timeouts, limits, rate limit, auth/sync/OAuth settings
  db/                           persistence: node:sqlite (default) or PostgreSQL (DATABASE_URL); dialect-neutral schema
  auth/                         scrypt passwords, AES-GCM token encryption, sessions + add-in tokens, Express middleware
  providers/                    EmailProvider interface; Outlook (Microsoft OAuth + Graph) and Gmail (Google OAuth + Gmail API)
  services/users.ts             accounts, roles (ADMIN_EMAILS)
  services/connections.ts       OAuth state/PKCE, encrypted tokens, silent refresh, expiry handling
  services/emails.ts            EmailRecord store: upsert/dedupe, search, filters, pagination, stored analysis
  services/emailAnalysis.ts     shared "analyse email for user" path + deterministic pre-filter
  services/sync.ts              polling sync: fetch → upsert → pre-filter → capped auto analyses → notifications
  services/notifications.ts     per-policy alerts, one per email
  services/audit.ts, health.ts, admin.ts   audit log, service health tracker, admin analytics
  gemini/client.ts              generateJson(): timeouts, schema output, error classification
  rules/signals.ts              deterministic signal detectors (urgency, credentials, rewards…)
  rules/brands.ts               known-organization registry (banks, gov, delivery, social…)
  rules/scoring.ts              score → level, confidence, Scam DNA
  intel/index.ts                RDAP, DNS, VirusTotal, Safe Browsing, urlscan, AbuseIPDB adapters
  agents/orchestrator.ts        Safety Orchestrator (conditional execution, parallel stages)
  agents/*Agent.ts              specialised agents
  services/incidentResponse.ts  "I already interacted" playbooks ± Gemini tailoring
  services/coach.ts             adaptive Safety Coach (Gemini + local scenario bank)
  services/dashboard.ts         anonymized-stats summary
  services/email.ts             Outlook email envelope → existing investigation request (no analysis here)
  routes/api.ts                 /api/investigate(/stream), analyze-email(/stream) [+ save for linked users], incident-response, coach, dashboard, health
  routes/auth.ts, connections.ts, mail.ts, notifications.ts, admin.ts   account & mailbox APIs
  routes/legacy.ts              original endpoints preserved (inspect-domain rewritten with rule-based fallback)
shared/investigation.ts         investigation contracts shared by server and client
shared/accounts.ts              account, EmailRecord, notification and admin contracts
src/
  components/InvestigationConsole.tsx   input modes + live trace
  components/investigation/*            report panels (verdict, Show Me Why, trace, DNA, plan…)
  components/HomeDashboard.tsx          home + Demo Mode
  components/IncidentResponse.tsx       incident page (interactive + original guide)
  components/SafetyCoach.tsx            adaptive coach (+ original quiz)
  components/SafetyDashboard.tsx        personal safety dashboard
  utils/patternMemory.ts                anonymized on-device pattern memory
  api/client.ts                         typed API client with streaming (+ account/mail/notification/admin calls)
  auth/AuthContext.tsx                  session state, notification polling, browser notifications
  router.ts                             tiny history router (path pages + original hash tabs)
  pages/                                Login, Mailbox (Outlook/Gmail), Threats, Notifications, Settings, Admin
  components/mail/*                     email list, detail (stored analysis → View Investigation → Re-analyze)
  outlook/                              Outlook task pane (Office.js reader, account linking, compact report view)
outlook/
  manifest.xml                  Outlook add-in manifest (single source of truth; published at /manifest.xml)
  taskpane.html, commands.html  add-in pages (built by Vite alongside index.html)
scripts/smoke.ts                offline pipeline test suite
scripts/smoke-platform.ts       offline platform test suite (accounts, linking, isolation, admin, notifications)
scripts/outlook-manifest.mjs    writes a localhost/tunnel variant of the manifest
render.yaml                     Render blueprint (web service + PostgreSQL + env var list)
```

---

## Run locally

**Prerequisites:** Node.js 20+ (tested on 24).

```bash
npm install
cp .env.example .env          # add GEMINI_API_KEY, SESSION_SECRET, ADMIN_EMAILS (and any OAuth / intel keys you have)
npm run dev                   # http://localhost:3000  (SQLite database is created in ./data/)
```

Create an account from **Sign in → Create an account**; an email listed in `ADMIN_EMAILS` gets the ADMIN role.

Other scripts:

| Script | Purpose |
|---|---|
| `npm run dev:watch` | dev server that restarts on server changes |
| `npm run typecheck` | `tsc --noEmit` (strict mode) |
| `npm test` | offline smoke tests: agent pipeline + platform (accounts, linking, isolation, admin) |
| `npm run test:pipeline` / `npm run test:platform` | run one suite |
| `npm run build` | Vite build + esbuild server bundle → `dist/` (also refreshes the export zip) |
| `npm start` | serve the production build |
| `npm run zip` | regenerate `public/online-safety-guard.zip` for the footer Export link |
| `npm run manifest:validate` | validate `outlook/manifest.xml` with Microsoft's add-in validator |
| `npm run manifest:local` | write `outlook/manifest.local.xml` pointed at `https://localhost:3000` |

### Environment variables

| Variable | Required | Effect when missing |
|---|---|---|
| `GEMINI_API_KEY` | for AI features | deterministic mode: rules, URL analysis, identity registry, RDAP/DNS still run; screenshot reading unavailable |
| `GEMINI_MODEL` | no | defaults to `gemini-3.8-flash` |
| `VIRUSTOTAL_API_KEY` | no | VirusTotal reports "not configured" |
| `GOOGLE_SAFE_BROWSING_API_KEY` | no | Safe Browsing reports "not configured" |
| `URLSCAN_API_KEY` | no | urlscan.io reports "not configured" |
| `ABUSEIPDB_API_KEY` | no | AbuseIPDB reports "not configured" |
| `GEMINI_TIMEOUT_MS`, `GEMINI_VISION_TIMEOUT_MS`, `INTEL_TIMEOUT_MS` | no | defaults 25s / 35s / 7s |
| `RATE_LIMIT_PER_MINUTE` | no | default 30 investigation requests per IP per minute |
| `GEMINI_BASE_URL` | no | proxy / local mock override |
| `PORT` | no | default 3000 |
| `APP_BASE_URL` | production | public origin for OAuth redirect URIs; on Render `RENDER_EXTERNAL_URL` is used automatically |
| `SESSION_SECRET` | production | ephemeral secret generated at boot → sessions and stored mailbox tokens reset on every restart |
| `TOKEN_ENCRYPTION_KEY` | no | defaults to `SESSION_SECRET` |
| `ADMIN_EMAILS` | for /admin | nobody is an administrator |
| `DATABASE_URL` | production | SQLite file (`DATABASE_FILE`, default `./data/online-safety-guard.sqlite`) — data does not survive a Render redeploy |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` (`MICROSOFT_TENANT`) | for Connect Outlook | "Outlook sign-in is not configured on this server" |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for Connect Gmail | "Gmail sign-in is not configured on this server" |
| `SYNC_INTERVAL_MINUTES`, `SYNC_MAX_MESSAGES`, `SYNC_AUTO_ANALYZE_MAX`, `SYNC_AUTO_ANALYZE_THRESHOLD` | no | 15 min / 50 / 5 / 20 |
| `AUTH_RATE_LIMIT`, `SESSION_TTL_HOURS`, `PROVIDER_TIMEOUT_MS` | no | 20 attempts per 15 min / 168 h / 15 s |

RDAP (domain age) and DNS lookups are keyless and always active. See `.env.example` for the annotated list.

---

## API

| Endpoint | Description |
|---|---|
| `GET /api/health` | capability report (AI + which intel sources are configured) |
| `POST /api/investigate` | full investigation → `InvestigationReport` (JSON) |
| `POST /api/investigate/stream` | same, streamed as NDJSON `{type:'trace'|'result'|'error'}` events |
| `POST /api/analyze-email` | Outlook add-in channel: email envelope → same orchestrator → `InvestigationReport` |
| `POST /api/analyze-email/stream` | same, streamed as NDJSON |
| `POST /api/incident-response` | `{actions:[…], context:{…}}` → tailored `IncidentPlan` |
| `POST /api/coach/scenario` | `{progress, excludeIds}` → adaptive `CoachScenario` |
| `POST /api/dashboard/summary` | `{stats}` → short AI summary |
| `POST /api/analyze-message`, `/api/extract-image` | original endpoints, unchanged |
| `POST /api/inspect-domain` | Link Inspector — deterministic verdict, Gemini enrichment with explicit fallback (`engine`, `notice`) |
| `POST /api/auth/register` · `login` · `logout` · `GET/PATCH /api/auth/me` | accounts (HTTP-only session cookie) |
| `POST /api/auth/link-code` · `POST /api/auth/link-code/redeem` · `GET/DELETE /api/auth/addin-tokens` | Outlook add-in linking (one-time code → revocable bearer token) |
| `GET /api/connections` · `GET /api/connections/:provider/start` · `/callback` · `POST …/sync` · `DELETE …/:provider` | Outlook / Gmail OAuth, sync, disconnect |
| `GET /api/mail/messages?provider&search&filter&page&pageSize&sort` · `GET/DELETE /api/mail/messages/:id` · `POST …/:id/analyze(/stream)` · `DELETE /api/mail/history` | mailbox history (own records only) |
| `GET /api/notifications` · `POST …/read-all` · `POST …/:id/read` · `/dismiss` | in-app alerts |
| `GET /api/admin/overview` · `users` · `PATCH users/:id` · `threats` · `health` · `audit` | ADMIN role only |

Investigation body: `{ inputType: 'message'|'url'|'conversation'|'screenshot', message?, sender?, platform?, url?, conversation?, imageBase64?, imageMime? }`.

Email body (sent by the task pane): `{ subject, sender, senderEmail, body, urls[], recipientCount, attachments:[{name,size,contentType}], truncated, internetMessageId?, itemId?, receivedAt?, force? }` — mapped server-side to `inputType: 'email'`; attachments are metadata only and are never downloaded. Linked callers receive `meta: { saved, cached, recordId }`.

---

## Accounts, Outlook & Gmail history, notifications, admin

| Page | What it does |
|---|---|
| `/login` | email + password sign-in / sign-up (scrypt hashes, HTTP-only `SameSite=Lax` session cookie, 7-day expiry, rate-limited) |
| `/dashboard/outlook`, `/dashboard/gmail` | connection status, **Connect / Sync / Refresh / Disconnect**, last sync time, message history with search, filters (All · Safe · Low · Medium · High · Critical · Analysed · Not analysed), pagination; select a message → stored analysis (risk score, level, category, signals, Scam DNA, evidence, recommended action) → **View Investigation** (full report) → **Re-analyze**; unanalysed → **Analyze Email** |
| `/threats` | all analysed emails across providers, highest risk first |
| `/notifications` | alerts (unread / read / dismissed) with *View Email*, *View Investigation*, *Dismiss*; unread alerts also appear on the home dashboard |
| `/settings` | profile, notification policy (High risk only · Suspicious + high · All threats · Disabled), browser notifications opt-in, add-in link codes + revocation, disconnect providers, delete history |
| `/admin`, `/admin/users`, `/admin/threats`, `/admin/health`, `/admin/audit` | ADMIN role: overview KPIs, user list (suspend / role), threat analytics (categories, risk distribution, common signals, suspicious domains, recent detections, 14-day trend), service health (Gemini, intel sources, Microsoft/Google OAuth, API error rate, recent failures, rate limits, sync), audit log |

**Sync policy (honest polling).** A sync fetches the newest `SYNC_MAX_MESSAGES` messages (metadata only), scores new ones with the deterministic pre-filter (signals in subject/sender/snippet, suspicious links, attachments, display-name mismatch) and spends at most `SYNC_AUTO_ANALYZE_MAX` full analyses on the highest-scoring messages above `SYNC_AUTO_ANALYZE_THRESHOLD`. Everything else stays *Not analysed* until the user clicks *Analyze Email*. The background loop runs every `SYNC_INTERVAL_MINUTES` for every active connection; `0` disables it (manual *Sync* only).

**Privacy.** Stored per email: provider, message ids, sender, subject, date, read state, links, attachment names, risk verdict, the analysis (with a ≤600-character excerpt of the analysed text) and timestamps — never the full body. Bodies are fetched from the mailbox only for the analysis you (or your sync policy) request. OAuth refresh tokens are AES-256-GCM encrypted at rest; passwords are scrypt hashes; session and add-in tokens are stored as SHA-256 hashes. Users only ever see their own records (every query is scoped by user id; the platform smoke test verifies cross-user access returns 404). Audit logs and admin analytics never contain bodies or tokens.

### Microsoft configuration (Connect Outlook)

1. Azure portal → **App registrations → New registration**. Supported account types: *Accounts in any organizational directory and personal Microsoft accounts*.
2. **Authentication → Add a platform → Web** → redirect URI `https://online-safety-guard.onrender.com/api/connections/outlook/callback` (add `http://localhost:3000/api/connections/outlook/callback` for local testing).
3. **Certificates & secrets → New client secret** → copy the *value*.
4. **API permissions → Microsoft Graph → Delegated**: `openid`, `profile`, `email`, `offline_access`, `User.Read`, `Mail.Read` (read-only; no application permissions).
5. Set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` (and `MICROSOFT_TENANT=common` unless single-tenant).

### Google configuration (Connect Gmail)

1. Google Cloud console → create/select a project → **APIs & Services → Library → Gmail API → Enable**.
2. **OAuth consent screen**: External; add scopes `openid`, `email`, `https://www.googleapis.com/auth/gmail.readonly`; add test users while the app is in *Testing*.
3. **Credentials → Create credentials → OAuth client ID → Web application** → authorized redirect URI `https://online-safety-guard.onrender.com/api/connections/gmail/callback` (plus the localhost variant for development).
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

### Render configuration

- Build `npm ci && npm run build`, start `npm start`, health check `/api/health`, Node ≥ 22.13 (`engines` in package.json; `render.yaml` pins 24).
- Create a **PostgreSQL** instance and set `DATABASE_URL` to its internal connection string — without it the SQLite file lives on the ephemeral disk and is wiped on every deploy.
- Set `SESSION_SECRET` (generate), `GEMINI_API_KEY`, `ADMIN_EMAILS`, the Microsoft/Google client ids + secrets and any intel keys. `APP_BASE_URL` is optional on Render (`RENDER_EXTERNAL_URL` is used).
- The single origin serves the SPA, the API, `/manifest.xml`, `/outlook/taskpane.html` and the icons, so no CORS configuration is needed; the server trusts Render's proxy (`trust proxy`) for secure cookies and client IPs.
- `render.yaml` in the repo documents all of the above (usable as a Blueprint for a fresh stack).

---

## Outlook add-in

The add-in adds an **Analyze with Online Safety Guard** button to the message-read ribbon (Outlook on the web, new Outlook, and classic Outlook desktop). Clicking it opens a task pane that reads the open email with Office.js (subject, sender, body text, attachment names — the mailbox is never enumerated), posts it to `/api/analyze-email/stream`, and shows the same risk score, scam type, red flags, social-engineering profile, protection plan and investigation trace as the web app. No separate detector: it is the same Safety Orchestrator, agents and Gemini model.

| Piece | Location |
|---|---|
| Manifest (source) | `outlook/manifest.xml` |
| Manifest (published) | `https://online-safety-guard.onrender.com/manifest.xml` (also `/outlook/manifest.xml`) |
| Task pane | `https://online-safety-guard.onrender.com/outlook/taskpane.html` |
| Function file | `https://online-safety-guard.onrender.com/outlook/commands.html` |
| Icons | `/icon-16.png`, `/icon-32.png`, `/icon-64.png`, `/icon-80.png`, `/icon-128.png` |

The same server serves the web app, the API and the add-in pages, so the manifest only needs the app's HTTPS origin. Outlook loads add-ins over HTTPS only.

### Sideload (hosted build)

1. Open Outlook on the web (`https://outlook.office.com` or `https://outlook.live.com`) or new Outlook for Windows.
2. Open any message → **⋯** (More actions) → **Get Add-ins** (or *Apps* → *Add apps* → *My add-ins*).
3. Under **Custom Addins** choose **Add a custom add-in → Add from URL** and paste
   `https://online-safety-guard.onrender.com/manifest.xml` (or *Add from file* with `outlook/manifest.xml`).
4. Accept the warning; the add-in appears under *Custom add-ins*.
5. Open a message → ribbon / **⋯** → **Online Safety Guard → Analyze with Online Safety Guard**. The pane analyses the message automatically and re-analyses when you switch messages while it is pinned.

Classic Outlook desktop (Microsoft 365 / 2019+): **File → Manage Add-ins** opens the same web dialog. On Mac: **Tools → Get Add-ins → My add-ins → Add a custom add-in**.

### Sideload against a local dev server

```bash
npx office-addin-dev-certs install      # one-time: trusted localhost certificate
HTTPS=true npm run dev                   # https://localhost:3000 (PowerShell: $env:HTTPS='true'; npm run dev)
npm run manifest:local                   # writes outlook/manifest.local.xml → https://localhost:3000
```

Then sideload `outlook/manifest.local.xml` with *Add from file* (it has its own Id and shows as "Online Safety Guard (Local)", so it can sit next to the hosted one). Outlook must be able to open `https://localhost:3000/outlook/taskpane.html` in a browser without a certificate warning first.

### Test without Outlook

`http://localhost:3000/outlook/taskpane.html` in a normal browser shows a paste-an-email form that runs the same analysis — useful for checking the report view. `npm test` covers the email → investigation mapping (section 7). `npm run manifest:validate` runs Microsoft's manifest validator.

---

## How to test each feature

1. **Demo Mode** — Home → any of the 8 scenarios. Watch the trace: different scenarios run different agents (e.g. the OTP control skips URL/Intel/Financial; the conversation runs the Conversation Agent).
2. **Score breakdown / Show Me Why** — open any result; expand *Score breakdown*, click *Show Me Why* for numbered evidence with source tags.
3. **Identity check** — SBI demo: claimed *State Bank of India* vs observed `sbi-security-update.xyz`.
4. **External evidence** — any demo with a link: RDAP + DNS return data; keyed sources show *Not configured* until keys are added.
5. **Social engineering** — Psychological Attack panel (primary/secondary tactics, attacker goal). With Gemini: intensity-weighted; without: pattern-based.
6. **Conversation Analyzer** — Investigate → Conversation → *Load sample* → stages + escalation.
7. **Screenshot** — Investigate → Screenshot → upload an image (needs `GEMINI_API_KEY`; otherwise a clear message asks you to paste the text).
8. **I Already Interacted** — bottom of any report or the *Incident* tab → select actions → plan tailored to the scam (India: 1930 / cybercrime.gov.in; elsewhere: 7726 / FTC / IC3).
9. **Scam DNA** — evidence-backed 0–10 profile on every report.
10. **Pattern memory** — run two similar scams; the second report shows "matches the pattern … seen in N earlier scans"; Dashboard lists recurring combinations.
11. **Safety Coach** — answer scenarios; difficulty rises after 3 correct in a row, weak categories are re-targeted.
12. **Dashboard** — KPIs, most common threats/tactics, risk distribution, AI summary.
13. **Error handling** — empty input, invalid URL, oversize message, missing key, rate limit (429 after 30/min) all return clear messages; AI failures fall back to rules (`npm test` covers validation).
14. **Automated** — `npm test` (offline) and `npm run typecheck`.
15. **Outlook add-in** — sideload `outlook/manifest.xml` (see *Outlook add-in* above), open a phishing email, click **Analyze with Online Safety Guard**.
16. **Saved add-in history** — Settings → *Generate link code* → in the pane *Link account* → analyse an email → it appears under **Outlook** on the website; analysing the same email again returns the saved result.
17. **Mailbox sync** — with OAuth configured: Outlook/Gmail → *Connect* → consent → *Sync* → history fills; suspicious messages are analysed automatically (within the per-sync budget) and raise notifications.
18. **Notifications** — after a high-risk analysis the home dashboard shows the alert (View Email / View Investigation / Dismiss); Settings lets you choose the policy and turn on browser notifications.
19. **Admin** — sign in with an `ADMIN_EMAILS` account → *Admin*; a normal user gets 403 on `/api/admin/*` and an "Administrator access required" page.
20. **Link Inspector errors** — an invalid URL returns "Invalid URL…", a missing/rate-limited Gemini returns a rule-based verdict with a visible notice instead of "Service error".

---

## Demo flow (≈3 minutes)

1. **Home** — point at the pipeline strip: *Orchestrator → Understand → Investigate & verify → Correlate & score → Protect & educate*.
2. **Bank phishing (SBI)** demo — watch the live trace: Message → URL → Identity mismatch → Threat Intel → Risk → Protection. Show the **100/100 CRITICAL** score breakdown, then **Show Me Why**.
3. Scroll to **Identity Check** (claimed vs observed), **External Evidence** (labelled sources), **Scam DNA**.
4. Click **I entered my password** + **I shared an OTP** → *Generate Incident Response Plan* → critical, SBI-specific steps.
5. **Genuine OTP (control)** demo — LOW, most agents skipped: the system does not over-flag.
6. **Fake job conversation** demo — Conversation Agent stages and hook-then-ask escalation.
7. **Dashboard** — pattern memory has already spotted recurring combinations. **Coach** — one adaptive question.

---

## Limitations

- **Gemini is required** for screenshot reading, AI narratives and personalised plans; without a key the app runs in deterministic mode and says so.
- **External intelligence coverage depends on keys.** Fictional demo domains are unregistered, so RDAP reports "no record" and DNS "does not resolve" — that is the honest result, not an error.
- The **brand registry** covers ~65 organizations; unknown organizations are checked by Gemini with lower weight and are clearly labelled as AI-assessed.
- **Deterministic detectors are regex-based** and tuned for English and Indian-English messages; other languages rely on Gemini.
- **Rate limiting, caching and the service-health counters are in-memory** (single instance). Manual-scan history and pattern memory live in the browser; mailbox history lives in the database.
- **Mailbox monitoring is polling**, not push: new mail is noticed at the next sync (manual or every `SYNC_INTERVAL_MINUTES`). Free Render instances sleep when idle, so background syncs only run while the service is awake.
- **PostgreSQL support is written against the shared SQL subset but is not covered by the tests.** The platform smoke test always runs against an in-memory SQLite database and does **not** verify the Postgres path. After provisioning Postgres and setting `DATABASE_URL`, verify it by running the application against it: start the server, check `/api/health` reports `database.ok: true`, sign up, and connect/sync a mailbox.
- **Connect Outlook / Gmail need the vendor app registrations described above**; until the client ids/secrets are set the buttons explain that the server is not configured. The OAuth code paths were exercised with mocked vendor responses in tests, not against live Microsoft/Google tenants.
- Gemini's structured output is validated (exact-substring highlights, bounded numbers, schema shapes), but wording quality still depends on the model.

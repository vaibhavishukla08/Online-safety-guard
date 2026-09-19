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
- **Sensitive information is minimised.** Reports stay in the browser; pattern memory stores only anonymized indicator ids and categories, never message text, senders or images. Suspicious URLs are parsed offline and never fetched.

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

### Repository layout

```
server.ts                       Express entry (Vite middleware in dev, static dist in prod)
server/
  config.ts                     env access, timeouts, limits, rate limit
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
  routes/api.ts                 /api/investigate(/stream), incident-response, coach, dashboard, health
  routes/legacy.ts              original endpoints preserved verbatim
shared/investigation.ts         contracts shared by server and client
src/
  components/InvestigationConsole.tsx   input modes + live trace
  components/investigation/*            report panels (verdict, Show Me Why, trace, DNA, plan…)
  components/HomeDashboard.tsx          home + Demo Mode
  components/IncidentResponse.tsx       incident page (interactive + original guide)
  components/SafetyCoach.tsx            adaptive coach (+ original quiz)
  components/SafetyDashboard.tsx        personal safety dashboard
  utils/patternMemory.ts                anonymized on-device pattern memory
  api/client.ts                         typed API client with streaming
scripts/smoke.ts                offline test suite (npm test)
```

---

## Run locally

**Prerequisites:** Node.js 20+ (tested on 24).

```bash
npm install
cp .env.example .env          # add GEMINI_API_KEY (and any threat-intel keys you have)
npm run dev                   # http://localhost:3000
```

Other scripts:

| Script | Purpose |
|---|---|
| `npm run dev:watch` | dev server that restarts on server changes |
| `npm run typecheck` | `tsc --noEmit` (strict mode) |
| `npm test` | offline smoke test of the agent pipeline |
| `npm run build` | Vite build + esbuild server bundle → `dist/` (also refreshes the export zip) |
| `npm start` | serve the production build |
| `npm run zip` | regenerate `public/online-safety-guard.zip` for the footer Export link |

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

RDAP (domain age) and DNS lookups are keyless and always active.

---

## API

| Endpoint | Description |
|---|---|
| `GET /api/health` | capability report (AI + which intel sources are configured) |
| `POST /api/investigate` | full investigation → `InvestigationReport` (JSON) |
| `POST /api/investigate/stream` | same, streamed as NDJSON `{type:'trace'|'result'|'error'}` events |
| `POST /api/incident-response` | `{actions:[…], context:{…}}` → tailored `IncidentPlan` |
| `POST /api/coach/scenario` | `{progress, excludeIds}` → adaptive `CoachScenario` |
| `POST /api/dashboard/summary` | `{stats}` → short AI summary |
| `POST /api/analyze-message`, `/api/extract-image`, `/api/inspect-domain` | original endpoints, unchanged |

Investigation body: `{ inputType: 'message'|'url'|'conversation'|'screenshot', message?, sender?, platform?, url?, conversation?, imageBase64?, imageMime? }`.

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
- **Rate limiting and caching are in-memory** (single instance). Pattern memory and history live in the browser only.
- Gemini's structured output is validated (exact-substring highlights, bounded numbers, schema shapes), but wording quality still depends on the model.

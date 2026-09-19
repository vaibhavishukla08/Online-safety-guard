/**
 * Legacy endpoints preserved verbatim from the original single-file server so
 * existing clients keep working:
 *
 *   POST /api/extract-image    – screenshot OCR
 *   POST /api/analyze-message  – single-shot Gemini analysis with heuristic fallback
 *   POST /api/inspect-domain   – quick URL / domain inspection
 *
 * The new agentic pipeline lives in ../agents and ./api.ts.
 */
import { Router, type Request } from "express";
import { Type } from "@google/genai";
import { generateJson, getGenAI, isGeminiConfigured } from "../gemini/client";
import { GEMINI_MODEL, LIMITS } from "../config";
import { checkRateLimit } from "../utils/http";
import { analyzeUrl } from "../agents/urlAgent";
import { findOrganizationByName } from "../rules/brands";

function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  return (Array.isArray(fwd) ? fwd[0] : fwd?.split(",")[0])?.trim() || req.ip || "unknown";
}

export const legacyRouter = Router();

// Quick heuristic rule-based analyzer for instant fallback & baseline scanning
function ruleBasedScan(message: string, sender: string = "", platform: string = "") {
  const text = (message + " " + sender).toLowerCase();
  const flags: Array<{ flag: string; evidence: string; severity: "high" | "medium" | "low" }> = [];
  const tactics: string[] = [];
  const highlights: Array<{ text: string; category: "danger" | "warning" | "suspicious_link"; explanation: string }> = [];

  let score = 5; // baseline

  // Link detection
  const urlRegex = /(https?:\/\/[^\s]+|[a-zA-Z0-9-]+\.(?:top|xyz|cc|buzz|club|cam|work|rest|shop|live|fit|online|link|info|tk|ml|ga|cf|gq|zip|mov)[^\s]*)/gi;
  const matches = message.match(urlRegex) || [];
  for (const url of matches) {
    if (/(\.top|\.xyz|\.cc|\.buzz|\.club|\.rest|\.cam|\.tk|\.ml|\.ga|\.cf|\.gq|\.zip)/i.test(url)) {
      flags.push({
        flag: "High-risk scam domain extension",
        evidence: url,
        severity: "high",
      });
      tactics.push("Suspicious Web Redirect");
      highlights.push({
        text: url,
        category: "danger",
        explanation: "Domain uses a cheap, high-abuse top-level domain frequently used by phishing kits.",
      });
      score += 45;
    } else {
      highlights.push({
        text: url,
        category: "suspicious_link",
        explanation: "Direct web link inside unsolicited message.",
      });
      score += 15;
    }
  }

  // Brand spoofing + urgency patterns
  const urgencyWords = ["immediately", "within 24 hours", "within 15 minutes", "account suspended", "action required", "unauthorized access", "card blocked", "urgent"];
  for (const word of urgencyWords) {
    if (text.includes(word)) {
      flags.push({
        flag: "Artificial urgency trigger",
        evidence: word,
        severity: "medium",
      });
      tactics.push("Psychological Urgency & Fear");
      highlights.push({
        text: word,
        category: "warning",
        explanation: "Scammers use extreme time constraints to bypass your critical thinking.",
      });
      score += 20;
      break;
    }
  }

  // Financial & credential demands
  const credentialWords = ["passcode", "otp", "2fa code", "verification code", "gift card", "apple card", "crypto", "wire transfer", "bitcoin", "seed phrase", "ssn", "social security"];
  for (const word of credentialWords) {
    if (text.includes(word)) {
      flags.push({
        flag: "Sensitive credential or untraceable payment demand",
        evidence: word,
        severity: "high",
      });
      tactics.push("Credential Harvesting / Irreversible Payment");
      highlights.push({
        text: word,
        category: "danger",
        explanation: "Demands sensitive security codes, crypto, or untraceable gift cards.",
      });
      score += 35;
      break;
    }
  }

  // Fake job / easy money
  const jobWords = ["$500-$1200/day", "$500/day", "daily pay", "task reviewer", "work from home 1 hour", "telegram recruiter", "hr recruiter"];
  for (const word of jobWords) {
    if (text.includes(word)) {
      flags.push({
        flag: "Unrealistic high-pay task or job offer",
        evidence: word,
        severity: "high",
      });
      tactics.push("Advance Fee Task Scam");
      highlights.push({
        text: word,
        category: "danger",
        explanation: "Classic task scam promising exorbitant daily earnings with minimal effort.",
      });
      score += 40;
      break;
    }
  }

  // Package delivery fee smishing
  if ((text.includes("usps") || text.includes("ups") || text.includes("fedex") || text.includes("dhl") || text.includes("parcel")) && (text.includes("delivery") || text.includes("redelivery") || text.includes("fee") || text.includes("address missing"))) {
    flags.push({
      flag: "Package redelivery smishing pattern",
      evidence: "Postal service notice requiring fee/link click",
      severity: "high",
    });
    tactics.push("Smishing / Delivery Impersonation");
    score += 40;
  }

  score = Math.min(100, Math.max(0, score));

  let safetyStatus: "SAFE" | "SUSPICIOUS" | "DANGEROUS_SCAM" = "SAFE";
  if (score >= 60) safetyStatus = "DANGEROUS_SCAM";
  else if (score >= 25) safetyStatus = "SUSPICIOUS";

  return {
    safetyStatus,
    riskScore: score,
    scamType: score > 50 ? "Suspicious Message / Potential Scam" : "Standard Message",
    verdictSummary: score > 50
      ? "Warning: This message contains strong indicators of fraudulent intent, deceptive links, or pressure tactics."
      : "The message does not trigger typical scam signatures, but always verify sender identity.",
    redFlags: flags,
    tacticsUsed: Array.from(new Set(tactics)),
    highlightPhrases: highlights,
    safetyAdvice: {
      immediateActions: [
        "Do NOT click links or download attachments directly from this message.",
        "Verify independently by visiting the official website or app separately.",
        "Block the sender if unsolicited.",
      ],
      whatNeverToDo: [
        "Never share One-Time Passcodes (OTP), passwords, or 2FA credentials.",
        "Never send payments via gift cards, wire transfer, or cryptocurrency.",
      ],
      officialVerificationStep: "Navigate to the company's verified app or web address directly, never using provided links.",
    },
    recommendedResponse: "Delete or mark as spam. Do not reply, as replying confirms your number or email is active.",
    senderAssessment: {
      isSenderSuspicious: sender.includes(".top") || sender.includes("+18") || sender.length > 20,
      notes: sender ? `Sender identifier '${sender}' should be verified through official channels.` : "Sender details not specified.",
    },
  };
}

// Extract text from image (Screenshot OCR)
legacyRouter.post("/extract-image", async (req, res) => {
  try {
    const { imageBase64, mimeType = "image/png" } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: "Missing imageBase64 data" });
    }

    const ai = getGenAI();
    if (!ai) {
      return res.status(503).json({ error: "Gemini API key is not configured" });
    }

    // Clean base64 header if included
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: cleanBase64,
            },
          },
          {
            text: `Carefully inspect this screenshot of an inbox message, text message, or social app DM.
Extract:
1. The message body text exactly as written.
2. The sender name, phone number, email address, or social handle if visible.
3. The platform interface (e.g., 'SMS / iMessage', 'Gmail / Email', 'WhatsApp', 'Instagram DM', 'Telegram', 'Bank SMS').
Return JSON format matching:
{
  "extractedText": "exact text from the message bubble or email",
  "sender": "sender info or empty string if not visible",
  "platform": "detected platform"
}`,
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
      },
    });

    const parsed = JSON.parse(response.text || "{}");
    return res.json({
      success: true,
      extractedText: parsed.extractedText || "",
      sender: parsed.sender || "",
      platform: parsed.platform || "Other",
    });
  } catch (error: any) {
    console.error("Error in /api/extract-image:", error);
    return res.status(500).json({ error: error?.message || "Failed to parse image screenshot" });
  }
});

// Deep Scam & Safety Analysis endpoint
legacyRouter.post("/analyze-message", async (req, res) => {
  try {
    const { message, sender = "", platform = "Other", imageBase64 = null, imageMime = "image/png" } = req.body;

    if (!message && !imageBase64) {
      return res.status(400).json({ error: "Please provide a message or screenshot to analyze." });
    }

    const ai = getGenAI();
    const heuristic = ruleBasedScan(message || "", sender, platform);

    // If no Gemini API key available, return heuristic scan seamlessly
    if (!ai) {
      return res.json({
        ...heuristic,
        engine: "heuristic-fallback",
        notice: "AI engine key not detected; running local threat rule engine.",
      });
    }

    const promptText = `You are the core intelligence of "Online Safety Guard", a cybersecurity and anti-fraud detection system.
Analyze the following message, sender, and platform context for scam, phishing, social engineering, smishing, identity theft, or financial fraud indicators.

Message Text:
"""
${message || "(Message provided via screenshot)"}
"""

Sender details: ${sender || "Not provided"}
Platform: ${platform || "General Message"}

Evaluate strictly and objectively:
1. Is this a scam, phishing attempt, impersonation, or malicious link?
2. If it is legitimate (e.g. an authentic bank 2FA code telling user "Never share this code", a real calendar invite, a genuine friend greeting), declare it SAFE with low risk score (0-15%).
3. If it is fraudulent, specify exact red flags with quotes, psychological tactics (urgency, fear, greed, authority spoofing), deceptive URL breakdowns, and exact safety recommendations.

Provide the analysis as valid JSON matching the exact schema.`;

    const parts: any[] = [];
    if (imageBase64) {
      const cleanBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");
      parts.push({
        inlineData: {
          mimeType: imageMime,
          data: cleanBase64,
        },
      });
    }
    parts.push({ text: promptText });

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            safetyStatus: {
              type: Type.STRING,
              description: "'SAFE', 'SUSPICIOUS', or 'DANGEROUS_SCAM'",
            },
            riskScore: {
              type: Type.INTEGER,
              description: "Scam probability score from 0 (completely benign/safe) to 100 (definite scam/malicious)",
            },
            scamType: {
              type: Type.STRING,
              description: "Category of scam (e.g., 'Phishing & Credential Theft', 'Urgent Banking Smishing', 'Advance-Fee Job Scam', 'Delivery Fee Phishing', 'Romance Scam', 'Tech Support Extortion', 'Crypto Fraud', or 'Legitimate Notification')",
            },
            verdictSummary: {
              type: Type.STRING,
              description: "Clear, direct 2-sentence summary explaining why this is or isn't a scam.",
            },
            redFlags: {
              type: Type.ARRAY,
              description: "Specific red flags identified in the message",
              items: {
                type: Type.OBJECT,
                properties: {
                  flag: { type: Type.STRING, description: "Name of the red flag" },
                  evidence: { type: Type.STRING, description: "Specific quote or indicator from message" },
                  severity: { type: Type.STRING, description: "'high', 'medium', or 'low'" },
                },
                required: ["flag", "evidence", "severity"],
              },
            },
            tacticsUsed: {
              type: Type.ARRAY,
              description: "Psychological and technical tactics used (e.g. 'False Urgency', 'Brand Impersonation', 'Typosquatting')",
              items: { type: Type.STRING },
            },
            highlightPhrases: {
              type: Type.ARRAY,
              description: "Key phrases to highlight for the user with an explanation",
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING, description: "Exact excerpt from the message" },
                  category: { type: Type.STRING, description: "'danger', 'warning', or 'suspicious_link'" },
                  explanation: { type: Type.STRING, description: "Why this phrase is dangerous or notable" },
                },
                required: ["text", "category", "explanation"],
              },
            },
            safetyAdvice: {
              type: Type.OBJECT,
              properties: {
                immediateActions: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Safe steps the user should do right now",
                },
                whatNeverToDo: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Dangerous actions the user must avoid",
                },
                officialVerificationStep: {
                  type: Type.STRING,
                  description: "How to safely contact or verify the genuine organization",
                },
              },
              required: ["immediateActions", "whatNeverToDo", "officialVerificationStep"],
            },
            recommendedResponse: {
              type: Type.STRING,
              description: "Recommended response or defensive action (e.g., 'Do not reply, block and report', or safe neutral template)",
            },
            senderAssessment: {
              type: Type.OBJECT,
              properties: {
                isSenderSuspicious: { type: Type.BOOLEAN },
                notes: { type: Type.STRING, description: "Assessment of the sender address, handle, or number" },
              },
              required: ["isSenderSuspicious", "notes"],
            },
          },
          required: [
            "safetyStatus",
            "riskScore",
            "scamType",
            "verdictSummary",
            "redFlags",
            "tacticsUsed",
            "highlightPhrases",
            "safetyAdvice",
            "recommendedResponse",
            "senderAssessment",
          ],
        },
      },
    });

    const parsed = JSON.parse(response.text || "{}");
    return res.json({
      ...parsed,
      engine: GEMINI_MODEL,
    });
  } catch (error: any) {
    console.error("Error analyzing message with Gemini:", error);
    // Graceful fallback to heuristic scan
    const fallback = ruleBasedScan(req.body.message || "", req.body.sender, req.body.platform);
    return res.json({
      ...fallback,
      engine: "heuristic-fallback",
      errorDetails: error?.message || "AI service temporarily unavailable; using rule-based analysis.",
    });
  }
});

// Domain and URL Threat Inspector
//
// Root-cause fix for the "Inspection service error" seen in production: the
// original handler called Gemini directly (no timeout, no error classification,
// no fallback when a key IS configured) and any 429 / quota / timeout /
// malformed-JSON response became an HTTP 500. It now:
//   1. validates and safely parses the input (never fetches the URL),
//   2. always produces a deterministic verdict from the shared URL Agent +
//      known-organization registry,
//   3. optionally enriches it with Gemini through generateJson() (timeouts,
//      classified errors) and falls back to the rule-based verdict with an
//      explicit notice when the AI is unavailable or rate-limited.
legacyRouter.post("/inspect-domain", async (req, res) => {
  const { allowed, retryAfterSec } = checkRateLimit(clientIp(req));
  if (!allowed) {
    res.setHeader("Retry-After", String(retryAfterSec));
    return res.status(429).json({ error: `Too many requests. Try again in ${retryAfterSec}s.`, code: "rate_limited" });
  }
  try {
    const raw = (req.body || {}) as { url?: unknown };
    if (typeof raw.url !== "string" || !raw.url.trim()) {
      return res.status(400).json({ error: "Enter a URL or domain to inspect.", code: "empty_input" });
    }
    if (raw.url.length > LIMITS.urlChars) {
      return res.status(413).json({ error: "That URL is too long to inspect.", code: "too_large" });
    }
    const finding = analyzeUrl(raw.url.trim());
    const hostname = finding?.hostname;
    if (!finding || !hostname || (!finding.isIpAddress && !hostname.includes("."))) {
      return res.status(400).json({ error: "Invalid URL. Enter something like https://example.com or example.com.", code: "invalid_url" });
    }

    const org = finding.lookalikeOf ? findOrganizationByName(finding.lookalikeOf) : null;
    const strong = finding.suspiciousTld || finding.isIpAddress || Boolean(finding.lookalikeOf);
    const medium = finding.hyphenCount >= 2 || finding.isShortener || finding.hasCredentialKeywords || finding.subdomainDepth >= 2;
    const ruleResult = {
      domain: hostname,
      fullUrl: finding.normalized,
      isSuspicious: strong || medium,
      threatLevel: (strong ? "HIGH" : medium ? "MEDIUM" : "LOW") as "HIGH" | "MEDIUM" | "LOW",
      spoofedBrand: finding.lookalikeOf || null,
      officialDomain: org?.officialDomains[0] || null,
      reason: finding.flags.length ? finding.flags.join(". ") + "." : "No structural red flags: standard domain syntax, no high-abuse TLD, no known-brand look-alike pattern. This does not prove the site is safe — run the full investigation for external threat intelligence.",
      flags: finding.flags,
      engine: "rule-based" as "rule-based" | "gemini",
      notice: null as string | null,
    };

    if (!isGeminiConfigured()) {
      return res.json({ ...ruleResult, notice: "Gemini is not configured — rule-based inspection only. Other security checks were used." });
    }

    const ai = await generateJson<{ isSuspicious?: boolean; threatLevel?: string; spoofedBrand?: string | null; reason?: string; officialDomain?: string | null }>({
      systemInstruction: "You are a URL safety analyst. Never suggest visiting the URL. Answer strictly as JSON.",
      prompt: `Examine this URL and hostname: "${finding.normalized}" (hostname: "${hostname}").
Deterministic findings already established: ${finding.flags.length ? finding.flags.join("; ") : "none"}.
Detect typosquatting, brand impersonation (banks, government, delivery, payment, social or tech brands), deceptive subdomains or phishing-style paths.
Return JSON: {"isSuspicious": boolean, "threatLevel": "HIGH" | "MEDIUM" | "LOW", "spoofedBrand": string | null, "officialDomain": string | null, "reason": string}`,
      schema: {
        type: Type.OBJECT,
        properties: {
          isSuspicious: { type: Type.BOOLEAN },
          threatLevel: { type: Type.STRING },
          spoofedBrand: { type: Type.STRING, nullable: true },
          officialDomain: { type: Type.STRING, nullable: true },
          reason: { type: Type.STRING },
        },
        required: ["isSuspicious", "threatLevel", "reason"],
      },
      temperature: 0.1,
    });

    if (!ai.ok) {
      const notice = ai.code === "rate_limited" ? "Gemini is rate-limited right now. Rule-based inspection was used." : ai.code === "timeout" ? "Gemini did not respond in time. Rule-based inspection was used." : ai.code === "invalid_key" ? "The Gemini API key was rejected. Rule-based inspection was used." : "Gemini is temporarily unavailable. Rule-based inspection was used.";
      return res.json({ ...ruleResult, notice });
    }

    const d = ai.data;
    const aiLevel = ["HIGH", "MEDIUM", "LOW"].includes(String(d.threatLevel)) ? (String(d.threatLevel) as "HIGH" | "MEDIUM" | "LOW") : ruleResult.threatLevel;
    // Deterministic evidence can raise but never be lowered by the model.
    const rank = { LOW: 0, MEDIUM: 1, HIGH: 2 };
    const threatLevel = rank[aiLevel] > rank[ruleResult.threatLevel] ? aiLevel : ruleResult.threatLevel;
    return res.json({
      ...ruleResult,
      isSuspicious: ruleResult.isSuspicious || Boolean(d.isSuspicious),
      threatLevel,
      spoofedBrand: ruleResult.spoofedBrand || (typeof d.spoofedBrand === "string" && d.spoofedBrand.trim() ? d.spoofedBrand.trim().slice(0, 80) : null),
      officialDomain: ruleResult.officialDomain || (typeof d.officialDomain === "string" && d.officialDomain.trim() ? d.officialDomain.trim().slice(0, 120) : null),
      reason: typeof d.reason === "string" && d.reason.trim() ? d.reason.trim().slice(0, 800) : ruleResult.reason,
      engine: "gemini",
    });
  } catch (error) {
    console.error("Error inspecting domain:", error instanceof Error ? error.message : error);
    return res.status(503).json({ error: "The link inspector hit an unexpected problem. Please try again, or run the full investigation.", code: "unavailable" });
  }
});

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
import { Router } from "express";
import { Type } from "@google/genai";
import { getGenAI } from "../gemini/client";
import { GEMINI_MODEL } from "../config";

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
legacyRouter.post("/inspect-domain", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "URL or domain is required" });
    }

    const ai = getGenAI();

    // Fast static parsing
    let cleanUrl = url.trim();
    if (!/^https?:\/\//i.test(cleanUrl)) {
      cleanUrl = "https://" + cleanUrl;
    }

    let hostname = "";
    try {
      hostname = new URL(cleanUrl).hostname;
    } catch {
      hostname = cleanUrl.replace(/^https?:\/\//, "").split("/")[0];
    }

    const suspiciousTLDs = [".top", ".xyz", ".cc", ".buzz", ".cam", ".rest", ".club", ".fit", ".tk", ".ml", ".ga", ".cf", ".gq", ".work", ".zip", ".mov"];
    const hasSuspiciousTLD = suspiciousTLDs.some((tld) => hostname.endsWith(tld));
    const isIpAddress = /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/.test(hostname);
    const hasExcessiveHyphens = (hostname.match(/-/g) || []).length >= 2;

    if (!ai) {
      return res.json({
        domain: hostname,
        fullUrl: cleanUrl,
        isSuspicious: hasSuspiciousTLD || isIpAddress || hasExcessiveHyphens,
        threatLevel: hasSuspiciousTLD || isIpAddress ? "HIGH" : hasExcessiveHyphens ? "MEDIUM" : "LOW",
        reason: hasSuspiciousTLD ? "High-risk top-level domain frequently associated with automated phishing campaigns." : "Standard domain syntax.",
        spoofedBrand: null,
      });
    }

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `Examine this URL and domain hostname: "${cleanUrl}" (Domain: "${hostname}").
Detect if this domain is attempting typosquatting, brand impersonation (e.g. Bank of America, Apple, USPS, Google, Amazon, PayPal, Microsoft, Netflix, Instagram, WhatsApp), deceptive subdomains, or deceptive phishing redirect.
Return JSON:
{
  "domain": "${hostname}",
  "fullUrl": "${cleanUrl}",
  "isSuspicious": boolean,
  "threatLevel": "'HIGH', 'MEDIUM', or 'LOW'",
  "spoofedBrand": "Name of brand spoofed or null",
  "reason": "Clear explanation of findings",
  "officialDomain": "Official legitimate domain of the brand if spoofed, or null"
}`,
      config: {
        responseMimeType: "application/json",
      },
    });

    const result = JSON.parse(response.text || "{}");
    return res.json(result);
  } catch (error: any) {
    console.error("Error inspecting domain:", error);
    return res.status(500).json({ error: error?.message || "Domain inspection failed" });
  }
});

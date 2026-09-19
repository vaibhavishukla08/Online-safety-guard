/**
 * Online Safety Guard — server entry point.
 *
 * Boots the database (SQLite by default, PostgreSQL when DATABASE_URL is set),
 * mounts the Express app from server/app.ts, serves the React frontend (Vite
 * middleware in development, static `dist/` in production) and starts the
 * mailbox polling scheduler.
 *
 *   /api/auth, /api/connections, /api/mail, /api/notifications, /api/admin
 *   /api/*  (server/routes/api.ts)     – agentic investigation pipeline, incident
 *                                         response, safety coach, dashboard summary,
 *                                         Outlook add-in email channel
 *   /api/*  (server/routes/legacy.ts)  – original single-shot endpoints, preserved
 *
 * The Outlook task pane is served from /outlook/taskpane.html by the same server.
 * Outlook requires HTTPS, so `HTTPS=true` starts a TLS listener using either
 * SSL_KEY_FILE/SSL_CERT_FILE or the certificates created by
 * `npx office-addin-dev-certs install` (~/.office-addin-dev-certs).
 *
 * All secrets are read from environment variables (see .env.example).
 */
import path from "path";
import fs from "fs";
import os from "os";
import http from "http";
import https from "https";
import dotenv from "dotenv";
import express from "express";
import { createServer as createViteServer } from "vite";
import { createApp, installErrorHandler } from "./server/app";
import { openDb } from "./server/db";
import { GEMINI_MODEL, SYNC, getAppBaseUrl, getIntelKeys, getOAuthConfig, getSessionSecret, hasGeminiKey, IS_PRODUCTION } from "./server/config";
import { startSyncScheduler } from "./server/services/sync";

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;

/** Resolve TLS material when HTTPS=true. Returns null (with a reason) when unavailable. */
function loadTls(): { key: Buffer; cert: Buffer; source: string } | { error: string } {
  const explicitKey = process.env.SSL_KEY_FILE;
  const explicitCert = process.env.SSL_CERT_FILE;
  const devDir = path.join(os.homedir(), ".office-addin-dev-certs");
  const candidates = [
    explicitKey && explicitCert ? { key: explicitKey, cert: explicitCert, source: "SSL_KEY_FILE / SSL_CERT_FILE" } : null,
    { key: path.join(devDir, "localhost.key"), cert: path.join(devDir, "localhost.crt"), source: "office-addin-dev-certs" },
  ].filter((c): c is { key: string; cert: string; source: string } => Boolean(c));
  for (const c of candidates) {
    if (fs.existsSync(c.key) && fs.existsSync(c.cert)) {
      return { key: fs.readFileSync(c.key), cert: fs.readFileSync(c.cert), source: c.source };
    }
  }
  return { error: "No certificate found. Run `npx office-addin-dev-certs install` or set SSL_KEY_FILE and SSL_CERT_FILE." };
}

async function startServer() {
  const dbInstance = await openDb();
  getSessionSecret(); // warns loudly at boot if SESSION_SECRET is missing

  const app = createApp();

  const useHttps = process.env.HTTPS === "true";
  let server: http.Server | https.Server;
  let tlsSource = "";
  if (useHttps) {
    const tls = loadTls();
    if ("error" in tls) {
      console.error(`HTTPS=true but ${tls.error}`);
      process.exit(1);
    }
    tlsSource = tls.source;
    server = https.createServer({ key: tls.key, cert: tls.cert }, app);
  } else {
    server = http.createServer(app);
  }

  if (!IS_PRODUCTION) {
    const vite = await createViteServer({
      // Bind HMR websockets to our own listener so they work over HTTPS too.
      server: { middlewareMode: true, hmr: process.env.DISABLE_HMR === "true" ? false : { server } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath, { index: false, maxAge: "1h", setHeaders: (res, file) => { if (file.endsWith(".html") || file.endsWith(".xml")) res.setHeader("Cache-Control", "no-cache"); } }));
    app.get("*", (req, res) => {
      // Multi-page build: keep the add-in pages addressable; everything else is the SPA.
      if (req.path.startsWith("/outlook/")) {
        res.status(404).send("Not found");
        return;
      }
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
  installErrorHandler(app);

  server.listen(PORT, "0.0.0.0", () => {
    const keys = getIntelKeys();
    const oauth = getOAuthConfig();
    const intel = Object.entries({ VirusTotal: keys.virusTotal, SafeBrowsing: keys.safeBrowsing, urlscan: keys.urlScan, AbuseIPDB: keys.abuseIpDb })
      .map(([name, key]) => `${name}=${key ? "on" : "off"}`)
      .join(" ");
    const scheme = useHttps ? "https" : "http";
    console.log(`Online Safety Guard server running on ${scheme}://localhost:${PORT}${useHttps ? ` (TLS via ${tlsSource})` : ""}`);
    console.log(`  Public base URL: ${getAppBaseUrl()}`);
    console.log(`  Outlook task pane: ${scheme}://localhost:${PORT}/outlook/taskpane.html`);
    console.log(`  Database: ${dbInstance.label}`);
    console.log(`  Gemini: ${hasGeminiKey() ? `configured (${GEMINI_MODEL})` : "NOT configured — deterministic mode"}`);
    console.log(`  Threat intel: RDAP=on DNS=on ${intel}`);
    console.log(`  Mailbox OAuth: Microsoft=${oauth.microsoft.configured ? "on" : "off"} Google=${oauth.google.configured ? "on" : "off"}`);
    const scheduled = startSyncScheduler();
    console.log(`  Mailbox sync: ${scheduled ? `polling every ${SYNC.intervalMinutes} min (max ${SYNC.autoAnalyzeMax} auto analyses / run)` : "background polling disabled (SYNC_INTERVAL_MINUTES=0) — manual sync only"}`);
  });
}

startServer().catch((err) => {
  console.error("Fatal: server failed to start:", err instanceof Error ? err.message : err);
  process.exit(1);
});

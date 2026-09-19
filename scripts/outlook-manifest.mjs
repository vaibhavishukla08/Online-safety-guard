/**
 * Writes a copy of outlook/manifest.xml pointed at another origin, for
 * sideloading the add-in against a local HTTPS dev server (or a tunnel).
 *
 *   npm run manifest:local                                   → outlook/manifest.local.xml (https://localhost:3000)
 *   node scripts/outlook-manifest.mjs --url https://x.example --out outlook/manifest.x.xml
 *
 * The copy gets its own Id and a "(Local)" display name so it installs next to
 * the production add-in instead of replacing it. outlook/manifest.xml stays the
 * single source of truth; generated copies are git-ignored.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'outlook', 'manifest.xml');
const LOCAL_ID = 'b3e0a4c7-1d52-4f6e-9a8b-2c7d3e4f5a61';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const url = opt('url', 'https://localhost:3000').replace(/\/+$/, '');
const out = path.resolve(root, opt('out', 'outlook/manifest.local.xml'));

if (!/^https:\/\//.test(url)) {
  console.error('Outlook only loads add-ins over HTTPS; --url must start with https://');
  process.exit(1);
}

const xml = fs.readFileSync(source, 'utf8');
const origin = xml.match(/<AppDomain>(https:\/\/[^<]+)<\/AppDomain>/)?.[1];
if (!origin) {
  console.error('Could not find <AppDomain> in outlook/manifest.xml');
  process.exit(1);
}

const result = xml
  .split(origin).join(url)
  .replace(/<Id>[^<]+<\/Id>/, `<Id>${LOCAL_ID}</Id>`)
  .replace(/<DisplayName DefaultValue="([^"]+)"\/>/, (_, name) => `<DisplayName DefaultValue="${name} (Local)"/>`);

fs.writeFileSync(out, result);
console.log(`Wrote ${path.relative(root, out)} → ${url}`);

/**
 * Packages the project source into public/online-safety-guard.zip so the
 * footer "Export ZIP" link always serves the current code.
 *
 * Dependency-free (store-only ZIP writer using Node built-ins). Skips
 * node_modules, dist, .env files and the output zip itself.
 *
 *   npm run zip
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(root, 'public', 'online-safety-guard.zip');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.claude', 'design-system', 'data']);
const SKIP_FILES = new Set(['online-safety-guard.zip', '.DS_Store']);

// CRC-32 table
const TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function collect(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = entry.name;
    const relPath = rel ? `${rel}/${name}` : name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      out.push(...collect(path.join(dir, name), relPath));
    } else if (entry.isFile()) {
      if (SKIP_FILES.has(name) || (name.startsWith('.env') && name !== '.env.example')) continue;
      out.push(relPath);
    }
  }
  return out;
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }

try {
  const files = collect(root).sort();
  const now = dosDateTime(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const rel of files) {
    const data = fs.readFileSync(path.join(root, rel));
    const nameBuf = Buffer.from(rel.replace(/\\/g, '/'), 'utf8');
    const crc = crc32(data);
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(now.time), u16(now.day), u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), nameBuf, data]);
    const central = Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(now.time), u16(now.day), u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuf]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((a, b) => a + b.length, 0);
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralSize), u32(offset), u16(0)]);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, Buffer.concat([...locals, ...centrals, end]));
  console.log(`Wrote ${path.relative(root, outFile)} (${files.length} files, ${(fs.statSync(outFile).size / 1024 / 1024).toFixed(1)} MB)`);
} catch (err) {
  console.warn('Could not build project zip (non-fatal):', err instanceof Error ? err.message : err);
}

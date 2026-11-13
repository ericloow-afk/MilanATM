#!/usr/bin/env node
// Probe mot ATM:s oofficiella Giromilano-backend. Bara dokumentation, inget i appen beror på den.
//
//   node tools/probe-atm.mjs <kod> [<kod> ...] [--path linesummary|timetable] [--dry]
//
// Regler (CLAUDE.md och realtidsuppdraget):
// - Ärlig User-Agent, inga förfalskade webbläsarheaders, inga cookies eller sessioner.
// - Högst ett anrop per 30 s. Ingen polling.
// - Vid 401/403/429 eller HTML (inloggningsvägg, bot-skydd): stanna direkt, spara svaret, avsluta med kod 2.
// Råa svar sparas i test/fixtures/giromilano/<tid>/ tillsammans med meta.json.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://giromilano.atm.it/proxy.tpportal/api/tpPortal/tpl/stops';
const USER_AGENT = 'MilanoMetroAR-hobby/0.1';
const MIN_INTERVAL_MS = 30_000;
const STOP_STATUSES = new Set([401, 403, 429]);

const codes = [];
let endpoint = 'linesummary';
let dry = false;
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--path') endpoint = process.argv[++i];
  else if (a === '--dry') dry = true;
  else codes.push(a); // metrokoder är negativa ("-308"), så allt som inte är en flagga räknas som kod
}
if (codes.length === 0 || !['linesummary', 'timetable'].includes(endpoint)) {
  console.error('Användning: node tools/probe-atm.mjs <kod> [<kod> ...] [--path linesummary|timetable] [--dry]');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/:\d\d\.\d+Z$/, 'Z').replace(/:/g, '');
const outDir = join('test', 'fixtures', 'giromilano', stamp);
const meta = { userAgent: USER_AGENT, minIntervalMs: MIN_INTERVAL_MS, requests: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** WaitMessage per linje ur ett linesummary-svar (fältnamnen enligt tidigare manuella tester). */
export function waitMessages(json) {
  const lines = Array.isArray(json?.Lines) ? json.Lines : [];
  return lines.map((l) => ({
    line: l?.Line?.LineCode ?? l?.BookletUrl2 ?? l?.LineCode ?? null,
    description: l?.Line?.LineDescription ?? l?.LineDescription ?? null,
    waitMessage: l?.WaitMessage ?? null,
  }));
}

async function main() {
  if (!dry) mkdirSync(outDir, { recursive: true });
  for (let i = 0; i < codes.length; i++) {
    if (i > 0) await sleep(MIN_INTERVAL_MS);
    const code = codes[i];
    const url = `${BASE}/${encodeURIComponent(code)}/${endpoint}`;
    if (dry) { console.log('skulle hämta', url); continue; }
    const sentAt = new Date().toISOString();
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, redirect: 'manual' });
    } catch (err) {
      meta.requests.push({ url, sentAt, error: String(err) });
      console.error(`${code}: nätverksfel ${err}`);
      continue;
    }
    const body = await res.text();
    const type = res.headers.get('content-type') ?? '';
    const isHtml = /html/i.test(type) || /^\s*</.test(body);
    const file = `${code}-${endpoint}.${isHtml ? 'html' : 'json'}`;
    writeFileSync(join(outDir, file), body);
    const entry = { url, sentAt, status: res.status, contentType: type, file };
    if (!isHtml && res.ok) {
      try { entry.waitMessages = waitMessages(JSON.parse(body)); } catch { entry.parseError = true; }
    }
    meta.requests.push(entry);
    console.log(`${code}: ${res.status} ${type}${entry.waitMessages ? ' ' + JSON.stringify(entry.waitMessages) : ''}`);
    if (STOP_STATUSES.has(res.status) || isHtml || (res.status >= 300 && res.status < 400)) {
      meta.stoppedBecause = `status ${res.status}${isHtml ? ', HTML-svar' : ''}`;
      writeFileSync(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
      console.error(`Stoppar: ${meta.stoppedBecause}. Inga fler anrop. Kringgå inte; dokumentera i docs/realtime-sources.md.`);
      process.exit(2);
    }
  }
  if (!dry) writeFileSync(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
}

main();

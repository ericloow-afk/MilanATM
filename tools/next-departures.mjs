// Användning: node tools/next-departures.mjs [--line M2] [--stop Garibaldi] [--n 5] [--date YYYY-MM-DD] [--time HH:MM[:SS]] [--file public/metro.json]
// Utan --date/--time används nuvarande tid i Europe/Rome.
import { readFileSync } from 'node:fs';
import { findStops, fmtTime, nextDepartures } from './lib/metro-query.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const line = args.line ?? 'M2';
const stopQuery = args.stop ?? 'Garibaldi';
const n = Number(args.n ?? 5);
const metro = JSON.parse(readFileSync(args.file ?? 'public/metro.json', 'utf8'));

const parts = Object.fromEntries(
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]),
);
const date = args.date ?? `${parts.year}-${parts.month}-${parts.day}`;
const time = args.time ?? `${parts.hour}:${parts.minute}:${parts.second}`;
const [hh, mm, ss = '0'] = time.split(':').map(Number);
const ymd = Number(date.replaceAll('-', ''));
const sec = hh * 3600 + mm * 60 + Number(ss);

if (ymd < Number(metro.meta.validFrom.replaceAll('-', '')) || ymd > Number(metro.meta.validTo.replaceAll('-', ''))) {
  console.warn(`VARNING: ${date} ligger utanför feedens giltighet (${metro.meta.validFrom} … ${metro.meta.validTo}).`);
}
const matches = findStops(metro, stopQuery).map((i) => metro.stops[i]);
console.log(`Linje ${line}, station "${stopQuery}" → ${matches.map((s) => `${s.id} (${s.name})`).join(', ') || 'ingen träff'}`);
console.log(`Från ${date} ${fmtTime(sec)} (Europe/Rome), enligt tidtabell:`);
const res = nextDepartures(metro, { line, stop: stopQuery, ymd, sec, n });
if (!res.length) console.log('Inga avgångar hittades.');
for (const r of res) console.log(`  ${fmtTime(r.dep)}  mot ${r.dir.name}  [${r.stop.id}]`);

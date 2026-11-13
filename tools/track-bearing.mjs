#!/usr/bin/env node
// Spårets bäring ur shapes i public/metro.json vid en koordinat eller station, båda riktningarna.
//
//   node tools/track-bearing.mjs <lat> <lon> [--line M3] [--window 50]
//   node tools/track-bearing.mjs --station MACIACHINI [--line M3]
//
// travel = färdriktningen för riktningen (mot slutstationen), reverse = motsatt (dit tåget kommer ifrån).
// Bäringar i grader från geografisk (sann) nord, medsols. Shapes är grova på vissa sträckor: se distM och shapePoints.
import { readFileSync } from 'node:fs';
import { angleDiff, bearing, trackBearings } from './lib/track-bearing-lib.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const data = JSON.parse(readFileSync(new URL('../public/metro.json', import.meta.url), 'utf8'));
let lat;
let lon;
let label;
const st = opt('--station');
if (st) {
  const s = data.stops.find((x) => x.id === st.toUpperCase() || x.name.toLowerCase() === st.toLowerCase());
  if (!s) {
    console.error(`Okänd station: ${st}`);
    process.exit(1);
  }
  ({ lat, lon } = s);
  label = `${s.name} (${s.id})`;
} else {
  [lat, lon] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))).map(Number);
  label = `${lat}, ${lon}`;
}
if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
  console.error('Användning: node tools/track-bearing.mjs <lat> <lon> [--line M3] [--window 50] | --station NAMN');
  process.exit(1);
}
const line = opt('--line');
const halfWindow = Number(opt('--window') ?? 50);
const rows = trackBearings(data, lat, lon, { line, halfWindow });
console.log(`Spårets bäring vid ${label}${line ? `, ${line}` : ''} (±${halfWindow} m längs shapen)\n`);
console.log('linje  riktning                    avstånd  färd°   motsatt°  segment°  föregående → nästa');
for (const r of rows) {
  console.log(
    `${r.line.padEnd(6)} ${('mot ' + r.direction).padEnd(27)} ${r.distM.toFixed(0).padStart(5)} m  ${r.travel.toFixed(1).padStart(5)}   ${r.reverse.toFixed(1).padStart(6)}    ${r.segment.toFixed(1).padStart(6)}   ${r.prevStop ?? '–'} → ${r.nextStop ?? '–'}${r.quality === 'coarse' ? '  (grov shape)' : ''}`,
  );
}
const cmp = opt('--compare');
if (cmp) {
  for (const v of cmp.split(',').map(Number)) {
    const best = rows.reduce((b, r) => Math.min(b, angleDiff(v, r.travel), angleDiff(v, r.reverse)), 180);
    console.log(`\nJämförelse ${v}°: närmaste spårbäring skiljer ${best.toFixed(1)}°`);
  }
}
export { bearing };

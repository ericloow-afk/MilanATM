// Användning: npm run replay   (vite-node tools/filter-replay-report.ts)
// Kör AR-filtret över sensorloggen och skriver docs/filter-replay.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { wrap180 } from '../src/geo/orientation';
import { DEFAULT_FILTER_CONFIG } from '../src/ar/filter';
import { parseSensorCsv, replay, type ReplayPoint } from '../src/ar/replay';

const CSV = 'test/fixtures/sensor-log-indoor-2026-11-06.csv';
const rows = parseSensorCsv(readFileSync(CSV, 'utf8'));
const t0 = rows[0].t;
const clock = (t: number) => new Date(t).toISOString().slice(11, 22);
const at = (c: string) => Date.parse(`2026-11-06T${c}Z`);
const win = (pts: ReplayPoint[], a: string, b: string) => pts.filter((p) => p.t >= at(a) && p.t <= at(b));
const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const f1 = (x: number) => x.toFixed(1);

function metrics(pts: ReplayPoint[]) {
  const ok = pts.filter((p) => p.state === 'ok' && p.measured != null);
  const rms = Math.sqrt(ok.reduce((s, p) => s + wrap180(p.yaw - p.measured!) ** 2, 0) / Math.max(1, ok.length));
  const w = win(pts, '20:15:08.0', '20:15:15.0').map((p) => p.yaw);
  const med = median(w);
  const dev = Math.max(...w.map((x) => Math.abs(x - med)));
  const aw = win(pts, '20:15:05.8', '20:15:08.3');
  let accRate = 0;
  for (let i = 1; i < aw.length; i++) accRate = Math.max(accRate, Math.abs(wrap180(aw[i].yaw - aw[i - 1].yaw)) / ((aw[i].t - aw[i - 1].t) / 1000));
  let excess = 0;
  pts.forEach((p, i) => {
    if (i) excess = Math.max(excess, p.filteredStep - p.rawStep);
  });
  const flip1 = range(win(pts, '20:15:16.0', '20:15:17.6').map((p) => p.yaw));
  const flip2 = range(win(pts, '20:15:19.9', '20:15:20.7').map((p) => p.yaw));
  let jitter = 0; // största sample-till-sample-ändring i yaw (grader/s)
  for (let i = 1; i < pts.length; i++) jitter = Math.max(jitter, Math.abs(wrap180(pts[i].yaw - pts[i - 1].yaw)) / ((pts[i].t - pts[i - 1].t) / 1000));
  return { used: ok.length, rms, dev, med, accRate, excess, flip1, flip2, jitter };
}

const base = replay(rows);
const states = new Map<string, number>();
for (const p of base) states.set(p.state, (states.get(p.state) ?? 0) + 1);
const m0 = metrics(base);
const c = DEFAULT_FILTER_CONFIG;

const L: string[] = [];
L.push('# Replay av AR-filtret mot riktig sensorlogg', '');
L.push(
  `Logg: \`${CSV}\` (${rows.length} samples, ca 5 Hz, ${((rows.at(-1)!.t - t0) / 1000).toFixed(0)} s, inomhus, telefonen upprätt → ned mot golvet → upp mot taket). Skapa rapporten med \`npm run replay\`; testerna ligger i \`src/ar/replay.test.ts\`.`,
  '',
);
L.push('## Parametrar (src/ar/filter.ts, `DEFAULT_FILTER_CONFIG`)', '');
L.push('| parameter | värde | betydelse |', '|---|---|---|');
const desc: Record<string, string> = {
  tauQ: 'utjämning av vyn (slerp i kvaternionrymd), s',
  tauYaw: 'tidskonstant för yaw-korrigering mot kompassen, s (förstärkning ≈ dt / tauYaw)',
  maxCompassAccuracy: 'kompass med sämre headingAcc (°) ignoreras',
  goodCompassAccuracy: 'under detta väger kompassen fullt, därefter tonas vikten ned',
  minAccuracyWeight: 'lägsta vikt precis under maxCompassAccuracy',
  maxElevationDeg: 'kompass ignoreras när kameran tittar mer än så här uppåt (°)',
  maxRateDegPerSec: 'kompass ignoreras vid snabbare vridning (°/s)',
  innovationLimitDeg: 'skattning som avviker mer än så här (°) från offseten avvisas',
  reacquireAfterSec: 'avvisas oavbrutet så här länge: ta den nya nivån (s)',
};
for (const [k, v] of Object.entries(c)) L.push(`| ${k} | ${v} | ${desc[k]} |`);
L.push('', 'Alla ändras på ett ställe: `new OrientationFilter({ tauYaw: 3, ... })` eller `DEFAULT_FILTER_CONFIG`.', '');

L.push('## Resultat med standardparametrarna', '');
L.push(
  `- Kompassen användes i ${states.get('ok') ?? 0} av ${base.length} samples. Övriga: ${[...states]
    .filter(([k]) => k !== 'ok')
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')}.`,
);
L.push(
  `- **a)** Största ökning av filtrerad jämfört med rå rotation mellan två samples: ${m0.excess.toFixed(2)}° (gräns 1,5°). Största enskilda steg i vyn ${Math.max(...base.map((p) => p.filteredStep)).toFixed(1)}° (rå: ${Math.max(...base.map((p) => p.rawStep)).toFixed(1)}°).`,
);
L.push(`- **b)** Yaw-offset ändras ${m0.flip1.toFixed(1)}° kring uppåtvändningen och ${m0.flip2.toFixed(1)}° kring nedåtvändningen (gräns 10°).`);
L.push(`- **c)** Under headingAcc > 25° rör sig skattningen högst ${m0.accRate.toFixed(1)}°/s (gräns 6°/s).`);
L.push(`- **d)** 20:15:08–15: skattningen ligger inom ±${m0.dev.toFixed(1)}° av medianen ${f1(m0.med)}° (gräns ±5°).`, '');

L.push(
  '## Skattad offset över tid',
  '',
  'yaw = filtrets skattning (grader). uppmätt = kompass − råreferens (det kompassen skulle ge ensam). tillstånd: ok = kompassen användes; inaccurate = headingAcc > 25°; looking-up = blick uppåt; moving = snabb vridning; jump = språng avvisat.',
  '',
);
L.push('| tid | beta | höjd° | °/s | headingAcc | uppmätt | yaw | tillstånd |', '|---|---|---|---|---|---|---|---|');
let last = -1e9;
for (const p of base) {
  if (p.t - last < 1000) continue;
  last = p.t;
  L.push(`| ${clock(p.t)} | ${p.beta.toFixed(0)} | ${p.elevation.toFixed(0)} | ${p.rate.toFixed(0)} | ${p.headingAcc ?? ''} | ${p.measured == null ? '' : f1(p.measured)} | ${f1(p.yaw)} | ${p.state} |`);
}

L.push('', '## Parameterscan (tauYaw × maxRateDegPerSec)', '');
L.push(
  'rms = RMS-avstånd mellan skattning och uppmätt offset när kompassen användes (lägre = följer kompassen tätare; behöver inte vara bättre, se nedan). d) = största avvikelse från medianen 20:15:08–15 (gräns 5, ✗ = över). c) = största yaw-hastighet i headingAcc-fönstret.',
  '',
);
L.push('| tauYaw | maxRate | rms (°) | d) ± (°) | c) (°/s) | max yaw-hastighet (°/s) | a) max ökning (°) | b) flip1 / flip2 (°) |', '|---|---|---|---|---|---|---|---|');
for (const rate of [60, 120, 200]) {
  for (const tau of [1, 2, 3, 5, 8]) {
    const m = metrics(replay(rows, { tauYaw: tau, maxRateDegPerSec: rate }));
    const mark = tau === c.tauYaw && rate === c.maxRateDegPerSec ? ' **← standard**' : '';
    L.push(`| ${tau} | ${rate} | ${f1(m.rms)} | ${f1(m.dev)}${m.dev > 5 ? ' ✗' : ''} | ${f1(m.accRate)} | ${f1(m.jitter)} | ${m.excess.toFixed(2)} | ${f1(m.flip1)} / ${f1(m.flip2)}${mark} |`);
  }
}

L.push('', '## Slutsatser och förslag', '');
L.push(
  '1. **Grindarna fungerar på den här loggen.** Båda kompassvändningarna (≈170°) fångas av höjdgrinden (maxElevationDeg 20° ≈ beta 110°) och, om den stängs av, av innovationsgränsen (45°): testerna visar båda. Utan grindar flyttar vändningen skattningen mer än 10°.',
  '2. **Kamerarotationen blir kontinuerlig** när kvaternionen byggs av alla tre vinklarna: alpha och gamma hoppar upp till ca 70° mellan samples nära beta ≈ 90° (20:15:15.6), men den verkliga rotationen är högst ca 24° per sample och filtret ökar den aldrig med mer än ca 1°.',
  '3. **"Kompassen släpar vid snabb vridning" syns knappt när alla tre vinklarna används.** Offset-beräkningen heading + alpha (som bara tittar på alpha) sjunker ca 25° vid 20:14:55–57, men med referensriktningen ur hela kvaternionen (gamma ≈ 20–30° då) ändras offseten bara ca 3°. En del av det "släp" som syntes var alltså gamma som saknades i beräkningen, inte kompassen. Hastighetsgrinden är därför satt högt (120°/s, loggens max är 113°/s) och i praktiken inaktiv här. Med den satt till 60°/s fryser skattningen under hela den snabba vridningen 20:15:09–14 och står kvar vid ca 69° medan kompassen visar ca 81° (ett fel på ca 12° som inte syns i rms-kolumnen, där bara samples räknas som faktiskt användes). Sänk den utomhus bara om du ser släp där.',
  '4. **Offseten driver 22° på 30 s inomhus (60° → 82°)**, troligen magnetisk störning inomhus snarare än fel i gyrot. En långsam skattning är därför oftast bättre än en som följer kompassen tätt, även om "rms" blir högre. Obs: d) passerar delvis för att skattningen är långsam; under 20:15:08–15 är den fortfarande på väg mot kompassens ca 81° (från ca 68° till ca 75°), så den "stabila" nivån är inte riktigt inhämtad.',
  '5. **Förslag:** `tauYaw` = 5 s (standard). Kortare (1–3 s) följer kompassen tätare men ger d) över 5° i den snabba vridningen och mer jitter; längre (8 s) är lugnare (jitter 1,2°/s) men släpar mer efter kompassen (rms 7,6°). Efter utomhustestet: om vyn driftar mot kompassen, sänk `tauYaw` mot 3 s; om vyn darrar, höj den mot 8 s. `maxRateDegPerSec` 120, `maxElevationDeg` 20 och `innovationLimitDeg` 45 är rimliga utgångsvärden.',
  '',
  '## Begränsningar',
  '',
  '- Loggen är **inomhus** och 5 Hz. Riktiga sensorhändelser kommer ofta med ~60 Hz; tauQ (0,1 s) är avsedd för det och ger nästan ingen utjämning vid 5 Hz.',
  '- Vi har ingen sann riktning (facit), bara kompass och gyro. "rms" mäter därför bara hur tätt skattningen följer kompassen, inte hur rätt den är.',
  '- Loggen innehåller en kompassvändning upp och en ned. Lutning åt andra håll och andra sätt att hålla telefonen är inte provade.',
);
writeFileSync('docs/filter-replay.md', L.join('\n') + '\n');
console.log(L.slice(0, 24).join('\n'));

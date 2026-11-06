// Uppehållsrapport: feedens uppehåll (w) per linje/station, viktat med antal trips, samt modellens uppehåll.
import { DEFAULT_DWELL, effectiveTiming } from '../../src/engine/dwell.ts';

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function stats(values) {
  if (!values.length) return { n: 0, min: null, median: null, max: null, zeroShare: null };
  let min = Infinity;
  let max = -Infinity;
  let zeros = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    if (v === 0) zeros++;
  }
  return { n: values.length, min, median: median(values), max, zeroShare: zeros / values.length };
}

/** Samlar uppehåll per stopp-händelse (en per trip och stopp). */
export function dwellReport(metro, cfg = DEFAULT_DWELL) {
  const tripsPerPattern = new Map();
  for (const [pi] of metro.trips) tripsPerPattern.set(pi, (tripsPerPattern.get(pi) ?? 0) + 1);
  const all = [];
  const terminal = [];
  const byLine = new Map();
  const byStation = new Map(); // `${line}|${stop}` -> { feed: [], model: [] }
  metro.patterns.forEach((p, pi) => {
    const k = tripsPerPattern.get(pi) ?? 0;
    if (!k) return;
    const ids = p.stops.map((s) => metro.stops[s].id);
    const t = effectiveTiming(p.a, p.w, ids, cfg);
    p.stops.forEach((si, i) => {
      const isTerm = i === 0 || i === p.stops.length - 1;
      const feed = p.w[i];
      const model = t.dep[i] - t.arr[i];
      const key = `${p.line}|${ids[i]}`;
      let st = byStation.get(key);
      if (!st) byStation.set(key, (st = { line: p.line, stop: ids[i], name: metro.stops[si].name, feed: [], model: [], terminal: false }));
      if (isTerm) st.terminal = true;
      for (let r = 0; r < k; r++) {
        (isTerm ? terminal : all).push(feed);
        if (!isTerm) {
          if (!byLine.has(p.line)) byLine.set(p.line, []);
          byLine.get(p.line).push(feed);
        }
        st.feed.push(feed);
        st.model.push(model);
      }
    });
  });
  return {
    intermediate: stats(all),
    terminal: stats(terminal),
    lines: [...byLine].sort().map(([line, v]) => ({ line, ...stats(v) })),
    stations: [...byStation.values()]
      .map((s) => ({ ...s, feed: stats(s.feed), model: stats(s.model) }))
      .sort((a, b) => a.line.localeCompare(b.line) || a.stop.localeCompare(b.stop)),
    config: cfg,
  };
}

const f = (x, d = 0) => (x == null ? '–' : Number(x).toFixed(d));
const pct = (x) => (x == null ? '–' : `${(x * 100).toFixed(1)} %`);

export function formatDwellReport(r) {
  const L = ['# Uppehållstider (avgång − ankomst)', ''];
  L.push('Källa: `public/metro.json` (GTFS stop_times). Viktat med antal trips. Ändstationer redovisas separat.', '');
  L.push('## Sammanfattning (feeden)');
  L.push(`- Mellanliggande stopp: ${r.intermediate.n} stopphändelser, min ${f(r.intermediate.min)} s, median ${f(r.intermediate.median)} s, max ${f(r.intermediate.max)} s, nollor ${pct(r.intermediate.zeroShare)}`);
  L.push(`- Ändstationer: ${r.terminal.n} stopphändelser, min ${f(r.terminal.min)} s, median ${f(r.terminal.median)} s, max ${f(r.terminal.max)} s, nollor ${pct(r.terminal.zeroShare)}`);
  const zero = r.intermediate.zeroShare === 1 && r.terminal.zeroShare === 1;
  L.push(
    '',
    zero
      ? '**Slutsats:** feeden innehåller inga uppehållstider. Ankomst = avgång på alla stopp, även ändstationerna. Utan modell rullar tågen igenom stationerna utan att stanna.'
      : '**Slutsats:** feeden innehåller uppehållstider på en del stopp; se tabellerna.',
    '',
  );
  L.push('## Per linje (mellanliggande stopp, feeden)', '', '| linje | stopphändelser | min | median | max | nollor |', '|---|---|---|---|---|---|');
  for (const l of r.lines) L.push(`| ${l.line} | ${l.n} | ${f(l.min)} | ${f(l.median)} | ${f(l.max)} | ${pct(l.zeroShare)} |`);
  const c = r.config;
  L.push('', '## Uppehållsmodell (estimate: true)', '');
  L.push(`Standard ${c.defaultSec} s, ändstation ${c.terminusSec} s (före avgång och efter ankomst), körtiden kortas högst ${Math.round(c.maxTravelShare * 100)} % och aldrig under ${c.minTravelSec} s. Undantag: ${Object.entries(c.stations).map(([k, v]) => `${k} ${v} s`).join(', ')}.`, '');
  L.push('| linje | station | ändstation | feed median (s) | modell min/median/max (s) |', '|---|---|---|---|---|');
  for (const s of r.stations) {
    L.push(`| ${s.line} | ${s.name} | ${s.terminal ? 'ja' : ''} | ${f(s.feed.median)} | ${f(s.model.min)} / ${f(s.model.median)} / ${f(s.model.max)} |`);
  }
  return L.join('\n') + '\n';
}

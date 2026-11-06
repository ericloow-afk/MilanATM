// Rimlighetskontroll: medelhastighet per segment (sd-skillnad / körtid utan uppehåll).
// Avslöjar felaktiga shapes eller projektioner (orimliga hastigheter).
export const MAX_MPS = 25;
export const MIN_MPS = 1;

export function segmentSpeeds(metro) {
  const tripCount = new Map();
  for (const [pi] of metro.trips) tripCount.set(pi, (tripCount.get(pi) ?? 0) + 1);
  const segments = [];
  metro.patterns.forEach((p, pi) => {
    for (let i = 0; i < p.stops.length - 1; i++) {
      const dist = p.sd[i + 1] - p.sd[i];
      const travelSec = p.a[i + 1] - (p.a[i] + p.w[i]);
      const speed = travelSec > 0 ? dist / travelSec : dist > 0 ? Infinity : 0;
      let flag = null;
      if (travelSec <= 0 && dist > 0) flag = 'zeroTime';
      else if (speed > MAX_MPS) flag = 'high';
      else if (speed < MIN_MPS) flag = 'low';
      segments.push({
        pattern: pi, line: p.line, shape: p.shape, quality: p.shapeQuality,
        from: metro.stops[p.stops[i]].name, to: metro.stops[p.stops[i + 1]].name,
        dist, travelSec, speed, flag, trips: tripCount.get(pi) ?? 0,
      });
    }
  });
  const gm = new Map();
  for (const s of segments) {
    const k = `${s.line}|${s.quality}`;
    const g = gm.get(k) ?? { line: s.line, quality: s.quality, segments: 0, flagged: 0, high: 0, low: 0, zeroTime: 0, tripSegments: 0, tripFlagged: 0 };
    g.segments++;
    g.tripSegments += s.trips;
    if (s.flag) {
      g.flagged++;
      g.tripFlagged += s.trips;
      g[s.flag]++;
    }
    gm.set(k, g);
  }
  const groups = [...gm.values()].sort((x, y) => x.line.localeCompare(y.line) || x.quality.localeCompare(y.quality));
  return { segments, groups };
}

export function formatSpeedReport({ segments, groups }, worst = 15) {
  const L = [`# Segmenthastigheter (flagga >${MAX_MPS} m/s eller <${MIN_MPS} m/s)`, ''];
  L.push('| linje | shape | segment | flaggade | för snabba | för långsamma | nolltid | trip-segment | trip-flaggade |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const g of groups) L.push(`| ${g.line} | ${g.quality} | ${g.segments} | ${g.flagged} | ${g.high} | ${g.low} | ${g.zeroTime} | ${g.tripSegments} | ${g.tripFlagged} |`);
  const all = segments.filter((s) => s.speed !== 0 || s.dist === 0);
  const speeds = segments.map((s) => s.speed).filter(Number.isFinite).sort((a, b) => a - b);
  if (speeds.length) {
    const q = (f) => speeds[Math.min(speeds.length - 1, Math.floor(f * speeds.length))].toFixed(1);
    L.push('', `Hastighet (m/s): min ${q(0)}, p5 ${q(0.05)}, median ${q(0.5)}, p95 ${q(0.95)}, max ${q(1)}`);
  }
  const flagged = segments.filter((s) => s.flag).sort((x, y) => Math.abs(Math.log((y.speed || 1e-6) / 12)) - Math.abs(Math.log((x.speed || 1e-6) / 12)));
  L.push('', `## Mest avvikande flaggade segment (${Math.min(worst, flagged.length)} av ${flagged.length}, unika mönstersegment)`);
  if (!flagged.length) L.push('Inga.');
  for (const s of flagged.slice(0, worst)) {
    L.push(`- ${s.line} (${s.quality}) ${s.from} → ${s.to}: ${s.speed === Infinity ? '∞' : s.speed.toFixed(1)} m/s, ${s.dist.toFixed(0)} m på ${s.travelSec} s [${s.flag}], ${s.trips} trips, shape ${s.shape}`);
  }
  void all;
  return L.join('\n') + '\n';
}

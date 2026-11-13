/**
 * GPS-filtret mot syntetiska fixar modellerade på fältmätningen 8/11 (Dergano: stillastående, gpsAcc 21,8 → 10,6 m
 * på 30 s, hopp 5–9 m mellan fixar; Maciachini-perrongen: gpsAcc 1414 m hela tiden). De riktiga loggarna testas i
 * src/ar/field.test.ts när de finns i test/fixtures/.
 */
import { describe, expect, it } from 'vitest';
import { haversine } from '../geo';
import { fromLocalMeters } from '../geo/enu';
import { GpsFilter, GpsStatus, type GpsFix } from './gps-filter';

const HOME = { lat: 45.5055, lon: 9.1797 };
const T0 = Date.UTC(2026, 10, 8, 15, 0, 0);

/** deterministisk slump (mulberry32) */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stillastående i 30 s: fixar var 0,7–1,0 s, noggrannhet 21,8 → 10,6 m, varje fix 5–9 m från den förra. */
function standingStill(seed = 1): GpsFix[] {
  const r = rng(seed);
  const out: GpsFix[] = [];
  let t = T0;
  let prev = { e: 0, n: 0 };
  while (t < T0 + 30_000) {
    const acc = 21.8 - (11.2 * (t - T0)) / 30_000;
    let p = prev;
    for (let k = 0; k < 500; k++) {
      const a = r() * 2 * Math.PI;
      const rad = 5 * Math.sqrt(r());
      const cand = { e: rad * Math.cos(a), n: rad * Math.sin(a) };
      const d = Math.hypot(cand.e - prev.e, cand.n - prev.n);
      if (out.length === 0 || (d >= 5 && d <= 9)) {
        p = cand;
        break;
      }
    }
    prev = p;
    const ll = fromLocalMeters(HOME, p.e, p.n);
    out.push({ lat: ll.lat, lon: ll.lon, accuracy: acc, t });
    t += 700 + 300 * r();
  }
  return out;
}

function run(fixes: GpsFix[], f = new GpsFilter()) {
  const est: { lat: number; lon: number; t: number }[] = [];
  for (const fx of fixes) {
    f.update(fx);
    const e = f.estimate;
    if (e) est.push({ lat: e.lat, lon: e.lon, t: fx.t });
  }
  return est;
}

const speeds = (est: { lat: number; lon: number; t: number }[]) =>
  est.slice(1).map((e, i) => haversine(est[i].lat, est[i].lon, e.lat, e.lon) / ((e.t - est[i].t) / 1000));

describe('GpsFilter: stillastående med hoppiga fixar (som Dergano)', () => {
  const fixes = standingStill();
  const est = run(fixes);

  it('rådata hoppar 5–9 m mellan fixar (förutsättningen för testet)', () => {
    for (let i = 1; i < fixes.length; i++) {
      const d = haversine(fixes[i - 1].lat, fixes[i - 1].lon, fixes[i].lat, fixes[i].lon);
      expect(d).toBeGreaterThanOrEqual(4.99);
      expect(d).toBeLessThanOrEqual(9.01);
    }
  });
  it('utskattningen springer aldrig fortare än 3 m/s', () => {
    expect(Math.max(...speeds(est))).toBeLessThanOrEqual(3.0001);
  });
  it('hoppar högst ca 2 m per uppdatering, och efter de första 10 s under 1,5 m', () => {
    const steps = est.slice(1).map((e, i) => ({ d: haversine(est[i].lat, est[i].lon, e.lat, e.lon), t: e.t - T0 }));
    expect(Math.max(...steps.map((s) => s.d))).toBeLessThanOrEqual(2.2);
    expect(Math.max(...steps.filter((s) => s.t > 10_000).map((s) => s.d))).toBeLessThan(1.5);
  });
  it('ligger nära rätt plats (inom 4 m) mot slutet', () => {
    const last = est.at(-1)!;
    expect(haversine(last.lat, last.lon, HOME.lat, HOME.lon)).toBeLessThan(4);
  });
  it('samma gränser för flera slumpfrön', () => {
    for (const seed of [2, 3, 4, 5, 6]) {
      const e = run(standingStill(seed));
      expect(Math.max(...speeds(e))).toBeLessThanOrEqual(3.0001);
      expect(Math.max(...e.slice(1).map((x, i) => haversine(e[i].lat, e[i].lon, x.lat, x.lon)))).toBeLessThanOrEqual(2.2);
    }
  });
});

describe('GpsFilter: gång och avvikelser', () => {
  it('följer en promenad i 1,4 m/s med högst ca 10 m eftersläpning', () => {
    const r = rng(9);
    const fixes: GpsFix[] = [];
    for (let s = 0; s <= 60; s++) {
      const p = fromLocalMeters(HOME, 1.4 * s + (r() - 0.5) * 8, (r() - 0.5) * 8);
      fixes.push({ lat: p.lat, lon: p.lon, accuracy: 8, t: T0 + s * 1000 });
    }
    const est = run(fixes);
    const end = est.at(-1)!;
    const truth = fromLocalMeters(HOME, 84, 0);
    expect(haversine(end.lat, end.lon, truth.lat, truth.lon)).toBeLessThan(10);
    expect(Math.max(...speeds(est))).toBeLessThanOrEqual(3.0001);
  });
  it('fixar med gpsAcc över 100 m ignoreras', () => {
    const f = new GpsFilter();
    expect(f.update({ ...HOME, accuracy: 10, t: T0 })).toBe('init');
    const far = fromLocalMeters(HOME, 500, 0);
    expect(f.update({ ...far, accuracy: 150, t: T0 + 1000 })).toBe('ignored-accuracy');
    expect(haversine(f.estimate!.lat, f.estimate!.lon, HOME.lat, HOME.lon)).toBeLessThan(0.01);
  });
  it('perrongen (gpsAcc 1414 m hela tiden): ingen position alls', () => {
    const f = new GpsFilter();
    for (let i = 0; i < 120; i++) expect(f.update({ ...HOME, accuracy: 1414, t: T0 + i * 250 })).toBe('ignored-accuracy');
    expect(f.estimate).toBeNull();
  });
  it('samma fix två gånger räknas en gång', () => {
    const f = new GpsFilter();
    f.update({ ...HOME, accuracy: 10, t: T0 });
    expect(f.update({ ...HOME, accuracy: 10, t: T0 })).toBe('duplicate');
  });
  it('flera fixar i rad långt bort, eller ett långt uppehåll, startar om filtret där', () => {
    const f = new GpsFilter();
    f.update({ ...HOME, accuracy: 8, t: T0 });
    const far = fromLocalMeters(HOME, 400, 0);
    expect(f.update({ ...far, accuracy: 8, t: T0 + 1000 })).toBe('outlier');
    expect(f.update({ ...far, accuracy: 8, t: T0 + 2000 })).toBe('outlier');
    expect(f.update({ ...far, accuracy: 8, t: T0 + 3000 })).toBe('reinit');
    expect(haversine(f.estimate!.lat, f.estimate!.lon, far.lat, far.lon)).toBeLessThan(0.01);
    expect(f.update({ ...HOME, accuracy: 8, t: T0 + 60_000 })).toBe('reinit');
  });
});

describe('GpsStatus: "Svag GPS" och "Ingen GPS-fix"', () => {
  it('svag över 30 m, men inte när fixen är oanvändbar (över 100 m)', () => {
    const s = new GpsStatus(T0);
    s.update(T0, 12);
    expect(s.weak).toBe(false);
    s.update(T0 + 1000, 45);
    expect(s.weak).toBe(true);
    s.update(T0 + 2000, 1414);
    expect(s.weak).toBe(false);
  });
  it('ingen fix: först efter mer än 5 s med gpsAcc över 100 m (eller ingen position)', () => {
    const s = new GpsStatus(T0);
    s.update(T0 + 1000, null);
    expect(s.noFix(T0 + 5000)).toBe(false);
    expect(s.noFix(T0 + 5001)).toBe(true);
    s.update(T0 + 6000, 20);
    expect(s.noFix(T0 + 20_000)).toBe(false);
    s.update(T0 + 21_000, 1414);
    expect(s.noFix(T0 + 25_000)).toBe(false);
    expect(s.noFix(T0 + 26_500)).toBe(true);
  });
});

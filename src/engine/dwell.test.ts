import { describe, expect, it } from 'vitest';
import { DEFAULT_DWELL, dwellFor, effectiveTiming, rampFractionFor, trapezoid, type DwellConfig } from './dwell';
import type { MetroData } from './types';

const cfg: DwellConfig = { ...DEFAULT_DWELL, defaultSec: 22, terminusSec: 60, minTravelSec: 30, maxTravelShare: 0.35, stations: { BIG: 40 } };

describe('dwellFor', () => {
  it('standardvärde och undantag per station; konfigurationen är märkt som uppskattning', () => {
    expect(dwellFor(cfg, 'X')).toBe(22);
    expect(dwellFor(cfg, 'BIG')).toBe(40);
    expect(DEFAULT_DWELL.estimate).toBe(true);
    expect(dwellFor(DEFAULT_DWELL, 'DUOMO M1')).toBeGreaterThan(DEFAULT_DWELL.defaultSec);
  });
});

describe('effectiveTiming', () => {
  it('utan modell: tidtabellen oförändrad, syns från start till (exklusive) sista ankomst', () => {
    const t = effectiveTiming([0, 150, 330], [0, 30, 0], ['A', 'B', 'C'], null);
    expect(t.arr).toEqual([0, 150, 330]);
    expect(t.dep).toEqual([0, 180, 330]);
    expect([t.visibleFrom, t.visibleTo]).toEqual([0, 330]);
  });
  it('avgången står kvar, ankomsten flyttas tidigare med uppehållet', () => {
    const t = effectiveTiming([0, 150, 330], [0, 0, 0], ['A', 'B', 'C'], cfg);
    expect(t.dep[1]).toBe(150); // schemalagd avgång
    expect(t.arr[1]).toBe(150 - 22);
    expect(t.modelled[1]).toBe(true);
  });
  it('undantag per station används', () => {
    const t = effectiveTiming([0, 150, 330], [0, 0, 0], ['A', 'BIG', 'C'], cfg);
    expect(t.dep[1] - t.arr[1]).toBe(40);
  });
  it('feedens egna uppehåll (> 0) används som de är', () => {
    const t = effectiveTiming([0, 150, 330], [0, 30, 0], ['A', 'B', 'C'], cfg);
    expect(t.arr[1]).toBe(150);
    expect(t.dep[1]).toBe(180);
    expect(t.modelled[1]).toBe(false);
  });
  it('begränsas: körtiden kortas högst 35 % och aldrig under 30 s', () => {
    // körtid 60 s: max(0, min(60 − 30, 60 × 0,35 = 21)) = 21
    expect(effectiveTiming([0, 60, 200], [0, 0, 0], ['A', 'B', 'C'], cfg).arr[1]).toBe(60 - 21);
    // körtid 35 s: min(5, 12,25) = 5
    expect(effectiveTiming([0, 35, 200], [0, 0, 0], ['A', 'B', 'C'], cfg).arr[1]).toBe(30);
    // körtid 25 s (< 30): inget uppehåll alls
    const t = effectiveTiming([0, 25, 200], [0, 0, 0], ['A', 'B', 'C'], cfg);
    expect(t.arr[1]).toBe(25);
    expect(t.modelled[1]).toBe(false);
  });
  it('ändstationer: står före avgång och efter ankomst (vändtid)', () => {
    const t = effectiveTiming([0, 150, 330], [0, 0, 0], ['A', 'B', 'C'], cfg);
    expect(t.arr[0]).toBe(-60);
    expect(t.dep[0]).toBe(0);
    expect(t.arr[2]).toBe(330); // ankomst till ändstation som i tidtabellen
    expect(t.dep[2]).toBe(390);
    expect([t.visibleFrom, t.visibleTo]).toEqual([-60, 390]);
  });
  it('ingen körtid blir negativ eller kortare än gränsen, för slumpade mönster', () => {
    let seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 500; k++) {
      const n = 3 + Math.floor(rnd() * 20);
      const a = [0];
      for (let i = 1; i < n; i++) a.push(a[i - 1] + Math.floor(5 + rnd() * 200));
      const t = effectiveTiming(a, a.map(() => 0), a.map((_, i) => (i % 5 === 0 ? 'BIG' : `S${i}`)), cfg);
      for (let i = 1; i < n; i++) {
        const orig = a[i] - a[i - 1];
        const travel = t.arr[i] - t.dep[i - 1];
        expect(travel).toBeGreaterThan(0);
        expect(travel).toBeGreaterThanOrEqual(Math.min(orig, cfg.minTravelSec));
        expect(travel).toBeGreaterThanOrEqual(orig * (1 - cfg.maxTravelShare) - 1e-9);
        expect(t.arr[i]).toBeLessThanOrEqual(t.dep[i]);
      }
    }
  });
});

describe('trapezoid', () => {
  const r = 0.2;
  it('börjar och slutar i stillastående och når hela sträckan', () => {
    expect(trapezoid(0, r)).toEqual({ p: 0, v: 0 });
    expect(trapezoid(1, r).p).toBeCloseTo(1, 12);
    expect(trapezoid(1, r).v).toBeCloseTo(0, 12);
    expect(trapezoid(0.5, r).p).toBeCloseTo(0.5, 12);
  });
  it('aldrig negativ hastighet, monoton sträcka, kontinuerlig, medelhastighet 1', () => {
    let prev = trapezoid(0, r);
    let sum = 0;
    const N = 10_000;
    for (let k = 1; k <= N; k++) {
      const cur = trapezoid(k / N, r);
      expect(cur.v).toBeGreaterThanOrEqual(0);
      expect(cur.p).toBeGreaterThanOrEqual(prev.p);
      expect(cur.p - prev.p).toBeLessThan(2 / N);
      sum += cur.v / N;
      prev = cur;
    }
    expect(sum).toBeCloseTo(1, 2);
  });
  it('accelererar ut och bromsar in: högst fart i mitten = 1/(1−r)', () => {
    expect(trapezoid(0.05, r).v).toBeLessThan(trapezoid(0.5, r).v);
    expect(trapezoid(0.95, r).v).toBeLessThan(trapezoid(0.5, r).v);
    expect(trapezoid(0.5, r).v).toBeCloseTo(1 / (1 - r), 12);
  });
  it('rampandelen är 18 s / körtid, högst 45 %', () => {
    expect(rampFractionFor(180)).toBeCloseTo(0.1, 12);
    expect(rampFractionFor(20)).toBe(0.45);
  });
});

const real = Object.values(import.meta.glob('../../public/metro.json', { eager: true, import: 'default' }))[0] as MetroData | undefined;
describe.skipIf(!real)('modellen på verklig metro.json', () => {
  it('alla segment behåller positiv körtid ≥ min(30 s, schemalagd) och uppehållen är rimliga', () => {
    let modelled = 0;
    for (const p of real!.patterns) {
      const ids = p.stops.map((s) => real!.stops[s].id);
      const t = effectiveTiming(p.a, p.w, ids, DEFAULT_DWELL);
      for (let i = 1; i < p.a.length; i++) {
        const orig = p.a[i] - (p.a[i - 1] + p.w[i - 1]);
        const travel = t.arr[i] - t.dep[i - 1];
        expect(travel).toBeGreaterThan(0);
        expect(travel).toBeGreaterThanOrEqual(Math.min(orig, DEFAULT_DWELL.minTravelSec));
        const d = t.dep[i] - t.arr[i];
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(60);
        if (t.modelled[i] && i < p.a.length - 1) modelled++;
      }
    }
    expect(modelled).toBeGreaterThan(500);
  });
});

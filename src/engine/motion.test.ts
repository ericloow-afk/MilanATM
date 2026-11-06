/** Uppehållsmodell + rörelseprofil i motorn (DEFAULT_OPTIONS): stillastående under uppehåll, kontinuitet, tider. */
import { describe, expect, it } from 'vitest';
import { haversine, shapeIndex } from '../geo';
import { activeTrips, DEFAULT_OPTIONS, positionAt, trains, type TripRun } from './index';
import { makeData, S_ALT, S_BENT, S_EAST } from './testdata';
import type { MetroData, Train } from './types';

const east = shapeIndex(S_EAST);
const bent = shapeIndex(S_BENT);
const alt = shapeIndex(S_ALT);
const base = makeData({ east: [0, east.cum[1], east.cum[2]], bent: [0, bent.length], alt: [0, alt.cum[2], alt.cum[4]] });
// Som verkliga feeden: inga uppehåll alls i mönster 0 (A→B→C, a = [0, 150, 330])
const data: MetroData = { ...base, patterns: base.patterns.map((p, i) => (i === 0 ? { ...p, w: [0, 0, 0] } : p)) };

const rome0 = Date.UTC(2026, 10, 5, 23, 0, 0); // 6/11 00:00 Rom (CET)
const T1 = '0:0:20261106:28800';
const ms = (rel: number) => rome0 + (28800 + rel) * 1000; // T1 startar 08:00:00
const run = (): TripRun => activeTrips(data, new Date(ms(10)), 0, DEFAULT_OPTIONS).find((r) => r.id === T1)!;
const at = (rel: number): Train | null => positionAt(run(), ms(rel));
const d = (a: Train, b: Train) => haversine(a.lat, a.lon, b.lat, b.lon);
// Modellen: B (vanlig station) 22 s ⇒ ankomst B 128 s, avgång (schemalagd) 150 s. Ändstationer 60 s.

describe('uppehåll (modell)', () => {
  it('positionen är konstant under hela uppehållet vid B', () => {
    const first = at(128)!;
    expect(first.status).toBe('dwelling');
    expect(first.fromStation).toBe('B');
    for (let rel = 128; rel < 150; rel += 0.25) {
      const t = at(rel)!;
      expect(t.status).toBe('dwelling');
      expect(t.speedMps).toBe(0);
      expect(d(t, first)).toBe(0);
    }
    expect(haversine(first.lat, first.lon, 45.4, 9.11)).toBeLessThan(0.5);
  });
  it('tidtabellens avgång står kvar: står vid B till exakt 150 s, sedan på väg mot C', () => {
    expect(at(149.99)!.status).toBe('dwelling');
    const go = at(150)!;
    expect(go.status).toBe('moving');
    expect(go.fromStation).toBe('B');
    expect(go.toStation).toBe('C');
    expect(go.progress).toBe(0);
  });
  it('ankommer före schemats tid: vid schemats ankomsttid (150 s) står tåget redan vid B', () => {
    expect(at(127.99)!.status).toBe('moving');
    expect(at(127.99)!.toStation).toBe('B');
    expect(haversine(at(127.99)!.lat, at(127.99)!.lon, 45.4, 9.11)).toBeLessThan(0.5);
  });
  it('ändstationer: syns 60 s före avgång från A och 60 s efter ankomst till C', () => {
    expect(at(-60.01)).toBeNull();
    expect(at(-60)!.status).toBe('dwelling');
    expect(at(-1)!.fromStation).toBe('A');
    expect(at(0)!.status).toBe('moving'); // avgår exakt enligt tidtabell
    expect(at(330)!.status).toBe('dwelling'); // ankommer exakt enligt tidtabell
    expect(at(330)!.fromStation).toBe('C');
    expect(at(389.9)!.status).toBe('dwelling');
    expect(at(390)).toBeNull();
  });
});

describe('rörelseprofil', () => {
  it('accelererar ut från A och bromsar in mot B, aldrig negativ fart', () => {
    let maxV = 0;
    for (let rel = 0; rel < 128; rel += 0.5) {
      const t = at(rel)!;
      expect(t.speedMps).toBeGreaterThanOrEqual(0);
      maxV = Math.max(maxV, t.speedMps);
    }
    expect(at(1)!.speedMps).toBeLessThan(maxV / 3);
    expect(at(127)!.speedMps).toBeLessThan(maxV / 3);
    expect(at(64)!.speedMps).toBeCloseTo(maxV, 6);
  });
  it('kommer fram exakt vid den effektiva ankomsttiden', () => {
    const almost = at(127.999)!;
    expect(almost.progress).toBeGreaterThan(0.9999);
  });
});

describe('kontinuitet (per bildruta)', () => {
  it('inget hopp större än 1 m mellan bildrutor (16 ms) under hela tripen, inklusive uppehållsgränser', () => {
    let prev = at(-60)!;
    let maxJump = 0;
    for (let rel = -60 + 0.016; rel < 390; rel += 0.016) {
      const t = at(rel);
      if (!t) break;
      maxJump = Math.max(maxJump, d(prev, t));
      prev = t;
    }
    expect(maxJump).toBeLessThan(1);
  });
  it('samma position oavsett när listan av aktiva trips räknades om', () => {
    const r1 = activeTrips(data, new Date(ms(40)), 2, DEFAULT_OPTIONS).find((r) => r.id === T1)!;
    const r2 = activeTrips(data, new Date(ms(41.3)), 2, DEFAULT_OPTIONS).find((r) => r.id === T1)!;
    const a = positionAt(r1, ms(41.7))!;
    const b = positionAt(r2, ms(41.7))!;
    expect(d(a, b)).toBeLessThan(1e-6);
  });
  it('horisonten tar med tåg som dyker upp inom nästa tick', () => {
    const before = activeTrips(data, new Date(ms(-61)), 0, DEFAULT_OPTIONS).some((r) => r.id === T1);
    const withHorizon = activeTrips(data, new Date(ms(-61)), 2, DEFAULT_OPTIONS).some((r) => r.id === T1);
    expect(before).toBe(false);
    expect(withHorizon).toBe(true);
  });
  it('trains() ger samma tåg som activeTrips + positionAt', () => {
    const when = new Date(ms(100));
    const a = trains(data, when).find((t) => t.id === T1)!;
    const b = positionAt(activeTrips(data, when).find((r) => r.id === T1)!, when.getTime())!;
    expect(a).toEqual(b);
  });
});

const real = Object.values(import.meta.glob('../../public/metro.json', { eager: true, import: 'default' }))[0] as MetroData | undefined;
describe.skipIf(!real)('verklig metro.json med modell', () => {
  const noon = new Date('2026-11-06T11:00:00Z');
  it('fredag 12:00: en del tåg står vid stationer (feeden själv har inga uppehåll)', () => {
    const ts = trains(real!, noon);
    const dwelling = ts.filter((t) => t.status === 'dwelling').length;
    expect(ts.length).toBeGreaterThan(50);
    expect(dwelling / ts.length).toBeGreaterThan(0.1);
    expect(dwelling / ts.length).toBeLessThan(0.6);
  });
  it('60 s i 16 ms-steg: inga hopp över 1,5 m, inga negativa farter, ingen fart över 30 m/s', () => {
    const runs = activeTrips(real!, noon, 61);
    let maxJump = 0;
    let maxV = 0;
    for (const r of runs) {
      let prev: Train | null = null;
      for (let s = 0; s < 60; s += 0.016) {
        const t = positionAt(r, noon.getTime() + s * 1000);
        if (t && prev) maxJump = Math.max(maxJump, d(prev, t));
        if (t) {
          expect(t.speedMps).toBeGreaterThanOrEqual(0);
          maxV = Math.max(maxV, t.speedMps);
        }
        prev = t;
      }
    }
    expect(maxJump).toBeLessThan(1.5);
    expect(maxV).toBeLessThan(30);
  });
});

/**
 * Fältloggarna från 8/11 (test/fixtures/field-2026-11-08-*.csv, AR-vyns egen CSV). Hoppas över om filerna saknas
 * och körs automatiskt när de läggs till. Perrong- eller utomhuslogg avgörs på innehållet (gpsAcc), inte namnet.
 */
import { describe, expect, it } from 'vitest';
import { haversine } from '../geo';
import { GpsFilter, GpsStatus } from './gps-filter';
import { fixesOf, parseArLogCsv, type ArLogRow } from './replay';

const files = import.meta.glob('../../test/fixtures/field-2026-11-08-*.csv', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const logs = Object.entries(files).map(([path, text]) => ({ name: path.split('/').pop()!, rows: parseArLogCsv(text) }));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const accOf = (rows: ArLogRow[]) => rows.map((r) => r.gpsAcc).filter((x): x is number => x != null);
const platform = logs.filter((l) => median(accOf(l.rows)) > 500);
const outdoor = logs.filter((l) => accOf(l.rows).length > 0 && median(accOf(l.rows)) <= 100);

describe.skipIf(logs.length === 0)('fältloggar 8/11', () => {
  it('finns och går att läsa', () => {
    for (const l of logs) expect(l.rows.length, l.name).toBeGreaterThan(10);
  });

  describe.skipIf(platform.length === 0)('perrongen (gpsAcc ca 1414 m)', () => {
    it('GPS-filtret ger ingen position alls, och "Ingen GPS-fix" visas efter 5 s', () => {
      for (const l of platform) {
        const f = new GpsFilter();
        for (const fx of fixesOf(l.rows)) f.update(fx);
        expect(f.estimate, l.name).toBeNull();
        const s = new GpsStatus(l.rows[0].t);
        for (const r of l.rows) s.update(r.t, r.gpsAcc);
        expect(s.noFix(l.rows.at(-1)!.t), l.name).toBe(l.rows.at(-1)!.t - l.rows[0].t > 5000);
      }
    });
  });

  describe.skipIf(outdoor.length === 0)('utomhus (Dergano)', () => {
    it('utskattningen springer aldrig över 3 m/s', () => {
      for (const l of outdoor) {
        const f = new GpsFilter();
        let prev: { lat: number; lon: number; t: number } | null = null;
        for (const fx of fixesOf(l.rows)) {
          f.update(fx);
          const e = f.estimate;
          if (!e) continue;
          if (prev && fx.t > prev.t) expect(haversine(prev.lat, prev.lon, e.lat, e.lon) / ((fx.t - prev.t) / 1000), l.name).toBeLessThanOrEqual(3.0001);
          prev = { lat: e.lat, lon: e.lon, t: fx.t };
        }
      }
    });
    it('hoppar högst ca 2 m per uppdatering (rådata hoppar 5–9 m)', () => {
      for (const l of outdoor) {
        const fixes = fixesOf(l.rows);
        const f = new GpsFilter();
        let prev: { lat: number; lon: number } | null = null;
        let maxStep = 0;
        let maxRaw = 0;
        fixes.forEach((fx, i) => {
          if (i) maxRaw = Math.max(maxRaw, haversine(fixes[i - 1].lat, fixes[i - 1].lon, fx.lat, fx.lon));
          f.update(fx);
          const e = f.estimate;
          if (e && prev) maxStep = Math.max(maxStep, haversine(prev.lat, prev.lon, e.lat, e.lon));
          if (e) prev = e;
        });
        expect(maxStep, `${l.name}: rådatans största hopp ${maxRaw.toFixed(1)} m`).toBeLessThanOrEqual(2.2);
      }
    });
  });
});

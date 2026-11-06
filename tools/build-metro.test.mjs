import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildMetro, displayName } from './lib/build-metro-lib.mjs';
import { parseTime, readTables, streamZipFile } from './lib/gtfs-read.mjs';
import { addDays, isServiceActive, nextDepartures, reconstructSignatures } from './lib/metro-query.mjs';
import { haversine, projectMonotone } from './lib/project.mjs';
import { makeFixtureZip } from './test/fixture.mjs';

const fx = buildMetro(makeFixtureZip());
const { metro, report } = fx;

describe('fixtur: linjer och filtrering', () => {
  it('alla 5 linjer finns och bussen är bortfiltrerad', () => {
    expect(metro.lines.map((l) => l.id)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5']);
    expect(metro.stops.some((s) => s.id === 'BUS1')).toBe(false);
    expect(metro.trips.length).toBe(20); // 4 trips x 5 linjer
  });
  it('färg och visningsnamn', () => {
    expect(metro.lines[0].color).toBe('#ff0000');
    expect(metro.stops.find((s) => s.id === 'A1 M1').name).toBe('A1');
    expect(metro.stops.find((s) => s.id === 'GARIBALDI FS').name).toBe('Garibaldi FS');
  });
  it('riktning = tripens sista station', () => {
    const names = metro.directions.filter((d) => d.line === 'M2').map((d) => d.terminus).sort();
    expect(names).toEqual(['A2', 'D2']);
  });
});

describe('fixtur: tider', () => {
  it('är monotona i alla mönster (ankomst >= föregående avgång, uppehåll >= 0)', () => {
    for (const p of metro.patterns) {
      expect(p.a[0]).toBe(0);
      for (let i = 0; i < p.a.length; i++) {
        expect(p.w[i]).toBeGreaterThanOrEqual(0);
        if (i > 0) expect(p.a[i]).toBeGreaterThanOrEqual(p.a[i - 1] + p.w[i - 1]);
      }
    }
    expect(report.timeAnomalies).toEqual([]);
  });
  it('uppehållstid lagras per stopp', () => {
    const p = metro.patterns.find((x) => x.shape === 'M2_fwd');
    expect(p.w).toEqual([0, 30, 30, 0]);
  });
  it('tider över 24:00 överlever', () => {
    expect(parseTime('24:10:30')).toBe(24 * 3600 + 630);
    const late = metro.trips.filter((t) => metro.services[t[1]].id === 'late');
    const maxAbs = Math.max(...late.map((t) => t[2] + Math.max(...metro.patterns[t[0]].a)));
    expect(maxAbs).toBeGreaterThan(86400);
  });
});

describe('fixtur: calendar_dates', () => {
  const wk = metro.services.findIndex((s) => s.id === 'wk');
  it('tillagd och borttagen tolkas rätt', () => {
    expect(metro.services[wk].add).toEqual([20261105, 20261106, 20261107]);
    expect(metro.services[wk].remove).toEqual([20261107]);
    expect(isServiceActive(metro, wk, 20261106)).toBe(true);
    expect(isServiceActive(metro, wk, 20261107)).toBe(false); // tillagd men också borttagen
    expect(isServiceActive(metro, wk, 20261108)).toBe(false); // aldrig tillagd
  });
  it('validTo = senare av mm_end_date och sista tillagda datum, varnar vid skillnad', () => {
    expect(metro.meta.validTo).toBe('2026-11-30');
    expect(metro.meta.lastAddedDate).toBe('2026-11-07');
    expect(metro.meta.validFrom).toBe('2026-10-26');
    expect(report.warnings.some((w) => w.includes('skiljer sig'))).toBe(true);
  });
});

describe('fixtur: shapes och sd', () => {
  it('grov shape flaggas, övriga inte', () => {
    const q = (id) => metro.patterns.find((p) => p.shape === id).shapeQuality;
    expect(q('M5_fwd')).toBe('coarse');
    expect(q('M1_fwd')).toBe('ok');
    expect(report.coarse.map((c) => c.line)).toEqual(['M5', 'M5']);
    expect(report.coarseTrips).toBe(4); // alla 4 M5-trips
  });
  it('sd är strikt växande och ligger nära rätt avstånd', () => {
    for (const p of metro.patterns) for (let i = 1; i < p.sd.length; i++) expect(p.sd[i]).toBeGreaterThan(p.sd[i - 1]);
    const p = metro.patterns.find((x) => x.shape === 'M1_fwd');
    const expected = haversine(45.4, 9.1, 45.4, 9.13);
    expect(p.sd.at(-1)).toBeGreaterThan(expected * 0.99);
    expect(p.sd.at(-1)).toBeLessThan(expected * 1.01);
  });
  it('koordinater är avrundade till 6 decimaler', () => {
    const dec = (x) => (String(x).split('.')[1] ?? '').length;
    for (const s of metro.stops) { expect(dec(s.lat)).toBeLessThanOrEqual(6); expect(dec(s.lon)).toBeLessThanOrEqual(6); }
    for (const g of metro.shapeGeoms) for (const [la, lo] of g) { expect(dec(la)).toBeLessThanOrEqual(6); expect(dec(lo)).toBeLessThanOrEqual(6); }
  });
  it('rapporterar station >30 m från shapen', () => {
    expect(report.sdDeviations).toEqual([]);
    const off = buildMetro(makeFixtureZip({ offsetStop: 'B3' })).report;
    expect(off.sdDeviations.length).toBeGreaterThan(0);
    expect(off.sdDeviations.every((d) => d.stop === 'B3' && d.distM > 100)).toBe(true);
  });
});

describe('förlustfri återskapning (fixtur)', () => {
  it('stop_times återskapas exakt från mönstren', () => {
    const orig = originalSignatures(makeFixtureZipOnce(), (a) => a);
    expect(diff(orig, reconstructSignatures(metro))).toEqual({ missing: 0, extra: 0, total: orig.length });
  });
});

describe('nästa avgångar (fixtur)', () => {
  it('M2 från Garibaldi: sorterat, framåt i tid, rätt riktning', () => {
    const res = nextDepartures(metro, { line: 'M2', stop: 'Garibaldi', ymd: 20261106, sec: 6 * 3600 + 3 * 60, n: 5 });
    expect(res.length).toBeGreaterThan(0);
    const deps = res.map((r) => r.dep);
    expect([...deps].sort((a, b) => a - b)).toEqual(deps);
    expect(deps[0]).toBeGreaterThanOrEqual(6 * 3600 + 180);
    expect(res[0].stop.id).toBe('GARIBALDI FS');
  });
  it('nattrip från gårdagens tjänstedygn dyker upp efter midnatt', () => {
    // late-trip (tjänstedygn 20261106) startar 23:59 och lämnar Garibaldi 24:01:30 = 00:01:30 den 7:e.
    const res = nextDepartures(metro, { line: 'M2', stop: 'GARIBALDI FS', ymd: 20261107, sec: 60, n: 5 });
    expect(res.map((r) => r.dep)).toEqual([90]);
    expect(res[0].service).toBe('late');
    expect(addDays(20261130, 1)).toBe(20261201);
    expect(addDays(20260101, -1)).toBe(20251231);
  });
});

describe('displayName', () => {
  it('rensar linjesuffix och Title Case', () => {
    expect(displayName('DUOMO M1')).toBe('Duomo');
    expect(displayName('CADORNA FN M2')).toBe('Cadorna FN');
    expect(displayName('SESTO 1 MAGGIO FS')).toBe('Sesto 1 Maggio FS');
    expect(displayName('CERNUSCO SUL NAVIGLIO')).toBe('Cernusco sul Naviglio');
    expect(displayName('S.AMBROGIO')).toBe('S.Ambrogio');
  });
});

describe('projectMonotone', () => {
  const line = [[45.4, 9.1], [45.4, 9.11], [45.4, 9.12]];
  it('ger växande sd och litet avstånd för stationer på linjen', () => {
    const r = projectMonotone(line, [[45.4, 9.1], [45.4, 9.105], [45.4, 9.12]]);
    const want = [0, haversine(45.4, 9.1, 45.4, 9.105), haversine(45.4, 9.1, 45.4, 9.12)];
    r.forEach((x, i) => expect(Math.abs(x.sd - want[i])).toBeLessThan(want[i] * 0.005 + 0.5));
    expect(r.every((x) => x.dist < 1)).toBe(true);
  });
  it('ett omvänt stationspar tvingas till icke-avtagande sd', () => {
    const r = projectMonotone(line, [[45.4, 9.115], [45.4, 9.105]]);
    expect(r[1].sd).toBeGreaterThanOrEqual(r[0].sd);
  });
  it('hanterar U-formad linje: sista stationen nära start projiceras på returbenet', () => {
    const u = [[45.4, 9.1], [45.4, 9.12], [45.4002, 9.12], [45.4002, 9.1]];
    const r = projectMonotone(u, [[45.4, 9.1], [45.4001, 9.12], [45.4002, 9.1]]);
    expect(r[2].sd).toBeGreaterThan(r[1].sd);
    expect(r[2].dist).toBeLessThan(1);
  });
});

// ---------- verkliga feeden: förlustfri återskapning mot originalfilen ----------
const REAL = 'data/raw/gtfs.zip';
describe.skipIf(!existsSync(REAL))('verkliga feeden', () => {
  it(
    'alla metro-trips stop_times återskapas utan skillnad och filen är < 2 MB',
    () => {
      const real = buildMetro(REAL);
      expect(real.report.size.bytes).toBeLessThan(2 * 1024 * 1024);
      const orig = originalSignatures(REAL);
      expect(orig.length).toBe(real.metro.trips.length);
      expect(diff(orig, reconstructSignatures(real.metro))).toEqual({ missing: 0, extra: 0, total: orig.length });
      expect(real.metro.lines.map((l) => l.id)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5']);
      expect(real.report.timeAnomalies).toEqual([]);
    },
    180_000,
  );
});

// ---------- hjälpare (oberoende av bygglogiken: egen gruppering ur originalfilerna) ----------
let _fx;
function makeFixtureZipOnce() { return (_fx ??= makeFixtureZip()); }

function originalSignatures(zipPath) {
  const t = readTables(zipPath);
  const metroRoutes = new Set(t.table('routes.txt').filter((r) => r.route_type === '1').map((r) => r.route_id));
  const trips = new Map(t.table('trips.txt').filter((x) => metroRoutes.has(x.route_id)).map((x) => [x.trip_id, x]));
  const rows = new Map();
  let ix;
  streamZipFile(zipPath, 'stop_times.txt', {
    onHeader: (h) => { ix = Object.fromEntries(h.map((n, i) => [n, i])); },
    onRow: (f) => {
      const id = f[ix.trip_id];
      if (!trips.has(id)) return;
      (rows.get(id) ?? rows.set(id, []).get(id)).push([Number(f[ix.stop_sequence]), f[ix.stop_id], parseTime(f[ix.arrival_time]), parseTime(f[ix.departure_time])]);
    },
  });
  const sigs = [];
  for (const [id, tr] of trips) {
    const r = rows.get(id).sort((a, b) => a[0] - b[0]);
    sigs.push(`${tr.route_id}|${tr.service_id}|${tr.shape_id}|${r.map((x) => `${x[1]},${x[2]},${x[3]}`).join(';')}`);
  }
  return sigs;
}

function diff(a, b) {
  const count = new Map();
  for (const s of a) count.set(s, (count.get(s) ?? 0) + 1);
  let extra = 0;
  for (const s of b) {
    const c = count.get(s);
    if (!c) extra++;
    else count.set(s, c - 1);
  }
  let missing = 0;
  for (const c of count.values()) missing += c;
  return { missing, extra, total: a.length };
}

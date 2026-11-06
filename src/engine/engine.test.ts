import { describe, expect, it } from 'vitest';
import { haversine, pointAlong, shapeIndex } from '../geo';
import { dataStatus, romeServiceTime, SCHEDULE_ONLY, trains as engineTrains } from './index';
import { makeData, S_ALT, S_BENT, S_EAST } from './testdata';
import type { MetroData, Train } from './types';

// Dessa tester gäller tidtabellen exakt (utan uppehållsmodell, konstant hastighet). Modellen testas i motion.test.ts.
const trains = (d: MetroData, at: Date) => engineTrains(d, at, SCHEDULE_ONLY);

// ---- testdata ----
const east = shapeIndex(S_EAST);
const bent = shapeIndex(S_BENT);
const alt = shapeIndex(S_ALT);
const data: MetroData = makeData({
  east: [0, east.cum[1], east.cum[2]],
  bent: [0, bent.length],
  alt: [0, alt.cum[2], alt.cum[4]],
});
const SD_A = 0;
const SD_B = east.cum[1];
const SD_C = east.cum[2];

/** Rome-tid i november (CET = UTC+1) som Date. day = dag i november 2026. */
const rome = (h: number, m: number, s = 0, day = 6) => new Date(Date.UTC(2026, 10, day, h - 1, m, s));
const START = 8 * 3600; // T1 startar 08:00:00
const at = (secAfterStart: number, day = 6) =>
  new Date(rome(0, 0, 0, day).getTime() + (START + secAfterStart) * 1000); // klarar bråkdelssekunder
const dist = (t: Train, lat: number, lon: number) => haversine(t.lat, t.lon, lat, lon);
const byStart = (ts: Train[], pattern: number) => ts.filter((t) => t.id.startsWith(`${pattern}:`));
/** Tåget från T1 (mönster 0, startar 08:00:00) */
const t1 = (ts: Train[]) => ts.find((t) => t.id.endsWith(':28800') && t.id.startsWith('0:'))!;

describe('romeServiceTime', () => {
  it('vintertid (CET = UTC+1): 11:00Z → 12:00 lokal tid', () => {
    expect(romeServiceTime(new Date('2026-11-06T11:00:00Z'))).toEqual({ ymd: 20261106, sec: 43200 });
  });
  it('sommartid (CEST = UTC+2): 10:00Z → 12:00 lokal tid', () => {
    expect(romeServiceTime(new Date('2026-07-01T10:00:00Z'))).toEqual({ ymd: 20260701, sec: 43200 });
  });
  it('datumet följer Rom, inte UTC: 23:30Z kl. 6/11 är 00:30 den 7/11', () => {
    expect(romeServiceTime(new Date('2026-11-06T23:30:00Z'))).toEqual({ ymd: 20261107, sec: 1800 });
  });
});

describe('dataStatus', () => {
  it('ok från validFrom till och med validTo (Rom-datum)', () => {
    expect(dataStatus(data, new Date('2026-10-26T00:30:00+01:00'))).toBe('ok');
    expect(dataStatus(data, new Date('2026-11-30T22:59:00Z'))).toBe('ok'); // 23:59 i Rom
  });
  it('notYetValid före validFrom', () => {
    expect(dataStatus(data, new Date('2026-10-25T22:30:00Z'))).toBe('notYetValid'); // 23:30 den 25:e i Rom (före) – CET/CEST-skifte hanteras av Intl
  });
  it('expired från dygnet efter validTo, mätt i Rom (23:30Z den 30:e = 00:30 den 1/12)', () => {
    expect(dataStatus(data, new Date('2026-11-30T23:30:00Z'))).toBe('expired');
    expect(dataStatus(data, new Date('2027-01-15T12:00:00Z'))).toBe('expired');
  });
  it('trains() ger [] när tidtabellen gått ut eller inte börjat', () => {
    expect(trains(data, new Date('2026-12-02T08:00:30Z'))).toEqual([]);
    expect(trains(data, new Date('2026-10-20T08:00:30Z'))).toEqual([]);
  });
});

describe('trains – tåg vid station', () => {
  it('vid exakt starttid (08:00:00) står tåget vid A och är på väg mot B med progress 0', () => {
    const t = t1(trains(data, at(0)));
    expect(t.fromStation).toBe('A');
    expect(t.toStation).toBe('B');
    expect(t.progress).toBe(0);
    expect(t.status).toBe('moving');
    expect(dist(t, 45.4, 9.1)).toBeLessThan(0.5);
  });
  it('vid exakt avgångstid från B (08:03:00) är tåget vid B på väg mot C', () => {
    const t = t1(trains(data, at(180)));
    expect(t.fromStation).toBe('B');
    expect(t.toStation).toBe('C');
    expect(t.progress).toBe(0);
    expect(t.status).toBe('moving');
    expect(dist(t, 45.4, 9.11)).toBeLessThan(0.5);
    expect(t.speedMps).toBeGreaterThan(0);
  });
  it('vid exakt ankomsttid till B (08:02:30) börjar uppehållet: står stilla vid B', () => {
    const t = t1(trains(data, at(150)));
    expect(t.status).toBe('dwelling');
    expect(t.fromStation).toBe('B');
    expect(t.toStation).toBe('B');
    expect(t.speedMps).toBe(0);
    expect(t.progress).toBe(0);
    expect(dist(t, 45.4, 9.11)).toBeLessThan(0.5);
  });
  it('under hela uppehållet står tåget på samma plats, även sekunden före avgång', () => {
    const a = t1(trains(data, at(160)));
    const b = t1(trains(data, at(179)));
    expect(a.status).toBe('dwelling');
    expect(b.status).toBe('dwelling');
    expect(a.lat).toBe(b.lat);
    expect(a.lon).toBe(b.lon);
  });
});

describe('trains – mellan stationer', () => {
  it('mitt i tid mellan A och B (08:01:15) är progress 0,5 och positionen halvvägs längs shapen', () => {
    const t = t1(trains(data, at(75)));
    expect(t.progress).toBeCloseTo(0.5, 6);
    const expected = pointAlong(east, (SD_A + SD_B) / 2);
    expect(dist(t, expected.lat, expected.lon)).toBeLessThan(0.5);
    expect(t.status).toBe('moving');
    expect(t.fromStation).toBe('A');
    expect(t.toStation).toBe('B');
  });
  it('hastigheten är sd-skillnad / körtid (A→B: (sdB−sdA)/150 s)', () => {
    const t = t1(trains(data, at(75)));
    expect(t.speedMps).toBeCloseTo((SD_B - SD_A) / 150, 3);
  });
  it('B→C: progress ökar linjärt i tid (25 % efter 37,5 s av 150 s)', () => {
    const t = t1(trains(data, at(180 + 37.5)));
    expect(t.progress).toBeCloseTo(0.25, 6);
    expect(t.speedMps).toBeCloseTo((SD_C - SD_B) / 150, 3);
  });
  it('riktning (headingDeg) är ≈ 90° (öst) på rak östlig shape, i både rörelse och uppehåll', () => {
    expect(t1(trains(data, at(75))).headingDeg).toBeCloseTo(90, 0);
    expect(t1(trains(data, at(160))).headingDeg).toBeCloseTo(90, 0);
  });
  it('fältet direction är riktnings-id och line är linje-id', () => {
    const t = t1(trains(data, at(75)));
    expect(t.line).toBe('M9');
    expect(t.direction).toBe('M9>C');
  });
});

describe('trains – eget shape_id per trip och shape-form', () => {
  const day = 10;
  const boj = (ts: Train[]) => byStart(ts, 2)[0];
  it('följer en böjd shape: positionen ligger på linjen och riktningen byter vid hörnet', () => {
    const quarter = boj(trains(data, at(75, day))); // 25 % av 300 s
    const threeQ = boj(trains(data, at(225, day))); // 75 %
    const snap = shapeIndex(S_BENT);
    for (const t of [quarter, threeQ]) {
      const exp = pointAlong(snap, t.progress * snap.length);
      expect(dist(t, exp.lat, exp.lon)).toBeLessThan(0.5);
    }
    expect(quarter.headingDeg).toBeCloseTo(90, 0); // på östra benet
    expect(threeQ.headingDeg).toBeCloseTo(0, 0); // på norra benet
  });
  it('två mönster med samma stopp men olika shape_id ger olika positioner samtidigt', () => {
    const ts = trains(data, at(75, day));
    const rak = ts.find((t) => t.id.startsWith('3:'))!; // S_ALT
    const stdIdx = pointAlong(east, (SD_A + SD_B) / 2);
    // S_ALT-tåget ligger inte på den raka linjen
    expect(dist(rak, stdIdx.lat, stdIdx.lon)).toBeGreaterThan(20);
    const exp = pointAlong(alt, alt.cum[2] / 2);
    expect(dist(rak, exp.lat, exp.lon)).toBeLessThan(0.5);
  });
  it('shapeQuality propageras: coarse-mönster → "coarse", övriga → "ok"', () => {
    const ts = trains(data, at(75, day));
    expect(boj(ts).shapeQuality).toBe('coarse');
    expect(ts.find((t) => t.id.startsWith('3:'))!.shapeQuality).toBe('ok');
  });
});

describe('trains – inga tåg utanför servicetid', () => {
  it('ingenting 1 s före första starten (07:59:59) och ingenting före dess', () => {
    expect(trains(data, at(-1))).toEqual([]);
    expect(trains(data, rome(3, 0, 0))).toEqual([]);
  });
  it('tåget finns till 1 s före slutankomst och är borta exakt vid slutankomst (08:05:30)', () => {
    expect(t1(trains(data, at(329)))).toBeDefined();
    expect(t1(trains(data, at(330)))).toBeUndefined(); // T2 (start 08:01) är kvar, bara T1 är borta
  });
  it('efter sista tåget är listan tom', () => {
    expect(trains(data, rome(12, 0, 0))).toEqual([]);
  });
  it('fel dag: tjänsten är inte aktiv 7/11 mitt på dagen', () => {
    expect(trains(data, at(75, 7))).toEqual([]);
  });
  it('tillagd och borttagen samma dag (exception_type 1 + 2) → inget tåg', () => {
    const ts = trains(data, rome(8, 20, 0)); // 30000 s = 08:20:00 start
    expect(ts.some((t) => t.id.includes(':2:'))).toBe(false); // tjänst 2
    expect(ts).toEqual([]);
  });
  it('två samtidiga tåg (T1 och T2, 1 min mellan) får olika id och olika positioner', () => {
    const ts = trains(data, at(75));
    expect(ts.length).toBe(2);
    expect(new Set(ts.map((t) => t.id)).size).toBe(2);
    expect(ts[0].lat === ts[1].lat && ts[0].lon === ts[1].lon).toBe(false);
  });
});

describe('trains – nattrafik över midnatt', () => {
  // natt-trip: tjänstedygn 6/11, start 23:50:00 (85800). B: ank. 86400 (00:00:00), avg. 86460. C: ank. 87300 (00:15:00).
  const natt = (ts: Train[]) => byStart(ts, 1)[0];
  it('före midnatt (23:55 den 6/11) är tåget på väg A→B', () => {
    const t = natt(trains(data, rome(23, 55, 0, 6)));
    expect(t.fromStation).toBe('A');
    expect(t.toStation).toBe('B');
    expect(t.progress).toBeCloseTo(300 / 600, 6);
  });
  it('efter midnatt (00:05 den 7/11) finns tåget från gårdagens tjänstedygn och är på väg B→C', () => {
    const t = natt(trains(data, rome(0, 5, 0, 7)));
    expect(t).toBeDefined();
    expect(t.fromStation).toBe('B');
    expect(t.toStation).toBe('C');
    expect(t.progress).toBeCloseTo((86700 - 86460) / (87300 - 86460), 6);
  });
  it('vid exakt midnatt står det vid B (uppehåll 00:00:00–00:01:00)', () => {
    const t = natt(trains(data, rome(0, 0, 0, 7)));
    expect(t.status).toBe('dwelling');
    expect(t.fromStation).toBe('B');
    expect(dist(t, 45.4, 9.11)).toBeLessThan(0.5);
  });
  it('slutar exakt vid slutankomst (00:15:00) och finns kvar sekunden innan', () => {
    expect(natt(trains(data, rome(0, 14, 59, 7)))).toBeDefined();
    expect(natt(trains(data, rome(0, 15, 0, 7)))).toBeUndefined();
  });
  it('gårdagens tjänstedygn måste vara aktivt: 00:05 den 9/11 (gårdag 8/11 ej aktiv) → inget nattåg', () => {
    expect(natt(trains(data, rome(0, 5, 0, 9)))).toBeUndefined();
  });
  it('samma trip har olika id olika tjänstedygn, och samma id mellan anrop', () => {
    const idOn6 = natt(trains(data, rome(0, 5, 0, 7))).id; // från dygn 6/11
    const idOn7 = natt(trains(data, rome(23, 55, 0, 7))).id; // från dygn 7/11
    expect(idOn6).not.toBe(idOn7);
    expect(natt(trains(data, rome(0, 6, 0, 7))).id).toBe(idOn6);
  });
  it('dubbelräknar inte: kl. 00:05 den 7/11 finns exakt ett nattåg', () => {
    expect(byStart(trains(data, rome(0, 5, 0, 7)), 1).length).toBe(1);
  });
});

describe('trains – renhet', () => {
  it('muterar inte indata och är deterministisk', () => {
    const frozen = structuredClone(data);
    const deepFreeze = (o: unknown): void => {
      if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
    };
    deepFreeze(frozen);
    expect(trains(frozen, at(75))).toEqual(trains(data, at(75)));
  });
});

// ---- smoke-test mot verkliga metro.json (hoppas över om filen saknas) ----
const real = Object.values(import.meta.glob('../../public/metro.json', { eager: true, import: 'default' }))[0] as MetroData | undefined;
describe.skipIf(!real)('verklig metro.json', () => {
  it('fredag 12:00 Rom: tåg på alla fem linjer, alla inom Milanoområdet, dataStatus ok', () => {
    const when = new Date('2026-11-06T11:00:00Z');
    expect(dataStatus(real!, when)).toBe('ok');
    const ts = trains(real!, when);
    expect(ts.length).toBeGreaterThan(50);
    expect(new Set(ts.map((t) => t.line))).toEqual(new Set(['M1', 'M2', 'M3', 'M4', 'M5']));
    for (const t of ts) {
      expect(t.lat).toBeGreaterThan(45.38);
      expect(t.lat).toBeLessThan(45.56);
      expect(t.lon).toBeGreaterThan(9.05);
      expect(t.lon).toBeLessThan(9.45);
      expect(t.headingDeg).toBeGreaterThanOrEqual(0);
      expect(t.headingDeg).toBeLessThan(360);
      expect(t.progress).toBeGreaterThanOrEqual(0);
      expect(t.progress).toBeLessThanOrEqual(1);
    }
    expect(new Set(ts.map((t) => t.id)).size).toBe(ts.length);
  });
  it('03:00 på natten finns inga tåg enligt tidtabellen', () => {
    expect(trains(real!, new Date('2026-11-06T02:00:00Z'))).toEqual([]);
  });
  it('efter 2026-11-30 är status expired och inga tåg returneras', () => {
    const when = new Date('2026-12-01T11:00:00Z');
    expect(dataStatus(real!, when)).toBe('expired');
    expect(trains(real!, when)).toEqual([]);
  });
});

import { romeDate } from './time';
describe('romeDate (invers till romeServiceTime)', () => {
  it('lokal Rom-tid → rätt UTC, vinter och sommar', () => {
    expect(romeDate(20261106, 12 * 3600).toISOString()).toBe('2026-11-06T11:00:00.000Z');
    expect(romeDate(20260701, 12 * 3600).toISOString()).toBe('2026-07-01T10:00:00.000Z');
    expect(romeDate(20261107, 1800).toISOString()).toBe('2026-11-06T23:30:00.000Z');
  });
  it('rundtur ger samma värden', () => {
    const r = romeServiceTime(romeDate(20261130, 86399));
    expect(r).toEqual({ ymd: 20261130, sec: 86399 });
  });
});

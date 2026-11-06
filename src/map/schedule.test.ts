import { describe, expect, it } from 'vitest';
import { shapeIndex } from '../geo';
import { SCHEDULE_ONLY, trains as engineTrains } from '../engine';
import { makeData, S_ALT, S_BENT, S_EAST } from '../engine/testdata';
import type { MetroData, Train } from '../engine/types';
import { parseTrainId, trainSchedule, validityInfo } from './schedule';

const trains = (d: MetroData, at: Date) => engineTrains(d, at, SCHEDULE_ONLY);
const sched = (d: MetroData, t: Train, at: Date) => trainSchedule(d, t, at, SCHEDULE_ONLY);

const east = shapeIndex(S_EAST);
const bent = shapeIndex(S_BENT);
const alt = shapeIndex(S_ALT);
const data: MetroData = makeData({ east: [0, east.cum[1], east.cum[2]], bent: [0, bent.length], alt: [0, alt.cum[2], alt.cum[4]] });
// T1: mönster 0, start 08:00:00 (28800), tjänst s0 aktiv 6/11. A→B (0..150), uppehåll B (150..180), B→C (180..330)
const rome = (h: number, m: number, s = 0, day = 6) => new Date(Date.UTC(2026, 10, day, h - 1, m, s));
const t1At = (sec: number): { t: Train; at: Date } => {
  const at = new Date(rome(0, 0, 0).getTime() + (28800 + sec) * 1000);
  const t = trains(data, at).find((x) => x.id === '0:0:20261106:28800')!;
  return { t, at };
};

describe('parseTrainId', () => {
  it('läser mönster, tjänst, tjänstedygn och start', () => {
    expect(parseTrainId('3:7:20261106:28800')).toEqual({ pattern: 3, service: 7, day: 20261106, start: 28800 });
    expect(parseTrainId('skräp')).toBeNull();
  });
});

describe('trainSchedule', () => {
  it('under gång: nedräkning till ankomst vid nästa station och framsteg längs sträckan', () => {
    const { t, at } = t1At(100); // 50 s före ankomst till B
    const s = sched(data, t, at)!;
    expect(s.fromName).toBe('A');
    expect(s.nextStationName).toBe('B');
    expect(s.terminusName).toBe('C');
    expect(s.secondsToNextArrival).toBeCloseTo(50, 6);
    expect(s.secondsToDeparture).toBeNull();
    expect(s.stopCount).toBe(3);
    expect(s.stopIndex).toBe(0);
    // sträcka A→B är halva sträckan; 100/150 av den = 1/3 av hela
    expect(s.routeProgress).toBeCloseTo((100 / 150) * 0.5, 3);
    expect(s.stops.map((x) => x.name)).toEqual(['A', 'B', 'C']);
    expect(s.stops[0].f).toBe(0);
    expect(s.stops[2].f).toBeCloseTo(1, 9);
    expect(s.stops[1].f).toBeCloseTo(0.5, 3);
  });
  it('under uppehåll: avgång om N s och nästa station är nästa i turen', () => {
    const { t, at } = t1At(160); // dwell vid B, avgår 180
    const s = sched(data, t, at)!;
    expect(t.status).toBe('dwelling');
    expect(s.fromName).toBe('B');
    expect(s.nextStationName).toBe('C');
    expect(s.secondsToDeparture).toBeCloseTo(20, 6);
    expect(s.secondsToNextArrival).toBeCloseTo(170, 6);
    expect(s.routeProgress).toBeCloseTo(0.5, 3);
  });
  it('nattåg med tid över 24:00 från gårdagens tjänstedygn räknar rätt', () => {
    // natt-trip: tjänstedygn 6/11, start 85800, B ank 86400 → 00:00:00 den 7/11. Vid 00:05 är den på väg B→C.
    const at = rome(0, 5, 0, 7);
    const t = trains(data, at).find((x) => x.id.startsWith('1:1:20261106'))!;
    const s = sched(data, t, at)!;
    expect(s.fromName).toBe('B');
    expect(s.secondsToNextArrival).toBeCloseTo(87300 - 86700, 6); // C ank. 87300
  });
  it('okänt id ger null', () => {
    const { t, at } = t1At(10);
    expect(sched(data, { ...t, id: 'x' }, at)).toBeNull();
  });
});

describe('validityInfo', () => {
  it('ok, utgången och inte giltig än, med dagar kvar', () => {
    expect(validityInfo(data, rome(12, 0, 0, 6))).toMatchObject({ status: 'ok', from: '2026-10-26', to: '2026-11-30', daysLeft: 24 });
    expect(validityInfo(data, new Date('2026-11-30T20:00:00Z'))).toMatchObject({ status: 'ok', daysLeft: 0 });
    expect(validityInfo(data, new Date('2026-12-02T10:00:00Z'))).toMatchObject({ status: 'expired', daysLeft: -2 });
    expect(validityInfo(data, new Date('2026-10-20T10:00:00Z'))).toMatchObject({ status: 'notYetValid' });
  });
});

import { describe, expect, it } from 'vitest';
import { shapeIndex } from '../geo';
import { makeData, S_ALT, S_BENT, S_EAST } from '../engine/testdata';
import { SCHEDULE_ONLY } from '../engine';
import { findNextTrafficMs } from './traffic';

const e = shapeIndex(S_EAST), b = shapeIndex(S_BENT), a = shapeIndex(S_ALT);
const data = makeData({ east: [0, e.cum[1], e.cum[2]], bent: [0, b.length], alt: [0, a.cum[2], a.cum[4]] });
const rome = (h: number, m: number, s = 0, day = 6) => Date.UTC(2026, 10, day, h - 1, m, s);

describe('findNextTrafficMs', () => {
  it('hittar första tåget (08:00 Rom) inom ett steg från en tidigare tid', () => {
    const t = findNextTrafficMs(data, rome(7, 0), 120, 26, SCHEDULE_ONLY)!;
    expect(t).toBeGreaterThanOrEqual(rome(8, 0));
    expect(t).toBeLessThan(rome(8, 0) + 120_000);
  });
  it('returnerar samma tid om tåg redan kör', () => {
    expect(findNextTrafficMs(data, rome(8, 1, 15), 120, 26, SCHEDULE_ONLY)).toBe(rome(8, 1, 15));
  });
  it('null när tidtabellen har gått ut', () => {
    expect(findNextTrafficMs(data, Date.UTC(2026, 11, 5, 0, 0, 0), 600, 30, SCHEDULE_ONLY)).toBeNull();
  });
});

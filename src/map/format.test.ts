import { describe, expect, it } from 'vitest';
import { esc, fmtCount, fmtDate, fmtDist, fmtHM, fmtHMS } from './format';

describe('format', () => {
  it('tider', () => {
    expect(fmtHMS(22 * 3600 + 18 * 60 + 58)).toBe('22:18:58');
    expect(fmtHM(22 * 3600 + 18 * 60 + 58)).toBe('22:18');
    expect(fmtHM(86400 + 90)).toBe('00:01'); // efter midnatt
    expect(fmtCount(125)).toBe('2:05');
  });
  it('avstånd med decimalkomma', () => {
    expect(fmtDist(320)).toBe('320 m');
    expect(fmtDist(1380)).toBe('1,4 km');
  });
  it('datum utan punkt och utan "t.o.m."', () => {
    expect(fmtDate('2026-11-30')).toBe('30 nov 2026');
    expect(fmtDate('2026-10-26')).toBe('26 okt 2026');
    expect(fmtDate('2026-03-01')).toBe('1 mars 2026');
  });
  it('esc', () => {
    expect(esc('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
  });
});

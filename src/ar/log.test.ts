import { describe, expect, it } from 'vitest';
import { CSV_COLUMNS, LogRecorder, formatRow, type LogRow } from './log';

const row = (over: Partial<LogRow> = {}): LogRow => ({
  timeMs: Date.UTC(2026, 10, 6, 12, 0, 0, 123),
  lat: 45.4642, lon: 9.19, gpsAcc: 9.4,
  rawCompass: 91.26, compassAcc: 12,
  alpha: 10, beta: 85.55, gamma: -2,
  filteredYaw: 90.04, yawOffset: 137.5, manual: 0,
  trainsInView: 2, mark: false, source: 'real', buildId: '2026-11-06T12:00:00Z',
  ...over,
});

describe('CSV-format', () => {
  it('kolumnordning enligt önskemål, plus manual/mark/source', () => {
    expect(CSV_COLUMNS.join(',')).toBe(
      'time,lat,lon,gpsAcc,rawCompassHeading,compassAcc,alpha,beta,gamma,filteredYawDeg,yawOffsetDeg,manualDeg,trainsInView,mark,source,buildId',
    );
  });
  it('en rad har lika många fält som rubriken och inga extra kommatecken', () => {
    const f = formatRow(row()).split(',');
    expect(f.length).toBe(CSV_COLUMNS.length);
    expect(f[0]).toBe('2026-11-06T12:00:00.123Z');
    expect(f[1]).toBe('45.464200');
    expect(f[3]).toBe('9.4');
    expect(f[4]).toBe('91.3'); // 1 decimal
    expect(f[13]).toBe('0');
    expect(f.at(-1)).toBe('2026-11-06T12:00:00Z');
  });
  it('saknade värden (null/NaN) blir tomma fält, mark blir 1', () => {
    const f = formatRow(row({ lat: null, gpsAcc: null, rawCompass: null, compassAcc: null, alpha: NaN, mark: true })).split(',');
    expect(f[1]).toBe('');
    expect(f[3]).toBe('');
    expect(f[4]).toBe('');
    expect(f[5]).toBe('');
    expect(f[6]).toBe('');
    expect(f[13]).toBe('1');
    expect(f.length).toBe(CSV_COLUMNS.length);
  });
});

describe('LogRecorder', () => {
  it('loggar en rad var 200 ms i 30 s (≈150 rader) och stoppar sedan', () => {
    const r = new LogRecorder();
    r.start(0);
    let finished = false;
    for (let t = 0; t <= 31_000; t += 20) finished = r.tick(t, () => row()) || finished;
    expect(finished).toBe(true);
    expect(r.active).toBe(false);
    expect(r.rowCount).toBeGreaterThanOrEqual(150);
    expect(r.rowCount).toBeLessThanOrEqual(152);
  });
  it('tick före nästa intervall lägger inte till rad', () => {
    const r = new LogRecorder();
    r.start(0);
    r.tick(0, () => row());
    r.tick(100, () => row());
    expect(r.rowCount).toBe(1);
    r.tick(200, () => row());
    expect(r.rowCount).toBe(2);
  });
  it('mark() lägger till en extra rad med flaggan satt, bara under inspelning', () => {
    const r = new LogRecorder();
    expect(r.mark(5, () => row())).toBe(false); // ej igång
    r.start(0);
    r.tick(0, () => row());
    expect(r.mark(50, () => row())).toBe(true);
    const lines = r.toCsv().split('\n');
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    expect(lines.length).toBe(3);
    expect(lines[1].split(',')[13]).toBe('0');
    expect(lines[2].split(',')[13]).toBe('1');
    expect(r.markCount).toBe(1);
  });
  it('ny inspelning rensar gammal logg; toCsv utan rader ger bara rubriken', () => {
    const r = new LogRecorder();
    expect(r.toCsv()).toBe(CSV_COLUMNS.join(','));
    r.start(0);
    r.tick(0, () => row());
    r.start(1000);
    expect(r.rowCount).toBe(0);
  });
  it('remainingSec räknar ned från 30', () => {
    const r = new LogRecorder();
    r.start(0);
    expect(r.remainingSec(0)).toBe(30);
    expect(r.remainingSec(12_400)).toBe(18);
    expect(r.remainingSec(99_000)).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { alphaHeading, CSV_HEADER, csvRow, fmt, formatReading, headingDiff, normalizeHeading, rateHz } from './format';

describe('normalizeHeading', () => {
  it('wrappar till 0–360', () => {
    expect(normalizeHeading(-10)).toBe(350);
    expect(normalizeHeading(370)).toBe(10);
    expect(normalizeHeading(0)).toBe(0);
  });
});

describe('alphaHeading', () => {
  it('är (360 - alpha) mod 360', () => {
    expect(alphaHeading(0)).toBe(0);
    expect(alphaHeading(90)).toBe(270);
    expect(alphaHeading(360)).toBe(0);
  });
});

describe('headingDiff', () => {
  it('ger kortaste signerade skillnad', () => {
    expect(headingDiff(10, 350)).toBe(20);
    expect(headingDiff(350, 10)).toBe(-20);
    expect(headingDiff(90, 90)).toBe(0);
    expect(headingDiff(180, 0)).toBe(180);
  });
});

describe('rateHz', () => {
  it('räknar frekvens', () => {
    const stamps = [0, 100, 200, 300, 400];
    expect(rateHz(stamps, 400)).toBeCloseTo(10, 5);
  });
  it('ger 0 vid för få event', () => {
    expect(rateHz([], 0)).toBe(0);
    expect(rateHz([5], 5)).toBe(0);
  });
  it('ignorerar gamla event', () => {
    expect(rateHz([0, 100], 10000)).toBe(0);
  });
});

describe('fmt', () => {
  it('visar streck för saknat värde', () => {
    expect(fmt(null)).toBe('–');
    expect(fmt(NaN)).toBe('–');
    expect(fmt(1.234, 2)).toBe('1.23');
  });
});

const gps = { lat: 45.4642, lon: 9.19, accuracy: 12.4, speed: null, heading: null, ts: 1000 };
const orient = { alpha: 270, beta: 2, gamma: 3, compass: 85, compassAccuracy: -1, ts: 1000 };

describe('formatReading', () => {
  it('visar data, Hz, okalibrerad och diff', () => {
    const s = formatReading({
      secure: true,
      hasOrientationPermissionApi: true,
      status: { orientation: 'OK', camera: 'OK', gps: 'OK' },
      hz: 59.7,
      now: 1500,
      gps,
      orient,
    });
    expect(s).toContain('45.464200');
    expect(s).toContain('±12 m');
    expect(s).toContain('tar emot data (59.7 Hz)');
    expect(s).toContain('OKALIBRERAD');
    expect(s).toContain('diff: 5.0°');
  });
});

describe('csvRow', () => {
  it('har lika många kolumner som headern och tomma fält för saknat', () => {
    const row = csvRow(0, gps, orient);
    expect(row.split(',').length).toBe(CSV_HEADER.split(',').length);
    expect(csvRow(0).split(',').length).toBe(CSV_HEADER.split(',').length);
    expect(row).toContain('45.464200,9.190000,12.4,85.0,-1,270.0,2.0,3.0');
  });
});

import { describe, expect, it } from 'vitest';
import { haversine } from './index';
import { fromLocalMeters, toLocalMeters } from './enu';

const origin = { lat: 45.4642, lon: 9.19 };

describe('toLocalMeters', () => {
  it('ursprunget är (0, 0)', () => {
    expect(toLocalMeters(origin, origin.lat, origin.lon)).toEqual({ east: 0, north: 0 });
  });
  it('norrut är positivt norr, österut positivt öst', () => {
    const n = toLocalMeters(origin, origin.lat + 0.001, origin.lon);
    expect(n.north).toBeGreaterThan(111);
    expect(n.north).toBeLessThan(111.4);
    expect(Math.abs(n.east)).toBeLessThan(1e-6);
    const e = toLocalMeters(origin, origin.lat, origin.lon + 0.001);
    expect(e.east).toBeGreaterThan(77);
    expect(e.east).toBeLessThan(79); // 111,2 m * cos(45,46°) ≈ 78 m
    expect(Math.abs(e.north)).toBeLessThan(1e-6);
  });
  it('söder och väster är negativa', () => {
    const p = toLocalMeters(origin, origin.lat - 0.002, origin.lon - 0.002);
    expect(p.north).toBeLessThan(0);
    expect(p.east).toBeLessThan(0);
  });
  it('stämmer med haversine inom 0,3 % på 300 m', () => {
    const lat = origin.lat + 0.002;
    const lon = origin.lon + 0.003;
    const { east, north } = toLocalMeters(origin, lat, lon);
    const d = haversine(origin.lat, origin.lon, lat, lon);
    expect(Math.abs(Math.hypot(east, north) - d)).toBeLessThan(d * 0.003);
  });
});

describe('fromLocalMeters', () => {
  it('är invers till toLocalMeters', () => {
    const { east, north } = toLocalMeters(origin, 45.4701, 9.2013);
    const back = fromLocalMeters(origin, east, north);
    expect(back.lat).toBeCloseTo(45.4701, 9);
    expect(back.lon).toBeCloseTo(9.2013, 9);
  });
});

import { describe, expect, it } from 'vitest';
import { bearing, distanceToPolyline, haversine, pointAlong, shapeIndex } from './index';

const EAST: [number, number][] = [[45.4, 9.1], [45.4, 9.11], [45.4, 9.12]];
const BENT: [number, number][] = [[45.4, 9.1], [45.4, 9.11], [45.41, 9.11]];

describe('haversine', () => {
  it('1° latitud ≈ 111,2 km', () => {
    expect(haversine(45, 9, 46, 9)).toBeGreaterThan(111_100);
    expect(haversine(45, 9, 46, 9)).toBeLessThan(111_300);
  });
  it('0 för samma punkt, symmetrisk', () => {
    expect(haversine(45.4, 9.1, 45.4, 9.1)).toBe(0);
    expect(haversine(45.4, 9.1, 45.5, 9.2)).toBeCloseTo(haversine(45.5, 9.2, 45.4, 9.1), 6);
  });
});

describe('bearing', () => {
  it('norr 0, öster 90, söder 180, väster 270', () => {
    expect(bearing(45.4, 9.1, 45.5, 9.1)).toBeCloseTo(0, 1);
    expect(bearing(45.4, 9.1, 45.4, 9.2)).toBeCloseTo(90, 0);
    expect(bearing(45.4, 9.1, 45.3, 9.1)).toBeCloseTo(180, 1);
    expect(bearing(45.4, 9.1, 45.4, 9.0)).toBeCloseTo(270, 0);
  });
  it('ligger alltid i [0, 360)', () => {
    const b = bearing(45.4, 9.1, 45.4, 9.0);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
  });
});

describe('shapeIndex / pointAlong', () => {
  it('total längd = summan av segmenten', () => {
    const idx = shapeIndex(EAST);
    const sum = haversine(45.4, 9.1, 45.4, 9.11) + haversine(45.4, 9.11, 45.4, 9.12);
    expect(Math.abs(idx.length - sum)).toBeLessThan(sum * 0.002);
  });
  it('d=0 ger första punkten och d=längd den sista; utanför klipps', () => {
    const idx = shapeIndex(EAST);
    const p0 = pointAlong(idx, 0);
    const pn = pointAlong(idx, idx.length);
    expect(haversine(p0.lat, p0.lon, 45.4, 9.1)).toBeLessThan(0.1);
    expect(haversine(pn.lat, pn.lon, 45.4, 9.12)).toBeLessThan(0.1);
    expect(pointAlong(idx, -50).lat).toBeCloseTo(45.4, 6);
    expect(haversine(pointAlong(idx, idx.length + 500).lat, pointAlong(idx, idx.length + 500).lon, 45.4, 9.12)).toBeLessThan(0.1);
  });
  it('mitten av första segmentet ligger halvvägs och har riktning öst', () => {
    const idx = shapeIndex(EAST);
    const first = haversine(45.4, 9.1, 45.4, 9.11);
    const p = pointAlong(idx, first / 2);
    expect(haversine(p.lat, p.lon, 45.4, 9.105)).toBeLessThan(0.5);
    expect(p.headingDeg).toBeCloseTo(90, 0);
  });
  it('riktningen byter vid hörnet på en böjd shape', () => {
    const idx = shapeIndex(BENT);
    const leg1 = haversine(45.4, 9.1, 45.4, 9.11);
    expect(pointAlong(idx, leg1 * 0.5).headingDeg).toBeCloseTo(90, 0);
    expect(pointAlong(idx, leg1 + 100).headingDeg).toBeCloseTo(0, 0);
    expect(pointAlong(idx, leg1 + 100).lon).toBeCloseTo(9.11, 5);
  });
  it('distanceToPolyline: punkt på linjen ≈ 0, 111 m norr om linjen ≈ 111 m', () => {
    expect(distanceToPolyline(EAST, 45.4, 9.105)).toBeLessThan(0.5);
    expect(distanceToPolyline(EAST, 45.401, 9.105)).toBeGreaterThan(110);
    expect(distanceToPolyline(EAST, 45.401, 9.105)).toBeLessThan(112);
  });
});

import { describe, expect, it } from 'vitest';
import type { Train } from '../engine/types';
import { nearbyTrains } from './nearby';

const user = { lat: 45.4642, lon: 9.19 };
const mk = (id: string, lat: number, lon: number): Train => ({
  id, line: 'M1', direction: 'M1>X', lat, lon, headingDeg: 90, speedMps: 10,
  fromStation: 'A', toStation: 'B', progress: 0.5, status: 'moving', shapeQuality: 'ok',
});

describe('nearbyTrains', () => {
  it('tar bara tåg inom radien (300 m) och sorterar närmast först', () => {
    const near = mk('near', user.lat + 0.001, user.lon); // ≈111 m norr
    const mid = mk('mid', user.lat, user.lon + 0.003); // ≈234 m öst
    const far = mk('far', user.lat + 0.004, user.lon); // ≈445 m
    const r = nearbyTrains([far, mid, near], user, 300);
    expect(r.map((x) => x.train.id)).toEqual(['near', 'mid']);
  });
  it('ger lokala meter öst/nord, avstånd och bäring till tåget', () => {
    const [n, e] = nearbyTrains([mk('n', user.lat + 0.001, user.lon), mk('e', user.lat, user.lon + 0.002)], user, 300);
    expect(n.north).toBeGreaterThan(110); expect(Math.abs(n.east)).toBeLessThan(0.01);
    expect(n.bearingDeg).toBeCloseTo(0, 1);
    expect(e.east).toBeGreaterThan(150); expect(Math.abs(e.north)).toBeLessThan(0.01);
    expect(e.bearingDeg).toBeCloseTo(90, 1);
    expect(n.distance).toBeCloseTo(Math.hypot(n.east, n.north), 6);
  });
  it('tom lista ger tom lista; radie 0 ger bara tåg exakt på användaren', () => {
    expect(nearbyTrains([], user, 300)).toEqual([]);
    expect(nearbyTrains([mk('x', user.lat + 0.0001, user.lon)], user, 0)).toEqual([]);
  });
  it('gränsfall: tåg vid precis radie ingår', () => {
    const t = mk('edge', user.lat + 0.0026949, user.lon); // ≈ 299,7 m
    expect(nearbyTrains([t], user, 300).length).toBe(1);
  });
});

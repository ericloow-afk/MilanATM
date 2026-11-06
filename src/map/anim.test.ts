import { describe, expect, it } from 'vitest';
import { interpolateTrains, lerpAngle, type Pos } from './anim';

const P = (lat: number, lon: number, heading = 90): Pos => ({ lat, lon, heading });

describe('lerpAngle', () => {
  it('går kortaste väg över 0°/360°', () => {
    expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(0, 9);
    expect(lerpAngle(10, 350, 0.5)).toBeCloseTo(0, 9);
    expect(lerpAngle(90, 100, 0.5)).toBeCloseTo(95, 9);
  });
  it('f=0 och f=1 ger ändpunkterna', () => {
    expect(lerpAngle(30, 120, 0)).toBeCloseTo(30, 9);
    expect(lerpAngle(30, 120, 1)).toBeCloseTo(120, 9);
  });
  it('resultatet ligger i [0, 360)', () => {
    const a = lerpAngle(5, 355, 0.9);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(360);
  });
});

describe('interpolateTrains', () => {
  const prev = new Map([['a', P(45.0, 9.0, 0)], ['gone', P(45.5, 9.5)]]);
  const next = new Map([['a', P(45.002, 9.004, 90)], ['new', P(45.1, 9.1)]]);
  it('f=0.5: halvvägs för tåg som finns i båda', () => {
    const a = interpolateTrains(prev, next, 0.5).find((x) => x.id === 'a')!;
    expect(a.lat).toBeCloseTo(45.001, 9);
    expect(a.lon).toBeCloseTo(9.002, 9);
    expect(a.heading).toBeCloseTo(45, 9);
    expect(a.appearing || a.vanishing).toBe(false);
  });
  it('f=0 ger föregående och f=1 nästa position', () => {
    const a0 = interpolateTrains(prev, next, 0).find((x) => x.id === 'a')!;
    const a1 = interpolateTrains(prev, next, 1).find((x) => x.id === 'a')!;
    expect(a0.lat).toBeCloseTo(45.0, 9);
    expect(a1.lat).toBeCloseTo(45.002, 9);
  });
  it('nytt tåg visas direkt på sin plats och flaggas appearing', () => {
    const n = interpolateTrains(prev, next, 0.2).find((x) => x.id === 'new')!;
    expect(n.appearing).toBe(true);
    expect(n.lat).toBeCloseTo(45.1, 9);
  });
  it('tåg som försvinner stannar på sista platsen och flaggas vanishing', () => {
    const g = interpolateTrains(prev, next, 0.7).find((x) => x.id === 'gone')!;
    expect(g.vanishing).toBe(true);
    expect(g.lat).toBeCloseTo(45.5, 9);
  });
  it('f utanför [0,1] klipps', () => {
    const a = interpolateTrains(prev, next, 5).find((x) => x.id === 'a')!;
    expect(a.lat).toBeCloseTo(45.002, 9);
  });
});

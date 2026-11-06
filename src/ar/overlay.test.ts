import { describe, expect, it } from 'vitest';
import { edgeIndicator, relativeBearing } from './overlay';

describe('relativeBearing', () => {
  it('är mål − kamera, wrappad till [-180, 180)', () => {
    expect(relativeBearing(90, 80)).toBeCloseTo(10, 9);
    expect(relativeBearing(10, 350)).toBeCloseTo(20, 9);
    expect(relativeBearing(350, 10)).toBeCloseTo(-20, 9);
    expect(relativeBearing(0, 180)).toBeCloseTo(-180, 9);
  });
});

const W = 400, H = 800, M = 24;
describe('edgeIndicator', () => {
  it('inom bild och framför kameran: synligt, ingen pil, position i pixlar', () => {
    const r = edgeIndicator(0, 0, false, W, H, M);
    expect(r.onScreen).toBe(true);
    expect(r.x).toBeCloseTo(200, 6);
    expect(r.y).toBeCloseTo(400, 6);
    const tl = edgeIndicator(-1, 1, false, W, H, M);
    expect(tl.onScreen).toBe(false); // exakt på kanten räknas som utanför
  });
  it('höger om bild: pil på högerkanten, pekar åt höger (0 rad)', () => {
    const r = edgeIndicator(2, 0, false, W, H, M);
    expect(r.onScreen).toBe(false);
    expect(r.x).toBeCloseTo(W - M, 6);
    expect(r.y).toBeCloseTo(400, 6);
    expect(r.angleRad).toBeCloseTo(0, 6);
  });
  it('över bild: pil på överkanten, pekar uppåt (−π/2 i skärmkoordinater)', () => {
    const r = edgeIndicator(0, 3, false, W, H, M);
    expect(r.y).toBeCloseTo(M, 6);
    expect(r.x).toBeCloseTo(200, 6);
    expect(r.angleRad).toBeCloseTo(-Math.PI / 2, 6);
  });
  it('diagonalt: pilen hamnar på rätt kant längs strålen från mitten', () => {
    const r = edgeIndicator(4, 1, false, W, H, M); // mer horisontellt än vertikalt → högerkanten
    expect(r.x).toBeCloseTo(W - M, 6);
    expect(r.y).toBeLessThan(400); // y upp i NDC = uppåt på skärmen
    expect(r.y).toBeGreaterThan(M);
  });
  it('bakom kameran: peka åt sidan man ska vrida sig (spegla x), alltid utanför bild', () => {
    const r = edgeIndicator(0.2, 0, true, W, H, M); // målet ligger snett höger bakom → vrid åt höger
    expect(r.onScreen).toBe(false);
    expect(r.x).toBeCloseTo(W - M, 6);
    expect(r.angleRad).toBeCloseTo(0, 6);
    const l = edgeIndicator(-0.2, 0, true, W, H, M);
    expect(l.x).toBeCloseTo(M, 6);
    expect(Math.abs(l.angleRad)).toBeCloseTo(Math.PI, 6);
  });
  it('rakt bakom (x = 0): väljer en sida (höger) i stället för att ge NaN', () => {
    const r = edgeIndicator(0, 0, true, W, H, M);
    expect(Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.angleRad)).toBe(true);
    expect(r.onScreen).toBe(false);
  });
});

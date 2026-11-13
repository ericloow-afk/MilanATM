// Spårets bäring ur shapen (tools/lib/track-bearing-lib.mjs) mot fältmätningen 8 nov (docs/field-notes-2026-11-08.md).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { angleDiff, bearing, trackBearings } from './lib/track-bearing-lib.mjs';

const data = JSON.parse(readFileSync(new URL('../public/metro.json', import.meta.url), 'utf8'));

describe('track-bearing', () => {
  it('bäring: norr 0°, öster 90°, söder 180°', () => {
    expect(bearing(45, 9, 45.01, 9)).toBeCloseTo(0, 3);
    expect(bearing(45, 9, 45, 9.01)).toBeCloseTo(90, 1);
    expect(bearing(45.01, 9, 45, 9)).toBeCloseTo(180, 3);
  });
  it('M3 vid Dergano och Maciachini följer den raka linjen 334°/154° inom 2°', () => {
    for (const [lat, lon] of [[45.5055, 9.1797], [45.49806, 9.18472]]) {
      const rows = trackBearings(data, lat, lon, { line: 'M3' });
      const north = rows.find((r) => r.direction === 'Comasina');
      const south = rows.find((r) => r.direction === 'San Donato');
      expect(north.distM).toBeLessThan(10);
      expect(angleDiff(north.travel, 334)).toBeLessThan(2);
      expect(angleDiff(south.travel, 154)).toBeLessThan(2);
      expect(angleDiff(north.reverse, south.travel)).toBeLessThan(0.5);
    }
  });
  it('kompassmarkeringen 169° ligger ca 15° från spåret', () => {
    const r = trackBearings(data, 45.5055, 9.1797, { line: 'M3' }).find((x) => x.direction === 'San Donato');
    expect(angleDiff(169, r.travel)).toBeGreaterThan(13);
    expect(angleDiff(169, r.travel)).toBeLessThan(17);
  });
  it('vid stationen räknas stationen själv som föregående', () => {
    const s = data.stops.find((x) => x.id === 'MACIACHINI');
    const r = trackBearings(data, s.lat, s.lon, { line: 'M3' }).find((x) => x.direction === 'Comasina');
    expect(r.prevStop).toBe('Maciachini');
    expect(r.nextStop).toBe('Dergano');
  });
});

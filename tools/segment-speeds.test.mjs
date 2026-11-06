import { describe, expect, it } from 'vitest';
import { formatSpeedReport, segmentSpeeds } from './lib/segment-speeds.mjs';

// Mönster: 3 stopp. Segment 0: 1000 m på 100 s (10 m/s). Segment 1: 600 m på 20 s (30 m/s, för snabbt) efter 40 s uppehåll.
const mk = (patterns, trips) => ({
  stops: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }, { id: 'C', name: 'C' }, { id: 'D', name: 'D' }],
  patterns,
  trips,
});
const pat = (over) => ({ line: 'M1', shape: 'S', shapeQuality: 'ok', stops: [0, 1, 2], sd: [0, 1000, 1600], a: [0, 100, 160], w: [0, 40, 0], ...over });

describe('segmentSpeeds', () => {
  it('medelhastighet = sd-skillnad / körtid, uppehållet räknas bort', () => {
    const [s0, s1] = segmentSpeeds(mk([pat()], [[0, 0, 0]])).segments;
    expect(s0.speed).toBeCloseTo(10, 6);
    expect(s1.travelSec).toBe(20); // 160 − (100 + 40)
    expect(s1.speed).toBeCloseTo(30, 6);
  });
  it('flaggar >25 m/s som "high" och <1 m/s som "low", annars ingen flagga', () => {
    const slow = pat({ sd: [0, 50, 1600], a: [0, 100, 260] }); // seg 0: 0,5 m/s ; seg 1: 1550 m / 120 s = 12,9 m/s
    const r = segmentSpeeds(mk([pat(), slow], [[0, 0, 0], [1, 0, 0]]));
    const flags = r.segments.map((s) => s.flag);
    expect(flags).toEqual([null, 'high', 'low', null]);
  });
  it('nolltid med positiv distans flaggas "zeroTime"', () => {
    const z = pat({ a: [0, 100, 140] }); // seg 1: körtid 0
    const r = segmentSpeeds(mk([z], [[0, 0, 0]]));
    expect(r.segments[1].flag).toBe('zeroTime');
  });
  it('summerar per linje och shapeQuality, och viktar med antal trips', () => {
    const coarse = pat({ line: 'M2', shapeQuality: 'coarse' }); // seg1 30 m/s → high
    const r = segmentSpeeds(mk([pat(), coarse], [[0, 0, 0], [0, 0, 100], [1, 0, 0]]));
    const g = (line, q) => r.groups.find((x) => x.line === line && x.quality === q);
    expect(g('M1', 'ok')).toMatchObject({ segments: 2, flagged: 1, high: 1, low: 0, tripSegments: 4, tripFlagged: 2 });
    expect(g('M2', 'coarse')).toMatchObject({ segments: 2, flagged: 1, high: 1, tripSegments: 2, tripFlagged: 1 });
  });
  it('rapporttexten nämner linje, kvalitet och värsta segment med stationsnamn', () => {
    const text = formatSpeedReport(segmentSpeeds(mk([pat()], [[0, 0, 0]])));
    expect(text).toContain('M1');
    expect(text).toContain('ok');
    expect(text).toContain('B → C');
    expect(text).toContain('30.0');
  });
});

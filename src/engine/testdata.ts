import type { LatLon, MetroData } from './types';

/**
 * Syntetisk data för motorns tester.
 *
 * Stationer A, B, C ligger öst-västligt på lat 45.40 (lon 9.10 / 9.11 / 9.12).
 * Mönster 0 "rak":   A→B→C, shape S_EAST (rak), a=[0,150,330], w=[0,30,0]  (B: ank. 150, avg. 180)
 * Mönster 1 "natt":  A→B→C, shape S_EAST, a=[0,600,1500], w=[0,60,0]       (passerar midnatt om start 23:50)
 * Mönster 2 "böjd":  A→D,   shape S_BENT (öster 0,01° lon, sedan norrut 0,01° lat), a=[0,300], w=[0,0], COARSE
 *
 * Tjänster: s0 {1106}, s1 "late" {1106,1107}, s2 "borttagen" {1106 tillagd OCH borttagen}, s3 {1110}.
 * Giltighet 2026-10-26 … 2026-11-30.
 */
export const S_EAST: LatLon[] = [[45.4, 9.10], [45.4, 9.11], [45.4, 9.12]];
export const S_BENT: LatLon[] = [[45.4, 9.10], [45.4, 9.11], [45.41, 9.11]];

export const SERVICE = { s0: 0, s1: 1, s2: 2, s3: 3 } as const;
export const PATTERN = { rak: 0, natt: 1, bojd: 2, rakFlyttad: 3 } as const;

/** Mönster 3 = samma stopp/tider som "rak" men egen shape (S_ALT, bula norrut) – bevisar att tripens eget shape_id används. */
export const S_ALT: LatLon[] = [[45.4, 9.10], [45.403, 9.105], [45.4, 9.11], [45.403, 9.115], [45.4, 9.12]];

export function makeData(sd: { east: number[]; bent: number[]; alt: number[] }): MetroData {
  return {
    meta: { validFrom: '2026-10-26', validTo: '2026-11-30' },
    lines: [{ id: 'M9', name: '9', color: '#123456' }],
    stops: [
      { id: 'A', name: 'A', lat: 45.4, lon: 9.1 },
      { id: 'B', name: 'B', lat: 45.4, lon: 9.11 },
      { id: 'C', name: 'C', lat: 45.4, lon: 9.12 },
      { id: 'D', name: 'D', lat: 45.41, lon: 9.11 },
    ],
    directions: [
      { id: 'M9>C', line: 'M9', terminus: 'C', name: 'C' },
      { id: 'M9>D', line: 'M9', terminus: 'D', name: 'D' },
    ],
    shapeGeoms: [S_EAST, S_BENT, S_ALT],
    shapes: { S_EAST: 0, S_BENT: 1, S_ALT: 2 },
    patterns: [
      { line: 'M9', dir: 0, shape: 'S_EAST', shapeQuality: 'ok', stops: [0, 1, 2], sd: sd.east, a: [0, 150, 330], w: [0, 30, 0] },
      { line: 'M9', dir: 0, shape: 'S_EAST', shapeQuality: 'ok', stops: [0, 1, 2], sd: sd.east, a: [0, 600, 1500], w: [0, 60, 0] },
      { line: 'M9', dir: 1, shape: 'S_BENT', shapeQuality: 'coarse', stops: [0, 3], sd: sd.bent, a: [0, 300], w: [0, 0] },
      { line: 'M9', dir: 0, shape: 'S_ALT', shapeQuality: 'ok', stops: [0, 1, 2], sd: sd.alt, a: [0, 150, 330], w: [0, 30, 0] },
    ],
    services: [
      { id: 's0', add: [20261106], remove: [] },
      { id: 'late', add: [20261106, 20261107], remove: [] },
      { id: 'borttagen', add: [20261106], remove: [20261106] },
      { id: 's3', add: [20261110], remove: [] },
    ],
    trips: [
      [0, 0, 28800], // T1: 08:00:00 rak, s0
      [0, 0, 28860], // T2: 08:01:00 rak, s0 (samtidigt tåg)
      [1, 1, 85800], // natt: 23:50:00, late; ankommer B 24:00:00, C 25:00:00
      [0, 2, 30000], // aldrig aktiv (tillagd och borttagen samma dag)
      [2, 3, 28800], // böjd, coarse, s3
      [3, 3, 28800], // rak men med egen shape S_ALT, s3
    ],
  };
}

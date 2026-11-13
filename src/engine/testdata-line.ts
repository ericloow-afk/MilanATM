import { shapeIndex } from '../geo';
import type { LatLon, MetroData } from './types';

/**
 * Syntetisk rak linje M9 för realtidstesterna: 12 stationer P0..P11 öster ut (ca 390 m isär), 120 s mellan stationerna.
 * Framåt (M9>P11): tåg var fjärde minut 08:00–09:00 den 6/11 2026. Bakåt (M9>P0): ett enda tåg 08:00.
 * Med uppehållsmodellen (22 s, ändstation 60 s): ankomst 120j − 22 och avgång 120j för j = 1..10.
 */
export const LINE_N = 12;
export const LINE_START = 28800; // 08:00
export const LINE_HEADWAY = 240;

const lonOf = (i: number) => 9.1 + 0.005 * i;
const fwdShape: LatLon[] = Array.from({ length: LINE_N }, (_, i) => [45.4, lonOf(i)]);
const revShape: LatLon[] = fwdShape.slice().reverse();
const fwd = shapeIndex(fwdShape);
const rev = shapeIndex(revShape);

export const lineData: MetroData = {
  meta: { validFrom: '2026-10-26', validTo: '2026-11-30' },
  lines: [{ id: 'M9', name: '9', color: '#123456' }],
  stops: Array.from({ length: LINE_N }, (_, i) => ({ id: `P${i}`, name: `P${i}`, lat: 45.4, lon: lonOf(i) })),
  directions: [
    { id: 'M9>P11', line: 'M9', terminus: 'P11', name: 'P11' },
    { id: 'M9>P0', line: 'M9', terminus: 'P0', name: 'P0' },
  ],
  shapeGeoms: [fwdShape, revShape],
  shapes: { FWD: 0, REV: 1 },
  patterns: [
    { line: 'M9', dir: 0, shape: 'FWD', shapeQuality: 'ok', stops: [...Array(LINE_N).keys()], sd: fwd.cum.slice(), a: Array.from({ length: LINE_N }, (_, i) => 120 * i), w: Array(LINE_N).fill(0) },
    { line: 'M9', dir: 1, shape: 'REV', shapeQuality: 'ok', stops: [...Array(LINE_N).keys()].reverse(), sd: rev.cum.slice(), a: Array.from({ length: LINE_N }, (_, i) => 120 * i), w: Array(LINE_N).fill(0) },
  ],
  services: [{ id: 's0', add: [20261106], remove: [] }],
  trips: [
    ...Array.from({ length: 16 }, (_, k): [number, number, number] => [0, 0, LINE_START + k * LINE_HEADWAY]),
    [1, 0, LINE_START],
  ],
};

const rome0 = Date.UTC(2026, 10, 5, 23, 0, 0); // 6/11 00:00 Rom
/** epoch-ms för en tid relativt en trips start (standard 08:00-tripen) */
export const lineMs = (rel: number, start = LINE_START) => rome0 + (start + rel) * 1000;
export const LINE_T0 = `0:0:20261106:${LINE_START}`;
export const LINE_T1 = `0:0:20261106:${LINE_START + LINE_HEADWAY}`;
export const LINE_REV0 = `1:0:20261106:${LINE_START}`;
export const lineArr = (j: number) => 120 * j - 22;
export const lineDep = (j: number) => 120 * j;

/** Geo-matematik: ren TS. Projektionen måste vara identisk med tools/lib/project.mjs (sd räknas där). */
import type { LatLon } from '../engine/types';

const R = 6371008.8;
const RAD = Math.PI / 180;

/** Stor-cirkel-avstånd i meter. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Initial bäring i grader från norr, medsols, [0, 360). */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const dl = (lon2 - lon1) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

export interface ShapeIndex {
  pts: LatLon[];
  /** kumulativ längd i meter vid varje punkt (cum[0] = 0) */
  cum: number[];
  length: number;
  /** projicerade punkter (m), samma plana projektion som byggskriptet */
  xy: [number, number][];
}

function projector(latRef: number) {
  const kx = R * RAD * Math.cos(latRef * RAD);
  const ky = R * RAD;
  return (lat: number, lon: number): [number, number] => [lon * kx, lat * ky];
}

export function shapeIndex(pts: LatLon[]): ShapeIndex {
  if (pts.length < 2) throw new Error('shape måste ha minst 2 punkter');
  const proj = projector(pts[0][0]);
  const xy = pts.map(([la, lo]) => proj(la, lo));
  const cum = [0];
  for (let i = 1; i < xy.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  }
  return { pts, cum, length: cum[cum.length - 1], xy };
}

export interface PointOnShape {
  lat: number;
  lon: number;
  headingDeg: number;
}

/**
 * Punkt d meter längs shapen (klipps till [0, längd]) och riktningen för segmentet den ligger på.
 * Vid en vertex ges riktningen för segmentet som börjar där (i slutet: det sista segmentet).
 */
export function pointAlong(idx: ShapeIndex, d: number): PointOnShape {
  const { cum, xy, pts } = idx;
  const dd = Math.min(Math.max(d, 0), idx.length);
  // sista k med cum[k] <= dd, bland segment som har längd > 0
  let lo = 0;
  let hi = cum.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= dd) lo = mid;
    else hi = mid - 1;
  }
  let k = lo;
  while (k > 0 && cum[k + 1] - cum[k] === 0) k--; // hoppa över nollsegment bakåt
  while (k < cum.length - 2 && cum[k + 1] - cum[k] === 0) k++;
  const len = cum[k + 1] - cum[k];
  const t = len === 0 ? 0 : (dd - cum[k]) / len;
  const lat = pts[k][0] + t * (pts[k + 1][0] - pts[k][0]);
  const lon = pts[k][1] + t * (pts[k + 1][1] - pts[k][1]);
  const dx = xy[k + 1][0] - xy[k][0];
  const dy = xy[k + 1][1] - xy[k][1];
  const headingDeg = (Math.atan2(dx, dy) / RAD + 360) % 360;
  return { lat, lon, headingDeg };
}

/** Kortaste avstånd i meter från en punkt till polylinjen. */
export function distanceToPolyline(pts: LatLon[], lat: number, lon: number): number {
  const proj = projector(pts[0][0]);
  const [x, y] = proj(lat, lon);
  let best = Infinity;
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, ay] = proj(pts[k][0], pts[k][1]);
    const [bx, by] = proj(pts[k + 1][0], pts[k + 1][1]);
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
}

export * from './enu';
export * from './orientation';

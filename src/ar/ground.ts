/**
 * Rutnät och spårlinje i AR-vyn (ren TS). Fältmätningen 8/11 och diagnosen (docs/field-notes-2026-11-08.md, Del 5)
 * visade att ett fyllt markplan och rutnät över hela vyn färgade kamerabilden blå. Nu:
 * - inga fyllda ytor, bara tunna linjer (och tågblocken),
 * - rutnätet bara i ett band runt spåret (ca 30 m åt vardera sidan), uttonat med avståndet till spåret,
 * - aldrig längre bort än 80 m från kameran (osynligt mot horisonten),
 * - inget rutnät när inga tåg finns inom radien, eller utan användbar GPS-fix i vanligt läge,
 * - högst 0,25 i opacitet för allt som inte är ett tåg. Standard: rutnätet av.
 *
 * Koordinater: lokala meter med x = öst och z = −norr (som three.js-scenen).
 */
import { toLocalMeters, type LatLonPoint } from '../geo/enu';
import type { MetroData } from '../engine/types';

export type GridLevel = 'off' | 'weak' | 'normal';
export const GRID_LEVELS: GridLevel[] = ['off', 'weak', 'normal'];
export const GRID_LABEL: Record<GridLevel, string> = { off: 'av', weak: 'svagt', normal: 'normalt' };

/** Högsta opacitet för allt som inte är ett tåg (rutnät, spårlinje, lodlinjer). */
export const MAX_OVERLAY_OPACITY = 0.25;

export const GROUND = {
  /** rutnätet syns högst så här långt från spåret (m) */
  bandHalfWidthM: 30,
  /** rutnätet börjar tona ut så här långt från kameran (m) */
  fadeStartM: 40,
  /** och är helt borta här (m), långt innan horisonten */
  fadeEndM: 80,
  /** rutstorlek (m) */
  cellM: 5,
} as const;

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** Opacitetsfaktor 0..1 efter avståndet till spåret: 1 på spåret, 0 vid bandets kant (30 m) och utanför. */
export function trackFade(distToTrackM: number, halfWidthM: number = GROUND.bandHalfWidthM): number {
  return 1 - smooth(distToTrackM / halfWidthM);
}

/** Opacitetsfaktor 0..1 efter vågrätt avstånd från kameran: 1 upp till 40 m, 0 från 80 m. */
export function cameraFade(horizDistM: number, startM: number = GROUND.fadeStartM, endM: number = GROUND.fadeEndM): number {
  return 1 - smooth((horizDistM - startM) / (endM - startM));
}

/** Rutnätets opacitet för valt läge (aldrig över MAX_OVERLAY_OPACITY). */
export function gridOpacity(level: GridLevel): number {
  return level === 'normal' ? MAX_OVERLAY_OPACITY : level === 'weak' ? 0.12 : 0;
}

/** Ska rutnätet ritas? Perrongläget: på perronggolvet. Vanligt läge: bara med tåg inom radien och användbar fix. */
export function gridVisible(p: { level: GridLevel; platform: boolean; nearbyCount: number; gpsAccuracy: number | null }): boolean {
  if (p.level === 'off') return false;
  if (p.platform) return true;
  return p.nearbyCount > 0 && p.gpsAccuracy != null && p.gpsAccuracy <= 100;
}

/** En spårbit i lokala meter. */
export interface LocalTrack {
  line: string;
  /** [x, z]-punkter */
  pts: [number, number][];
}

/** Spårens shapes nära användaren (inom radiusM), som lokala polylinjer. En shape per linje och geometri. */
export function localTracks(data: MetroData, origin: LatLonPoint, radiusM = 150): LocalTrack[] {
  const out: LocalTrack[] = [];
  const seen = new Set<string>();
  const r2 = radiusM * radiusM;
  for (const p of data.patterns) {
    const key = `${p.line}|${p.shape}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const geom = data.shapeGeoms[data.shapes[p.shape]];
    let cur: [number, number][] = [];
    let prev: [number, number] | null = null;
    let prevIn = false;
    for (const [lat, lon] of geom) {
      const m = toLocalMeters(origin, lat, lon);
      const pt: [number, number] = [m.east, -m.north];
      const inside = pt[0] * pt[0] + pt[1] * pt[1] <= r2;
      // ta med en punkt utanför på var sida så att spåret inte klipps mitt i ett långt segment
      if (inside || prevIn) {
        if (!cur.length && prev) cur.push(prev);
        cur.push(pt);
      } else if (cur.length) {
        out.push({ line: p.line, pts: cur });
        cur = [];
      }
      prev = pt;
      prevIn = inside;
    }
    if (cur.length > 1) out.push({ line: p.line, pts: cur });
  }
  return out.filter((t) => t.pts.length > 1);
}

/** Kortaste avstånd (m) från (x, z) till någon av polylinjerna. */
export function distToTracks(x: number, z: number, tracks: LocalTrack[]): number {
  let best = Infinity;
  for (const t of tracks) {
    for (let i = 0; i < t.pts.length - 1; i++) {
      const [ax, az] = t.pts[i];
      const [bx, bz] = t.pts[i + 1];
      const vx = bx - ax;
      const vz = bz - az;
      const l2 = vx * vx + vz * vz;
      const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2)) : 0;
      const d = Math.hypot(ax + u * vx - x, az + u * vz - z);
      if (d < best) best = d;
    }
  }
  return best;
}

export interface GridSegments {
  /** x, y, z per punkt; två punkter per linjestycke */
  positions: Float32Array;
  /** opacitetsfaktor 0..1 per punkt (gånger gridOpacity) */
  alphas: Float32Array;
  count: number;
}

/**
 * Rutnätets linjestycken runt kameran (origo) i höjden y. Varje linje delas i rutstora stycken; varje punkt får
 * alfa = trackFade(avstånd till spåret) · cameraFade(avstånd till kameran). Stycken som är helt osynliga tas bort.
 * Rutnätet följer världens rutor (multiplar av cellM) så att det inte "glider" när användaren går.
 */
export function buildGridSegments(tracks: LocalTrack[], y: number, center: [number, number] = [0, 0], cfg = GROUND): GridSegments {
  const pos: number[] = [];
  const alp: number[] = [];
  const ext = cfg.fadeEndM;
  const c = cfg.cellM;
  const x0 = Math.floor((center[0] - ext) / c) * c;
  const x1 = Math.ceil((center[0] + ext) / c) * c;
  const z0 = Math.floor((center[1] - ext) / c) * c;
  const z1 = Math.ceil((center[1] + ext) / c) * c;
  const alphaAt = (x: number, z: number) => trackFade(distToTracks(x, z, tracks), cfg.bandHalfWidthM) * cameraFade(Math.hypot(x - center[0], z - center[1]), cfg.fadeStartM, cfg.fadeEndM);
  const cache = new Map<string, number>();
  const a = (x: number, z: number) => {
    const k = `${x},${z}`;
    let v = cache.get(k);
    if (v === undefined) cache.set(k, (v = alphaAt(x, z)));
    return v;
  };
  const push = (xa: number, za: number, xb: number, zb: number) => {
    const aa = a(xa, za);
    const ab = a(xb, zb);
    if (aa < 0.01 && ab < 0.01) return;
    pos.push(xa, y, za, xb, y, zb);
    alp.push(aa, ab);
  };
  for (let x = x0; x <= x1; x += c) for (let z = z0; z < z1; z += c) push(x, z, x, z + c);
  for (let z = z0; z <= z1; z += c) for (let x = x0; x < x1; x += c) push(x, z, x + c, z);
  return { positions: new Float32Array(pos), alphas: new Float32Array(alp), count: alp.length };
}

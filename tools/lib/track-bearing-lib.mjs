// Spårets riktning (bäring) ur shapes i metro.json vid en koordinat. Ren JS, inga beroenden.
import { haversine, makeProjector } from './project.mjs';

const RAD = Math.PI / 180;
const wrap360 = (a) => ((a % 360) + 360) % 360;

/** Bäring (grader från norr, medsols) mellan två punkter på klotet. */
export function bearing(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const dl = (lon2 - lon1) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return wrap360(Math.atan2(y, x) / RAD);
}

/** Punkt på polylinjen `pts` ([[lat, lon], ...]) som ligger `d` meter från början (klämd till linjen). */
export function pointAt(pts, cum, d) {
  const total = cum[cum.length - 1];
  const x = Math.min(total, Math.max(0, d));
  let k = 0;
  while (k < cum.length - 2 && cum[k + 1] < x) k++;
  const seg = cum[k + 1] - cum[k];
  const u = seg > 0 ? (x - cum[k]) / seg : 0;
  return [pts[k][0] + u * (pts[k + 1][0] - pts[k][0]), pts[k][1] + u * (pts[k + 1][1] - pts[k][1])];
}

/** Närmaste punkt på polylinjen: avstånd från punkten (m) och läge längs linjen (m från början). */
export function nearestOnShape(pts, lat, lon) {
  const proj = makeProjector(lat);
  const P = pts.map(([a, b]) => proj(a, b));
  const [qx, qy] = proj(lat, lon);
  const cum = [0];
  for (let k = 0; k < pts.length - 1; k++) cum.push(cum[k] + haversine(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]));
  let best = { dist: Infinity, sd: 0, seg: 0 };
  for (let k = 0; k < P.length - 1; k++) {
    const [ax, ay] = P[k];
    const [bx, by] = P[k + 1];
    const vx = bx - ax;
    const vy = by - ay;
    const L2 = vx * vx + vy * vy;
    const u = L2 > 0 ? Math.max(0, Math.min(1, ((qx - ax) * vx + (qy - ay) * vy) / L2)) : 0;
    const dist = Math.hypot(ax + u * vx - qx, ay + u * vy - qy);
    if (dist < best.dist) best = { dist, sd: cum[k] + u * (cum[k + 1] - cum[k]), seg: k };
  }
  return { ...best, cum };
}

/**
 * Bäringen per shape (och riktning) för en linje vid en koordinat.
 * travel = färdriktningen (shapen är ritad i tågets färdriktning), mätt mellan punkterna ±halfWindow m runt närmaste punkt.
 * segment = bäringen för just det shape-segment punkten ligger på (känslig för grova shapes).
 */
export function trackBearings(data, lat, lon, { line = null, halfWindow = 50, maxDist = 400 } = {}) {
  const out = [];
  const seen = new Set();
  data.patterns.forEach((p) => {
    if (line && p.line !== line) return;
    const dir = data.directions[p.dir];
    const key = `${p.shape}|${dir.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    const pts = data.shapeGeoms[data.shapes[p.shape]];
    const near = nearestOnShape(pts, lat, lon);
    if (near.dist > maxDist) return;
    const a = pointAt(pts, near.cum, near.sd - halfWindow);
    const b = pointAt(pts, near.cum, near.sd + halfWindow);
    const travel = bearing(a[0], a[1], b[0], b[1]);
    const s0 = pts[near.seg];
    const s1 = pts[near.seg + 1];
    // föregående och nästa station längs mönstret, räknat från närmaste punkten
    let prev = null;
    let next = null;
    p.stops.forEach((si, k) => {
      if (p.sd[k] <= near.sd + 25) prev = k; // står man vid stationen (±25 m, olika längdmått) räknas den som föregående
      else if (next == null) next = k;
    });
    out.push({
      line: p.line,
      direction: dir.name,
      shape: p.shape,
      quality: p.shapeQuality,
      distM: near.dist,
      travel,
      reverse: wrap360(travel + 180),
      segment: bearing(s0[0], s0[1], s1[0], s1[1]),
      shapePoints: pts.length,
      prevStop: prev == null ? null : data.stops[p.stops[prev]].name,
      nextStop: next == null ? null : data.stops[p.stops[next]].name,
    });
  });
  return out.sort((x, y) => x.line.localeCompare(y.line) || x.direction.localeCompare(y.direction));
}

/** Minsta vinkelskillnad (grader, 0..180) mellan två bäringar. */
export const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

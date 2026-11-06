/** Mjuk animering av tågmarkörer mellan två motor-tick. Ren TS. */
export interface Pos {
  lat: number;
  lon: number;
  /** grader från norr, medsols */
  heading: number;
}

export interface Animated extends Pos {
  id: string;
  /** finns inte i föregående tick: dyker upp */
  appearing: boolean;
  /** finns inte i nästa tick: har nått slutstationen */
  vanishing: boolean;
}

/** Interpolerar vinkel (grader) längs kortaste väg. */
export function lerpAngle(a: number, b: number, f: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (((a + d * f) % 360) + 360) % 360;
}

/**
 * Position för varje tåg vid f ∈ [0, 1] mellan föregående (f = 0) och nästa tick (f = 1).
 * Nya tåg visas direkt på sin första plats, tåg som försvinner stannar på sin sista.
 */
export function interpolateTrains(prev: Map<string, Pos>, next: Map<string, Pos>, f: number): Animated[] {
  const t = Math.min(1, Math.max(0, f));
  const out: Animated[] = [];
  for (const [id, n] of next) {
    const p = prev.get(id);
    if (!p) {
      out.push({ id, ...n, appearing: true, vanishing: false });
    } else {
      out.push({
        id,
        lat: p.lat + (n.lat - p.lat) * t,
        lon: p.lon + (n.lon - p.lon) * t,
        heading: lerpAngle(p.heading, n.heading, t),
        appearing: false,
        vanishing: false,
      });
    }
  }
  for (const [id, p] of prev) {
    if (!next.has(id)) out.push({ id, ...p, appearing: false, vanishing: true });
  }
  return out;
}

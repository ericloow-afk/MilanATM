import { wrap180 } from '../geo/orientation';

/** Bäring till mål relativt kamerans riktning, [−180, 180): positivt = åt höger. */
export const relativeBearing = (targetBearingDeg: number, cameraHeadingDeg: number): number =>
  wrap180(targetBearingDeg - cameraHeadingDeg);

export interface EdgeIndicator {
  /** målet syns i bild (framför kameran och innanför NDC ±1) */
  onScreen: boolean;
  /** pixelposition (skärmkoordinater, y nedåt): målets plats om synligt, annars platsen på kanten */
  x: number;
  y: number;
  /** pilens riktning i radianer (skärmkoordinater, 0 = höger, −π/2 = uppåt) */
  angleRad: number;
}

/**
 * Placerar en pil på skärmkanten för mål utanför bild.
 * (ndcX, ndcY): målets riktning/placering i NDC-lik skala (x höger, y uppåt). För mål bakom kameran:
 * skicka målets riktning i kameraramen (x höger, y uppåt) och behind = true, så pekar pilen åt det håll man ska vrida sig.
 */
export function edgeIndicator(ndcX: number, ndcY: number, behind: boolean, w: number, h: number, margin: number): EdgeIndicator {
  if (!behind && Math.abs(ndcX) < 1 && Math.abs(ndcY) < 1) {
    return { onScreen: true, x: ((ndcX + 1) / 2) * w, y: ((1 - ndcY) / 2) * h, angleRad: 0 };
  }
  let dx = ndcX;
  let dy = -ndcY; // skärmkoordinater
  if (dx === 0 && dy === 0) dx = 1; // rakt bakom: välj höger
  const hx = w / 2 - margin;
  const hy = h / 2 - margin;
  const t = Math.min(dx === 0 ? Infinity : hx / Math.abs(dx), dy === 0 ? Infinity : hy / Math.abs(dy));
  return { onScreen: false, x: w / 2 + dx * t, y: h / 2 + dy * t, angleRad: Math.atan2(dy, dx) };
}

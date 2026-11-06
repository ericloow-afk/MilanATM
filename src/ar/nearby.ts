import { toLocalMeters, type LatLonPoint } from '../geo/enu';
import { wrap360 } from '../geo/orientation';
import type { Train } from '../engine/types';

export interface NearbyTrain {
  train: Train;
  /** meter öster om användaren */
  east: number;
  /** meter norr om användaren */
  north: number;
  distance: number;
  /** bäring till tåget, grader från norr medsols */
  bearingDeg: number;
}

/** Tåg inom radien (m), omräknade till lokala meter relativt användaren, närmast först. */
export function nearbyTrains(trains: Train[], user: LatLonPoint, radiusM = 300): NearbyTrain[] {
  const out: NearbyTrain[] = [];
  for (const t of trains) {
    const { east, north } = toLocalMeters(user, t.lat, t.lon);
    const distance = Math.hypot(east, north);
    if (distance > radiusM || (radiusM === 0 && distance > 0)) continue;
    out.push({ train: t, east, north, distance, bearingDeg: wrap360((Math.atan2(east, north) * 180) / Math.PI) });
  }
  return out.sort((a, b) => a.distance - b.distance);
}

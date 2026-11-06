/** TrainEngine: tågpositioner ur tidtabell. Ren TS, inga DOM-beroenden. */
import { pointAlong, shapeIndex, type ShapeIndex } from '../geo';
import { addDays, isoToYmd, romeServiceTime } from './time';
import type { DataStatus, MetroData, Train } from './types';

export { romeServiceTime } from './time';
export type { DataStatus, MetroData, Train } from './types';

interface Prepared {
  shapes: ShapeIndex[];
  active: { add: Set<number>; remove: Set<number> }[];
  validFrom: number;
  validTo: number;
}

const cache = new WeakMap<MetroData, Prepared>();

function prepare(data: MetroData): Prepared {
  let p = cache.get(data);
  if (!p) {
    p = {
      shapes: data.shapeGeoms.map((g) => shapeIndex(g)),
      active: data.services.map((s) => ({ add: new Set(s.add), remove: new Set(s.remove) })),
      validFrom: isoToYmd(data.meta.validFrom),
      validTo: isoToYmd(data.meta.validTo),
    };
    cache.set(data, p);
  }
  return p;
}

/** Är tidtabellen giltig vid `at`? Jämförs på Rom-datum; validFrom och validTo ingår. */
export function dataStatus(data: MetroData, at: Date): DataStatus {
  const { validFrom, validTo } = prepare(data);
  const { ymd } = romeServiceTime(at);
  if (ymd < validFrom) return 'notYetValid';
  if (ymd > validTo) return 'expired';
  return 'ok';
}

/**
 * Alla tåg som kör vid `at`. Tom lista om tidtabellen inte är giltig.
 * Både dagens och gårdagens tjänstedygn kontrolleras (tider > 86400 hör till föregående dygn).
 * Ett tåg är aktivt från starttid till (exklusive) slutankomst.
 */
export function trains(data: MetroData, at: Date): Train[] {
  if (dataStatus(data, at) !== 'ok') return [];
  const prep = prepare(data);
  const { ymd, sec } = romeServiceTime(at);
  const frac = (((at.getTime() % 1000) + 1000) % 1000) / 1000; // väggklockan skiftar i hela timmar, så ms är oförändrade
  const secF = sec + frac;
  const days: [number, number][] = [
    [ymd, secF],
    [addDays(ymd, -1), secF + 86400],
  ];
  const out: Train[] = [];
  for (const [pi, si, start] of data.trips) {
    const pat = data.patterns[pi];
    const last = pat.a.length - 1;
    for (const [day, tt] of days) {
      const rel = tt - start;
      if (rel < 0 || rel >= pat.a[last]) continue;
      const svc = prep.active[si];
      if (!svc.add.has(day) || svc.remove.has(day)) continue;
      const train = locate(data, prep, pi, rel, `${pi}:${si}:${day}:${start}`);
      if (train) out.push(train);
    }
  }
  return out.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

function locate(data: MetroData, prep: Prepared, pi: number, rel: number, id: string): Train | null {
  const pat = data.patterns[pi];
  const n = pat.a.length;
  const shape = prep.shapes[data.shapes[pat.shape]];
  const dir = data.directions[pat.dir];
  const stopId = (i: number) => data.stops[pat.stops[i]].id;
  // Sista stoppet i med a[i] <= rel
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pat.a[mid] <= rel) lo = mid;
    else hi = mid - 1;
  }
  const i = lo;
  const dep = pat.a[i] + pat.w[i];
  const base = { id, line: pat.line, direction: dir.id, shapeQuality: pat.shapeQuality };
  if (rel < dep) {
    // uppehåll vid stopp i
    const p = pointAlong(shape, pat.sd[i]);
    return {
      ...base,
      lat: p.lat, lon: p.lon, headingDeg: p.headingDeg,
      speedMps: 0,
      fromStation: stopId(i), toStation: stopId(i),
      progress: 0,
      status: 'dwelling',
    };
  }
  if (i >= n - 1) return null;
  const travel = pat.a[i + 1] - dep;
  if (travel <= 0) return null;
  const progress = (rel - dep) / travel;
  const dSd = pat.sd[i + 1] - pat.sd[i];
  const p = pointAlong(shape, pat.sd[i] + progress * dSd);
  return {
    ...base,
    lat: p.lat, lon: p.lon, headingDeg: p.headingDeg,
    speedMps: dSd / travel,
    fromStation: stopId(i), toStation: stopId(i + 1),
    progress,
    status: 'moving',
  };
}

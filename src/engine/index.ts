/** TrainEngine: tågpositioner ur tidtabell. Ren TS, inga DOM-beroenden. */
import { pointAlong, shapeIndex, type ShapeIndex } from '../geo';
import { DEFAULT_DWELL, effectiveTiming, rampFractionFor, trapezoid, type DwellConfig, type Timing } from './dwell';
import { addDays, isoToYmd, romeServiceTime } from './time';
import type { DataStatus, MetroData, Train } from './types';

export { romeServiceTime } from './time';
export { DEFAULT_DWELL } from './dwell';
export type { DwellConfig, Timing } from './dwell';
export type { DataStatus, MetroData, Train } from './types';

export interface EngineOptions {
  /** uppehållsmodell (uppskattning) eller null = tidtabellen exakt som den är */
  dwell: DwellConfig | null;
  /** rörelse mellan stationer: konstant hastighet eller trapets (acceleration, marschfart, inbromsning) */
  profile: 'linear' | 'trapezoid';
}

/** Standard i appen: uppehållsmodell + realistisk rörelseprofil. */
export const DEFAULT_OPTIONS: EngineOptions = { dwell: DEFAULT_DWELL, profile: 'trapezoid' };
/** Exakt tidtabell: inga modellerade uppehåll, konstant hastighet (för tester och jämförelser). */
export const SCHEDULE_ONLY: EngineOptions = { dwell: null, profile: 'linear' };

interface Prepared {
  shapes: ShapeIndex[];
  active: { add: Set<number>; remove: Set<number> }[];
  validFrom: number;
  validTo: number;
  timings: WeakMap<EngineOptions, Timing[]>;
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
      timings: new WeakMap(),
    };
    cache.set(data, p);
  }
  return p;
}

/** Effektiva tider per mönster för givna inställningar (cachas). */
export function patternTimings(data: MetroData, opts: EngineOptions = DEFAULT_OPTIONS): Timing[] {
  const prep = prepare(data);
  let t = prep.timings.get(opts);
  if (!t) {
    t = data.patterns.map((p) => effectiveTiming(p.a, p.w, p.stops.map((s) => data.stops[s].id), opts.dwell));
    prep.timings.set(opts, t);
  }
  return t;
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
 * En aktiv trip med allt som behövs för att räkna ut positionen vid valfri tidpunkt, utan att söka igenom
 * tidtabellen igen. Listan räknas om ungefär en gång per sekund; positionen räknas per bildruta med positionAt().
 */
export interface TripRun {
  id: string;
  line: string;
  direction: string;
  shapeQuality: Train['shapeQuality'];
  pattern: number;
  /** epoch-ms då tripens schemalagda start (rel = 0) inträffar */
  baseMs: number;
  timing: Timing;
  sd: number[];
  stopIds: string[];
  shape: ShapeIndex;
  profile: EngineOptions['profile'];
}

/**
 * Trips som syns någon gång i intervallet [at, at + horizonSec]. Både dagens och gårdagens tjänstedygn kontrolleras
 * (tider > 86400 hör till föregående dygn). Tom lista om tidtabellen inte är giltig.
 */
export function activeTrips(data: MetroData, at: Date, horizonSec = 0, opts: EngineOptions = DEFAULT_OPTIONS): TripRun[] {
  if (dataStatus(data, at) !== 'ok') return [];
  const prep = prepare(data);
  const timings = patternTimings(data, opts);
  const { ymd, sec } = romeServiceTime(at);
  const frac = (((at.getTime() % 1000) + 1000) % 1000) / 1000;
  const days: [number, number][] = [
    [ymd, sec + frac],
    [addDays(ymd, -1), sec + frac + 86400],
  ];
  const out: TripRun[] = [];
  for (const [pi, si, start] of data.trips) {
    const tm = timings[pi];
    for (const [day, tt] of days) {
      const rel = tt - start;
      if (rel + horizonSec < tm.visibleFrom || rel >= tm.visibleTo) continue;
      const svc = prep.active[si];
      if (!svc.add.has(day) || svc.remove.has(day)) continue;
      const pat = data.patterns[pi];
      out.push({
        id: `${pi}:${si}:${day}:${start}`,
        line: pat.line,
        direction: data.directions[pat.dir].id,
        shapeQuality: pat.shapeQuality,
        pattern: pi,
        baseMs: at.getTime() - rel * 1000,
        timing: tm,
        sd: pat.sd,
        stopIds: pat.stops.map((s) => data.stops[s].id),
        shape: prep.shapes[data.shapes[pat.shape]],
        profile: opts.profile,
      });
    }
  }
  return out.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

/** Position för en aktiv trip vid epoch-ms `t` (kontinuerlig; anropas per bildruta). null om tåget inte syns då. */
export function positionAt(run: TripRun, t: number): Train | null {
  const rel = (t - run.baseMs) / 1000;
  const { arr, dep, visibleFrom, visibleTo } = run.timing;
  if (rel < visibleFrom || rel >= visibleTo) return null;
  const n = arr.length;
  // sista stoppet i med arr[i] <= rel
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid] <= rel) lo = mid;
    else hi = mid - 1;
  }
  const i = lo;
  const base = { id: run.id, line: run.line, direction: run.direction, shapeQuality: run.shapeQuality };
  if (rel < dep[i] || i >= n - 1) {
    const p = pointAlong(run.shape, run.sd[i]);
    return {
      ...base,
      lat: p.lat, lon: p.lon, headingDeg: p.headingDeg,
      speedMps: 0,
      fromStation: run.stopIds[i], toStation: run.stopIds[i],
      progress: 0,
      status: 'dwelling',
    };
  }
  const travel = arr[i + 1] - dep[i];
  if (travel <= 0) return null;
  const u = (rel - dep[i]) / travel;
  const dist = run.sd[i + 1] - run.sd[i];
  const prof = run.profile === 'trapezoid' ? trapezoid(u, rampFractionFor(travel)) : { p: Math.min(1, Math.max(0, u)), v: 1 };
  const p = pointAlong(run.shape, run.sd[i] + prof.p * dist);
  return {
    ...base,
    lat: p.lat, lon: p.lon, headingDeg: p.headingDeg,
    speedMps: (prof.v * dist) / travel,
    fromStation: run.stopIds[i], toStation: run.stopIds[i + 1],
    progress: prof.p,
    status: 'moving',
  };
}

/**
 * Alla tåg som syns vid `at`. Tom lista om tidtabellen inte är giltig.
 * Med SCHEDULE_ONLY: aktivt från starttid till (exklusive) slutankomst, konstant hastighet.
 */
export function trains(data: MetroData, at: Date, opts: EngineOptions = DEFAULT_OPTIONS): Train[] {
  const t = at.getTime();
  const out: Train[] = [];
  for (const run of activeTrips(data, at, 0, opts)) {
    const tr = positionAt(run, t);
    if (tr) out.push(tr);
  }
  return out;
}

/**
 * Fuse: kombinerar tidtabellen (TripRun) med realtidsobservationer. Ren TS, inga DOM-beroenden.
 *
 * - Varje observation matchas mot den trip som har samma linje, riktning och station och vars (effektiva) tid
 *   ligger närmast observationen, inom ±10 min. Förseningen = observerad − planerad tid.
 * - Förseningen gäller fullt fram till och med observerad station (hela tripen förskjuts) och avtar sedan
 *   (halveras per 5 stopp). Tåget kan inte "köra ikapp" hur som helst: körtiden mellan två stationer kortas
 *   högst till `minTravelFactor` av den planerade, och uppehållen behåller sin planerade längd.
 * - Ingen observation inom 15 min (eller ingen alls) = ren tidtabell, exakt som positionAt.
 * - PositionGuard ser till att ett tåg aldrig flyttas bakåt längs spåret när en justering kommer in (det står kvar
 *   tills den justerade tidtabellen hunnit ikapp). Om klockan spolas bakåt nollställs vakten.
 */
import { pointAlong } from '../geo';
import { activeTrips, DEFAULT_OPTIONS, positionAt, type EngineOptions, type TripRun } from './index';
import type { Timing } from './dwell';
import type { MetroData, Train } from './types';
import { eventTimeMs, observationKey, OBSERVATION_MAX_AGE_MS, type RealtimeObservation, type TrainSource } from '../realtime/types';

export interface FuseOptions {
  /** max skillnad mellan observerad och planerad tid för att en trip ska matcha (s) */
  matchWindowSec: number;
  /** äldre observationer ignoreras (ms) */
  maxAgeMs: number;
  /** observationer som ligger mer än så här efter `now` ignoreras, t.ex. när kartans klocka spolats bakåt (ms) */
  futureToleranceMs: number;
  /** förseningen halveras per så här många stopp efter observerad station */
  halfLifeStops: number;
  /** körtiden mellan två stationer kortas högst till den här andelen av den planerade */
  minTravelFactor: number;
  /** observationer inom så här många sekunder från den senaste för samma tåg vägs ihop (s) */
  combineWindowSec: number;
  /** true om källan räknas som realtid ("live"); annars "adjusted" (justering för hand) */
  isLive: (source: string) => boolean;
  /** samma motorinställningar som användes för `runs` (krävs för att planerade tider ska stämma) */
  engine: EngineOptions;
}

export const DEFAULT_FUSE: FuseOptions = {
  matchWindowSec: 600,
  maxAgeMs: OBSERVATION_MAX_AGE_MS,
  futureToleranceMs: 60_000,
  halfLifeStops: 5,
  minTravelFactor: 0.85,
  combineWindowSec: 30,
  isLive: (s) => s !== 'manual',
  engine: DEFAULT_OPTIONS,
};

/** En observation kopplad till en trip. */
export interface Match {
  tripId: string;
  pattern: number;
  stopIndex: number;
  /** tripens bas (epoch-ms för rel = 0) */
  baseMs: number;
  /** effektiv planerad tid vid stationen (ankomst, eller avgång för kind = departure), epoch-ms */
  plannedMs: number;
  /** observerad − planerad (s) */
  delaySec: number;
}

export interface FusedRun extends TripRun {
  source: TrainSource;
  /** försening vid ankomst per stopp (s), null = ren tidtabell */
  delays: number[] | null;
  /** observationen (eller den senaste av flera) som justeringen bygger på */
  basis: RealtimeObservation | null;
}

export interface FusedTrain extends Train {
  source: TrainSource;
  /** försening (s) vid nästa station (vid stationen tåget står vid under uppehåll); 0 för tidtabell */
  delaySec: number;
  /** true om tåget hålls kvar av PositionGuard (den justerade positionen ligger bakom den senast visade) */
  held: boolean;
}

// ---------- matchning ----------

const matchCache = new WeakMap<MetroData, Map<string, Match | null>>();

/** Matchar en observation mot tidtabellen. null om ingen trip passar (fel linje, riktning, station eller > ±10 min). */
export function matchObservation(data: MetroData, obs: RealtimeObservation, opts: Partial<FuseOptions> = {}): Match | null {
  const o = { ...DEFAULT_FUSE, ...opts };
  const ev = eventTimeMs(obs);
  if (ev == null || obs.stopId == null) return null;
  const w = o.matchWindowSec;
  let best: Match | null = null;
  // Alla trips som syns någon gång i [ev − w, ev + w]: en trip som passerar stationen inom fönstret syns då.
  for (const run of activeTrips(data, new Date(ev - w * 1000), 2 * w, o.engine)) {
    if (run.line !== obs.line) continue;
    if (obs.direction != null && run.direction !== obs.direction) continue;
    const k = run.stopIds.indexOf(obs.stopId);
    if (k < 0) continue;
    const rel = obs.kind === 'departure' ? run.timing.dep[k] : run.timing.arr[k];
    const plannedMs = run.baseMs + rel * 1000;
    const diff = (ev - plannedMs) / 1000;
    if (Math.abs(diff) > w) continue;
    if (!best || Math.abs(diff) < Math.abs(best.delaySec)) {
      best = { tripId: run.id, pattern: run.pattern, stopIndex: k, baseMs: run.baseMs, plannedMs, delaySec: diff };
    }
  }
  return best;
}

function cachedMatch(data: MetroData, obs: RealtimeObservation, o: FuseOptions): Match | null {
  let m = matchCache.get(data);
  if (!m) matchCache.set(data, (m = new Map()));
  const key = `${observationKey(obs)}|${o.matchWindowSec}|${o.engine.dwell ? 'd' : '-'}${o.engine.profile}`;
  if (m.has(key)) return m.get(key)!;
  if (m.size > 500) m.clear();
  const r = matchObservation(data, obs, o);
  m.set(key, r);
  return r;
}

// ---------- justerad tidtabell ----------

/**
 * Justerade tider för en trip. Stopp ≤ k förskjuts med hela förseningen (för departure: avgången vid k är observerad).
 * Efter k avtar förseningen, men körtiden kortas högst till minTravelFactor och uppehållen behåller sin längd.
 */
export function adjustTiming(t: Timing, k: number, delaySec: number, opts: Pick<FuseOptions, 'halfLifeStops' | 'minTravelFactor'>): { timing: Timing; delays: number[] } {
  const n = t.arr.length;
  const arr = t.arr.slice();
  const dep = t.dep.slice();
  for (let j = 0; j <= k && j < n; j++) {
    arr[j] = t.arr[j] + delaySec;
    dep[j] = t.dep[j] + delaySec;
  }
  for (let j = k + 1; j < n; j++) {
    const target = delaySec * 0.5 ** ((j - k) / opts.halfLifeStops);
    const travel = t.arr[j] - t.dep[j - 1];
    arr[j] = Math.max(t.arr[j] + target, dep[j - 1] + travel * opts.minTravelFactor);
    dep[j] = Math.max(t.dep[j] + target, arr[j] + (t.dep[j] - t.arr[j]));
  }
  const delays = arr.map((x, j) => x - t.arr[j]);
  const timing: Timing = {
    arr,
    dep,
    // Försenat tåg som inte startat: står vid första stationen i stället för att försvinna
    visibleFrom: Math.min(t.visibleFrom, t.visibleFrom + delaySec),
    visibleTo: t.visibleTo + (dep[n - 1] - t.dep[n - 1]),
    modelled: t.modelled,
  };
  return { timing, delays };
}

/** Väljer och väger ihop observationerna för ett tåg: den senaste vinner; inom combineWindowSec vägs förseningen efter confidence. */
function combine(items: { obs: RealtimeObservation; match: Match }[], combineWindowSec: number): { obs: RealtimeObservation; match: Match; delaySec: number } {
  let latest = items[0];
  for (const it of items) if (it.obs.observedAt > latest.obs.observedAt) latest = it;
  const near = items.filter((it) => latest.obs.observedAt - it.obs.observedAt <= combineWindowSec * 1000);
  let wsum = 0;
  let dsum = 0;
  let strongest = near[0];
  for (const it of near) {
    const w = Math.max(0.01, it.obs.confidence);
    wsum += w;
    dsum += w * it.match.delaySec;
    if (it.obs.confidence > strongest.obs.confidence) strongest = it;
  }
  // Med flera stationer i samma fönster används stationen från den säkraste observationen
  return { obs: strongest.obs, match: strongest.match, delaySec: dsum / wsum };
}

/**
 * Justerar aktiva trips med observationer. Trips utan giltig observation returneras som ren tidtabell
 * (samma timing-objekt, source = 'schedule').
 */
export function fuse(
  runs: readonly TripRun[],
  observations: readonly RealtimeObservation[],
  now: number,
  data: MetroData,
  opts: Partial<FuseOptions> = {},
): FusedRun[] {
  const o = { ...DEFAULT_FUSE, ...opts };
  const byTrip = new Map<string, { obs: RealtimeObservation; match: Match }[]>();
  for (const obs of observations) {
    if (obs.kind === 'status' || obs.stopId == null) continue;
    if (now - obs.observedAt > o.maxAgeMs || obs.observedAt - now > o.futureToleranceMs) continue;
    const match = cachedMatch(data, obs, o);
    if (!match) continue;
    const list = byTrip.get(match.tripId) ?? [];
    list.push({ obs, match });
    byTrip.set(match.tripId, list);
  }
  return runs.map((run): FusedRun => {
    const items = byTrip.get(run.id);
    if (!items) return { ...run, source: 'schedule', delays: null, basis: null };
    const c = combine(items, o.combineWindowSec);
    const { timing, delays } = adjustTiming(run.timing, c.match.stopIndex, c.delaySec, o);
    return { ...run, timing, source: o.isLive(c.obs.source) ? 'live' : 'adjusted', delays, basis: c.obs };
  });
}

/** Ren tidtabell som FusedRun (när inget realtidslager är aktivt). */
export function asScheduled(runs: readonly TripRun[]): FusedRun[] {
  return runs.map((run) => ({ ...run, source: 'schedule', delays: null, basis: null }));
}

// ---------- position ----------

/** Meter längs shapen för ett Train som positionAt gav för `run`. */
function sdOf(run: TripRun, tr: Train, i: number): number {
  return tr.status === 'dwelling' || i >= run.sd.length - 1 ? run.sd[i] : run.sd[i] + tr.progress * (run.sd[i + 1] - run.sd[i]);
}

/** Position för en (ev. justerad) trip, med källa och försening. Utan vakt: kan gå bakåt när en justering kommer in. */
export function positionAtFused(run: FusedRun, t: number): FusedTrain | null {
  const tr = positionAt(run, t);
  if (!tr) return null;
  const i = run.stopIds.indexOf(tr.fromStation);
  const next = tr.status === 'dwelling' ? i : Math.min(i + 1, run.stopIds.length - 1);
  return { ...tr, source: run.source, delaySec: run.delays ? run.delays[next] ?? 0 : 0, held: false };
}

/**
 * Håller reda på senast visade position per tåg så att ingen justering flyttar tåget bakåt.
 * Ett tåg som "hamnat bakom" står kvar (fart 0) tills den justerade tidtabellen passerar samma punkt.
 */
export class PositionGuard {
  private last = new Map<string, { sd: number; t: number }>();

  position(run: FusedRun, t: number): FusedTrain | null {
    const tr = positionAtFused(run, t);
    if (!tr) return null;
    const i = run.stopIds.indexOf(tr.fromStation);
    const sd = sdOf(run, tr, i);
    const prev = this.last.get(run.id);
    if (prev && t >= prev.t && sd < prev.sd - 0.5) {
      prev.t = t;
      return { ...this.heldAt(run, prev.sd), source: tr.source, delaySec: tr.delaySec, held: true };
    }
    this.last.set(run.id, { sd, t });
    return tr;
  }

  /** Glöm tåg som inte setts på `maxIdleMs` (anropas t.ex. en gång per sekund). */
  prune(t: number, maxIdleMs = 120_000): void {
    for (const [id, v] of this.last) if (Math.abs(t - v.t) > maxIdleMs) this.last.delete(id);
  }

  /** Nollställ (t.ex. när kartans klocka hoppar). */
  reset(): void {
    this.last.clear();
  }

  private heldAt(run: FusedRun, sd: number): Train {
    const n = run.sd.length;
    let j = 0;
    while (j < n - 1 && run.sd[j + 1] <= sd) j++;
    const p = pointAlong(run.shape, sd);
    const base = { id: run.id, line: run.line, direction: run.direction, shapeQuality: run.shapeQuality, lat: p.lat, lon: p.lon, headingDeg: p.headingDeg, speedMps: 0 };
    const atStation = Math.abs(sd - run.sd[j]) < 0.5 || j >= n - 1;
    if (atStation) return { ...base, fromStation: run.stopIds[j], toStation: run.stopIds[j], progress: 0, status: 'dwelling' };
    const span = run.sd[j + 1] - run.sd[j];
    return { ...base, fromStation: run.stopIds[j], toStation: run.stopIds[j + 1], progress: span > 0 ? (sd - run.sd[j]) / span : 0, status: 'moving' };
  }
}

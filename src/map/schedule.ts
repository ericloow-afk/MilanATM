/** Tidtabellsinfo för ett valt tåg och tidtabellens giltighet. Ren TS, bygger på metro.json och motorns Train. */
import { DEFAULT_OPTIONS, patternTimings, type EngineOptions } from '../engine';
import { romeServiceTime } from '../engine/time';
import type { MetroData, Train } from '../engine/types';

export interface TrainSchedule {
  terminusName: string;
  fromName: string;
  toName: string;
  nextStationName: string;
  stopCount: number;
  /** index (0-baserat) för stationen tåget lämnat eller står vid */
  stopIndex: number;
  /** stationer med läge längs sträckan, 0..1 */
  stops: { name: string; f: number }[];
  /** 0..1 längs hela sträckan (efter sd) */
  routeProgress: number;
  /** sekunder till ankomst vid nästa station (≥ 0) */
  secondsToNextArrival: number;
  /** sekunder till avgång om tåget står vid en station, annars null */
  secondsToDeparture: number | null;
  /** tåget står vid ändstationen efter ankomst (vändtid) */
  atTerminus: boolean;
}

const daysBetween = (fromYmd: number, toYmd: number): number => {
  const ms = (n: number) => Date.UTC(Math.floor(n / 10000), Math.floor((n % 10000) / 100) - 1, n % 100);
  return Math.round((ms(toYmd) - ms(fromYmd)) / 86_400_000);
};

/** Tågets id har formen `mönster:tjänst:tjänstedygn:start` (se src/engine). */
export function parseTrainId(id: string): { pattern: number; service: number; day: number; start: number } | null {
  const m = /^(\d+):(\d+):(\d{8}):(\d+)$/.exec(id);
  return m ? { pattern: Number(m[1]), service: Number(m[2]), day: Number(m[3]), start: Number(m[4]) } : null;
}

/** Tider följer motorns effektiva tider (med uppehållsmodellen om den används), så nedräkningen stämmer med markören. */
export function trainSchedule(data: MetroData, train: Train, at: Date, opts: EngineOptions = DEFAULT_OPTIONS): TrainSchedule | null {
  const id = parseTrainId(train.id);
  if (!id) return null;
  const pat = data.patterns[id.pattern];
  if (!pat) return null;
  const i = pat.stops.findIndex((si) => data.stops[si].id === train.fromStation);
  if (i < 0) return null;
  const last = pat.stops.length - 1;
  const { ymd, sec } = romeServiceTime(at);
  const rel = sec + daysBetween(id.day, ymd) * 86400 - id.start;
  const nextIdx = Math.min(last, i + 1);
  const tm = patternTimings(data, opts)[id.pattern];
  const nameAt = (k: number) => data.stops[pat.stops[k]].name;
  const total = pat.sd[last] - pat.sd[0];
  const dNow =
    train.status === 'dwelling' || i >= last ? pat.sd[i] : pat.sd[i] + train.progress * (pat.sd[i + 1] - pat.sd[i]);
  return {
    terminusName: nameAt(last),
    fromName: nameAt(i),
    toName: nameAt(nextIdx),
    nextStationName: nameAt(nextIdx),
    stopCount: pat.stops.length,
    stopIndex: i,
    stops: pat.stops.map((_, k) => ({ name: nameAt(k), f: total > 0 ? (pat.sd[k] - pat.sd[0]) / total : k / last })),
    routeProgress: total > 0 ? Math.min(1, Math.max(0, (dNow - pat.sd[0]) / total)) : 0,
    secondsToNextArrival: Math.max(0, tm.arr[nextIdx] - rel),
    secondsToDeparture: train.status === 'dwelling' && i < last ? Math.max(0, tm.dep[i] - rel) : null,
    atTerminus: i >= last,
  };
}

export type Validity =
  | { status: 'ok'; from: string; to: string; daysLeft: number }
  | { status: 'expired' | 'notYetValid'; from: string; to: string; daysLeft: number };

/** Giltighet för tidtabellen vid `at` (Rom-datum). daysLeft = dagar kvar t.o.m. sista giltiga dag (negativt om utgången). */
export function validityInfo(data: MetroData, at: Date): Validity {
  const toNum = (iso: string) => Number(iso.replaceAll('-', ''));
  const { ymd } = romeServiceTime(at);
  const from = data.meta.validFrom;
  const to = data.meta.validTo;
  const daysLeft = daysBetween(ymd, toNum(to));
  const status = ymd < toNum(from) ? 'notYetValid' : ymd > toNum(to) ? 'expired' : 'ok';
  return { status, from, to, daysLeft };
}

/**
 * Perrongläget: under jord finns ingen GPS (Maciachini 8/11: gpsAcc 1414 m). Användaren väljer station och riktning;
 * positionen blir stationens koordinat och vyn riktas längs spåret i stället för med kompassen. Ren TS.
 */
import { bearing, haversine, pointAlong, shapeIndex } from '../geo';
import { wrap360 } from '../geo/orientation';
import type { MetroData } from '../engine/types';

export interface StationChoice {
  stopId: string;
  name: string;
  lat: number;
  lon: number;
  /** linjer som stannar här (för interchange-stationer har varje linje ett eget stop_id) */
  lines: string[];
}

export interface PlatformDirection {
  direction: string;
  line: string;
  terminusName: string;
  pattern: number;
  stopIndex: number;
  /** stationen tågen kommer ifrån (null vid första stationen) */
  fromName: string | null;
}

export interface StationMode {
  stopId: string;
  name: string;
  lat: number;
  lon: number;
  line: string;
  direction: string;
  terminusName: string;
  fromName: string | null;
  /** bäringen från stationen mot det håll tågen i riktningen kommer ifrån (grader från sann nord) */
  approachDeg: number;
  /** användaren har riktat vyn längs spåret */
  aligned: boolean;
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Alla stationer med linjer, sorterade på namn. */
export function allStations(data: MetroData): StationChoice[] {
  const lines = new Map<number, Set<string>>();
  for (const p of data.patterns) for (const s of p.stops) (lines.get(s) ?? lines.set(s, new Set()).get(s)!).add(p.line);
  return data.stops
    .map((s, i) => ({ stopId: s.id, name: s.name, lat: s.lat, lon: s.lon, lines: [...(lines.get(i) ?? [])].sort() }))
    .filter((s) => s.lines.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'it') || a.lines.join().localeCompare(b.lines.join()));
}

/** Sök på stationsnamn (skiftläge, accenter och skiljetecken spelar ingen roll; ordens början matchar). */
export function searchStations(data: MetroData, query: string): StationChoice[] {
  const q = norm(query);
  const all = allStations(data);
  if (!q) return all;
  const words = q.split(' ');
  return all
    .filter((s) => {
      const n = norm(s.name);
      return words.every((w) => n.split(' ').some((part) => part.startsWith(w)) || n.includes(w));
    })
    .sort((a, b) => Number(!norm(a.name).startsWith(q)) - Number(!norm(b.name).startsWith(q)));
}

/** Närmaste stationer (högst n, inom maxM meter), närmast först. */
export function nearestStations(data: MetroData, lat: number, lon: number, n = 3, maxM = 1000): (StationChoice & { distM: number })[] {
  return allStations(data)
    .map((s) => ({ ...s, distM: haversine(lat, lon, s.lat, s.lon) }))
    .filter((s) => s.distM <= maxM)
    .sort((a, b) => a.distM - b.distM)
    .slice(0, n);
}

/** Riktningar som stannar vid stationen och fortsätter (tåg som slutar här tas inte med). Mönstret med flest stopp väljs per riktning. */
export function platformDirections(data: MetroData, stopId: string): PlatformDirection[] {
  const best = new Map<string, PlatformDirection & { n: number }>();
  data.patterns.forEach((p, pi) => {
    const k = p.stops.findIndex((s) => data.stops[s].id === stopId);
    if (k < 0 || k === p.stops.length - 1) return;
    const dir = data.directions[p.dir];
    const cur = best.get(dir.id);
    if (cur && cur.n >= p.stops.length) return;
    best.set(dir.id, {
      direction: dir.id,
      line: p.line,
      terminusName: dir.name,
      pattern: pi,
      stopIndex: k,
      fromName: k > 0 ? data.stops[p.stops[k - 1]].name : null,
      n: p.stops.length,
    });
  });
  return [...best.values()]
    .map(({ n: _n, ...d }) => d)
    .sort((a, b) => a.line.localeCompare(b.line) || a.terminusName.localeCompare(b.terminusName, 'it'));
}

/**
 * Tågens färdriktning vid stationen (grader från sann nord), mätt längs mönstrets shape ±halfWindow m runt stationen.
 * Vid första stationen mäts framåt.
 */
export function travelBearingAt(data: MetroData, pattern: number, stopIndex: number, halfWindow = 50): number {
  const p = data.patterns[pattern];
  const idx = shapeIndex(data.shapeGeoms[data.shapes[p.shape]]);
  const sd = p.sd[stopIndex];
  const from = stopIndex === 0 ? sd : sd - halfWindow;
  const to = stopIndex === 0 ? sd + 2 * halfWindow : sd + halfWindow;
  const a = pointAlong(idx, from);
  const b = pointAlong(idx, to);
  return bearing(a.lat, a.lon, b.lat, b.lon);
}

/** Bäringen mot det håll tågen kommer ifrån (dit man riktar kameran för att se tåget komma). */
export function approachBearingAt(data: MetroData, pattern: number, stopIndex: number): number {
  return wrap360(travelBearingAt(data, pattern, stopIndex) + 180);
}

export function makeStationMode(data: MetroData, stopId: string, direction: string): StationMode | null {
  const stop = data.stops.find((s) => s.id === stopId);
  const dir = platformDirections(data, stopId).find((d) => d.direction === direction);
  if (!stop || !dir) return null;
  return {
    stopId,
    name: stop.name,
    lat: stop.lat,
    lon: stop.lon,
    line: dir.line,
    direction,
    terminusName: dir.terminusName,
    fromName: dir.fromName,
    approachDeg: approachBearingAt(data, dir.pattern, dir.stopIndex),
    aligned: false,
  };
}

/** "Nästa tåg om 02:14", "Tåget står vid perrongen" eller "Inget tåg de närmaste 30 min". */
export function nextTrainText(next: { etaMs: number; atStation: boolean } | null, now: number, horizonMin = 30): string {
  if (!next) return `Inget tåg de närmaste ${horizonMin} min`;
  if (next.atStation) return 'Tåget står vid perrongen';
  const s = Math.max(0, Math.round((next.etaMs - now) / 1000));
  return `Nästa tåg om ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Stationsparametrar för simulatorn (?sim=1&perrong=...): förinställda perronger. */
export const SIM_PLATFORMS: { stopId: string; direction: string }[] = [
  { stopId: 'MACIACHINI', direction: 'M3>COMASINA' },
  { stopId: 'DUOMO M1', direction: 'M1>SESTO 1 MAGGIO FS' },
  { stopId: 'CENTRALE FS', direction: 'M2>GESSATE' },
  { stopId: 'LOTTO M5', direction: 'M5>BIGNAMI' },
];

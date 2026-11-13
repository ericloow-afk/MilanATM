/**
 * OfficialAtmSource: skelett för en framtida officiell realtidsfeed (ATM eller en partner). INTE ANSLUTEN: ingen
 * sådan feed finns i dag (docs/realtime-sources.md). Utan konfiguration är källan avstängd och appen visar tidtabell.
 *
 * Konfiguration (Vite-miljövariabler, t.ex. i .env.local som inte checkas in):
 *   VITE_RT_OFFICIAL_URL   URL till GTFS-Realtime som JSON (Trip Updates och/eller Vehicle Positions)
 *   VITE_RT_OFFICIAL_KEY   valfri nyckel, skickas i headern VITE_RT_OFFICIAL_KEY_HEADER (standard x-api-key)
 * OBS: allt med VITE_ hamnar i det publika bygget. En riktig nyckel ska inte dit; låt en lokal proxy hålla den.
 *
 * Förväntade fält (GTFS-Realtime v2, JSON med camelCase eller snake_case):
 *   header.timestamp                              sekunder (observedAt om entiteten saknar egen)
 *   entity[].tripUpdate.trip.routeId              "M1".."M5" (samma route_id som i statiska GTFS:en)
 *   entity[].tripUpdate.timestamp                 sekunder
 *   entity[].tripUpdate.stopTimeUpdate[]          stopId (samma stop_id som statiska GTFS:en, t.ex. "DUOMO M1"),
 *                                                 arrival.time / departure.time (sekunder, absolut tid)
 *   entity[].vehicle.trip.routeId, vehicle.stopId, vehicle.currentStatus = STOPPED_AT, vehicle.timestamp
 * Uppdateringar med bara `delay` (ingen absolut tid) och SKIPPED/NO_DATA används inte: vi kan inte koppla
 * GTFS-RT:s trip_id till våra trips (metro.json sparar inga trip_id), så matchningen sker på linje, riktning,
 * station och tid i src/engine/fuse.ts. Protobuf avkodas inte här (det kräver ett bibliotek); be om JSON
 * eller låt proxyn översätta.
 */
import { getJson, type HttpConfig } from './http';
import type { MetroData } from '../engine/types';
import type { RealtimeObservation, RealtimeSource } from './types';

export type DirectionResolver = (line: string, stopIdsInOrder: string[]) => string | null;

/**
 * Riktning ur stoppens ordning: de mönster på linjen där stoppen förekommer i samma ordning.
 * Entydigt svar om alla sådana mönster har samma riktning, annars null.
 */
export function directionResolver(data: MetroData): DirectionResolver {
  const pats = data.patterns.map((p) => ({ line: p.line, dir: data.directions[p.dir].id, stops: p.stops.map((s) => data.stops[s].id) }));
  return (line, ids) => {
    const dirs = new Set<string>();
    for (const p of pats) {
      if (p.line !== line) continue;
      let last = -1;
      let ok = ids.length > 0;
      for (const id of ids) {
        const k = p.stops.indexOf(id, last + 1);
        if (k < 0) {
          ok = false;
          break;
        }
        last = k;
      }
      if (ok) dirs.add(p.dir);
    }
    return dirs.size === 1 ? [...dirs][0] : null;
  };
}

type Obj = Record<string, unknown>;
const get = (o: unknown, camel: string, snake = camel.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())): unknown =>
  o && typeof o === 'object' ? ((o as Obj)[camel] ?? (o as Obj)[snake]) : undefined;
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

export interface GtfsRtContext {
  sourceId: string;
  resolveDirection: DirectionResolver;
  knownStops: Set<string>;
  knownLines: Set<string>;
}

/** GTFS-Realtime (JSON) → observationer. En observation per trip: nästa stopp med absolut tid. */
export function fromGtfsRtJson(feed: unknown, ctx: GtfsRtContext): RealtimeObservation[] {
  const out: RealtimeObservation[] = [];
  const headerTs = num(get(get(feed, 'header'), 'timestamp'));
  const entities = get(feed, 'entity');
  if (!Array.isArray(entities)) return out;
  for (const e of entities) {
    const tu = get(e, 'tripUpdate');
    if (tu) {
      const line = String(get(get(tu, 'trip'), 'routeId') ?? '');
      if (!ctx.knownLines.has(line)) continue;
      const ts = num(get(tu, 'timestamp')) ?? headerTs;
      if (ts == null) continue;
      const observedAt = ts * 1000;
      const updates = (get(tu, 'stopTimeUpdate') as unknown[] | undefined) ?? [];
      const usable = updates
        .map((u) => ({
          stopId: String(get(u, 'stopId') ?? ''),
          rel: String(get(u, 'scheduleRelationship') ?? 'SCHEDULED'),
          arr: num(get(get(u, 'arrival'), 'time')),
          dep: num(get(get(u, 'departure'), 'time')),
        }))
        .filter((u) => ctx.knownStops.has(u.stopId) && u.rel !== 'SKIPPED' && u.rel !== 'NO_DATA' && u.rel !== '1' && u.rel !== '2');
      const direction = ctx.resolveDirection(line, usable.map((u) => u.stopId));
      const next = usable.find((u) => (u.arr ?? u.dep ?? -Infinity) * 1000 >= observedAt - 60_000);
      if (!next) continue;
      const kind = next.arr != null ? 'arrival' : 'departure';
      out.push({ source: ctx.sourceId, line, direction, stopId: next.stopId, kind, observedAt, value: (next.arr ?? next.dep)! * 1000, confidence: 0.9 });
      continue;
    }
    const v = get(e, 'vehicle');
    if (v) {
      const line = String(get(get(v, 'trip'), 'routeId') ?? '');
      const stopId = String(get(v, 'stopId') ?? '');
      const status = get(v, 'currentStatus');
      const ts = num(get(v, 'timestamp')) ?? headerTs;
      if (!ctx.knownLines.has(line) || !ctx.knownStops.has(stopId) || ts == null) continue;
      if (status !== 'STOPPED_AT' && status !== 1) continue;
      // Riktning saknas (direction_id är tom i Milanos GTFS): fuse tar närmaste trip i valfri riktning, därför lägre säkerhet
      out.push({ source: ctx.sourceId, line, direction: null, stopId, kind: 'arrival', observedAt: ts * 1000, value: ts * 1000, confidence: 0.5 });
    }
  }
  return out;
}

export interface OfficialConfig extends Partial<HttpConfig> {
  data: MetroData;
  /** ersätter nätanropet (tester) */
  load?: () => Promise<unknown>;
}

export class OfficialAtmSource implements RealtimeSource {
  readonly id = 'official-atm';
  readonly kind = 'live' as const;
  readonly minIntervalMs = 30_000;
  readonly enabled: boolean;
  private ctx: GtfsRtContext;

  constructor(private cfg: OfficialConfig) {
    this.enabled = !!cfg.load || !!cfg.url;
    this.ctx = {
      sourceId: this.id,
      resolveDirection: directionResolver(cfg.data),
      knownStops: new Set(cfg.data.stops.map((s) => s.id)),
      knownLines: new Set(cfg.data.lines.map((l) => l.id)),
    };
  }

  async observe(): Promise<RealtimeObservation[]> {
    if (!this.enabled) return []; // ingen konfiguration: ren tidtabell
    const json = this.cfg.load ? await this.cfg.load() : await getJson(this.cfg as HttpConfig);
    return fromGtfsRtJson(json, this.ctx);
  }
}

/**
 * Realtidslagret som kartan och AR-vyn använder: källor, hub, fuse, positionsvakt, "Tåget kom nu" och loggen.
 * Utan observationer blir resultatet exakt tidtabellen (samma positioner som positionAt).
 */
import { activeTrips, DEFAULT_OPTIONS, positionAt, type EngineOptions, type TripRun } from '../engine';
import { haversine } from '../geo';
import { asScheduled, fuse, matchObservation, PositionGuard, type FusedRun, type FusedTrain, type Match } from '../engine/fuse';
import type { MetroData } from '../engine/types';
import { RealtimeHub } from './hub';
import { ObservationLog, type LogEntry } from './log';
import { ManualSource, trainArrivedNow } from './manual';
import { OfficialAtmSource } from './official';
import { ScriptedSource } from './scripted';
import { StatusSource } from './status';
import type { KeyValueStore } from './store';
import type { RealtimeObservation, RealtimeSource } from './types';

export interface RealtimeEnv {
  officialUrl?: string;
  officialKey?: string;
  officialKeyHeader?: string;
  statusUrl?: string;
  statusKey?: string;
  statusKeyHeader?: string;
}

export interface SessionConfig {
  data: MetroData;
  store: KeyValueStore | null;
  env?: RealtimeEnv;
  /** mockade källor (bara i dev): en "live"-observation för ett M1-tåg och påhittad linjestatus */
  mock?: boolean;
  isHidden?: () => boolean;
  engine?: EngineOptions;
  /** verklig tid (tester kan ersätta den) */
  wallNow?: () => number;
}

export type ArriveResult =
  | { ok: true; match: Match; observation: RealtimeObservation; entry: LogEntry; savedToDevice: boolean }
  | { ok: false; reason: 'no-train' };

export interface Upcoming {
  direction: string;
  /** närmast först; högst `perDirection` */
  trains: { run: FusedRun; etaMs: number; atStation: boolean; delaySec: number }[];
}

/** Källnamn för texterna i UI. */
export const SOURCE_NAMES: Record<string, string> = {
  manual: 'justering för hand',
  'official-atm': 'ATM',
  'e015-status': 'E015 (ATM)',
  mock: 'mockad testkälla',
  'mock-status': 'mockad testkälla (påhittad linjestatus)',
};

export class RealtimeSession {
  readonly manual: ManualSource;
  readonly log: ObservationLog;
  readonly hub: RealtimeHub;
  readonly guard = new PositionGuard();
  private readonly engine: EngineOptions;
  private lastRuns: TripRun[] = [];
  private readonly wallNow: () => number;

  constructor(private cfg: SessionConfig) {
    this.engine = cfg.engine ?? DEFAULT_OPTIONS;
    this.wallNow = cfg.wallNow ?? (() => Date.now());
    this.manual = new ManualSource(cfg.store, undefined, undefined, this.wallNow);
    this.log = new ObservationLog(cfg.store);
    const env = cfg.env ?? {};
    const sources: RealtimeSource[] = [
      this.manual,
      new OfficialAtmSource({ data: cfg.data, url: env.officialUrl, apiKey: env.officialKey, apiKeyHeader: env.officialKeyHeader }),
      new StatusSource({ url: env.statusUrl, apiKey: env.statusKey, apiKeyHeader: env.statusKeyHeader }),
    ];
    // import.meta.env.DEV: Vite tar bort grenen (och den påhittade fixturen) ur produktionsbygget
    if (import.meta.env.DEV && cfg.mock) sources.push(this.mockLive(), new StatusSource({ id: 'mock-status', load: () => import('./fixtures/line-status.sample.json').then((m) => m.default) }));
    this.hub = new RealtimeHub(sources, { isHidden: cfg.isHidden });
  }

  /** Finns någon källa som kan leverera något annat än tidtabell? (manual räknas alltid) */
  get liveConfigured(): boolean {
    return this.hub.sources.some((s) => s.kind === 'live' && s.enabled);
  }

  /**
   * Låt hubben fråga källorna (ca 1 gång/s). Intervallen räknas i verklig tid; `view` = vyns klocka
   * (simulerad tid i AR-simulatorn), som avgör vilka handjusteringar som gäller.
   */
  tick(view?: number): void {
    const wall = this.wallNow();
    this.hub.tick(wall, view ?? wall);
  }

  /** Justerade trips. Utan observationer: ren tidtabell. */
  fuseRuns(runs: TripRun[], now: number): FusedRun[] {
    this.lastRuns = runs;
    return this.fuseOnly(runs, now);
  }

  private fuseOnly(runs: TripRun[], now: number): FusedRun[] {
    const obs = this.hub.observations();
    return obs.length ? fuse(runs, obs, now, this.cfg.data, { engine: this.engine }) : asScheduled(runs);
  }

  /** Position med vakt (går aldrig bakåt). */
  position(run: FusedRun, t: number): FusedTrain | null {
    return this.guard.position(run, t);
  }

  /**
   * "Tåget kom nu": matchar närmaste tåg i riktningen (±10 min mot tidtabellen), sparar observationen (20 min)
   * och loggar den. `now` = observationens tid (verklig tid på kartan, simulerad tid i AR-simulatorn).
   */
  trainArrived(p: { line: string; direction: string; stopId: string; now: number }): ArriveResult {
    const observation = trainArrivedNow(p);
    const match = matchObservation(this.cfg.data, observation, { engine: this.engine });
    if (!match) return { ok: false, reason: 'no-train' };
    const pat = this.cfg.data.patterns[match.pattern];
    const stop = this.cfg.data.stops[pat.stops[match.stopIndex]];
    const dir = this.cfg.data.directions[pat.dir];
    const entry: LogEntry = {
      observedAt: p.now,
      line: p.line,
      direction: p.direction,
      directionName: dir.name,
      stopId: p.stopId,
      stopName: stop.name,
      kind: 'arrival',
      timetableMs: match.baseMs + pat.a[match.stopIndex] * 1000,
      modelMs: match.plannedMs,
      eventMs: p.now,
      source: 'manual',
      tripId: match.tripId,
    };
    this.manual.add(observation, p.now);
    const savedToDevice = this.log.add(entry);
    void this.hub.pollById('manual', this.wallNow(), p.now);
    return { ok: true, match, observation, entry, savedToDevice };
  }

  /** Ångra senaste "Tåget kom nu" (tar bort både justeringen och loggraden). */
  undoLast(now: number): boolean {
    const last = this.manual.undoLast(now);
    if (!last) return false;
    const m = matchObservation(this.cfg.data, last, { engine: this.engine });
    if (m && last.stopId) this.log.removeLast(m.tripId, last.stopId);
    this.guard.reset();
    void this.hub.pollById('manual', this.wallNow(), now);
    return true;
  }

  /** Riktningar som trafikerar stationen (utom tåg som slutar där), i tidtabellens ordning. */
  directionsAt(stopId: string): string[] {
    const d = this.cfg.data;
    const out: string[] = [];
    for (const p of d.patterns) {
      const k = p.stops.findIndex((s) => d.stops[s].id === stopId);
      if (k < 0 || k === p.stops.length - 1) continue;
      const id = d.directions[p.dir].id;
      if (!out.includes(id)) out.push(id);
    }
    return out;
  }

  /** Nästa tåg per riktning vid en station inom `horizonSec` (justerade tider om det finns observationer). */
  upcoming(stopId: string, now: number, horizonSec = 20 * 60, perDirection = 2): Upcoming[] {
    const runs = this.fuseOnly(activeTrips(this.cfg.data, new Date(now), horizonSec, this.engine), now);
    const byDir = new Map<string, Upcoming['trains']>();
    for (const dir of this.directionsAt(stopId)) byDir.set(dir, []);
    for (const run of runs) {
      const k = run.stopIds.indexOf(stopId);
      if (k < 0 || k === run.stopIds.length - 1 || !byDir.has(run.direction)) continue;
      const arr = run.baseMs + run.timing.arr[k] * 1000;
      const dep = run.baseMs + run.timing.dep[k] * 1000;
      if (dep < now || arr > now + horizonSec * 1000) continue;
      byDir.get(run.direction)!.push({ run, etaMs: arr, atStation: arr <= now, delaySec: run.delays ? run.delays[k] : 0 });
    }
    return [...byDir.entries()].map(([direction, list]) => ({ direction, trains: list.sort((a, b) => a.etaMs - b.etaMs).slice(0, perDirection) }));
  }

  /** Punkt som mock-källan (bara dev) väljer tåg nära. */
  setMockFocus(lat: number, lon: number): void {
    this.mockFocus = { lat, lon };
  }
  private mockFocus: { lat: number; lon: number } | null = null;

  /** Mock (dev): ett tåg nära vyn får en "live"-observation, 90 s sent vid nästa station. */
  private mockLive(): RealtimeSource {
    return new ScriptedSource(
      'mock',
      'live',
      (now) => {
        // Tåget närmast vyn (kartans mitt eller AR-positionen) som är på väg, annars första M1-tåget
        let run: TripRun | undefined;
        if (this.mockFocus) {
          let best = Infinity;
          for (const r of this.lastRuns) {
            const p = positionAt(r, now);
            if (!p || p.status !== 'moving') continue;
            const d = haversine(this.mockFocus.lat, this.mockFocus.lon, p.lat, p.lon);
            if (d < best) {
              best = d;
              run = r;
            }
          }
        }
        run ??= this.lastRuns.filter((r) => r.line === 'M1').sort((a, b) => (a.id < b.id ? -1 : 1))[0];
        if (!run) return [];
        const rel = (now - run.baseMs) / 1000;
        const k = run.timing.arr.findIndex((a, i) => a > rel && i > 0);
        if (k < 0) return [];
        const waitSec = run.timing.arr[k] - rel + 90;
        return [{ source: 'mock', line: run.line, direction: run.direction, stopId: run.stopIds[k], kind: 'wait', observedAt: now, value: waitSec, confidence: 0.9 }];
      },
      30_000,
    );
  }
}

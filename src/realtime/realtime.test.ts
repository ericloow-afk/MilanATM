/** Realtidslagret: ManualSource, logg/CSV, StatusSource, OfficialAtmSource (GTFS-RT JSON), hub och etiketter. */
import { describe, expect, it, vi } from 'vitest';
import sample from './fixtures/line-status.sample.json';
import { RealtimeHub } from './hub';
import { SourceBlockedError } from './http';
import { fmtDelay, sourceLabel } from './label';
import { logToCsv, ObservationLog, romeStamp, type LogEntry } from './log';
import { MANUAL_TTL_MS, ManualSource, trainArrivedNow } from './manual';
import { directionResolver, fromGtfsRtJson, OfficialAtmSource } from './official';
import { ScriptedSource } from './scripted';
import { parseLineStatus, StatusSource } from './status';
import { MemoryStore, type KeyValueStore } from './store';
import { eventTimeMs, type RealtimeObservation } from './types';
import { makeData } from '../engine/testdata';

const T = Date.UTC(2026, 10, 13, 17, 30, 0); // fredag 18:30 Rom
const data = makeData({ east: [0, 780, 1560], bent: [0, 1900], alt: [0, 800, 1600] });

describe('ManualSource', () => {
  const o = (at: number) => trainArrivedNow({ line: 'M9', direction: 'M9>C', stopId: 'B', now: at });

  const KEY = 'mmar.realtime.manual.v1';
  /** ManualSource med en styrbar väggklocka */
  const withWall = (store: KeyValueStore | null, wall: { t: number }) => new ManualSource(store, KEY, MANUAL_TTL_MS, () => wall.t);

  it('sparar i lagringen och läser tillbaka efter omstart', async () => {
    const store = new MemoryStore();
    const wall = { t: T };
    withWall(store, wall).add(o(T), T);
    wall.t = T + 1000;
    expect(await withWall(store, wall).observe(T + 1000)).toHaveLength(1);
  });
  it('går ut efter 20 minuter och tas bort ur lagringen', () => {
    const store = new MemoryStore();
    const wall = { t: T };
    const m = withWall(store, wall);
    m.add(o(T), T);
    wall.t = T + MANUAL_TTL_MS;
    expect(m.list(wall.t)).toHaveLength(1);
    wall.t = T + MANUAL_TTL_MS + 1;
    expect(m.list(wall.t)).toHaveLength(0);
    expect(JSON.parse(store.getItem(KEY)!)).toEqual([]);
  });
  it('simulatorns tid: gäller nära simulerad tid, sparas inte och raderar inte riktiga observationer', () => {
    const store = new MemoryStore();
    const wall = { t: T };
    const m = withWall(store, wall);
    m.add(o(T), T); // riktig observation
    const sim = T - 6 * 3600_000; // simulatorn står sex timmar tidigare
    m.add(o(sim), sim);
    expect(m.list(sim + 60_000).map((x) => x.observedAt)).toEqual([sim]);
    expect(m.list(T).map((x) => x.observedAt)).toEqual([T]);
    expect(JSON.parse(store.getItem(KEY)!).map((x: RealtimeObservation) => x.observedAt)).toEqual([T]);
  });
  it('fungerar utan lagring och när lagringen kastar (privat läge)', () => {
    const throwing: KeyValueStore = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
      removeItem: () => {},
    };
    for (const s of [null, throwing]) {
      const m = withWall(s, { t: T });
      m.add(o(T), T);
      expect(m.list(T)).toHaveLength(1);
    }
  });
  it('"Tåget kom nu" är en ankomst nu med källan manual', () => {
    const x = o(T);
    expect(x).toMatchObject({ source: 'manual', kind: 'arrival', observedAt: T, value: T, stopId: 'B' });
    expect(eventTimeMs(x)).toBe(T);
  });
  it('ångra tar bort den senaste', () => {
    const m = withWall(new MemoryStore(), { t: T });
    m.add(o(T), T);
    m.add(o(T + 1000), T + 1000);
    expect(m.undoLast(T + 2000)?.observedAt).toBe(T + 1000);
    expect(m.list(T + 2000)).toHaveLength(1);
  });
});

describe('logg och CSV', () => {
  const entry: LogEntry = {
    observedAt: T,
    line: 'M2',
    direction: 'M2>GESSATE',
    directionName: 'Gessate',
    stopId: 'GARIBALDI FS',
    stopName: 'Garibaldi FS',
    kind: 'arrival',
    timetableMs: T - 95_000,
    modelMs: T - 130_000,
    eventMs: T,
    source: 'manual',
    tripId: '12:3:20261113:64800',
  };
  it('Rom-tid med datum, veckodag och timme', () => {
    expect(romeStamp(T)).toEqual({ date: '2026-11-13', weekday: 'fre', time: '18:30:00', hour: 18 });
  });
  it('en rad per observation, differens = observerad − planerad (sekunder)', () => {
    const csv = logToCsv([entry]).trim().split('\n');
    expect(csv[0]).toBe('datum,veckodag,timme,linje,riktning,station,planerad,observerad,differens_s,modell_ankomst,differens_modell_s,typ,kalla,trip');
    expect(csv[1]).toBe('2026-11-13,fre,18,M2,Gessate,Garibaldi FS,18:28:25,18:30:00,95,18:27:50,130,arrival,manual,12:3:20261113:64800');
  });
  it('fält med komma citeras', () => {
    expect(logToCsv([{ ...entry, stopName: 'A, B' }])).toContain('"A, B"');
  });
  it('sparas mellan omstarter och ångra tar bort rätt rad', () => {
    const store = new MemoryStore();
    const log = new ObservationLog(store);
    log.add(entry);
    log.add({ ...entry, stopId: 'ZARA', stopName: 'Zara' });
    log.removeLast(entry.tripId, 'ZARA');
    expect(new ObservationLog(store).entries().map((e) => e.stopId)).toEqual(['GARIBALDI FS']);
  });
});

describe('StatusSource (linjestatus)', () => {
  it('utan URL och nyckel är källan avstängd och ger ingenting', async () => {
    const s = new StatusSource({});
    expect(s.enabled).toBe(false);
    expect(await s.observe()).toEqual([]);
  });
  it('fixturen ger en status per linje med källans uppdateringstid, oförändrad text', async () => {
    const s = new StatusSource({ load: async () => sample });
    const obs = await s.observe();
    expect(obs).toHaveLength(5);
    expect(obs.every((o) => o.kind === 'status' && o.stopId === null && o.observedAt === Date.parse('2026-11-13T22:15:00Z'))).toBe(true);
    expect(obs.find((o) => o.line === 'M3')?.value).toBe('rallentamenti: testtext, inte en riktig störning');
  });
  it('trasigt svar ger inga observationer', () => {
    expect(parseLineStatus({ lines: 'x' })).toEqual([]);
    expect(parseLineStatus({ updatedAt: 'inte ett datum', lines: [] })).toEqual([]);
  });
});

describe('OfficialAtmSource (skelett, GTFS-Realtime JSON)', () => {
  const ctx = { sourceId: 'official-atm', resolveDirection: directionResolver(data), knownStops: new Set(['A', 'B', 'C', 'D']), knownLines: new Set(['M9']) };
  const tsSec = T / 1000;
  const feed = {
    header: { gtfsRealtimeVersion: '2.0', timestamp: String(tsSec) },
    entity: [
      // camelCase, nästa stopp B om 120 s, sedan C
      { id: '1', tripUpdate: { trip: { routeId: 'M9' }, stopTimeUpdate: [{ stopId: 'A', departure: { time: String(tsSec - 200) } }, { stopId: 'B', arrival: { time: String(tsSec + 120) } }, { stopId: 'C', arrival: { time: String(tsSec + 300) } }] } },
      // snake_case
      { id: '2', trip_update: { trip: { route_id: 'M9' }, timestamp: tsSec - 5, stop_time_update: [{ stop_id: 'D', arrival: { time: tsSec + 60 } }] } },
      // bara delay: används inte
      { id: '3', tripUpdate: { trip: { routeId: 'M9' }, stopTimeUpdate: [{ stopId: 'B', arrival: { delay: 90 } }] } },
      // okänd linje
      { id: '4', tripUpdate: { trip: { routeId: 'B90' }, stopTimeUpdate: [{ stopId: 'B', arrival: { time: tsSec } }] } },
      // fordon vid station
      { id: '5', vehicle: { trip: { routeId: 'M9' }, stopId: 'C', currentStatus: 'STOPPED_AT', timestamp: String(tsSec - 10) } },
      { id: '6', vehicle: { trip: { routeId: 'M9' }, stopId: 'C', currentStatus: 'IN_TRANSIT_TO', timestamp: String(tsSec - 10) } },
    ],
  };
  it('utan URL: avstängd, faller tillbaka på tidtabell (inga observationer)', async () => {
    const s = new OfficialAtmSource({ data });
    expect(s.enabled).toBe(false);
    expect(await s.observe()).toEqual([]);
  });
  it('trip updates: nästa stopp med absolut tid, riktning ur stoppens ordning', () => {
    const obs = fromGtfsRtJson(feed, ctx);
    const one = obs.find((o) => o.stopId === 'B')!;
    expect(one).toMatchObject({ source: 'official-atm', line: 'M9', direction: 'M9>C', kind: 'arrival', observedAt: T, value: T + 120_000 });
    const two = obs.find((o) => o.stopId === 'D')!;
    expect(two).toMatchObject({ direction: 'M9>D', observedAt: T - 5000 });
  });
  it('bara delay, okända linjer och fordon som inte står vid station hoppas över', () => {
    const obs = fromGtfsRtJson(feed, ctx);
    expect(obs).toHaveLength(3);
    const v = obs.find((o) => o.stopId === 'C')!;
    expect(v).toMatchObject({ kind: 'arrival', direction: null, value: T - 10_000, confidence: 0.5 });
  });
  it('med en laddare (som en framtida feed) blir källan aktiv', async () => {
    const s = new OfficialAtmSource({ data, load: async () => feed });
    expect(s.enabled).toBe(true);
    expect(await s.observe()).toHaveLength(3);
  });
});

describe('RealtimeHub', () => {
  const live = (fn = vi.fn(async () => [] as RealtimeObservation[])) => ({ src: new ScriptedSource('x', 'live', fn, 0), fn });
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('nätkällor frågas högst var 30:e sekund', async () => {
    const { src, fn } = live();
    const hub = new RealtimeHub([src]);
    for (let s = 0; s <= 65; s++) {
      hub.tick(T + s * 1000);
      await flush();
    }
    expect(fn).toHaveBeenCalledTimes(3); // 0, 30, 60 s
  });
  it('ingen hämtning när fliken är dold', async () => {
    const { src, fn } = live();
    let hidden = true;
    const hub = new RealtimeHub([src], { isHidden: () => hidden });
    hub.tick(T);
    await flush();
    expect(fn).not.toHaveBeenCalled();
    hidden = false;
    hub.tick(T + 1000);
    await flush();
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('källa som nekar (403) stängs av och dess observationer släpps', async () => {
    let calls = 0;
    const src = new ScriptedSource('x', 'live', async () => {
      calls++;
      throw new SourceBlockedError(403, 'nekad');
    });
    const hub = new RealtimeHub([src]);
    hub.tick(T);
    await flush();
    hub.tick(T + 60_000);
    await flush();
    expect(calls).toBe(1);
    expect(hub.describe()[0]).toMatchObject({ blocked: true });
  });
  it('version ökar bara när observationerna ändras; linjestatus per linje', async () => {
    const st: RealtimeObservation = { source: 's', line: 'M1', direction: null, stopId: null, kind: 'status', observedAt: T, value: 'regolare', confidence: 1 };
    const hub = new RealtimeHub([new ScriptedSource('s', 'status', () => [st])]);
    await hub.pollById('s', T);
    const v = hub.version;
    await hub.pollById('s', T + 60_000);
    expect(hub.version).toBe(v);
    expect(hub.lineStatus().get('M1')?.value).toBe('regolare');
  });
});

describe('etiketter', () => {
  it('källa och försening som text', () => {
    expect(sourceLabel('schedule', 0)).toBe('tidtabell');
    expect(sourceLabel('adjusted', 125)).toBe('justerad +2 min');
    expect(sourceLabel('adjusted', -40)).toBe('justerad −40 s');
    expect(sourceLabel('live', 90)).toBe('live');
    expect(fmtDelay(0)).toBe('±0 min');
  });
});

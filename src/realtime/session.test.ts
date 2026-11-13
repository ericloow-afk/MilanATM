/** Steg 2: "Tåget kom nu" via RealtimeSession (matchning, sparning, logg, ångra, nästa tåg per riktning). */
import { describe, expect, it } from 'vitest';
import { activeTrips } from '../engine';
import { LINE_T0, LINE_T1, lineArr, lineData, lineMs } from '../engine/testdata-line';
import { RealtimeSession } from './session';
import { MemoryStore } from './store';

/** Väggklockan följer testets tid (6/11 2026), annars vore allt "gammalt" mot dagens datum */
const wall = { t: lineMs(0) };
const cfg = (store = new MemoryStore()) => ({ data: lineData, store, wallNow: () => wall.t });
const fresh = () => new RealtimeSession(cfg());
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('RealtimeSession: Tåget kom nu', () => {
  it('utan observationer: ren tidtabell och inga aktiva nätkällor', () => {
    const rt = fresh();
    expect(rt.liveConfigured).toBe(false);
    const t = lineMs(500);
    const runs = rt.fuseRuns(activeTrips(lineData, new Date(t), 0), t);
    expect(runs.every((r) => r.source === 'schedule')).toBe(true);
  });

  it('justerar närmaste tåg i riktningen, loggar planerad och observerad tid, och syns direkt', async () => {
    const rt = fresh();
    const now = lineMs(lineArr(5) + 50); // T0 kom till P5 50 s efter modellens ankomst
    wall.t = now;
    const res = rt.trainArrived({ line: 'M9', direction: 'M9>P11', stopId: 'P5', now });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.match.tripId).toBe(LINE_T0);
    expect(res.match.delaySec).toBeCloseTo(50, 6);
    // Loggen: tidtabellens tid (GTFS, 600 s) och modellens ankomst (578 s)
    expect(res.entry.timetableMs).toBe(lineMs(600));
    expect(res.entry.modelMs).toBe(lineMs(lineArr(5)));
    expect(rt.log.size).toBe(1);
    await flush();
    const run = rt.fuseRuns(activeTrips(lineData, new Date(now), 0), now).find((r) => r.id === LINE_T0)!;
    expect(run.source).toBe('adjusted');
    const tr = rt.position(run, now)!;
    expect(tr.fromStation).toBe('P5');
    expect(tr.status).toBe('dwelling');
  });

  it('inget tåg inom ±10 min: ingen justering och ingen loggrad', () => {
    const rt = fresh();
    wall.t = lineMs(-3 * 3600);
    const res = rt.trainArrived({ line: 'M9', direction: 'M9>P11', stopId: 'P5', now: wall.t });
    expect(res).toEqual({ ok: false, reason: 'no-train' });
    expect(rt.log.size).toBe(0);
  });

  it('justeringen sparas och läses tillbaka av en ny session (samma enhet) i 20 minuter', async () => {
    const store = new MemoryStore();
    const now = lineMs(lineArr(5) + 20);
    wall.t = now;
    new RealtimeSession(cfg(store)).trainArrived({ line: 'M9', direction: 'M9>P11', stopId: 'P5', now });
    wall.t = now + 60_000;
    const again = new RealtimeSession(cfg(store));
    await again.hub.pollById('manual', wall.t);
    expect(again.hub.observations()).toHaveLength(1);
    expect(again.log.size).toBe(1);
    wall.t = now + 21 * 60_000;
    await again.hub.pollById('manual', wall.t);
    expect(again.hub.observations()).toHaveLength(0);
  });

  it('ångra tar bort både justeringen och loggraden', async () => {
    const rt = fresh();
    const now = lineMs(lineArr(5) + 20);
    wall.t = now;
    rt.trainArrived({ line: 'M9', direction: 'M9>P11', stopId: 'P5', now });
    await flush();
    expect(rt.undoLast(now + 1000)).toBe(true);
    await flush();
    expect(rt.hub.observations()).toHaveLength(0);
    expect(rt.log.size).toBe(0);
  });

  it('nästa tåg per riktning vid en station, med justerad tid för det justerade tåget', async () => {
    const rt = fresh();
    const now = lineMs(lineArr(3) - 30);
    wall.t = now;
    const before = rt.upcoming('P3', now);
    expect(before.map((u) => u.direction)).toEqual(['M9>P11', 'M9>P0']);
    const fwd = before.find((u) => u.direction === 'M9>P11')!;
    expect(fwd.trains[0].run.id).toBe(LINE_T0);
    expect(fwd.trains[0].run.source).toBe('schedule');
    expect(fwd.trains[1].run.id).toBe(LINE_T1);
    // Användaren ser T0 komma in vid P2 en minut sent: T0:s ankomst till P3 flyttas ungefär lika mycket
    rt.trainArrived({ line: 'M9', direction: 'M9>P11', stopId: 'P2', now: lineMs(lineArr(2) + 60) });
    await flush();
    const after = rt.upcoming('P3', now).find((u) => u.direction === 'M9>P11')!;
    expect(after.trains[0].run.source).toBe('adjusted');
    expect(after.trains[0].delaySec).toBeGreaterThan(45);
  });

  it('ändstationen visas inte som riktning (tåg som slutar där)', () => {
    expect(fresh().directionsAt('P11')).toEqual(['M9>P0']);
  });
});

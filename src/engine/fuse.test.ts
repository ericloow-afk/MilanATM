/** fuse(): tidtabell + realtidsobservationer. Syntetisk rak linje med 12 stationer, 120 s mellan stationerna. */
import { describe, expect, it } from 'vitest';
import { activeTrips, DEFAULT_OPTIONS, positionAt } from './index';
import { adjustTiming, fuse, matchObservation, PositionGuard, positionAtFused, type FusedRun } from './fuse';
import { LINE_N, LINE_REV0, LINE_T0, LINE_T1, lineArr, lineData, lineDep, lineMs } from './testdata-line';
import type { RealtimeObservation } from '../realtime/types';

const N = LINE_N;
const data = lineData;
const ms = lineMs;
const T0 = LINE_T0;
const T1 = LINE_T1;
const REV0 = LINE_REV0;
const ARR = lineArr;
const DEP = lineDep;

const runsAt = (t: number) => activeTrips(data, new Date(t), 0, DEFAULT_OPTIONS);
const obs = (o: Partial<RealtimeObservation> & Pick<RealtimeObservation, 'stopId' | 'observedAt'>): RealtimeObservation => ({
  source: 'manual',
  line: 'M9',
  direction: 'M9>P11',
  kind: 'arrival',
  value: o.observedAt,
  confidence: 0.8,
  ...o,
});
const fused = (t: number, list: RealtimeObservation[], id = T0): FusedRun => fuse(runsAt(t), list, t, data).find((r) => r.id === id)!;
const sdNow = (run: FusedRun, t: number, g?: PositionGuard) => {
  const tr = g ? g.position(run, t)! : positionAtFused(run, t)!;
  const i = run.stopIds.indexOf(tr.fromStation);
  return tr.status === 'dwelling' ? run.sd[i] : run.sd[i] + tr.progress * (run.sd[i + 1] - run.sd[i]);
};

describe('fuse: ingen observation', () => {
  it('alla tåg är ren tidtabell, positionerna identiska med positionAt', () => {
    const t = ms(500);
    const runs = runsAt(t);
    const out = fuse(runs, [], t, data);
    expect(out).toHaveLength(runs.length);
    for (let i = 0; i < runs.length; i++) {
      expect(out[i].source).toBe('schedule');
      expect(out[i].delays).toBeNull();
      expect(out[i].timing).toBe(runs[i].timing);
      const a = positionAt(runs[i], t);
      const b = positionAtFused(out[i], t);
      expect(b?.lat).toBe(a?.lat);
      expect(b?.lon).toBe(a?.lon);
      expect(b?.delaySec).toBe(0);
    }
  });
  it('observation äldre än 15 min ger ren tidtabell', () => {
    const t = ms(ARR(5) + 60);
    const old = obs({ stopId: 'P5', observedAt: t - 16 * 60_000, value: t - 16 * 60_000 });
    expect(fused(t, [old]).source).toBe('schedule');
  });
  it('observation långt efter kartans klocka (spolad bakåt) ignoreras', () => {
    const t = ms(ARR(5));
    const future = obs({ stopId: 'P5', observedAt: t + 5 * 60_000, value: t + 5 * 60_000 });
    expect(fused(t, [future]).source).toBe('schedule');
  });
  it('linjestatus påverkar inga positioner', () => {
    const t = ms(ARR(5));
    const st: RealtimeObservation = { source: 'e015-status', line: 'M9', direction: null, stopId: null, kind: 'status', observedAt: t, value: 'regolare', confidence: 1 };
    expect(fused(t, [st]).source).toBe('schedule');
  });
});

describe('fuse: en observation', () => {
  const t = ms(ARR(5) + 120); // tåget kom till P5 två minuter sent
  const o = obs({ stopId: 'P5', observedAt: t, value: t });

  it('matchar närmaste trip i rätt riktning och räknar förseningen', () => {
    const m = matchObservation(data, o)!;
    expect(m.tripId).toBe(T0);
    expect(m.stopIndex).toBe(5);
    expect(m.delaySec).toBeCloseTo(120, 6);
  });
  it('tåget står vid P5 nu, märkt justerad med +120 s', () => {
    const r = fused(t, [o]);
    expect(r.source).toBe('adjusted');
    const tr = positionAtFused(r, t)!;
    expect(tr.status).toBe('dwelling');
    expect(tr.fromStation).toBe('P5');
    expect(tr.delaySec).toBeCloseTo(120, 6);
  });
  it('förseningen avtar: halverad fem stopp senare', () => {
    const r = fused(t, [o]);
    expect(r.delays![5]).toBeCloseTo(120, 6);
    expect(r.delays![10]).toBeCloseTo(60, 0);
    for (let j = 6; j < N; j++) expect(r.delays![j]).toBeLessThanOrEqual(r.delays![j - 1] + 1e-9);
  });
  it('övriga tåg påverkas inte', () => {
    const all = fuse(runsAt(t), [o], t, data);
    expect(all.filter((r) => r.source !== 'schedule').map((r) => r.id)).toEqual([T0]);
  });
  it('fel riktning matchar inte framåttåget; riktning null tar närmaste oavsett riktning', () => {
    const back = obs({ stopId: 'P5', observedAt: t, value: t, direction: 'M9>P0' });
    expect(matchObservation(data, back)?.tripId).toBe(REV0);
    const any = obs({ stopId: 'P5', observedAt: t, value: t, direction: null });
    expect(matchObservation(data, any)).not.toBeNull();
  });
  it('källa som inte är manuell märks live', () => {
    const live = { ...o, source: 'official-atm' };
    expect(fused(t, [live]).source).toBe('live');
  });
  it('väntetid (wait): sekunder kvar till ankomst räknas om till ankomsttid', () => {
    const now = ms(ARR(8) - 300);
    const w = obs({ stopId: 'P8', observedAt: now, kind: 'wait', value: 360 }); // planerat 300 s kvar, källan säger 360
    const m = matchObservation(data, w)!;
    expect(m.tripId).toBe(T0);
    expect(m.delaySec).toBeCloseTo(60, 6);
  });
  it('avgång (departure): tåget står kvar vid stationen tills den observerade avgången', () => {
    const now = ms(DEP(5) + 30);
    const d = obs({ stopId: 'P5', observedAt: now, kind: 'departure', value: now });
    const r = fused(now, [d]);
    expect(r.timing.dep[5]).toBeCloseTo(DEP(5) + 30, 6);
    expect(positionAtFused(r, now - 1)!.status).toBe('dwelling');
    expect(positionAtFused(r, now + 1)!.status).toBe('moving');
  });
});

describe('fuse: motstridiga observationer', () => {
  it('den senaste observationen för samma tåg vinner', () => {
    const t1 = ms(ARR(3) + 60);
    const t2 = ms(ARR(4) + 100);
    const a = obs({ stopId: 'P3', observedAt: t1, value: t1 });
    const b = obs({ stopId: 'P4', observedAt: t2, value: t2 });
    const r = fused(t2, [b, a]);
    expect(r.basis).toBe(b);
    expect(r.delays![4]).toBeCloseTo(100, 6);
  });
  it('samtidiga observationer vägs efter confidence', () => {
    const t = ms(ARR(5) + 60);
    const a = obs({ stopId: 'P5', observedAt: t, value: t, confidence: 0.9 }); // +60
    const b = obs({ stopId: 'P5', observedAt: t + 10_000, value: t + 40_000, confidence: 0.3 }); // +100
    const r = fused(t + 10_000, [a, b]);
    expect(r.delays![5]).toBeCloseTo((60 * 0.9 + 100 * 0.3) / 1.2, 6);
  });
  it('en observation närmare nästa tåg matchar nästa tåg, inte det första', () => {
    // T1 planeras vid P5 fyra minuter efter T0; +200 s mot T0 är −40 s mot T1
    const t = ms(ARR(5) + 200);
    expect(matchObservation(data, obs({ stopId: 'P5', observedAt: t, value: t }))!.tripId).toBe(T1);
  });
});

describe('fuse: tåget har redan passerat enligt tidtabellen', () => {
  it('positionen går aldrig bakåt: tåget står kvar tills den justerade tidtabellen hinner ikapp', () => {
    // Enligt tidtabellen lämnade T0 P5 för 60 s sedan. Användaren ser det komma in till P5 nu (+82 s).
    const now = ms(DEP(5) + 60);
    const o = obs({ stopId: 'P5', observedAt: now, value: now });
    const g = new PositionGuard();
    let prev = -Infinity;
    let heldSeen = false;
    for (let s = -10; s <= 300; s += 0.5) {
      const t = now + s * 1000;
      const run = s < 0 ? fused(t, []) : fused(t, [o]);
      const tr = g.position(run, t)!;
      if (tr.held) heldSeen = true;
      const sd = sdNow(run, t, g);
      expect(sd).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = sd;
    }
    expect(heldSeen).toBe(true);
    // Efter en stund kör tåget igen och ligger enligt den justerade tidtabellen
    const later = now + 300_000;
    const r = fused(later, [o]);
    expect(g.position(r, later)!.held).toBe(false);
  });
  it('utan vakt hade tåget hoppat bakåt (det är vakten som skyddar)', () => {
    const now = ms(DEP(5) + 60);
    const o = obs({ stopId: 'P5', observedAt: now, value: now });
    expect(sdNow(fused(now, [o]), now)).toBeLessThan(sdNow(fused(now, []), now));
  });
  it('observation för en trip som redan nått ändstationen påverkar inget annat tåg', () => {
    const t = ms(DEP(11) + 200); // T0 är framme och borta
    const o = obs({ stopId: 'P11', observedAt: ms(ARR(11) + 30), value: ms(ARR(11) + 30) });
    const out = fuse(runsAt(t), [o], t, data);
    expect(out.find((r) => r.id === T0)).toBeUndefined();
    expect(out.every((r) => r.source === 'schedule')).toBe(true);
  });
  it('vakten nollställs när klockan går bakåt (spolning)', () => {
    const now = ms(DEP(5) + 60);
    const g = new PositionGuard();
    g.position(fused(now, []), now);
    const back = now - 120_000;
    expect(g.position(fused(back, []), back)!.held).toBe(false);
  });
});

describe('fuse: observation mitt i ett uppehåll', () => {
  it('tåget står kvar vid stationen hela uppehållet räknat från observerad ankomst', () => {
    const now = ms(ARR(5) + 10); // står vid P5 sedan 10 s enligt modellen
    const o = obs({ stopId: 'P5', observedAt: now, value: now });
    const r = fused(now, [o]);
    expect(r.delays![5]).toBeCloseTo(10, 6);
    expect(r.timing.dep[5] - r.timing.arr[5]).toBeCloseTo(DEP(5) - ARR(5), 6);
    const g = new PositionGuard();
    g.position(fused(now - 500, []), now - 500);
    for (let s = 0; s < 22; s += 0.5) {
      const tr = g.position(r, now + s * 1000)!;
      expect(tr.status).toBe('dwelling');
      expect(tr.fromStation).toBe('P5');
      expect(tr.held).toBe(false);
    }
    expect(positionAtFused(r, now + 22_500)!.status).toBe('moving');
  });
});

describe('fuse: stor försening', () => {
  it('nio minuter sent: tiderna är fortfarande möjliga och tåget syns hela vägen', () => {
    const t = ms(ARR(2) + 540);
    // bakåttåget: tredje stoppet (index 2) är P9
    const r = fused(t, [obs({ stopId: 'P9', direction: 'M9>P0', observedAt: t, value: t })], REV0);
    expect(r.delays![2]).toBeCloseTo(540, 6);
    expect(r.source).toBe('adjusted');
    const { arr, dep } = r.timing;
    const base = runsAt(t).find((x) => x.id === REV0)!.timing;
    for (let j = 0; j < N; j++) {
      expect(dep[j]).toBeGreaterThanOrEqual(arr[j]);
      expect(dep[j] - arr[j]).toBeGreaterThanOrEqual(base.dep[j] - base.arr[j] - 1e-9); // uppehållen behålls
      if (j > 0) expect(arr[j] - dep[j - 1]).toBeGreaterThanOrEqual(0.85 * (base.arr[j] - base.dep[j - 1]) - 1e-9); // körtid ≥ 85 %
    }
    // tåget tar igen högst 15 % av körtiden per sträcka
    expect(r.delays![3]).toBeGreaterThan(540 - 0.15 * 98 - 1);
    for (let s = r.timing.visibleFrom + 1; s < r.timing.visibleTo; s += 7) expect(positionAtFused(r, ms(s))).not.toBeNull();
  });
  it('adjustTiming: negativ försening (tidigt tåg) ger växande tider', () => {
    const tm = runsAt(ms(100)).find((x) => x.id === T0)!.timing;
    const { timing } = adjustTiming(tm, 4, -50, { halfLifeStops: 5, minTravelFactor: 0.85 });
    for (let j = 1; j < N; j++) expect(timing.arr[j]).toBeGreaterThan(timing.dep[j - 1]);
  });
});

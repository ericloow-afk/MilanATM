/**
 * Replay av en riktig sensorlogg (inomhus, 2026-11-06, ca 5 Hz, 30 s): upprätt, lutad ned mot golvet, upp mot taket.
 * Loggen: test/fixtures/sensor-log-indoor-2026-11-06.csv. Rapport: docs/filter-replay.md.
 */
import { describe, expect, it } from 'vitest';
import csv from '../../test/fixtures/sensor-log-indoor-2026-11-06.csv?raw';
import { wrap180 } from '../geo/orientation';
import { DEFAULT_FILTER_CONFIG } from './filter';
import { parseSensorCsv, replay, type ReplayPoint } from './replay';

const rows = parseSensorCsv(csv);
const run = replay(rows);
const at = (clock: string) => Date.parse(`2026-11-06T${clock}Z`);
const win = (pts: ReplayPoint[], a: string, b: string) => pts.filter((p) => p.t >= at(a) && p.t <= at(b));
const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

describe('loggen', () => {
  it('har ca 5 Hz, 30 s och rätt kolumner', () => {
    expect(rows.length).toBe(144);
    expect((rows.at(-1)!.t - rows[0].t) / 1000).toBeGreaterThan(29.5);
    expect(rows[0]).toMatchObject({ heading: 172.1, headingAcc: 16, alpha: 246.8, beta: 79.9, gamma: 1.3 });
  });
  it('alpha/gamma hoppar kraftigt (Euler-singularitet) medan verklig rotation per sample är liten', () => {
    // 20:15:15.576 → .782: alpha 268→199 och gamma −53→16, men den verkliga rotationen mellan samplen är ca 13°
    const a = rows.findIndex((r) => r.t === at('20:15:15.576'));
    const dAlpha = Math.abs(wrap180(rows[a + 1].alpha - rows[a].alpha));
    const dGamma = Math.abs(rows[a + 1].gamma - rows[a].gamma);
    expect(dAlpha).toBeGreaterThan(60);
    expect(dGamma).toBeGreaterThan(60);
    expect(run[a + 1].rawStep).toBeLessThan(20);
    // och i hela loggen: den råa kvaternionrotationen mellan samples överstiger aldrig 25°
    expect(Math.max(...run.map((p) => p.rawStep))).toBeLessThan(25);
  });
});

describe('a) filtret skapar aldrig hopp', () => {
  it('filtrerad rotation ändras aldrig mer än den råa mellan två samples (+ liten tolerans)', () => {
    run.forEach((p, i) => {
      if (i === 0) return;
      expect(p.filteredStep, `sample ${i} (${new Date(p.t).toISOString().slice(14, 23)})`).toBeLessThanOrEqual(p.rawStep + 1.5);
    });
  });
  it('vyn ändras aldrig mer än 25° per sample, trots Euler-hoppen', () => {
    expect(Math.max(...run.map((p) => p.filteredStep))).toBeLessThan(25);
  });
});

describe('b) kompassvändningarna (beta ≈ 142 upp och ≈ 129 ned)', () => {
  it('kompassen vänder verkligen ~170° i loggen (testet är meningsfullt)', () => {
    const before = run.find((p) => p.t === at('20:15:16.412'))!;
    const after = run.find((p) => p.t === at('20:15:16.624'))!;
    expect(Math.abs(wrap180(after.measured! - before.measured!))).toBeGreaterThan(160);
    const down = Math.abs(wrap180(run.find((p) => p.t === at('20:15:20.193'))!.measured! - run.find((p) => p.t === at('20:15:19.984'))!.measured!));
    expect(down).toBeGreaterThan(160);
  });
  it('yaw-offset ändras mindre än 10° kring uppåtvändningen (20:15:16.0–17.6)', () => {
    expect(range(win(run, '20:15:16.0', '20:15:17.6').map((p) => p.yaw))).toBeLessThan(10);
  });
  it('yaw-offset ändras mindre än 10° kring nedåtvändningen (20:15:19.9–20.7)', () => {
    expect(range(win(run, '20:15:19.9', '20:15:20.7').map((p) => p.yaw))).toBeLessThan(10);
  });
  it('under hela blicken uppåt (20:15:15.9–20.5) används inte kompassen', () => {
    for (const p of win(run, '20:15:15.9', '20:15:20.5')) expect(p.state).not.toBe('ok');
  });
});

describe('c) fönstret med headingAcc > 25°', () => {
  const bad = run.filter((p) => (p.headingAcc ?? 0) > 25);
  it('fönstret finns (ca 20:15:05.9–08.2)', () => {
    expect(bad.length).toBeGreaterThan(8);
    expect(new Date(bad[0].t).toISOString().slice(14, 19)).toBe('15:05');
  });
  it('skattningen rör sig långsamt, under 6°/s', () => {
    const w = win(run, '20:15:05.8', '20:15:08.3');
    for (let i = 1; i < w.length; i++) {
      const rate = Math.abs(wrap180(w[i].yaw - w[i - 1].yaw)) / ((w[i].t - w[i - 1].t) / 1000);
      expect(rate).toBeLessThan(6);
    }
  });
  it('ingen sådan sample används', () => {
    for (const p of bad) expect(p.state).toBe('inaccurate');
  });
});

describe('d) stabil offset (20:15:08–15)', () => {
  it('skattningen håller sig inom ±5° av medianen', () => {
    const ys = win(run, '20:15:08.0', '20:15:15.0').map((p) => p.yaw);
    const med = median(ys);
    for (const y of ys) expect(Math.abs(y - med)).toBeLessThanOrEqual(5);
  });
});

describe('grindar och parametrar', () => {
  it('en sample används aldrig med låg noggrannhet, blick uppåt eller över innovationsgränsen', () => {
    const c = DEFAULT_FILTER_CONFIG;
    for (const p of run) {
      if (p.state !== 'ok') continue;
      expect(p.headingAcc ?? 0).toBeLessThanOrEqual(c.maxCompassAccuracy);
      expect(p.elevation).toBeLessThanOrEqual(c.maxElevationDeg);
      expect(p.rate).toBeLessThanOrEqual(c.maxRateDegPerSec);
    }
  });
  it('yaw följer den uppmätta offseten med mätbar eftersläpning (≈ 5–6° RMS vid τ = 5 s) och stannar i 45°-gränsen', () => {
    const used = run.filter((p) => p.state === 'ok' && p.measured != null);
    for (const p of used) expect(Math.abs(wrap180(p.measured! - p.yaw))).toBeLessThan(DEFAULT_FILTER_CONFIG.innovationLimitDeg);
    const rms = (r: ReplayPoint[]) => Math.sqrt(r.filter((p) => p.state === 'ok').reduce((s, p) => s + wrap180(p.yaw - p.measured!) ** 2, 0) / r.filter((p) => p.state === 'ok').length);
    // lätt att finjustera: kortare tidskonstant följer kompassen tätare, längre lugnar mer
    expect(rms(replay(rows, { tauYaw: 1 }))).toBeLessThan(rms(replay(rows, { tauYaw: 5 })));
    expect(rms(replay(rows, { tauYaw: 5 }))).toBeLessThan(rms(replay(rows, { tauYaw: 12 })));
  });
  it('utan grindar (alla avstängda) hade kompassvändningarna flyttat skattningen mer än 10°', () => {
    const ungated = replay(rows, { maxElevationDeg: 180, innovationLimitDeg: 360, maxRateDegPerSec: 1e9, maxCompassAccuracy: 360, tauYaw: 1 });
    expect(range(win(ungated, '20:15:16.0', '20:15:17.6').map((p) => p.yaw))).toBeGreaterThan(10);
  });
  it('innovationsgränsen ensam stoppar språnget om höjdgrinden stängs av', () => {
    const r = replay(rows, { maxElevationDeg: 180 });
    expect(range(win(r, '20:15:16.0', '20:15:17.6').map((p) => p.yaw))).toBeLessThan(10);
    expect(win(r, '20:15:16.6', '20:15:17.4').some((p) => p.state === 'jump')).toBe(true);
  });
});

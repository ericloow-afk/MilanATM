import { describe, expect, it } from 'vitest';
import { eulerFromHeadingPitch, forwardHeading, referenceHeading, wrap180 } from '../geo/orientation';
import { OrientationFilter, type OrientationSample } from './filter';

const DT = 1 / 30;
/** Simulerad telefon: sann riktning H, lutning P, godtyckligt alpha-origo O; kompassen visar H. */
function sample(h: number, p: number, origin: number, compass: number | null, acc: number | null = 10): OrientationSample {
  const { alpha, beta, gamma } = eulerFromHeadingPitch(h, p, origin);
  return { alpha, beta, gamma, screenAngle: 0, compass, compassAccuracy: acc };
}
const run = (f: OrientationFilter, s: OrientationSample, seconds: number) => {
  for (let t = 0; t < seconds; t += DT) f.update(DT, s);
};
const err = (f: OrientationFilter, trueHeading: number) => Math.abs(wrap180(forwardHeading(f.quaternion) - trueHeading));

describe('OrientationFilter – yaw-offset mot kompass', () => {
  it('första giltiga kompassvärdet snappar yaw så att kameran pekar rätt, trots godtyckligt alpha-origo', () => {
    const f = new OrientationFilter();
    f.update(DT, sample(120, 0, 217, 120));
    // pitch 0 = upprätt → kamerans riktning
    expect(err(f, 120)).toBeLessThan(0.5);
  });
  it('följer en långsam vridning 120° → 150° med liten eftersläpning och konvergerar', () => {
    const f = new OrientationFilter();
    run(f, sample(120, 0, 40, 120), 1);
    run(f, sample(150, 0, 40, 150), 40);
    expect(err(f, 150)).toBeLessThan(1);
  });
  it('alpha-driften (origo som flyter 5° under 20 s) kompenseras av kompassen', () => {
    const f = new OrientationFilter();
    run(f, sample(200, 0, 0, 200), 1);
    for (let t = 0; t < 20; t += DT) f.update(DT, sample(200, 0, (5 * t) / 20, 200));
    run(f, sample(200, 0, 5, 200), 20);
    expect(err(f, 200)).toBeLessThan(1);
  });
  it('cirkulärt: kompass som växlar 359° ↔ 1° ger ingen 180°-hoppning', () => {
    const f = new OrientationFilter();
    run(f, sample(0, 0, 90, 0), 1);
    for (let i = 0; i < 300; i++) f.update(DT, sample(0, 0, 90, i % 2 ? 359 : 1));
    expect(err(f, 0)).toBeLessThan(3);
  });
  it('brusig kompass (±12°) ger stabil yaw (< 3° fel) efter inställning', () => {
    const f = new OrientationFilter();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 24;
    run(f, sample(75, 0, 10, 75), 1);
    for (let i = 0; i < 900; i++) f.update(DT, sample(75, 0, 10, 75 + rnd()));
    expect(err(f, 75)).toBeLessThan(3);
  });
});

describe('OrientationFilter – kompassgrindning', () => {
  const settled = () => {
    const f = new OrientationFilter();
    run(f, sample(100, 0, 33, 100), 2);
    return f;
  };
  it('ignorerar negativ noggrannhet (okalibrerad) och rapporterar det', () => {
    const f = settled();
    run(f, sample(100, 0, 33, 160, -1), 20);
    expect(err(f, 100)).toBeLessThan(0.5);
    expect(f.compassState).toBe('uncalibrated');
  });
  it('ignorerar noggrannhet över 25°', () => {
    const f = settled();
    run(f, sample(100, 0, 33, 160, 40), 20);
    expect(err(f, 100)).toBeLessThan(0.5);
    expect(f.compassState).toBe('inaccurate');
  });
  it('ignorerar saknat kompassvärde och håller offseten', () => {
    const f = settled();
    run(f, sample(100, 0, 33, null, null), 20);
    expect(err(f, 100)).toBeLessThan(0.5);
    expect(f.compassState).toBe('none');
  });
  it('använder kompass vid noggrannhet 0 och 25 (gränsvärden)', () => {
    const f = settled();
    run(f, sample(100, 0, 33, 100, 25), 1);
    expect(f.compassState).toBe('ok');
    run(f, sample(100, 0, 33, 100, 0), 1);
    expect(f.compassState).toBe('ok');
  });
});

describe('OrientationFilter – manuell kalibrering', () => {
  it('nudgeManual(+10) vrider vyn +10° direkt och driver inte tillbaka', () => {
    const f = new OrientationFilter();
    run(f, sample(50, 0, 12, 50), 3);
    f.nudgeManual(10);
    expect(err(f, 60)).toBeLessThan(0.5);
    run(f, sample(50, 0, 12, 50), 60);
    expect(err(f, 60)).toBeLessThan(1);
    expect(f.manualDeg).toBeCloseTo(10, 9);
  });
  it('resetManual tar bort biasen', () => {
    const f = new OrientationFilter();
    run(f, sample(50, 0, 12, 50), 3);
    f.nudgeManual(-15);
    f.resetManual();
    run(f, sample(50, 0, 12, 50), 60);
    expect(err(f, 50)).toBeLessThan(1);
  });
});

describe('OrientationFilter – utjämning i kvaternionrymd', () => {
  it('ett hopp i inmatningen tas igen mjukt (monotont) och når målet', () => {
    const f = new OrientationFilter({ tauQ: 0.15 });
    run(f, sample(0, 0, 0, null, null), 1);
    const start = forwardHeading(f.quaternion);
    const target = sample(40, 0, 0, null, null);
    const seen: number[] = [];
    for (let i = 0; i < 90; i++) {
      f.update(DT, target);
      seen.push(wrap180(forwardHeading(f.quaternion) - start));
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1] - 1e-9);
    expect(seen[0]).toBeLessThan(15);
    expect(Math.abs(seen.at(-1)! - 40)).toBeLessThan(1); // riktningen ökar med 40°
  });
  it('upprätt (beta ≈ 90°) med brus ±3° i gamma (som vrider kameran när telefonen är upprätt) ger högst ca 5° fel', () => {
    const f = new OrientationFilter();
    const base = sample(30, 0, 0, 30);
    run(f, base, 1);
    for (let i = 0; i < 300; i++) f.update(DT, { ...base, beta: 90 + Math.sin(i) * 0.7, gamma: Math.cos(i * 1.3) * 3 });
    expect(err(f, 30)).toBeLessThan(5);
  });
  it('platt med blicken nedåt: yaw följer överkantens riktning och refererar inte till kamerans (vertikala) riktning', () => {
    const f = new OrientationFilter();
    f.update(DT, sample(210, -90, 150, 210));
    const heading = referenceHeading(f.quaternion);
    expect(Math.abs(wrap180(heading - 210))).toBeLessThan(0.5);
  });
});

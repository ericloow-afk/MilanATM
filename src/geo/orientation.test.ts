import { describe, expect, it } from 'vitest';
import {
  deviceQuaternion, eulerFromHeadingPitch, forwardHeading, qAngleBetween, qFromAxisAngle, qMul, qNormalize,
  qSlerp, referenceHeading, rotateVec, topHeading, wrap180, yawQuaternion, type Quat,
} from './orientation';

const close = (a: number, b: number, d = 4) => expect(a).toBeCloseTo(b, d);
const headingDiff = (a: number, b: number) => Math.abs(wrap180(a - b));

describe('wrap180', () => {
  it('wrappar till [-180, 180)', () => {
    expect(wrap180(190)).toBeCloseTo(-170, 9);
    expect(wrap180(-190)).toBeCloseTo(170, 9);
    expect(wrap180(360)).toBeCloseTo(0, 9);
    expect(wrap180(721)).toBeCloseTo(1, 9);
    expect(wrap180(-180)).toBeCloseTo(-180, 9);
  });
});

describe('kvaternion-grunder', () => {
  it('rotateVec: 90° runt Y vrider (0,0,-1) mot väst (-1,0,0)', () => {
    const v = rotateVec(qFromAxisAngle([0, 1, 0], Math.PI / 2), [0, 0, -1]);
    close(v[0], -1); close(v[1], 0); close(v[2], 0);
  });
  it('qMul är inte kommutativ men associativ, och identitet fungerar', () => {
    const a = qFromAxisAngle([1, 0, 0], 0.7);
    const b = qFromAxisAngle([0, 1, 0], 0.4);
    const c = qFromAxisAngle([0, 0, 1], -1.1);
    const ab = qMul(a, b);
    const ba = qMul(b, a);
    expect(Math.abs(ab[0] - ba[0]) + Math.abs(ab[1] - ba[1]) + Math.abs(ab[2] - ba[2])).toBeGreaterThan(1e-3);
    const l = qMul(qMul(a, b), c);
    const r = qMul(a, qMul(b, c));
    l.forEach((x, i) => close(x, r[i], 9));
    qMul([0, 0, 0, 1], a).forEach((x, i) => close(x, a[i], 12));
  });
});

describe('deviceQuaternion – kända poser (alpha-origo = norr)', () => {
  it('upprätt (beta 90°), alpha 0: kameran tittar rakt norrut, vågrätt', () => {
    const q = deviceQuaternion(0, 90, 0, 0);
    const f = rotateVec(q, [0, 0, -1]);
    close(f[0], 0); close(f[1], 0); close(f[2], -1);
    close(forwardHeading(q), 0);
  });
  it('platt (beta 0): kameran tittar rakt ned', () => {
    const f = rotateVec(deviceQuaternion(0, 0, 0, 0), [0, 0, -1]);
    close(f[0], 0); close(f[1], -1); close(f[2], 0);
  });
  it('upprätt: kameraheading = (360 − alpha) mod 360', () => {
    for (const alpha of [0, 30, 90, 180, 270, 359]) {
      expect(headingDiff(forwardHeading(deviceQuaternion(alpha, 90, 0, 0)), 360 - alpha)).toBeLessThan(1e-6);
    }
  });
  it('lutar man uppåt (beta 120°) tittar kameran uppåt 30° utan att ändra riktning', () => {
    const f = rotateVec(deviceQuaternion(40, 120, 0, 0), [0, 0, -1]);
    close(Math.asin(f[1]) * 180 / Math.PI, 30, 3);
    expect(headingDiff(forwardHeading(deviceQuaternion(40, 120, 0, 0)), 320)).toBeLessThan(1e-6);
  });
  it('platt: skärmens överkant pekar åt alpha-riktningen (topHeading)', () => {
    for (const alpha of [0, 90, 200]) {
      expect(headingDiff(topHeading(deviceQuaternion(alpha, 0, 0, 0)), 360 - alpha)).toBeLessThan(1e-6);
    }
  });
  it('skärmvinkeln 90° (landskap) vrider kameran runt sin egen axel: framåtvektorn oförändrad', () => {
    const a = rotateVec(deviceQuaternion(10, 90, 0, 0), [0, 0, -1]);
    const b = rotateVec(deviceQuaternion(10, 90, 0, 90), [0, 0, -1]);
    a.forEach((x, i) => close(x, b[i], 9));
  });
  it('upprätt (beta 90°) är alpha och gamma utbytbara (gimbal-låsning i Euler-vinklarna): heading = 360 − (alpha + gamma)', () => {
    expect(headingDiff(forwardHeading(deviceQuaternion(20, 90, 25, 0)), 360 - 45)).toBeLessThan(1e-6);
    expect(headingDiff(forwardHeading(deviceQuaternion(45, 90, 0, 0)), 360 - 45)).toBeLessThan(1e-6);
  });
});

describe('kontinuitet nära beta = 90° (där Euler-vinklar är instabila)', () => {
  it('små ändringar i in-vinklar ger små kvaternionändringar', () => {
    let prev: Quat | null = null;
    let maxStep = 0;
    for (let beta = 80; beta <= 100; beta += 0.5) {
      const q = deviceQuaternion(40 + (beta - 90) * 0.2, beta, (beta - 90) * 0.5, 0);
      if (prev) maxStep = Math.max(maxStep, qAngleBetween(prev, q));
      prev = q;
    }
    expect(maxStep).toBeLessThan((2 * Math.PI) / 180); // < 2° per 0,5°-steg
  });
});

describe('qSlerp', () => {
  const a = deviceQuaternion(0, 90, 0, 0);
  const b = deviceQuaternion(60, 90, 0, 0);
  it('t=0 ger a, t=1 ger b, t=0,5 ger halvvägs (30° i riktning)', () => {
    qSlerp(a, b, 0).forEach((x, i) => close(x, a[i], 9));
    qSlerp(a, b, 1).forEach((x, i) => close(x, b[i], 9));
    close(qAngleBetween(a, qSlerp(a, b, 0.5)), (30 * Math.PI) / 180, 6);
  });
  it('väljer kortaste väg även om b ges med omvänt tecken', () => {
    const nb: Quat = [-b[0], -b[1], -b[2], -b[3]];
    close(qAngleBetween(a, qSlerp(a, nb, 0.5)), (30 * Math.PI) / 180, 6);
  });
  it('resultatet är normaliserat, även för nästan lika kvaternioner', () => {
    const q = qSlerp(a, qNormalize([a[0] + 1e-9, a[1], a[2], a[3]]), 0.3);
    close(Math.hypot(...q), 1, 12);
  });
});

describe('yawQuaternion', () => {
  it('lägger +δ grader till kameraheading', () => {
    const q = deviceQuaternion(100, 90, 0, 0); // heading 260
    expect(headingDiff(forwardHeading(qMul(yawQuaternion(30), q)), 290)).toBeLessThan(1e-6);
    expect(headingDiff(forwardHeading(qMul(yawQuaternion(-30), q)), 230)).toBeLessThan(1e-6);
  });
});

describe('referenceHeading (kompassens referens)', () => {
  it('upprätt: kamerans riktning', () => {
    expect(headingDiff(referenceHeading(deviceQuaternion(70, 90, 0, 0)), 290)).toBeLessThan(1e-6);
  });
  it('platt: överkantens riktning', () => {
    expect(headingDiff(referenceHeading(deviceQuaternion(70, 0, 0, 0)), 290)).toBeLessThan(1e-6);
  });
  it('är kontinuerlig när man lutar från upprätt till platt (ingen hopp > 1°)', () => {
    let prev = referenceHeading(deviceQuaternion(70, 90, 0, 0));
    for (let beta = 90; beta >= 0; beta -= 1) {
      const h = referenceHeading(deviceQuaternion(70, beta, 0, 0));
      expect(headingDiff(h, prev)).toBeLessThan(1);
      expect(headingDiff(h, 290)).toBeLessThan(1e-6);
      prev = h;
    }
  });
});

describe('eulerFromHeadingPitch (simulatorn)', () => {
  it('återskapar önskad riktning (relativt alpha-origo) och lutning', () => {
    for (const [h, p, o] of [[0, 0, 0], [90, 20, 0], [250, -45, 130], [10, -90, 77]] as const) {
      const { alpha, beta, gamma } = eulerFromHeadingPitch(h, p, o);
      const q = deviceQuaternion(alpha, beta, gamma, 0);
      const f = rotateVec(q, [0, 0, -1]);
      close(Math.asin(Math.max(-1, Math.min(1, f[1]))) * 180 / Math.PI, p, 2);
      expect(headingDiff(referenceHeading(q), h - o)).toBeLessThan(1e-3);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { deviceQuaternion, eulerFromHeadingPitch, rotateVec, type Quat } from '../geo/orientation';
import { aimHint, shouldShowAim } from './aim';
import { AR_CONFIG } from './config';

/** Målets riktning i kameraramen (x höger, y upp, z bakåt) för en världspunkt (öst, upp, −norr). */
function inCamera(q: Quat, world: [number, number, number]): [number, number, number] {
  const inv: Quat = [-q[0], -q[1], -q[2], q[3]];
  return rotateVec(inv, world);
}

describe('aimHint', () => {
  it('tåg under bilden: "Rikta telefonen nedåt", pilen pekar nedåt', () => {
    const h = aimHint(0.1, -2.5, false);
    expect(h.kind).toBe('down');
    expect(h.text).toBe('Rikta telefonen nedåt');
    expect(h.angleRad).toBeGreaterThan(1.2);
    expect(h.angleRad).toBeLessThan(1.9);
  });
  it('vänster, höger och uppåt', () => {
    expect(aimHint(-3, 0.5, false).kind).toBe('left');
    expect(aimHint(3, -0.5, false).kind).toBe('right');
    expect(aimHint(0.2, 2, false).kind).toBe('up');
  });
  it('bakom: "Tåget är bakom dig", men nedåt om det mest ligger under', () => {
    expect(aimHint(-0.8, 0.1, true).kind).toBe('behind');
    expect(aimHint(0.1, -1, true).kind).toBe('down');
  });
  it('fältfallet: upprätt telefon, tåg 15 m under och 20 m framför syns inte men ska ge "nedåt"', () => {
    // telefonen upprätt (beta 90°) mot norr; tåget 20 m norrut, 15 m under marken (kameran 1,6 m över)
    const { alpha, beta, gamma } = eulerFromHeadingPitch(0, 0, 0);
    const q = deviceQuaternion(alpha, beta, gamma, 0);
    const c = inCamera(q, [0, -15 - 1.6, -20]);
    // elevation −40° ligger utanför halva synfältet (32°), alltså inte i bild
    const elev = (Math.atan2(c[1], -c[2]) * 180) / Math.PI;
    expect(elev).toBeLessThan(-AR_CONFIG.fovVerticalDeg / 2);
    expect(aimHint(c[0] / -c[2], c[1] / -c[2], c[2] > 0).kind).toBe('down');
  });
  it('raden visas bara när tåg finns men inget syns, och orienteringen fungerar', () => {
    expect(shouldShowAim(2, 0, true)).toBe(true);
    expect(shouldShowAim(2, 1, true)).toBe(false);
    expect(shouldShowAim(0, 0, true)).toBe(false);
    expect(shouldShowAim(2, 0, false)).toBe(false);
  });
});

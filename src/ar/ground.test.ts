/** Rutnätets utfasning (Del 5): avstånd till spåret → alfa, avstånd från kameran → alfa, när det ritas alls. */
import { describe, expect, it } from 'vitest';
import metro from '../../public/metro.json';
import type { MetroData } from '../engine/types';
import {
  buildGridSegments,
  cameraFade,
  distToTracks,
  GROUND,
  gridOpacity,
  gridVisible,
  localTracks,
  MAX_OVERLAY_OPACITY,
  trackFade,
  type LocalTrack,
} from './ground';

const data = metro as unknown as MetroData;
/** rakt spår längs z-axeln (nord–syd) genom origo */
const straight: LocalTrack[] = [{ line: 'M9', pts: [[0, -200], [0, 200]] }];

describe('trackFade: avstånd till spåret → alfa', () => {
  it('1 på spåret, avtagande, 0 vid 30 m och utanför', () => {
    expect(trackFade(0)).toBe(1);
    expect(trackFade(10)).toBeGreaterThan(trackFade(20));
    expect(trackFade(15)).toBeCloseTo(0.5, 6);
    expect(trackFade(30)).toBe(0);
    expect(trackFade(80)).toBe(0);
  });
});

describe('cameraFade: avstånd från kameran → alfa', () => {
  it('1 nära kameran, tonar 40–80 m, 0 från 80 m (aldrig vid horisonten)', () => {
    expect(cameraFade(0)).toBe(1);
    expect(cameraFade(40)).toBe(1);
    expect(cameraFade(60)).toBeCloseTo(0.5, 6);
    expect(cameraFade(80)).toBe(0);
    expect(cameraFade(500)).toBe(0);
  });
});

describe('opacitet och när rutnätet ritas', () => {
  it('av/svagt/normalt, aldrig över 0,25', () => {
    expect(gridOpacity('off')).toBe(0);
    expect(gridOpacity('weak')).toBeGreaterThan(0);
    expect(gridOpacity('weak')).toBeLessThan(gridOpacity('normal'));
    expect(gridOpacity('normal')).toBe(MAX_OVERLAY_OPACITY);
    expect(MAX_OVERLAY_OPACITY).toBeLessThanOrEqual(0.25);
  });
  it('inget rutnät utan tåg inom radien, utan användbar fix, eller när det är avstängt', () => {
    expect(gridVisible({ level: 'normal', platform: false, nearbyCount: 2, gpsAccuracy: 10 })).toBe(true);
    expect(gridVisible({ level: 'normal', platform: false, nearbyCount: 0, gpsAccuracy: 10 })).toBe(false);
    expect(gridVisible({ level: 'normal', platform: false, nearbyCount: 2, gpsAccuracy: 1414 })).toBe(false);
    expect(gridVisible({ level: 'normal', platform: false, nearbyCount: 2, gpsAccuracy: null })).toBe(false);
    expect(gridVisible({ level: 'off', platform: false, nearbyCount: 2, gpsAccuracy: 10 })).toBe(false);
  });
  it('perrongläget: på golvet när det är påslaget, även utan GPS och utan tåg', () => {
    expect(gridVisible({ level: 'weak', platform: true, nearbyCount: 0, gpsAccuracy: 1414 })).toBe(true);
    expect(gridVisible({ level: 'off', platform: true, nearbyCount: 3, gpsAccuracy: null })).toBe(false);
  });
});

describe('rutnätsbandet runt spåret', () => {
  const g = buildGridSegments(straight, -16);
  const pts = Array.from({ length: g.count }, (_, i) => ({ x: g.positions[i * 3], y: g.positions[i * 3 + 1], z: g.positions[i * 3 + 2], a: g.alphas[i] }));

  it('bara inom ca 30 m från spåret; resten av marken är fri', () => {
    expect(g.count).toBeGreaterThan(0);
    // ett stycke får sticka ut högst en ruta utanför bandet (dess andra punkt är innanför)
    expect(Math.max(...pts.map((p) => Math.abs(p.x)))).toBeLessThanOrEqual(GROUND.bandHalfWidthM + GROUND.cellM);
    for (const p of pts) if (Math.abs(p.x) >= GROUND.bandHalfWidthM) expect(p.a).toBeLessThan(0.01);
  });
  it('aldrig synligt längre än 80 m från kameran', () => {
    for (const p of pts) if (Math.hypot(p.x, p.z) >= GROUND.fadeEndM) expect(p.a).toBeLessThan(0.01);
    expect(Math.max(...pts.map((p) => Math.hypot(p.x, p.z)))).toBeLessThanOrEqual(GROUND.fadeEndM + GROUND.cellM * 1.5);
  });
  it('starkast på spåret nära kameran, och i angiven höjd', () => {
    const onTrack = pts.filter((p) => p.x === 0 && Math.abs(p.z) <= 10);
    expect(Math.max(...onTrack.map((p) => p.a))).toBeCloseTo(1, 6);
    expect(pts.every((p) => p.y === -16)).toBe(true);
  });
  it('utan spår i närheten: inget rutnät alls', () => {
    expect(buildGridSegments([{ line: 'M9', pts: [[500, -200], [500, 200]] }], 0).count).toBe(0);
    expect(buildGridSegments([], 0).count).toBe(0);
  });
});

describe('spåren nära en plats (ur metro.json)', () => {
  it('Dergano: M3 går rakt igenom, i ungefär 334°/154°', () => {
    const t = localTracks(data, { lat: 45.505537, lon: 9.179603 });
    const m3 = t.filter((x) => x.line === 'M3');
    expect(m3.length).toBeGreaterThan(0);
    expect(distToTracks(0, 0, m3)).toBeLessThan(10);
    // långt från spåret vinkelrätt (öst-nordost) är det långt till spåret
    expect(distToTracks(60, -30, m3)).toBeGreaterThan(30);
  });
  it('en plats långt från metron: inga spår', () => {
    expect(localTracks(data, { lat: 45.6, lon: 9.4 })).toEqual([]);
  });
});

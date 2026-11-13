/** Perrongläget: station och riktning, spårets bäring, "Rikta längs spåret" (offset), djup och nästa tåg. */
import { describe, expect, it } from 'vitest';
import metro from '../../public/metro.json';
import type { MetroData } from '../engine/types';
import { eulerFromHeadingPitch, forwardHeading, wrap180 } from '../geo/orientation';
import { OrientationFilter } from './filter';
import { PLATFORM } from './config';
import { EYE_HEIGHT_M } from './scene';
import {
  allStations,
  approachBearingAt,
  makeStationMode,
  nearestStations,
  nextTrainText,
  platformDirections,
  searchStations,
  SIM_PLATFORMS,
  travelBearingAt,
} from './station';

const data = metro as unknown as MetroData;
const angle = (a: number, b: number) => Math.abs(wrap180(a - b));

describe('stationsväljaren', () => {
  it('alla stationer med linjer; bytesstationer har ett stop_id per linje', () => {
    const all = allStations(data);
    expect(all.length).toBeGreaterThan(100);
    const duomo = all.filter((s) => s.name === 'Duomo');
    expect(duomo.map((s) => s.lines.join())).toEqual(['M1', 'M3']);
  });
  it('sökning tål skiftläge, accenter och ordens början', () => {
    expect(searchStations(data, 'macia').map((s) => s.stopId)).toEqual(['MACIACHINI']);
    expect(searchStations(data, 'DUOMO').length).toBe(2);
    expect(searchStations(data, 'garib').some((s) => s.stopId === 'GARIBALDI FS')).toBe(true);
    expect(searchStations(data, 'sesto maggio').some((s) => s.name.startsWith('Sesto 1 Maggio'))).toBe(true);
    expect(searchStations(data, 'xyzzy')).toEqual([]);
  });
  it('närmaste stationer från en position, närmast först, högst 1 km bort', () => {
    const n = nearestStations(data, 45.5055, 9.1797);
    expect(n[0].stopId).toBe('DERGANO');
    expect(n.every((s) => s.distM <= 1000)).toBe(true);
    expect(nearestStations(data, 45.7, 9.5)).toEqual([]);
  });
});

describe('riktningar vid en perrong', () => {
  it('Maciachini: M3 mot Comasina (från Zara) och mot San Donato (från Dergano)', () => {
    const d = platformDirections(data, 'MACIACHINI');
    expect(d.map((x) => `${x.line} ${x.terminusName} från ${x.fromName}`)).toEqual(['M3 Comasina från Zara', 'M3 San Donato från Dergano']);
  });
  it('ändstationen visar bara riktningen därifrån', () => {
    const d = platformDirections(data, 'COMASINA');
    expect(d.map((x) => x.terminusName)).toEqual(['San Donato']);
    expect(d[0].fromName).toBeNull();
  });
  it('simulatorns förinställda perronger finns', () => {
    for (const p of SIM_PLATFORMS) expect(makeStationMode(data, p.stopId, p.direction), `${p.stopId} ${p.direction}`).not.toBeNull();
  });
});

describe('spårets bäring vid stationen (mot fältmätningen 334°/154°)', () => {
  it('Maciachini mot Comasina: färdriktning ca 333°, tågen kommer från ca 153° (Zara-hållet)', () => {
    const d = platformDirections(data, 'MACIACHINI').find((x) => x.terminusName === 'Comasina')!;
    expect(angle(travelBearingAt(data, d.pattern, d.stopIndex), 333)).toBeLessThan(2);
    expect(angle(approachBearingAt(data, d.pattern, d.stopIndex), 153)).toBeLessThan(2);
  });
  it('Dergano mot San Donato: färdriktning ca 154°, tågen kommer från ca 334°', () => {
    const m = makeStationMode(data, 'DERGANO', 'M3>SAN DONATO')!;
    expect(angle(m.approachDeg, 334)).toBeLessThan(2);
    expect(m.aligned).toBe(false);
    expect([m.lat, m.lon]).toEqual([45.505537, 9.179603]);
  });
});

describe('"Rikta längs spåret" (gyro, ingen kompass)', () => {
  const sample = (heading: number, pitch: number, origin: number, compass: number | null) => {
    const { alpha, beta, gamma } = eulerFromHeadingPitch(heading, pitch, origin);
    return { alpha, beta, gamma, screenAngle: 0, compass, compassAccuracy: 10 };
  };
  it('kamerans riktning blir spårets bäring oavsett alpha-origo, och följer sedan gyrot', () => {
    for (const origin of [0, 137, 290]) {
      const f = new OrientationFilter();
      f.setCompassEnabled(false);
      for (let i = 0; i < 30; i++) f.update(1 / 30, sample(200, -10, origin, null));
      expect(f.alignForward(153)).toBe(true);
      expect(angle(forwardHeading(f.quaternion), 153)).toBeLessThan(0.5);
      // vrid 40° åt höger: vyn vrider lika mycket
      for (let i = 0; i < 60; i++) f.update(1 / 30, sample(240, -10, origin, null));
      expect(angle(forwardHeading(f.quaternion), 193)).toBeLessThan(0.5);
    }
  });
  it('kompassen påverkar inte vyn i perrongläget, även om den visar något helt annat', () => {
    const f = new OrientationFilter();
    f.setCompassEnabled(false);
    for (let i = 0; i < 30; i++) f.update(1 / 30, sample(10, 0, 50, 10));
    f.alignForward(153);
    for (let i = 0; i < 300; i++) f.update(1 / 30, sample(10, 0, 50, 10)); // 10 s med kompass 10°
    expect(angle(forwardHeading(f.quaternion), 153)).toBeLessThan(0.5);
    expect(f.compassState).toBe('disabled');
  });
  it('vägrar rikta när kameran tittar brant nedåt (riktningen är då inte väldefinierad)', () => {
    const f = new OrientationFilter();
    for (let i = 0; i < 30; i++) f.update(1 / 30, sample(10, -75, 50, null));
    expect(f.alignForward(153)).toBe(false);
  });
  it('kompassen tillbaka: snappar till kompassen igen', () => {
    const f = new OrientationFilter();
    f.setCompassEnabled(false);
    for (let i = 0; i < 30; i++) f.update(1 / 30, sample(80, 0, 50, 80));
    f.alignForward(153);
    f.setCompassEnabled(true);
    f.update(1 / 30, sample(80, 0, 50, 80));
    expect(angle(forwardHeading(f.quaternion), 80)).toBeLessThan(1);
  });
});

describe('djup i perrongläget', () => {
  it('tåget ritas nära ögonhöjd (0–1,5 m under), märkt som uppskattning', () => {
    expect(PLATFORM.estimate).toBe(true);
    expect(PLATFORM.relativeDepthM).toBeGreaterThanOrEqual(0);
    expect(PLATFORM.relativeDepthM).toBeLessThanOrEqual(1.5);
    expect(PLATFORM.eyeHeightM).toBe(EYE_HEIGHT_M);
  });
});

describe('nästa tåg', () => {
  const now = Date.UTC(2026, 10, 13, 17, 30);
  it('mm:ss, vid perrongen, eller inget', () => {
    expect(nextTrainText({ etaMs: now + 134_000, atStation: false }, now)).toBe('Nästa tåg om 02:14');
    expect(nextTrainText({ etaMs: now - 5000, atStation: true }, now)).toBe('Tåget står vid perrongen');
    expect(nextTrainText(null, now)).toBe('Inget tåg de närmaste 30 min');
  });
});

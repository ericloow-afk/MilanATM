import { describe, expect, it } from 'vitest';
import { MapClock } from './clock';

describe('MapClock', () => {
  it('är live från start: tiden är väggklockan', () => {
    const c = new MapClock(1000);
    expect(c.isLive).toBe(true);
    expect(c.nowMs(5000)).toBe(5000);
    expect(c.scale).toBe(1);
  });
  it('×10: tiden går tio gånger snabbare utan hopp vid bytet', () => {
    const c = new MapClock(0);
    c.setScale(10, 1000); // klockan visar 1000 vid växlingen
    expect(c.isLive).toBe(false);
    expect(c.nowMs(1000)).toBe(1000);
    expect(c.nowMs(3000)).toBe(1000 + 20_000);
  });
  it('×1 i live-läge ändrar ingenting', () => {
    const c = new MapClock(0);
    c.setScale(1, 500);
    expect(c.isLive).toBe(true);
  });
  it('paus fryser tiden, resume fortsätter därifrån i ×1', () => {
    const c = new MapClock(0);
    c.pause(2000);
    expect(c.paused).toBe(true);
    expect(c.nowMs(9000)).toBe(2000);
    c.resume(9000);
    expect(c.paused).toBe(false);
    expect(c.isLive).toBe(false);
    expect(c.nowMs(10_000)).toBe(3000);
  });
  it('setTime hoppar till en viss tid och fortsätter i nuvarande hastighet', () => {
    const c = new MapClock(0);
    c.setScale(60, 0);
    c.setTime(new Date(100_000), 5000);
    expect(c.nowMs(5000)).toBe(100_000);
    expect(c.nowMs(6000)).toBe(100_000 + 60_000);
  });
  it('setTime från live eller paus går i ×1', () => {
    const c = new MapClock(0);
    c.setTime(new Date(50_000), 1000);
    expect(c.scale).toBe(1);
    expect(c.isLive).toBe(false);
    expect(c.nowMs(3000)).toBe(52_000);
    c.pause(3000);
    c.setTime(new Date(10_000), 4000);
    expect(c.scale).toBe(1);
  });
  it('goLive återgår till väggklockan', () => {
    const c = new MapClock(0);
    c.setScale(60, 100);
    c.goLive(7000);
    expect(c.isLive).toBe(true);
    expect(c.nowMs(8000)).toBe(8000);
  });
});

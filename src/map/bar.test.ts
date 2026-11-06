import { describe, expect, it } from 'vitest';
import { clockNote, clockText, statusOf } from './bar';
import type { Validity } from './schedule';

const ok = (daysLeft: number): Validity => ({ status: 'ok', from: '2026-10-26', to: '2026-11-30', daysLeft });

describe('statusOf', () => {
  it('giltig med dagar kvar, varning sista veckan, fel när utgången eller ej börjat', () => {
    expect(statusOf(ok(24))).toEqual({ cls: '', text: 'giltig, 24 dagar kvar' });
    expect(statusOf(ok(7))).toEqual({ cls: 'warn', text: 'går ut om 7 dagar' });
    expect(statusOf(ok(1))).toEqual({ cls: 'warn', text: 'går ut om 1 dag' });
    expect(statusOf(ok(0))).toEqual({ cls: 'warn', text: 'går ut idag' });
    expect(statusOf({ status: 'expired', from: 'a', to: 'b', daysLeft: -2 })).toEqual({ cls: 'bad', text: 'har gått ut' });
    expect(statusOf({ status: 'notYetValid', from: 'a', to: 'b', daysLeft: 40 })).toEqual({ cls: 'bad', text: 'gäller inte än' });
  });
  it('texten säger aldrig "LIVE" eller "t.o.m."', () => {
    const all = [ok(24), ok(3), ok(0)].map((v) => statusOf(v).text).join(' ');
    expect(all).not.toMatch(/LIVE|t\.o\.m\./i);
  });
});

describe('klocktext', () => {
  const sec = 22 * 3600 + 18 * 60 + 58;
  it('HH:MM i vanligt läge, sekunder bara när klockan är spolad eller pausad', () => {
    expect(clockText(sec, { isLive: true, paused: false, scale: 1 })).toBe('22:18');
    expect(clockText(sec, { isLive: false, paused: false, scale: 10 })).toBe('22:18:58');
    expect(clockText(sec, { isLive: false, paused: true, scale: 0 })).toBe('22:18:58');
  });
  it('kort tillägg bara när klockan inte visar riktig tid', () => {
    expect(clockNote({ isLive: true, paused: false, scale: 1 })).toBe('');
    expect(clockNote({ isLive: false, paused: true, scale: 0 })).toBe('pausad');
    expect(clockNote({ isLive: false, paused: false, scale: 60 })).toBe('spolad ×60');
    expect(clockNote({ isLive: false, paused: false, scale: 1 })).toBe('spolad');
  });
});

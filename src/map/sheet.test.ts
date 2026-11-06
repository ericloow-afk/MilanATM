import { describe, expect, it } from 'vitest';
import { sheetHeights, snapState } from './sheet';

const h = sheetHeights(800, 34);

describe('sheetHeights', () => {
  it('peek inkluderar safe area; half = 44 %, full = 70 % av höjden', () => {
    expect(h.peek).toBe(154);
    expect(h.half).toBe(352);
    expect(h.full).toBe(560);
  });
});

describe('snapState', () => {
  it('snäpper till närmaste läge utan hastighet', () => {
    expect(snapState(170, 0, h)).toBe('peek');
    expect(snapState(300, 0, h)).toBe('half');
    expect(snapState(500, 0, h)).toBe('full');
  });
  it('snabb uppsvepning (negativ hastighet = uppåt) når ett högre läge än positionen ensam', () => {
    expect(snapState(260, 0, h)).toBe('half'); // 260 är närmast half (352)
    expect(snapState(260, -1.2, h)).toBe('full'); // projicerat 260 + 216 = 476, närmare full (560) än half (352)
  });
  it('snabb nedsvepning från half går till peek', () => {
    expect(snapState(352, 1.5, h)).toBe('peek');
  });
});

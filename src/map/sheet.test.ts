import { describe, expect, it } from 'vitest';
import { bottomOverlap, PEEK_CONTENT_PX, sheetHeights, snapState } from './sheet';

const h = sheetHeights(800, 34);

describe('sheetHeights', () => {
  it('peek = handtag + rubrikrad + nedre inset; half/full = 44 %/70 % av synlig höjd + inset', () => {
    expect(PEEK_CONTENT_PX).toBe(96);
    expect(h.peek).toBe(130);
    expect(h.half).toBe(386);
    expect(h.full).toBe(594);
  });
  it('inset (safe area + verktygsfält) läggs på alla lägen, så innehållet aldrig hamnar bakom fältet', () => {
    const a = sheetHeights(700, 0);
    const b = sheetHeights(700, 80);
    expect(b.peek - a.peek).toBe(80);
    expect(b.half - a.half).toBe(80);
    expect(b.full - a.full).toBe(80);
  });
});

describe('bottomOverlap', () => {
  it('0 när den synliga ytan täcker hela layoutviewporten', () => {
    expect(bottomOverlap(800, 800, 0)).toBe(0);
  });
  it('det som döljs nedtill (t.ex. Safaris verktygsfält eller tangentbord)', () => {
    expect(bottomOverlap(800, 720, 0)).toBe(80);
    expect(bottomOverlap(800, 700, 20)).toBe(80);
  });
  it('aldrig negativt', () => {
    expect(bottomOverlap(700, 800, 0)).toBe(0);
  });
});

describe('snapState', () => {
  it('snäpper till närmaste läge utan hastighet', () => {
    expect(snapState(170, 0, h)).toBe('peek');
    expect(snapState(300, 0, h)).toBe('half');
    expect(snapState(520, 0, h)).toBe('full');
  });
  it('snabb uppsvepning (negativ hastighet = uppåt) når ett högre läge än positionen ensam', () => {
    expect(snapState(260, 0, h)).toBe('half'); // närmast half (386)
    expect(snapState(260, -1.6, h)).toBe('full'); // projicerat 260 + 288 = 548, närmast full (594)
  });
  it('snabb nedsvepning från half går till peek', () => {
    expect(snapState(386, 1.5, h)).toBe('peek');
  });
});

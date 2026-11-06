import { describe, expect, it } from 'vitest';
import tokens from './tokens.css?raw';
import { lineBadge, lineLabel } from '../ui/line-badge';

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
/** Värdet för en token i första (mörka) :root-blocket respektive i ljus-blocket. */
const dark = tokens.split('@media (prefers-color-scheme: light)')[0];
const light = tokens.split('@media (prefers-color-scheme: light)')[1].split('@media (prefers-reduced-motion')[0];
const tok = (src: string, name: string) => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(src);
  if (!m) throw new Error(`token --${name} saknas`);
  return m[1];
};

describe('linjefärger (visningsfärger)', () => {
  const lines = ['m1', 'm2', 'm3', 'm4', 'm5'];
  it('svart brickatext har minst 4,5:1 mot varje linjefärg', () => {
    const ink = tok(dark, 'line-ink');
    for (const l of lines) expect(contrast(tok(dark, `line-${l}`), ink), l).toBeGreaterThanOrEqual(4.5);
  });
  it('varje linjefärg har minst 3:1 mot den mörka kartbakgrunden', () => {
    for (const l of lines) expect(contrast(tok(dark, `line-${l}`), tok(dark, 'map-land')), l).toBeGreaterThanOrEqual(3);
  });
  it('M4 är ljusnad (≥ 3:1) men har behållit blå nyans; övriga är GTFS-färgen', () => {
    expect(tok(dark, 'line-m4')).not.toBe('#0000ee');
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(tok(dark, 'line-m4').slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
    expect(tok(dark, 'line-m1')).toBe('#ff0000');
    expect(tok(dark, 'line-m2')).toBe('#73ff01');
    expect(tok(dark, 'line-m3')).toBe('#fcff01');
    expect(tok(dark, 'line-m5')).toBe('#c876b1');
  });
});

describe('textkontrast', () => {
  it('text och dämpad text har minst 4,5:1 mot ytorna (mörkt)', () => {
    for (const s of ['bg', 'surface-1', 'surface-2']) {
      expect(contrast(tok(dark, 'text'), tok(dark, s))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tok(dark, 'text-muted'), tok(dark, s))).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('text och dämpad text har minst 4,5:1 mot ytorna (ljust)', () => {
    for (const s of ['bg', 'surface-1', 'surface-2']) {
      expect(contrast(tok(light, 'text'), tok(light, s))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tok(light, 'text-muted'), tok(light, s))).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('ortnamn på kartan är dämpade men stationsnamn är tydligare (högre kontrast)', () => {
    expect(contrast(tok(dark, 'map-station-label'), tok(dark, 'map-land'))).toBeGreaterThan(contrast(tok(dark, 'map-place'), tok(dark, 'map-land')) * 2);
    expect(contrast(tok(light, 'map-station-label'), tok(light, 'map-land'))).toBeGreaterThan(contrast(tok(light, 'map-place'), tok(light, 'map-land')) * 1.8);
  });
  it('accenttext på knapp har minst 4,5:1', () => {
    expect(contrast(tok(dark, 'text-on-accent'), tok(dark, 'accent'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tok(light, 'text-on-accent'), tok(light, 'accent'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('formspråk', () => {
  it('inga glas/blur, glöd, gradienter eller pillerformer i tokens', () => {
    expect(tokens).not.toMatch(/backdrop-filter|blur\(|radial-gradient|linear-gradient|radius-pill|marble-veil/);
  });
  it('radierna är 6–10 px', () => {
    for (const r of ['radius-sm', 'radius-md', 'radius-lg']) {
      const px = Number(new RegExp(`--${r}:\\s*(\\d+)px`).exec(dark)![1]);
      expect(px).toBeGreaterThanOrEqual(6);
      expect(px).toBeLessThanOrEqual(10);
    }
  });
  it('valt tåg markeras med vit ring utan glöd', () => {
    expect(dark).toMatch(/--select-ring:\s*0 0 0 2px #ffffff, 0 0 0 3px #0b0d10;/);
  });
});

describe('LineBadge', () => {
  it('ger kvadratisk bricka med klass per linje, storlek och tillgänglig etikett', () => {
    const h = lineBadge('M3', 'M3', 'sm');
    expect(h).toContain('class="lb lb-sm l-M3"');
    expect(h).toContain('aria-label="Linje M3"');
    expect(h).toContain('>M3<');
    expect(lineBadge('M1', 'M1')).toContain('lb-md');
  });
  it('lineLabel bygger "M" + kortnamn och escapar skadlig text', () => {
    expect(lineLabel('M2', '2')).toBe('M2');
    expect(lineLabel('M5')).toBe('M5');
    expect(lineBadge('M1', '<b>')).not.toContain('<b>');
  });
});

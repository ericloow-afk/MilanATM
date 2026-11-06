import { describe, expect, it } from 'vitest';
import { haversine } from '../geo';
import { shapeIndex } from '../geo';
import { makeData, S_ALT, S_BENT, S_EAST } from '../engine/testdata';
import type { MetroData } from '../engine/types';
import { circlePolygon, lineColorExpression, lineCollection, stationCollection } from './geojson';

const e = shapeIndex(S_EAST), b = shapeIndex(S_BENT), a = shapeIndex(S_ALT);
const data = makeData({ east: [0, e.cum[1], e.cum[2]], bent: [0, b.length], alt: [0, a.cum[2], a.cum[4]] });

describe('lineCollection', () => {
  it('en LineString per unik linje+shape, med [lon, lat] och coarse-flagga', () => {
    const fc = lineCollection(data);
    expect(fc.features.length).toBe(3); // S_EAST (två mönster, en gång), S_BENT, S_ALT
    const bent = fc.features.find((f) => f.properties.shape === 'S_BENT')!;
    expect(bent.properties.coarse).toBe(true);
    expect((bent.geometry as { coordinates: number[][] }).coordinates[0]).toEqual([9.1, 45.4]);
    expect(fc.features.find((f) => f.properties.shape === 'S_EAST')!.properties.coarse).toBe(false);
  });
});

describe('stationCollection', () => {
  it('alla stationer med visningsnamn, linje och Point [lon, lat]', () => {
    const fc = stationCollection(data);
    expect(fc.features.length).toBe(4);
    const a = fc.features.find((f) => f.properties.id === 'A')!;
    expect(a.properties).toMatchObject({ name: 'A', line: 'M9', lines: 'M9', multi: false });
    expect((a.geometry as { coordinates: number[] }).coordinates).toEqual([9.1, 45.4]);
  });
  it('markerar bytesstation när flera linjer delar samma stop_id', () => {
    const two: MetroData = {
      ...data,
      lines: [...data.lines, { id: 'M8', name: '8', color: '#00ff00' }],
      patterns: [...data.patterns, { ...data.patterns[0], line: 'M8' }],
    };
    const b = stationCollection(two).features.find((f) => f.properties.id === 'B')!;
    expect(b.properties.multi).toBe(true);
    expect(b.properties.lines).toBe('M8,M9');
  });
});

describe('lineColorExpression', () => {
  it('match-uttryck med linjens färg och vit reserv', () => {
    expect(lineColorExpression(data)).toEqual(['match', ['get', 'line'], 'M9', '#123456', '#ffffff']);
  });
});

describe('circlePolygon', () => {
  it('sluten ring där alla punkter ligger på radien', () => {
    const poly = circlePolygon(45.4, 9.1, 50, 24);
    const ring = poly.coordinates[0];
    expect(ring[0]).toEqual(ring.at(-1));
    for (const [lon, lat] of ring) expect(Math.abs(haversine(45.4, 9.1, lat, lon) - 50)).toBeLessThan(0.5);
  });
});

const real = Object.values(import.meta.glob('../../public/metro.json', { eager: true, import: 'default' }))[0] as MetroData | undefined;
describe.skipIf(!real)('verklig metro.json', () => {
  it('33 linjegeometrier, 130 stationer och bytesstationer markerade (ZARA, GARIBALDI FS, CENTRALE FS, SAN BABILA)', () => {
    expect(lineCollection(real!).features.length).toBe(33);
    const st = stationCollection(real!);
    expect(st.features.length).toBe(130);
    const multi = st.features.filter((f) => f.properties.multi).map((f) => f.properties.id).sort();
    expect(multi).toEqual(['CENTRALE FS', 'GARIBALDI FS', 'SAN BABILA', 'ZARA']);
  });
});

/** GeoJSON för kartlager: linjer (en per unik shape) och stationer. Ren TS. */
import type { MetroData } from '../engine/types';

export interface LineProps {
  line: string;
  shape: string;
  coarse: boolean;
}
export interface StationProps {
  id: string;
  name: string;
  /** linjer som trafikerar stationen, t.ex. "M2,M3" */
  lines: string;
  /** en linje (för färg) */
  line: string;
  /** bytesstation (flera linjer med samma stop_id) */
  multi: boolean;
}

type FC<P> = { type: 'FeatureCollection'; features: { type: 'Feature'; properties: P; geometry: unknown }[] };

export function lineCollection(data: MetroData): FC<LineProps> {
  const seen = new Set<string>();
  const features: FC<LineProps>['features'] = [];
  for (const p of data.patterns) {
    const key = `${p.line}|${p.shape}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pts = data.shapeGeoms[data.shapes[p.shape]];
    features.push({
      type: 'Feature',
      properties: { line: p.line, shape: p.shape, coarse: p.shapeQuality === 'coarse' },
      geometry: { type: 'LineString', coordinates: pts.map(([lat, lon]) => [lon, lat]) },
    });
  }
  return { type: 'FeatureCollection', features };
}

export function stationCollection(data: MetroData): FC<StationProps> {
  const linesOf = new Map<number, string[]>();
  for (const p of data.patterns) {
    for (const si of p.stops) {
      const l = linesOf.get(si) ?? [];
      if (!l.includes(p.line)) l.push(p.line);
      linesOf.set(si, l);
    }
  }
  const features = data.stops.map((s, i): FC<StationProps>['features'][number] => {
    const lines = (linesOf.get(i) ?? []).sort();
    return {
      type: 'Feature',
      properties: { id: s.id, name: s.name, lines: lines.join(','), line: lines[0] ?? '', multi: lines.length > 1 },
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
    };
  });
  return { type: 'FeatureCollection', features };
}

/** MapLibre-uttryck som ger linjens färg ur ett egenskapsfält (default vit). */
export function lineColorExpression(data: MetroData, prop = 'line'): unknown[] {
  const expr: unknown[] = ['match', ['get', prop]];
  for (const l of data.lines) expr.push(l.id, l.color ?? '#ffffff');
  expr.push('#ffffff');
  return expr;
}

/** Cirkelpolygon (meter) runt en punkt, för GPS-noggrannhet. */
export function circlePolygon(lat: number, lon: number, radiusM: number, steps = 48): { type: 'Polygon'; coordinates: number[][][] } {
  const ring: number[][] = [];
  const dLat = radiusM / 111194.9;
  const dLon = radiusM / (111194.9 * Math.cos((lat * Math.PI) / 180));
  for (let k = 0; k <= steps; k++) {
    const a = (k / steps) * 2 * Math.PI;
    ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

/** Kartlager för metrolinjer, stationer och användarens position. Läggs till efter varje (om)laddning av stilen. */
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import type { MetroData } from '../engine/types';
import { circlePolygon, lineColorExpression, lineCollection, stationCollection } from './geojson';
import { readMapPalette } from './style';

const cssVar = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export interface UserFix {
  lat: number;
  lon: number;
  accuracy: number;
}

let lastUser: UserFix | null = null;

export function addOverlays(map: MlMap, data: MetroData): void {
  if (map.getSource('metro-lines')) return; // redan tillagda för den här stilen
  const p = readMapPalette();
  const color = lineColorExpression(data, 'line') as never;
  const halo = cssVar('--line-halo', '#0b0d10');
  const accent = cssVar('--accent', '#3dd6c6');

  map.addSource('metro-lines', { type: 'geojson', data: lineCollection(data) as never });
  map.addSource('metro-stations', { type: 'geojson', data: stationCollection(data) as never });
  map.addSource('user-accuracy', { type: 'geojson', data: emptyFC() as never });
  map.addSource('user-dot', { type: 'geojson', data: emptyFC() as never });

  const lineW = (a: number, b: number, c: number) => ['interpolate', ['linear'], ['zoom'], 9, a, 13, b, 16, c] as never;
  map.addLayer({
    id: 'lines-casing', type: 'line', source: 'metro-lines',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': halo, 'line-width': lineW(3.4, 6.6, 12.5) },
  });
  map.addLayer({
    id: 'lines', type: 'line', source: 'metro-lines', filter: ['!', ['get', 'coarse']] as never,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': lineW(1.7, 3.8, 7.2) },
  });
  // Grov spårgeometri ritas streckad: ärligt om att den är ungefärlig
  map.addLayer({
    id: 'lines-coarse', type: 'line', source: 'metro-lines', filter: ['get', 'coarse'] as never,
    layout: { 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': lineW(1.7, 3.8, 7.2), 'line-dasharray': [2, 1.3] },
  });

  map.addLayer({
    id: 'stations', type: 'circle', source: 'metro-stations', minzoom: 10,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, ['case', ['get', 'multi'], 2.6, 1.6], 12, ['case', ['get', 'multi'], 4.4, 2.8], 14, ['case', ['get', 'multi'], 7, 5], 16, ['case', ['get', 'multi'], 10, 8]] as never,
      'circle-color': ['case', ['get', 'multi'], p.stationLabel, p.land] as never,
      'circle-stroke-color': ['case', ['get', 'multi'], halo, color] as never,
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 2.6] as never,
    },
  });
  const labelLayout = {
    'text-field': ['get', 'name'] as never,
    'text-font': ['Noto Sans Bold'],
    'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11.5, 16, 14] as never,
    'text-anchor': 'top' as const,
    'text-offset': [0, 0.9] as [number, number],
    'text-max-width': 9,
    'text-optional': true,
  };
  const labelPaint = (from: number) => ({
    'text-color': p.stationLabel,
    'text-halo-color': p.labelHalo,
    'text-halo-width': 1.8,
    // Namnen tonar in vid zoom
    'text-opacity': ['interpolate', ['linear'], ['zoom'], from, 0, from + 1, 1] as never,
  });
  map.addLayer({
    id: 'station-labels-major', type: 'symbol', source: 'metro-stations', minzoom: 11.6, filter: ['get', 'multi'] as never,
    layout: labelLayout, paint: labelPaint(11.6),
  });
  map.addLayer({
    id: 'station-labels', type: 'symbol', source: 'metro-stations', minzoom: 12.8, filter: ['!', ['get', 'multi']] as never,
    layout: labelLayout, paint: labelPaint(12.8),
  });

  map.addLayer({ id: 'user-accuracy', type: 'fill', source: 'user-accuracy', paint: { 'fill-color': accent, 'fill-opacity': 0.14 } });
  map.addLayer({
    id: 'user-dot', type: 'circle', source: 'user-dot',
    paint: { 'circle-radius': 7, 'circle-color': accent, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 },
  });
  if (lastUser) setUserFix(map, lastUser);
}

const emptyFC = () => ({ type: 'FeatureCollection', features: [] });

export function setUserFix(map: MlMap, fix: UserFix | null): void {
  lastUser = fix;
  const acc = map.getSource('user-accuracy') as GeoJSONSource | undefined;
  const dot = map.getSource('user-dot') as GeoJSONSource | undefined;
  if (!acc || !dot) return;
  if (!fix) {
    acc.setData(emptyFC() as never);
    dot.setData(emptyFC() as never);
    return;
  }
  acc.setData({ type: 'Feature', properties: {}, geometry: circlePolygon(fix.lat, fix.lon, Math.max(fix.accuracy, 5)) } as never);
  dot.setData({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [fix.lon, fix.lat] } } as never);
}

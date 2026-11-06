/**
 * Egen kartstil (ljus/mörk) ovanpå OpenFreeMaps vektor-tiles (OpenMapTiles-schema). Färgerna läses ur designtokens (--map-*).
 * Källa: https://openfreemap.org (gratis, ingen nyckel). Attribution: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap".
 */
import type { StyleSpecification, LayerSpecification } from 'maplibre-gl';

export interface MapPalette {
  land: string; park: string; water: string; building: string;
  roadMinor: string; roadMajor: string; roadCasing: string;
  label: string; labelHalo: string; waterLabel: string;
}

const FALLBACK_DARK: MapPalette = {
  land: '#12161b', park: '#151d1b', water: '#0e1d27', building: '#1a2027',
  roadMinor: '#232a32', roadMajor: '#2e3640', roadCasing: '#0e1114',
  label: '#c9c4b9', labelHalo: '#0e1114', waterLabel: '#7db3c3',
};

const VAR: Record<keyof MapPalette, string> = {
  land: '--map-land', park: '--map-park', water: '--map-water', building: '--map-building',
  roadMinor: '--map-road-minor', roadMajor: '--map-road-major', roadCasing: '--map-road-casing',
  label: '--map-label', labelHalo: '--map-label-halo', waterLabel: '--map-water-label',
};

/** Läser kartfärgerna ur CSS-variablerna (följer prefers-color-scheme). */
export function readMapPalette(el: Element = document.documentElement): MapPalette {
  const cs = getComputedStyle(el);
  const out = { ...FALLBACK_DARK };
  for (const k of Object.keys(VAR) as (keyof MapPalette)[]) {
    const v = cs.getPropertyValue(VAR[k]).trim();
    if (v) out[k] = v;
  }
  return out;
}

export const OFM_TILEJSON = 'https://tiles.openfreemap.org/planet';
export const OFM_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const OFM_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

const SRC = 'openmaptiles';
const isLine = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const isPoly = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
const name = ['coalesce', ['get', 'name:latin'], ['get', 'name_en'], ['get', 'name']];

export function buildStyle(p: MapPalette): StyleSpecification {
  const layers: LayerSpecification[] = [
    { id: 'background', type: 'background', paint: { 'background-color': p.land } },
    { id: 'park', type: 'fill', source: SRC, 'source-layer': 'park', filter: isPoly as never, paint: { 'fill-color': p.park } },
    {
      id: 'wood', type: 'fill', source: SRC, 'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'wood'], paint: { 'fill-color': p.park, 'fill-opacity': 0.6 },
    },
    { id: 'water', type: 'fill', source: SRC, 'source-layer': 'water', filter: ['all', isPoly, ['!=', ['get', 'brunnel'], 'tunnel']] as never, paint: { 'fill-color': p.water } },
    { id: 'waterway', type: 'line', source: SRC, 'source-layer': 'waterway', paint: { 'line-color': p.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 16, 3] } },
    {
      id: 'building', type: 'fill', source: SRC, 'source-layer': 'building', minzoom: 13,
      paint: { 'fill-color': p.building, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, 1] },
    },
    {
      id: 'road-minor', type: 'line', source: SRC, 'source-layer': 'transportation', minzoom: 12,
      filter: ['all', isLine, ['match', ['get', 'class'], ['minor', 'service', 'track'], true, false]] as never,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.roadMinor, 'line-width': ['interpolate', ['exponential', 1.55], ['zoom'], 12, 0.6, 20, 18] },
    },
    {
      id: 'road-major-casing', type: 'line', source: SRC, 'source-layer': 'transportation', minzoom: 9,
      filter: ['all', isLine, ['match', ['get', 'class'], ['primary', 'secondary', 'tertiary', 'trunk', 'motorway'], true, false]] as never,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.roadCasing, 'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 9, 1.4, 20, 26] },
    },
    {
      id: 'road-major', type: 'line', source: SRC, 'source-layer': 'transportation', minzoom: 9,
      filter: ['all', isLine, ['match', ['get', 'class'], ['primary', 'secondary', 'tertiary', 'trunk', 'motorway'], true, false]] as never,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.roadMajor, 'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 9, 0.8, 20, 22] },
    },
    {
      id: 'water-label', type: 'symbol', source: SRC, 'source-layer': 'water_name', minzoom: 10,
      layout: { 'text-field': name as never, 'text-font': ['Noto Sans Italic'], 'text-size': 12, 'text-letter-spacing': 0.1 },
      paint: { 'text-color': p.waterLabel, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.2 },
    },
    {
      id: 'road-label', type: 'symbol', source: SRC, 'source-layer': 'transportation_name', minzoom: 14,
      filter: ['match', ['get', 'class'], ['primary', 'secondary', 'tertiary', 'trunk', 'minor'], true, false] as never,
      layout: { 'symbol-placement': 'line', 'text-field': name as never, 'text-font': ['Noto Sans Regular'], 'text-size': 12 },
      paint: { 'text-color': p.label, 'text-opacity': 0.8, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.4 },
    },
    {
      id: 'place-suburb', type: 'symbol', source: SRC, 'source-layer': 'place', minzoom: 11.5,
      filter: ['match', ['get', 'class'], ['suburb', 'quarter', 'neighbourhood'], true, false] as never,
      layout: { 'text-field': name as never, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 11.5, 11, 15, 13], 'text-transform': 'uppercase', 'text-letter-spacing': 0.1, 'text-max-width': 8 },
      paint: { 'text-color': p.label, 'text-opacity': 0.65, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.2 },
    },
    {
      id: 'place-city', type: 'symbol', source: SRC, 'source-layer': 'place', minzoom: 5,
      filter: ['match', ['get', 'class'], ['city', 'town', 'village'], true, false] as never,
      layout: { 'text-field': name as never, 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 11, 17], 'text-max-width': 8 },
      paint: { 'text-color': p.label, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.6 },
    },
  ];
  return {
    version: 8,
    name: 'strata',
    glyphs: OFM_GLYPHS,
    sources: { [SRC]: { type: 'vector', url: OFM_TILEJSON, attribution: OFM_ATTRIBUTION } },
    layers,
  };
}

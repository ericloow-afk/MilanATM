/** Lokala plana meter (öst/nord) kring en ursprungspunkt. Duger på hundratals meter. */
const R = 6371008.8;
const RAD = Math.PI / 180;

export interface LatLonPoint {
  lat: number;
  lon: number;
}

export function toLocalMeters(origin: LatLonPoint, lat: number, lon: number): { east: number; north: number } {
  return {
    east: (lon - origin.lon) * RAD * R * Math.cos(origin.lat * RAD),
    north: (lat - origin.lat) * RAD * R,
  };
}

export function fromLocalMeters(origin: LatLonPoint, east: number, north: number): LatLonPoint {
  return {
    lat: origin.lat + north / (R * RAD),
    lon: origin.lon + east / (R * RAD * Math.cos(origin.lat * RAD)),
  };
}

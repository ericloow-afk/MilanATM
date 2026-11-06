/** Ren hjälpkod (testbar utan DOM). */

export function normalizeHeading(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Riktning härledd ur alpha: (360 - alpha) mod 360. */
export function alphaHeading(alpha: number): number {
  return normalizeHeading(360 - alpha);
}

/** Signerad kortaste skillnad a - b i grader, i intervallet (-180, 180]. */
export function headingDiff(a: number, b: number): number {
  const d = normalizeHeading(a - b);
  return d > 180 ? d - 360 : d;
}

export function fmt(n: number | null | undefined, digits = 1): string {
  return n == null || Number.isNaN(n) ? '–' : n.toFixed(digits);
}

/** Uppdateringsfrekvens (Hz) ur tidsstämplar (ms) inom de senaste windowMs. */
export function rateHz(stamps: number[], now: number, windowMs = 2000): number {
  const recent = stamps.filter((t) => now - t <= windowMs);
  if (recent.length < 2) return 0;
  const span = recent[recent.length - 1] - recent[0];
  return span > 0 ? ((recent.length - 1) * 1000) / span : 0;
}

export interface Gps {
  lat: number;
  lon: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  ts: number;
}

export interface Orient {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  compass: number | null;
  compassAccuracy: number | null;
  ts: number;
}

export interface Reading {
  secure: boolean;
  hasOrientationPermissionApi: boolean;
  status: Record<'orientation' | 'camera' | 'gps', string>;
  hz: number;
  now: number;
  gps?: Gps;
  orient?: Orient;
}

function age(ts: number | undefined, now: number): string {
  return ts == null ? '–' : `${new Date(ts).toLocaleTimeString('sv-SE')} (${fmt((now - ts) / 1000, 1)} s sen)`;
}

export function formatReading(r: Reading): string {
  const o = r.orient;
  const alphaDir = o?.alpha != null ? alphaHeading(o.alpha) : null;
  const diff = alphaDir != null && o?.compass != null ? headingDiff(alphaDir, o.compass) : null;
  const acc = o?.compassAccuracy;
  const accNote = acc == null ? '' : acc < 0 ? ' OKALIBRERAD' : '';
  const orientStatus = o ? `tar emot data (${fmt(r.hz, 1)} Hz)` : r.status.orientation;
  return [
    `HTTPS: ${r.secure ? 'ja' : 'NEJ (sensorer fungerar inte)'}   requestPermission: ${r.hasOrientationPermissionApi ? 'ja (iOS)' : 'nej'}`,
    `rörelse/orientering: ${orientStatus}`,
    `kamera: ${r.status.camera}`,
    `GPS: ${r.status.gps}`,
    '',
    r.gps
      ? `lat ${r.gps.lat.toFixed(6)}  lon ${r.gps.lon.toFixed(6)}\nnoggrannhet ±${fmt(r.gps.accuracy, 0)} m\nhastighet ${fmt(r.gps.speed, 1)} m/s  riktning ${fmt(r.gps.heading, 0)}°\nsenaste GPS: ${age(r.gps.ts, r.now)}`
      : 'lat/lon: –',
    '',
    `webkitCompassHeading: ${fmt(o?.compass)}°`,
    `webkitCompassAccuracy: ${fmt(acc, 0)}${accNote}`,
    `alpha-riktning (360-alpha): ${fmt(alphaDir)}°   diff: ${fmt(diff)}°`,
    `alpha ${fmt(o?.alpha)}  beta ${fmt(o?.beta)}  gamma ${fmt(o?.gamma)}`,
    `senaste orient-event: ${age(o?.ts, r.now)}`,
  ].join('\n');
}

export const CSV_HEADER = 'time,lat,lon,acc,heading,headingAcc,alpha,beta,gamma';

export function csvRow(now: number, gps?: Gps, o?: Orient): string {
  const c = (n: number | null | undefined, d: number) => (n == null || Number.isNaN(n) ? '' : n.toFixed(d));
  return [
    new Date(now).toISOString(),
    c(gps?.lat, 6),
    c(gps?.lon, 6),
    c(gps?.accuracy, 1),
    c(o?.compass, 1),
    c(o?.compassAccuracy, 0),
    c(o?.alpha, 1),
    c(o?.beta, 1),
    c(o?.gamma, 1),
  ].join(',');
}

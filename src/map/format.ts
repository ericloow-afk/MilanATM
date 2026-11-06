/** Textformat för kartvyn (ren TS). Konsekvent svenska, inga avkortningar, ingen "t.o.m.". */
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const pad2 = (n: number): string => String(Math.floor(n)).padStart(2, '0');

/** HH:MM:SS ur sekunder från midnatt. */
export const fmtHMS = (sec: number): string => `${pad2(sec / 3600)}:${pad2((sec % 3600) / 60)}:${pad2(sec % 60)}`;
/** HH:MM ur sekunder från midnatt. */
export const fmtHM = (sec: number): string => `${pad2((sec / 3600) % 24)}:${pad2((sec % 3600) / 60)}`;
/** M:SS för nedräkningar. */
export const fmtCount = (sec: number): string => `${Math.floor(sec / 60)}:${pad2(sec % 60)}`;

/** Avstånd: "320 m" eller "1,4 km". */
export const fmtDist = (m: number): string => (m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);

const MONTHS = ['jan', 'feb', 'mars', 'apr', 'maj', 'juni', 'juli', 'aug', 'sep', 'okt', 'nov', 'dec'];
/** "2026-11-30" → "30 nov 2026" (utan punkt efter månaden). */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

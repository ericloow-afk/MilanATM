/** Tid i Europe/Rome. Ren TS (Intl är inbyggt i JS, inget DOM). */

export const ROME_TZ = 'Europe/Rome';

let fmt: Intl.DateTimeFormat | undefined;

/**
 * Lokal Rom-tid för ett ögonblick: datum som YYYYMMDD och hel sekund från lokal midnatt.
 * Obs: på dagar då klockan ställs om (sista söndagen i mars/oktober) är "sekund från midnatt" väggklockans,
 * inte GTFS-definitionen (sekunder sedan middag minus 12 h). Feeden (26/10–30/11) har inget sådant skifte.
 */
export function romeServiceTime(at: Date): { ymd: number; sec: number } {
  fmt ??= new Intl.DateTimeFormat('en-GB', {
    timeZone: ROME_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(at)) p[part.type] = part.value;
  return {
    ymd: Number(p.year) * 10000 + Number(p.month) * 100 + Number(p.day),
    sec: Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second),
  };
}

/** Lägger delta dagar till ett YYYYMMDD-datum. */
export function addDays(ymd: number, delta: number): number {
  const y = Math.floor(ymd / 10000);
  const m = Math.floor((ymd % 10000) / 100);
  const d = ymd % 100;
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
}

export const isoToYmd = (iso: string): number => Number(iso.replaceAll('-', ''));

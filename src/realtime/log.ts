/**
 * Logg över observationer, för att mäta hur mycket tidtabellen avviker per linje och tid på dygnet.
 * Sparas i localStorage (utan utgång, högst MAX_ENTRIES rader) och exporteras som CSV.
 */
import { readJson, writeJson, type KeyValueStore } from './store';

export const LOG_KEY = 'mmar.realtime.log.v1';
export const MAX_ENTRIES = 5000;

export interface LogEntry {
  /** epoch-ms då knappen trycktes / observationen gjordes */
  observedAt: number;
  line: string;
  direction: string;
  directionName: string;
  stopId: string;
  stopName: string;
  kind: 'arrival' | 'departure' | 'wait';
  /** tidtabellens tid vid stationen (GTFS, utan uppehållsmodell), epoch-ms */
  timetableMs: number;
  /** modellens ankomst (med uppskattat uppehåll), epoch-ms */
  modelMs: number;
  /** observerad tid, epoch-ms */
  eventMs: number;
  source: string;
  tripId: string;
}

export class ObservationLog {
  private rows: LogEntry[];
  constructor(
    private store: KeyValueStore | null,
    private key = LOG_KEY,
    private max = MAX_ENTRIES,
  ) {
    const saved = readJson<unknown>(store, key, []);
    this.rows = Array.isArray(saved) ? (saved as LogEntry[]).filter((r) => r && typeof r.observedAt === 'number') : [];
  }
  /** false om raden inte kunde sparas permanent (den finns ändå kvar i minnet) */
  add(e: LogEntry): boolean {
    this.rows.push(e);
    if (this.rows.length > this.max) this.rows.splice(0, this.rows.length - this.max);
    return writeJson(this.store, this.key, this.rows);
  }
  /** Tar bort den senaste raden för samma tåg och station (ångra). */
  removeLast(tripId: string, stopId: string): void {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i].tripId === tripId && this.rows[i].stopId === stopId) {
        this.rows.splice(i, 1);
        writeJson(this.store, this.key, this.rows);
        return;
      }
    }
  }
  entries(): readonly LogEntry[] {
    return this.rows;
  }
  get size(): number {
    return this.rows.length;
  }
  clear(): void {
    this.rows = [];
    writeJson(this.store, this.key, []);
  }
  toCsv(): string {
    return logToCsv(this.rows);
  }
}

const romeParts = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Rome',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});

/** Datum, veckodag och klockslag i Rom-tid för epoch-ms. */
export function romeStamp(ms: number): { date: string; weekday: string; time: string; hour: number } {
  const p: Record<string, string> = {};
  for (const part of romeParts.formatToParts(new Date(ms))) p[part.type] = part.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: (p.weekday ?? '').replace('.', ''),
    time: `${p.hour}:${p.minute}:${p.second}`,
    hour: Number(p.hour),
  };
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const CSV_HEADER = ['datum', 'veckodag', 'timme', 'linje', 'riktning', 'station', 'planerad', 'observerad', 'differens_s', 'modell_ankomst', 'differens_modell_s', 'typ', 'kalla', 'trip'];

/**
 * CSV med en rad per observation. Tider i Rom-tid (HH:MM:SS).
 * planerad = tidtabellens tid (GTFS), differens_s = observerad − planerad (positivt = sent).
 */
export function logToCsv(rows: readonly LogEntry[]): string {
  const lines = [CSV_HEADER.join(',')];
  for (const r of rows) {
    const obs = romeStamp(r.eventMs);
    lines.push(
      [
        obs.date,
        obs.weekday,
        obs.hour,
        r.line,
        r.directionName,
        r.stopName,
        romeStamp(r.timetableMs).time,
        obs.time,
        Math.round((r.eventMs - r.timetableMs) / 1000),
        romeStamp(r.modelMs).time,
        Math.round((r.eventMs - r.modelMs) / 1000),
        r.kind,
        r.source,
        r.tripId,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}

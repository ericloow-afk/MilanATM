/** CSV-loggning för fälttest i AR-vyn (ren TS). */

export const CSV_COLUMNS = [
  'time', 'lat', 'lon', 'gpsAcc', 'rawCompassHeading', 'compassAcc', 'alpha', 'beta', 'gamma',
  'filteredYawDeg', 'yawOffsetDeg', 'manualDeg', 'trainsInView', 'mark', 'source', 'buildId',
] as const;

export interface LogRow {
  timeMs: number;
  lat: number | null;
  lon: number | null;
  gpsAcc: number | null;
  rawCompass: number | null;
  compassAcc: number | null;
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  /** appens uppskattade kamerariktning (referensriktning) i grader */
  filteredYaw: number | null;
  /** automatisk yaw-offset mot kompassen (grader) */
  yawOffset: number | null;
  /** manuell kalibrering (grader) */
  manual: number | null;
  trainsInView: number;
  mark: boolean;
  source: 'real' | 'sim';
  buildId: string;
}

const num = (v: number | null | undefined, d: number): string =>
  v == null || Number.isNaN(v) ? '' : v.toFixed(d);

export function formatRow(r: LogRow): string {
  return [
    new Date(r.timeMs).toISOString(),
    num(r.lat, 6),
    num(r.lon, 6),
    num(r.gpsAcc, 1),
    num(r.rawCompass, 1),
    num(r.compassAcc, 0),
    num(r.alpha, 1),
    num(r.beta, 1),
    num(r.gamma, 1),
    num(r.filteredYaw, 1),
    num(r.yawOffset, 1),
    num(r.manual, 1),
    String(r.trainsInView),
    r.mark ? '1' : '0',
    r.source,
    r.buildId.replaceAll(',', ' '),
  ].join(',');
}

export class LogRecorder {
  private lines: string[] = [];
  private startMs = 0;
  private nextMs = 0;
  private running = false;
  private marks = 0;

  constructor(
    private readonly durationMs = 30_000,
    private readonly intervalMs = 200,
  ) {}

  get active(): boolean {
    return this.running;
  }
  get rowCount(): number {
    return this.lines.length;
  }
  get markCount(): number {
    return this.marks;
  }

  start(nowMs: number): void {
    this.lines = [];
    this.marks = 0;
    this.startMs = nowMs;
    this.nextMs = nowMs;
    this.running = true;
  }

  remainingSec(nowMs: number): number {
    return Math.max(0, Math.ceil((this.durationMs - (nowMs - this.startMs)) / 1000));
  }

  /** Anropas ofta (varje bildruta); lägger till en rad per intervall. Returnerar true när inspelningen just avslutats. */
  tick(nowMs: number, make: () => LogRow): boolean {
    if (!this.running) return false;
    if (nowMs >= this.nextMs) {
      this.lines.push(formatRow(make()));
      this.nextMs += this.intervalMs;
      if (this.nextMs < nowMs) this.nextMs = nowMs + this.intervalMs; // hoppa över efter lång paus
    }
    if (nowMs - this.startMs >= this.durationMs) {
      this.running = false;
      return true;
    }
    return false;
  }

  /** Lägger till en extra rad med mark = 1 vid exakt tryckögonblick. Bara under pågående inspelning. */
  mark(nowMs: number, make: () => LogRow): boolean {
    if (!this.running) return false;
    void nowMs;
    this.lines.push(formatRow({ ...make(), mark: true }));
    this.marks++;
    return true;
  }

  toCsv(): string {
    return [CSV_COLUMNS.join(','), ...this.lines].join('\n');
  }
}

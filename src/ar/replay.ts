/** Replay av en inspelad sensorlogg (CSV från AR-vyns "Spela in") genom OrientationFilter. Ren TS. */
import { deviceQuaternion, qAngleBetween, referenceHeading, wrap180 } from '../geo/orientation';
import { OrientationFilter, type FilterOptions } from './filter';

export interface LogRow {
  /** epoch-ms */
  t: number;
  heading: number | null;
  headingAcc: number | null;
  alpha: number;
  beta: number;
  gamma: number;
}

/** Läser CSV med kolumnerna time,lat,lon,acc,heading,headingAcc,alpha,beta,gamma (sensortestets format). */
export function parseSensorCsv(text: string): LogRow[] {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(',').map((h) => h.trim());
  const ix = (n: string) => {
    const i = head.indexOf(n);
    if (i < 0) throw new Error(`CSV saknar kolumnen ${n}`);
    return i;
  };
  const [it, ih, ia, ial, ib, ig] = ['time', 'heading', 'headingAcc', 'alpha', 'beta', 'gamma'].map(ix);
  const num = (s: string) => (s === '' || s === undefined ? null : Number(s));
  return lines.slice(1).map((l) => {
    const f = l.split(',');
    return { t: Date.parse(f[it]), heading: num(f[ih]), headingAcc: num(f[ia]), alpha: Number(f[ial]), beta: Number(f[ib]), gamma: Number(f[ig]) };
  });
}

export interface ReplayPoint {
  t: number;
  /** filtrets yaw-offset-skattning (grader, wrappad till −180..180) */
  yaw: number;
  /** uppmätt offset ur kompassen: kompass − råreferens (grader), null om kompass saknas */
  measured: number | null;
  state: string;
  /** vinkel (grader) filtrerad rotation har ändrats sedan förra samplet */
  filteredStep: number;
  /** vinkel (grader) den råa rotationen har ändrats sedan förra samplet */
  rawStep: number;
  rate: number;
  elevation: number;
  headingAcc: number | null;
  beta: number;
}

export function replay(rows: LogRow[], opts: FilterOptions = {}): ReplayPoint[] {
  const f = new OrientationFilter(opts);
  const out: ReplayPoint[] = [];
  let prevT = 0;
  let prevFiltered = null as ReturnType<typeof deviceQuaternion> | null;
  let prevRaw = null as ReturnType<typeof deviceQuaternion> | null;
  for (const r of rows) {
    const dt = prevT ? (r.t - prevT) / 1000 : 0;
    prevT = r.t;
    f.update(dt, { alpha: r.alpha, beta: r.beta, gamma: r.gamma, screenAngle: 0, compass: r.heading, compassAccuracy: r.headingAcc });
    const raw = deviceQuaternion(r.alpha, r.beta, r.gamma, 0);
    const q = f.quaternion;
    out.push({
      t: r.t,
      yaw: wrap180(f.yawDeg),
      measured: r.heading == null ? null : wrap180(r.heading - referenceHeading(raw)),
      state: f.compassState,
      filteredStep: prevFiltered ? (qAngleBetween(prevFiltered, q) * 180) / Math.PI : 0,
      rawStep: prevRaw ? (qAngleBetween(prevRaw, raw) * 180) / Math.PI : 0,
      rate: f.rateDegPerSec,
      elevation: f.elevationDeg,
      headingAcc: r.headingAcc,
      beta: r.beta,
    });
    prevFiltered = q;
    prevRaw = raw;
  }
  return out;
}

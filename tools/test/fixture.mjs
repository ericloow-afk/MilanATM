// Skapar en liten syntetisk GTFS-zip för tester. Linje Mi går väst→öst längs lat 45.40+i*0.01.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';

const csv = (header, rows) => [header.join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n';
const hms = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/** Stationer per linje (namn är stop_id, som i verkliga feeden). */
export const FIXTURE_STOPS = {
  M1: ['A1 M1', 'B1 M1', 'C1 M1', 'D1 M1'],
  M2: ['A2', 'GARIBALDI FS', 'CENTRALE FS', 'D2'],
  M3: ['A3', 'B3', 'C3', 'D3'],
  M4: ['A4', 'B4', 'C4', 'D4'],
  M5: ['A5', 'B5', 'C5', 'D5'],
};

export function makeFixtureZip({ offsetStop = null } = {}) {
  const routes = [...Object.keys(FIXTURE_STOPS).map((id, i) => [id, String(i + 1), '1', ['ff0000', '73ff01', 'fcff01', '0000ee', 'c876b1'][i]]), ['B1', 'B1', '3', '000000']];
  const stops = [];
  const shapes = [];
  const trips = [];
  const stopTimes = [];
  const lonOf = (j) => (9.1 + j * 0.01).toFixed(6);
  Object.entries(FIXTURE_STOPS).forEach(([line, names], i) => {
    const lat = 45.4 + i * 0.01;
    names.forEach((n, j) => {
      let la = lat;
      if (offsetStop === n) la = lat + 0.001; // ~111 m från shapen
      stops.push([`"${n}"`, `"${n}"`, la.toFixed(7), lonOf(j)]);
    });
    // shape: 31 punkter västerut→österut; M5 grov (4 punkter)
    const nPts = line === 'M5' ? 4 : 31;
    for (const [sid, rev] of [[`${line}_fwd`, false], [`${line}_rev`, true]]) {
      const pts = Array.from({ length: nPts }, (_, k) => (9.1 + (k / (nPts - 1)) * 0.03).toFixed(6));
      (rev ? [...pts].reverse() : pts).forEach((lon, k) => shapes.push([sid, lat.toFixed(6), lon, k + 1]));
    }
    // trips: fram (service wk) 2 st, bak (service wk) 1, nattrip över midnatt (service late)
    const defs = [
      [`${line}_t1`, `${line}_fwd`, 'wk', 6 * 3600, false],
      [`${line}_t2`, `${line}_fwd`, 'wk', 7 * 3600, false],
      [`${line}_t3`, `${line}_rev`, 'wk', 6 * 3600 + 300, true],
      [`${line}_t4`, `${line}_fwd`, 'late', 23 * 3600 + 59 * 60, false],
    ];
    for (const [tid, shape, svc, start, rev] of defs) {
      trips.push([line, svc, tid, `"${rev ? names.at(-1) : names.at(-1)}"`, shape]);
      const order = rev ? [...names].reverse() : names;
      order.forEach((n, k) => {
        const arr = start + k * 120;
        const dep = arr + (k === 0 || k === order.length - 1 ? 0 : 30);
        stopTimes.push([tid, hms(arr), hms(dep), `"${n}"`, k + 1]);
      });
    }
  });
  // buss som ska filtreras bort
  stops.push(['BUS1', 'BUS1', '45.50', '9.20']);
  shapes.push(['BUS_s', '45.5', '9.2', 1], ['BUS_s', '45.5', '9.21', 2]);
  trips.push(['B1', 'wk', 'bus_t1', 'x', 'BUS_s']);
  stopTimes.push(['bus_t1', '8:00:00', '8:00:00', 'BUS1', 1]);

  const files = {
    'agency.txt': csv(['agency_id', 'agency_name'], [['A', 'ATM']]),
    'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n',
    'calendar_dates.txt': csv(
      ['service_id', 'date', 'exception_type'],
      [['wk', 20261105, 1], ['wk', 20261106, 1], ['wk', 20261107, 1], ['wk', 20261107, 2], ['late', 20261106, 1]],
    ),
    'feed_info.txt': csv(['feed_publisher_name', 'feed_start_date', 'feed_version', 'mm_end_date'], [['T', 20261026, '9', 20261130]]),
    'routes.txt': csv(['route_id', 'route_short_name', 'route_type', 'route_color'], routes),
    'shapes.txt': csv(['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'], shapes),
    'stop_times.txt': csv(['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'], stopTimes),
    'stops.txt': csv(['stop_id', 'stop_name', 'stop_lat', 'stop_lon'], stops),
    'trips.txt': csv(['route_id', 'service_id', 'trip_id', 'trip_headsign', 'shape_id'], trips),
  };
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
  const dir = mkdtempSync(join(tmpdir(), 'gtfs-fixture-'));
  const path = join(dir, 'gtfs.zip');
  writeFileSync(path, zip);
  return path;
}

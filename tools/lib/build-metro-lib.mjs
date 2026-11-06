// Bygger metro.json (endast route_type 1) ur en GTFS-zip. Se docs/gtfs-notes.md för feedens egenheter.
import { basename } from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseTime, readTables, streamZipFile } from './gtfs-read.mjs';
import { projectMonotone } from './project.mjs';

export const COARSE_MAX_POINTS = 19; // shapes med färre än 20 punkter flaggas "coarse"
export const SD_DEVIATION_M = 30; // station längre än så från shapen rapporteras

const r6 = (x) => Math.round(Number(x) * 1e6) / 1e6;
const ymd = (s) => Number(String(s).trim());
const isoDate = (n) => `${String(n).slice(0, 4)}-${String(n).slice(4, 6)}-${String(n).slice(6, 8)}`;

const LOWER_WORDS = new Set(['sul', 'di']);
const KEEP_TOKENS = new Set(['FS', 'FN', 'QT8', 'F.S.', 'T.I.B.B.', '1']);

/** Rensat visningsnamn: tar bort avslutande linjesuffix (" M1"), Title Case. Ändrar aldrig stop_id. */
export function displayName(stopId) {
  const base = stopId.replace(/\s+M[1-5]$/, '');
  return base
    .split(' ')
    .map((tok, i) => {
      if (KEEP_TOKENS.has(tok)) return tok;
      if (tok === 'P.TA') return 'P.ta';
      if (i > 0 && LOWER_WORDS.has(tok.toLowerCase())) return tok.toLowerCase();
      return tok
        .split('.')
        .map((p) => (p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : p))
        .join('.');
    })
    .join(' ');
}

/** Bygger metro-objektet. Returnerar { metro, report }. */
export function buildMetro(zipPath) {
  const warnings = [];
  const t = readTables(zipPath);

  // --- feed, rutter ---
  const feed = t.table('feed_info.txt')[0] ?? {};
  if (t.table('calendar.txt').length > 0) {
    warnings.push('calendar.txt har rader men ignoreras (bara calendar_dates används).');
  }
  const routes = t.table('routes.txt').filter((r) => r.route_type === '1');
  if (routes.length === 0) throw new Error('Inga metrorutter (route_type 1) hittades.');
  const routeIds = new Set(routes.map((r) => r.route_id));

  // --- trips ---
  const trips = new Map(); // trip_id -> { route, service, shape }
  for (const tr of t.table('trips.txt')) {
    if (routeIds.has(tr.route_id)) trips.set(tr.trip_id, { route: tr.route_id, service: tr.service_id, shape: tr.shape_id });
  }
  for (const [id, tr] of trips) if (!tr.shape) throw new Error(`Trip ${id} saknar shape_id`);

  // --- stop_times (strömmad; hela filen hålls aldrig i minnet) ---
  const stopTimes = new Map(); // trip_id -> [{seq, stop, arr, dep}]
  let idx = {};
  streamZipFile(zipPath, 'stop_times.txt', {
    keepFirstField: new Set(trips.keys()),
    onHeader(h) {
      idx = Object.fromEntries(h.map((n, i) => [n, i]));
      for (const need of ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence']) {
        if (!(need in idx)) throw new Error(`stop_times.txt saknar kolumnen ${need}`);
      }
    },
    onRow(f) {
      const id = f[idx.trip_id];
      if (!trips.has(id)) return;
      let list = stopTimes.get(id);
      if (!list) stopTimes.set(id, (list = []));
      list.push({
        seq: Number(f[idx.stop_sequence]),
        stop: f[idx.stop_id],
        arr: parseTime(f[idx.arrival_time]),
        dep: parseTime(f[idx.departure_time]),
      });
    },
  });
  for (const id of trips.keys()) {
    if (!stopTimes.has(id)) throw new Error(`Trip ${id} saknar stop_times`);
  }

  // --- stationer ---
  const stopsTxt = new Map(t.table('stops.txt').map((s) => [s.stop_id, s]));
  const usedStops = new Set();
  for (const list of stopTimes.values()) for (const s of list) usedStops.add(s.stop);
  const stopIds = [...usedStops].sort();
  const stopIdx = new Map(stopIds.map((id, i) => [id, i]));
  const stops = stopIds.map((id) => {
    const s = stopsTxt.get(id);
    if (!s || !s.stop_lat || !s.stop_lon) throw new Error(`Station ${id} saknar koordinater`);
    return { id, name: displayName(id), lat: r6(s.stop_lat), lon: r6(s.stop_lon) };
  });

  // --- shapes (deduplicerade på geometri) ---
  const wantedShapes = new Set([...trips.values()].map((tr) => tr.shape));
  const rawShapes = new Map(); // shape_id -> [{seq, lat, lon}]
  for (const s of t.table('shapes.txt')) {
    if (!wantedShapes.has(s.shape_id)) continue;
    let l = rawShapes.get(s.shape_id);
    if (!l) rawShapes.set(s.shape_id, (l = []));
    l.push({ seq: Number(s.shape_pt_sequence), lat: r6(s.shape_pt_lat), lon: r6(s.shape_pt_lon) });
  }
  const shapeGeoms = [];
  const geomKey = new Map();
  const shapes = {};
  for (const id of [...wantedShapes].sort()) {
    const l = rawShapes.get(id);
    if (!l) throw new Error(`shape ${id} saknas i shapes.txt`);
    l.sort((a, b) => a.seq - b.seq);
    const pts = l.map((p) => [p.lat, p.lon]);
    const key = JSON.stringify(pts);
    if (!geomKey.has(key)) { geomKey.set(key, shapeGeoms.length); shapeGeoms.push(pts); }
    shapes[id] = geomKey.get(key);
  }

  // --- mönster ---
  const patternMap = new Map(); // key -> pattern (med tripCount)
  const tripRefs = []; // { patternKey, service, start }
  const timeAnomalies = [];
  for (const [id, tr] of trips) {
    const list = stopTimes.get(id).sort((a, b) => a.seq - b.seq);
    for (let i = 1; i < list.length; i++) {
      if (!(list[i].seq > list[i - 1].seq)) throw new Error(`Trip ${id}: stop_sequence ej växande`);
    }
    const start = list[0].arr;
    const a = list.map((s) => s.arr - start);
    const w = list.map((s) => s.dep - s.arr);
    for (let i = 0; i < list.length; i++) {
      if (w[i] < 0 || (i > 0 && a[i] < a[i - 1] + w[i - 1])) {
        timeAnomalies.push(`${id} @${list[i].stop}`);
        break;
      }
    }
    const stopsI = list.map((s) => stopIdx.get(s.stop));
    const key = `${tr.route}|${tr.shape}|${stopsI.join('>')}|${a.join(',')}|${w.join(',')}`;
    let p = patternMap.get(key);
    if (!p) patternMap.set(key, (p = { line: tr.route, shape: tr.shape, stops: stopsI, a, w, tripCount: 0 }));
    p.tripCount++;
    tripRefs.push({ key, service: tr.service, start });
  }

  // --- riktningar: tripens sista station (terminus) ---
  const dirMap = new Map();
  for (const p of patternMap.values()) {
    const term = stops[p.stops.at(-1)];
    p.dirKey = `${p.line}>${term.id}`;
    if (!dirMap.has(p.dirKey)) dirMap.set(p.dirKey, { id: p.dirKey, line: p.line, terminus: term.id, name: term.name });
  }
  const lineOrder = routes.map((r) => r.route_id).sort();
  const directions = [...dirMap.values()].sort(
    (x, y) => lineOrder.indexOf(x.line) - lineOrder.indexOf(y.line) || x.terminus.localeCompare(y.terminus),
  );
  const dirIdx = new Map(directions.map((d, i) => [d.id, i]));

  // --- sd (distans längs shapen) + kvalitetsflaggor ---
  const sdDeviations = [];
  const nonStrictSd = [];
  const patterns = [...patternMap.values()]
    .sort((x, y) => lineOrder.indexOf(x.line) - lineOrder.indexOf(y.line) || x.shape.localeCompare(y.shape) || x.a.join().localeCompare(y.a.join()))
    .map((p) => {
      const pts = shapeGeoms[shapes[p.shape]];
      const quality = pts.length <= COARSE_MAX_POINTS ? 'coarse' : 'ok';
      const proj = projectMonotone(pts, p.stops.map((i) => [stops[i].lat, stops[i].lon]));
      const sd = proj.map((x) => Math.round(x.sd * 10) / 10);
      proj.forEach((x, i) => {
        if (x.dist > SD_DEVIATION_M) {
          sdDeviations.push({ line: p.line, shape: p.shape, stop: stops[p.stops[i]].id, distM: Math.round(x.dist), quality });
        }
      });
      for (let i = 1; i < sd.length; i++) {
        if (!(sd[i] > sd[i - 1])) {
          nonStrictSd.push({ line: p.line, shape: p.shape, from: stops[p.stops[i - 1]].id, to: stops[p.stops[i]].id, quality });
        }
      }
      return { ...p, quality, sd };
    });
  const strictFailOk = nonStrictSd.filter((x) => x.quality === 'ok');
  if (strictFailOk.length) {
    throw new Error(`sd är inte strikt växande för mönster med bra shape:\n${JSON.stringify(strictFailOk.slice(0, 10), null, 1)}`);
  }
  const patIdx = new Map(patterns.map((p, i) => [p.key ?? `${p.line}|${p.shape}|${p.stops.join('>')}|${p.a.join(',')}|${p.w.join(',')}`, i]));

  // --- tjänster (bara calendar_dates) ---
  const usedServices = [...new Set(tripRefs.map((r) => r.service))].sort();
  const svcMap = new Map(usedServices.map((id) => [id, { id, add: new Set(), remove: new Set() }]));
  for (const row of t.table('calendar_dates.txt')) {
    const s = svcMap.get(row.service_id);
    if (!s) continue;
    if (row.exception_type === '1') s.add.add(ymd(row.date));
    else if (row.exception_type === '2') s.remove.add(ymd(row.date));
    else warnings.push(`okänd exception_type ${row.exception_type} för ${row.service_id}`);
  }
  const services = usedServices.map((id) => {
    const s = svcMap.get(id);
    if (s.add.size === 0) warnings.push(`service ${id} har inga tillagda datum`);
    return { id, add: [...s.add].sort((x, y) => x - y), remove: [...s.remove].sort((x, y) => x - y) };
  });
  const svcIdx = new Map(usedServices.map((id, i) => [id, i]));

  // --- giltighet ---
  const mmEnd = ymd(feed.mm_end_date || feed.surface_end_date || 0);
  if (!feed.mm_end_date) warnings.push('feed_info saknar mm_end_date; använder surface_end_date.');
  const lastAdded = Math.max(...services.flatMap((s) => s.add));
  const validTo = Math.max(mmEnd, lastAdded);
  if (mmEnd !== lastAdded) {
    warnings.push(`mm_end_date (${mmEnd}) och sista tillagda metro-datum (${lastAdded}) skiljer sig; validTo = ${validTo}.`);
  }

  // --- trips ---
  const tripRows = tripRefs
    .map((r) => [patIdx.get(r.key), svcIdx.get(r.service), r.start])
    .sort((x, y) => x[2] - y[2] || x[0] - y[0] || x[1] - y[1]);

  const metro = {
    meta: {
      source: 'https://dati.comune.milano.it/gtfs.zip (' + basename(zipPath) + ')',
      license: 'CC BY 4.0, Comune di Milano / ATM',
      builtAt: new Date().toISOString(),
      feedVersion: feed.feed_version ?? null,
      validFrom: feed.feed_start_date ? isoDate(feed.feed_start_date) : null,
      validTo: isoDate(validTo),
      validToSource: 'max(feed_info.mm_end_date, sista tillagda datum i metro-tjänsterna)',
      mmEndDate: isoDate(mmEnd),
      lastAddedDate: isoDate(lastAdded),
      timezone: 'Europe/Rome',
      timesAre: 'sekunder från midnatt för tjänstedygnet; kan vara > 86400',
      patternTimes: 'a = ankomst relativt tripens start (första stoppets ankomst), w = uppehållstid; avgång = a + w',
      sd: 'meter längs shapen från dess start, strikt växande per mönster',
      dates: 'YYYYMMDD',
      counts: { lines: routes.length, stops: stops.length, patterns: patterns.length, trips: tripRows.length },
    },
    lines: routes.map((r) => ({ id: r.route_id, name: r.route_short_name, color: r.route_color ? '#' + r.route_color : null })).sort((x, y) => x.id.localeCompare(y.id)),
    stops,
    directions,
    shapeGeoms,
    shapes,
    patterns: patterns.map((p) => ({
      line: p.line,
      dir: dirIdx.get(p.dirKey),
      shape: p.shape,
      shapeQuality: p.quality,
      stops: p.stops,
      sd: p.sd,
      a: p.a,
      w: p.w,
    })),
    services,
    trips: tripRows,
  };

  // --- rapport ---
  const coarse = patterns
    .filter((p) => p.quality === 'coarse')
    .map((p) => ({ shape: p.shape, line: p.line, points: shapeGeoms[shapes[p.shape]].length, trips: p.tripCount }));
  const json = JSON.stringify(metro);
  const sizes = {};
  for (const k of Object.keys(metro)) sizes[k] = JSON.stringify(metro[k]).length;
  const report = {
    coarse,
    coarseTrips: coarse.reduce((s, c) => s + c.trips, 0),
    sdDeviations,
    nonStrictSd,
    timeAnomalies,
    warnings,
    size: { bytes: Buffer.byteLength(json), gzip: gzipSync(json).length, byKey: sizes },
    dedupedShapes: Object.keys(shapes).length - shapeGeoms.length,
  };
  return { metro, json, report };
}

export function formatReport({ report, metro }) {
  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  const L = [];
  L.push('# metro.json – byggrapport', '');
  L.push(`Feed: version ${metro.meta.feedVersion}, ${metro.meta.validFrom} … ${metro.meta.validTo}`);
  const c = metro.meta.counts;
  L.push(`Linjer ${c.lines}, stationer ${c.stops}, mönster ${c.patterns}, trips ${c.trips}, shapes ${Object.keys(metro.shapes).length} (${metro.shapeGeoms.length} unika geometrier)`, '');
  L.push(`## Grova shapes (<${COARSE_MAX_POINTS + 1} punkter, shapeQuality "coarse")`);
  if (!report.coarse.length) L.push('Inga.');
  const coarseBy = new Map();
  for (const x of report.coarse) {
    const e = coarseBy.get(x.shape) ?? { ...x, trips: 0, patterns: 0 };
    e.trips += x.trips;
    e.patterns++;
    coarseBy.set(x.shape, e);
  }
  for (const x of coarseBy.values()) L.push(`- ${x.line} ${x.shape}: ${x.points} punkter, ${x.trips} trips (${x.patterns} mönster)`);
  L.push(`Totalt ${report.coarseTrips} trips flaggade.`, '');
  L.push(`## Stationer >${SD_DEVIATION_M} m från shapen`);
  if (!report.sdDeviations.length) L.push('Inga.');
  const devBy = new Map();
  for (const x of report.sdDeviations) {
    const k = `${x.line} ${x.stop} ${x.distM} m (${x.quality})`;
    devBy.set(k, (devBy.get(k) ?? 0) + 1);
  }
  for (const [k, n] of devBy) L.push(`- ${k}: i ${n} mönster`);
  L.push('', '## Mönster där sd inte är strikt växande (endast tillåtet för coarse)');
  if (!report.nonStrictSd.length) L.push('Inga.');
  for (const x of report.nonStrictSd) L.push(`- ${x.line} ${x.shape} (${x.quality}): ${x.from} → ${x.to}`);
  L.push('', '## Tidsanomalier (tid minskar / negativ uppehållstid)');
  L.push(report.timeAnomalies.length ? report.timeAnomalies.slice(0, 20).map((x) => '- ' + x).join('\n') : 'Inga.');
  L.push('', '## Varningar');
  L.push(report.warnings.length ? report.warnings.map((x) => '- ' + x).join('\n') : 'Inga.');
  L.push('', '## Filstorlek', `metro.json: ${kb(report.size.bytes)} (${report.size.bytes} byte), gzip ${kb(report.size.gzip)}`);
  for (const [k, v] of Object.entries(report.size.byKey)) L.push(`- ${k}: ${kb(v)}`);
  return L.join('\n') + '\n';
}

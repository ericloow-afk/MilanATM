// Inspekterar en GTFS-zip och skriver ut fakta om metrolinjerna (route_type 1).
// Användning: node tools/inspect-gtfs.mjs [data/raw/gtfs.zip] [YYYY-MM-DD]
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

const zipPath = process.argv[2] ?? 'data/raw/gtfs.zip';
const today = process.argv[3] ?? new Date().toISOString().slice(0, 10);
const todayNum = today.replaceAll('-', '');

const files = unzipSync(new Uint8Array(readFileSync(zipPath)));
const dec = new TextDecoder('utf-8');

/** Delar en CSV-rad med stöd för citattecken. */
function splitCsv(line) {
  if (!line.includes('"')) return line.split(',');
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Itererar rader ur en Uint8Array utan att göra en gigantisk sträng. */
function* lines(bytes) {
  let start = 0;
  const n = bytes.length;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3; // BOM
  for (let i = start; i < n; i++) {
    if (bytes[i] === 10) {
      let end = i;
      if (bytes[end - 1] === 13) end--;
      if (end > start) yield dec.decode(bytes.subarray(start, end));
      start = i + 1;
    }
  }
  if (start < n) yield dec.decode(bytes.subarray(start));
}

/** Ger objekt per rad; filter(rawFirstFieldsLine) kan hoppa över rader tidigt. */
function* rows(name, quickSkip) {
  const bytes = files[name];
  if (!bytes) return;
  let header;
  for (const line of lines(bytes)) {
    if (!header) { header = splitCsv(line).map((h) => h.trim()); continue; }
    if (quickSkip && quickSkip(line)) continue;
    const f = splitCsv(line);
    const o = {};
    for (let i = 0; i < header.length; i++) o[header[i]] = f[i] ?? '';
    yield o;
  }
}

const readAll = (name) => [...rows(name)];
const h = (title) => console.log(`\n=== ${title} ===`);
const hms = (t) => { const [a] = t.split(':'); return Number(a); };

console.log(`Fil: ${zipPath}   Idag: ${today}`);
console.log('Filer:', Object.keys(files).join(', '));

// --- feed_info / agency ---
h('feed_info');
for (const r of rows('feed_info.txt')) console.log(r);
h('agency');
for (const r of rows('agency.txt')) console.log(r);

// --- routes ---
const routes = readAll('routes.txt');
h('route_type-fördelning (alla rutter)');
const typeCount = {};
for (const r of routes) typeCount[r.route_type] = (typeCount[r.route_type] ?? 0) + 1;
console.log(typeCount);

const metro = routes.filter((r) => r.route_type === '1');
h('Metrorutter (route_type 1)');
for (const r of metro) {
  console.log(`${r.route_id}\tshort=${r.route_short_name}\tlong=${r.route_long_name}\tcolor=${r.route_color || '-'}\ttext=${r.route_text_color || '-'}`);
}
const metroIds = new Set(metro.map((r) => r.route_id));
const routeName = (id) => metro.find((r) => r.route_id === id)?.route_short_name ?? id;

// --- trips ---
const tripInfo = new Map(); // trip_id -> {route_id, dir, service_id, shape_id, headsign}
for (const t of rows('trips.txt')) {
  if (!metroIds.has(t.route_id)) continue;
  tripInfo.set(t.trip_id, { route: t.route_id, dir: t.direction_id || `(headsign) ${t.trip_headsign}`, service: t.service_id, shape: t.shape_id, head: t.trip_headsign });
}

// --- shapes ---
const shapePts = new Map(); // shape_id -> antal punkter
const wantedShapes = new Set([...tripInfo.values()].map((t) => t.shape).filter(Boolean));
for (const s of rows('shapes.txt')) {
  if (!wantedShapes.has(s.shape_id)) continue;
  shapePts.set(s.shape_id, (shapePts.get(s.shape_id) ?? 0) + 1);
}

// --- stop_times (stor fil: hoppa över rader för andra trips redan på första fältet) ---
const stopsByKey = new Map(); // route|dir -> Set(stop_id)
const stopIdsAll = new Set();
const over24 = [];
let over24Count = 0;
let stopTimeRows = 0;
let nonMonotonic = 0;
const lastSeen = new Map(); // trip_id -> {seq, sec}
const toSec = (t) => { const p = t.split(':').map(Number); return p[0] * 3600 + p[1] * 60 + p[2]; };
const quickSkip = (line) => !tripInfo.has(line.slice(0, line.indexOf(',')).replaceAll('"', ''));
for (const st of rows('stop_times.txt', quickSkip)) {
  const ti = tripInfo.get(st.trip_id);
  if (!ti) continue;
  stopTimeRows++;
  const key = `${ti.route}|${ti.dir}`;
  if (!stopsByKey.has(key)) stopsByKey.set(key, new Set());
  stopsByKey.get(key).add(st.stop_id);
  stopIdsAll.add(st.stop_id);
  if (hms(st.arrival_time) >= 24 || hms(st.departure_time) >= 24) {
    over24Count++;
    if (over24.length < 8) over24.push(`trip=${st.trip_id} linje=${routeName(ti.route)} seq=${st.stop_sequence} stop=${st.stop_id} arr=${st.arrival_time} dep=${st.departure_time}`);
  }
  const sec = toSec(st.arrival_time);
  const prev = lastSeen.get(st.trip_id);
  if (prev && Number(st.stop_sequence) > prev.seq && sec < prev.sec) nonMonotonic++;
  lastSeen.set(st.trip_id, { seq: Number(st.stop_sequence), sec });
}

// --- stops ---
const stops = new Map();
for (const s of rows('stops.txt')) stops.set(s.stop_id, s);
const parentOf = (id) => stops.get(id)?.parent_station || id;

h('Per linje/riktning');
const keys = [...new Set([...tripInfo.values()].map((t) => `${t.route}|${t.dir}`))].sort();
for (const key of keys) {
  const [route, dir] = key.split('|');
  const trips = [...tripInfo.values()].filter((t) => t.route === route && t.dir === dir);
  const shapes = new Set(trips.map((t) => t.shape).filter(Boolean));
  const heads = [...new Set(trips.map((t) => t.head))].join(' / ');
  const stopSet = stopsByKey.get(key) ?? new Set();
  const parents = new Set([...stopSet].map(parentOf));
  console.log(`${routeName(route)} (route_id ${route}) dir ${dir}: trips=${trips.length} shapes=${shapes.size} stop_id=${stopSet.size} stationer(parent)=${parents.size} headsign=${heads}`);
}

h('Stationer per linje (unika, båda riktningar, parent_station om finns)');
for (const r of metro) {
  const set = new Set();
  for (const [key, ids] of stopsByKey) if (key.startsWith(`${r.route_id}|`)) for (const id of ids) set.add(parentOf(id));
  console.log(`${r.route_short_name}: ${set.size}`);
}
console.log(`Totalt unika metrostationer: ${new Set([...stopIdsAll].map(parentOf)).size}   stop_times-rader för metro: ${stopTimeRows}`);

// --- saknade shapes ---
h('Saknade shapes för metro');
const noShapeId = [...tripInfo.entries()].filter(([, t]) => !t.shape);
const missingShapeRef = [...tripInfo.entries()].filter(([, t]) => t.shape && !shapePts.has(t.shape));
console.log(`trips utan shape_id: ${noShapeId.length}`);
console.log(`trips vars shape_id saknas i shapes.txt: ${missingShapeRef.length}`);
const perShape = [...shapePts.entries()].map(([id, n]) => `${id}:${n}`);
console.log(`shapes som används (${shapePts.size}), punkter per shape:`, perShape.join(' '));
const lowRes = [...shapePts.entries()].filter(([, n]) => n < 20);
if (lowRes.length) console.log('Shapes med <20 punkter (grova):', lowRes);

// --- kalender ---
h('Kalender');
const cal = readAll('calendar.txt');
const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const dow = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7; // 0=måndag
console.log(`calendar.txt: ${cal.length} rader`);
for (const c of cal) console.log(c);
const calDates = readAll('calendar_dates.txt');
const datesNum = calDates.map((d) => d.date).sort();
console.log(`calendar_dates.txt: ${calDates.length} rader, ${datesNum[0] ?? '-'} .. ${datesNum.at(-1) ?? '-'}`);

const metroServices = new Set([...tripInfo.values()].map((t) => t.service));
console.log(`service_id som används av metro: ${metroServices.size}`);
const active = new Set();
for (const c of cal) {
  if (metroServices.has(c.service_id) && c[days[dow]] === '1' && c.start_date <= todayNum && todayNum <= c.end_date) active.add(c.service_id);
}
for (const d of calDates) {
  if (d.date !== todayNum || !metroServices.has(d.service_id)) continue;
  if (d.exception_type === '1') active.add(d.service_id);
  if (d.exception_type === '2') active.delete(d.service_id);
}
const tripsToday = [...tripInfo.values()].filter((t) => active.has(t.service)).length;
console.log(`Dagens datum ${today} (${days[dow]}): aktiva metro-service_id=[${[...active].join(', ')}] → ${tripsToday} metro-trips`);
// Ligger idag inom feedens täckning?
const inCalendar = cal.some((c) => c.start_date <= todayNum && todayNum <= c.end_date);
const inDates = calDates.some((d) => d.date === todayNum);
console.log(`idag inom calendar-intervall: ${inCalendar}; finns i calendar_dates: ${inDates}`);
const metroDates = calDates.filter((d) => metroServices.has(d.service_id)).map((d) => d.date).sort();
console.log(`calendar_dates för metro-service: ${metroDates.length} rader, ${metroDates[0] ?? '-'} .. ${metroDates.at(-1) ?? '-'}`);
const svcDays = new Map();
for (const d of calDates) if (metroServices.has(d.service_id) && d.exception_type === '1') svcDays.set(d.service_id, (svcDays.get(d.service_id) ?? 0) + 1);
console.log('datum per metro-service (exception_type 1):', Object.fromEntries(svcDays));

// --- över 24:00 ---
h('stop_times över 24:00:00 (metro)');
console.log(`antal rader: ${over24Count}`);
for (const l of over24) console.log(l);

h('Tidsmonotoni');
console.log(`rader där tiden minskar inom ett trip: ${nonMonotonic}`);

// --- stops-kvalitet ---
h('Stops (metro)');
const mStops = [...stopIdsAll].map((id) => stops.get(id));
const noStop = [...stopIdsAll].filter((id) => !stops.has(id));
const noCoord = mStops.filter((s) => s && (!s.stop_lat || !s.stop_lon));
console.log(`stop_id i stop_times som saknas i stops.txt: ${noStop.length}`);
console.log(`stops utan koordinater: ${noCoord.length}`);
console.log(`location_type-fördelning:`, mStops.reduce((a, s) => ((a[s?.location_type || '0'] = (a[s?.location_type || '0'] ?? 0) + 1), a), {}));
console.log(`med parent_station: ${mStops.filter((s) => s?.parent_station).length}`);
const lat = mStops.map((s) => +s.stop_lat), lon = mStops.map((s) => +s.stop_lon);
console.log(`lat ${Math.min(...lat)}..${Math.max(...lat)}  lon ${Math.min(...lon)}..${Math.max(...lon)}`);
const linesByStop = new Map();
for (const [key, ids] of stopsByKey) for (const id of ids) {
  const s = linesByStop.get(id) ?? new Set();
  s.add(routeName(key.split('|')[0]));
  linesByStop.set(id, s);
}
const shared = [...linesByStop].filter(([, s]) => s.size > 1);
console.log(`stop_id som delas av flera linjer: ${shared.length}`, shared.slice(0, 8).map(([id, s]) => `${id}[${[...s]}]`).join(' '));
// samma plats under olika stop_id (bytesstationer)?
const byCoord = new Map();
for (const id of stopIdsAll) { const s = stops.get(id); const k = `${(+s.stop_lat).toFixed(3)},${(+s.stop_lon).toFixed(3)}`; byCoord.set(k, [...(byCoord.get(k) ?? []), `${id}[${[...linesByStop.get(id)]}]`]); }
const clusters = [...byCoord.values()].filter((v) => v.length > 1);
console.log(`platser (~100 m) med flera stop_id: ${clusters.length}`, clusters.slice(0, 6).map((v) => v.join(' + ')).join(' | '));

h('Trips på grova shapes (<20 punkter)');
for (const [id] of lowRes) console.log(id, [...tripInfo.values()].filter((t) => t.shape === id).length, 'trips');

h('service_id-prefix per linje (idag)');
for (const r of metro) console.log(r.route_short_name, [...new Set([...tripInfo.values()].filter((t) => t.route === r.route_id && active.has(t.service)).map((t) => t.service))].join(', '));

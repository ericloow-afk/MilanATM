import '../styles/tokens.css';
import '../styles/components.css';
import './ar.css';
import { activeTrips, dataStatus, trains, type MetroData } from '../engine';
import type { FusedTrain } from '../engine/fuse';
import { sourceLabel, sourceNote } from '../realtime/label';
import { RealtimeSession, SOURCE_NAMES } from '../realtime/session';
import { browserStore } from '../realtime/store';
import { isoToYmd, romeDate, romeServiceTime } from '../engine/time';
import { depthFor } from '../depth';
import { referenceHeading } from '../geo/orientation';
import { OrientationFilter } from './filter';
import { aimHint, shouldShowAim } from './aim';
import { AR_CONFIG, PLATFORM } from './config';
import { makeStationMode, nearestStations, nextTrainText, platformDirections, searchStations, SIM_PLATFORMS, type StationMode } from './station';
import { GpsFilter, GpsStatus } from './gps-filter';
import { LogRecorder, type LogRow } from './log';
import { nearbyTrains, type NearbyTrain } from './nearby';
import { edgeIndicator } from './overlay';
import { ArScene, EYE_HEIGHT_M } from './scene';
import { RealSource } from './sensors';
import { SimSource, type SimPlace } from './sim';
import type { SensorSource, SourceReading } from './source';
import { ArUi, type HudState, type LabelItem } from './ui';
import { fmtDate, fmtDist, fmtHMS } from '../map/format';
import { lineBadge, lineLabel } from '../ui/line-badge';
import { arrivalsHtml, arrivalsKey, confirmText, updateArrivalTexts, type ArrivalRow } from '../ui/arrivals';
import { csvFilename, exportCsv } from '../ui/download';
import { haversine } from '../geo';

const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
const DEBUG = new URLSearchParams(location.search).get('debug') === '1';
const RADIUS_M = AR_CONFIG.radiusM;
let fovDeg: number = AR_CONFIG.fovVerticalDeg;
const MANUAL_KEY = 'ar.manualDeg';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const video = document.getElementById('cam') as HTMLVideoElement;
const bg = document.getElementById('bg') as HTMLElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

const scene = new ArScene(canvas);
scene.setFov(AR_CONFIG.fovVerticalDeg);
const filter = new OrientationFilter();
let metro: MetroData | null = null;
let rt: RealtimeSession | null = null;
/** perrongläget (station och riktning), eller null = vanligt GPS-läge */
let station: StationMode | null = null;
let source: SensorSource | null = null;
let nearby: NearbyTrain[] = [];
let userPos: { lat: number; lon: number } | null = null;
let lastReadingNow = new Date();
let gpsAccuracy: number | null = null;
/** utjämnad GPS (riktiga sensorer; simulatorns position är exakt och går förbi filtret) */
const gps = new GpsFilter();
let gpsStatus = new GpsStatus(Date.now());
let lastReading: SourceReading | null = null;
let trainsInView = 0;
const recorder = new LogRecorder(30_000, 200);
const keys = new Set<string>();

/** En loggrad av nuvarande tillstånd (senaste sensoravläsning + filtrets skattning). */
function makeRow(): LogRow {
  const r = lastReading;
  const o = r?.orientation ?? null;
  return {
    timeMs: Date.now(),
    lat: r?.position?.lat ?? null,
    lon: r?.position?.lon ?? null,
    gpsAcc: r?.position?.accuracy ?? null,
    rawCompass: o?.compass ?? null,
    compassAcc: o?.compassAccuracy ?? null,
    alpha: o?.alpha ?? null,
    beta: o?.beta ?? null,
    gamma: o?.gamma ?? null,
    filteredYaw: o ? referenceHeading(filter.quaternion) : null,
    yawOffset: filter.yawDeg,
    manual: filter.manualDeg,
    trainsInView,
    mark: false,
    fLat: userPos?.lat ?? null,
    fLon: userPos?.lon ?? null,
    fAcc: gps.estimate?.accuracy ?? null,
    mode: station ? 'station' : 'gps',
    source: source?.kind ?? 'real',
    buildId: BUILD_ID,
  };
}
const recLabel = () =>
  recorder.active ? `Spelar ${recorder.remainingSec(Date.now())} s (${recorder.rowCount})` : `Spela in 30 s${recorder.rowCount ? ` (${recorder.rowCount} rader)` : ''}`;

// ---------- hjälpare ----------
const fmtRome = (d: Date) => fmtHMS(romeServiceTime(d).sec);
const stopName = (id: string) => metro?.stops.find((s) => s.id === id)?.name ?? id;
const dirName = (id: string) => metro?.directions.find((d) => d.id === id)?.name ?? id;
/** Visningsfärg per linje ur tokens (M4 är ljusnad mot GTFS-färgen så att den syns). */
const lineColor = (id: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(`--line-m${id.replace(/^M/, '')}`).trim() || (metro?.lines.find((l) => l.id === id)?.color ?? '#ffffff');
const lineName = (id: string) => lineLabel(id, metro?.lines.find((l) => l.id === id)?.name);

try {
  const saved = Number(localStorage.getItem(MANUAL_KEY));
  if (Number.isFinite(saved) && saved !== 0) filter.nudgeManual(saved);
} catch {
  /* localStorage kan saknas (privat läge) */
}
const persistManual = () => {
  try {
    localStorage.setItem(MANUAL_KEY, String(filter.manualDeg));
  } catch {
    /* ignoreras */
  }
};

// ---------- UI ----------
const ui: ArUi = new ArUi(uiRoot, canvas, {
  onStartReal: () => void startReal(),
  onStartSim: () => startSim(),
  onSwitchSource: () => (source?.kind === 'sim' ? void startReal() : startSim()),
  onCalibrateDrag: (dx) => {
    filter.nudgeManual(-dx * 0.15);
    persistManual();
  },
  onResetCalibration: () => {
    filter.resetManual();
    persistManual();
  },
  onFov: (deg) => {
    fovDeg = deg;
    scene.setFov(deg);
  },
  onRecord: () => {
    if (!source) {
      ui.setRecordUi({ recording: false, label: recLabel(), canCopy: false, note: 'Starta AR eller simulator först.' });
      return;
    }
    recorder.start(Date.now());
    ui.hideCsv();
    ui.setCopyLabel('Kopiera logg');
    ui.setRecordUi({ recording: true, label: recLabel(), canCopy: false, note: 'Tryck Markera när kameran pekar mot känd riktning/ingång.' });
  },
  onMark: () => {
    const ok = recorder.mark(Date.now(), makeRow);
    ui.setRecordUi({ recording: recorder.active, label: recLabel(), canCopy: false, note: ok ? `Markerat (${recorder.markCount})` : 'Starta inspelning först.' });
  },
  onCopy: () => void copyLog(),
  onSelectTrain: () => {},
  onSimJumpNextTrain: () => jumpToNextTrain(),
  onSimTimePreset: (kind) => {
    if (source?.kind !== 'sim') return;
    const sim = source as SimSource;
    const ymd = romeServiceTime(sim.time).ymd;
    sim.setTime(romeDate(ymd, kind === 'noon' ? 12 * 3600 : kind === 'evening' ? 18 * 3600 : 30 * 60));
  },
  onStartPlatform: () => {
    void startReal(); // sensortillstånden måste begäras direkt i klicket
    openPicker();
  },
  onPlatform: () => openPicker(),
  onAlignTrack: () => alignTrack(),
  onExitPlatform: () => exitStation(),
}, DEBUG);
ui.setMode(null);
ui.onTap = (x, y) => {
  const rect = canvas.getBoundingClientRect();
  let best: { id: string; d: number } | null = null;
  for (const n of nearby) {
    const v = scene.viewOf(n.train.id);
    if (!v || v.behind) continue;
    const d = Math.hypot(v.px - (x - rect.left), v.py - (y - rect.top));
    if (d < 56 && (!best || d < best.d)) best = { id: n.train.id, d };
  }
  ui.selectTrain(best?.id ?? null);
  if (!best) ui.showInfo(null);
};
// ---------- "Tåget kom nu" vid närmaste station ----------
const ARRIVE_RADIUS_M = 500;
let arriveConfirm: { text: string; undo: boolean } | null = null;
let arriveKey = '';
let arriveStation: string | null = null;

function nearestStop(): { id: string; name: string; d: number } | null {
  if (!metro || !userPos) return null;
  let best: { id: string; name: string; d: number } | null = null;
  for (const s of metro.stops) {
    const d = haversine(userPos.lat, userPos.lon, s.lat, s.lon);
    if (d <= ARRIVE_RADIUS_M && (!best || d < best.d)) best = { id: s.id, name: s.name, d };
  }
  return best;
}

/** Ritar panelen (anropas ungefär en gång per sekund när den är öppen). Bara texterna uppdateras om strukturen är densamma. */
function renderArrive(): void {
  if (!metro || !rt || !ui.arriveOpen) return;
  const near = nearestStop();
  const body = ui.arriveBody;
  if (!near) {
    ui.setArriveHead('Ingen station i närheten', userPos ? `Ingen metrostation inom ${ARRIVE_RADIUS_M} m.` : 'Väntar på position (GPS).', '');
    arriveStation = null;
    arriveKey = 'none';
    if (body.dataset.k !== 'none') {
      body.dataset.k = 'none';
      body.innerHTML = `<p class="arr-hint muted">Gå närmare en station (eller välj en plats i simulatorn).</p><div class="arr-log"><span class="muted">Logg: <span class="num">${rt.log.size}</span> observationer</span><button type="button" class="btn secondary" data-export${rt.log.size ? '' : ' disabled'}>Exportera CSV</button></div>`;
    }
    return;
  }
  if (near.id !== arriveStation) arriveConfirm = null;
  arriveStation = near.id;
  const lines = [...new Set(metro.patterns.filter((p) => p.stops.some((s) => metro!.stops[s].id === near.id)).map((p) => p.line))].sort();
  ui.setArriveHead(near.name, `${fmtDist(near.d)} härifrån`, lines.map((l) => lineBadge(l, lineName(l), 'sm')).join(''));
  const now = lastReadingNow.getTime();
  const rows: ArrivalRow[] = rt.upcoming(near.id, now).map((u) => {
    const line = metro!.directions.find((d) => d.id === u.direction)?.line ?? '';
    return {
      direction: u.direction,
      directionName: dirName(u.direction),
      line,
      lineLabel: lineName(line),
      trains: u.trains.map((t) => ({ etaMs: t.etaMs, atStation: t.atStation, source: t.run.source, delaySec: t.delaySec })),
    };
  });
  const state = { rows, now, canAdjust: true, confirm: arriveConfirm, logCount: rt.log.size };
  const key = `${near.id}:${arrivalsKey(state)}`;
  if (key === arriveKey && body.dataset.k === key) {
    updateArrivalTexts(body, state);
    return;
  }
  arriveKey = key;
  body.dataset.k = key;
  body.innerHTML = arrivalsHtml(state);
}

ui.arrivePanel.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!btn || !metro || !rt) return;
  if (btn.dataset.arrive && arriveStation) {
    const dir = metro.directions.find((d) => d.id === btn.dataset.arrive);
    if (!dir) return;
    // Simulatorn stämplar med simulerad tid, sensorläget med verklig tid
    const res = rt.trainArrived({ line: dir.line, direction: dir.id, stopId: arriveStation, now: lastReadingNow.getTime() });
    arriveConfirm = res.ok
      ? { text: confirmText(lineName(dir.line), dir.name, res.match.delaySec) + (res.savedToDevice ? '' : ' (kunde inte sparas på enheten)'), undo: true }
      : { text: `Hittade inget tåg mot ${dir.name} inom 10 minuter i tidtabellen.`, undo: false };
  } else if (btn.hasAttribute('data-undo')) {
    rt.undoLast(lastReadingNow.getTime());
    arriveConfirm = { text: 'Justeringen är ångrad.', undo: false };
  } else if (btn.hasAttribute('data-export')) {
    void exportCsv(rt.log.toCsv(), csvFilename()).then((how) => {
      arriveConfirm = { text: how === 'file' ? `Loggen sparad som fil (${rt!.log.size} rader).` : how === 'clipboard' ? 'Loggen kopierad till urklipp.' : 'Det gick inte att exportera loggen.', undo: false };
      arriveKey = '';
      renderArrive();
    });
    return;
  } else return;
  arriveKey = '';
  renderArrive();
});
ui.onArriveToggle = (open) => {
  if (open) {
    arriveKey = '';
    renderArrive();
  }
};

ui.onLook = (dx, dy) => {
  if (source?.kind === 'sim') (source as SimSource).look(-dx * 0.25, dy * 0.25);
};
window.addEventListener('resize', () => scene.resize());
window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

async function copyLog(): Promise<void> {
  const csv = recorder.toCsv();
  try {
    await navigator.clipboard.writeText(csv);
    ui.setCopyLabel(`Kopierat! (${recorder.rowCount} rader)`);
  } catch (e) {
    source?.errors.push(`urklipp: ${e instanceof Error ? e.message : String(e)}`);
    ui.showCsv(csv); // markera och kopiera manuellt
    ui.setCopyLabel('Markera & kopiera ovan');
  }
}

// ---------- källor ----------
function simPlaces(): SimPlace[] {
  if (!metro) return [];
  const want = ['DUOMO M1', 'CADORNA FN M1', 'CENTRALE FS', 'GARIBALDI FS', 'LOTTO M5', 'SAN BABILA'];
  return want
    .map((id) => metro!.stops.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => ({ name: s.name, lat: s.lat, lon: s.lon }));
}

function setSource(next: SensorSource): void {
  source?.stop();
  source = next;
  gps.reset();
  gpsStatus = new GpsStatus(Date.now());
  userPos = null;
  nearby = [];
  scene.setTrains([], lineColor, () => 0);
  ui.setMode(next.kind);
  ui.hideStart();
  video.hidden = next.kind !== 'real';
  bg.hidden = next.kind === 'real';
}

function startSim(): void {
  if (!metro) return;
  const places = simPlaces();
  const first = places[0] ?? { name: 'Milano', lat: 45.4642, lon: 9.19 };
  let t = new Date();
  if (dataStatus(metro, t) !== 'ok') t = romeDate(isoToYmd(metro.meta.validFrom), 12 * 3600); // tidtabellen har gått ut: starta inom giltigheten
  const sim = new SimSource(first, t);
  setSource(sim);
  ui.bindSim(sim, places);
}

async function startReal(): Promise<void> {
  const real = new RealSource();
  const starting = real.start(video); // anropas synkront från klicket
  setSource(real);
  await starting;
}

function jumpToNextTrain(): void {
  if (!metro || source?.kind !== 'sim' || !userPos) return;
  const sim = source as SimSource;
  const present = new Set(nearby.map((n) => n.train.id));
  const t0 = sim.time.getTime();
  for (let s = 5; s <= 7200; s += 5) {
    const at = new Date(t0 + s * 1000);
    const hit = nearbyTrains(trains(metro, at), userPos, RADIUS_M).find((n) => !present.has(n.train.id));
    if (hit) {
      sim.setTime(new Date(at.getTime() - 20_000));
      return;
    }
  }
  sim.errors.push('Inget nytt tåg inom 2 timmar.');
}

// ---------- huvudloop ----------
let last = performance.now();
let lastEngine = 0;
let lastArriveRender = 0;

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (source && metro) {
    if (source.kind === 'sim') stepSimKeys(source as SimSource, dt);
    const r = source.read(dt);
    lastReading = r;
    lastReadingNow = r.now;
    if (r.orientation) filter.update(dt, r.orientation);
    scene.setOrientation(filter.quaternion);
    updatePosition(r);
    if (userPos && now - lastEngine > 100) {
      lastEngine = now;
      nearby = nearbyTrains(currentTrains(r.now), userPos, RADIUS_M);
      // perrongläget: tågen på perrongens nivå (tågets mitt PLATFORM.relativeDepthM under ögonhöjd, uppskattning)
      scene.setTrains(nearby, lineColor, station ? () => PLATFORM.relativeDepthM - EYE_HEIGHT_M : (l) => depthFor(l).meters);
    }
    scene.render();
    updateOverlay(r.orientation != null);
    if (ui.arriveOpen && now - lastArriveRender > 1000) {
      lastArriveRender = now;
      renderArrive();
    }
    if (recorder.active) {
      const done = recorder.tick(Date.now(), makeRow);
      ui.setRecordUi({ recording: !done, label: recLabel(), canCopy: recorder.rowCount > 0, ...(done ? { note: `Klar: ${recorder.rowCount} rader, ${recorder.markCount} markeringar` } : {}) });
    }
  } else {
    scene.render();
  }
  requestAnimationFrame(frame);
}

/**
 * Tågen vid `at` efter realtidslagret. Utan observationer: samma positioner som trains(metro, at).
 * Källorna frågas i verklig tid (nätkällor högst var 30:e s); observationer stämplas med vyns klocka (simulerad i simulatorn).
 */
function currentTrains(at: Date): FusedTrain[] {
  if (!metro || !rt) return [];
  const t = at.getTime();
  const out: FusedTrain[] = [];
  basisById.clear();
  for (const run of rt.fuseRuns(activeTrips(metro, at, 0), t)) {
    const tr = rt.position(run, t);
    if (tr) out.push(tr);
    if (run.basis) basisById.set(run.id, run.basis.source);
  }
  if (userPos) rt.setMockFocus(userPos.lat, userPos.lon); // bara mock-källan i dev
  rt.tick(t); // efter fuse: källorna ser samma trips (mock i dev); vyns klocka avgör vilka handjusteringar som gäller
  return out;
}
/** källa (observationens id) för justerade tåg, för info-panelen */
const basisById = new Map<string, string>();

/**
 * Position: simulatorns är exakt; riktiga GPS-fixar går genom GpsFilter (fixar sämre än 100 m ignoreras,
 * hopp jämnas ut). GpsStatus håller reda på "Svag GPS" och "Ingen GPS-fix".
 */
function updatePosition(r: SourceReading): void {
  const wall = Date.now();
  gpsAccuracy = r.position?.accuracy ?? null;
  gpsStatus.update(wall, gpsAccuracy);
  if (station) {
    // perrongläget: stationens koordinat, GPS används inte (under jord ger den ca 1,4 km fel)
    userPos = { lat: station.lat, lon: station.lon };
    return;
  }
  if (!r.position) return;
  if (source?.kind === 'sim') {
    // som verkligheten: en fix sämre än 100 m (simulatorns "Ingen fix") ger ingen position
    userPos = r.position.accuracy <= gps.config.maxAccuracyM ? { lat: r.position.lat, lon: r.position.lon } : null;
    return;
  }
  gps.update({ lat: r.position.lat, lon: r.position.lon, accuracy: r.position.accuracy, t: r.position.t ?? wall });
  const e = gps.estimate;
  userPos = e ? { lat: e.lat, lon: e.lon } : null;
}

function stepSimKeys(sim: SimSource, dt: number): void {
  const k = (n: string) => keys.has(n);
  const fwd = (k('w') || k('arrowup') ? 1 : 0) - (k('s') || k('arrowdown') ? 1 : 0);
  const right = (k('d') || k('arrowright') ? 1 : 0) - (k('a') || k('arrowleft') ? 1 : 0);
  if (fwd || right) sim.move(fwd * 20 * dt, right * 20 * dt);
}

function updateOverlay(haveOrientation: boolean): void {
  if (!metro || !source) return;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  const items: LabelItem[] = [];
  let arrows = 0;
  for (const n of nearby.slice(0, 14)) {
    const v = scene.viewOf(n.train.id);
    if (!v) continue;
    const e = edgeIndicator(v.x, v.y, v.behind, W, H, 44);
    if (!e.onScreen && ++arrows > 6) continue;
    const ft = n.train as FusedTrain;
    items.push({
      id: n.train.id,
      line: n.train.line,
      lineLabel: lineName(n.train.line),
      title: `mot ${dirName(n.train.direction)}`,
      dist: e.onScreen ? `${fmtDist(n.distance)} · ${sourceLabel(ft.source, ft.delaySec)}` : fmtDist(n.distance),
      onScreen: e.onScreen,
      x: e.x,
      y: e.onScreen ? e.y - 30 : e.y,
      angleRad: e.angleRad,
    });
  }
  ui.setLabels(items);
  trainsInView = items.filter((i) => i.onScreen).length;
  // Tåg finns men inget syns: säg åt vilket håll (oftast nedåt, tågen går ca 15 m under gatan)
  const nearestView = nearby.length ? scene.viewOf(nearby[0].train.id) : null;
  ui.setAim(nearestView && shouldShowAim(nearby.length, trainsInView, haveOrientation) ? aimHint(nearestView.x, nearestView.y, nearestView.behind) : null);

  // info-panel för valt tåg
  const sel = ui.selectedId();
  if (sel) {
    const n = nearby.find((x) => x.train.id === sel);
    if (!n) {
      ui.selectTrain(null);
    } else {
      const t = n.train as FusedTrain;
      const d = depthFor(t.line);
      const basis = basisById.get(t.id);
      ui.showInfo({
        line: t.line,
        lineLabel: lineName(t.line),
        title: `mot ${dirName(t.direction)}`,
        lines: [
          t.status === 'dwelling' ? `Står vid ${stopName(t.fromStation)}` : `${stopName(t.fromStation)} → ${stopName(t.toStation)} (${Math.round(t.progress * 100)} %)`,
          `Avstånd ${fmtDist(n.distance)}, ${Math.round(t.speedMps * 3.6)} km/h`,
          `Djup ca ${d.meters} m (uppskattat)`,
          `${sourceNote(t.source, t.delaySec, basis ? (SOURCE_NAMES[basis] ?? basis) : undefined)}${t.shapeQuality === 'coarse' ? ' Ungefärlig position (grov spårgeometri).' : ''}`,
        ],
      });
    }
  }

  // HUD: en kort rad; tekniken ligger i den utfällbara raden (öppen i ?debug=1)
  const status = dataStatus(metro, lastReadingNow);
  const compassText = {
    ok: 'ok',
    uncalibrated: 'okalibrerad (ignoreras)',
    inaccurate: 'för osäker (ignoreras)',
    'looking-up': 'tittar uppåt (ignoreras)',
    'looking-down': 'tittar brant nedåt (ignoreras)',
    disabled: 'används inte (perrongläge, bara gyro)',
    moving: 'snabb vridning (ignoreras)',
    jump: 'språng avvisat',
    none: 'saknas',
  }[filter.compassState];
  const statusText = status === 'ok' ? 'giltig' : status === 'expired' ? 'har gått ut' : 'gäller inte än';
  const hud: HudState = {
    summary: station
      ? `Perrong ${station.name}${station.aligned ? '' : ' · inte riktad'}`
      : (nearby.length === 0 ? `Inga tåg inom ${RADIUS_M} m` : `${nearby.length} tåg inom ${RADIUS_M} m`) +
        (gpsStatus.weak && gpsAccuracy != null ? ` · Svag GPS ±${Math.round(gpsAccuracy)} m` : ''),
    details: [
      ['Källa', source.kind === 'real' ? 'sensorer' : 'simulator'],
      ['GPS', gpsAccuracy == null ? 'väntar på position' : `±${Math.round(gpsAccuracy)} m${gpsAccuracy > 100 ? ' (används inte)' : source.kind === 'real' && gps.estimate ? `, utjämnad ±${Math.round(gps.estimate.accuracy)} m` : ''}`],
      ['Kompass', `${compassText}, fel ${filter.headingError.toFixed(1)}°, manuell ${filter.manualDeg.toFixed(1)}°`],
      ['Tid (Rom)', fmtRome(lastReadingNow)],
      ['Tidtabell', `${statusText}, till ${fmtDate(metro.meta.validTo)}`],
      ['Läge', station ? `perrong ${station.name}, ${lineName(station.line)} mot ${station.terminusName}; mot tåget ${Math.round(station.approachDeg)}°` : 'GPS'],
      ['Djup', station ? `tågets mitt ca ${PLATFORM.relativeDepthM} m under ögonhöjd (uppskattat)` : `ca ${depthFor('M1').meters} m (uppskattat)`],
      ['Synfält', `${fovDeg}° lodrätt${fovDeg === AR_CONFIG.fovVerticalDeg ? ' (uppmätt ca, stående)' : ' (kalibrerat)'}`],
      ['Bygge', BUILD_ID],
    ],
  };
  ui.setHud(hud);
  ui.setCalibrationReadout(`Manuell offset ${filter.manualDeg.toFixed(1)}°, yaw ${filter.yawDeg.toFixed(1)}°`);
  ui.setErrors(source.errors);
  if (source.kind === 'sim') ui.syncSim(source as SimSource, fmtRome((source as SimSource).time));

  if (status === 'expired') ui.setBanner(`Tidtabellen har gått ut (gällde till ${fmtDate(metro.meta.validTo)}). Inga tåg visas.`);
  else if (status === 'notYetValid') ui.setBanner(`Tidtabellen gäller först från ${fmtDate(metro.meta.validFrom)}. Inga tåg visas.`);
  else if (!station && gpsStatus.noFix(Date.now()))
    // ingen fix på mer än 5 s: föreslå perrongläget, men byt inte automatiskt
    ui.setBanner('Ingen GPS-fix. Är du på en perrong?', { tone: 'muted', action: 'Välj station' });
  else if (!userPos) ui.setBanner('Väntar på position (GPS).');
  else if (!haveOrientation) ui.setBanner('Väntar på orientering. Ge tillstånd för rörelse och orientering.');
  else ui.setBanner(null);

  if (station && performance.now() - lastPlatformRender > 500) {
    lastPlatformRender = performance.now();
    renderPlatform();
  }
}

// ---------- perrongläget ----------
let lastPlatformRender = 0;
let alignNote = '';
let pickerStop: string | null = null;
const escAttr = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function renderPlatform(): void {
  if (!station || !rt || !metro) return ui.setPlatform(null);
  const now = lastReadingNow.getTime();
  const st = station;
  const up = rt.upcoming(st.stopId, now, 30 * 60, 1).find((u) => u.direction === st.direction);
  const next = up?.trains[0] ?? null;
  ui.setPlatform({
    badge: lineBadge(st.line, lineName(st.line), 'md'),
    name: st.name,
    dir: `mot ${st.terminusName}`,
    next: nextTrainText(next, now),
    src: next ? sourceLabel(next.run.source, next.delaySec) : '',
    hint: st.aligned
      ? alignNote || 'Riktad längs spåret. Kompassen används inte här, bara gyrot. Rikta om om vyn har glidit.'
      : alignNote || `Rikta kameran längs perrongen mot det håll tåget kommer ifrån${st.fromName ? ` (från ${st.fromName})` : ''} och tryck.`,
    aligned: st.aligned,
  });
}

function enterStation(mode: StationMode): void {
  station = mode;
  alignNote = '';
  filter.setCompassEnabled(false);
  if (source?.kind === 'sim') (source as SimSource).teleport({ name: mode.name, lat: mode.lat, lon: mode.lon });
  userPos = { lat: mode.lat, lon: mode.lon };
  nearby = [];
  ui.showPicker(false);
  lastPlatformRender = 0;
  renderPlatform();
}

function exitStation(): void {
  station = null;
  filter.setCompassEnabled(true);
  gps.reset();
  userPos = null;
  nearby = [];
  ui.setPlatform(null);
}

function alignTrack(): void {
  if (!station) return;
  if (filter.alignForward(station.approachDeg)) {
    station.aligned = true;
    alignNote = '';
  } else {
    alignNote = 'Håll telefonen upprätt och rikta kameran längs perrongen, inte brant nedåt, och försök igen.';
  }
  lastPlatformRender = 0;
  renderPlatform();
}

function openPicker(): void {
  pickerStop = null;
  (ui.picker.querySelector('#picker-q') as HTMLInputElement).value = '';
  ui.showPicker(true);
  renderPicker();
}

function stationRow(s: { stopId: string; name: string; lines: string[] }, extra = ''): string {
  const badges = s.lines.map((l) => lineBadge(l, lineName(l), 'sm')).join('');
  return `<button type="button" class="picker-row" data-stop="${escAttr(s.stopId)}"><span class="pr-badges">${badges}</span><span class="pr-text"><span>${escAttr(s.name)}</span></span>${extra}</button>`;
}

function renderPicker(): void {
  if (!metro) return;
  const data = metro;
  const list = ui.picker.querySelector('#picker-list') as HTMLElement;
  const q = ui.picker.querySelector('#picker-q') as HTMLInputElement;
  const back = ui.picker.querySelector('#picker-back') as HTMLElement;
  const title = ui.picker.querySelector('#picker-title') as HTMLElement;
  if (pickerStop) {
    const stop = data.stops.find((s) => s.id === pickerStop)!;
    title.textContent = `${stop.name}: riktning`;
    q.hidden = true;
    back.hidden = false;
    const dirs = platformDirections(data, pickerStop);
    list.innerHTML = dirs.length
      ? '<p class="picker-sec">Vilket tåg väntar du på?</p>' +
        dirs
          .map(
            (d) =>
              `<button type="button" class="picker-row" data-dir="${escAttr(d.direction)}"><span class="pr-badges">${lineBadge(d.line, lineName(d.line), 'sm')}</span><span class="pr-text"><span>mot ${escAttr(d.terminusName)}</span><span class="pr-sub">${d.fromName ? `kommer från ${escAttr(d.fromName)}` : 'startar här'}</span></span></button>`,
          )
          .join('')
      : '<p class="picker-empty">Inga tåg utgår eller passerar här.</p>';
    return;
  }
  title.textContent = 'Välj station';
  q.hidden = false;
  back.hidden = true;
  const parts: string[] = [];
  const query = q.value.trim();
  if (!query) {
    const here = source?.kind === 'sim' ? { lat: (source as SimSource).lat, lon: (source as SimSource).lon } : gps.estimate;
    const near = here ? nearestStations(data, here.lat, here.lon) : [];
    if (near.length) parts.push('<p class="picker-sec">Närmast</p>' + near.map((s) => stationRow(s, `<span class="pr-dist num">${fmtDist(s.distM)}</span>`)).join(''));
    if (source?.kind === 'sim') {
      const presets = SIM_PLATFORMS.map((p) => makeStationMode(data, p.stopId, p.direction)).filter((x): x is StationMode => !!x);
      parts.push(
        '<p class="picker-sec">Förinställda (simulator)</p>' +
          presets
            .map(
              (p) =>
                `<button type="button" class="picker-row" data-preset="${escAttr(p.stopId)}|${escAttr(p.direction)}"><span class="pr-badges">${lineBadge(p.line, lineName(p.line), 'sm')}</span><span class="pr-text"><span>${escAttr(p.name)}</span><span class="pr-sub">mot ${escAttr(p.terminusName)}</span></span></button>`,
            )
            .join(''),
      );
    }
  }
  const found = searchStations(data, query);
  parts.push(
    `<p class="picker-sec">${query ? `Träffar (${found.length})` : 'Alla stationer'}</p>` +
      (found.length ? found.map((s) => stationRow(s)).join('') : '<p class="picker-empty">Ingen station matchar.</p>'),
  );
  list.innerHTML = parts.join('');
}

ui.picker.addEventListener('input', (e) => {
  if ((e.target as HTMLElement).id === 'picker-q') renderPicker();
});
ui.picker.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!b || !metro) return;
  if (b.id === 'picker-back') {
    pickerStop = null;
    renderPicker();
  } else if (b.dataset.stop) {
    pickerStop = b.dataset.stop;
    const dirs = platformDirections(metro, pickerStop);
    if (dirs.length === 1) {
      const mode = makeStationMode(metro, pickerStop, dirs[0].direction);
      if (mode) enterStation(mode);
    } else renderPicker();
  } else if (b.dataset.dir && pickerStop) {
    const mode = makeStationMode(metro, pickerStop, b.dataset.dir);
    if (mode) enterStation(mode);
  } else if (b.dataset.preset) {
    const [stopId, dir] = b.dataset.preset.split('|');
    const mode = makeStationMode(metro, stopId, dir);
    if (mode) enterStation(mode);
  }
});

// ---------- start ----------
async function main(): Promise<void> {
  try {
    const res = await fetch(new URL('metro.json', document.baseURI));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    metro = (await res.json()) as MetroData;
  } catch (e) {
    ui.setErrors([`metro.json: ${e instanceof Error ? e.message : String(e)}`]);
    return;
  }
  rt = new RealtimeSession({
    data: metro,
    store: browserStore(),
    env: {
      officialUrl: import.meta.env.VITE_RT_OFFICIAL_URL,
      officialKey: import.meta.env.VITE_RT_OFFICIAL_KEY,
      officialKeyHeader: import.meta.env.VITE_RT_OFFICIAL_KEY_HEADER,
      statusUrl: import.meta.env.VITE_RT_STATUS_URL,
      statusKey: import.meta.env.VITE_RT_STATUS_KEY,
      statusKeyHeader: import.meta.env.VITE_RT_STATUS_KEY_HEADER,
    },
    mock: import.meta.env.DEV && new URLSearchParams(location.search).get('rt') === 'mock',
    isHidden: () => document.hidden,
  });
  const params = new URLSearchParams(location.search);
  if (params.get('sim') === '1') {
    startSim();
    // ?sim=1&perrong=1 (Maciachini, M3 mot Comasina) eller &perrong=<stop_id>&riktning=<riktnings-id>
    const p = params.get('perrong');
    if (p) {
      const id = p.toUpperCase();
      const preset = p === '1' ? SIM_PLATFORMS[0] : { stopId: id, direction: params.get('riktning') ?? platformDirections(metro, id)[0]?.direction ?? '' };
      const mode = makeStationMode(metro, preset.stopId, preset.direction);
      if (mode) enterStation(mode);
      else ui.setErrors([`perrong: okänd station eller riktning (${p})`]);
    }
  }
  requestAnimationFrame(frame);
}
void main();

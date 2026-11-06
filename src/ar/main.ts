import { dataStatus, trains, type MetroData } from '../engine';
import { isoToYmd, romeDate, romeServiceTime } from '../engine/time';
import { depthFor } from '../depth';
import { OrientationFilter } from './filter';
import { nearbyTrains, type NearbyTrain } from './nearby';
import { edgeIndicator } from './overlay';
import { ArScene } from './scene';
import { RealSource } from './sensors';
import { SimSource, type SimPlace } from './sim';
import type { SensorSource } from './source';
import { ArUi, type LabelItem } from './ui';

const RADIUS_M = 300;
const MANUAL_KEY = 'ar.manualDeg';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const video = document.getElementById('cam') as HTMLVideoElement;
const bg = document.getElementById('bg') as HTMLElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

const scene = new ArScene(canvas);
const filter = new OrientationFilter();
let metro: MetroData | null = null;
let source: SensorSource | null = null;
let nearby: NearbyTrain[] = [];
let userPos: { lat: number; lon: number } | null = null;
let lastReadingNow = new Date();
let gpsAccuracy: number | null = null;
let statusText = '';
const keys = new Set<string>();

// ---------- hjälpare ----------
const fmtRome = (d: Date) => {
  const { sec } = romeServiceTime(d);
  const p = (n: number) => String(Math.floor(n)).padStart(2, '0');
  return `${p(sec / 3600)}:${p((sec % 3600) / 60)}:${p(sec % 60)}`;
};
const stopName = (id: string) => metro?.stops.find((s) => s.id === id)?.name ?? id;
const dirName = (id: string) => metro?.directions.find((d) => d.id === id)?.name ?? id;
const lineColor = (id: string) => metro?.lines.find((l) => l.id === id)?.color ?? '#ffffff';
const lineName = (id: string) => `M${metro?.lines.find((l) => l.id === id)?.name ?? id}`;

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
  onFov: (deg) => scene.setFov(deg),
  onSelectTrain: () => {},
  onSimJumpNextTrain: () => jumpToNextTrain(),
  onSimTimePreset: (kind) => {
    if (source?.kind !== 'sim') return;
    const sim = source as SimSource;
    const ymd = romeServiceTime(sim.time).ymd;
    sim.setTime(romeDate(ymd, kind === 'noon' ? 12 * 3600 : kind === 'evening' ? 18 * 3600 : 30 * 60));
  },
});
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
ui.onLook = (dx, dy) => {
  if (source?.kind === 'sim') (source as SimSource).look(-dx * 0.25, dy * 0.25);
};
window.addEventListener('resize', () => scene.resize());
window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

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
  nearby = [];
  scene.setTrains([], lineColor, () => 0);
  ui.setSourceButton(next.kind);
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
  ui.unbindSim();
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

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (source && metro) {
    if (source.kind === 'sim') stepSimKeys(source as SimSource, dt);
    const r = source.read(dt);
    lastReadingNow = r.now;
    if (r.orientation) filter.update(dt, r.orientation);
    scene.setOrientation(filter.quaternion);
    if (r.position) {
      userPos = r.position;
      gpsAccuracy = r.position.accuracy;
    }
    if (userPos && now - lastEngine > 100) {
      lastEngine = now;
      nearby = nearbyTrains(trains(metro, r.now), userPos, RADIUS_M);
      scene.setTrains(nearby, lineColor, (l) => depthFor(l).meters);
    }
    scene.render();
    updateOverlay(r.orientation != null);
  } else {
    scene.render();
  }
  requestAnimationFrame(frame);
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
    const text = `<b>${lineName(n.train.line)}</b> → ${dirName(n.train.direction)}<br>${Math.round(n.distance)} m`;
    items.push({
      id: n.train.id,
      text: e.onScreen ? text : `<b>${lineName(n.train.line)}</b> ${Math.round(n.distance)} m`,
      color: lineColor(n.train.line),
      onScreen: e.onScreen,
      x: e.x,
      y: e.onScreen ? e.y - 30 : e.y,
      angleRad: e.angleRad,
    });
  }
  ui.setLabels(items);

  // info-panel för valt tåg
  const sel = ui.selectedId();
  if (sel) {
    const n = nearby.find((x) => x.train.id === sel);
    if (!n) {
      ui.selectTrain(null);
    } else {
      const t = n.train;
      const d = depthFor(t.line);
      ui.showInfo({
        title: `${lineName(t.line)} mot ${dirName(t.direction)}`,
        color: lineColor(t.line),
        lines: [
          t.status === 'dwelling' ? `Står vid ${stopName(t.fromStation)}` : `${stopName(t.fromStation)} → ${stopName(t.toStation)} (${Math.round(t.progress * 100)} %)`,
          `Avstånd ${Math.round(n.distance)} m, bäring ${Math.round(n.bearingDeg)}°, ${Math.round(t.speedMps * 3.6)} km/h`,
          `Djup ≈ ${d.meters} m (uppskattat, inte researchat)`,
          `Enligt tidtabell, inte realtid${t.shapeQuality === 'coarse' ? ' · ungefärlig position (grov spårgeometri)' : ''}`,
        ],
      });
    }
  }

  // HUD
  const status = dataStatus(metro, lastReadingNow);
  const cs = filter.compassState;
  const compassText =
    cs === 'ok' ? 'ok' : cs === 'uncalibrated' ? 'OKALIBRERAD (ignoreras)' : cs === 'inaccurate' ? 'för osäker (ignoreras)' : 'saknas';
  const accText = gpsAccuracy == null ? 'väntar på GPS…' : `±${Math.round(gpsAccuracy)} m ${gpsAccuracy <= 15 ? '●' : gpsAccuracy <= 30 ? '◐' : '○'}`;
  statusText = [
    `källa: ${source.kind === 'real' ? 'sensorer' : 'SIMULATOR'}   GPS ${accText}`,
    `kompass: ${compassText}  fel ${filter.headingError.toFixed(1)}°  manuell ${filter.manualDeg.toFixed(1)}°`,
    `tåg ≤${RADIUS_M} m: ${nearby.length}   tid (Rom): ${fmtRome(lastReadingNow)}`,
    `data: ${status} (t.o.m. ${metro.meta.validTo})`,
    `djup ≈ ${depthFor('M1').meters} m (uppskattat) · enligt tidtabell`,
  ].join('\n');
  ui.setHud(statusText);
  ui.setCalibrationReadout(`Manuell offset ${filter.manualDeg.toFixed(1)}°, yaw ${filter.yawDeg.toFixed(1)}°`);
  ui.setErrors(source.errors);
  if (source.kind === 'sim') ui.syncSim(source as SimSource, fmtRome((source as SimSource).time));

  ui.setBanner(
    status === 'expired'
      ? `Tidtabellen har gått ut (gällde t.o.m. ${metro.meta.validTo}). Inga tåg visas.`
      : status === 'notYetValid'
        ? `Tidtabellen gäller först från ${metro.meta.validFrom}. Inga tåg visas.`
        : !userPos
          ? 'Väntar på position (GPS)…'
          : !haveOrientation
            ? 'Väntar på orientering (tillstånd för rörelse/orientering?)'
            : null,
  );
}

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
  if (new URLSearchParams(location.search).get('sim') === '1') startSim();
  requestAnimationFrame(frame);
}
void main();

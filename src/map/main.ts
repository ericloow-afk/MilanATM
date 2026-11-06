import 'maplibre-gl/dist/maplibre-gl.css';
import '../styles/tokens.css';
import '../styles/components.css';
import './map.css';
import { LngLatBounds, Map as MapLibreMap, NavigationControl, setWorkerUrl, type IControl, type Map as MlMap } from 'maplibre-gl';
// MapLibre letar efter sin worker bredvid sin egen fil. Vites produktionsbygge kopierar inte dit den (gav 404 på GitHub Pages,
// så varken tiles eller våra linjer/stationer kunde ritas, bara DOM-markörerna). Importera den som egen fil och peka ut den.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { activeTrips, dataStatus, positionAt, type TripRun } from '../engine';
import { romeDate, romeServiceTime } from '../engine/time';
import type { MetroData, Train } from '../engine/types';
import { haversine } from '../geo';
import { TopBar, type BarAction } from './bar';
import { MapClock } from './clock';
import { esc, fmtCount, fmtDate, fmtDist, fmtHM } from './format';
import { lineBadge } from '../ui/line-badge';
import { TrainMarkers } from './markers';
import { addOverlays, setUserFix } from './overlays';
import { trainSchedule, validityInfo } from './schedule';
import { BottomSheet } from './sheet';
import { OFM_ATTRIBUTION, buildStyle, readMapPalette } from './style';
import { findNextTrafficMs } from './traffic';

setWorkerUrl(maplibreWorkerUrl);
const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

const TICK_MS = 1000;
/** Kontinuerlig väggklocka i epoch-ms (sub-ms upplösning, hoppar inte som Date.now() kan göra). */
const wallNow = () => performance.timeOrigin + performance.now();
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const app = document.getElementById('app') as HTMLElement;

// ---------- tillstånd ----------
let data: MetroData;
let map: MlMap;
let markers: TrainMarkers;
let sheet: BottomSheet;
const clock = new MapClock();
let selectedId: string | null = null;
let returnFocus: HTMLElement | null = null;
let userFix: { lat: number; lon: number; accuracy: number } | null = null;
let watchId: number | null = null;
/** aktiva trips; räknas om ungefär en gång per sekund */
let runs: TripRun[] = [];
/** tågens position i senaste bildrutan */
let curTrains = new Map<string, Train>();
let meta = curTrains;
let lastTick = -Infinity;
let lastMarkerUpdate = -Infinity;
let lastNoticeKey = '';
let nextTraffic: { forMinute: number; ms: number | null } | null = null;

const stopName = (id: string) => data.stops.find((s) => s.id === id)?.name ?? id;
const dirName = (id: string) => data.directions.find((d) => d.id === id)?.name ?? id;
const lineName = (id: string) => `M${data.lines.find((l) => l.id === id)?.name ?? id}`;
const describe = (t: Train) =>
  `${lineName(t.line)} mot ${dirName(t.direction)}, ${t.status === 'dwelling' ? `står vid ${stopName(t.fromStation)}` : `på väg från ${stopName(t.fromStation)} till ${stopName(t.toStation)}`}`;

// ---------- DOM: gemensamma element ----------
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html = '', attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  e.innerHTML = html;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
const live = el('div', 'sr', '', { 'aria-live': 'polite', role: 'status' });
const toastEl = el('div', 'toast panel', '', { role: 'status', 'aria-live': 'polite' });
toastEl.hidden = true;
let toastTimer = 0;
function toast(text: string): void {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), 6000);
}
function announce(text: string): void {
  live.textContent = '';
  setTimeout(() => (live.textContent = text), 50);
}

const bar = new TopBar({
  onAction: (a) => handleBarAction(a),
  onLongPress: () => togglePerf(),
});
const notice = el('div', 'notice panel', '', { role: 'region', 'aria-label': 'Trafikinformation' });
notice.hidden = true;

// ---------- synlig felbanner (ingen Safari-inspektör behövs) ----------
const diag = el(
  'div',
  'diag panel',
  `<div class="diag-head"><strong id="diag-title"></strong><button class="btn" type="button" data-diag-close aria-label="Stäng felmeddelandet">✕</button></div><ul id="diag-list"></ul>`,
  { role: 'alert' },
);
diag.hidden = true;
const diagMsgs: string[] = [];
let diagBackground = false;
let diagOverlay = false;
type DiagKind = 'tiles' | 'glyphs' | 'style' | 'worker' | 'overlay' | 'js';
const DIAG_LABEL: Record<DiagKind, string> = {
  tiles: 'Tiles',
  glyphs: 'Glyfer (kartetiketter)',
  style: 'Stil',
  worker: 'Kart-worker',
  overlay: 'Linjer/stationer',
  js: 'Skript',
};
function reportProblem(kind: DiagKind, message: string): void {
  if (kind === 'tiles' || kind === 'worker' || kind === 'style') diagBackground = true;
  if (kind === 'overlay' || kind === 'worker') diagOverlay = true;
  const line = `${DIAG_LABEL[kind]}: ${message}`.slice(0, 220);
  if (!diagMsgs.includes(line)) {
    diagMsgs.push(line);
    if (diagMsgs.length > 6) diagMsgs.shift();
  }
  (diag.querySelector('#diag-title') as HTMLElement).textContent = diagOverlay
    ? 'Linjer och stationer kunde inte ritas'
    : diagBackground
      ? 'Kartbakgrunden kunde inte laddas'
      : 'Kartan rapporterade ett fel';
  (diag.querySelector('#diag-list') as HTMLElement).innerHTML = diagMsgs.map((x) => `<li>${esc(x)}</li>`).join('');
  diag.hidden = false;
}
diag.querySelector('[data-diag-close]')!.addEventListener('click', () => (diag.hidden = true));
window.addEventListener('error', (e) => reportProblem(/worker/i.test(String(e.message)) ? 'worker' : 'js', String(e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => reportProblem('js', String((e.reason as Error)?.message ?? e.reason)));

/** Klassar MapLibres error-händelse: tiles, glyfer, stil, worker eller våra lager. */
function classifyMapError(ev: { sourceId?: string; error?: { message?: string; url?: string; status?: number } }): [DiagKind, string] {
  const msg = ev.error?.message ?? 'okänt fel';
  const url = ev.error?.url ?? '';
  const status = ev.error?.status ? `, HTTP ${ev.error.status}` : '';
  const where = url ? ` (${url.replace(/^https?:\/\//, '').slice(0, 80)}${status})` : '';
  if (/worker/i.test(msg)) return ['worker', msg];
  if (/\/fonts\//.test(url)) return ['glyphs', msg + where];
  if (ev.sourceId === 'openmaptiles' || /tiles\.openfreemap\.org/.test(url)) return ['tiles', msg + where];
  if (ev.sourceId?.startsWith('metro-')) return ['overlay', msg];
  return ['style', msg + where];
}

app.append(bar.el, notice, diag, toastEl, live);

// ---------- klocka och toppfält ----------
function clockChanged(): void {
  lastTick = -Infinity;
  nextTraffic = null;
}
function handleBarAction(a: BarAction): void {
  const wall = Date.now();
  if (a.type === 'live') clock.goLive(wall);
  else if (a.type === 'pause') (clock.paused ? clock.resume(wall) : clock.pause(wall));
  else if (a.type === 'scale') clock.setScale(a.scale, wall);
  else if (a.type === 'time') {
    const [h, m] = a.hhmm.split(':').map(Number);
    clock.setTime(romeDate(romeServiceTime(clock.now(wall)).ymd, h * 3600 + m * 60), wall);
  } else {
    const cur = romeServiceTime(clock.now(wall));
    const ymd = a.date ? Number(a.date.replaceAll('-', '')) : cur.ymd;
    const [h, mi] = (a.time || fmtHM(cur.sec)).split(':').map(Number);
    clock.setTime(romeDate(ymd, h * 3600 + mi * 60), wall);
  }
  clockChanged();
}
function renderBar(nowMs: number): void {
  bar.render({
    sec: romeServiceTime(new Date(nowMs)).sec,
    clock: { isLive: clock.isLive, paused: clock.paused, scale: clock.scale },
    validity: validityInfo(data, new Date(nowMs)),
    build: BUILD_ID,
  });
}

// ---------- banners och tomma lägen ----------
function renderNotice(nowMs: number): void {
  const status = dataStatus(data, new Date(nowMs));
  let key = 'none';
  let html = '';
  let cls = 'notice panel';
  if (status !== 'ok') {
    key = status;
    cls += ' bad';
    html =
      status === 'expired'
        ? `<h2>Tidtabellen har gått ut</h2><p>Den gällde till ${fmtDate(data.meta.validTo)}. Inga tåg visas förrän en ny tidtabell har byggts.</p><button class="btn primary" type="button" data-fix="valid">Visa en giltig dag</button>`
        : `<h2>Tidtabellen gäller inte än</h2><p>Den börjar gälla ${fmtDate(data.meta.validFrom)}.</p><button class="btn primary" type="button" data-fix="valid">Visa en giltig dag</button>`;
  } else if (curTrains.size === 0) {
    const minute = Math.floor(nowMs / 60000);
    if (!nextTraffic || nextTraffic.forMinute !== minute) nextTraffic = { forMinute: minute, ms: findNextTrafficMs(data, nowMs) };
    cls += ' info';
    if (nextTraffic.ms != null) {
      const { sec } = romeServiceTime(new Date(nextTraffic.ms));
      key = `night-${Math.floor(sec / 60)}`;
      html = `<h2>Ingen trafik just nu</h2><p>Nästa tåg enligt tidtabell går ca ${fmtHM(sec)} (Romtid).</p><button class="btn primary" type="button" data-fix="next">Spola till första tåget</button>`;
    } else {
      key = 'none-ahead';
      html = `<h2>Ingen trafik hittades</h2><p>Inga tåg inom de närmaste 26 timmarna enligt tidtabellen.</p>`;
    }
  }
  if (key === lastNoticeKey) return;
  lastNoticeKey = key;
  notice.hidden = key === 'none';
  notice.className = cls;
  notice.innerHTML = html;
}
notice.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  if (b.dataset.fix === 'valid') {
    const today = romeServiceTime(clock.now(Date.now())).ymd;
    const to = Number(data.meta.validTo.replaceAll('-', ''));
    const target = today > to ? data.meta.validTo : data.meta.validFrom;
    clock.setTime(romeDate(Number(target.replaceAll('-', '')), 12 * 3600), Date.now());
    clockChanged();
  } else if (b.dataset.fix === 'next' && nextTraffic?.ms != null) {
    clock.setTime(new Date(nextTraffic.ms), Date.now());
    clockChanged();
  }
});

// ---------- bottenpanel ----------
let sheetMode: 'list' | 'train' | null = null;
let sheetKey = '';

function refPoint(): { lat: number; lon: number } {
  if (userFix) return userFix;
  const c = map.getCenter();
  return { lat: c.lat, lon: c.lng };
}

function renderSheet(): void {
  if (selectedId && meta.has(selectedId)) renderTrain(meta.get(selectedId)!);
  else if (selectedId) {
    // tåget har nått slutstationen
    const name = lastSelectedDescription;
    select(null, { quiet: true });
    toast(`${name} har nått slutstationen.`);
    renderList();
  } else renderList();
}
let lastSelectedDescription = 'Tåget';

function renderList(): void {
  const ref = refPoint();
  const arr = [...curTrains.values()]
    .map((t) => ({ t, d: haversine(ref.lat, ref.lon, t.lat, t.lon) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 12);
  const key = `list:${arr.map((x) => x.t.id).join(',')}`;
  if (sheetMode === 'list' && key === sheetKey) {
    // uppdatera bara avstånd och antal
    sheet.body.querySelectorAll<HTMLElement>('[data-d]').forEach((n, i) => (n.textContent = fmtDist(arr[i].d)));
    (sheet.body.querySelector('[data-n]') as HTMLElement).textContent = String(curTrains.size);
    return;
  }
  sheetMode = 'list';
  sheetKey = key;
  const rows = arr
    .map(
      ({ t, d }) =>
        `<li><button type="button" class="row" data-id="${esc(t.id)}" aria-label="${esc(describe(t))}">${lineBadge(t.line, lineName(t.line), 'md')}<span class="row-text"><span class="row-title">mot ${esc(dirName(t.direction))}</span><span class="row-sub">${t.status === 'dwelling' ? 'står vid ' + esc(stopName(t.fromStation)) : esc(stopName(t.fromStation)) + ' → ' + esc(stopName(t.toStation))}</span></span><span class="row-dist num" data-d>${fmtDist(d)}</span></button></li>`,
    )
    .join('');
  sheet.body.innerHTML = `<div class="summary"><strong><span data-n class="num">${curTrains.size}</span> tåg</strong><span class="muted">${userFix ? 'närmast dig' : 'närmast kartans mitt'}</span></div>
    ${arr.length ? `<ul class="list" aria-label="Tåg i närheten">${rows}</ul>` : '<p class="footnote">Inga tåg kör just nu. Använd klockan överst för att välja en annan tid.</p>'}
    <p class="footnote">Positionerna är beräknade ur tidtabellen, inte realtid. Tidtabell: Comune di Milano / ATM (CC BY 4.0).</p>`;
}

function renderTrain(t: Train): void {
  const key = `train:${t.id}`;
  const sch = trainSchedule(data, t, clock.now(Date.now()));
  lastSelectedDescription = lineName(t.line);
  if (!sch) return;
  if (sheetMode !== 'train' || sheetKey !== key) {
    sheetMode = 'train';
    sheetKey = key;
    const ends = `<span>${esc(sch.stops[0].name)}</span><span>${esc(sch.terminusName)}</span>`;
    sheet.body.innerHTML = `<div class="head l-${esc(t.line)}">
        ${lineBadge(t.line, lineName(t.line), 'md')}
        <div class="titles"><h2 id="sel-title" tabindex="-1">mot ${esc(sch.terminusName)}</h2><div class="sub muted" data-f="status"></div></div>
        <button class="btn icon ghost close" type="button" aria-label="Avmarkera tåg" data-close><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <div class="next"><div><div class="k" data-f="nextlabel">Nästa station</div><div class="v" data-f="next"></div></div><div class="count num" data-f="count" role="timer" aria-live="off"></div></div>
      <div class="route l-${esc(t.line)}" role="img" aria-label="Framsteg längs sträckan">
        <div class="track"><div class="fill"></div>${sch.stops.map((s) => `<i class="tick" style="left:${(s.f * 100).toFixed(2)}%"></i>`).join('')}<div class="train"></div></div>
        <div class="ends muted">${ends}</div>
      </div>
      <dl class="facts"><dt>Station</dt><dd class="num" data-f="stopn"></dd><dt>Avstånd till dig</dt><dd class="num" data-f="dist"></dd></dl>
      <p class="footnote">Enligt tidtabell, inte realtid.${t.shapeQuality === 'coarse' ? ' Ungefärlig position (grov spårgeometri).' : ''}</p>`;
  }
  const set = (f: string, text: string) => {
    const n = sheet.body.querySelector(`[data-f="${f}"]`);
    if (n && n.textContent !== text) n.textContent = text;
  };
  set(
    'status',
    sch.atTerminus
      ? `Framme vid ändstationen ${sch.fromName}`
      : t.status === 'dwelling'
        ? `Står vid ${sch.fromName}${sch.secondsToDeparture != null ? `, avgår om ${fmtCount(Math.round(sch.secondsToDeparture))}` : ''}`
        : `På väg från ${sch.fromName}`,
  );
  set('nextlabel', t.status === 'dwelling' ? 'Nästa station efter avgång' : 'Nästa station');
  set('next', sch.atTerminus ? '–' : sch.nextStationName);
  set('count', sch.atTerminus ? '' : fmtCount(Math.round(t.status === 'dwelling' && sch.secondsToDeparture != null ? sch.secondsToDeparture : sch.secondsToNextArrival)));
  set('stopn', `${sch.stopIndex + 1} av ${sch.stopCount}`);
  set('dist', userFix ? fmtDist(haversine(userFix.lat, userFix.lon, t.lat, t.lon)) : 'Aktivera Min position');
  (sheet.body.querySelector('.route') as HTMLElement).style.setProperty('--p', sch.routeProgress.toFixed(4));
}

sheetClickHandlers();
function sheetClickHandlers(): void {
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (!sheet?.body.contains(t)) return;
    const row = t.closest<HTMLElement>('button[data-id]');
    if (row) {
      returnFocus = row;
      select(row.dataset.id!, { fly: true, focus: true });
    } else if (t.closest('[data-close]')) select(null, {});
  });
}

// ---------- val av tåg ----------
function select(id: string | null, opts: { fly?: boolean; focus?: boolean; quiet?: boolean }): void {
  const prev = selectedId;
  selectedId = id;
  sheetKey = '';
  if (id) {
    const t = meta.get(id);
    if (t) {
      lastSelectedDescription = lineName(t.line);
      if (!opts.quiet) announce(`${describe(t)} valt`);
      if (opts.fly) flyTo(t.lat, t.lon);
    }
    if (sheet.state === 'peek') sheet.setState('half');
    renderSheet();
    if (opts.focus !== false) (sheet.body.querySelector('#sel-title') as HTMLElement | null)?.focus({ preventScroll: true });
  } else {
    renderSheet();
    if (prev && !opts.quiet) {
      const back = returnFocus && document.contains(returnFocus) ? returnFocus : null;
      (back ?? (document.querySelector('#map canvas') as HTMLElement | null))?.focus?.({ preventScroll: true });
    }
    returnFocus = null;
  }
}

function flyTo(lat: number, lon: number): void {
  const visible = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-visible-px')) || 120;
  map.easeTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 14), offset: [0, -visible / 2], duration: reducedMotion() ? 0 : 650 });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (bar.isOpen) {
      bar.toggle(false);
      bar.focusButton();
    } else if (selectedId) select(null, {});
  }
});

// ---------- kartkontroller ----------
class FabControl implements IControl {
  private box!: HTMLElement;
  constructor(private buttons: HTMLElement[]) {}
  onAdd(): HTMLElement {
    this.box = el('div', 'stack maplibregl-ctrl'); // .maplibregl-ctrl gör barnet tryckbart (containern har pointer-events: none)
    this.box.append(...this.buttons);
    return this.box;
  }
  onRemove(): void {
    this.box.remove();
  }
}
/**
 * Källor och licens: en 44×44 px knapp (ⓘ) i samma stil som övriga kontroller. Hopfälld som standard på smala skärmar;
 * tryck fäller ut en panel ovanför knappen (alltså aldrig över bottenpanelen). Länkarna ur kartans och tidtabellens licenser finns kvar.
 */
class AttribControl implements IControl {
  private box!: HTMLElement;
  private btn!: HTMLButtonElement;
  private panel!: HTMLElement;
  onAdd(): HTMLElement {
    this.box = el('div', 'attrib maplibregl-ctrl');
    this.btn = el('button', 'btn icon', '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r="0.6"/></svg>', {
      type: 'button',
      'aria-label': 'Källor och licens',
      'aria-expanded': 'false',
      'aria-controls': 'attrib-panel',
    });
    this.panel = el(
      'div',
      'attrib-panel panel',
      `<div>Tidtabell: <a href="https://dati.comune.milano.it/" target="_blank" rel="noopener">Comune di Milano / ATM</a> (CC BY 4.0)</div><div>Karta: ${OFM_ATTRIBUTION}</div>`,
      { id: 'attrib-panel', role: 'region', 'aria-label': 'Källor och licens' },
    );
    this.box.append(this.btn, this.panel);
    this.toggle(window.innerWidth >= 600);
    this.btn.addEventListener('click', () => this.toggle());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.panel.hidden) this.toggle(false);
    });
    return this.box;
  }
  toggle(open?: boolean): void {
    const next = open ?? this.panel.hidden;
    this.panel.hidden = !next;
    this.btn.setAttribute('aria-expanded', String(next));
  }
  onRemove(): void {
    this.box.remove();
  }
}
const ICON_LOCATE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7.5"/></svg>';
const ICON_LIST = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>';
const locateBtn = el('button', 'btn icon', ICON_LOCATE, { type: 'button', 'aria-label': 'Visa min position' });
const listBtn = el('button', 'btn icon', ICON_LIST, { type: 'button', 'aria-label': 'Visa tåglistan' });

function locate(): void {
  if (!('geolocation' in navigator)) return toast('Den här enheten saknar platstjänster. Kartan fungerar ändå.');
  if (!window.isSecureContext) return toast('Plats kräver HTTPS. Kartan fungerar ändå.');
  if (watchId != null && userFix) return flyTo(userFix.lat, userFix.lon);
  locateBtn.setAttribute('aria-busy', 'true');
  let first = true;
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      userFix = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy };
      setUserFix(map, userFix);
      locateBtn.removeAttribute('aria-busy');
      locateBtn.classList.add('on');
      locateBtn.setAttribute('aria-label', 'Visa min position (aktiv)');
      if (first) {
        first = false;
        flyTo(userFix.lat, userFix.lon);
        announce(`Din position visas, noggrannhet ${Math.round(userFix.accuracy)} meter`);
      }
    },
    (err) => {
      locateBtn.removeAttribute('aria-busy');
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
      toast(
        err.code === 1
          ? 'Platstillstånd nekades. Ge åtkomst i Safari-inställningarna för att se din position.'
          : err.code === 2
            ? 'Positionen är inte tillgänglig just nu (ingen GPS-signal).'
            : 'Det tog för lång tid att hämta positionen. Försök igen.',
      );
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
  );
}
locateBtn.addEventListener('click', locate);
listBtn.addEventListener('click', () => {
  select(null, {});
  sheet.setState(sheet.state === 'peek' ? 'half' : 'peek');
});

// ---------- huvudloop ----------
/** Räknar om listan av aktiva trips (ca 1 gång/s). Horisonten täcker tåg som dyker upp före nästa omräkning. */
function refreshRuns(nowMs: number): void {
  const t0 = performance.now();
  const horizonSec = (TICK_MS / 1000) * Math.max(clock.scale, 1) * 1.5 + 1;
  runs = activeTrips(data, new Date(nowMs), horizonSec);
  perf.tickMs = performance.now() - t0;
}

/** Varje bildruta: position för varje aktiv trip från den kontinuerliga klockan (inga sekundsteg). */
function frame(rafTs: number): void {
  const t0 = performance.now();
  const nowMs = clock.nowMs(wallNow());
  const tick = rafTs - lastTick >= TICK_MS;
  if (tick) {
    lastTick = rafTs;
    refreshRuns(nowMs);
  }
  // Med prefers-reduced-motion flyttas markörerna en gång per sekund i stället för att glida
  if (tick || !reducedMotion() || rafTs - lastMarkerUpdate >= TICK_MS) {
    lastMarkerUpdate = rafTs;
    const list: Train[] = [];
    for (const r of runs) {
      const t = positionAt(r, nowMs);
      if (t) list.push(t);
    }
    curTrains = new Map(list.map((t) => [t.id, t]));
    meta = curTrains;
    markers.update(list, selectedId);
  }
  if (tick) {
    renderBar(nowMs);
    renderNotice(nowMs);
    renderSheet();
  }
  perfFrame(rafTs, performance.now() - t0);
  requestAnimationFrame(frame);
}

// ---------- dold FPS-/JS-mätare (långtryck på klockan, eller ?perf=1) ----------
const perfEl = el('pre', 'perf panel', '', { 'aria-live': 'off' });
perfEl.hidden = new URLSearchParams(location.search).get('perf') !== '1';
perfEl.textContent = 'mäter';
app.append(perfEl);
const perf = { tickMs: 0, frames: 0, jsSum: 0, jsMax: 0, gapMax: 0, windowStart: 0, lastTs: 0 };
function perfFrame(rafTs: number, jsMs: number): void {
  if (perfEl.hidden) return;
  if (!perf.windowStart) perf.windowStart = rafTs;
  if (perf.lastTs) perf.gapMax = Math.max(perf.gapMax, rafTs - perf.lastTs);
  perf.lastTs = rafTs;
  perf.frames++;
  perf.jsSum += jsMs;
  perf.jsMax = Math.max(perf.jsMax, jsMs);
  const span = rafTs - perf.windowStart;
  if (span >= 1000) {
    const fps = (perf.frames * 1000) / span;
    perfEl.textContent =
      `FPS ${fps.toFixed(0)} · längsta bildruta ${perf.gapMax.toFixed(0)} ms
` +
      `JS/bildruta ${(perf.jsSum / perf.frames).toFixed(1)} ms (max ${perf.jsMax.toFixed(1)})
` +
      `omräkning trips ${perf.tickMs.toFixed(1)} ms · tåg ${curTrains.size} · aktiva ${runs.length}
` +
      `bygge ${BUILD_ID}`;
    Object.assign(perf, { frames: 0, jsSum: 0, jsMax: 0, gapMax: 0, windowStart: rafTs });
  }
}
function togglePerf(): void {
  perfEl.hidden = !perfEl.hidden;
  Object.assign(perf, { frames: 0, jsSum: 0, jsMax: 0, gapMax: 0, windowStart: 0, lastTs: 0 });
  perfEl.textContent = 'mäter';
  toast(perfEl.hidden ? 'Prestandamätaren dold' : 'Prestandamätaren visas (långtryck på klockan döljer den)');
}

// ---------- start ----------
function showFatal(message: string): void {
  const f = el('div', 'fatal', `<div><h1>Kartan kunde inte startas</h1><p>${esc(message)}</p><button class="btn primary" type="button">Försök igen</button></div>`);
  f.querySelector('button')!.addEventListener('click', () => location.reload());
  document.body.append(f);
}

async function start(): Promise<void> {
  try {
    const res = await fetch(new URL('metro.json', document.baseURI));
    if (!res.ok) throw new Error(`Tidtabellsdatan (metro.json) gav HTTP ${res.status}.`);
    data = (await res.json()) as MetroData;
  } catch (e) {
    showFatal(e instanceof Error ? e.message : String(e));
    return;
  }
  try {
    map = new MapLibreMap({
      container: 'map',
      style: buildStyle(readMapPalette()),
      center: [9.19, 45.4642],
      zoom: 11.4,
      maxZoom: 18,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
  } catch (e) {
    showFatal(`Webbläsaren kunde inte starta kartan (WebGL?): ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  if (import.meta.env.DEV) (window as unknown as { __map: MlMap }).__map = map; // för felsökning i dev
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(new FabControl([listBtn, locateBtn]), 'bottom-right');
  map.addControl(new AttribControl(), 'bottom-left');
  map.on('error', (e) => {
    const ev = e as { sourceId?: string; error?: { message?: string; url?: string; status?: number } };
    console.warn('[map]', ev.sourceId ?? '', ev.error?.message ?? e);
    const [kind, msg] = classifyMapError(ev);
    reportProblem(kind, msg);
  });
  // Våra lager läggs till så snart stilen finns, oberoende av om OpenFreeMaps tiles har laddat.
  const ensureOverlays = () => {
    try {
      addOverlays(map, data);
    } catch (err) {
      reportProblem('overlay', err instanceof Error ? err.message : String(err));
    }
  };
  map.on('style.load', ensureOverlays);
  if (map.isStyleLoaded()) ensureOverlays();
  // Vakthund: säg till om lagren eller bakgrunden fortfarande saknas efter en stund
  window.setTimeout(() => {
    // getSource först: isSourceLoaded på en källa som saknas (stilen ej laddad) skickar ett eget felmeddelande
    const loaded = (id: string) => {
      try {
        return !!map.getSource(id) && map.isSourceLoaded(id);
      } catch {
        return false;
      }
    };
    if (!loaded('metro-lines') || !loaded('metro-stations')) reportProblem('overlay', 'har inte ritats efter 12 s (kart-workern laddade troligen inte).');
    if (!loaded('openmaptiles')) reportProblem('tiles', 'inga bakgrundstiles har laddats efter 12 s (offline eller blockerat?).');
  }, 12_000);
  // Markörer: små prickar under zoom 13, linjebricka med riktningspil från zoom 13
  const mapEl = document.getElementById('map') as HTMLElement;
  const syncZoom = () => {
    const z = map.getZoom();
    mapEl.classList.toggle('z-low', z < 12);
    mapEl.classList.toggle('z-mid', z >= 12 && z < 13);
    mapEl.classList.toggle('z-badge', z >= 13);
  };
  map.on('zoom', syncZoom);
  syncZoom();
  const bounds = data.stops.reduce((b, s) => b.extend([s.lon, s.lat]), new LngLatBounds([data.stops[0].lon, data.stops[0].lat], [data.stops[0].lon, data.stops[0].lat]));
  map.fitBounds(bounds, { padding: { top: 150, bottom: 170, left: 24, right: 24 }, animate: false });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => map.setStyle(buildStyle(readMapPalette())));

  sheet = new BottomSheet(app, reducedMotion);
  markers = new TrainMarkers(map, { onSelect: (id) => select(id, { fly: true, focus: true }), describe, lineLabel: lineName });
  map.getCanvas().addEventListener('click', () => selectedId && select(null, {}));
  requestAnimationFrame(frame);
}
void start();

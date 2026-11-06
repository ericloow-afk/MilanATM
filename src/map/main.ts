import 'maplibre-gl/dist/maplibre-gl.css';
import '../styles/tokens.css';
import './map.css';
import { AttributionControl, LngLatBounds, Map as MapLibreMap, NavigationControl, type IControl, type Map as MlMap } from 'maplibre-gl';
import { dataStatus, trains } from '../engine';
import { romeDate, romeServiceTime } from '../engine/time';
import type { MetroData, Train } from '../engine/types';
import { haversine } from '../geo';
import { interpolateTrains, type Pos } from './anim';
import { MapClock } from './clock';
import { TrainMarkers } from './markers';
import { addOverlays, setUserFix } from './overlays';
import { trainSchedule, validityInfo } from './schedule';
import { BottomSheet } from './sheet';
import { buildStyle, readMapPalette } from './style';
import { findNextTrafficMs } from './traffic';

const TICK_MS = 1000;
const FRAME_MS = 33;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const pad = (n: number) => String(Math.floor(n)).padStart(2, '0');
const fmtClock = (sec: number) => `${pad(sec / 3600)}:${pad((sec % 3600) / 60)}:${pad(sec % 60)}`;
const fmtCount = (sec: number) => `${Math.floor(sec / 60)}:${pad(sec % 60)}`;
const fmtDist = (m: number) => (m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
const fmtDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

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
let curTrains = new Map<string, Train>();
let meta = new Map<string, Train>();
let prevPos = new Map<string, Pos>();
let nextPos = new Map<string, Pos>();
let lastTick = -Infinity;
let lastFrame = 0;
let needReset = true;
let lastNoticeKey = '';
let nextTraffic: { forMinute: number; ms: number | null } | null = null;

const stopName = (id: string) => data.stops.find((s) => s.id === id)?.name ?? id;
const dirName = (id: string) => data.directions.find((d) => d.id === id)?.name ?? id;
const lineName = (id: string) => `M${data.lines.find((l) => l.id === id)?.name ?? id}`;
const toPos = (ts: Train[]) => new Map<string, Pos>(ts.map((t) => [t.id, { lat: t.lat, lon: t.lon, heading: t.headingDeg }]));
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
const toastEl = el('div', 'toast glass', '', { role: 'status', 'aria-live': 'polite' });
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

const topbar = el(
  'header',
  'topbar',
  `<div class="badge-note glass" id="note">Positioner enligt tidtabell</div>
   <div class="validity glass" id="validity" role="group" aria-label="Tidtabellens giltighet"></div>`,
);
const clockBox = el('div', 'clock');
const clockPill = el('button', 'clock-pill glass', '', { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'clock-panel' });
const clockPanel = el(
  'div',
  'clock-panel glass',
  `<div class="row">
     <button class="btn primary" type="button" data-act="live">Live</button>
     <button class="btn" type="button" data-act="pause" aria-label="Pausa eller fortsätt klockan">⏯</button>
     <button class="btn" type="button" data-scale="1">×1</button>
     <button class="btn" type="button" data-scale="10">×10</button>
     <button class="btn" type="button" data-scale="60">×60</button>
   </div>
   <div class="row">
     <button class="btn" type="button" data-time="12:00">12:00</button>
     <button class="btn" type="button" data-time="18:00">18:00</button>
     <button class="btn" type="button" data-time="00:30">00:30</button>
   </div>
   <label>Datum <input type="date" id="clock-date"></label>
   <label>Tid (Rom) <input type="time" id="clock-time" step="60"></label>`,
  { id: 'clock-panel', role: 'group', 'aria-label': 'Klockkontroller' },
);
clockPanel.hidden = true;
clockBox.append(clockPill, clockPanel);
const notice = el('div', 'notice glass', '', { role: 'region', 'aria-label': 'Trafikinformation' });
notice.hidden = true;

app.append(topbar, clockBox, notice, toastEl, live);

// ---------- klocka ----------
function clockChanged(): void {
  needReset = true;
  lastTick = -Infinity;
  nextTraffic = null;
}
function setClockRome(hhmm: string, dayOf?: Date): void {
  const [h, m] = hhmm.split(':').map(Number);
  const { ymd } = romeServiceTime(dayOf ?? clock.now(Date.now()));
  clock.setTime(romeDate(ymd, h * 3600 + m * 60), Date.now());
  clockChanged();
}
clockPill.addEventListener('click', () => {
  clockPanel.hidden = !clockPanel.hidden;
  clockPill.setAttribute('aria-expanded', String(!clockPanel.hidden));
});
clockPanel.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  const wall = Date.now();
  if (b.dataset.act === 'live') clock.goLive(wall);
  else if (b.dataset.act === 'pause') (clock.paused ? clock.resume(wall) : clock.pause(wall));
  else if (b.dataset.scale) clock.setScale(Number(b.dataset.scale), wall);
  else if (b.dataset.time) setClockRome(b.dataset.time);
  clockChanged();
});
const timeInput = clockPanel.querySelector('#clock-time') as HTMLInputElement;
const dateInput = clockPanel.querySelector('#clock-date') as HTMLInputElement;
function applyDateTimeInputs(): void {
  const cur = romeServiceTime(clock.now(Date.now()));
  const ymd = dateInput.value ? Number(dateInput.value.replaceAll('-', '')) : cur.ymd;
  const [h, mi] = (timeInput.value || fmtClock(cur.sec).slice(0, 5)).split(':').map(Number);
  clock.setTime(romeDate(ymd, h * 3600 + mi * 60), Date.now());
  clockChanged();
}
timeInput.addEventListener('change', applyDateTimeInputs);
dateInput.addEventListener('change', applyDateTimeInputs);
function renderClock(nowMs: number): void {
  const { sec } = romeServiceTime(new Date(nowMs));
  const mode = clock.isLive ? '<span class="mode">LIVE</span>' : `<span class="mode sim">${clock.paused ? 'PAUS' : `SPOLAD ×${clock.scale}`}</span>`;
  const html = `<span class="num">${fmtClock(sec)}</span>${mode}`;
  if (clockPill.dataset.h !== html) {
    clockPill.dataset.h = html;
    clockPill.innerHTML = html;
    clockPill.setAttribute('aria-label', `Klocka ${fmtClock(sec)} Romtid, ${clock.isLive ? 'live' : clock.paused ? 'pausad' : `spolad ×${clock.scale}`}. Öppna klockkontroller`);
  }
}

// ---------- giltighet, banners och tomma lägen ----------
function renderValidity(nowMs: number): void {
  const v = validityInfo(data, new Date(nowMs));
  const status =
    v.status === 'ok'
      ? v.daysLeft <= 7
        ? { cls: 'warn', text: v.daysLeft === 0 ? 'går ut idag' : `går ut om ${v.daysLeft} ${v.daysLeft === 1 ? 'dag' : 'dagar'}` }
        : { cls: '', text: `giltig · ${v.daysLeft} dagar kvar` }
      : v.status === 'expired'
        ? { cls: 'bad', text: 'har gått ut' }
        : { cls: 'bad', text: 'gäller inte än' };
  const html = `<span class="label">Tidtabell gäller</span><b class="num">${fmtDate(v.from)} – ${fmtDate(v.to)}</b><span class="chip ${status.cls}"><i class="dot"></i>${status.text}</span>`;
  const box = topbar.querySelector('#validity') as HTMLElement;
  if (box.dataset.h !== html) {
    box.dataset.h = html;
    box.innerHTML = html;
  }
}

function renderNotice(nowMs: number): void {
  const status = dataStatus(data, new Date(nowMs));
  let key = 'none';
  let html = '';
  let cls = 'notice glass';
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
      html = `<h2>Ingen trafik just nu</h2><p>Nästa tåg enligt tidtabell går ca ${fmtClock(sec).slice(0, 5)} (Romtid).</p><button class="btn primary" type="button" data-fix="next">Spola till första tåget</button>`;
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
    // uppdatera bara avstånd
    sheet.body.querySelectorAll<HTMLElement>('[data-d]').forEach((n, i) => (n.textContent = fmtDist(arr[i].d)));
    (sheet.body.querySelector('[data-n]') as HTMLElement).textContent = String(curTrains.size);
    return;
  }
  sheetMode = 'list';
  sheetKey = key;
  const rows = arr
    .map(
      ({ t, d }) =>
        `<li><button type="button" data-id="${esc(t.id)}" aria-label="${esc(describe(t))}"><span class="line-badge l-${esc(t.line)}">${esc(lineName(t.line))}</span><span class="t">mot ${esc(dirName(t.direction))}<br><small class="d">${t.status === 'dwelling' ? 'står vid ' + esc(stopName(t.fromStation)) : esc(stopName(t.fromStation)) + ' → ' + esc(stopName(t.toStation))}</small></span><span class="d num" data-d>${fmtDist(d)}</span></button></li>`,
    )
    .join('');
  sheet.body.innerHTML = `<div class="summary"><strong><span data-n class="num">${curTrains.size}</span> tåg i trafik</strong><span>${userFix ? 'närmast dig' : 'närmast kartans mitt'}</span></div>
    ${arr.length ? `<ul class="list" aria-label="Tåg i närheten">${rows}</ul>` : '<p class="footnote">Inga tåg kör just nu. Använd klockan uppe till höger för att spola tiden.</p>'}
    <p class="footnote">Positioner beräknas enligt tidtabell, inte realtid. Tidtabell: Comune di Milano / ATM (CC BY 4.0).</p>`;
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
        <span class="line-badge">${esc(lineName(t.line))}</span>
        <div class="titles"><h2 id="sel-title" tabindex="-1">mot ${esc(sch.terminusName)}</h2><div class="sub" data-f="status"></div></div>
        <button class="btn close" type="button" aria-label="Avmarkera tåg" data-close>✕</button>
      </div>
      <div class="next"><div><div class="k" data-f="nextlabel">Nästa station</div><div class="v" data-f="next"></div></div><div class="count num" data-f="count" role="timer" aria-live="off"></div></div>
      <div class="route l-${esc(t.line)}" role="img" aria-label="Framsteg längs sträckan">
        <div class="bar"><div class="fill"></div>${sch.stops.map((s) => `<i class="tick" style="left:${(s.f * 100).toFixed(2)}%"></i>`).join('')}<div class="train"></div></div>
        <div class="ends">${ends}</div>
      </div>
      <dl class="facts"><dt>Station</dt><dd class="num" data-f="stopn"></dd><dt>Avstånd till dig</dt><dd class="num" data-f="dist"></dd></dl>
      <p class="footnote">Enligt tidtabell, inte realtid.${t.shapeQuality === 'coarse' ? ' Ungefärlig position (grov spårgeometri).' : ''}</p>`;
  }
  const set = (f: string, text: string) => {
    const n = sheet.body.querySelector(`[data-f="${f}"]`);
    if (n && n.textContent !== text) n.textContent = text;
  };
  set('status', t.status === 'dwelling' ? `Står vid ${sch.fromName}${sch.secondsToDeparture != null ? ` · avgår om ${fmtCount(Math.round(sch.secondsToDeparture))}` : ''}` : `På väg från ${sch.fromName}`);
  set('nextlabel', t.status === 'dwelling' ? 'Nästa station efter avgång' : 'Nästa station');
  set('next', sch.nextStationName);
  set('count', fmtCount(Math.round(t.status === 'dwelling' && sch.secondsToDeparture != null ? sch.secondsToDeparture : sch.secondsToNextArrival)));
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
    if (!clockPanel.hidden) {
      clockPanel.hidden = true;
      clockPill.setAttribute('aria-expanded', 'false');
      clockPill.focus();
    } else if (selectedId) select(null, {});
  }
});

// ---------- kartkontroller ----------
class FabControl implements IControl {
  private box!: HTMLElement;
  constructor(private buttons: HTMLElement[]) {}
  onAdd(): HTMLElement {
    this.box = el('div', 'stack');
    this.box.append(...this.buttons);
    return this.box;
  }
  onRemove(): void {
    this.box.remove();
  }
}
const ICON_LOCATE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7.5"/></svg>';
const ICON_LIST = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>';
const locateBtn = el('button', 'btn fab', ICON_LOCATE, { type: 'button', 'aria-label': 'Visa min position' });
const listBtn = el('button', 'btn fab', ICON_LIST, { type: 'button', 'aria-label': 'Visa tåglistan' });

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
function doTick(wall: number): void {
  // wall = rAF-tid (för animering); klockan använder epoch-tid
  const nowMs = clock.nowMs(Date.now());
  const cur = trains(data, new Date(nowMs));
  const scale = clock.scale;
  const nxt = scale === 0 ? cur : trains(data, new Date(nowMs + TICK_MS * scale));
  prevPos = needReset || wall - lastTick > 3 * TICK_MS ? toPos(cur) : nextPos;
  nextPos = toPos(nxt);
  needReset = false;
  lastTick = wall;
  curTrains = new Map(cur.map((t) => [t.id, t]));
  meta = new Map([...nxt, ...cur].map((t) => [t.id, t]));
  renderClock(nowMs);
  renderValidity(nowMs);
  renderNotice(nowMs);
  renderSheet();
}

function frame(wall: number): void {
  if (wall - lastTick >= TICK_MS) doTick(wall);
  if (wall - lastFrame >= FRAME_MS) {
    lastFrame = wall;
    const f = reducedMotion() ? 1 : Math.min(1, (wall - lastTick) / TICK_MS);
    const anims = interpolateTrains(prevPos, nextPos, f);
    markers.update(
      anims.flatMap((a) => (meta.has(a.id) ? [{ anim: a, train: meta.get(a.id)! }] : [])),
      selectedId,
    );
  }
  requestAnimationFrame(frame);
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
  map.addControl(
    new AttributionControl({ compact: true, customAttribution: 'Tidtabell: <a href="https://dati.comune.milano.it/" target="_blank" rel="noopener">Comune di Milano / ATM</a> (CC BY 4.0)' }),
    'bottom-left',
  );
  let tileErrorShown = false;
  map.on('error', (e) => {
    const ev = e as { sourceId?: string; error?: { message?: string } };
    console.warn('[map]', ev.sourceId ?? '', ev.error?.message ?? e);
    if (ev.sourceId === 'openmaptiles' && !tileErrorShown) {
      tileErrorShown = true;
      toast('Kartbilden kunde inte laddas (offline?). Linjer och tåg visas ändå.');
    }
  });
  map.on('style.load', () => addOverlays(map, data));
  // Markörerna skalas ned vid låg zoom så att de inte täcker kartan; siffran döljs när de blir små
  const mapEl = document.getElementById('map') as HTMLElement;
  const syncZoom = () => {
    const z = map.getZoom();
    mapEl.style.setProperty('--tm-s', Math.min(1, Math.max(0.45, (z - 9) / 4.5)).toFixed(2));
    mapEl.classList.toggle('lowzoom', z < 12);
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

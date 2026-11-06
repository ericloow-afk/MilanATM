/** DOM-gränssnitt för AR-vyn: HUD, start, kalibrering, etiketter/pilar, info-panel och simulatorpanel. */
import type { SimSource, SimPlace } from './sim';

export interface UiHooks {
  onStartReal(): void;
  onStartSim(): void;
  onSwitchSource(): void;
  onCalibrateDrag(dxPx: number): void;
  onResetCalibration(): void;
  onFov(deg: number): void;
  onSelectTrain(id: string | null): void;
  onSimJumpNextTrain(): void;
  onSimTimePreset(kind: 'noon' | 'evening' | 'night'): void;
}

export interface LabelItem {
  id: string;
  text: string;
  color: string;
  /** på skärmen: etikett vid (x, y). Utanför: pil vid kanten. */
  onScreen: boolean;
  x: number;
  y: number;
  angleRad: number;
}

export interface TrainInfo {
  title: string;
  color: string;
  lines: string[];
}

const h = (html: string): HTMLElement => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

export class ArUi {
  readonly hud = h('<pre id="hud"></pre>');
  readonly banner = h('<div id="banner" hidden></div>');
  readonly console = h('<pre id="errors"></pre>');
  readonly labels = h('<div id="labels"></div>');
  readonly info = h('<div id="info" hidden></div>');
  readonly toolbar = h(`<div id="toolbar"><button id="b-cal">Kalibrera</button><button id="b-src"></button></div>`);
  readonly calPanel = h(`<div class="panel" id="cal" hidden>
      <div>Dra vänster/höger på bilden för att vrida vyn.</div>
      <div id="cal-read"></div>
      <label>FOV (lodrätt) <input id="fov" type="range" min="35" max="90" value="60"><span id="fov-v">60°</span></label>
      <button id="cal-reset">Återställ</button></div>`);
  readonly startBox = h(`<div id="start"><h1>Milano Metro AR</h1>
      <p>Tåg enligt tidtabell, ungefärlig position.</p>
      <button id="s-real">Starta AR (kamera + sensorer)</button>
      <button id="s-sim">Simulator</button></div>`);
  readonly simPanel = h(`<div class="panel" id="sim" hidden>
      <label>Plats <select id="sim-place"></select></label>
      <label>Riktning <input id="sim-h" type="range" min="0" max="359" value="0"><span id="sim-h-v"></span></label>
      <label>Lutning <input id="sim-p" type="range" min="-90" max="90" value="-35"><span id="sim-p-v"></span></label>
      <label>Alpha-origo <input id="sim-o" type="range" min="0" max="359" value="137"><span id="sim-o-v"></span></label>
      <label>Kompassbrus <input id="sim-n" type="range" min="0" max="30" value="6"><span id="sim-n-v"></span></label>
      <label>Kompass <select id="sim-a"><option value="10">±10° (ok)</option><option value="20">±20° (ok)</option><option value="40">±40° (ignoreras)</option><option value="-1">okalibrerad (−1)</option></select></label>
      <div id="sim-time"></div>
      <div><button data-ts="0">⏸</button><button data-ts="1">×1</button><button data-ts="10">×10</button><button data-ts="60">×60</button></div>
      <div><button data-tp="noon">12:00</button><button data-tp="evening">18:00</button><button data-tp="night">00:30</button><button id="sim-next">Nästa tåg</button></div>
      <div class="small">Dra på bilden = titta runt. WASD/pilar = gå.</div></div>`);

  private labelEls = new Map<string, HTMLElement>();
  private selected: string | null = null;

  constructor(
    private root: HTMLElement,
    private canvas: HTMLElement,
    private hooks: UiHooks,
  ) {
    root.append(this.labels, this.hud, this.banner, this.console, this.info, this.toolbar, this.calPanel, this.simPanel, this.startBox);
    this.bind();
  }

  private $<T extends HTMLElement>(sel: string): T {
    return this.root.querySelector(sel) as T;
  }

  private bind(): void {
    this.$('#s-real').addEventListener('click', () => this.hooks.onStartReal());
    this.$('#s-sim').addEventListener('click', () => this.hooks.onStartSim());
    this.$('#b-src').addEventListener('click', () => this.hooks.onSwitchSource());
    this.$('#b-cal').addEventListener('click', () => {
      this.calPanel.hidden = !this.calPanel.hidden;
    });
    this.$('#cal-reset').addEventListener('click', () => this.hooks.onResetCalibration());
    const fov = this.$<HTMLInputElement>('#fov');
    fov.addEventListener('input', () => {
      this.$('#fov-v').textContent = `${fov.value}°`;
      this.hooks.onFov(Number(fov.value));
    });
    this.info.addEventListener('click', () => this.selectTrain(null));
    // Dra = kalibrera (när panelen är öppen). Tryck = välj tåg i närheten av tryckpunkten.
    let last: { x: number; y: number; moved: number } | null = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      last = { x: e.clientX, y: e.clientY, moved: 0 };
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!last) return;
      const dx = e.clientX - last.x;
      last.moved += Math.abs(dx) + Math.abs(e.clientY - last.y);
      if (!this.calPanel.hidden) this.hooks.onCalibrateDrag(dx);
      else this.onLook?.(dx, e.clientY - last.y);
      last.x = e.clientX;
      last.y = e.clientY;
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (last && last.moved < 6) this.onTap?.(e.clientX, e.clientY);
      last = null;
    });
    this.canvas.addEventListener('pointercancel', () => (last = null));
  }

  onTap?: (x: number, y: number) => void;
  onLook?: (dx: number, dy: number) => void;

  selectedId(): string | null {
    return this.selected;
  }
  selectTrain(id: string | null): void {
    this.selected = id;
    if (!id) this.info.hidden = true;
    this.hooks.onSelectTrain(id);
  }
  showInfo(info: TrainInfo | null): void {
    if (!info) {
      this.info.hidden = true;
      return;
    }
    this.info.hidden = false;
    this.info.innerHTML = `<b style="color:${info.color}">${info.title}</b><br>${info.lines.join('<br>')}<br><small>(tryck för att stänga)</small>`;
  }

  setBanner(text: string | null): void {
    this.banner.hidden = !text;
    if (text) this.banner.textContent = text;
  }
  setHud(text: string): void {
    this.hud.textContent = text;
  }
  setErrors(lines: string[]): void {
    this.console.textContent = lines.length ? lines.slice(-4).join('\n') : '';
  }
  setSourceButton(kind: 'real' | 'sim'): void {
    this.$('#b-src').textContent = kind === 'real' ? 'Byt till simulator' : 'Byt till sensorer';
  }
  setCalibrationReadout(text: string): void {
    this.$('#cal-read').textContent = text;
  }
  hideStart(): void {
    this.startBox.hidden = true;
  }
  showStart(): void {
    this.startBox.hidden = false;
  }

  /** Etiketter för tåg i bild och pilar för tåg utanför. */
  setLabels(items: LabelItem[]): void {
    const keep = new Set<string>();
    for (const it of items) {
      keep.add(it.id);
      let el = this.labelEls.get(it.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'label';
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          this.selectTrain(it.id);
        });
        this.labels.append(el);
        this.labelEls.set(it.id, el);
      }
      el.classList.toggle('arrow', !it.onScreen);
      el.classList.toggle('sel', it.id === this.selected);
      el.style.borderColor = it.color;
      el.style.transform = `translate(${it.x}px, ${it.y}px) translate(-50%, -50%)`;
      el.innerHTML = it.onScreen
        ? it.text
        : `<span class="ar" style="transform:rotate(${it.angleRad}rad);color:${it.color}">➤</span><br>${it.text}`;
    }
    for (const [id, el] of this.labelEls) {
      if (!keep.has(id)) {
        el.remove();
        this.labelEls.delete(id);
      }
    }
  }

  // ---------- simulatorpanel ----------
  bindSim(sim: SimSource, places: SimPlace[]): void {
    this.simPanel.hidden = false;
    const sel = this.$<HTMLSelectElement>('#sim-place');
    sel.innerHTML = places.map((p, i) => `<option value="${i}">${p.name}</option>`).join('');
    sel.onchange = () => sim.teleport(places[Number(sel.value)]);
    const bind = (id: string, apply: (v: number) => void, fmt: (v: number) => string) => {
      const el = this.$<HTMLInputElement>(id);
      const out = this.$(`${id}-v`);
      el.oninput = () => {
        apply(Number(el.value));
        out.textContent = fmt(Number(el.value));
      };
      out.textContent = fmt(Number(el.value));
    };
    bind('#sim-h', (v) => (sim.headingDeg = v), (v) => `${v}°`);
    bind('#sim-p', (v) => (sim.pitchDeg = v), (v) => `${v}°`);
    bind('#sim-o', (v) => (sim.alphaOriginDeg = v), (v) => `${v}°`);
    bind('#sim-n', (v) => (sim.compassNoiseDeg = v), (v) => `±${v}°`);
    this.$<HTMLSelectElement>('#sim-a').onchange = (e) => (sim.compassAccuracy = Number((e.target as HTMLSelectElement).value));
    this.simPanel.querySelectorAll<HTMLButtonElement>('button[data-ts]').forEach((b) => (b.onclick = () => (sim.timeScale = Number(b.dataset.ts))));
    this.simPanel.querySelectorAll<HTMLButtonElement>('button[data-tp]').forEach(
      (b) => (b.onclick = () => this.hooks.onSimTimePreset(b.dataset.tp as 'noon' | 'evening' | 'night')),
    );
    this.$('#sim-next').onclick = () => this.hooks.onSimJumpNextTrain();
  }
  unbindSim(): void {
    this.simPanel.hidden = true;
  }
  /** håller reglagen i takt med pekar-/tangentstyrning */
  syncSim(sim: SimSource, timeText: string): void {
    const set = (id: string, v: number, fmt: string) => {
      const el = this.$<HTMLInputElement>(id);
      if (document.activeElement !== el) el.value = String(Math.round(v));
      this.$(`${id}-v`).textContent = fmt;
    };
    set('#sim-h', sim.headingDeg, `${Math.round(sim.headingDeg)}°`);
    set('#sim-p', sim.pitchDeg, `${Math.round(sim.pitchDeg)}°`);
    this.$('#sim-time').textContent = `Simulerad tid (Rom): ${timeText}  ×${sim.timeScale}`;
  }
}

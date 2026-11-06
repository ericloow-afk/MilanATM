/**
 * DOM-gränssnitt för AR-vyn: startvy, HUD (en rad, tekniken fälls ut), verktyg, kalibrering, etiketter/kantpilar,
 * info-panel och nedfällbar simulatorpanel. Utseendet ligger i src/ar/ar.css och delade komponenter (src/styles/components.css).
 */
import { esc } from '../map/format';
import { lineBadge } from '../ui/line-badge';
import type { SimPlace, SimSource } from './sim';

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
  onRecord(): void;
  onMark(): void;
  onCopy(): void;
}

export interface LabelItem {
  id: string;
  line: string;
  /** "M1" */
  lineLabel: string;
  /** rad(er) bredvid brickan: "mot X" och avstånd. Bara avstånd för kantpilar. */
  title: string;
  dist: string;
  /** på skärmen: etikett vid (x, y). Utanför: pil vid kanten. */
  onScreen: boolean;
  x: number;
  y: number;
  angleRad: number;
}

export interface TrainInfo {
  line: string;
  lineLabel: string;
  title: string;
  lines: string[];
}

export interface HudState {
  /** en kort rad, t.ex. "2 tåg inom 300 m" */
  summary: string;
  /** teknisk information (visas bara utfälld eller i debug) */
  details: [label: string, value: string][];
}

const h = (html: string): HTMLElement => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

const ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

export class ArUi {
  readonly labels = h('<div id="labels" aria-hidden="true"></div>');
  readonly hudBox = h(`<div id="hudbox">
      <button type="button" class="hud-row panel" id="hud-btn" aria-expanded="false" aria-controls="hud-details"><span id="hud-text">Väntar på start</span><span class="chev" aria-hidden="true"></span></button>
      <dl class="hud-details panel num" id="hud-details" hidden></dl>
      <pre class="errors panel" id="errors" hidden></pre>
    </div>`);
  readonly banner = h('<div id="banner" class="panel" role="status" hidden></div>');
  readonly info = h('<div id="info" class="panel" role="region" aria-label="Valt tåg" hidden></div>');
  readonly toolbar = h(`<div id="toolbar">
      <button type="button" class="btn" id="b-cal">Kalibrera</button>
      <button type="button" class="btn" id="b-src">Simulator</button>
      <button type="button" class="btn ghost" id="b-tools" aria-expanded="false" aria-controls="tools">Verktyg</button>
      <div class="tools panel" id="tools" hidden>
        <button type="button" class="btn" id="b-rec">Spela in 30 s</button>
        <button type="button" class="btn" id="b-mark" disabled>Markera</button>
        <button type="button" class="btn" id="b-copy" disabled>Kopiera logg</button>
        <div class="muted rec-note" id="rec-note"></div>
        <textarea id="csv" readonly hidden aria-label="Logg som CSV"></textarea>
      </div>
    </div>`);
  readonly calPanel = h(`<div class="cal panel" id="cal" role="region" aria-label="Kalibrering" hidden>
      <p class="muted">Dra vänster eller höger på bilden för att vrida vyn.</p>
      <div class="muted num" id="cal-read"></div>
      <label class="ctl"><span class="ctl-row"><span>Synfält (lodrätt)</span><span class="num" id="fov-v">60°</span></span><input class="range" id="fov" type="range" min="35" max="90" value="60"></label>
      <div class="row2"><button type="button" class="btn secondary" id="cal-reset">Återställ</button><button type="button" class="btn" id="cal-close">Klar</button></div>
    </div>`);
  readonly startBox = h(`<div id="start">
      <div class="start-inner">
        <div class="wordmark">Milano Metro AR</div>
        <p>Tågen under dina fötter, beräknade ur tidtabellen. Positionerna är ungefärliga.</p>
        <button type="button" class="btn primary" id="s-real">Starta AR</button>
        <button type="button" class="btn secondary" id="s-sim">Simulator</button>
        <p class="muted small">Kräver kamera, plats samt rörelse och orientering.</p>
      </div>
    </div>`);
  readonly simSheet = h(`<section id="simsheet" class="panel" aria-label="Simulator" hidden>
      <button type="button" class="sim-handle" id="sim-handle" aria-expanded="false" aria-controls="sim-body"><span class="grip-bar" aria-hidden="true"></span><span class="sim-title">Simulator</span><span class="chev" aria-hidden="true"></span></button>
      <div class="sim-body" id="sim-body" hidden>
        <div class="ctl"><span class="ctl-row"><span>Plats</span></span><div class="chips" id="sim-places" role="group" aria-label="Plats"></div></div>
        <label class="ctl"><span class="ctl-row"><span>Riktning</span><span class="num" id="sim-h-v"></span></span><input class="range" id="sim-h" type="range" min="0" max="359" value="0"></label>
        <label class="ctl"><span class="ctl-row"><span>Lutning</span><span class="num" id="sim-p-v"></span></span><input class="range" id="sim-p" type="range" min="-90" max="90" value="-35"></label>
        <label class="ctl"><span class="ctl-row"><span>Alpha-origo</span><span class="num" id="sim-o-v"></span></span><input class="range" id="sim-o" type="range" min="0" max="359" value="137"></label>
        <label class="ctl"><span class="ctl-row"><span>Kompassbrus</span><span class="num" id="sim-n-v"></span></span><input class="range" id="sim-n" type="range" min="0" max="30" value="6"></label>
        <div class="ctl"><span class="ctl-row"><span>Kompass</span></span>
          <div class="seg" role="group" aria-label="Kompassens noggrannhet" id="sim-a"><button type="button" data-a="10" aria-pressed="true">±10°</button><button type="button" data-a="20" aria-pressed="false">±20°</button><button type="button" data-a="40" aria-pressed="false">±40°</button><button type="button" data-a="-1" aria-pressed="false">Okalibrerad</button></div></div>
        <div class="ctl"><span class="ctl-row"><span>Tid (Rom)</span><span class="num" id="sim-time"></span></span>
          <div class="seg" role="group" aria-label="Tidshastighet" id="sim-ts"><button type="button" data-ts="0" aria-pressed="false">Paus</button><button type="button" data-ts="1" aria-pressed="true">×1</button><button type="button" data-ts="10" aria-pressed="false">×10</button><button type="button" data-ts="60" aria-pressed="false">×60</button></div>
          <div class="seg" role="group" aria-label="Gå till tid" id="sim-tp"><button type="button" data-tp="noon">12:00</button><button type="button" data-tp="evening">18:00</button><button type="button" data-tp="night">00:30</button><button type="button" id="sim-next">Nästa tåg</button></div></div>
        <div class="row2"><button type="button" class="btn secondary" id="sim-switch">Byt till sensorer</button></div>
        <p class="muted small">Dra på bilden för att titta runt. W, A, S, D eller piltangenter flyttar.</p>
      </div>
    </section>`);

  private labelEls = new Map<string, HTMLElement>();
  private selected: string | null = null;
  private hudText = '';
  private hudDetails = '';

  constructor(
    private root: HTMLElement,
    private canvas: HTMLElement,
    private hooks: UiHooks,
    private debug = false,
  ) {
    this.hudBox.insertBefore(this.banner, this.hudBox.querySelector('#hud-details')); // banner staplas under HUD-raden, aldrig ovanpå utfälld text
    root.append(this.labels, this.hudBox, this.info, this.toolbar, this.calPanel, this.simSheet, this.startBox);
    this.toolbar.hidden = true;
    this.hudBox.hidden = true;
    this.bind();
    if (debug) {
      this.toggleTools(true);
      this.toggleHud(true);
    }
  }

  private $<T extends HTMLElement>(sel: string): T {
    return this.root.querySelector(sel) as T;
  }

  private toggleHud(open?: boolean): void {
    const d = this.$('#hud-details');
    const next = open ?? d.hidden;
    d.hidden = !next;
    this.$('#hud-btn').setAttribute('aria-expanded', String(next));
  }
  private toggleTools(open?: boolean): void {
    const t = this.$('#tools');
    const next = open ?? t.hidden;
    t.hidden = !next;
    this.$('#b-tools').setAttribute('aria-expanded', String(next));
  }
  private toggleSim(open?: boolean): void {
    const b = this.$('#sim-body');
    const next = open ?? b.hidden;
    b.hidden = !next;
    this.$('#sim-handle').setAttribute('aria-expanded', String(next));
    this.syncBottom();
  }
  /** Låter info- och kalibreringspanelen ligga ovanför simulatorns handtag/panel. */
  private syncBottom(): void {
    const px = this.simSheet.hidden ? 0 : this.simSheet.offsetHeight;
    this.root.style.setProperty('--ar-bottom', `${px}px`);
  }

  /** Läge: 'real' | 'sim' | null (startvy). Styr vilka knappar som visas. */
  setMode(kind: 'real' | 'sim' | null): void {
    this.root.dataset.mode = kind ?? 'start';
    this.toolbar.hidden = kind == null;
    this.hudBox.hidden = kind == null;
    this.simSheet.hidden = kind !== 'sim';
    if (kind !== 'sim') this.toggleSim(false);
    this.$('#b-src').textContent = 'Simulator';
    this.$('#b-src').hidden = kind !== 'real';
    this.$('#b-cal').hidden = kind !== 'real';
    this.syncBottom();
  }

  private bind(): void {
    this.$('#s-real').addEventListener('click', () => this.hooks.onStartReal());
    this.$('#s-sim').addEventListener('click', () => this.hooks.onStartSim());
    this.$('#b-src').addEventListener('click', () => this.hooks.onSwitchSource());
    this.$('#sim-switch').addEventListener('click', () => this.hooks.onSwitchSource());
    this.$('#b-cal').addEventListener('click', () => {
      this.calPanel.hidden = !this.calPanel.hidden;
    });
    this.$('#cal-close').addEventListener('click', () => (this.calPanel.hidden = true));
    this.$('#cal-reset').addEventListener('click', () => this.hooks.onResetCalibration());
    this.$('#hud-btn').addEventListener('click', () => this.toggleHud());
    this.$('#b-tools').addEventListener('click', () => this.toggleTools());
    this.$('#sim-handle').addEventListener('click', () => this.toggleSim());
    this.$('#b-rec').addEventListener('click', () => this.hooks.onRecord());
    this.$('#b-mark').addEventListener('click', () => this.hooks.onMark());
    this.$('#b-copy').addEventListener('click', () => this.hooks.onCopy());
    const fov = this.$<HTMLInputElement>('#fov');
    fov.addEventListener('input', () => {
      this.$('#fov-v').textContent = `${fov.value}°`;
      this.hooks.onFov(Number(fov.value));
    });
    this.info.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-close]')) this.selectTrain(null);
    });
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
    window.addEventListener('resize', () => this.syncBottom());
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
    const html = `<div class="info-head">${lineBadge(info.line, info.lineLabel, 'md')}<strong>${esc(info.title)}</strong><button type="button" class="btn icon ghost" data-close aria-label="Avmarkera tåg">${ICON_CLOSE}</button></div><p>${info.lines.map(esc).join('<br>')}</p>`;
    if (this.info.dataset.h !== html) {
      this.info.dataset.h = html;
      this.info.innerHTML = html;
    }
    this.info.hidden = false;
  }

  setBanner(text: string | null): void {
    this.banner.hidden = !text;
    if (text && this.banner.textContent !== text) this.banner.textContent = text;
  }
  setHud(s: HudState): void {
    if (s.summary !== this.hudText) {
      this.hudText = s.summary;
      this.$('#hud-text').textContent = s.summary;
    }
    const d = s.details.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    if (d !== this.hudDetails) {
      this.hudDetails = d;
      this.$('#hud-details').innerHTML = d;
    }
  }
  setErrors(lines: string[]): void {
    const box = this.$('#errors');
    const text = lines.slice(-4).join('\n');
    box.hidden = !text;
    if (box.textContent !== text) box.textContent = text;
  }
  setCalibrationReadout(text: string): void {
    this.$('#cal-read').textContent = text;
  }
  /** Inspelningsknapparnas tillstånd och text. */
  setRecordUi(s: { recording: boolean; label: string; canCopy: boolean; note?: string }): void {
    const rec = this.$<HTMLButtonElement>('#b-rec');
    rec.disabled = s.recording;
    rec.textContent = s.label;
    this.$<HTMLButtonElement>('#b-mark').disabled = !s.recording;
    this.$<HTMLButtonElement>('#b-copy').disabled = s.recording || !s.canCopy;
    if (s.note !== undefined) this.$('#rec-note').textContent = s.note;
  }
  setCopyLabel(text: string): void {
    this.$('#b-copy').textContent = text;
  }
  /** Reserv när iOS vägrar urklipp: visa CSV i ett markerat textfält. */
  showCsv(csv: string): void {
    const box = this.$<HTMLTextAreaElement>('#csv');
    box.hidden = false;
    box.value = csv;
    box.focus();
    box.select();
  }
  hideCsv(): void {
    this.$<HTMLTextAreaElement>('#csv').hidden = true;
  }
  hideStart(): void {
    this.startBox.hidden = true;
  }
  showStart(): void {
    this.startBox.hidden = false;
  }

  /** Etiketter (LineBadge + text) för tåg i bild och kantpilar för tåg utanför. */
  setLabels(items: LabelItem[]): void {
    const keep = new Set<string>();
    for (const it of items) {
      keep.add(it.id);
      let el = this.labelEls.get(it.id);
      if (!el) {
        const btn = document.createElement('button');
        btn.type = 'button';
        el = btn;
        el.className = 'label';
        el.tabIndex = -1;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          this.selectTrain(it.id);
        });
        this.labels.append(el);
        this.labelEls.set(it.id, el);
      }
      el.classList.toggle('arrow', !it.onScreen);
      el.classList.toggle('sel', it.id === this.selected);
      el.style.transform = `translate(${it.x.toFixed(1)}px, ${it.y.toFixed(1)}px) translate(-50%, -50%)`;
      const html = it.onScreen
        ? `${lineBadge(it.line, it.lineLabel, 'sm')}<span class="lbl-text"><span class="lbl-title">${esc(it.title)}</span><span class="lbl-dist num">${esc(it.dist)}</span></span>`
        : `<span class="tri" style="transform:rotate(${it.angleRad.toFixed(3)}rad)" aria-hidden="true"></span>${lineBadge(it.line, it.lineLabel, 'sm')}<span class="lbl-dist num">${esc(it.dist)}</span>`;
      if (el.dataset.h !== html) {
        el.dataset.h = html;
        el.innerHTML = html;
      }
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
    const wrap = this.$('#sim-places');
    wrap.innerHTML = places.map((p, i) => `<button type="button" class="btn secondary chip-btn" data-i="${i}" aria-pressed="${i === 0}">${esc(p.name)}</button>`).join('');
    wrap.onclick = (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-i]');
      if (!b) return;
      sim.teleport(places[Number(b.dataset.i)]);
      wrap.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    };
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
    const press = (group: HTMLElement, btn: HTMLElement) => group.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === btn)));
    const acc = this.$('#sim-a');
    acc.onclick = (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-a]');
      if (!b) return;
      sim.compassAccuracy = Number(b.dataset.a);
      press(acc, b);
    };
    const ts = this.$('#sim-ts');
    ts.onclick = (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-ts]');
      if (!b) return;
      sim.timeScale = Number(b.dataset.ts);
      press(ts, b);
    };
    this.$('#sim-tp').onclick = (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b) return;
      if (b.id === 'sim-next') this.hooks.onSimJumpNextTrain();
      else if (b.dataset.tp) this.hooks.onSimTimePreset(b.dataset.tp as 'noon' | 'evening' | 'night');
    };
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
    this.$('#sim-time').textContent = timeText;
  }
}

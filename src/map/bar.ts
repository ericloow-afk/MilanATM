/**
 * Kartans toppfält: ett enda kompakt fält (en rad, 44 px). Vänster: klockan (sekunder bara vid spolning).
 * Höger: statuspunkt och "Tidtabell". Tryck öppnar en liten panel med tidtabellens giltighet och klockkontrollen.
 * Positionerna är beräknade ur tidtabellen och inte realtid, så fältet visar ingen "LIVE"-etikett.
 */
import { esc, fmtDate, fmtHM, fmtHMS } from './format';
import type { Validity } from './schedule';

export interface ClockInfo {
  isLive: boolean;
  paused: boolean;
  scale: number;
}

export interface BarState {
  /** sekunder från midnatt (Romtid) */
  sec: number;
  clock: ClockInfo;
  validity: Validity;
  build: string;
}

export type BarAction =
  | { type: 'live' }
  | { type: 'pause' }
  | { type: 'scale'; scale: number }
  | { type: 'time'; hhmm: string }
  | { type: 'datetime'; date: string; time: string };

export interface BarHooks {
  onAction(a: BarAction): void;
  /** långtryck på fältet (dold prestandamätare) */
  onLongPress(): void;
}

export interface StatusView {
  cls: '' | 'warn' | 'bad';
  /** kort text för panelen */
  text: string;
}

/** Status ur giltigheten (ren funktion; testbar). */
export function statusOf(v: Validity): StatusView {
  if (v.status === 'expired') return { cls: 'bad', text: 'har gått ut' };
  if (v.status === 'notYetValid') return { cls: 'bad', text: 'gäller inte än' };
  if (v.daysLeft <= 7) return { cls: 'warn', text: v.daysLeft === 0 ? 'går ut idag' : `går ut om ${v.daysLeft} ${v.daysLeft === 1 ? 'dag' : 'dagar'}` };
  return { cls: '', text: `giltig, ${v.daysLeft} dagar kvar` };
}

/** Text för klockan: HH:MM, men HH:MM:SS när klockan är spolad eller pausad. */
export function clockText(sec: number, c: ClockInfo): string {
  return c.isLive ? fmtHM(sec) : fmtHMS(sec);
}

/** Litet tillägg intill klockan när den inte visar riktig tid. */
export function clockNote(c: ClockInfo): string {
  if (c.isLive) return '';
  return c.paused ? 'pausad' : c.scale === 1 ? 'spolad' : `spolad ×${c.scale}`;
}

export class TopBar {
  readonly el: HTMLElement;
  private btn: HTMLButtonElement;
  private panel: HTMLElement;
  private last = '';
  private lastPanel = '';
  private pressTimer = 0;
  private longPressed = false;

  constructor(private hooks: BarHooks) {
    this.el = document.createElement('header');
    this.el.className = 'bar';
    this.el.innerHTML = `<button type="button" class="bar-btn" id="bar-btn" aria-expanded="false" aria-controls="bar-panel">
        <span class="bar-time num" id="bar-time"></span><span class="bar-note muted" id="bar-note"></span>
        <span class="bar-status"><i class="status-dot" id="bar-dot" aria-hidden="true"></i><span>Tidtabell</span><span class="chev" aria-hidden="true"></span></span>
      </button>
      <div class="bar-panel panel" id="bar-panel" role="region" aria-label="Tidtabell och klocka" hidden></div>`;
    this.btn = this.el.querySelector('#bar-btn') as HTMLButtonElement;
    this.panel = this.el.querySelector('#bar-panel') as HTMLElement;

    this.btn.addEventListener('pointerdown', () => {
      this.longPressed = false;
      this.pressTimer = window.setTimeout(() => {
        this.longPressed = true;
        this.hooks.onLongPress();
      }, 650);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel'] as const) this.btn.addEventListener(ev, () => clearTimeout(this.pressTimer));
    this.btn.addEventListener('contextmenu', (e) => e.preventDefault());
    this.btn.addEventListener('click', (e) => {
      if (this.longPressed) {
        this.longPressed = false;
        e.preventDefault();
        return;
      }
      this.toggle();
    });
    this.panel.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      if (b.dataset.act === 'live') this.hooks.onAction({ type: 'live' });
      else if (b.dataset.act === 'pause') this.hooks.onAction({ type: 'pause' });
      else if (b.dataset.scale) this.hooks.onAction({ type: 'scale', scale: Number(b.dataset.scale) });
      else if (b.dataset.time) this.hooks.onAction({ type: 'time', hhmm: b.dataset.time });
    });
    this.panel.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.id !== 'bar-date' && t.id !== 'bar-time-in') return;
      const date = (this.panel.querySelector('#bar-date') as HTMLInputElement).value;
      const time = (this.panel.querySelector('#bar-time-in') as HTMLInputElement).value;
      this.hooks.onAction({ type: 'datetime', date, time });
    });
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  toggle(open?: boolean): void {
    const next = open ?? this.panel.hidden;
    this.panel.hidden = !next;
    this.btn.setAttribute('aria-expanded', String(next));
  }

  focusButton(): void {
    this.btn.focus();
  }

  render(s: BarState): void {
    const st = statusOf(s.validity);
    const time = clockText(s.sec, s.clock);
    const note = clockNote(s.clock);
    const key = `${time}|${note}|${st.cls}|${s.validity.status}`;
    if (key !== this.last) {
      this.last = key;
      (this.el.querySelector('#bar-time') as HTMLElement).textContent = time;
      (this.el.querySelector('#bar-note') as HTMLElement).textContent = note;
      (this.el.querySelector('#bar-dot') as HTMLElement).className = `status-dot ${st.cls}`;
      this.btn.setAttribute(
        'aria-label',
        `Klocka ${time} Romtid${note ? `, ${note}` : ''}. Tidtabell ${st.text}. ${this.isOpen ? 'Stäng' : 'Öppna'} detaljer`,
      );
    }
    // panelens innehåll byggs bara om när något ändras (annars tappar fält fokus varje sekund)
    const pkey = `${st.cls}|${st.text}|${s.clock.isLive}|${s.clock.paused}|${s.clock.scale}|${s.validity.from}|${s.validity.to}|${s.build}`;
    if (pkey !== this.lastPanel) {
      this.lastPanel = pkey;
      const c = s.clock;
      const pressed = (on: boolean) => `aria-pressed="${on}"`;
      this.panel.innerHTML = `
        <div class="bar-row"><span class="status-dot ${st.cls}" aria-hidden="true"></span><strong>Giltig till ${esc(fmtDate(s.validity.to))}</strong></div>
        <p class="muted bar-small">Tidtabellen gäller ${esc(fmtDate(s.validity.from))} till ${esc(fmtDate(s.validity.to))}, ${esc(st.text)}. Positionerna är beräknade ur tidtabellen, inte realtid.</p>
        <div class="bar-label">Klocka</div>
        <div class="seg" role="group" aria-label="Klockhastighet">
          <button type="button" data-act="live" ${pressed(c.isLive)}>Nu</button>
          <button type="button" data-act="pause" ${pressed(c.paused)}>Paus</button>
          <button type="button" data-scale="10" ${pressed(!c.isLive && c.scale === 10)}>×10</button>
          <button type="button" data-scale="60" ${pressed(!c.isLive && c.scale === 60)}>×60</button>
        </div>
        <div class="seg" role="group" aria-label="Gå till tid">
          <button type="button" data-time="06:00">06:00</button>
          <button type="button" data-time="12:00">12:00</button>
          <button type="button" data-time="18:00">18:00</button>
          <button type="button" data-time="00:30">00:30</button>
        </div>
        <label class="field"><span>Datum</span><input type="date" id="bar-date"></label>
        <label class="field"><span>Tid (Rom)</span><input type="time" id="bar-time-in" step="60"></label>
        <p class="muted bar-small num">Bygge ${esc(s.build)}</p>`;
    }
  }
}

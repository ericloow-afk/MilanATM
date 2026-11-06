/** Bottenpanel (bottom sheet) med tre lägen: peek, half, full. Dra i handtaget eller använd tangentbord. */
export type SheetState = 'peek' | 'half' | 'full';

const ORDER: SheetState[] = ['peek', 'half', 'full'];

/** Minimiläget visar bara handtaget (44 px) och rubrikraden (52 px). */
export const PEEK_CONTENT_PX = 44 + 52;

/**
 * Synlig höjd i pixlar för varje läge (ren funktion; testbar).
 * viewportH = den synliga höjden (visualViewport), bottomInset = safe area + det som Safaris verktygsfält täcker.
 */
export function sheetHeights(viewportH: number, bottomInset: number): Record<SheetState, number> {
  return {
    peek: PEEK_CONTENT_PX + bottomInset,
    half: Math.round(viewportH * 0.44 + bottomInset),
    full: Math.round(viewportH * 0.7 + bottomInset),
  };
}

/** Hur mycket av layoutviewporten som döljs under den synliga ytan (t.ex. Safaris verktygsfält eller tangentbord). */
export function bottomOverlap(innerHeight: number, vvHeight: number, vvOffsetTop: number): number {
  return Math.max(0, Math.round(innerHeight - (vvOffsetTop + vvHeight)));
}

let safeProbe: HTMLElement | null = null;
/** env(safe-area-inset-bottom) i pixlar, uppmätt med ett osynligt element (custom properties ger ibland bara texten "env(...)"). */
function safeAreaBottomPx(): number {
  if (!safeProbe) {
    safeProbe = document.createElement('div');
    safeProbe.style.cssText = 'position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom,0px)';
    document.body.append(safeProbe);
  }
  return parseFloat(getComputedStyle(safeProbe).paddingBottom) || 0;
}

/** Välj närmaste läge för en synlig höjd, med hänsyn till hastighet (px/ms, positiv = nedåt). */
export function snapState(visible: number, velocityPxPerMs: number, h: Record<SheetState, number>): SheetState {
  const projected = visible - velocityPxPerMs * 180;
  let best: SheetState = 'peek';
  for (const s of ORDER) if (Math.abs(h[s] - projected) < Math.abs(h[best] - projected)) best = s;
  return best;
}

export class BottomSheet {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  private handle: HTMLButtonElement;
  private heights: Record<SheetState, number>;
  private _state: SheetState = 'peek';
  private visible = 0;
  onChange?: (s: SheetState) => void;

  constructor(
    root: HTMLElement,
    private reducedMotion: () => boolean,
  ) {
    this.el = document.createElement('section');
    this.el.className = 'sheet';
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', 'Tåg på kartan');
    this.el.innerHTML = `<button type="button" class="grip sheet-handle" aria-label="Ändra panelens höjd" aria-expanded="false"><span aria-hidden="true"></span></button><div class="sheet-body"></div>`;
    root.append(this.el);
    this.handle = this.el.querySelector('.sheet-handle') as HTMLButtonElement;
    this.body = this.el.querySelector('.sheet-body') as HTMLElement;
    this.el.dataset.state = 'peek';
    this.heights = this.measure();
    this.apply(this.heights.peek, false);
    this.bind();
    const remeasure = () => {
      this.heights = this.measure();
      this.apply(this.heights[this._state], false);
    };
    window.addEventListener('resize', remeasure);
    window.addEventListener('orientationchange', remeasure);
    // Safaris verktygsfält krymper/växer när man scrollar eller trycker: följ den synliga ytan
    window.visualViewport?.addEventListener('resize', remeasure);
    window.visualViewport?.addEventListener('scroll', remeasure);
  }

  get state(): SheetState {
    return this._state;
  }

  private measure(): Record<SheetState, number> {
    const vv = window.visualViewport;
    const vvH = vv?.height ?? window.innerHeight;
    const overlap = vv ? bottomOverlap(window.innerHeight, vv.height, vv.offsetTop) : 0;
    const inset = safeAreaBottomPx() + overlap;
    document.documentElement.style.setProperty('--sheet-inset', `${inset}px`);
    return sheetHeights(vvH, inset);
  }

  private apply(visiblePx: number, animate: boolean): void {
    this.visible = visiblePx;
    this.el.classList.toggle('animate', animate && !this.reducedMotion());
    this.el.style.setProperty('--sheet-full', `${this.heights.full}px`);
    this.el.style.setProperty('--sheet-visible', `${visiblePx}px`);
    document.documentElement.style.setProperty('--sheet-visible-px', `${visiblePx}px`);
  }

  setState(s: SheetState, animate = true): void {
    const changed = s !== this._state;
    this._state = s;
    this.el.dataset.state = s;
    this.handle.setAttribute('aria-expanded', String(s !== 'peek'));
    this.apply(this.heights[s], animate);
    if (changed) this.onChange?.(s);
  }

  private bind(): void {
    let drag: { startY: number; startVisible: number; lastY: number; lastT: number; v: number } | null = null;
    const down = (e: PointerEvent) => {
      drag = { startY: e.clientY, startVisible: this.visible, lastY: e.clientY, lastT: e.timeStamp, v: 0 };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      this.el.classList.remove('animate');
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const dt = Math.max(1, e.timeStamp - drag.lastT);
      drag.v = (e.clientY - drag.lastY) / dt;
      drag.lastY = e.clientY;
      drag.lastT = e.timeStamp;
      const v = Math.min(this.heights.full, Math.max(this.heights.peek, drag.startVisible - (e.clientY - drag.startY)));
      this.apply(v, false);
    };
    const up = (e: PointerEvent) => {
      if (!drag) return;
      const moved = Math.abs(e.clientY - drag.startY);
      const target = moved < 5 ? this.next() : snapState(this.visible, drag.v, this.heights);
      drag = null;
      this.setState(target, true);
    };
    this.handle.addEventListener('pointerdown', down);
    this.handle.addEventListener('pointermove', move);
    this.handle.addEventListener('pointerup', up);
    this.handle.addEventListener('pointercancel', () => {
      drag = null;
      this.setState(this._state, true);
    });
    // Tangentbord: piltangenter byter läge (Enter/mellanslag hanteras av pointerup-liknande klick nedan)
    this.handle.addEventListener('keydown', (e) => {
      const i = ORDER.indexOf(this._state);
      if (e.key === 'ArrowUp') this.setState(ORDER[Math.min(2, i + 1)]);
      else if (e.key === 'ArrowDown') this.setState(ORDER[Math.max(0, i - 1)]);
      else if (e.key === 'Enter' || e.key === ' ') this.setState(this.next());
      else return;
      e.preventDefault();
    });
  }

  private next(): SheetState {
    return ORDER[(ORDER.indexOf(this._state) + 1) % ORDER.length];
  }
}

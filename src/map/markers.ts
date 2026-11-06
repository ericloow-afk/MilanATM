/** Tågmarkörer (DOM) på kartan: linjebricka, riktning, pulserande ring vid uppehåll, vit ring när valt. */
import { Marker, type Map as MlMap } from 'maplibre-gl';
import type { Train } from '../engine/types';
import type { Animated } from './anim';

interface Entry {
  marker: Marker;
  el: HTMLButtonElement;
  label: string;
  cls: string;
  heading: number;
}

export interface MarkerHooks {
  onSelect(id: string): void;
  /** t.ex. "M2 mot Abbiategrasso, står vid Garibaldi FS" */
  describe(t: Train): string;
  lineLabel(line: string): string;
}

export class TrainMarkers {
  private entries = new Map<string, Entry>();

  constructor(
    private map: MlMap,
    private hooks: MarkerHooks,
  ) {}

  private create(t: Train): Entry {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'tm';
    el.tabIndex = -1; // tågen nås via tåglistan med tangentbord; vald markör får tabIndex 0
    el.innerHTML = `<span class="tm-pulse" aria-hidden="true"></span><span class="tm-dir" aria-hidden="true"><i></i></span><span class="tm-badge">${this.hooks.lineLabel(t.line)}</span>`;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hooks.onSelect(t.id);
    });
    const marker = new Marker({ element: el, anchor: 'center', rotationAlignment: 'viewport', pitchAlignment: 'viewport' });
    marker.setLngLat([0, 0]).addTo(this.map);
    return { marker, el, label: '', cls: '', heading: NaN };
  }

  update(items: { anim: Animated; train: Train }[], selectedId: string | null): void {
    const seen = new Set<string>();
    for (const { anim, train } of items) {
      if (anim.vanishing) continue;
      seen.add(train.id);
      let e = this.entries.get(train.id);
      if (!e) {
        e = this.create(train);
        this.entries.set(train.id, e);
      }
      e.marker.setLngLat([anim.lon, anim.lat]);
      const cls = `tm l-${train.line}${train.status === 'dwelling' ? ' dwell' : ''}${train.shapeQuality === 'coarse' ? ' coarse' : ''}${train.id === selectedId ? ' sel' : ''}`;
      if (cls !== e.cls) {
        e.el.className = cls;
        e.cls = cls;
        e.el.tabIndex = train.id === selectedId ? 0 : -1;
        e.el.setAttribute('aria-pressed', train.id === selectedId ? 'true' : 'false');
      }
      if (Math.abs(anim.heading - e.heading) > 0.5 || Number.isNaN(e.heading)) {
        e.el.style.setProperty('--h', `${anim.heading.toFixed(1)}deg`);
        e.heading = anim.heading;
      }
      const label = this.hooks.describe(train);
      if (label !== e.label) {
        e.el.setAttribute('aria-label', label);
        e.label = label;
      }
    }
    for (const [id, e] of this.entries) {
      if (!seen.has(id)) {
        e.marker.remove();
        this.entries.delete(id);
      }
    }
  }

  focus(id: string): void {
    this.entries.get(id)?.el.focus({ preventScroll: true });
  }
  clear(): void {
    for (const e of this.entries.values()) e.marker.remove();
    this.entries.clear();
  }
}

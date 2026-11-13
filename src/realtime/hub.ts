/**
 * RealtimeHub: frågar källorna i lagom takt och håller de senaste observationerna.
 * - Nätkällor frågas högst en gång per 30 s (eller källans eget längre intervall). Lokala källor (manual) varje tick.
 * - Ingen hämtning när fliken är dold.
 * - En källa som nekar (401/403/429, HTML) stängs av för resten av sessionen. Andra fel: senaste svaret behålls.
 */
import { SourceBlockedError } from './http';
import { observationKey, type RealtimeObservation, type RealtimeSource } from './types';

export const MIN_NETWORK_INTERVAL_MS = 30_000;

interface SourceState {
  last: number;
  inFlight: boolean;
  blocked: boolean;
  obs: RealtimeObservation[];
  error: string | null;
  updatedAt: number | null;
}

export interface HubOptions {
  isHidden?: () => boolean;
  /** anropas när observationerna har ändrats */
  onChange?: () => void;
}

export class RealtimeHub {
  /** ökar varje gång observationerna ändras (konsumenter räknar om bara då) */
  version = 0;
  private state = new Map<string, SourceState>();
  private cache: RealtimeObservation[] = [];
  private cacheVersion = -1;

  constructor(
    readonly sources: readonly RealtimeSource[],
    private opts: HubOptions = {},
  ) {
    for (const s of sources) this.state.set(s.id, { last: -Infinity, inFlight: false, blocked: false, obs: [], error: null, updatedAt: null });
  }

  intervalFor(s: RealtimeSource): number {
    return s.kind === 'manual' ? s.minIntervalMs : Math.max(s.minIntervalMs, MIN_NETWORK_INTERVAL_MS);
  }

  /**
   * Anropas ungefär en gång per sekund. `wall` = verklig tid (styr intervallen), `view` = vyns klocka som
   * källorna får (simulerad tid i AR-simulatorn; annars samma som wall).
   */
  tick(wall: number, view = wall): void {
    const hidden = this.opts.isHidden?.() ?? false;
    for (const s of this.sources) {
      const st = this.state.get(s.id)!;
      if (!s.enabled || st.blocked || st.inFlight) continue;
      if (hidden && s.kind !== 'manual') continue;
      if (wall - st.last < this.intervalFor(s)) continue;
      void this.poll(s, wall, view);
    }
  }

  /** Fråga en källa direkt (t.ex. ManualSource efter ett knapptryck). Respekterar inte intervallet: bara för lokala källor. */
  async poll(s: RealtimeSource, wall: number, view = wall): Promise<void> {
    const st = this.state.get(s.id);
    if (!st || st.inFlight) return;
    st.inFlight = true;
    st.last = wall;
    try {
      const obs = await s.observe(view);
      st.error = null;
      st.updatedAt = wall;
      if (!sameObservations(st.obs, obs)) {
        st.obs = obs;
        this.version++;
        this.opts.onChange?.();
      }
    } catch (e) {
      st.error = e instanceof Error ? e.message : String(e);
      if (e instanceof SourceBlockedError) {
        st.blocked = true;
        if (st.obs.length) {
          st.obs = [];
          this.version++;
          this.opts.onChange?.();
        }
      }
    } finally {
      st.inFlight = false;
    }
  }

  pollById(id: string, wall: number, view = wall): Promise<void> {
    const s = this.sources.find((x) => x.id === id);
    return s ? this.poll(s, wall, view) : Promise.resolve();
  }

  observations(): RealtimeObservation[] {
    if (this.cacheVersion !== this.version) {
      this.cache = [...this.state.values()].flatMap((st) => st.obs);
      this.cacheVersion = this.version;
    }
    return this.cache;
  }

  /** Linjestatus (kind = status), senaste per linje. */
  lineStatus(): Map<string, RealtimeObservation> {
    const m = new Map<string, RealtimeObservation>();
    for (const o of this.observations()) if (o.kind === 'status' && (!m.has(o.line) || m.get(o.line)!.observedAt < o.observedAt)) m.set(o.line, o);
    return m;
  }

  /** Aktiva källor och deras läge, för UI och felsökning. */
  describe(): { id: string; kind: RealtimeSource['kind']; enabled: boolean; blocked: boolean; error: string | null; count: number; updatedAt: number | null }[] {
    return this.sources.map((s) => {
      const st = this.state.get(s.id)!;
      return { id: s.id, kind: s.kind, enabled: s.enabled, blocked: st.blocked, error: st.error, count: st.obs.length, updatedAt: st.updatedAt };
    });
  }
}

function sameObservations(a: readonly RealtimeObservation[], b: readonly RealtimeObservation[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (observationKey(a[i]) !== observationKey(b[i])) return false;
  return true;
}

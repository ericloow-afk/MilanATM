/** Texter för tågets källa: "tidtabell", "justerad +2 min", "live". Ren TS. */
import type { TrainSource } from './types';

const MINUS = '−';

/** Försening som kort text: "+40 s", "+2 min", "−1 min", "±0 min". */
export function fmtDelay(sec: number): string {
  const r = Math.round(sec);
  if (Math.abs(r) < 60) {
    if (r === 0) return '±0 min';
    return `${r > 0 ? '+' : MINUS}${Math.abs(r)} s`;
  }
  const m = Math.round(Math.abs(r) / 60);
  return `${r > 0 ? '+' : MINUS}${m} min`;
}

/** Kort etikett för kartpanelen och AR-etiketten. */
export function sourceLabel(source: TrainSource, delaySec: number): string {
  if (source === 'adjusted') return `justerad ${fmtDelay(delaySec)}`;
  if (source === 'live') return 'live';
  return 'tidtabell';
}

/** Längre förklaring (panelens fotnot). */
export function sourceNote(source: TrainSource, delaySec: number, sourceName?: string): string {
  if (source === 'adjusted') return `Justerad för hand (Tåget kom nu), ${fmtDelay(delaySec)} mot tidtabellen vid nästa station. Gäller i 15 minuter.`;
  if (source === 'live') return `Live${sourceName ? ` från ${sourceName}` : ''}, ${fmtDelay(delaySec)} mot tidtabellen vid nästa station.`;
  return 'Enligt tidtabell, inte realtid.';
}

import { trains } from '../engine';
import type { MetroData } from '../engine/types';

/**
 * Första tidpunkten (ms) från `fromMs` då något tåg kör, avsökt i steg om `stepSec` upp till `horizonH` timmar.
 * null om inget hittas (till exempel efter att tidtabellen gått ut). Används för "Ingen trafik just nu".
 */
export function findNextTrafficMs(data: MetroData, fromMs: number, stepSec = 120, horizonH = 26): number | null {
  const end = fromMs + horizonH * 3600_000;
  for (let t = fromMs; t <= end; t += stepSec * 1000) {
    if (trains(data, new Date(t)).length > 0) return t;
  }
  return null;
}

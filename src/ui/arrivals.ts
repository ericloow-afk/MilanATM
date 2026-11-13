/**
 * Panelen "Tåget kom nu" för en station: en rad per riktning med nästa tåg och knappen.
 * Används av kartan (vald station) och AR-vyn (närmaste station). Ren HTML-sträng; händelser via data-attribut:
 *   data-arrive="<riktnings-id>"  data-undo  data-export
 */
import { esc } from '../map/format';
import { fmtDelay, sourceLabel } from '../realtime/label';
import type { TrainSource } from '../realtime/types';
import { lineBadge } from './line-badge';

export interface ArrivalRow {
  direction: string;
  directionName: string;
  line: string;
  lineLabel: string;
  trains: { etaMs: number; atStation: boolean; source: TrainSource; delaySec: number }[];
}

export interface ArrivalPanelState {
  rows: ArrivalRow[];
  now: number;
  /** false när klockan inte visar nu (kartan spolad): knapparna är då avstängda */
  canAdjust: boolean;
  /** bekräftelse efter knapptryck; undo = visa Ångra */
  confirm: { text: string; undo: boolean } | null;
  logCount: number;
}

function etaText(etaMs: number, atStation: boolean, now: number): string {
  if (atStation) return 'vid perrongen';
  const min = Math.floor((etaMs - now) / 60_000);
  return min < 1 ? 'under 1 min' : `${min} min`;
}

/** Tider och källa per rad (uppdateras på plats varje sekund utan att knapparna byts ut). */
export function rowTexts(r: ArrivalRow, now: number): { times: string; src: string; source: TrainSource } {
  const first = r.trains[0];
  return { times: r.trains.map((t) => etaText(t.etaMs, t.atStation, now)).join(' · '), src: sourceLabel(first.source, first.delaySec), source: first.source };
}

/** Ändras bara när panelens struktur ändras (riktningar, knapparnas läge, bekräftelse, loggens storlek). */
export function arrivalsKey(s: ArrivalPanelState): string {
  return [s.rows.filter((r) => r.trains.length).map((r) => r.direction).join('|'), s.canAdjust, s.confirm ? s.confirm.text + s.confirm.undo : '', s.logCount].join('#');
}

/** Uppdaterar tider och källa i en redan ritad panel. */
export function updateArrivalTexts(root: HTMLElement, s: ArrivalPanelState): void {
  for (const r of s.rows) {
    if (!r.trains.length) continue;
    const li = root.querySelector<HTMLElement>(`[data-row="${CSS.escape(r.direction)}"]`);
    if (!li) continue;
    const t = rowTexts(r, s.now);
    const times = li.querySelector('.arr-times');
    const src = li.querySelector<HTMLElement>('.arr-src');
    if (times && times.textContent !== t.times) times.textContent = t.times;
    if (src && src.textContent !== t.src) src.textContent = t.src;
    if (src && src.dataset.src !== t.source) src.dataset.src = t.source;
  }
}

export function arrivalsHtml(s: ArrivalPanelState): string {
  const rows = s.rows
    .filter((r) => r.trains.length > 0)
    .map((r) => {
      const { times, src } = rowTexts(r, s.now);
      const first = r.trains[0];
      return `<li class="arr-row" data-row="${esc(r.direction)}">
        ${lineBadge(r.line, r.lineLabel, 'sm')}
        <span class="arr-text"><span class="arr-dir">mot ${esc(r.directionName)}</span><span class="arr-times num">${esc(times)}</span><span class="arr-src" data-src="${first.source}">${esc(src)}</span></span>
        <button type="button" class="btn secondary arr-btn" data-arrive="${esc(r.direction)}" aria-label="Tåget mot ${esc(r.directionName)} kom nu"${s.canAdjust ? '' : ' disabled'}>Tåget kom nu</button>
      </li>`;
    })
    .join('');
  const empty = '<p class="arr-empty muted">Inga tåg här de närmaste 20 minuterna enligt tidtabellen.</p>';
  return `<p class="arr-hint muted">${s.canAdjust ? 'Tryck när tåget stannar vid perrongen. Närmaste tåg i den riktningen justeras i 15 minuter.' : 'Gå till Nu i klockan för att justera tåg.'}</p>
    ${rows ? `<ul class="arrivals" aria-label="Nästa tåg">${rows}</ul>` : empty}
    ${s.confirm ? `<div class="arr-confirm" role="status"><span>${esc(s.confirm.text)}</span>${s.confirm.undo ? '<button type="button" class="btn ghost" data-undo>Ångra</button>' : ''}</div>` : ''}
    <div class="arr-log"><span class="muted">Logg: <span class="num">${s.logCount}</span> ${s.logCount === 1 ? 'observation' : 'observationer'}</span><button type="button" class="btn secondary" data-export${s.logCount ? '' : ' disabled'}>Exportera CSV</button></div>`;
}

/** Bekräftelsetext efter "Tåget kom nu". */
export function confirmText(lineLabel: string, directionName: string, delaySec: number): string {
  const d = Math.round(delaySec);
  const vs = Math.abs(d) < 30 ? 'i tid enligt tidtabellen' : `${fmtDelay(d)} mot tidtabellen`;
  return `${lineLabel} mot ${directionName}: ${vs}.`;
}

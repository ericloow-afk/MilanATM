/**
 * LineBadge: den gemensamma linjebrickan (M1–M5). Används i kartlistan, bottenpanelen, kartmarkörerna, AR-etiketterna och kantpilarna.
 * Utseendet (kvadratisk, rundad, platt färg) ligger i src/styles/components.css (.lb). Ritar inte ATM:s logotyp.
 */
export type LineBadgeSize = 'sm' | 'md';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Etikett för en linje, t.ex. ("M1", "1") → "M1". */
export const lineLabel = (lineId: string, shortName?: string): string => `M${shortName ?? lineId.replace(/^M/, '')}`;

/** HTML för en bricka. lineId är linjens id ("M1"…"M5"), label visas i brickan. */
export function lineBadge(lineId: string, label: string, size: LineBadgeSize = 'md', extraClass = ''): string {
  return `<span class="lb lb-${size} l-${esc(lineId)}${extraClass ? ' ' + esc(extraClass) : ''}" role="img" aria-label="Linje ${esc(label)}">${esc(label)}</span>`;
}

/** Samma bricka som DOM-element. */
export function lineBadgeEl(lineId: string, label: string, size: LineBadgeSize = 'md'): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = lineBadge(lineId, label, size);
  return t.content.firstElementChild as HTMLElement;
}

/**
 * "Rikta telefonen nedåt": när tåg finns inom radien men inget syns i bild, säg åt vilket håll man ska rikta
 * kameran mot närmaste tåg. Fältmätningen 8/11 visade att tåg på ca −15 m syns först vid brant lutning (beta < 55°).
 * Ren TS.
 */

export type AimKind = 'down' | 'up' | 'left' | 'right' | 'behind';

export interface AimHint {
  kind: AimKind;
  text: string;
  /** pilens riktning på skärmen (radianer, 0 = höger, π/2 = nedåt) */
  angleRad: number;
}

const TEXT: Record<AimKind, string> = {
  down: 'Rikta telefonen nedåt',
  up: 'Rikta telefonen uppåt',
  left: 'Vrid telefonen åt vänster',
  right: 'Vrid telefonen åt höger',
  behind: 'Tåget är bakom dig',
};

/**
 * (x, y): målets riktning i kameraramen eller NDC (x höger, y uppåt). behind = målet ligger bakom kameran.
 * Nedåt vinner när målet mest ligger under bilden, även om det också är lite bakom (blick mot horisonten, tåget under fötterna).
 */
export function aimHint(x: number, y: number, behind: boolean): AimHint {
  const angleRad = Math.atan2(-y, x);
  let kind: AimKind;
  if (!behind) kind = Math.abs(y) >= Math.abs(x) ? (y < 0 ? 'down' : 'up') : x < 0 ? 'left' : 'right';
  else if (y < 0 && Math.abs(y) > 2 * Math.abs(x)) kind = 'down';
  else kind = 'behind';
  return { kind, text: TEXT[kind], angleRad: kind === 'behind' ? (x < 0 ? Math.PI : 0) : angleRad };
}

/** Visa raden? Bara när tåg finns inom radien, inget syns i bild och orienteringen fungerar. */
export function shouldShowAim(nearbyCount: number, onScreenCount: number, haveOrientation: boolean): boolean {
  return haveOrientation && nearbyCount > 0 && onScreenCount === 0;
}

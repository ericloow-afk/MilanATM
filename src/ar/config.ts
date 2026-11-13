/** Konstanter för AR-vyn. Uppmätta eller uppskattade värden är märkta. */

export const AR_CONFIG = {
  /**
   * Kamerans lodräta synfält i grader. UPPMÄTT CA (8/11): ca 38° vågrätt (en lyktstolpe från vänster till höger
   * bildkant), vilket med kamerans bildförhållande ger ca 64° lodrätt. Förutsätter att telefonen hålls stående.
   * Kan finjusteras i Kalibrera.
   */
  fovVerticalDeg: 64,
  /** tåg inom så här många meter visas */
  radiusM: 300,
} as const;

/**
 * Perrongläget: tågen ritas på perrongens nivå i stället för linjens djup under gatan.
 * relativeDepthM = hur långt under ögonhöjden tågets mitt ligger (meter). UPPSKATTNING (estimate: true):
 * vagnens mitt ligger ungefär i brösthöjd till en meter under ögonen, inom 0–1,5 m.
 */
export const PLATFORM = {
  relativeDepthM: 0.3,
  estimate: true as const,
  /** ögonhöjd över perronggolvet (m), där rutnätet läggs */
  eyeHeightM: 1.6,
} as const;

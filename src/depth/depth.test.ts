import { describe, expect, it } from 'vitest';
import { depthFor, depthTable } from './index';

describe('depth', () => {
  it('är märkt som uppskattning och täcker M1–M5 med positiva djup', () => {
    expect(depthTable.estimate).toBe(true);
    for (const id of ['M1', 'M2', 'M3', 'M4', 'M5']) {
      expect(depthFor(id).meters).toBeGreaterThan(0);
      expect(depthFor(id).estimate).toBe(true);
    }
  });
  it('okänd linje ger standardvärdet, också märkt estimate', () => {
    const d = depthFor('M9');
    expect(d.meters).toBe(depthTable.defaultMeters);
    expect(d.estimate).toBe(true);
  });
  it('har en anteckning om att värdena inte är researchade', () => {
    expect(depthTable.note.toLowerCase()).toContain('inte');
  });
});

import table from './depth.json';

export interface DepthTable {
  estimate: boolean;
  unit: string;
  note: string;
  defaultMeters: number;
  lines: Record<string, number>;
}

export const depthTable: DepthTable = table;

/** Djup under marknivå (meter) för en linje. Alltid märkt estimate tills riktiga värden finns. */
export function depthFor(line: string): { meters: number; estimate: true } {
  return { meters: depthTable.lines[line] ?? depthTable.defaultMeters, estimate: true };
}

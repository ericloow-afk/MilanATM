// Användning: node tools/build-metro.mjs [data/raw/gtfs.zip] [public/metro.json]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildMetro, formatReport } from './lib/build-metro-lib.mjs';

const zip = process.argv[2] ?? 'data/raw/gtfs.zip';
const out = process.argv[3] ?? 'public/metro.json';

const t0 = Date.now();
const result = buildMetro(zip);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, result.json);
const text = formatReport(result);
mkdirSync('docs', { recursive: true });
writeFileSync('docs/metro-build-report.md', text);
console.log(text);
console.log(`Skrev ${out} på ${((Date.now() - t0) / 1000).toFixed(1)} s. Rapport: docs/metro-build-report.md`);

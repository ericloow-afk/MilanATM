// Användning: node tools/dwell-report.mjs [public/metro.json]
// Rapporterar uppehållstider (avgång − ankomst) per linje och station ur metro.json, och vad uppehållsmodellen ger.
import { readFileSync, writeFileSync } from 'node:fs';
import { dwellReport, formatDwellReport } from './lib/dwell-report.mjs';

const metro = JSON.parse(readFileSync(process.argv[2] ?? 'public/metro.json', 'utf8'));
const text = formatDwellReport(dwellReport(metro));
writeFileSync('docs/dwell-report.md', text);
console.log(text);

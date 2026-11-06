// Användning: node tools/segment-speeds.mjs [public/metro.json]
// Skriver docs/segment-speed-report.md: först med uppehållsmodellen (som appen visar), sedan tidtabellen exakt.
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_DWELL } from '../src/engine/dwell.ts';
import { formatSpeedReport, segmentSpeeds } from './lib/segment-speeds.mjs';

const metro = JSON.parse(readFileSync(process.argv[2] ?? 'public/metro.json', 'utf8'));
const withModel = formatSpeedReport(segmentSpeeds(metro, DEFAULT_DWELL), 15, 'med uppehållsmodell (estimate) och trapetsprofil');
const scheduleOnly = formatSpeedReport(segmentSpeeds(metro, null), 15, 'tidtabellen exakt (inga uppehåll)');
const text = `${withModel}\n${scheduleOnly.replace(/^# /m, '## ')}`;
writeFileSync('docs/segment-speed-report.md', text);
console.log(text);

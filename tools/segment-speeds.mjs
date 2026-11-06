// Användning: node tools/segment-speeds.mjs [public/metro.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { formatSpeedReport, segmentSpeeds } from './lib/segment-speeds.mjs';

const metro = JSON.parse(readFileSync(process.argv[2] ?? 'public/metro.json', 'utf8'));
const text = formatSpeedReport(segmentSpeeds(metro));
writeFileSync('docs/segment-speed-report.md', text);
console.log(text);

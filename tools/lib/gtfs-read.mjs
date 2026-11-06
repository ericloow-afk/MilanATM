// Läsning av GTFS-zip. Små filer packas upp i minnet; stora (stop_times.txt) strömmas.
import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import { Unzip, UnzipInflate, unzipSync } from 'fflate';

export const BIG_FILES = new Set(['stop_times.txt']);

/** Delar en CSV-rad med stöd för citattecken. */
export function splitCsv(line) {
  if (!line.includes('"')) return line.split(',');
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** "H:MM:SS" (H kan vara >= 24) -> sekunder från midnatt. */
export function parseTime(t) {
  const m = /^(\d+):(\d\d):(\d\d)$/.exec(String(t).trim());
  if (!m) throw new Error(`Ogiltig GTFS-tid: "${t}"`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function* textLines(text) {
  let start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    const i = text.indexOf('\n', start);
    if (i < 0) break;
    const end = text[i - 1] === '\r' ? i - 1 : i;
    if (end > start) yield text.slice(start, end);
    start = i + 1;
  }
  if (start < text.length) yield text.slice(start).replace(/\r$/, '');
}

/** Packar upp alla filer utom de stora; ger table(name) -> rader som objekt. */
export function readTables(zipPath) {
  const files = unzipSync(new Uint8Array(readFileSync(zipPath)), { filter: (f) => !BIG_FILES.has(f.name) });
  const dec = new TextDecoder('utf-8');
  return {
    has: (name) => name in files,
    table(name) {
      if (!(name in files)) return [];
      let header;
      const out = [];
      for (const line of textLines(dec.decode(files[name]))) {
        if (!header) { header = splitCsv(line).map((h) => h.trim()); continue; }
        const f = splitCsv(line);
        const o = {};
        for (let i = 0; i < header.length; i++) o[header[i]] = f[i] ?? '';
        out.push(o);
      }
      return out;
    },
  };
}

/**
 * Strömmar en fil ur zip-filen rad för rad, utan att hela filen hålls i minnet.
 * onHeader(headerArray) anropas först. onRow(fieldsArray) för varje rad.
 * keepFirstField: om satt och första kolumnen heter trip_id hoppas rader över
 * redan på råtext när första fältet inte finns i mängden.
 */
export function streamZipFile(zipPath, name, { onHeader, onRow, keepFirstField = null }) {
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  let found = false;
  let finished = false;
  unzip.onfile = (file) => {
    if (file.name !== name) return;
    found = true;
    const dec = new TextDecoder('utf-8');
    let tail = '';
    let header = null;
    let fastFilter = false;
    const handle = (raw) => {
      let line = raw;
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line) return;
      if (!header) {
        if (line.charCodeAt(0) === 0xfeff) line = line.slice(1);
        header = splitCsv(line).map((h) => h.trim());
        fastFilter = keepFirstField != null && header[0] === 'trip_id';
        onHeader?.(header);
        return;
      }
      if (fastFilter) {
        const c = line.indexOf(',');
        const first = line.slice(0, c).replaceAll('"', '');
        if (!keepFirstField.has(first)) return;
      }
      onRow(splitCsv(line));
    };
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      tail += dec.decode(chunk, { stream: !final });
      let start = 0;
      for (;;) {
        const i = tail.indexOf('\n', start);
        if (i < 0) break;
        handle(tail.slice(start, i));
        start = i + 1;
      }
      tail = tail.slice(start);
      if (final) {
        if (tail) handle(tail);
        tail = '';
        finished = true;
      }
    };
    file.start();
  };
  const fd = openSync(zipPath, 'r');
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) { unzip.push(new Uint8Array(0), true); break; }
      unzip.push(new Uint8Array(buf.buffer, buf.byteOffset, n).slice(), false);
    }
  } finally {
    closeSync(fd);
  }
  if (!found) throw new Error(`${name} saknas i ${zipPath}`);
  if (!finished) throw new Error(`${name}: strömmen avslutades inte (trasig zip?)`);
}

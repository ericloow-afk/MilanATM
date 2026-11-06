// Frågor mot metro.json (ren JS, ingen DOM) – används av skript och tester.

const activeCache = new WeakMap();

function activeSets(metro) {
  let c = activeCache.get(metro);
  if (!c) {
    c = metro.services.map((s) => ({ add: new Set(s.add), remove: new Set(s.remove) }));
    activeCache.set(metro, c);
  }
  return c;
}

/** Är tjänsten (index) aktiv på datumet YYYYMMDD? Bara calendar_dates: tillagd och inte borttagen. */
export function isServiceActive(metro, serviceIdx, ymd) {
  const s = activeSets(metro)[serviceIdx];
  return s.add.has(ymd) && !s.remove.has(ymd);
}

export function addDays(ymd, delta) {
  const s = String(ymd);
  const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) + delta));
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

export function fmtTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(h % 24)}:${p(m)}:${p(s)}${h >= 24 ? ' (+1 dygn)' : ''}`;
}

/** Hittar stationsindex vars id eller visningsnamn matchar (exakt, annars delsträng), skiftlägesokänsligt. */
export function findStops(metro, query) {
  const q = query.trim().toLowerCase();
  const exact = metro.stops.map((s, i) => [s, i]).filter(([s]) => s.id.toLowerCase() === q || s.name.toLowerCase() === q);
  if (exact.length) return exact.map(([, i]) => i);
  return metro.stops.map((s, i) => [s, i]).filter(([s]) => s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).map(([, i]) => i);
}

/**
 * Nästa avgångar från en station på en linje. sec = sekunder från midnatt idag (lokal tid).
 * Tar med gårdagens tjänstedygn (tider >= 24:00 hör dit) och dagens.
 */
export function nextDepartures(metro, { line, stop, ymd, sec, n = 5 }) {
  const stopIdxs = new Set(typeof stop === 'number' ? [stop] : findStops(metro, stop));
  const out = [];
  const yesterday = addDays(ymd, -1);
  metro.patterns.forEach((p, pi) => {
    if (p.line !== line) return;
    p.stops.forEach((si, i) => {
      if (!stopIdxs.has(si) || i === p.stops.length - 1) return; // terminus har ingen avgång
      const off = p.a[i] + p.w[i];
      for (const t of metro.trips) {
        if (t[0] !== pi) continue;
        // Dagens tjänstedygn, och gårdagens (då är tiden relativ till gårdagens midnatt).
        for (const [day, shift] of [[ymd, 0], [yesterday, -86400]]) {
          if (!isServiceActive(metro, t[1], day)) continue;
          const dep = t[2] + off + shift;
          if (dep >= sec) out.push({ dep, stop: metro.stops[si], dir: metro.directions[p.dir], pattern: pi, service: metro.services[t[1]].id });
        }
      }
    });
  });
  return out.sort((x, y) => x.dep - y.dep).slice(0, n);
}

/** Återskapar varje trips stop_times ur mönstren som signatursträngar (för förlustfritt test). */
export function reconstructSignatures(metro) {
  return metro.trips.map(([pi, si, start]) => {
    const p = metro.patterns[pi];
    const parts = p.stops.map((s, i) => {
      const arr = start + p.a[i];
      return `${metro.stops[s].id},${arr},${arr + p.w[i]}`;
    });
    return `${p.line}|${metro.services[si].id}|${p.shape}|${parts.join(';')}`;
  });
}

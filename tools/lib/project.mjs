// Geo-matematik för byggskriptet: projicera stationer på en shape (polylinje) monotont.
const R = 6371008.8;
const RAD = Math.PI / 180;

/** Platt (equirectangular) projektion till meter kring latRef. Duger i stadsskala. */
export function makeProjector(latRef) {
  const kx = R * RAD * Math.cos(latRef * RAD);
  const ky = R * RAD;
  return (lat, lon) => [lon * kx, lat * ky];
}

/** Stor-cirkel-avstånd i meter (för tester/kontroller). */
export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Projicerar stationer (i färdordning) på polylinjen pts=[[lat,lon],...].
 * Väljer, med dynamisk programmering, den projektion per station som minimerar summan av avstånd
 * under villkoret att sträckan längs linjen (sd) aldrig minskar.
 * Returnerar [{ sd (m från shapens start), dist (m från shapen) }].
 */
export function projectMonotone(pts, stations) {
  if (pts.length < 2) throw new Error('shape har färre än 2 punkter');
  const proj = makeProjector(pts[0][0]);
  const P = pts.map(([la, lo]) => proj(la, lo));
  const K = P.length - 1;
  const cum = new Float64Array(K + 1);
  const segLen = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    segLen[k] = Math.hypot(P[k + 1][0] - P[k][0], P[k + 1][1] - P[k][1]);
    cum[k + 1] = cum[k] + segLen[k];
  }
  // Kandidater: närmaste punkt på varje segment, per station.
  const cand = stations.map(([la, lo]) => {
    const [x, y] = proj(la, lo);
    const sd = new Float64Array(K);
    const dist = new Float64Array(K);
    for (let k = 0; k < K; k++) {
      const dx = P[k + 1][0] - P[k][0];
      const dy = P[k + 1][1] - P[k][1];
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - P[k][0]) * dx + (y - P[k][1]) * dy) / len2));
      sd[k] = cum[k] + t * segLen[k];
      dist[k] = Math.hypot(x - (P[k][0] + t * dx), y - (P[k][1] + t * dy));
    }
    return { sd, dist };
  });
  const n = stations.length;
  const cost = [];
  const back = [];
  for (let i = 0; i < n; i++) {
    const c = new Float64Array(K);
    const b = new Int32Array(K).fill(-1);
    if (i === 0) {
      for (let k = 0; k < K; k++) c[k] = cand[0].dist[k];
    } else {
      const pc = cost[i - 1];
      const psd = cand[i - 1].sd;
      let bestK = -1;
      let bestV = Infinity;
      for (let k = 0; k < K; k++) {
        // Kandidater på tidigare segment (k' < k) är alltid tillåtna.
        // Samma segment är tillåtet bara om sd inte minskar.
        let pk = bestK;
        let pv = bestV;
        if (psd[k] <= cand[i].sd[k] && pc[k] < pv) { pk = k; pv = pc[k]; }
        c[k] = cand[i].dist[k] + pv;
        b[k] = pk;
        // uppdatera prefix-minimum med k (för nästa k)
        if (pc[k] < bestV) { bestV = pc[k]; bestK = k; }
      }
    }
    cost.push(c);
    back.push(b);
  }
  let k = 0;
  for (let j = 1; j < K; j++) if (cost[n - 1][j] < cost[n - 1][k]) k = j;
  const out = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    out[i] = { sd: cand[i].sd[k], dist: cand[i].dist[k] };
    k = back[i][k];
  }
  return out;
}

export function polylineLength(pts) {
  const proj = makeProjector(pts[0][0]);
  const P = pts.map(([la, lo]) => proj(la, lo));
  let s = 0;
  for (let i = 1; i < P.length; i++) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  return s;
}

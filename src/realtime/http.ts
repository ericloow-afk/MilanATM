/** Gemensam, ärlig HTTP-hämtning för realtidskällor. */

/** Källan nekar oss (401/403/429, inloggningsvägg eller HTML). Hubben slutar då fråga den här källan. */
export class SourceBlockedError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SourceBlockedError';
  }
}

export interface HttpConfig {
  url: string;
  /** valfri nyckel; skickas i headern `apiKeyHeader` */
  apiKey?: string;
  apiKeyHeader?: string;
  fetchFn?: typeof fetch;
}

/**
 * GET som JSON. Inga cookies (credentials: 'omit'), inga förfalskade headers. I webbläsaren går det inte att sätta
 * User-Agent; den riktiga webbläsarens används. Vid 401/403/429 eller HTML kastas SourceBlockedError.
 */
export async function getJson(cfg: HttpConfig): Promise<unknown> {
  const f = cfg.fetchFn ?? globalThis.fetch.bind(globalThis);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (cfg.apiKey) headers[cfg.apiKeyHeader ?? 'x-api-key'] = cfg.apiKey;
  const res = await f(cfg.url, { headers, credentials: 'omit', redirect: 'error' });
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    throw new SourceBlockedError(res.status, `HTTP ${res.status}: källan nekade anropet. Slutar fråga.`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (/html/i.test(type)) throw new SourceBlockedError(res.status, 'Svaret var HTML (inloggningsvägg?). Slutar fråga.');
  return res.json();
}

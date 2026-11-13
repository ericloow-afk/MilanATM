/** Liten nyckel/värde-lagring (localStorage i webbläsaren). Alla anrop i try/catch: privat läge kan kasta eller sakna lagring. */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** localStorage om den går att använda, annars null (allt fungerar då men sparas inte mellan sidladdningar). */
export function browserStore(): KeyValueStore | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    s.getItem('__probe__');
    return s;
  } catch {
    return null;
  }
}

export function readJson<T>(store: KeyValueStore | null, key: string, fallback: T): T {
  if (!store) return fallback;
  try {
    const raw = store.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** false om det inte gick att spara (full lagring, privat läge). */
export function writeJson(store: KeyValueStore | null, key: string, value: unknown): boolean {
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Lagring i minnet (tester, och reserv när localStorage saknas). */
export class MemoryStore implements KeyValueStore {
  private m = new Map<string, string>();
  getItem(key: string): string | null {
    return this.m.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.m.set(key, value);
  }
  removeItem(key: string): void {
    this.m.delete(key);
  }
}

// Identifier + consent storage. research-sdk.md §5.1: first-party cookie is the
// primary store (subdomain stitching + server visibility), localStorage the mirror/
// fallback. Both are wrapped behind a tiny Store so tests can inject a memory store.

/** Minimal key/value contract used across the SDK. */
export interface Store {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** In-memory store — used as a last-resort fallback and by unit tests. */
export class MemoryStore implements Store {
  private readonly map = new Map<string, string>();

  get(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  set(key: string, value: string): void {
    this.map.set(key, value);
  }

  remove(key: string): void {
    this.map.delete(key);
  }
}

/** Environment slice the browser store needs. Structural so jsdom satisfies it. */
export interface StorageEnv {
  cookie: { get(): string; set(value: string): void };
  localStorage: Store | null;
}

function readCookie(rawCookie: string, key: string): string | null {
  for (const part of rawCookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === key) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/**
 * Cookie-first store with a localStorage mirror. Writes go to both so a later read
 * still resolves the id if one layer is cleared or blocked (private mode, ITP).
 * Cookie is scoped to the registrable domain when possible for subdomain stitching.
 */
export class BrowserStore implements Store {
  private readonly env: StorageEnv;
  private readonly cookieDomain: string | undefined;
  private readonly maxAgeSeconds: number;

  constructor(env: StorageEnv, options: { cookieDomain?: string; maxAgeSeconds?: number } = {}) {
    this.env = env;
    this.cookieDomain = options.cookieDomain;
    this.maxAgeSeconds = options.maxAgeSeconds ?? 60 * 60 * 24 * 365;
  }

  get(key: string): string | null {
    const fromCookie = readCookie(this.env.cookie.get(), key);
    if (fromCookie !== null) return fromCookie;
    return this.env.localStorage ? this.env.localStorage.get(key) : null;
  }

  set(key: string, value: string): void {
    const domain = this.cookieDomain ? `; Domain=${this.cookieDomain}` : "";
    this.env.cookie.set(`${key}=${encodeURIComponent(value)}; Max-Age=${this.maxAgeSeconds}; Path=/; SameSite=Lax${domain}`);
    // Mirror to localStorage so the id survives cookie clearing / ITP shortening.
    if (this.env.localStorage) this.env.localStorage.set(key, value);
  }

  remove(key: string): void {
    const domain = this.cookieDomain ? `; Domain=${this.cookieDomain}` : "";
    this.env.cookie.set(`${key}=; Max-Age=0; Path=/; SameSite=Lax${domain}`);
    if (this.env.localStorage) this.env.localStorage.remove(key);
  }
}

// Loopback dogfood site provisioning. spec.md (session-replay) §12 step 7: dogfood
// runs before any external site exists, so when Supabase is not configured the replay
// ingest gates (site key hash, Origin allowlist, rate, retention) are backed by ONE
// site provisioned from env. The public write key never persists — only its SHA-256
// is compared, exactly like the real site store.

import { sha256Hex } from "../../ingest/server/hash.ts";
import type { SiteRecord, SiteStore } from "../../ingest/server/site-store.ts";

export const REPLAY_DOGFOOD_SITE_ID = "replay-dogfood";

const DEFAULT_ORIGINS = ["http://127.0.0.1:3000", "http://localhost:3000"];

export type ReplayDogfoodEnv = Readonly<Record<string, string | undefined>>;

export function readReplayDogfoodKey(env: ReplayDogfoodEnv): string | null {
  const key = env.UX_MEASURE_REPLAY_SITE_KEY?.trim();
  return key && key.length >= 16 ? key : null; // refuse trivially guessable keys
}

function loopbackOrigins(env: ReplayDogfoodEnv): string[] {
  const raw = env.UX_MEASURE_REPLAY_ALLOWED_ORIGINS?.trim();
  const origins = raw ? raw.split(",").map((origin) => origin.trim()).filter(Boolean) : DEFAULT_ORIGINS;
  // The dogfood site may only ever be a loopback origin — this store cannot be
  // repurposed to accept a public host by env alone.
  return origins.filter((origin) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin));
}

export class EnvReplaySiteStore implements SiteStore {
  private readonly key: string;
  private readonly origins: string[];
  private keyHash: string | null = null;

  constructor(key: string, origins: string[]) {
    this.key = key;
    this.origins = origins;
  }

  async findByKeyHash(keyHash: string): Promise<SiteRecord | null> {
    this.keyHash = this.keyHash ?? await sha256Hex(this.key);
    if (keyHash !== this.keyHash || this.origins.length === 0) return null;
    return {
      id: REPLAY_DOGFOOD_SITE_ID,
      projectRef: "local-dogfood",
      name: "Replay dogfood (loopback)",
      keyHash: this.keyHash,
      keyPrefix: this.key.slice(0, 4),
      allowedOrigins: this.origins,
      retentionDays: 30,
      isBotDropped: true,
      createdAt: "2026-07-18T00:00:00.000Z",
      disabledAt: null,
    };
  }
}

/** One env-provisioned loopback site, or null when the dogfood key is not set. */
export function createReplayDogfoodSiteStore(env: ReplayDogfoodEnv): SiteStore | null {
  const key = readReplayDogfoodKey(env);
  return key ? new EnvReplaySiteStore(key, loopbackOrigins(env)) : null;
}

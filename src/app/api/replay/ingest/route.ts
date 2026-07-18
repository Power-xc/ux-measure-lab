import { handleOptions } from "../../../../features/ingest/server/cors.ts";
import { InMemoryDurableRateLimiter } from "../../../../features/ingest/server/rate-limit.ts";
import { InMemorySiteStore } from "../../../../features/ingest/server/site-store.ts";
import { SupabaseSiteStore } from "../../../../features/ingest/server/backends/supabase-site-store.ts";
import { UpstashRateLimiter } from "../../../../features/ingest/server/backends/upstash-rate-limiter.ts";
import { defaultReplayStore } from "../../../../features/replay/server/default-store.ts";
import { createReplayDogfoodSiteStore } from "../../../../features/replay/server/env-site-store.ts";
import {
  createReplayIngestPost,
  REPLAY_BODY_LIMITS,
  REPLAY_IP_RATE,
  REPLAY_SITE_RATE,
  type ReplayIngestDeps,
} from "../../../../features/replay/server/ingest-handler.ts";
import { jsonResponse } from "../../../../shared/server/request-guards.ts";
import { readServerEnv, type EnvSource } from "../../../../shared/server/env.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function createDefaultReplayIngestDeps(
  source: EnvSource = process.env,
  fetcher: typeof fetch = fetch,
): ReplayIngestDeps {
  const env = readServerEnv(source);
  // Replay storage is in-memory and single-tenant for now, so a configured dogfood
  // key takes precedence over Supabase for the REPLAY site lookup even when Supabase
  // backs the other features. Supabase's site store only applies once a Supabase
  // replay store exists; without either, every request is 401.
  const dogfoodSiteStore = createReplayDogfoodSiteStore(source);
  return {
    enabled: source.UX_MEASURE_REPLAY_ENABLED === "true",
    siteStore: dogfoodSiteStore
      ?? (env.supabase ? new SupabaseSiteStore(env.supabase, fetcher) : new InMemorySiteStore()),
    store: defaultReplayStore,
    rateLimiter: env.upstash ? new UpstashRateLimiter(env.upstash, fetcher) : new InMemoryDurableRateLimiter(),
    now: () => Date.now(),
    limits: REPLAY_BODY_LIMITS,
    siteRate: REPLAY_SITE_RATE,
    ipRate: REPLAY_IP_RATE,
  };
}

const post = createReplayIngestPost(createDefaultReplayIngestDeps());

export async function POST(request: Request): Promise<Response> {
  try {
    return await post(request);
  } catch {
    return jsonResponse({ error: "unavailable" }, { status: 503 });
  }
}

export async function OPTIONS(request: Request): Promise<Response> {
  return handleOptions(request);
}

import {
  createPostHandler,
  DEFAULT_IP_RATE,
  DEFAULT_LIMITS,
  DEFAULT_SITE_RATE,
  DEFAULT_SKEW,
  type IngestDeps,
} from "../../../features/ingest/server/handler.ts";
import { handleOptions } from "../../../features/ingest/server/cors.ts";
import { InMemoryEventStore } from "../../../features/ingest/server/event-store.ts";
import { InMemoryDurableRateLimiter } from "../../../features/ingest/server/rate-limit.ts";
import { InMemorySiteStore } from "../../../features/ingest/server/site-store.ts";
import { SupabaseEventStore } from "../../../features/ingest/server/backends/supabase-event-store.ts";
import { SupabaseSiteStore } from "../../../features/ingest/server/backends/supabase-site-store.ts";
import { UpstashRateLimiter } from "../../../features/ingest/server/backends/upstash-rate-limiter.ts";
import { jsonResponse } from "../../../shared/server/request-guards.ts";
import { readServerEnv, type EnvSource } from "../../../shared/server/env.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function createDefaultIngestDeps(
  source: EnvSource = process.env,
  fetcher: typeof fetch = fetch,
): IngestDeps {
  const env = readServerEnv(source);
  const siteStore = env.supabase
    ? new SupabaseSiteStore(env.supabase, fetcher)
    : new InMemorySiteStore();
  const eventStore = env.supabase
    ? new SupabaseEventStore(env.supabase, fetcher)
    : new InMemoryEventStore();
  const rateLimiter = env.upstash
    ? new UpstashRateLimiter(env.upstash, fetcher)
    : new InMemoryDurableRateLimiter();
  return {
    siteStore,
    eventStore,
    rateLimiter,
    now: () => Date.now(),
    limits: DEFAULT_LIMITS,
    skew: DEFAULT_SKEW,
    siteRate: DEFAULT_SITE_RATE,
    ipRate: DEFAULT_IP_RATE,
  };
}

export function createIngestPost(deps: IngestDeps): (request: Request) => Promise<Response> {
  const handler = createPostHandler(deps);
  return async (request: Request): Promise<Response> => {
    try {
      return await handler(request);
    } catch {
      return jsonResponse({ error: "unavailable" }, { status: 503 });
    }
  };
}

const post = createIngestPost(createDefaultIngestDeps());

export async function POST(request: Request): Promise<Response> {
  return post(request);
}

export async function OPTIONS(request: Request): Promise<Response> {
  return handleOptions(request);
}

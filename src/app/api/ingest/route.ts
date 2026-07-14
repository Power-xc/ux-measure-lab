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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Integration swap points (Wave 2 wiring, after D-101·D-102·D-104 approval):
//   siteStore    → Supabase `sites` query (SiteStore)
//   eventStore   → batched Supabase insert into `events` (EventStore)
//   rateLimiter  → Upstash Redis limiter (DurableRateLimiter)
// Until then the endpoint is wired with in-memory placeholders. The site store
// is empty, so every request fails site-key validation (401) — a safe default:
// nothing is collected or stored before real provisioning. Secrets are read only
// from server env at wiring time; none are hardcoded here.
function defaultIngestDeps(): IngestDeps {
  return {
    siteStore: new InMemorySiteStore(),
    eventStore: new InMemoryEventStore(),
    rateLimiter: new InMemoryDurableRateLimiter(),
    now: () => Date.now(),
    limits: DEFAULT_LIMITS,
    skew: DEFAULT_SKEW,
    siteRate: DEFAULT_SITE_RATE,
    ipRate: DEFAULT_IP_RATE,
  };
}

const post = createPostHandler(defaultIngestDeps());

export async function POST(request: Request): Promise<Response> {
  return post(request);
}

export async function OPTIONS(request: Request): Promise<Response> {
  return handleOptions(request);
}

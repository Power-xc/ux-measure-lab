// POST /api/ingest orchestration. Implements the validation order in
// research-ingest.md §4.6 exactly. The route stays thin; all logic lives here.
// same-origin guards are intentionally NOT used (§4.4).

import { jsonResponse } from "../../../shared/server/request-guards.ts";
import { classifyBot, uaFamily } from "./bot-filter.ts";
import { correctTimestamp, type SkewLimits } from "./clock-skew.ts";
import { corsHeaders } from "./cors.ts";
import type { EventStore, StoredEvent } from "./event-store.ts";
import { sha256Hex } from "./hash.ts";
import { type BodyLimits, readIngestBody } from "./read-body.ts";
import { type DurableRateLimiter, type RateLimitConfig } from "./rate-limit.ts";
import { parseEnvelope, validateEvent } from "./schema.ts";
import type { SiteStore } from "./site-store.ts";

export const DEFAULT_LIMITS: BodyLimits = { compressedMax: 64 * 1_024, decompressedMax: 256 * 1_024 };
export const DEFAULT_SKEW: SkewLimits = { maxFutureMs: 5 * 60_000, maxPastMs: 90 * 24 * 60 * 60_000 };
export const DEFAULT_SITE_RATE: RateLimitConfig = { limit: 600, windowMs: 60_000 }; // per site / minute (draft)
export const DEFAULT_IP_RATE: RateLimitConfig = { limit: 120, windowMs: 60_000 }; // per IP / minute (draft)

export type IngestDeps = {
  siteStore: SiteStore;
  eventStore: EventStore;
  rateLimiter: DurableRateLimiter;
  now: () => number; // injected clock (ms) for deterministic tests
  limits: BodyLimits;
  skew: SkewLimits;
  siteRate: RateLimitConfig;
  ipRate: RateLimitConfig;
};

function clientIp(request: Request): string {
  const direct = request.headers.get("x-real-ip")?.trim();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (direct || forwarded || "local").slice(0, 128);
}

function fail(status: number, error: string, headers?: Record<string, string>): Response {
  return jsonResponse({ error }, { status, headers });
}

export function createPostHandler(deps: IngestDeps) {
  return async function handleIngest(request: Request): Promise<Response> {
    const nowMs = deps.now();
    const receivedAt = new Date(nowMs).toISOString();

    // 1. content-type: application/json or text/plain (§4.4 preflight avoidance).
    const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (contentType !== "application/json" && contentType !== "text/plain") {
      return fail(415, "unsupported_media_type");
    }

    // 2. content-length pre-check (compressed cap).
    const declaredLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
    if (declaredLength > deps.limits.compressedMax) return fail(413, "request_too_large");

    // 3. bounded body (gzip → inflate → re-bound).
    const body = await readIngestBody(request, deps.limits);
    if (!body.ok) {
      return body.code === "request_too_large" ? fail(413, "request_too_large") : fail(400, "invalid_request");
    }

    // 4. JSON.parse + envelope shape (incl. ≤ 50 events).
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.text);
    } catch {
      return fail(400, "invalid_request");
    }
    const envelopeResult = parseEnvelope(parsed);
    if (!envelopeResult.ok) return fail(400, "invalid_request");
    const envelope = envelopeResult.envelope;

    // 5. site key hash match + disabled check.
    const site = await deps.siteStore.findByKeyHash(await sha256Hex(envelope.k));
    if (!site) return fail(401, "invalid_site_key");
    if (site.disabledAt) return fail(403, "invalid_site_key");

    // 6. Origin ∈ allowed_origins. Only past this point do we reflect CORS.
    const origin = request.headers.get("origin");
    if (!origin || !site.allowedOrigins.includes(origin)) return fail(403, "origin_not_allowed");
    const cors = corsHeaders(origin);

    // 7. durable rate limit — site + IP (dual).
    const ip = clientIp(request);
    const [siteLimit, ipLimit] = await Promise.all([
      deps.rateLimiter.check(`site:${site.id}`, deps.siteRate, nowMs),
      deps.rateLimiter.check(`ip:${site.id}:${ip}`, deps.ipRate, nowMs),
    ]);
    if (siteLimit.limited || ipLimit.limited) {
      const retryAfter = Math.max(siteLimit.retryAfter, ipLimit.retryAfter);
      return fail(429, "rate_limited", { ...cors, "Retry-After": String(retryAfter) });
    }

    // 8. bot filter — drop the whole batch or flag events.
    const userAgent = request.headers.get("user-agent");
    const verdict = classifyBot({ userAgent, acceptLanguage: request.headers.get("accept-language") });
    if (verdict === "bot" && site.isBotDropped) {
      return jsonResponse({ accepted: 0, dropped: envelope.events.length }, { status: 202, headers: cors });
    }
    const isBot = verdict !== "clean";
    const family = uaFamily(userAgent);

    // 9–10. per-event validation (drop invalid, keep batch) + session/skew correction.
    const anonId = await sha256Hex(envelope.aid); // stored hashed (§3.2)
    const sentAtMs = Date.parse(envelope.sent_at);
    const stored: StoredEvent[] = [];
    let dropped = 0;
    for (const rawEvent of envelope.events) {
      const validation = validateEvent(rawEvent);
      if (!validation.ok) {
        dropped += 1;
        continue;
      }
      const event = validation.event;
      const clientTsMs = event.ts;
      const ts = correctTimestamp({ clientTsMs, sentAtMs, receivedAtMs: nowMs }, deps.skew);
      stored.push({
        siteId: site.id,
        eventId: event.eid,
        sessionId: envelope.sid, // client hint; server_session_id derived in the rollup (§5.1)
        anonId,
        type: event.t,
        path: event.p === "" ? null : event.p,
        referrerHost: event.ref ?? null,
        props: event.props,
        uaFamily: family,
        isBot,
        ts: new Date(ts).toISOString(),
        clientTs: new Date(clientTsMs).toISOString(),
        receivedAt,
      });
    }

    if (stored.length > 0) {
      try {
        await deps.eventStore.insertBatch(stored);
      } catch {
        return fail(503, "unavailable", cors); // shed load, do not block the DB (§7.1)
      }
    }

    // 11. 202 Accepted with per-batch outcome.
    return jsonResponse({ accepted: stored.length, dropped }, { status: 202, headers: cors });
  };
}

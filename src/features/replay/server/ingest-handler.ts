// POST /api/replay/ingest orchestration. Reuses the collector-ingest guards
// (site key hash, Origin allowlist, durable rate limits, bounded body) and adds
// the replay-only gates: feature flag, purpose version, privacy backstop, quotas
// and site-capped retention. spec.md (session-replay) §8.

import { jsonResponse } from "../../../shared/server/request-guards.ts";
import { corsHeaders } from "../../ingest/server/cors.ts";
import { sha256Hex } from "../../ingest/server/hash.ts";
import { readIngestBody, type BodyLimits } from "../../ingest/server/read-body.ts";
import type { DurableRateLimiter, RateLimitConfig } from "../../ingest/server/rate-limit.ts";
import type { SiteStore } from "../../ingest/server/site-store.ts";
import { parseReplayEnvelope } from "./schema.ts";
import { REPLAY_RETENTION_MAX_DAYS, type ReplayStore } from "./store.ts";

export const REPLAY_BODY_LIMITS: BodyLimits = { compressedMax: 256 * 1_024, decompressedMax: 1_024 * 1_024 };
export const REPLAY_SITE_RATE: RateLimitConfig = { limit: 120, windowMs: 60_000 };
export const REPLAY_IP_RATE: RateLimitConfig = { limit: 30, windowMs: 60_000 };

export type ReplayIngestDeps = {
  enabled: boolean;
  siteStore: SiteStore;
  store: ReplayStore;
  rateLimiter: DurableRateLimiter;
  now: () => number;
  limits: BodyLimits;
  siteRate: RateLimitConfig;
  ipRate: RateLimitConfig;
};

function fail(status: number, error: string, headers?: Record<string, string>): Response {
  return jsonResponse({ error }, { status, headers });
}

function clientIp(request: Request): string {
  const direct = request.headers.get("x-real-ip")?.trim();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (direct || forwarded || "local").slice(0, 128);
}

function expiryFor(nowMs: number, siteRetentionDays: number): string {
  // Sites may only shorten retention below the 30-day hard maximum.
  const days = Math.min(Math.max(siteRetentionDays, 1), REPLAY_RETENTION_MAX_DAYS);
  return new Date(nowMs + days * 24 * 60 * 60_000).toISOString();
}

export function createReplayIngestPost(deps: ReplayIngestDeps) {
  return async function handleReplayIngest(request: Request): Promise<Response> {
    if (!deps.enabled) return fail(404, "replay_disabled");
    const nowMs = deps.now();

    const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (contentType !== "application/json" && contentType !== "text/plain") return fail(415, "unsupported_media_type");
    const declaredLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
    if (declaredLength > deps.limits.compressedMax) return fail(413, "request_too_large");

    const body = await readIngestBody(request, deps.limits);
    if (!body.ok) {
      return body.code === "request_too_large" ? fail(413, "request_too_large") : fail(400, "invalid_request");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.text);
    } catch {
      return fail(400, "invalid_request");
    }
    const envelope = parseReplayEnvelope(parsed);
    if (!envelope.ok) {
      return envelope.error === "invalid_envelope" ? fail(400, "invalid_request") : fail(422, envelope.error);
    }
    const chunk = envelope.chunk;

    const site = await deps.siteStore.findByKeyHash(await sha256Hex(chunk.k));
    if (!site) return fail(401, "invalid_site_key");
    if (site.disabledAt) return fail(403, "invalid_site_key");

    const origin = request.headers.get("origin");
    if (!origin || !site.allowedOrigins.includes(origin)) return fail(403, "origin_not_allowed");
    const cors = corsHeaders(origin);

    const ip = clientIp(request);
    const [siteLimit, ipLimit] = await Promise.all([
      deps.rateLimiter.check(`replay:site:${site.id}`, deps.siteRate, nowMs),
      deps.rateLimiter.check(`replay:ip:${site.id}:${ip}`, deps.ipRate, nowMs),
    ]);
    if (siteLimit.limited || ipLimit.limited) {
      const retryAfter = Math.max(siteLimit.retryAfter, ipLimit.retryAfter);
      return fail(429, "rate_limited", { ...cors, "Retry-After": String(retryAfter) });
    }

    let outcome;
    try {
      outcome = await deps.store.appendChunk({
        siteId: site.id,
        recordingId: chunk.recordingId,
        sessionId: chunk.sessionId,
        anonymousIdHash: await sha256Hex(chunk.anonymousId),
        sequence: chunk.sequence,
        startedAt: chunk.startedAt,
        endedAt: chunk.endedAt,
        byteSize: new TextEncoder().encode(JSON.stringify(chunk.events)).length,
        payload: JSON.stringify(chunk.events),
        purposeVersion: chunk.purposeVersion,
        expiresAt: expiryFor(nowMs, site.retentionDays),
      });
    } catch {
      return fail(503, "unavailable", cors);
    }
    if (outcome === "chunk_quota" || outcome === "byte_quota") return fail(429, "quota_exceeded", cors);
    return jsonResponse({ stored: outcome === "stored" ? 1 : 0, duplicate: outcome === "duplicate" }, { status: 202, headers: cors });
  };
}

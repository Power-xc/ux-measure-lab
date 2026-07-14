import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultIngestDeps, createIngestPost } from "../../../../app/api/ingest/route.ts";
import { readServerEnv } from "../../../../shared/server/env.ts";
import type { StoredEvent } from "../event-store.ts";
import { SupabaseEventStore } from "./supabase-event-store.ts";
import { SupabaseSiteStore, type SupabaseRestConfig } from "./supabase-site-store.ts";
import { UpstashRateLimiter } from "./upstash-rate-limiter.ts";

type FetchCall = { url: string; init?: RequestInit };

function fakeFetch(responses: readonly (Response | Error)[]): { fetcher: typeof fetch; calls: FetchCall[] } {
  const queue = [...responses];
  const calls: FetchCall[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: input instanceof Request ? input.url : String(input), init });
    const next = queue.shift();
    if (!next) throw new Error("missing_fake_response");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetcher, calls };
}

const SUPABASE: SupabaseRestConfig = {
  url: "https://project.supabase.co",
  serviceRoleKey: "service-key",
};

const EVENT: StoredEvent = {
  siteId: "11111111-1111-1111-1111-111111111111",
  eventId: "e_1",
  sessionId: "s_1",
  anonId: "anon-hash",
  type: "pv",
  path: "/pricing",
  referrerHost: "example.com",
  props: { viewport: "desktop" },
  uaFamily: "Chrome",
  isBot: false,
  ts: "2026-07-15T00:00:00.000Z",
  clientTs: "2026-07-15T00:00:00.000Z",
  receivedAt: "2026-07-15T00:00:01.000Z",
};

test("SupabaseSiteStore sends an authenticated filtered PostgREST query", async () => {
  const row = {
    id: EVENT.siteId,
    project_ref: "local-project",
    name: "Dogfood",
    key_hash: "hash-value",
    key_prefix: "umlk_test",
    allowed_origins: ["https://app.example"],
    retention_days: 90,
    is_bot_dropped: true,
    created_at: "2026-07-15T00:00:00.000Z",
    disabled_at: null,
  };
  const fake = fakeFetch([Response.json([row])]);
  const site = await new SupabaseSiteStore(SUPABASE, fake.fetcher).findByKeyHash("hash-value");

  assert.equal(site?.projectRef, "local-project");
  assert.deepEqual(site?.allowedOrigins, ["https://app.example"]);
  const requestUrl = new URL(fake.calls[0].url);
  assert.equal(requestUrl.pathname, "/rest/v1/sites");
  assert.equal(requestUrl.searchParams.get("key_hash"), "eq.hash-value");
  assert.match(requestUrl.searchParams.get("select") ?? "", /allowed_origins/);
  const headers = new Headers(fake.calls[0].init?.headers);
  assert.equal(headers.get("apikey"), "service-key");
  assert.equal(headers.get("authorization"), "Bearer service-key");
});

test("SupabaseSiteStore returns null for no match and rejects upstream failures", async () => {
  const empty = fakeFetch([Response.json([])]);
  assert.equal(await new SupabaseSiteStore(SUPABASE, empty.fetcher).findByKeyHash("missing"), null);

  const failed = fakeFetch([new Response(null, { status: 503 })]);
  await assert.rejects(
    new SupabaseSiteStore(SUPABASE, failed.fetcher).findByKeyHash("hash"),
    /supabase_site_lookup_failed/,
  );
});

test("SupabaseEventStore maps a batch to PostgREST rows and throws on failure", async () => {
  const fake = fakeFetch([new Response(null, { status: 201 })]);
  await new SupabaseEventStore(SUPABASE, fake.fetcher).insertBatch([EVENT]);

  assert.equal(fake.calls[0].url, "https://project.supabase.co/rest/v1/events");
  assert.equal(fake.calls[0].init?.method, "POST");
  const headers = new Headers(fake.calls[0].init?.headers);
  assert.equal(headers.get("authorization"), "Bearer service-key");
  const body: unknown = JSON.parse(String(fake.calls[0].init?.body));
  assert.deepEqual(body, [{
    site_id: EVENT.siteId,
    event_id: "e_1",
    session_id: "s_1",
    anon_id: "anon-hash",
    type: "pv",
    path: "/pricing",
    referrer_host: "example.com",
    props: { viewport: "desktop" },
    ua_family: "Chrome",
    is_bot: false,
    ts: EVENT.ts,
    client_ts: EVENT.clientTs,
    received_at: EVENT.receivedAt,
  }]);

  const failed = fakeFetch([new Response(null, { status: 500 })]);
  await assert.rejects(new SupabaseEventStore(SUPABASE, failed.fetcher).insertBatch([EVENT]), /insert_failed/);
});

test("UpstashRateLimiter uses INCR, fixed expiry, and PTTL window arithmetic", async () => {
  const fake = fakeFetch([Response.json([{ result: 3 }, { result: 0 }, { result: 59_001 }])]);
  const limiter = new UpstashRateLimiter(
    { url: "https://redis.upstash.io", token: "redis-token" }, // secret-scan-allow: 테스트 픽스처
    fake.fetcher,
  );
  const result = await limiter.check("site:one", { limit: 2, windowMs: 60_000 }, 1_000);

  assert.deepEqual(result, { limited: true, retryAfter: 60 });
  assert.equal(fake.calls[0].url, "https://redis.upstash.io/pipeline");
  const headers = new Headers(fake.calls[0].init?.headers);
  assert.equal(headers.get("authorization"), "Bearer redis-token");
  const body: unknown = JSON.parse(String(fake.calls[0].init?.body));
  assert.deepEqual(body, [
    ["INCR", "ux-measure:rate:site:one"],
    ["PEXPIRE", "ux-measure:rate:site:one", 60_000, "NX"],
    ["PTTL", "ux-measure:rate:site:one"],
  ]);
});

test("Upstash failure degrades to a bounded in-memory limiter", async () => {
  const fake = fakeFetch([new Error("offline"), new Error("offline")]);
  const limiter = new UpstashRateLimiter(
    { url: "https://redis.upstash.io", token: "redis-token" }, // secret-scan-allow: 테스트 픽스처
    fake.fetcher,
  );
  const config = { limit: 1, windowMs: 60_000 };

  assert.deepEqual(await limiter.check("site:one", config, 1_000), { limited: false, retryAfter: 0 });
  assert.deepEqual(await limiter.check("site:one", config, 2_000), { limited: true, retryAfter: 59 });
});

test("server env enables complete backends and leaves partial settings unconfigured", () => {
  const configured = readServerEnv({
    SUPABASE_URL: "https://project.supabase.co/",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    SUPABASE_SITE_ID: EVENT.siteId,
    UPSTASH_REDIS_REST_URL: "https://redis.upstash.io/",
    UPSTASH_REDIS_REST_TOKEN: "redis-token", // secret-scan-allow: 테스트 픽스처
    POSTHOG_HOST: "https://eu.posthog.com/",
    POSTHOG_PROJECT_ID: "42",
    POSTHOG_API_KEY: "phx_key",
  });
  assert.deepEqual(configured.supabase, {
    url: "https://project.supabase.co",
    serviceRoleKey: "service-key",
    siteId: EVENT.siteId,
  });
  assert.equal(configured.upstash?.url, "https://redis.upstash.io");
  assert.equal(configured.posthog?.host, "https://eu.posthog.com");

  const partial = readServerEnv({ SUPABASE_URL: "invalid", POSTHOG_HOST: "https://us.posthog.com" });
  assert.equal(partial.supabase, undefined);
  assert.equal(partial.upstash, undefined);
  assert.equal(partial.posthog, undefined);

  const insecure = readServerEnv({
    SUPABASE_URL: "http://database.example.com",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    UPSTASH_REDIS_REST_URL: "http://redis.example.com",
    UPSTASH_REDIS_REST_TOKEN: "redis-token", // secret-scan-allow: 테스트 픽스처
  });
  assert.equal(insecure.supabase, undefined);
  assert.equal(insecure.upstash, undefined);
  assert.equal(readServerEnv({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "local-key" }).supabase?.url, "http://127.0.0.1:54321");
});

function ingestRequest(): Request {
  return new Request("http://localhost/api/ingest", {
    method: "POST",
    headers: {
      "content-type": "text/plain",
      origin: "https://app.example",
      "user-agent": "Mozilla/5.0 Chrome/140.0 Safari/537.36",
      "accept-language": "ko-KR",
    },
    body: JSON.stringify({
      k: "umlk_test",
      sent_at: EVENT.receivedAt,
      sid: "s_1",
      aid: "a_1",
      events: [{ eid: "e_1", t: "pv", ts: Date.parse(EVENT.ts), p: "/", props: {} }],
    }),
  });
}

test("ingest env wiring keeps an empty in-memory store when configuration is absent", async () => {
  const response = await createIngestPost(createDefaultIngestDeps({}))(ingestRequest());
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "invalid_site_key" });
});

test("ingest route maps backend failures to the 503 contract", async () => {
  const fake = fakeFetch([new Response(null, { status: 503 })]);
  const deps = createDefaultIngestDeps({
    SUPABASE_URL: SUPABASE.url,
    SUPABASE_SERVICE_ROLE_KEY: SUPABASE.serviceRoleKey,
  }, fake.fetcher);
  const response = await createIngestPost(deps)(ingestRequest());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "unavailable" });
});

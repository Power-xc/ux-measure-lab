import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { POST } from "../../../app/api/ingest/route.ts";
import { handleOptions } from "./cors.ts";
import { InMemoryEventStore } from "./event-store.ts";
import { createPostHandler, DEFAULT_LIMITS, DEFAULT_SKEW, type IngestDeps } from "./handler.ts";
import { sha256Hex } from "./hash.ts";
import { InMemoryDurableRateLimiter, type RateLimitConfig } from "./rate-limit.ts";
import { InMemorySiteStore, type SiteRecord } from "./site-store.ts";

const NOW_MS = Date.parse("2026-07-15T00:00:00.000Z");
const NOW_ISO = new Date(NOW_MS).toISOString();
const KEY = "umlk_test_0123456789";
const ORIGIN = "https://app.example";

type CtxOptions = { site?: Partial<SiteRecord>; siteRate?: RateLimitConfig; ipRate?: RateLimitConfig };

async function makeCtx(opts: CtxOptions = {}) {
  const keyHash = await sha256Hex(KEY);
  const site: SiteRecord = {
    id: "site-1", projectRef: "local-1", name: "Dogfood", keyHash, keyPrefix: "umlk_test",
    allowedOrigins: [ORIGIN], retentionDays: 90, isBotDropped: true, createdAt: NOW_ISO, disabledAt: null,
    ...opts.site,
  };
  const eventStore = new InMemoryEventStore();
  const deps: IngestDeps = {
    siteStore: new InMemorySiteStore([site]),
    eventStore,
    rateLimiter: new InMemoryDurableRateLimiter(),
    now: () => NOW_MS,
    limits: DEFAULT_LIMITS,
    skew: DEFAULT_SKEW,
    siteRate: opts.siteRate ?? { limit: 600, windowMs: 60_000 },
    ipRate: opts.ipRate ?? { limit: 120, windowMs: 60_000 },
  };
  return { deps, eventStore, handler: createPostHandler(deps) };
}

function batch(events: unknown[], over: Record<string, unknown> = {}) {
  return { k: KEY, sent_at: NOW_ISO, sid: "s_1", aid: "a_1", events, ...over };
}

function ev(over: Record<string, unknown> = {}) {
  return { eid: "e_1", t: "pv", ts: NOW_ISO, p: "/pricing", ref: "google.com", props: {}, ...over };
}

// A realistic browser sends a UA + locale, so classifyBot returns "clean".
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const BROWSER_HEADERS = { "user-agent": BROWSER, "accept-language": "ko-KR,ko;q=0.9" };

function req(body: string | object, headers: Record<string, string> = {}): Request {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("http://localhost/api/ingest", {
    method: "POST",
    body: text,
    headers: { "content-type": "text/plain", origin: ORIGIN, ...BROWSER_HEADERS, ...headers },
  });
}

function gzReq(bytes: Uint8Array, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/ingest", {
    method: "POST",
    body: Uint8Array.from(bytes),
    headers: { "content-type": "text/plain", "content-encoding": "gzip", origin: ORIGIN, ...BROWSER_HEADERS, ...headers },
  });
}

test("HAC-05 rejects unregistered key, disabled site, disallowed origin, and rate excess", async () => {
  const { handler } = await makeCtx();

  const badKey = await handler(req(batch([ev()], { k: "umlk_wrong_key" })));
  assert.equal(badKey.status, 401);
  assert.deepEqual(await badKey.json(), { error: "invalid_site_key" });

  const disabled = await makeCtx({ site: { disabledAt: NOW_ISO } });
  const off = await disabled.handler(req(batch([ev()])));
  assert.equal(off.status, 403);
  assert.deepEqual(await off.json(), { error: "invalid_site_key" });

  const badOrigin = await handler(req(batch([ev()]), { origin: "https://evil.example" }));
  assert.equal(badOrigin.status, 403);
  assert.deepEqual(await badOrigin.json(), { error: "origin_not_allowed" });
  assert.equal(badOrigin.headers.get("access-control-allow-origin"), null);

  const limited = await makeCtx({ siteRate: { limit: 1, windowMs: 60_000 } });
  assert.equal((await limited.handler(req(batch([ev()])))).status, 202);
  const capped = await limited.handler(req(batch([ev()])));
  assert.equal(capped.status, 429);
  assert.deepEqual(await capped.json(), { error: "rate_limited" });
  assert.equal(capped.headers.get("access-control-allow-origin"), ORIGIN);
  assert.ok(Number(capped.headers.get("retry-after")) >= 1);
});

test("HAC-06 drops invalid events but keeps the rest with 202 accepted/dropped", async () => {
  const { handler, eventStore } = await makeCtx();
  const res = await handler(req(batch([ev(), ev({ eid: "e_2", t: "bogus" }), ev({ eid: "e_3", t: "click" })])));
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { accepted: 2, dropped: 1 });
  assert.deepEqual(eventStore.inserted.map((e) => e.eventId), ["e_1", "e_3"]);
  assert.equal(eventStore.inserted[0].type, "pv");
});

test("error contract covers 413/415/400 and the batch cap", async () => {
  const { handler } = await makeCtx();

  const tooLarge = await handler(req("x".repeat(70_000)));
  assert.equal(tooLarge.status, 413);
  assert.deepEqual(await tooLarge.json(), { error: "request_too_large" });

  const wrongType = await handler(req(batch([ev()]), { "content-type": "application/xml" }));
  assert.equal(wrongType.status, 415);

  const badJson = await handler(req("{"));
  assert.equal(badJson.status, 400);
  assert.deepEqual(await badJson.json(), { error: "invalid_request" });

  const oversize = Array.from({ length: 51 }, (_, i) => ev({ eid: `e_${i}` }));
  assert.equal((await handler(req(batch(oversize)))).status, 400);
});

test("gzip inflates within bounds and rejects a decompression bomb after re-bounding", async () => {
  const { handler, eventStore } = await makeCtx();

  const ok = await handler(gzReq(gzipSync(Buffer.from(JSON.stringify(batch([ev()]))))));
  assert.equal(ok.status, 202);
  assert.equal(eventStore.inserted.length, 1);

  const bombBody = JSON.stringify(batch([ev({ p: `/${"x".repeat(300_000)}` })]));
  const bomb = await handler(gzReq(gzipSync(Buffer.from(bombBody))));
  assert.equal(bomb.status, 413);
});

test("skew correction clamps a future client timestamp to the server window", async () => {
  const { handler, eventStore } = await makeCtx();
  const future = new Date(NOW_MS + 10 * 24 * 60 * 60_000).toISOString();
  const res = await handler(req(batch([ev({ ts: future })])));
  assert.equal(res.status, 202);
  assert.equal(eventStore.inserted[0].ts, new Date(NOW_MS + DEFAULT_SKEW.maxFutureMs).toISOString());
  assert.equal(eventStore.inserted[0].clientTs, future);
});

test("bot traffic is dropped when the site opts in and flagged otherwise", async () => {
  const dropped = await makeCtx();
  const dropRes = await dropped.handler(req(batch([ev()]), { "user-agent": "Googlebot/2.1" }));
  assert.equal(dropRes.status, 202);
  assert.deepEqual(await dropRes.json(), { accepted: 0, dropped: 1 });
  assert.equal(dropped.eventStore.inserted.length, 0);

  const flagged = await makeCtx({ site: { isBotDropped: false } });
  const flagRes = await flagged.handler(req(batch([ev()]), { "user-agent": "Googlebot/2.1" }));
  assert.equal(flagRes.status, 202);
  assert.deepEqual(await flagRes.json(), { accepted: 1, dropped: 0 });
  assert.equal(flagged.eventStore.inserted[0].isBot, true);
});

test("CORS reflects only the allowlisted origin and accepts simple + preflight requests", async () => {
  const { handler, eventStore } = await makeCtx();

  const plain = await handler(req(batch([ev()])));
  assert.equal(plain.status, 202);
  assert.equal(plain.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(plain.headers.get("vary"), "Origin");

  const json = await handler(req(batch([ev({ eid: "e_j" })]), { "content-type": "application/json" }));
  assert.equal(json.status, 202);
  assert.equal(eventStore.inserted.length, 2);

  const preflight = handleOptions(new Request("http://localhost/api/ingest", {
    method: "OPTIONS",
    headers: { origin: ORIGIN, "access-control-request-method": "POST" },
  }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(preflight.headers.get("access-control-max-age"), "600");
  assert.equal(preflight.headers.get("access-control-allow-methods"), "POST, OPTIONS");
});

test("route wiring falls back to a safe empty default store (401)", async () => {
  const res = await POST(req(batch([ev()])));
  assert.equal(res.status, 401);
});

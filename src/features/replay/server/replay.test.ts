import assert from "node:assert/strict";
import test from "node:test";
import { sha256Hex } from "../../ingest/server/hash.ts";
import { InMemoryDurableRateLimiter } from "../../ingest/server/rate-limit.ts";
import { InMemorySiteStore, type SiteRecord } from "../../ingest/server/site-store.ts";
import { createReplayIngestPost, REPLAY_BODY_LIMITS, REPLAY_IP_RATE, REPLAY_SITE_RATE, type ReplayIngestDeps } from "./ingest-handler.ts";
import { createReplayReadDelete, createReplayReadGet, isReplayRuntimeEnabled, type ReplayReadDeps } from "./read-handler.ts";
import { parseReplayEnvelope } from "./schema.ts";
import { InMemoryReplayStore } from "./store.ts";

const NOW = Date.parse("2026-07-18T00:00:00.000Z");
const ORIGIN = "https://app.example";

async function makeSite(overrides: Partial<SiteRecord> = {}): Promise<SiteRecord> {
  return {
    id: "site-1",
    projectRef: "p1",
    name: "Example",
    keyHash: await sha256Hex("public-key"),
    keyPrefix: "pub",
    allowedOrigins: [ORIGIN],
    retentionDays: 90,
    isBotDropped: true,
    createdAt: "2026-07-01T00:00:00.000Z",
    disabledAt: null,
    ...overrides,
  };
}

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    k: "public-key",
    recording_id: "rec-1",
    session_id: "sess-1",
    anonymous_id: "anon-1",
    sequence: 0,
    started_at: "2026-07-18T00:00:00.000Z",
    ended_at: "2026-07-18T00:00:05.000Z",
    purpose_version: "replay-v1",
    encoding: "json",
    events: [{ type: 2, timestamp: 1, data: { node: { tagName: "div", attributes: {}, childNodes: [] } } }],
    ...overrides,
  };
}

async function makeDeps(overrides: Partial<ReplayIngestDeps> = {}): Promise<ReplayIngestDeps> {
  return {
    enabled: true,
    siteStore: new InMemorySiteStore([await makeSite()]),
    store: new InMemoryReplayStore(),
    rateLimiter: new InMemoryDurableRateLimiter(),
    now: () => NOW,
    limits: REPLAY_BODY_LIMITS,
    siteRate: REPLAY_SITE_RATE,
    ipRate: REPLAY_IP_RATE,
    ...overrides,
  };
}

function ingestRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://collect.example/api/replay/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

test("SR-05a envelope validation rejects shape, purpose and privacy violations separately", () => {
  assert.equal(parseReplayEnvelope(envelope()).ok, true);
  assert.deepEqual(parseReplayEnvelope(envelope({ sequence: -1 })), { ok: false, error: "invalid_envelope" });
  assert.deepEqual(parseReplayEnvelope(envelope({ events: [] })), { ok: false, error: "invalid_envelope" });
  assert.deepEqual(parseReplayEnvelope(envelope({ extra: true })), { ok: false, error: "invalid_envelope" });
  assert.deepEqual(parseReplayEnvelope(envelope({ purpose_version: "replay-v0" })), { ok: false, error: "unsupported_purpose" });
  const withValue = envelope({ events: [{ type: 2, timestamp: 1, data: { node: { tagName: "input", attributes: { value: "secret" }, childNodes: [] } } }] });
  assert.deepEqual(parseReplayEnvelope(withValue), { ok: false, error: "privacy_violation" });
  const withScript = envelope({ events: [{ type: 2, timestamp: 1, data: { href: "javascript:alert(1)" } }] });
  assert.deepEqual(parseReplayEnvelope(withScript), { ok: false, error: "privacy_violation" });
});

test("SR-05b ingest rejects key, origin and rate violations with the collector-ingest statuses", async () => {
  const deps = await makeDeps({ siteRate: { limit: 1, windowMs: 60_000 } });
  const post = createReplayIngestPost(deps);

  assert.equal((await post(ingestRequest(envelope({ k: "wrong-key" })))).status, 401);
  assert.equal((await post(ingestRequest(envelope(), { origin: "https://evil.example" }))).status, 403);

  const first = await post(ingestRequest(envelope()));
  assert.equal(first.status, 202);
  assert.equal(first.headers.get("access-control-allow-origin"), ORIGIN);
  const limited = await post(ingestRequest(envelope({ sequence: 1 })));
  assert.equal(limited.status, 429);

  const disabledDeps = await makeDeps({ enabled: false });
  assert.equal((await createReplayIngestPost(disabledDeps)(ingestRequest(envelope()))).status, 404);
});

test("SR-05c duplicate sequences are idempotent and site retention is capped at 30 days", async () => {
  const store = new InMemoryReplayStore();
  const deps = await makeDeps({ store });
  const post = createReplayIngestPost(deps);

  assert.equal((await post(ingestRequest(envelope()))).status, 202);
  const duplicate = await post(ingestRequest(envelope()));
  assert.equal(duplicate.status, 202);
  assert.deepEqual(await duplicate.json(), { stored: 0, duplicate: true });

  const recordings = await store.listRecordings("site-1");
  assert.equal(recordings.length, 1);
  assert.equal(recordings[0].chunkCount, 1);
  // 사이트 보존 90일 요청은 하드 최대 30일로 잘린다.
  assert.equal(recordings[0].expiresAt, new Date(NOW + 30 * 24 * 60 * 60_000).toISOString());
  assert.equal(recordings[0].anonymousIdHash, await sha256Hex("anon-1"));
});

test("SR-06/07 store purges expired recordings and deletes a visitor everywhere", async () => {
  const store = new InMemoryReplayStore();
  const base = {
    siteId: "site-1",
    sessionId: "sess-1",
    startedAt: "2026-07-01T00:00:00.000Z",
    endedAt: "2026-07-01T00:01:00.000Z",
    byteSize: 10,
    payload: "[]",
    purposeVersion: "replay-v1",
  };
  await store.appendChunk({ ...base, recordingId: "rec-old", anonymousIdHash: "hash-a", sequence: 0, expiresAt: "2026-07-10T00:00:00.000Z" });
  await store.appendChunk({ ...base, recordingId: "rec-live", anonymousIdHash: "hash-a", sequence: 0, expiresAt: "2026-08-01T00:00:00.000Z" });
  await store.appendChunk({ ...base, recordingId: "rec-other", anonymousIdHash: "hash-b", sequence: 0, expiresAt: "2026-08-01T00:00:00.000Z" });

  assert.equal(await store.purgeExpired("2026-07-18T00:00:00.000Z"), 1);
  assert.deepEqual((await store.listRecordings("site-1")).map((meta) => meta.recordingId).sort(), ["rec-live", "rec-other"]);

  assert.equal(await store.deleteVisitor("site-1", "hash-a"), 1);
  assert.deepEqual(await store.readChunks("site-1", "rec-live"), []);
  assert.equal((await store.listRecordings("site-1")).length, 1);
});

function readDeps(store: InMemoryReplayStore, overrides: Partial<ReplayReadDeps> = {}): ReplayReadDeps {
  return { enabled: true, siteId: "site-1", store, now: () => NOW, ...overrides };
}

function readRequest(path: string, method = "GET"): Request {
  return new Request(`http://127.0.0.1:3000${path}`, {
    method,
    headers: { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" },
  });
}

test("SR-08 replay read is closed unless the loopback runtime flag is on and stays no-store", async () => {
  assert.equal(isReplayRuntimeEnabled({ NODE_ENV: "production", UX_MEASURE_REPLAY_ENABLED: "true" }), false);
  assert.equal(isReplayRuntimeEnabled({ NODE_ENV: "development" }), false);
  assert.equal(isReplayRuntimeEnabled({ NODE_ENV: "development", UX_MEASURE_REPLAY_ENABLED: "true" }), true);

  const store = new InMemoryReplayStore();
  const disabled = createReplayReadGet(readDeps(store, { enabled: false }));
  assert.equal((await disabled(readRequest("/api/replay/recordings"))).status, 404);

  const crossOrigin = createReplayReadGet(readDeps(store));
  const foreign = new Request("http://127.0.0.1:3000/api/replay/recordings", { headers: { origin: "https://evil.example", host: "127.0.0.1:3000" } });
  assert.equal((await crossOrigin(foreign)).status, 403);

  const unprovisioned = createReplayReadGet(readDeps(store, { siteId: null }));
  assert.equal((await unprovisioned(readRequest("/api/replay/recordings"))).status, 503);

  const list = await createReplayReadGet(readDeps(store))(readRequest("/api/replay/recordings"));
  assert.equal(list.status, 200);
  assert.equal(list.headers.get("cache-control"), "no-store");
});

test("SR-11a expired recordings become unavailable on read instead of serving stale payload", async () => {
  const store = new InMemoryReplayStore();
  await store.appendChunk({
    siteId: "site-1",
    recordingId: "rec-exp",
    sessionId: "sess-1",
    anonymousIdHash: "hash-a",
    sequence: 0,
    startedAt: "2026-06-01T00:00:00.000Z",
    endedAt: "2026-06-01T00:01:00.000Z",
    byteSize: 10,
    payload: JSON.stringify([{ type: 2, timestamp: 1 }]),
    purposeVersion: "replay-v1",
    expiresAt: "2026-07-01T00:00:00.000Z",
  });
  const get = createReplayReadGet(readDeps(store));
  assert.equal((await get(readRequest("/api/replay/recordings?recording=rec-exp"))).status, 404);

  const del = createReplayReadDelete(readDeps(store));
  const visitorDelete = await del(readRequest("/api/replay/recordings?visitor=anon-1", "DELETE"));
  assert.equal(visitorDelete.status, 200);
});

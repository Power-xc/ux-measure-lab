import assert from "node:assert/strict";
import test from "node:test";
import { sha256Hex } from "../../ingest/server/hash.ts";
import { createReplayDogfoodSiteStore, readReplayDogfoodKey, REPLAY_DOGFOOD_SITE_ID } from "./env-site-store.ts";

const KEY = "dogfood-key-0123456789abcdef";

test("DOGFOOD-01 the env site store matches only the configured key hash", async () => {
  const store = createReplayDogfoodSiteStore({ UX_MEASURE_REPLAY_SITE_KEY: KEY });
  assert.ok(store);
  const site = await store.findByKeyHash(await sha256Hex(KEY));
  assert.equal(site?.id, REPLAY_DOGFOOD_SITE_ID);
  assert.equal(site?.retentionDays, 30);
  assert.deepEqual(site?.allowedOrigins, ["http://127.0.0.1:3000", "http://localhost:3000"]);
  assert.equal(await store.findByKeyHash(await sha256Hex("wrong-key-0123456789abcdef")), null);
});

test("DOGFOOD-02 short or missing keys provision nothing", () => {
  assert.equal(readReplayDogfoodKey({}), null);
  assert.equal(readReplayDogfoodKey({ UX_MEASURE_REPLAY_SITE_KEY: "  " }), null);
  assert.equal(readReplayDogfoodKey({ UX_MEASURE_REPLAY_SITE_KEY: "too-short" }), null);
  assert.equal(createReplayDogfoodSiteStore({}), null);
});

test("DOGFOOD-03 the origin allowlist cannot leave loopback by env alone", async () => {
  const store = createReplayDogfoodSiteStore({
    UX_MEASURE_REPLAY_SITE_KEY: KEY,
    UX_MEASURE_REPLAY_ALLOWED_ORIGINS: "http://localhost:3100, https://evil.example, http://intranet:3000",
  });
  assert.ok(store);
  const site = await store.findByKeyHash(await sha256Hex(KEY));
  assert.deepEqual(site?.allowedOrigins, ["http://localhost:3100"]);

  const onlyPublic = createReplayDogfoodSiteStore({
    UX_MEASURE_REPLAY_SITE_KEY: KEY,
    UX_MEASURE_REPLAY_ALLOWED_ORIGINS: "https://evil.example",
  });
  assert.ok(onlyPublic);
  assert.equal(await onlyPublic.findByKeyHash(await sha256Hex(KEY)), null, "no loopback origin → no site at all");
});

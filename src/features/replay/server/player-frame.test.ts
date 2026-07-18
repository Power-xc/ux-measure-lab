import assert from "node:assert/strict";
import test from "node:test";
import { createReplayFrameGet, type ReplayFrameDeps } from "./player-frame.ts";

function makeDeps(overrides: Partial<ReplayFrameDeps> = {}): ReplayFrameDeps {
  return {
    enabled: true,
    readAsset: async (name) => (name === "script" ? "var player = 1;" : ".rr-player {}"),
    ...overrides,
  };
}

test("SR-09g the player frame is closed unless the loopback runtime flag is on", async () => {
  const response = await createReplayFrameGet(makeDeps({ enabled: false }))();
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("SR-09h the frame document pins its own network-blocking CSP and loopback-only ancestors", async () => {
  const response = await createReplayFrameGet(makeDeps())();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.ok(response.headers.get("content-type")?.startsWith("text/html"));
  const csp = response.headers.get("content-security-policy") ?? "";
  assert.ok(csp.startsWith("default-src 'none'"), "every network fetch is blocked");
  assert.ok(csp.includes("frame-ancestors http://127.0.0.1:* http://localhost:*"), "only loopback workspaces embed it");
  const body = await response.text();
  assert.ok(body.includes("var player = 1;"));
  assert.ok(body.includes('id="replay-root"'));
});

test("SR-09i a missing or unreadable vendored bundle degrades to unavailable, not a crash", async () => {
  const failing = createReplayFrameGet(makeDeps({ readAsset: async () => { throw new Error("missing"); } }));
  assert.equal((await failing()).status, 503);
  const empty = createReplayFrameGet(makeDeps({ readAsset: async () => "" }));
  assert.equal((await empty()).status, 503);
});

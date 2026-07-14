import assert from "node:assert/strict";
import test from "node:test";
import { SessionMeasurementCache } from "../model/measurement-cache.ts";
import { createDefaultHarnessRegistry } from "./default-registry.ts";

const query = {
  capability: "paths" as const,
  startEvent: "signup",
  endEvent: "activated",
  window: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-08T00:00:00.000Z" },
};

test("default registry keeps first-party safe and PostHog registered without env", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    throw new Error("unexpected_fetch");
  };
  const registry = createDefaultHarnessRegistry({}, fetcher);
  assert.deepEqual(registry.list().map((adapter) => adapter.meta().adapterId), ["first-party", "posthog"]);
  const context = { now: "2026-07-15T00:00:00.000Z", cache: new SessionMeasurementCache() };
  assert.deepEqual(await registry.get("first-party")?.measure(query, context), {
    ok: false,
    code: "insufficient_sample",
    message: "최소 30개의 관찰 표본이 필요합니다.",
  });
  assert.equal((await registry.get("posthog")?.measure(query, context))?.ok, false);
  assert.equal(calls, 0);
});

test("default registry wires Supabase aggregates when complete env is present", async () => {
  const urls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    urls.push(String(input));
    return Response.json([{ started: 120, reached: 48 }]);
  };
  const registry = createDefaultHarnessRegistry({
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "server-secret",
    SUPABASE_SITE_ID: "11111111-1111-1111-1111-111111111111",
  }, fetcher);
  const outcome = await registry.get("first-party")?.measure(query, {
    now: "2026-07-15T00:00:00.000Z",
    cache: new SessionMeasurementCache(),
  });
  assert.equal(outcome?.ok, true);
  assert.deepEqual(urls, ["https://project.supabase.co/rest/v1/rpc/path_reach"]);
});

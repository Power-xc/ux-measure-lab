import assert from "node:assert/strict";
import test from "node:test";
import type { MeasurementOutcome, MeasurementQuery, NormalizedMeasurement, SourceAdapter } from "../contract.ts";
import { createQueryHash } from "./measure-service.ts";
import { InMemoryAggregateReader } from "./aggregate-reader.ts";
import { createFirstPartyAdapter } from "./first-party-adapter.ts";
import { createAdapterRegistry } from "./registry.ts";
import { createHarnessPost } from "./route-handler.ts";

const origin = "http://localhost:3000";

function request(body: unknown, headers: HeadersInit = {}): Request {
  return new Request(`${origin}/api/harness/measure`, {
    method: "POST",
    headers: { origin, host: "localhost:3000", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function post(reader = new InMemoryAggregateReader()) {
  return createHarnessPost({
    registry: createAdapterRegistry([createFirstPartyAdapter(reader)]),
    now: () => "2026-07-15T00:00:00.000Z",
  });
}

function postWithOutcome(outcome: MeasurementOutcome, supports = true) {
  const adapter: SourceAdapter = {
    meta: () => ({
      adapterId: "stub",
      displayName: "Stub",
      kind: "connector",
      access: "read_only",
      capabilities: ["funnel"],
    }),
    supports: () => supports,
    measure: async () => outcome,
  };
  return createHarnessPost({
    registry: createAdapterRegistry([adapter]),
    now: () => "2026-07-15T00:00:00.000Z",
  });
}

const body = {
  adapterId: "first-party",
  query: {
    capability: "funnel",
    steps: ["signup", "activated"],
    window: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-08T00:00:00.000Z" },
  } satisfies MeasurementQuery,
};

test("harness route returns a value-free insufficient sample outcome", async () => {
  const response = await post()(request(body));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "insufficient_sample",
    message: "최소 30개의 관찰 표본이 필요합니다.",
  });
});

test("HAC-11 route rejects a zero-duration window before adapter execution", async () => {
  let calls = 0;
  const adapter: SourceAdapter = {
    meta: () => ({ adapterId: "stub", displayName: "Stub", kind: "connector", access: "read_only", capabilities: ["funnel"] }),
    supports: () => true,
    measure: async () => {
      calls += 1;
      return { ok: false, code: "upstream_error", message: "should not run" };
    },
  };
  const handler = createHarnessPost({ registry: createAdapterRegistry([adapter]) });
  const instant = "2026-07-08T00:00:00.000Z";
  const response = await handler(request({ ...body, adapterId: "stub", query: { ...body.query, window: { from: instant, to: instant } } }));

  assert.equal(response.status, 200);
  assert.equal((await response.json()).code, "insufficient_sample");
  assert.equal(calls, 0);
});

test("harness route dispatches a valid query and returns normalized evidence input", async () => {
  const reader = new InMemoryAggregateReader({
    funnels: [{ input: body.query, counts: [100, 40] }],
  });
  const response = await post(reader)(request(body));
  const outcome = await response.json() as { ok: boolean; measurements?: unknown[] };
  assert.equal(response.status, 200);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.measurements?.length, 1);
});

test("harness route reuses a bounded cache for a closed measurement window", async () => {
  let calls = 0;
  class CountingReader extends InMemoryAggregateReader {
    override async funnelCounts(...args: Parameters<InMemoryAggregateReader["funnelCounts"]>) {
      calls += 1;
      return super.funnelCounts(...args);
    }
  }
  const reader = new CountingReader({ funnels: [{ input: body.query, counts: [100, 40] }] });
  const handler = post(reader);
  assert.equal((await handler(request(body))).status, 200);
  assert.equal((await handler(request(body))).status, 200);
  assert.equal(calls, 1);
});

test("harness route rejects cross-site, non-json, and unknown query fields", async () => {
  const crossSite = await post()(request(body, { "sec-fetch-site": "cross-site" }));
  assert.equal(crossSite.status, 403);
  const nonJson = new Request(`${origin}/api/harness/measure`, {
    method: "POST",
    headers: { origin, host: "localhost:3000", "content-type": "text/plain" },
    body: "{}",
  });
  assert.equal((await post()(nonJson)).status, 415);
  assert.equal((await post()(request({ ...body, query: { ...body.query, hidden: true } }))).status, 400);
});

test("harness route rejects missing or foreign origins and malformed or oversized bodies", async () => {
  const missingOrigin = new Request(`${origin}/api/harness/measure`, {
    method: "POST",
    headers: { host: "localhost:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal((await post()(missingOrigin)).status, 403);
  assert.equal((await post()(request(body, { origin: "https://attacker.example" }))).status, 403);
  const malformed = new Request(`${origin}/api/harness/measure`, {
    method: "POST",
    headers: { origin, host: "localhost:3000", "content-type": "application/json" },
    body: "{",
  });
  assert.equal((await post()(malformed)).status, 400);
  const oversized = new Request(`${origin}/api/harness/measure`, {
    method: "POST",
    headers: { origin, host: "localhost:3000", "content-type": "application/json" },
    body: JSON.stringify({ payload: "x".repeat(70_000) }),
  });
  assert.equal((await post()(oversized)).status, 413);
});

test("harness route classifies unsupported first-party queries", async () => {
  const events = {
    adapterId: "first-party",
    query: { capability: "events", event: "signup", interval: "day", window: body.query.window },
  };
  assert.equal((await post()(request(events))).status, 400);
  const errorSignal = {
    adapterId: "first-party",
    query: { capability: "interaction", signals: ["error"], window: body.query.window },
  };
  const errorResponse = await post()(request(errorSignal));
  assert.equal(errorResponse.status, 400);
  assert.equal((await errorResponse.json()).code, "unsupported_capability");
  const segment = {
    ...body,
    query: { ...body.query, segment: { dimension: "plan", value: "team" } },
  };
  assert.equal((await post()(request(segment))).status, 400);
});

test("harness route maps missing adapters without exposing configuration", async () => {
  const response = await post()(request({ ...body, adapterId: "missing" }));
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "not_configured",
    message: "선택한 측정 소스를 찾을 수 없습니다.",
  });
});

test("harness route maps adapter errors and Retry-After", async (t) => {
  const cases: { code: Exclude<MeasurementOutcome, { ok: true }>["code"]; status: number }[] = [
    { code: "unsupported_capability", status: 400 },
    { code: "not_configured", status: 503 },
    { code: "unauthorized", status: 401 },
    { code: "rate_limited", status: 429 },
    { code: "upstream_error", status: 502 },
    { code: "invalid_response", status: 502 },
    { code: "insufficient_sample", status: 200 },
    { code: "timeout", status: 504 },
  ];
  for (const item of cases) {
    await t.test(item.code, async () => {
      const outcome: MeasurementOutcome = item.code === "rate_limited"
        ? { ok: false, code: item.code, message: "retry", retryAfterMs: 2_500 }
        : { ok: false, code: item.code, message: "failed" };
      const response = await postWithOutcome(outcome)(request({ ...body, adapterId: "stub" }));
      assert.equal(response.status, item.status);
      if (item.code === "rate_limited") assert.equal(response.headers.get("retry-after"), "3");
    });
  }
});

test("harness route converts a forged low-sample success into a value-free failure", async () => {
  const queryHash = await createQueryHash(body.query);
  const measurement: NormalizedMeasurement = {
    metricLabel: "퍼널",
    observation: "표본 0개가 관찰되었습니다.",
    sourceKind: "calculated",
    direction: "context",
    values: { enteredUsers: 0 },
    provenance: {
      adapterId: "stub",
      capability: "funnel",
      source: "Stub",
      observedAt: "2026-07-15T00:00:00.000Z",
      period: "2026-07-01 ~ 2026-07-08",
      window: body.query.window,
      segment: "전체 사용자",
      queryHash,
    },
    confidence: { level: "low", sampleSize: 0, basis: "표본 0개", limits: "원인을 설명하지 않습니다." },
  };
  const response = await postWithOutcome({ ok: true, measurements: [measurement], degraded: [] })(
    request({ ...body, adapterId: "stub" }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "insufficient_sample",
    message: "최소 30개의 관찰 표본이 필요합니다.",
  });
  const forgedConfidence: NormalizedMeasurement = {
    ...measurement,
    values: { enteredUsers: 100 },
    observation: "표본 100개가 관찰되었습니다.",
    confidence: { ...measurement.confidence, sampleSize: 100, level: "high", basis: "표본 100개" },
  };
  const untrusted = await postWithOutcome({ ok: true, measurements: [forgedConfidence], degraded: [] })(
    request({ ...body, adapterId: "stub" }),
  );
  assert.equal(untrusted.status, 502);
  assert.equal((await untrusted.json()).code, "invalid_response");
});

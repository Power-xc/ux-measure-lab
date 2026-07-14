import assert from "node:assert/strict";
import test from "node:test";
import {
  parseNormalizedMeasurement,
  type AdapterContext,
  type MeasurementCache,
  type MeasurementOutcome,
  type MeasurementQuery,
  type NormalizedMeasurement,
  type SourceAdapterMeta,
} from "../../contract.ts";
import { InMemoryAggregateReader } from "../../server/aggregate-reader.ts";
import { createMeasureService } from "../../server/measure-service.ts";
import { PostHogAdapter, type PostHogEnvironment, type PostHogFetch } from "./adapter.ts";

const NOW = "2026-07-15T00:00:00.000Z";
const WINDOW = { from: "2026-07-01T00:00:00.000Z", to: "2026-07-08T00:00:00.000Z" };
const ENV: PostHogEnvironment = {
  POSTHOG_HOST: "https://eu.posthog.com",
  POSTHOG_PROJECT_ID: "42",
  POSTHOG_API_KEY: "phx_fixture_key", // secret-scan-allow: 테스트 픽스처
};

class MemoryCache implements MeasurementCache {
  private readonly entries = new Map<string, readonly NormalizedMeasurement[]>();
  get(queryHash: string): readonly NormalizedMeasurement[] | undefined { return this.entries.get(queryHash); }
  set(queryHash: string, measurements: readonly NormalizedMeasurement[]): void { this.entries.set(queryHash, [...measurements]); }
}

function context(cache = new MemoryCache(), signal?: AbortSignal): AdapterContext {
  return { now: NOW, cache, ...(signal ? { signal } : {}) };
}

function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" }, ...init });
}

function funnelQuery(): Extract<MeasurementQuery, { capability: "funnel" }> {
  return { capability: "funnel", steps: ["visit", "signup", "activate"], window: WINDOW };
}

function assertFailure(outcome: MeasurementOutcome, code: Exclude<MeasurementOutcome, { ok: true }>["code"]): void {
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.code, code);
}

test("PostHog adapter remains registered but returns not_configured without server env", async () => {
  let called = false;
  const adapter = new PostHogAdapter({ env: {}, fetch: async () => { called = true; return json({}); } });
  assert.deepEqual(adapter.meta(), {
    adapterId: "posthog",
    displayName: "PostHog (read-only)",
    kind: "connector",
    access: "read_only",
    capabilities: ["funnel", "events", "paths", "interaction"],
  });
  assertFailure(await adapter.measure(funnelQuery(), context()), "not_configured");
  assert.equal(called, false);
});

test("PostHog adapter sends server credentials and normalizes fixture results", async () => {
  let requests = 0;
  const request: PostHogFetch = async (url, init) => {
    requests += 1;
    assert.equal(url, "https://eu.posthog.com/api/projects/42/query/");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer phx_fixture_key");
    assert.equal(init.method, "POST");
    assert.match(String(init.body), /HogQLQuery/);
    return json({ columns: ["step_1", "step_2", "step_3"], results: [[1_200, 800, 300]] });
  };
  const cache = new MemoryCache();
  const adapter = new PostHogAdapter({ env: ENV, fetch: request });
  const first = await adapter.measure(funnelQuery(), context(cache));
  assert.equal(first.ok, true);
  if (first.ok) {
    assert.equal(first.measurements.length, 1);
    assert.equal(parseNormalizedMeasurement(first.measurements[0]).ok, true);
    assert.deepEqual(first.measurements[0].values, { enteredUsers: 1_200, completedUsers: 300, totalConversion: 25, largestDropOffRate: 62.5 });
    assert.equal(first.measurements[0].confidence.level, "high");
  }
  const cached = await adapter.measure(funnelQuery(), context(cache));
  assert.equal(cached.ok, true);
  assert.equal(requests, 1);
});

test("PostHog adapter normalizes events, paths and interaction fixtures", async (t) => {
  const fixtures: { name: string; query: MeasurementQuery; body: unknown; count: number }[] = [
    {
      name: "events",
      query: { capability: "events", event: "report_created", interval: "day", window: WINDOW },
      body: { columns: ["bucket", "count"], results: [["2026-07-01 00:00:00", 80], ["2026-07-02 00:00:00", 40]] },
      count: 1,
    },
    {
      name: "paths",
      query: { capability: "paths", startEvent: "signup", endEvent: "report_created", window: WINDOW },
      body: { columns: ["start_count", "reached_count"], results: [[120, 60]] },
      count: 1,
    },
    {
      name: "interaction",
      query: { capability: "interaction", signals: ["rage", "dead"], target: "#checkout", window: WINDOW },
      body: { columns: ["sample_size", "dead_count", "rage_count"], results: [[1_000, 4, 12]] },
      count: 2,
    },
  ];
  for (const fixture of fixtures) {
    await t.test(fixture.name, async () => {
      const adapter = new PostHogAdapter({ env: ENV, fetch: async () => json(fixture.body) });
      const outcome = await adapter.measure(fixture.query, context());
      assert.equal(outcome.ok, true);
      if (!outcome.ok) return;
      assert.equal(outcome.measurements.length, fixture.count);
      assert.equal(outcome.measurements.every((measurement) => parseNormalizedMeasurement(measurement).ok), true);
      if (fixture.name === "interaction") {
        const rage = outcome.measurements.find((measurement) => measurement.metricLabel === "반복 클릭");
        assert.deepEqual(rage?.values, { signalCount: 12, sampleSize: 1_000, signalsPer100Samples: 1.2 });
      }
    });
  }
});

test("PostHog adapter maps HTTP, schema, sample and transport failures", async (t) => {
  const cases: { name: string; expected: Exclude<MeasurementOutcome, { ok: true }>["code"]; response: () => Promise<Response> }[] = [
    { name: "401", expected: "unauthorized", response: async () => new Response(null, { status: 401 }) },
    { name: "500", expected: "upstream_error", response: async () => new Response(null, { status: 503 }) },
    { name: "other 4xx", expected: "invalid_response", response: async () => new Response(null, { status: 400 }) },
    { name: "invalid json", expected: "invalid_response", response: async () => new Response("{", { status: 200 }) },
    { name: "schema mismatch", expected: "invalid_response", response: async () => json({ columns: ["wrong"], results: [[1]] }) },
    { name: "increasing funnel", expected: "invalid_response", response: async () => json({ columns: ["step_1", "step_2", "step_3"], results: [[100, 110, 90]] }) },
    { name: "small sample", expected: "insufficient_sample", response: async () => json({ columns: ["step_1", "step_2", "step_3"], results: [[29, 20, 10]] }) },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const adapter = new PostHogAdapter({ env: ENV, fetch: async () => fixture.response() });
      assertFailure(await adapter.measure(funnelQuery(), context()), fixture.expected);
    });
  }
  await t.test("network", async () => {
    const adapter = new PostHogAdapter({ env: ENV, fetch: async () => { throw new Error("offline"); } });
    assertFailure(await adapter.measure(funnelQuery(), context()), "upstream_error");
  });
  await t.test("abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const adapter = new PostHogAdapter({ env: ENV, fetch: async () => { throw new DOMException("aborted", "AbortError"); } });
    assertFailure(await adapter.measure(funnelQuery(), context(new MemoryCache(), controller.signal)), "timeout");
  });
  await t.test("unsupported capability", async () => {
    const adapter = new PostHogAdapter({ env: ENV, fetch: async () => json({}) });
    const query: MeasurementQuery = { capability: "segments", steps: ["visit", "signup"], dimension: "plan", window: WINDOW };
    assertFailure(await adapter.measure(query, context()), "unsupported_capability");
  });
});

test("PostHog adapter returns a value-free insufficient sample before a zero-duration query", async () => {
  const instant = "2026-07-08T00:00:00.000Z";
  let calls = 0;
  const adapter = new PostHogAdapter({
    env: ENV,
    fetch: async () => {
      calls += 1;
      return json({ columns: ["step_1", "step_2", "step_3"], results: [[1_000, 500, 250]] });
    },
  });
  const outcome = await adapter.measure({
    ...funnelQuery(),
    window: { from: instant, to: instant },
  }, context());

  assert.deepEqual(outcome, {
    ok: false,
    code: "insufficient_sample",
    message: "관찰 기간은 0초보다 길어야 합니다.",
  });
  assert.equal("measurements" in outcome, false);
  assert.equal(calls, 0);
});

test("PostHog adapter forwards Retry-After seconds and HTTP dates", async () => {
  const seconds = new PostHogAdapter({ env: ENV, fetch: async () => new Response(null, { status: 429, headers: { "Retry-After": "2.5" } }) });
  const first = await seconds.measure(funnelQuery(), context());
  assertFailure(first, "rate_limited");
  if (!first.ok) assert.equal(first.retryAfterMs, 2_500);

  const date = new PostHogAdapter({ env: ENV, fetch: async () => new Response(null, { status: 429, headers: { "Retry-After": "Wed, 15 Jul 2026 00:00:03 GMT" } }) });
  const second = await date.measure(funnelQuery(), context());
  assertFailure(second, "rate_limited");
  if (!second.ok) assert.equal(second.retryAfterMs, 3_000);
});

test("PostHog adapter normalizes equivalent interaction queries before caching", async () => {
  let requests = 0;
  const adapter = new PostHogAdapter({
    env: ENV,
    fetch: async () => {
      requests += 1;
      return json({ columns: ["sample_size", "dead_count", "rage_count"], results: [[1_000, 4, 12]] });
    },
  });
  const cache = new MemoryCache();
  const first = await adapter.measure({
    capability: "interaction",
    signals: ["rage", "dead"],
    target: " #checkout ",
    window: WINDOW,
  }, context(cache));
  const second = await adapter.measure({
    capability: "interaction",
    signals: ["dead", "rage"],
    target: "#checkout",
    window: WINDOW,
  }, context(cache));
  assert.deepEqual(second, first);
  assert.equal(requests, 1);
});

test("HAC-09 first-party and PostHog normalize the same funnel contract", async () => {
  const query = funnelQuery();
  const sharedCache = new MemoryCache();
  const firstPartyMeta: SourceAdapterMeta = {
    adapterId: "first-party", displayName: "UX MeasureLab SDK", kind: "first_party", access: "read_write", capabilities: ["funnel"],
  };
  const reader = new InMemoryAggregateReader({ funnels: [{ input: query, counts: [1_200, 800, 300] }] });
  const firstParty = await createMeasureService(reader, firstPartyMeta).measure(query, context(sharedCache));
  let posthogRequests = 0;
  const posthog = await new PostHogAdapter({
    env: ENV,
    fetch: async () => {
      posthogRequests += 1;
      return json({ columns: ["step_1", "step_2", "step_3"], results: [[1_200, 800, 300]] });
    },
  }).measure(query, context(sharedCache));
  assert.equal(firstParty.ok, true);
  assert.equal(posthog.ok, true);
  if (!firstParty.ok || !posthog.ok) return;
  const left = firstParty.measurements[0];
  const right = posthog.measurements[0];
  assert.equal(parseNormalizedMeasurement(left).ok, true);
  assert.equal(parseNormalizedMeasurement(right).ok, true);
  assert.deepEqual(Object.keys(left).sort(), Object.keys(right).sort());
  assert.deepEqual(Object.keys(left.provenance).sort(), Object.keys(right.provenance).sort());
  assert.deepEqual(left.values, right.values);
  assert.equal(left.provenance.queryHash, right.provenance.queryHash);
  assert.deepEqual(left.confidence, right.confidence);
  assert.equal(posthogRequests, 1);
});

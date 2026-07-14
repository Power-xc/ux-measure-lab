import assert from "node:assert/strict";
import test from "node:test";
import type { MeasurementQuery, NormalizedMeasurement } from "../contract.ts";
import { SessionMeasurementCache } from "../model/measurement-cache.ts";
import { createQueryHash } from "../server/measure-service.ts";
import { createFirstPartyClientAdapter } from "./http-client.ts";

const query = {
  capability: "paths",
  startEvent: "signup",
  endEvent: "activated",
  window: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-08T00:00:00.000Z" },
} satisfies MeasurementQuery;

async function measurement(adapterId = "first-party", input = query): Promise<NormalizedMeasurement> {
  return {
    metricLabel: "여정 도달률",
    observation: "가입 표본 중 활성화 도달률은 50%입니다.",
    sourceKind: "calculated",
    direction: "context",
    values: { startedUsers: 100, reachedUsers: 50, reachRate: 50 },
    provenance: {
      adapterId,
      capability: "paths",
      source: "UX MeasureLab Events",
      observedAt: "2026-07-15T00:00:00.000Z",
      period: "2026-07-01 ~ 2026-07-08",
      window: input.window,
      segment: "전체 사용자",
      queryHash: await createQueryHash(input),
    },
    confidence: {
      level: "medium",
      sampleSize: 100,
      basis: "표본 100개",
      limits: "인과관계를 나타내지 않습니다.",
    },
  };
}

test("first-party client validates, caches, and reuses a successful response", async () => {
  let calls = 0;
  const fetcher = async (): Promise<Response> => {
    calls += 1;
    return Response.json({ ok: true, measurements: [await measurement()], degraded: [] });
  };
  const adapter = createFirstPartyClientAdapter(fetcher);
  const context = { now: "2026-07-15T00:00:00.000Z", cache: new SessionMeasurementCache() };
  assert.equal((await adapter.measure(query, context)).ok, true);
  assert.equal((await adapter.measure(query, context)).ok, true);
  assert.equal(calls, 1);
});

test("first-party client does not session-cache a current-day window", async () => {
  const liveQuery = { ...query, window: { from: "2026-07-15T00:00:00.000Z", to: "2026-07-15T12:00:00.000Z" } };
  let calls = 0;
  const adapter = createFirstPartyClientAdapter(async () => {
    calls += 1;
    return Response.json({ ok: true, measurements: [await measurement("first-party", liveQuery)], degraded: [] });
  });
  const context = { now: "2026-07-15T13:00:00.000Z", cache: new SessionMeasurementCache() };
  assert.equal((await adapter.measure(liveQuery, context)).ok, true);
  assert.equal((await adapter.measure(liveQuery, context)).ok, true);
  assert.equal(calls, 2);
});

test("first-party client rejects mismatched provenance and unknown fields", async () => {
  const mismatched = createFirstPartyClientAdapter(async () => Response.json({
    ok: true,
    measurements: [await measurement("posthog")],
    degraded: [],
  }));
  const injected = createFirstPartyClientAdapter(async () => Response.json({
    ok: false,
    code: "upstream_error",
    message: "failed",
    secret: "leak",
  }));
  const context = { now: "2026-07-15T00:00:00.000Z", cache: new SessionMeasurementCache() };
  assert.deepEqual(await mismatched.measure(query, context), {
    ok: false,
    code: "invalid_response",
    message: "측정 서버 응답을 신뢰할 수 없습니다.",
  });
  assert.equal((await injected.measure(query, context)).ok, false);
});

test("first-party client rejects forged windows, segments and confidence levels", async () => {
  const valid = await measurement();
  const forgeries: NormalizedMeasurement[] = [
    { ...valid, provenance: { ...valid.provenance, window: { ...valid.provenance.window, to: "2026-07-09T00:00:00.000Z" } } },
    { ...valid, provenance: { ...valid.provenance, segment: "plan=pro" } },
    { ...valid, confidence: { ...valid.confidence, level: "high" } },
  ];
  for (const forged of forgeries) {
    const adapter = createFirstPartyClientAdapter(async () => Response.json({ ok: true, measurements: [forged], degraded: [] }));
    const result = await adapter.measure(query, { now: "2026-07-15T00:00:00.000Z", cache: new SessionMeasurementCache() });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "invalid_response");
  }
});

test("first-party client never renders values for insufficient samples", async () => {
  const adapter = createFirstPartyClientAdapter(async () => Response.json({
    ok: false,
    code: "insufficient_sample",
    message: "표본이 부족합니다.",
  }));
  const result = await adapter.measure(query, {
    now: "2026-07-15T00:00:00.000Z",
    cache: new SessionMeasurementCache(),
  });
  assert.deepEqual(result, { ok: false, code: "insufficient_sample", message: "표본이 부족합니다." });
  assert.equal("measurements" in result, false);
});

test("first-party client converts a forged low-sample success into a value-free failure", async () => {
  const forged = await measurement();
  forged.confidence.sampleSize = 0;
  const adapter = createFirstPartyClientAdapter(async () => Response.json({
    ok: true,
    measurements: [forged],
    degraded: [],
  }));
  const result = await adapter.measure(query, {
    now: "2026-07-15T00:00:00.000Z",
    cache: new SessionMeasurementCache(),
  });
  assert.deepEqual(result, {
    ok: false,
    code: "insufficient_sample",
    message: "최소 30개의 관찰 표본이 필요합니다.",
  });
  assert.equal("measurements" in result, false);
});

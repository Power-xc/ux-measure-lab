import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedMeasurement } from "../contract.ts";
import { parseMeasurementRequest, parseMeasurementQuery } from "./measurement-query.ts";
import { SessionMeasurementCache } from "../model/measurement-cache.ts";
import { parseMeasurementOutcome } from "../model/parse-measurement-outcome.ts";

const window = { from: "2026-07-01T00:00:00.000Z", to: "2026-07-08T00:00:00.000Z" };

const measurement: NormalizedMeasurement = {
  metricLabel: "가입 퍼널",
  observation: "가입 완료 도달이 관찰됐다.",
  sourceKind: "calculated",
  direction: "context",
  values: { sampleSize: 120 },
  provenance: {
    adapterId: "first-party",
    capability: "funnel",
    source: "UX MeasureLab SDK",
    observedAt: "2026-07-08T00:00:00.000Z",
    period: "2026-07-01 ~ 2026-07-08",
    window,
    segment: "전체 사용자",
    queryHash: "hash-1",
  },
  confidence: {
    level: "medium",
    sampleSize: 120,
    basis: "표본 120건",
    limits: "관찰 기간 밖의 행동과 원인은 설명하지 않는다.",
  },
};

test("HARNESS query parser accepts the three executable query shapes", () => {
  assert.equal(parseMeasurementQuery({ capability: "funnel", steps: ["visit", "signup"], window }).ok, true);
  assert.equal(parseMeasurementQuery({ capability: "interaction", signals: ["rage", "dead"], target: "/signup", window }).ok, true);
  assert.equal(parseMeasurementQuery({ capability: "paths", startEvent: "signup", endEvent: "report", window }).ok, true);
});

test("HARNESS query parser rejects unknown fields, invalid windows, and duplicate values", () => {
  assert.equal(parseMeasurementQuery({ capability: "funnel", steps: ["visit", "signup"], window, extra: true }).ok, false);
  assert.equal(parseMeasurementQuery({ capability: "paths", startEvent: "signup", endEvent: "report", window: { from: window.to, to: window.from } }).ok, false);
  assert.equal(parseMeasurementQuery({ capability: "interaction", signals: ["rage", "rage"], window }).ok, false);
  assert.equal(parseMeasurementQuery({ capability: "interaction", signals: ["unknown"], window }).ok, false);
  assert.equal(parseMeasurementQuery({ capability: "paths", startEvent: "signup", endEvent: " signup ", window }).ok, false);
});

test("HARNESS query parser preserves a zero-duration window for a value-free outcome", () => {
  const instant = "2026-07-08T00:00:00.000Z";
  assert.equal(parseMeasurementQuery({
    capability: "paths",
    startEvent: "signup",
    endEvent: "report",
    window: { from: instant, to: instant },
  }).ok, true);
});

test("HARNESS request parser requires only adapterId and query", () => {
  const query = { capability: "paths", startEvent: "signup", endEvent: "report", window };
  assert.equal(parseMeasurementRequest({ adapterId: "first-party", query }).ok, true);
  assert.equal(parseMeasurementRequest({ adapterId: "first-party", query, projectId: "p1" }).ok, false);
});

test("HARNESS outcome parser distrusts outer and nested response fields", () => {
  const valid = { ok: true, measurements: [measurement], degraded: [] };
  assert.deepEqual(parseMeasurementOutcome(valid), valid);
  assert.equal(parseMeasurementOutcome({ ...valid, extra: true }), null);
  assert.equal(parseMeasurementOutcome({ ...valid, measurements: [{ ...measurement, values: { sampleSize: "120" } }] }), null);
  assert.equal(parseMeasurementOutcome({ ok: false, code: "rate_limited", message: "잠시 후 다시 시도하세요.", retryAfterMs: 1000 })?.ok, false);
});

test("HAC-08 session cache returns defensive copies", () => {
  const cache = new SessionMeasurementCache();
  cache.set("hash-1", [measurement]);
  const first = cache.get("hash-1");
  const second = cache.get("hash-1");
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.notEqual(first?.[0], second?.[0]);
});

test("session cache evicts the oldest result at its bounded capacity", () => {
  const cache = new SessionMeasurementCache(2);
  cache.set("one", [measurement]);
  cache.set("two", [measurement]);
  cache.set("three", [measurement]);
  assert.equal(cache.get("one"), undefined);
  assert.equal(cache.get("two")?.length, 1);
  assert.equal(cache.get("three")?.length, 1);
});

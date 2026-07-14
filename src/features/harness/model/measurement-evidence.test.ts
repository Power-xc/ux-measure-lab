import assert from "node:assert/strict";
import test from "node:test";
import type { Evidence } from "../../../entities/project/model.ts";
import type { NormalizedMeasurement } from "../contract.ts";
import { applyMeasurementEvidence, measurementsToEvidence } from "./measurement-evidence.ts";

const measurement: NormalizedMeasurement = {
  metricLabel: "여정 도달률",
  observation: "가입 표본 중 활성화 도달률은 50%로 관찰되었습니다.",
  sourceKind: "calculated",
  direction: "context",
  values: { startedUsers: 100, reachedUsers: 50, reachRate: 50 },
  provenance: {
    adapterId: "first-party",
    capability: "paths",
    source: "UX MeasureLab Events",
    observedAt: "2026-07-15T00:00:00.000Z",
    period: "2026-07-01 ~ 2026-07-08",
    window: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-08T00:00:00.000Z" },
    segment: "전체 사용자",
    queryHash: "0123456789abcdef0123456789abcdef",
  },
  confidence: {
    level: "medium",
    sampleSize: 100,
    basis: "7일간 사용자 100명",
    limits: "도달 차이의 원인을 설명하지 않습니다.",
  },
};

test("measurement conversion preserves provenance and creates a stable Evidence draft", () => {
  const first = measurementsToEvidence([measurement]);
  const second = measurementsToEvidence([measurement]);
  assert.deepEqual(first, second);
  assert.equal(first[0]?.id, `harness-first-party-${measurement.provenance.queryHash}-0`);
  assert.deepEqual(first[0]?.sourceRef, {
    adapterId: "first-party",
    capability: "paths",
    queryHash: measurement.provenance.queryHash,
    sampleSize: 100,
    confidence: "medium",
  });
  assert.match(first[0]?.detail ?? "", /reachRate=50/);
  assert.match(first[0]?.detail ?? "", /원인을 설명하지 않습니다/);
});

test("HAC-10 measurement response remains a draft until explicit application", () => {
  const applied: Evidence[] = [];
  const draft = measurementsToEvidence([measurement]);
  assert.equal(applied.length, 0);
  assert.equal(applyMeasurementEvidence([measurement], (evidence) => {
    applied.push(...evidence);
    return true;
  }), true);
  assert.deepEqual(applied, draft);
});

test("measurement conversion rejects a successful-looking result without a sample", () => {
  assert.throws(
    () => measurementsToEvidence([{ ...measurement, confidence: { ...measurement.confidence, sampleSize: 0 } }]),
    /실제 표본/,
  );
});

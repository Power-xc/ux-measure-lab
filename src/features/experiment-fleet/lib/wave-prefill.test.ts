import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedMeasurement } from "../../harness/contract.ts";
import { buildWavePrefill } from "./wave-prefill.ts";

function makeMeasurement(value: string, entered: number, completed: number): NormalizedMeasurement {
  return {
    metricLabel: `변형 전환 · ${value}`,
    observation: `variant=${value} 표본 ${entered}명 중 ${completed}명이 마지막 단계에 도달했습니다.`,
    sourceKind: "calculated",
    direction: "context",
    values: { enteredUsers: entered, completedUsers: completed, conversionRate: 0 },
    provenance: {
      adapterId: "first-party",
      capability: "segments",
      source: "UX MeasureLab Events",
      observedAt: "2026-07-17T00:00:00.000Z",
      period: "7일",
      window: { from: "2026-07-10T00:00:00.000Z", to: "2026-07-17T00:00:00.000Z" },
      segment: `variant=${value}`,
      queryHash: "hash",
    },
    confidence: { level: "medium", sampleSize: entered, basis: "표본", limits: "인과 아님" },
  };
}

const BASE_INPUT = {
  dimension: "variant",
  baselineValue: "baseline",
  variantIds: ["v-1", "v-2"],
};

test("FLEET-PREFILL-001 maps segment measurements onto the wave form counts", () => {
  const result = buildWavePrefill({
    ...BASE_INPUT,
    measurements: [
      makeMeasurement("baseline", 1_000, 100),
      makeMeasurement("v-2", 400, 52),
      makeMeasurement("v-1", 400, 56),
    ],
  });
  assert.ok(result.ok);
  assert.deepEqual(result.prefill.baseline, { converted: 100, total: 1_000 });
  assert.deepEqual(result.prefill.variants, [
    { variantId: "v-1", count: { converted: 56, total: 400 } },
    { variantId: "v-2", count: { converted: 52, total: 400 } },
  ]);
});

test("FLEET-PREFILL-002 fails plainly when the baseline or a variant was not observed", () => {
  const noBaseline = buildWavePrefill({
    ...BASE_INPUT,
    measurements: [makeMeasurement("v-1", 400, 56), makeMeasurement("v-2", 400, 52)],
  });
  assert.ok(!noBaseline.ok && /기준선/.test(noBaseline.error));

  const missingVariant = buildWavePrefill({
    ...BASE_INPUT,
    measurements: [makeMeasurement("baseline", 1_000, 100), makeMeasurement("v-1", 400, 56)],
  });
  assert.ok(!missingVariant.ok && /v-2/.test(missingVariant.error));
});

test("FLEET-PREFILL-003 rejects foreign capabilities, duplicates and impossible counts", () => {
  const wrongCapability = buildWavePrefill({
    ...BASE_INPUT,
    measurements: [{
      ...makeMeasurement("v-1", 400, 56),
      provenance: { ...makeMeasurement("v-1", 400, 56).provenance, capability: "funnel", segment: "전체 사용자" },
    }],
  });
  assert.ok(!wrongCapability.ok);

  const duplicated = buildWavePrefill({
    ...BASE_INPUT,
    measurements: [makeMeasurement("v-1", 400, 56), makeMeasurement("v-1", 300, 30)],
  });
  assert.ok(!duplicated.ok && /중복/.test(duplicated.error));

  const impossible = buildWavePrefill({
    ...BASE_INPUT,
    measurements: [{
      ...makeMeasurement("baseline", 100, 100),
      values: { enteredUsers: 100, completedUsers: 200, conversionRate: 0 },
    }],
  });
  assert.ok(!impossible.ok);
});

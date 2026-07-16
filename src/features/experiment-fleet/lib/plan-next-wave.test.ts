import assert from "node:assert/strict";
import test from "node:test";
import type { FleetPlan, FleetVariant, FleetWaveResult } from "../../../entities/fleet/model.ts";
import { planNextWave } from "./plan-next-wave.ts";

function makeVariant(id: string): FleetVariant {
  return {
    id,
    name: `변형 ${id}`,
    changeDescription: "결제 진입 문구 변경",
    origin: "ai_candidate",
    relatedEvidenceIds: [],
    status: "active",
  };
}

function makePlan(variantIds: string[], policyOverrides: Partial<FleetPlan["policy"]> = {}): FleetPlan {
  return {
    id: "fleet-1",
    name: "결제 진입 문구 함대",
    primaryMetricId: "metric-1",
    policy: {
      successThresholdPp: 2,
      failureThresholdPp: 0,
      minimumSampleSizePerVariant: 200,
      plannedDaysPerWave: 7,
      maxActiveVariants: 4,
      keepShare: 0.5,
      sampleBudget: 10000,
      guardrailMetricName: "환불 요청률",
      maxGuardrailIncreasePp: 0.5,
      stopRule: "웨이브 3회 완료 또는 예산 소진 시 종료",
      ...policyOverrides,
    },
    variants: variantIds.map(makeVariant),
    status: "running",
  };
}

function makeWaveResult(overrides: Partial<FleetWaveResult>): FleetWaveResult {
  return {
    wave: 1,
    outcomes: [],
    advanced: [],
    culled: [],
    needsSample: [],
    promotionCandidateId: null,
    sampleUsed: 0,
    sampleBudgetRemaining: 7350,
    exposureWarnings: [],
    ...overrides,
  };
}

const SIX_VARIANTS = ["v-a", "v-b", "v-c", "v-d", "v-e", "v-f"];

test("FLEET-NEXT-001 carries survivors forward in rank order and splits the remaining budget", () => {
  const decision = planNextWave({
    plan: makePlan(SIX_VARIANTS),
    lastWave: makeWaveResult({ advanced: ["v-a", "v-b", "v-c"], needsSample: ["v-e", "v-f"] }),
  });

  assert.ok(decision.proceed);
  assert.equal(decision.wave, 2);
  // 승급 변형이 순위 순으로 앞서고, 표본 부족 변형이 뒤따르며 동시 상한 4에서 잘린다.
  assert.deepEqual(decision.activeVariantIds, ["v-a", "v-b", "v-c", "v-e"]);
  // 다음 웨이브는 기준선 1개를 포함한 5개 팔이 예산 7350을 나눈다.
  assert.equal(decision.perVariantSampleTarget, 1470);
});

test("FLEET-NEXT-002 stops as converged when exactly one variant advanced and none need sample", () => {
  const decision = planNextWave({
    plan: makePlan(SIX_VARIANTS),
    lastWave: makeWaveResult({ advanced: ["v-a"] }),
  });
  assert.equal(decision.proceed, false);
  assert.ok(!decision.proceed && decision.reason === "converged");
  assert.deepEqual(!decision.proceed ? decision.survivors : [], ["v-a"]);
});

test("FLEET-NEXT-003 stops when nothing survived the wave", () => {
  const decision = planNextWave({
    plan: makePlan(SIX_VARIANTS),
    lastWave: makeWaveResult({ culled: ["v-a", "v-b"] }),
  });
  assert.ok(!decision.proceed && decision.reason === "no_survivors");
});

test("FLEET-NEXT-004 stops when the remaining budget cannot meet the minimum sample per arm", () => {
  const shortBudget = planNextWave({
    plan: makePlan(SIX_VARIANTS),
    lastWave: makeWaveResult({ advanced: ["v-a", "v-b"], sampleBudgetRemaining: 500 }),
  });
  assert.ok(!shortBudget.proceed && shortBudget.reason === "budget_exhausted");
  assert.deepEqual(!shortBudget.proceed ? shortBudget.survivors : [], ["v-a", "v-b"]);

  const overrun = planNextWave({
    plan: makePlan(SIX_VARIANTS),
    lastWave: makeWaveResult({ advanced: ["v-a", "v-b"], sampleBudgetRemaining: -100 }),
  });
  assert.ok(!overrun.proceed && overrun.reason === "budget_exhausted");
});

test("FLEET-NEXT-005 keeps collecting for a lone under-sampled variant instead of declaring convergence", () => {
  const decision = planNextWave({
    plan: makePlan(SIX_VARIANTS),
    lastWave: makeWaveResult({ needsSample: ["v-e"] }),
  });
  assert.ok(decision.proceed);
  assert.deepEqual(decision.activeVariantIds, ["v-e"]);
  // 기준선과 변형 하나가 예산 7350을 나눈다.
  assert.equal(decision.perVariantSampleTarget, 3675);
});

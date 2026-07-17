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
      stopRule: "수렴 후 확정 웨이브 1회 통과 시 종료",
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
  assert.equal(decision.confirmation, false);
  // 승급 변형이 순위 순으로 앞서고, 표본 부족 변형이 뒤따르며 동시 상한 4에서 잘린다.
  assert.deepEqual(decision.activeVariantIds, ["v-a", "v-b", "v-c", "v-e"]);
  // 다음 웨이브는 기준선 1개를 포함한 5개 팔이 예산 7350을 나눈다.
  assert.equal(decision.perVariantSampleTarget, 1470);
});

test("FLEET-NEXT-002 schedules a fresh-sample confirmation wave instead of promoting the lone winner", () => {
  const decision = planNextWave({
    plan: makePlan(SIX_VARIANTS),
    lastWave: makeWaveResult({ advanced: ["v-a"], promotionCandidateId: "v-a" }),
  });
  assert.ok(decision.proceed);
  assert.equal(decision.confirmation, true);
  assert.deepEqual(decision.activeVariantIds, ["v-a"]);
  assert.equal(decision.perVariantSampleTarget, 3675);
});

test("FLEET-NEXT-003 stops when nothing survived the wave", () => {
  const decision = planNextWave({
    plan: makePlan(SIX_VARIANTS),
    lastWave: makeWaveResult({ culled: ["v-a", "v-b"] }),
  });
  assert.ok(!decision.proceed && decision.reason === "no_survivors");
});

test("FLEET-NEXT-004 stops when the holdout-adjusted budget cannot meet the minimum sample per arm", () => {
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

  // holdout 40%는 4,000을 예약한다. 잔여 7,350 중 배분 가능한 3,350을 3개 팔이 나누면 1,116이다.
  const withHoldout = planNextWave({
    plan: makePlan(SIX_VARIANTS, { holdoutShare: 0.4, sampleBudget: 10000 }),
    lastWave: makeWaveResult({ advanced: ["v-a", "v-b"] }),
  });
  assert.ok(withHoldout.proceed);
  assert.equal(withHoldout.perVariantSampleTarget, 1116);
});

test("FLEET-NEXT-005 keeps collecting for a lone under-sampled variant instead of scheduling confirmation", () => {
  const decision = planNextWave({
    plan: makePlan(SIX_VARIANTS),
    lastWave: makeWaveResult({ needsSample: ["v-e"] }),
  });
  assert.ok(decision.proceed);
  assert.equal(decision.confirmation, false);
  assert.deepEqual(decision.activeVariantIds, ["v-e"]);
  assert.equal(decision.perVariantSampleTarget, 3675);
});

test("FLEET-NEXT-006 settles the fleet after a confirmation wave by the promotion-candidate rule", () => {
  const plan = makePlan(SIX_VARIANTS);
  const confirmed = planNextWave({
    plan,
    lastWave: makeWaveResult({ wave: 2, advanced: ["v-a"], promotionCandidateId: "v-a" }),
    lastWaveConfirmation: true,
  });
  assert.ok(!confirmed.proceed && confirmed.reason === "confirmed");
  assert.deepEqual(!confirmed.proceed ? confirmed.survivors : [], ["v-a"]);

  // partial_support로 살아남아도 확정 기준(support + guardrail 미위반)에 못 미치면 강등이다.
  const demoted = planNextWave({
    plan,
    lastWave: makeWaveResult({ wave: 2, advanced: ["v-a"], promotionCandidateId: null }),
    lastWaveConfirmation: true,
  });
  assert.ok(!demoted.proceed && demoted.reason === "confirmation_failed");

  const culledOut = planNextWave({
    plan,
    lastWave: makeWaveResult({ wave: 2, culled: ["v-a"] }),
    lastWaveConfirmation: true,
  });
  assert.ok(!culledOut.proceed && culledOut.reason === "confirmation_failed");

  const recollect = planNextWave({
    plan,
    lastWave: makeWaveResult({ wave: 2, needsSample: ["v-a"] }),
    lastWaveConfirmation: true,
  });
  assert.ok(recollect.proceed && recollect.confirmation === true);
  assert.deepEqual(recollect.activeVariantIds, ["v-a"]);
});

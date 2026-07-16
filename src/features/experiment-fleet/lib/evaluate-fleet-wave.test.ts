import assert from "node:assert/strict";
import test from "node:test";
import type { FleetPlan, FleetVariant, FleetWaveInput } from "../../../entities/fleet/model.ts";
import { evaluateExperiment } from "../../experiment/lib/evaluate-experiment.ts";
import { evaluateFleetWave } from "./evaluate-fleet-wave.ts";
import { FleetValidationError } from "./validate-fleet-plan.ts";

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
      maxActiveVariants: 8,
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

const BASELINE = { converted: 100, total: 1000 };

function makeWave(overrides: Partial<FleetWaveInput>): FleetWaveInput {
  return {
    plan: makePlan(["v-a", "v-b", "v-c", "v-d", "v-e"]),
    wave: 1,
    baseline: BASELINE,
    observations: [],
    sampleUsedBefore: 0,
    ...overrides,
  };
}

test("FLEET-WAVE-001 partitions variants into advance, cull and needs-sample against a shared baseline", () => {
  const result = evaluateFleetWave(makeWave({
    observations: [
      { variantId: "v-a", variant: { converted: 56, total: 400 }, observedDays: 7 },
      { variantId: "v-b", variant: { converted: 52, total: 400 }, observedDays: 7 },
      { variantId: "v-c", variant: { converted: 45, total: 400 }, observedDays: 7 },
      { variantId: "v-d", variant: { converted: 30, total: 400 }, observedDays: 7 },
      { variantId: "v-e", variant: { converted: 10, total: 50 }, observedDays: 7 },
    ],
  }));

  assert.deepEqual(result.advanced, ["v-a", "v-b"]);
  assert.deepEqual(result.culled, ["v-c", "v-d"]);
  assert.deepEqual(result.needsSample, ["v-e"]);
  assert.equal(result.promotionCandidateId, "v-a");

  const byId = new Map(result.outcomes.map((outcome) => [outcome.variantId, outcome]));
  assert.equal(byId.get("v-a")?.rank, 1);
  assert.equal(byId.get("v-c")?.rank, 3);
  assert.equal(byId.get("v-e")?.rank, null);
  assert.equal(byId.get("v-e")?.evaluation.verdict, "insufficient_evidence");

  // 함대 판정은 기존 단일 실험 판정을 변형별로 재사용한다. 수치가 새로 계산되지 않음을 교차 검증한다.
  const single = evaluateExperiment({
    baseline: BASELINE,
    variant: { converted: 56, total: 400 },
    successThresholdPp: 2,
    failureThresholdPp: 0,
    minimumSampleSize: 200,
    plannedDays: 7,
    observedDays: 7,
  });
  assert.deepEqual(byId.get("v-a")?.evaluation, single);
});

test("FLEET-WAVE-002 ranks on raw deltas with sample-size and id tie-breaks", () => {
  const result = evaluateFleetWave(makeWave({
    plan: makePlan(["v-a", "v-b", "v-c"]),
    observations: [
      { variantId: "v-b", variant: { converted: 56, total: 400 }, observedDays: 7 },
      { variantId: "v-a", variant: { converted: 561, total: 4000 }, observedDays: 7 },
      { variantId: "v-c", variant: { converted: 56, total: 400 }, observedDays: 7 },
    ],
  }));

  const byId = new Map(result.outcomes.map((outcome) => [outcome.variantId, outcome]));
  // v-a와 v-b는 표시 delta가 4.0pp로 같지만 원시 delta는 v-a가 4.025pp로 앞선다.
  assert.equal(byId.get("v-a")?.rank, 1);
  // v-b와 v-c는 원시 delta·표본까지 같으므로 ID 사전순으로 고정된다.
  assert.equal(byId.get("v-b")?.rank, 2);
  assert.equal(byId.get("v-c")?.rank, 3);
});

test("FLEET-WAVE-003 culls guardrail violations regardless of delta or sample size", () => {
  const result = evaluateFleetWave(makeWave({
    plan: makePlan(["v-a", "v-b", "v-c"]),
    guardrailBaseline: { converted: 20, total: 1000 },
    observations: [
      { variantId: "v-a", variant: { converted: 80, total: 400 }, guardrailVariant: { converted: 40, total: 400 }, observedDays: 7 },
      { variantId: "v-b", variant: { converted: 52, total: 400 }, guardrailVariant: { converted: 9, total: 400 }, observedDays: 7 },
      { variantId: "v-c", variant: { converted: 12, total: 50 }, guardrailVariant: { converted: 10, total: 50 }, observedDays: 7 },
    ],
  }));

  const byId = new Map(result.outcomes.map((outcome) => [outcome.variantId, outcome]));
  // 최고 delta라도 guardrail 위반이면 컷하고, 표본 부족과 겹쳐도 안전을 우선한다.
  assert.equal(byId.get("v-a")?.action, "cull");
  assert.equal(byId.get("v-a")?.rank, null);
  assert.equal(byId.get("v-c")?.action, "cull");
  assert.deepEqual(result.advanced, ["v-b"]);
  assert.equal(result.promotionCandidateId, "v-b");
});

test("FLEET-WAVE-004 accounts the shared baseline and every variant sample against the budget", () => {
  const observations = [
    { variantId: "v-a", variant: { converted: 56, total: 400 }, observedDays: 7 },
    { variantId: "v-b", variant: { converted: 52, total: 400 }, observedDays: 7 },
  ];
  const first = evaluateFleetWave(makeWave({ plan: makePlan(["v-a", "v-b"]), observations }));
  assert.equal(first.sampleUsed, 1800);
  assert.equal(first.sampleBudgetRemaining, 8200);

  const second = evaluateFleetWave(makeWave({ plan: makePlan(["v-a", "v-b"]), observations, sampleUsedBefore: 9000 }));
  // 예산 초과는 숨기지 않고 음수로 드러낸다.
  assert.equal(second.sampleBudgetRemaining, -800);
});

test("FLEET-WAVE-005 rejects malformed waves before judging anything", () => {
  const base = makeWave({
    plan: makePlan(["v-a", "v-b"]),
    observations: [
      { variantId: "v-a", variant: { converted: 56, total: 400 }, observedDays: 7 },
      { variantId: "v-b", variant: { converted: 52, total: 400 }, observedDays: 7 },
    ],
  });

  assert.throws(() => evaluateFleetWave({ ...base, wave: 0 }), FleetValidationError);
  assert.throws(() => evaluateFleetWave({ ...base, observations: [] }), FleetValidationError);
  assert.throws(
    () => evaluateFleetWave({
      ...base,
      observations: [{ variantId: "v-x", variant: { converted: 1, total: 10 }, observedDays: 7 }],
    }),
    FleetValidationError,
  );
  assert.throws(
    () => evaluateFleetWave({ ...base, observations: [base.observations[0], base.observations[0]] }),
    FleetValidationError,
  );
  assert.throws(
    () => evaluateFleetWave({ ...base, guardrailBaseline: { converted: 20, total: 1000 } }),
    FleetValidationError,
  );
  assert.throws(
    () => evaluateFleetWave({
      ...base,
      observations: [{ variantId: "v-a", variant: { converted: 20, total: 10 }, observedDays: 7 }],
    }),
    /v-a/,
  );
});

test("FLEET-WAVE-006 keeps every judged variant when keep share is 1 and at least one when share is small", () => {
  const everyone = evaluateFleetWave(makeWave({
    plan: makePlan(["v-a", "v-b"], { keepShare: 1 }),
    observations: [
      { variantId: "v-a", variant: { converted: 56, total: 400 }, observedDays: 7 },
      { variantId: "v-b", variant: { converted: 52, total: 400 }, observedDays: 7 },
    ],
  }));
  assert.deepEqual(everyone.advanced, ["v-a", "v-b"]);

  const single = evaluateFleetWave(makeWave({
    plan: makePlan(["v-a", "v-b"], { keepShare: 0.1 }),
    observations: [{ variantId: "v-a", variant: { converted: 56, total: 400 }, observedDays: 7 }],
  }));
  assert.deepEqual(single.advanced, ["v-a"]);
});

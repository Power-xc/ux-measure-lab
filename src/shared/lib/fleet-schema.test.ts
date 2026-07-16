import assert from "node:assert/strict";
import test from "node:test";
import type { FleetPlan, FleetState, FleetWaveObservations } from "../../entities/fleet/model.ts";
import { evaluateFleetWave } from "../../features/experiment-fleet/lib/evaluate-fleet-wave.ts";
import { isFleetState } from "./fleet-schema.ts";

function makePlan(): FleetPlan {
  return {
    id: "fleet-1",
    name: "결제 진입 문구 함대",
    primaryMetricId: "m1",
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
    },
    variants: ["v-a", "v-b"].map((id) => ({
      id,
      name: `변형 ${id}`,
      changeDescription: "결제 진입 문구 변경",
      origin: "ai_candidate" as const,
      relatedEvidenceIds: [],
      status: "active" as const,
    })),
    status: "running",
  };
}

function makeWaveInput(): FleetWaveObservations {
  return {
    wave: 1,
    baseline: { converted: 100, total: 1000 },
    observations: [
      { variantId: "v-a", variant: { converted: 56, total: 400 }, observedDays: 7 },
      { variantId: "v-b", variant: { converted: 52, total: 400 }, observedDays: 7 },
    ],
    sampleUsedBefore: 0,
  };
}

function makeState(): FleetState {
  const plan = makePlan();
  const input = makeWaveInput();
  return {
    plan,
    waves: [{ recordedAt: "2026-07-16T00:00:00.000Z", input, result: evaluateFleetWave({ ...input, plan }) }],
  };
}

test("FLEET-SCHEMA-001 accepts a fleet whose stored verdicts match recomputation", () => {
  assert.equal(isFleetState(makeState()), true);
  assert.equal(isFleetState({ plan: makePlan(), waves: [] }), true);
});

test("FLEET-SCHEMA-002 rejects forged wave results", () => {
  const forgedSample = makeState();
  forgedSample.waves[0].result.sampleUsed += 1;
  assert.equal(isFleetState(forgedSample), false);

  const forgedRank = makeState();
  forgedRank.waves[0].result.outcomes[0].rank = 2;
  assert.equal(isFleetState(forgedRank), false);

  const forgedVerdict = makeState();
  forgedVerdict.waves[0].result.outcomes[0].evaluation.verdict = "not_supported";
  assert.equal(isFleetState(forgedVerdict), false);

  const forgedPromotion = makeState();
  forgedPromotion.waves[0].result.advanced[0] = "v-b";
  assert.equal(isFleetState(forgedPromotion), false);
});

test("FLEET-SCHEMA-003 rejects invalid plans and unregistered observations", () => {
  const badPlan = makeState();
  badPlan.plan.policy.keepShare = 0;
  assert.equal(isFleetState(badPlan), false);

  const unknownVariant = makeState();
  unknownVariant.waves[0].input.observations[0].variantId = "v-x";
  assert.equal(isFleetState(unknownVariant), false);
});

test("FLEET-SCHEMA-004 rejects malformed wave records", () => {
  const badDate = makeState();
  badDate.waves[0].recordedAt = "yesterday";
  assert.equal(isFleetState(badDate), false);

  const badWaveNumber = makeState();
  badWaveNumber.waves[0].input.wave = 0;
  assert.equal(isFleetState(badWaveNumber), false);

  assert.equal(isFleetState({ plan: makePlan(), waves: {} }), false);
  assert.equal(isFleetState(null), false);
});

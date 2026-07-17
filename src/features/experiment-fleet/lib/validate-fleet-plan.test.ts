import assert from "node:assert/strict";
import test from "node:test";
import type { FleetPlan, FleetPolicy, FleetVariant } from "../../../entities/fleet/model.ts";
import { FleetValidationError, validateFleetPlan } from "./validate-fleet-plan.ts";

function makeVariant(id: string): FleetVariant {
  return {
    id,
    name: `변형 ${id}`,
    changeDescription: "CTA 문구를 행동 중심으로 교체",
    origin: "ai_candidate",
    relatedEvidenceIds: ["ev-1"],
    status: "registered",
  };
}

function makePolicy(overrides: Partial<FleetPolicy> = {}): FleetPolicy {
  return {
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
    ...overrides,
  };
}

function makePlan(overrides: Partial<FleetPlan> = {}): FleetPlan {
  return {
    id: "fleet-1",
    name: "결제 진입 문구 함대",
    primaryMetricId: "metric-1",
    policy: makePolicy(),
    variants: [makeVariant("v-a"), makeVariant("v-b"), makeVariant("v-c")],
    status: "draft",
    ...overrides,
  };
}

test("FLEET-PLAN-001 accepts a fully pre-registered fleet plan", () => {
  assert.doesNotThrow(() => validateFleetPlan(makePlan()));
});

test("FLEET-PLAN-002 rejects fleets without at least two unique variants", () => {
  assert.throws(() => validateFleetPlan(makePlan({ variants: [makeVariant("v-a")] })), FleetValidationError);
  assert.throws(
    () => validateFleetPlan(makePlan({ variants: [makeVariant("v-a"), makeVariant("v-a")] })),
    FleetValidationError,
  );
});

test("FLEET-PLAN-003 rejects keep shares outside the (0, 1] interval", () => {
  assert.throws(() => validateFleetPlan(makePlan({ policy: makePolicy({ keepShare: 0 }) })), FleetValidationError);
  assert.throws(() => validateFleetPlan(makePlan({ policy: makePolicy({ keepShare: 1.2 }) })), FleetValidationError);
  assert.doesNotThrow(() => validateFleetPlan(makePlan({ policy: makePolicy({ keepShare: 1 }) })));
});

test("FLEET-PLAN-004 rejects a sample budget that cannot fund the first wave", () => {
  const sixVariants = ["v-a", "v-b", "v-c", "v-d", "v-e", "v-f"].map(makeVariant);
  assert.throws(
    () => validateFleetPlan(makePlan({ variants: sixVariants, policy: makePolicy({ sampleBudget: 999 }) })),
    FleetValidationError,
  );
  assert.doesNotThrow(
    () => validateFleetPlan(makePlan({ variants: sixVariants, policy: makePolicy({ sampleBudget: 1000 }) })),
  );
  // 변형이 상한보다 적으면 실제 첫 웨이브 규모(변형 2 + 기준선 1)만 감당하면 된다.
  assert.doesNotThrow(
    () => validateFleetPlan(
      makePlan({ variants: [makeVariant("v-a"), makeVariant("v-b")], policy: makePolicy({ sampleBudget: 600 }) }),
    ),
  );
});

test("FLEET-PLAN-005 rejects inverted thresholds and negative guardrail allowances", () => {
  assert.throws(
    () => validateFleetPlan(makePlan({ policy: makePolicy({ failureThresholdPp: 3 }) })),
    FleetValidationError,
  );
  assert.throws(
    () => validateFleetPlan(makePlan({ policy: makePolicy({ maxGuardrailIncreasePp: -0.1 }) })),
    FleetValidationError,
  );
  assert.throws(
    () => validateFleetPlan(makePlan({ policy: makePolicy({ successThresholdPp: -1 }) })),
    FleetValidationError,
  );
});

test("FLEET-PLAN-007 validates the holdout share and reserves its budget", () => {
  assert.throws(
    () => validateFleetPlan(makePlan({ policy: makePolicy({ holdoutShare: 0.6 }) })),
    FleetValidationError,
  );
  assert.throws(
    () => validateFleetPlan(makePlan({ policy: makePolicy({ holdoutShare: 0 }) })),
    FleetValidationError,
  );
  // 변형 3 + 기준선 = 800 필요. holdout 0.5는 예산 1500에서 750을 예약해 첫 웨이브를 못 채운다.
  assert.throws(
    () => validateFleetPlan(makePlan({ policy: makePolicy({ holdoutShare: 0.5, sampleBudget: 1500 }) })),
    FleetValidationError,
  );
  assert.doesNotThrow(
    () => validateFleetPlan(makePlan({ policy: makePolicy({ holdoutShare: 0.5, sampleBudget: 1600 }) })),
  );
});

test("FLEET-PLAN-006 rejects blank identity and policy text fields", () => {
  assert.throws(() => validateFleetPlan(makePlan({ primaryMetricId: " " })), FleetValidationError);
  assert.throws(
    () => validateFleetPlan(makePlan({ policy: makePolicy({ stopRule: "" }) })),
    FleetValidationError,
  );
  assert.throws(
    () => validateFleetPlan(makePlan({ policy: makePolicy({ guardrailMetricName: "  " }) })),
    FleetValidationError,
  );
});

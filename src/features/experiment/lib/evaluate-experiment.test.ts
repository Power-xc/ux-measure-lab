import assert from "node:assert/strict";
import test from "node:test";
import { evaluateExperiment, ExperimentValidationError, type ExperimentEvaluationInput } from "./evaluate-experiment.ts";

function experiment(overrides: Partial<ExperimentEvaluationInput> = {}): ExperimentEvaluationInput {
  return {
    baseline: { converted: 200, total: 1000 },
    variant: { converted: 240, total: 1000 },
    successThresholdPp: 3,
    failureThresholdPp: 0,
    minimumSampleSize: 500,
    plannedDays: 14,
    observedDays: 14,
    guardrail: {
      baseline: { converted: 20, total: 1000 },
      variant: { converted: 25, total: 1000 },
      maxIncreasePp: 1,
    },
    ...overrides,
  };
}

test("EXPERIMENT-001 calculates delta, relative change and a supported verdict", () => {
  const result = evaluateExperiment(experiment());

  assert.equal(result.baselineRate, 20);
  assert.equal(result.variantRate, 24);
  assert.equal(result.absoluteDeltaPp, 4);
  assert.equal(result.relativeDeltaPercent, 20);
  assert.equal(result.guardrailOutcome, "pass");
  assert.equal(result.verdict, "support");
});

test("EXPERIMENT-002 treats an exact threshold as met", () => {
  const result = evaluateExperiment(experiment({ variant: { converted: 230, total: 1000 } }));
  assert.equal(result.absoluteDeltaPp, 3);
  assert.equal(result.verdict, "support");
});

test("EXPERIMENT-003 never hides a guardrail violation", () => {
  const result = evaluateExperiment(experiment({
    guardrail: {
      baseline: { converted: 20, total: 1000 },
      variant: { converted: 40, total: 1000 },
      maxIncreasePp: 1,
    },
  }));

  assert.equal(result.guardrailOutcome, "fail");
  assert.equal(result.verdict, "partial_support");
});

test("EXPERIMENT-004 returns insufficient evidence for user-defined sample or duration gaps", () => {
  assert.equal(evaluateExperiment(experiment({ variant: { converted: 20, total: 100 } })).verdict, "insufficient_evidence");
  assert.equal(evaluateExperiment(experiment({ observedDays: 13 })).verdict, "insufficient_evidence");
});

test("EXPERIMENT-005 handles a zero baseline without fabricating relative change", () => {
  const result = evaluateExperiment(experiment({
    baseline: { converted: 0, total: 1000 },
    variant: { converted: 40, total: 1000 },
  }));

  assert.equal(result.absoluteDeltaPp, 4);
  assert.equal(result.relativeDeltaPercent, null);
});

test("EXPERIMENT-006 distinguishes partial and unsupported outcomes", () => {
  assert.equal(evaluateExperiment(experiment({ variant: { converted: 220, total: 1000 } })).verdict, "partial_support");
  assert.equal(evaluateExperiment(experiment({ variant: { converted: 190, total: 1000 } })).verdict, "not_supported");
});

test("EXPERIMENT-007 rejects impossible counts and invalid thresholds", () => {
  const invalid = [
    experiment({ baseline: { converted: 1001, total: 1000 } }),
    experiment({ variant: { converted: -1, total: 1000 } }),
    experiment({ successThresholdPp: -1 }),
    experiment({ failureThresholdPp: 4, successThresholdPp: 3 }),
    experiment({ minimumSampleSize: 0 }),
    experiment({ plannedDays: 0 }),
  ];

  for (const input of invalid) {
    assert.throws(() => evaluateExperiment(input), ExperimentValidationError);
  }
});

test("EXPERIMENT-008 uses unrounded rates at decision boundaries", () => {
  const belowThreshold = evaluateExperiment(experiment({
    baseline: { converted: 0, total: 500 },
    variant: { converted: 15, total: 501 },
  }));
  assert.equal(belowThreshold.absoluteDeltaPp, 3);
  assert.equal(belowThreshold.verdict, "partial_support");

  const aboveThreshold = evaluateExperiment(experiment({
    baseline: { converted: 0, total: 500 },
    variant: { converted: 16, total: 500 },
  }));
  assert.equal(aboveThreshold.verdict, "support");
});

test("EXPERIMENT-009 uses unrounded guardrail rates at the limit", () => {
  const result = evaluateExperiment(experiment({
    guardrail: {
      baseline: { converted: 0, total: 500 },
      variant: { converted: 6, total: 599 },
      maxIncreasePp: 1,
    },
  }));
  assert.equal(result.guardrailDeltaPp, 1);
  assert.equal(result.guardrailOutcome, "fail");
  assert.equal(result.verdict, "partial_support");
});

test("EXPERIMENT-010 tolerates floating-point noise at an exact threshold", () => {
  const result = evaluateExperiment(experiment({
    baseline: { converted: 250, total: 500 },
    variant: { converted: 345, total: 600 },
    successThresholdPp: 7.5,
  }));
  assert.equal(result.absoluteDeltaPp, 7.5);
  assert.equal(result.verdict, "support");
});

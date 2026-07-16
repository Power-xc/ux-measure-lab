import type { ExperimentEvaluation, ExperimentEvaluationInput } from "../../../entities/experiment/model.ts";
import type {
  FleetVariantAction,
  FleetVariantObservation,
  FleetVariantOutcome,
  FleetWaveInput,
  FleetWaveResult,
} from "../../../entities/fleet/model.ts";
import { evaluateExperiment } from "../../experiment/lib/evaluate-experiment.ts";
import { FleetValidationError, validateFleetPlan } from "./validate-fleet-plan.ts";

type EvaluatedVariant = {
  observation: FleetVariantObservation;
  evaluation: ExperimentEvaluation;
  rawDeltaPp: number;
};

function validateWaveShape(input: FleetWaveInput): void {
  if (!Number.isSafeInteger(input.wave) || input.wave <= 0) {
    throw new FleetValidationError("웨이브 번호는 1 이상의 정수여야 합니다.");
  }
  if (!Number.isSafeInteger(input.sampleUsedBefore) || input.sampleUsedBefore < 0) {
    throw new FleetValidationError("사용한 표본은 0 이상의 정수여야 합니다.");
  }
  if (input.observations.length === 0) {
    throw new FleetValidationError("웨이브에는 1개 이상의 변형 관찰이 필요합니다.");
  }
  const registered = new Set(input.plan.variants.map((variant) => variant.id));
  const seen = new Set<string>();
  for (const observation of input.observations) {
    if (!registered.has(observation.variantId)) {
      throw new FleetValidationError(`등록되지 않은 변형입니다: ${observation.variantId}`);
    }
    if (seen.has(observation.variantId)) {
      throw new FleetValidationError(`변형 관찰이 중복되었습니다: ${observation.variantId}`);
    }
    seen.add(observation.variantId);
    // guardrail은 전부 켜거나 전부 끈다. 절반만 측정된 guardrail은 순위를 왜곡한다.
    if (Boolean(input.guardrailBaseline) !== Boolean(observation.guardrailVariant)) {
      throw new FleetValidationError(`변형 ${observation.variantId}의 guardrail 관찰이 기준선과 일치하지 않습니다.`);
    }
  }
}

function buildEvaluationInput(input: FleetWaveInput, observation: FleetVariantObservation): ExperimentEvaluationInput {
  const { policy } = input.plan;
  const guardrail = input.guardrailBaseline && observation.guardrailVariant
    ? { baseline: input.guardrailBaseline, variant: observation.guardrailVariant, maxIncreasePp: policy.maxGuardrailIncreasePp }
    : undefined;
  return {
    baseline: input.baseline,
    variant: observation.variant,
    successThresholdPp: policy.successThresholdPp,
    failureThresholdPp: policy.failureThresholdPp,
    minimumSampleSize: policy.minimumSampleSizePerVariant,
    plannedDays: policy.plannedDaysPerWave,
    observedDays: observation.observedDays,
    guardrail,
  };
}

function evaluateVariant(input: FleetWaveInput, observation: FleetVariantObservation): EvaluatedVariant {
  let evaluation: ExperimentEvaluation;
  try {
    evaluation = evaluateExperiment(buildEvaluationInput(input, observation));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new FleetValidationError(`변형 ${observation.variantId}: ${detail}`);
  }
  // 순위는 반올림 전 원시 delta로 매긴다. 0.1pp 반올림은 대량 변형에서 동률을 양산한다.
  const rawDeltaPp = (observation.variant.converted / observation.variant.total
    - input.baseline.converted / input.baseline.total) * 100;
  return { observation, evaluation, rawDeltaPp };
}

function actionFor(evaluation: ExperimentEvaluation): FleetVariantAction | "rankable" {
  if (evaluation.guardrailOutcome === "fail") return "cull"; // 안전 우선: 표본이 부족해도 guardrail 위반은 컷
  if (evaluation.verdict === "insufficient_evidence") return "needs_sample";
  if (evaluation.verdict === "not_supported") return "cull";
  return "rankable";
}

function compareForRank(a: EvaluatedVariant, b: EvaluatedVariant): number {
  if (a.rawDeltaPp !== b.rawDeltaPp) return b.rawDeltaPp - a.rawDeltaPp;
  if (a.observation.variant.total !== b.observation.variant.total) {
    return b.observation.variant.total - a.observation.variant.total;
  }
  return a.observation.variantId < b.observation.variantId ? -1 : 1;
}

export function evaluateFleetWave(input: FleetWaveInput): FleetWaveResult {
  validateFleetPlan(input.plan);
  validateWaveShape(input);

  const evaluated = input.observations.map((observation) => evaluateVariant(input, observation));
  const rankable = evaluated.filter((item) => actionFor(item.evaluation) === "rankable").sort(compareForRank);
  const keepCount = rankable.length === 0 ? 0 : Math.max(1, Math.ceil(input.plan.policy.keepShare * rankable.length));

  const ranks = new Map<string, number>();
  const actions = new Map<string, FleetVariantAction>();
  rankable.forEach((item, index) => {
    ranks.set(item.observation.variantId, index + 1);
    actions.set(item.observation.variantId, index < keepCount ? "advance" : "cull");
  });
  for (const item of evaluated) {
    const action = actionFor(item.evaluation);
    if (action !== "rankable") actions.set(item.observation.variantId, action);
  }

  const outcomes: FleetVariantOutcome[] = evaluated.map((item) => ({
    variantId: item.observation.variantId,
    evaluation: item.evaluation,
    rank: ranks.get(item.observation.variantId) ?? null,
    action: actions.get(item.observation.variantId) as FleetVariantAction,
  }));

  const top = rankable[0];
  const sampleUsed = input.baseline.total
    + input.observations.reduce((sum, observation) => sum + observation.variant.total, 0);

  return {
    wave: input.wave,
    outcomes,
    advanced: rankable.slice(0, keepCount).map((item) => item.observation.variantId),
    culled: outcomes.filter((outcome) => outcome.action === "cull").map((outcome) => outcome.variantId),
    needsSample: outcomes.filter((outcome) => outcome.action === "needs_sample").map((outcome) => outcome.variantId),
    promotionCandidateId: top && top.evaluation.verdict === "support" ? top.observation.variantId : null,
    sampleUsed,
    sampleBudgetRemaining: input.plan.policy.sampleBudget - input.sampleUsedBefore - sampleUsed,
  };
}

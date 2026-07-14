import type {
  ExperimentEvaluation,
  ExperimentEvaluationInput,
  ExperimentVerdict,
  GuardrailInput,
  GuardrailOutcome,
  RateCount,
} from "../../../entities/experiment/model.ts";

export type { ExperimentEvaluationInput } from "../../../entities/experiment/model.ts";

export class ExperimentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExperimentValidationError";
  }
}

const COMPARISON_EPSILON_PP = 1e-9;

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

function rawRate(count: RateCount): number {
  return (count.converted / count.total) * 100;
}

function atLeast(value: number, threshold: number): boolean {
  return value > threshold || Math.abs(value - threshold) <= COMPARISON_EPSILON_PP;
}

function atMost(value: number, threshold: number): boolean {
  return value < threshold || Math.abs(value - threshold) <= COMPARISON_EPSILON_PP;
}

function validateCount(count: RateCount, label: string): void {
  const safe = Number.isSafeInteger(count.converted) && Number.isSafeInteger(count.total);
  if (!safe || count.total <= 0 || count.converted < 0 || count.converted > count.total) {
    throw new ExperimentValidationError(`${label} 전환 수와 전체 수가 올바르지 않습니다.`);
  }
}

function validateInput(input: ExperimentEvaluationInput): void {
  validateCount(input.baseline, "Baseline");
  validateCount(input.variant, "Variant");
  if (!Number.isFinite(input.successThresholdPp) || input.successThresholdPp < 0) {
    throw new ExperimentValidationError("성공 기준은 0 이상의 숫자여야 합니다.");
  }
  if (!Number.isFinite(input.failureThresholdPp) || input.failureThresholdPp > input.successThresholdPp) {
    throw new ExperimentValidationError("실패 기준은 성공 기준보다 클 수 없습니다.");
  }
  if (!Number.isSafeInteger(input.minimumSampleSize) || input.minimumSampleSize <= 0) {
    throw new ExperimentValidationError("최소 표본은 1 이상의 정수여야 합니다.");
  }
  const daysAreValid = Number.isSafeInteger(input.plannedDays) && input.plannedDays > 0 && Number.isSafeInteger(input.observedDays) && input.observedDays >= 0;
  if (!daysAreValid) throw new ExperimentValidationError("실험 기간은 올바른 정수여야 합니다.");
  if (!input.guardrail) return;
  validateCount(input.guardrail.baseline, "Guardrail baseline");
  validateCount(input.guardrail.variant, "Guardrail variant");
  if (!Number.isFinite(input.guardrail.maxIncreasePp) || input.guardrail.maxIncreasePp < 0) {
    throw new ExperimentValidationError("Guardrail 허용 증가는 0 이상의 숫자여야 합니다.");
  }
}

function evaluateGuardrail(guardrail?: GuardrailInput): Pick<ExperimentEvaluation, "guardrailDeltaPp" | "guardrailOutcome"> {
  if (!guardrail) return { guardrailDeltaPp: null, guardrailOutcome: "not_configured" };
  const rawDelta = rawRate(guardrail.variant) - rawRate(guardrail.baseline);
  return { guardrailDeltaPp: rounded(rawDelta), guardrailOutcome: atMost(rawDelta, guardrail.maxIncreasePp) ? "pass" : "fail" };
}

function verdictFor(input: ExperimentEvaluationInput, delta: number, guardrail: GuardrailOutcome): ExperimentVerdict {
  const enoughSample = input.baseline.total >= input.minimumSampleSize && input.variant.total >= input.minimumSampleSize;
  if (!enoughSample || input.observedDays < input.plannedDays) return "insufficient_evidence";
  if (atLeast(delta, input.successThresholdPp)) return guardrail === "fail" ? "partial_support" : "support";
  if (delta - input.failureThresholdPp > COMPARISON_EPSILON_PP && delta > COMPARISON_EPSILON_PP) return "partial_support";
  return "not_supported";
}

export function evaluateExperiment(input: ExperimentEvaluationInput): ExperimentEvaluation {
  validateInput(input);
  const rawBaselineRate = rawRate(input.baseline);
  const rawVariantRate = rawRate(input.variant);
  const rawDelta = rawVariantRate - rawBaselineRate;
  const baselineRate = rounded(rawBaselineRate);
  const variantRate = rounded(rawVariantRate);
  const absoluteDeltaPp = rounded(rawDelta);
  const relativeDeltaPercent = rawBaselineRate === 0 ? null : rounded((rawDelta / rawBaselineRate) * 100);
  const guardrail = evaluateGuardrail(input.guardrail);

  return {
    baselineRate,
    variantRate,
    absoluteDeltaPp,
    relativeDeltaPercent,
    ...guardrail,
    verdict: verdictFor(input, rawDelta, guardrail.guardrailOutcome),
  };
}

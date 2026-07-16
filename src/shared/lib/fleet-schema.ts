import type { ExperimentEvaluation, RateCount } from "../../entities/experiment/model.ts";
import type {
  FleetPlan,
  FleetState,
  FleetVariantObservation,
  FleetWaveObservations,
  FleetWaveRecord,
  FleetWaveResult,
} from "../../entities/fleet/model.ts";
import { evaluateFleetWave } from "../../features/experiment-fleet/lib/evaluate-fleet-wave.ts";
import { validateFleetPlan } from "../../features/experiment-fleet/lib/validate-fleet-plan.ts";
import { MAX_TEXT_LENGTH } from "./input-policy.ts";

// 백업 JSON 경계의 상한. 도메인 규칙(validateFleetPlan)과 별개로 비정상 크기 입력을 차단한다.
const MAX_VARIANTS = 200;
const MAX_WAVES = 50;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_TEXT_LENGTH;
}

function isRequiredString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isIsoDate(value: unknown): value is string {
  if (!isString(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isEnum<T extends string>(value: unknown, values: readonly T[]): value is T {
  return isString(value) && values.includes(value as T);
}

function isStringArray(value: unknown, limit: number): value is string[] {
  return Array.isArray(value) && value.length <= limit && value.every(isRequiredString);
}

function isRateCount(value: unknown): value is RateCount {
  return isRecord(value)
    && isSafeInteger(value.converted)
    && isSafeInteger(value.total)
    && Number(value.total) > 0
    && Number(value.converted) >= 0
    && Number(value.converted) <= Number(value.total);
}

function isVariant(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isRequiredString(value.id)
    && isRequiredString(value.name)
    && isRequiredString(value.changeDescription)
    && isEnum(value.origin, ["human", "ai_candidate"])
    && isStringArray(value.relatedEvidenceIds, 100)
    && isEnum(value.status, ["registered", "active", "culled", "promoted"]);
}

function isPolicy(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isFiniteNumber(value.successThresholdPp)
    && isFiniteNumber(value.failureThresholdPp)
    && isSafeInteger(value.minimumSampleSizePerVariant)
    && isSafeInteger(value.plannedDaysPerWave)
    && isSafeInteger(value.maxActiveVariants)
    && isFiniteNumber(value.keepShare)
    && isSafeInteger(value.sampleBudget)
    && isRequiredString(value.guardrailMetricName)
    && isFiniteNumber(value.maxGuardrailIncreasePp)
    && isRequiredString(value.stopRule);
}

function isPlan(value: unknown): value is FleetPlan {
  if (!isRecord(value) || !isPolicy(value.policy)) return false;
  if (!Array.isArray(value.variants) || value.variants.length > MAX_VARIANTS || !value.variants.every(isVariant)) return false;
  if (!(isRequiredString(value.id)
    && isRequiredString(value.name)
    && isRequiredString(value.primaryMetricId)
    && isEnum(value.status, ["draft", "ready", "running", "completed", "decided"]))) return false;
  try {
    validateFleetPlan(value as unknown as FleetPlan);
    return true;
  } catch {
    return false;
  }
}

function isObservation(value: unknown): value is FleetVariantObservation {
  if (!isRecord(value)) return false;
  return isRequiredString(value.variantId)
    && isRateCount(value.variant)
    && (value.guardrailVariant === undefined || isRateCount(value.guardrailVariant))
    && isSafeInteger(value.observedDays)
    && Number(value.observedDays) >= 0;
}

function isWaveObservations(value: unknown): value is FleetWaveObservations {
  if (!isRecord(value)) return false;
  return isSafeInteger(value.wave)
    && Number(value.wave) >= 1
    && isRateCount(value.baseline)
    && (value.guardrailBaseline === undefined || isRateCount(value.guardrailBaseline))
    && Array.isArray(value.observations)
    && value.observations.length <= MAX_VARIANTS
    && value.observations.every(isObservation)
    && isSafeInteger(value.sampleUsedBefore)
    && Number(value.sampleUsedBefore) >= 0;
}

function evaluationsMatch(left: ExperimentEvaluation, right: ExperimentEvaluation): boolean {
  return left.baselineRate === right.baselineRate
    && left.variantRate === right.variantRate
    && left.absoluteDeltaPp === right.absoluteDeltaPp
    && left.relativeDeltaPercent === right.relativeDeltaPercent
    && left.guardrailDeltaPp === right.guardrailDeltaPp
    && left.guardrailOutcome === right.guardrailOutcome
    && left.verdict === right.verdict;
}

function sameIds(left: readonly string[], right: unknown): boolean {
  return Array.isArray(right) && left.length === right.length && left.every((value, index) => value === right[index]);
}

// 저장된 판정을 그대로 믿지 않는다. 입력으로 재계산한 결과와 정확히 일치해야 통과한다.
function resultMatchesRecomputation(recomputed: FleetWaveResult, stored: unknown): boolean {
  if (!isRecord(stored)) return false;
  const storedOutcomes: unknown = stored.outcomes;
  if (!Array.isArray(storedOutcomes)) return false;
  if (stored.wave !== recomputed.wave
    || stored.promotionCandidateId !== recomputed.promotionCandidateId
    || stored.sampleUsed !== recomputed.sampleUsed
    || stored.sampleBudgetRemaining !== recomputed.sampleBudgetRemaining) return false;
  if (!sameIds(recomputed.advanced, stored.advanced)
    || !sameIds(recomputed.culled, stored.culled)
    || !sameIds(recomputed.needsSample, stored.needsSample)
    || !sameIds(recomputed.exposureWarnings, stored.exposureWarnings)) return false;
  if (storedOutcomes.length !== recomputed.outcomes.length) return false;
  return recomputed.outcomes.every((outcome, index) => {
    const candidate: unknown = storedOutcomes[index];
    return isRecord(candidate)
      && candidate.variantId === outcome.variantId
      && candidate.rank === outcome.rank
      && candidate.action === outcome.action
      && isRecord(candidate.evaluation)
      && evaluationsMatch(outcome.evaluation, candidate.evaluation as ExperimentEvaluation);
  });
}

function isWaveRecord(plan: FleetPlan, value: unknown): value is FleetWaveRecord {
  if (!isRecord(value) || !isIsoDate(value.recordedAt) || !isWaveObservations(value.input)) return false;
  try {
    return resultMatchesRecomputation(evaluateFleetWave({ ...value.input, plan }), value.result);
  } catch {
    return false;
  }
}

export function isFleetState(value: unknown): value is FleetState {
  if (!isRecord(value) || !isPlan(value.plan)) return false;
  if (!Array.isArray(value.waves) || value.waves.length > MAX_WAVES) return false;
  return value.waves.every((wave) => isWaveRecord(value.plan as FleetPlan, wave));
}

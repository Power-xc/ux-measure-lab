import type { Decision } from "../../entities/decision/model.ts";
import type { ExperimentEvaluation, ExperimentEvaluationInput, ExperimentPlan, ExperimentResult, RateCount } from "../../entities/experiment/model.ts";
import { evaluateExperiment } from "../../features/experiment/lib/evaluate-experiment.ts";
import { analyzeFunnel } from "../../features/measure-loop/lib/calculate-funnel.ts";
import { validateExperimentPlan } from "../../features/project-workflow/lib/project-workflow.ts";
import { MAX_TEXT_LENGTH, validateProductUrl } from "./input-policy.ts";
import { isProjectStateConsistent } from "./project-invariants.ts";
import {
  CONFIDENCE_LEVELS,
  SOURCE_CAPABILITIES,
  WORKSPACE_SCHEMA_VERSION,
  type Evidence,
  type EvidenceSourceRef,
  type FrictionCandidate,
  type FunnelImport,
  type Hypothesis,
  type MetricDefinition,
  type Project,
  type ProjectContext,
  type WorkspaceState,
} from "../../entities/project/model.ts";

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

function isIsoDate(value: unknown): value is string {
  if (!isString(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isPublicWebUrl(value: unknown): value is string {
  return isString(value) && validateProductUrl(value).ok;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isNullable<T>(value: unknown, predicate: (item: unknown) => item is T): value is T | null {
  return value === null || predicate(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 100 && value.every(isRequiredString);
}

function isEnum<T extends string>(value: unknown, values: readonly T[]): value is T {
  return isString(value) && values.includes(value as T);
}

function isContext(value: unknown): value is ProjectContext {
  if (!isRecord(value)) return false;
  return isRequiredString(value.productName)
    && isPublicWebUrl(value.productUrl)
    && isEnum(value.productStage, ["idea", "alpha", "beta", "live", "growth"])
    && isString(value.audience)
    && isString(value.valueAction)
    && isString(value.goal);
}

function isMetric(value: unknown): value is MetricDefinition {
  if (!isRecord(value)) return false;
  return isRequiredString(value.id)
    && isRequiredString(value.name)
    && isRequiredString(value.definition)
    && isRequiredString(value.formula)
    && isRequiredString(value.window)
    && isEnum(value.sourceKind, ["measured", "calculated", "benchmark", "assumed", "inferred", "qualitative"])
    && isEnum(value.status, ["draft", "confirmed"]);
}

function isFunnelImport(value: unknown): value is FunnelImport {
  if (!isRecord(value) || !Array.isArray(value.steps) || value.steps.length < 2 || value.steps.length > 100) return false;
  const validSteps = value.steps.every((step) => isRecord(step)
    && isRequiredString(step.id)
    && isRequiredString(step.label)
    && isSafeInteger(step.users)
    && Number(step.users) >= 0);
  if (!validSteps) return false;
  try {
    analyzeFunnel(value.steps);
  } catch {
    return false;
  }
  return isRequiredString(value.fileName)
    && isEnum(value.source, ["csv", "sample", "adapter"])
    && isIsoDate(value.importedAt);
}

// 구조·타입만 검증한다. sampleSize > 0 같은 도메인 규칙은 project-invariants가 강제한다.
function isSourceRef(value: unknown): value is EvidenceSourceRef {
  if (!isRecord(value)) return false;
  return isRequiredString(value.adapterId)
    && isEnum(value.capability, SOURCE_CAPABILITIES)
    && isRequiredString(value.queryHash)
    && isSafeInteger(value.sampleSize)
    && isEnum(value.confidence, CONFIDENCE_LEVELS);
}

function isEvidence(value: unknown): value is Evidence {
  if (!isRecord(value) || !isRecord(value.provenance)) return false;
  return isRequiredString(value.id)
    && isEnum(value.sourceKind, ["measured", "calculated", "benchmark", "assumed", "inferred", "qualitative"])
    && isEnum(value.direction, ["supports", "contradicts", "context"])
    && isRequiredString(value.observation)
    && isRequiredString(value.detail)
    && isRequiredString(value.provenance.source)
    && isIsoDate(value.provenance.observedAt)
    && isRequiredString(value.provenance.period)
    && isRequiredString(value.provenance.segment)
    && (value.sourceRef === undefined || isSourceRef(value.sourceRef));
}

function isFriction(value: unknown): value is FrictionCandidate {
  if (!isRecord(value)) return false;
  return isRequiredString(value.phenomenon)
    && isStringArray(value.relatedEvidenceIds)
    && isStringArray(value.possibleCauses)
    && isEnum(value.strength, ["low", "medium", "high"])
    && isRequiredString(value.strengthRationale)
    && isRequiredString(value.missingEvidence)
    && isRequiredString(value.recommendedValidation);
}

function isHypothesis(value: unknown): value is Hypothesis {
  if (!isRecord(value)) return false;
  return isRequiredString(value.id)
    && isRequiredString(value.observation)
    && isRequiredString(value.change)
    && isRequiredString(value.expectedBehavior)
    && isRequiredString(value.primaryMetricId)
    && isRequiredString(value.guardrailMetric)
    && isRequiredString(value.alternativeExplanation)
    && isRequiredString(value.missingEvidence)
    && isStringArray(value.evidenceIds)
    && isEnum(value.status, ["draft", "ready"]);
}

function isExperiment(value: unknown): value is ExperimentPlan {
  if (!isRecord(value)) return false;
  if (!(isRequiredString(value.id)
    && isRequiredString(value.hypothesisId)
    && isRequiredString(value.primaryMetricId)
    && isFiniteNumber(value.successThresholdPp)
    && isFiniteNumber(value.failureThresholdPp)
    && isSafeInteger(value.minimumSampleSize)
    && isSafeInteger(value.plannedDays)
    && isRequiredString(value.guardrailMetricName)
    && isFiniteNumber(value.maxGuardrailIncreasePp)
    && isRequiredString(value.stopRule)
    && isEnum(value.status, ["draft", "ready", "completed", "decided"]))) return false;
  const plan: ExperimentPlan = {
    id: value.id,
    hypothesisId: value.hypothesisId,
    primaryMetricId: value.primaryMetricId,
    successThresholdPp: value.successThresholdPp,
    failureThresholdPp: value.failureThresholdPp,
    minimumSampleSize: value.minimumSampleSize,
    plannedDays: value.plannedDays,
    guardrailMetricName: value.guardrailMetricName,
    maxGuardrailIncreasePp: value.maxGuardrailIncreasePp,
    stopRule: value.stopRule,
    status: value.status,
  };
  return validateExperimentPlan(plan).ok;
}

function isRateCount(value: unknown): value is RateCount {
  return isRecord(value)
    && isSafeInteger(value.converted)
    && isSafeInteger(value.total)
    && Number(value.total) > 0
    && Number(value.converted) >= 0
    && Number(value.converted) <= Number(value.total);
}

function isEvaluationInput(value: unknown): value is ExperimentEvaluationInput {
  if (!isRecord(value) || !isRateCount(value.baseline) || !isRateCount(value.variant)) return false;
  const validGuardrail = value.guardrail === undefined || (isRecord(value.guardrail)
    && isRateCount(value.guardrail.baseline)
    && isRateCount(value.guardrail.variant)
    && isFiniteNumber(value.guardrail.maxIncreasePp));
  return isFiniteNumber(value.successThresholdPp)
    && isFiniteNumber(value.failureThresholdPp)
    && isSafeInteger(value.minimumSampleSize)
    && isSafeInteger(value.plannedDays)
    && isSafeInteger(value.observedDays)
    && Number(value.minimumSampleSize) > 0
    && Number(value.plannedDays) > 0
    && Number(value.observedDays) >= 0
    && Number(value.successThresholdPp) >= 0
    && Number(value.failureThresholdPp) <= Number(value.successThresholdPp)
    && validGuardrail;
}

function isEvaluation(value: unknown): value is ExperimentEvaluation {
  if (!isRecord(value)) return false;
  return isFiniteNumber(value.baselineRate)
    && isFiniteNumber(value.variantRate)
    && isFiniteNumber(value.absoluteDeltaPp)
    && (value.relativeDeltaPercent === null || isFiniteNumber(value.relativeDeltaPercent))
    && (value.guardrailDeltaPp === null || isFiniteNumber(value.guardrailDeltaPp))
    && isEnum(value.guardrailOutcome, ["pass", "fail", "not_configured"])
    && isEnum(value.verdict, ["support", "partial_support", "not_supported", "insufficient_evidence"]);
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

function isResult(value: unknown): value is ExperimentResult {
  if (!isRecord(value) || !isIsoDate(value.recordedAt) || !isEvaluationInput(value.input) || !isEvaluation(value.evaluation)) return false;
  try {
    return evaluationsMatch(evaluateExperiment(value.input), value.evaluation);
  } catch {
    return false;
  }
}

function isDecision(value: unknown): value is Decision {
  if (!isRecord(value)) return false;
  return isRequiredString(value.id)
    && isEnum(value.verdict, ["support", "partial_support", "not_supported", "insufficient_evidence"])
    && isRequiredString(value.aiRecommendation)
    && isEnum(value.humanDecision, ["adopt", "iterate", "stop", "collect_more_data"])
    && isRequiredString(value.rationale)
    && isRequiredString(value.nextAction)
    && isStringArray(value.evidenceIds)
    && isIsoDate(value.decidedAt);
}

function isProject(value: unknown): value is Project {
  if (!isRecord(value)) return false;
  return isRequiredString(value.id)
    && isRequiredString(value.name)
    && isIsoDate(value.createdAt)
    && isIsoDate(value.updatedAt)
    && isContext(value.context)
    && isNullable(value.metric, isMetric)
    && isNullable(value.funnelImport, isFunnelImport)
    && Array.isArray(value.evidence)
    && value.evidence.every(isEvidence)
    && isNullable(value.frictionCandidate, isFriction)
    && isNullable(value.hypothesis, isHypothesis)
    && isNullable(value.experiment, isExperiment)
    && isNullable(value.experimentResult, isResult)
    && isNullable(value.decision, isDecision);
}

export function isWorkspaceState(value: unknown): value is WorkspaceState {
  if (!isRecord(value) || value.schemaVersion !== WORKSPACE_SCHEMA_VERSION || !Array.isArray(value.projects)) return false;
  if (!(value.activeProjectId === null || isString(value.activeProjectId))) return false;
  if (!value.projects.every(isProject) || !value.projects.every(isProjectStateConsistent)) return false;
  const ids = value.projects.map((project) => project.id);
  if (new Set(ids).size !== ids.length) return false;
  return value.activeProjectId === null ? ids.length === 0 : ids.includes(value.activeProjectId);
}

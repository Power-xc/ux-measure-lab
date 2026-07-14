import type { ExperimentEvaluationInput, ExperimentPlan } from "../../entities/experiment/model.ts";
import { CONFIDENCE_LEVELS, SOURCE_CAPABILITIES, type Evidence, type Project } from "../../entities/project/model.ts";

function hasReferences(ids: readonly string[], available: ReadonlySet<string>): boolean {
  return ids.every((id) => available.has(id));
}

// sourceRef가 붙은 Evidence의 도메인 규칙: 실제 표본이 있어야 하고 어휘가 유효해야 한다.
function hasValidSourceRef(evidence: Evidence): boolean {
  const ref = evidence.sourceRef;
  if (!ref) return true;
  return ref.sampleSize > 0 && SOURCE_CAPABILITIES.includes(ref.capability) && CONFIDENCE_LEVELS.includes(ref.confidence);
}

function inputMatchesPlan(input: ExperimentEvaluationInput, plan: ExperimentPlan): boolean {
  return input.successThresholdPp === plan.successThresholdPp
    && input.failureThresholdPp === plan.failureThresholdPp
    && input.minimumSampleSize === plan.minimumSampleSize
    && input.plannedDays === plan.plannedDays
    && input.guardrail?.maxIncreasePp === plan.maxGuardrailIncreasePp;
}

export function isProjectStateConsistent(project: Project): boolean {
  if (Date.parse(project.updatedAt) < Date.parse(project.createdAt)) return false;
  const contextReady = [project.context.productName, project.context.audience, project.context.valueAction, project.context.goal]
    .every((value) => value.trim().length > 0);
  const evidenceIds = project.evidence.map((item) => item.id);
  if (new Set(evidenceIds).size !== evidenceIds.length) return false;
  if (!project.evidence.every(hasValidSourceRef)) return false;
  const availableEvidence = new Set(evidenceIds);

  if (project.metric && !contextReady) return false;
  if (project.funnelImport && project.metric?.status !== "confirmed") return false;
  if (project.evidence.length > 0 && (!project.funnelImport || project.metric?.status !== "confirmed")) return false;
  if (project.frictionCandidate) {
    if (!project.funnelImport || project.metric?.status !== "confirmed" || project.frictionCandidate.relatedEvidenceIds.length === 0) return false;
    if (!hasReferences(project.frictionCandidate.relatedEvidenceIds, availableEvidence)) return false;
  } else if (project.evidence.some((evidence) => !evidence.sourceRef)) return false;

  if (project.hypothesis) {
    if (!project.frictionCandidate || !project.metric || project.hypothesis.primaryMetricId !== project.metric.id || project.hypothesis.evidenceIds.length === 0) return false;
    if (!hasReferences(project.hypothesis.evidenceIds, availableEvidence)) return false;
  }

  if (project.experiment) {
    if (!project.hypothesis || project.hypothesis.status !== "ready" || !project.metric) return false;
    if (project.experiment.hypothesisId !== project.hypothesis.id || project.experiment.primaryMetricId !== project.metric.id) return false;
  }

  if (project.experimentResult) {
    if (!project.experiment || !["completed", "decided"].includes(project.experiment.status)) return false;
    if (!inputMatchesPlan(project.experimentResult.input, project.experiment)) return false;
  } else if (project.experiment && ["completed", "decided"].includes(project.experiment.status)) return false;

  if (project.decision) {
    if (!project.experimentResult || project.experiment?.status !== "decided") return false;
    if (project.decision.verdict !== project.experimentResult.evaluation.verdict) return false;
    if (project.decision.evidenceIds.length === 0 || !hasReferences(project.decision.evidenceIds, availableEvidence)) return false;
  } else if (project.experiment?.status === "decided") return false;

  return true;
}

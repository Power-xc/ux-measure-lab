import type { Decision } from "../../../entities/decision/model.ts";
import type { ExperimentPlan, ExperimentResult, GuardrailInput, RateCount } from "../../../entities/experiment/model.ts";
import type { FunnelImport, Hypothesis, MetricDefinition, Project, ProjectContext } from "../../../entities/project/model.ts";

function sameRateCount(left: RateCount, right: RateCount): boolean {
  return left.converted === right.converted && left.total === right.total;
}

function sameGuardrail(left: GuardrailInput | undefined, right: GuardrailInput | undefined): boolean {
  if (!left || !right) return left === right;
  return sameRateCount(left.baseline, right.baseline)
    && sameRateCount(left.variant, right.variant)
    && left.maxIncreasePp === right.maxIncreasePp;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function contextChanged(left: ProjectContext, right: ProjectContext): boolean {
  return left.productName !== right.productName
    || left.productUrl !== right.productUrl
    || left.productStage !== right.productStage
    || left.audience !== right.audience
    || left.valueAction !== right.valueAction
    || left.goal !== right.goal;
}

export function metricChanged(left: MetricDefinition | null, right: MetricDefinition): boolean {
  return !left
    || left.name !== right.name
    || left.definition !== right.definition
    || left.formula !== right.formula
    || left.window !== right.window
    || left.sourceKind !== right.sourceKind;
}

export function funnelChanged(left: FunnelImport | null, right: FunnelImport): boolean {
  if (!left || left.fileName !== right.fileName || left.source !== right.source || left.steps.length !== right.steps.length) return true;
  return left.steps.some((step, index) => {
    const next = right.steps[index];
    return !next || step.id !== next.id || step.label !== next.label || step.users !== next.users;
  });
}

export function hypothesisChanged(left: Hypothesis | null, right: Hypothesis): boolean {
  return !left
    || left.observation !== right.observation
    || left.change !== right.change
    || left.expectedBehavior !== right.expectedBehavior
    || left.primaryMetricId !== right.primaryMetricId
    || left.guardrailMetric !== right.guardrailMetric
    || left.alternativeExplanation !== right.alternativeExplanation
    || left.missingEvidence !== right.missingEvidence
    || !sameStrings(left.evidenceIds, right.evidenceIds);
}

export function experimentChanged(left: ExperimentPlan | null, right: ExperimentPlan): boolean {
  return !left
    || left.hypothesisId !== right.hypothesisId
    || left.primaryMetricId !== right.primaryMetricId
    || left.successThresholdPp !== right.successThresholdPp
    || left.failureThresholdPp !== right.failureThresholdPp
    || left.minimumSampleSize !== right.minimumSampleSize
    || left.plannedDays !== right.plannedDays
    || left.guardrailMetricName !== right.guardrailMetricName
    || left.maxGuardrailIncreasePp !== right.maxGuardrailIncreasePp
    || left.stopRule !== right.stopRule;
}

export function resultChanged(left: ExperimentResult | null, right: ExperimentResult): boolean {
  if (!left) return true;
  const a = left.input;
  const b = right.input;
  return !sameRateCount(a.baseline, b.baseline)
    || !sameRateCount(a.variant, b.variant)
    || a.successThresholdPp !== b.successThresholdPp
    || a.failureThresholdPp !== b.failureThresholdPp
    || a.minimumSampleSize !== b.minimumSampleSize
    || a.plannedDays !== b.plannedDays
    || a.observedDays !== b.observedDays
    || !sameGuardrail(a.guardrail, b.guardrail);
}

function touch(project: Project, now: string, patch: Partial<Project>): Project {
  return { ...project, ...patch, updatedAt: now };
}

export function applyContext(project: Project, context: ProjectContext, now: string): Project {
  const base = { context, name: context.productName.trim() || project.name };
  if (!contextChanged(project.context, context)) return touch(project, now, base);
  return touch(project, now, {
    ...base,
    metric: null,
    funnelImport: null,
    evidence: [],
    frictionCandidate: null,
    hypothesis: null,
    experiment: null,
    experimentResult: null,
    decision: null,
  });
}

export function applyMetric(project: Project, metric: MetricDefinition, now: string): Project {
  if (!metricChanged(project.metric, metric)) return touch(project, now, { metric });
  return touch(project, now, { metric, evidence: [], frictionCandidate: null, hypothesis: null, experiment: null, experimentResult: null, decision: null });
}

export function applyFunnel(project: Project, funnelImport: FunnelImport, now: string): Project {
  if (!funnelChanged(project.funnelImport, funnelImport)) return touch(project, now, { funnelImport });
  return touch(project, now, { funnelImport, evidence: [], frictionCandidate: null, hypothesis: null, experiment: null, experimentResult: null, decision: null });
}

export function applyHypothesis(project: Project, hypothesis: Hypothesis, now: string): Project {
  if (!hypothesisChanged(project.hypothesis, hypothesis)) return touch(project, now, { hypothesis });
  return touch(project, now, { hypothesis, experiment: null, experimentResult: null, decision: null });
}

export function applyExperiment(project: Project, experiment: ExperimentPlan, now: string): Project {
  if (!experimentChanged(project.experiment, experiment)) return touch(project, now, { experiment: project.experiment ?? experiment });
  return touch(project, now, { experiment, experimentResult: null, decision: null });
}

export function applyResult(project: Project, result: ExperimentResult, now: string): Project {
  if (!resultChanged(project.experimentResult, result)) return touch(project, now, { experimentResult: project.experimentResult ?? result });
  return touch(project, now, {
    experimentResult: result,
    decision: null,
    experiment: project.experiment ? { ...project.experiment, status: "completed" } : null,
  });
}

export function applyDecision(project: Project, decision: Decision, now: string): Project {
  return touch(project, now, {
    decision,
    experiment: project.experiment ? { ...project.experiment, status: "decided" } : null,
  });
}

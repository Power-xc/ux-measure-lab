import type { ExperimentPlan } from "../../../entities/experiment/model.ts";
import type { Project } from "../../../entities/project/model.ts";

export const WORKFLOW_SECTIONS = ["context", "metric", "funnel", "diagnosis", "hypothesis", "experiment", "result", "decision"] as const;
export type WorkflowSection = typeof WORKFLOW_SECTIONS[number];

export type ProjectProgress = {
  completed: number;
  total: number;
  sections: Record<WorkflowSection, boolean>;
};

export type ValidationResult =
  | { ok: true; errors: [] }
  | { ok: false; errors: string[] };

function hasText(value: string): boolean {
  return value.trim().length > 0;
}

export function validateExperimentPlan(plan: ExperimentPlan): ValidationResult {
  const errors: string[] = [];
  if (!hasText(plan.primaryMetricId)) errors.push("Primary metric을 선택하세요.");
  if (!Number.isFinite(plan.successThresholdPp) || plan.successThresholdPp < 0) errors.push("성공 기준을 입력하세요.");
  if (!Number.isFinite(plan.failureThresholdPp) || plan.failureThresholdPp > plan.successThresholdPp) errors.push("실패 기준을 확인하세요.");
  if (!Number.isSafeInteger(plan.minimumSampleSize) || plan.minimumSampleSize <= 0) errors.push("최소 표본을 입력하세요.");
  if (!Number.isSafeInteger(plan.plannedDays) || plan.plannedDays <= 0) errors.push("실험 기간을 입력하세요.");
  if (!hasText(plan.guardrailMetricName)) errors.push("Guardrail metric을 입력하세요.");
  if (!Number.isFinite(plan.maxGuardrailIncreasePp) || plan.maxGuardrailIncreasePp < 0) errors.push("Guardrail 허용 범위를 입력하세요.");
  if (!hasText(plan.stopRule)) errors.push("종료 규칙을 입력하세요.");
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

export function getProjectProgress(project: Project): ProjectProgress {
  const context = project.context;
  const sections: Record<WorkflowSection, boolean> = {
    context: [context.productName, context.audience, context.valueAction, context.goal].every(hasText),
    metric: project.metric?.status === "confirmed",
    funnel: project.funnelImport !== null,
    diagnosis: project.frictionCandidate !== null && project.evidence.length > 0,
    hypothesis: project.hypothesis?.status === "ready",
    experiment: project.experiment !== null && project.experiment.status !== "draft" && validateExperimentPlan(project.experiment).ok,
    result: project.experimentResult !== null,
    decision: project.decision !== null,
  };
  return {
    completed: Object.values(sections).filter(Boolean).length,
    total: WORKFLOW_SECTIONS.length,
    sections,
  };
}

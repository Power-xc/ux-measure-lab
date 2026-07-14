import type { Decision } from "../decision/model.ts";
import type { ExperimentPlan, ExperimentResult } from "../experiment/model.ts";
import type { FunnelStep } from "../measurement/model.ts";

export const WORKSPACE_SCHEMA_VERSION = 1 as const;

export type ProductStage = "idea" | "alpha" | "beta" | "live" | "growth";
export type SourceKind = "measured" | "calculated" | "benchmark" | "assumed" | "inferred" | "qualitative";
export type EvidenceDirection = "supports" | "contradicts" | "context";

export type ProjectContext = {
  productName: string;
  productUrl: string;
  productStage: ProductStage;
  audience: string;
  valueAction: string;
  goal: string;
};

export type MetricDefinition = {
  id: string;
  name: string;
  definition: string;
  formula: string;
  window: string;
  sourceKind: SourceKind;
  status: "draft" | "confirmed";
};

export type FunnelImport = {
  fileName: string;
  source: "csv" | "sample";
  importedAt: string;
  steps: FunnelStep[];
};

export type Evidence = {
  id: string;
  sourceKind: SourceKind;
  direction: EvidenceDirection;
  observation: string;
  detail: string;
  provenance: {
    source: string;
    observedAt: string;
    period: string;
    segment: string;
  };
};

export type FrictionCandidate = {
  phenomenon: string;
  relatedEvidenceIds: string[];
  possibleCauses: string[];
  strength: "low" | "medium" | "high";
  strengthRationale: string;
  missingEvidence: string;
  recommendedValidation: string;
};

export type Hypothesis = {
  id: string;
  observation: string;
  change: string;
  expectedBehavior: string;
  primaryMetricId: string;
  guardrailMetric: string;
  alternativeExplanation: string;
  missingEvidence: string;
  evidenceIds: string[];
  status: "draft" | "ready";
};

export type Project = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  context: ProjectContext;
  metric: MetricDefinition | null;
  funnelImport: FunnelImport | null;
  evidence: Evidence[];
  frictionCandidate: FrictionCandidate | null;
  hypothesis: Hypothesis | null;
  experiment: ExperimentPlan | null;
  experimentResult: ExperimentResult | null;
  decision: Decision | null;
};

export type WorkspaceState = {
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  activeProjectId: string | null;
  projects: Project[];
};

export type CreateProjectInput = {
  id: string;
  name: string;
  now: string;
  context: ProjectContext;
};

export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectValidationError";
  }
}

export function createProject(workspace: WorkspaceState, input: CreateProjectInput): WorkspaceState {
  if (!input.id.trim() || !input.name.trim()) throw new ProjectValidationError("프로젝트 ID와 이름은 필수입니다.");
  if (workspace.projects.some((project) => project.id === input.id)) throw new ProjectValidationError("프로젝트 ID는 중복될 수 없습니다.");
  const project: Project = {
    id: input.id,
    name: input.name.trim(),
    createdAt: input.now,
    updatedAt: input.now,
    context: input.context,
    metric: null,
    funnelImport: null,
    evidence: [],
    frictionCandidate: null,
    hypothesis: null,
    experiment: null,
    experimentResult: null,
    decision: null,
  };
  return { ...workspace, activeProjectId: project.id, projects: [...workspace.projects, project] };
}

export function deleteProject(workspace: WorkspaceState, projectId: string): WorkspaceState {
  const projects = workspace.projects.filter((project) => project.id !== projectId);
  const activeProjectId = workspace.activeProjectId === projectId ? projects[0]?.id ?? null : workspace.activeProjectId;
  return { ...workspace, activeProjectId, projects };
}

export function replaceProject(workspace: WorkspaceState, projectId: string, project: Project): WorkspaceState {
  if (project.id !== projectId) throw new ProjectValidationError("프로젝트 ID는 변경할 수 없습니다.");
  if (!workspace.projects.some((item) => item.id === projectId)) throw new ProjectValidationError("수정할 프로젝트를 찾을 수 없습니다.");
  return { ...workspace, projects: workspace.projects.map((item) => item.id === projectId ? project : item) };
}

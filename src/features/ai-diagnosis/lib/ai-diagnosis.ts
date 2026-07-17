import type { EvidenceDirection, ProductStage, Project, SourceKind } from "../../../entities/project/model.ts";

export type AiSuggestionRequestV1 = {
  schemaVersion: 1;
  task: "diagnosis_hypothesis";
  context: {
    productName: string;
    productStage: ProductStage;
    audience: string;
    valueAction: string;
    goal: string;
  };
  metric: {
    id: string;
    name: string;
    definition: string;
    window: string;
  };
  evidence: Array<{
    id: string;
    sourceKind: SourceKind;
    direction: EvidenceDirection;
    observation: string;
    detail: string;
  }>;
  draft: {
    phenomenon: string;
    possibleCauses: string[];
    hypothesisChange: string;
    expectedBehavior: string;
    alternativeExplanation: string;
    missingEvidence: string;
    recommendedValidation: string;
    evidenceIds: string[];
  };
};

export type ModelCauseSuggestion = {
  statement: string;
  evidenceIds: string[];
};

export type AiDiagnosisSuggestion = {
  summary: string;
  possibleCauses: ModelCauseSuggestion[];
  hypothesisChange: string;
  expectedBehavior: string;
  alternativeExplanation: string;
  missingEvidence: string;
  recommendedValidation: string;
  evidenceIds: string[];
};

export type AiFallbackReason = "not_configured" | "timeout" | "provider_error" | "invalid_output";

export type AiDiagnosisResult =
  | { source: "model"; fallbackReason: null; suggestion: AiDiagnosisSuggestion }
  | { source: "deterministic"; fallbackReason: AiFallbackReason; suggestion: AiDiagnosisSuggestion };

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

const PRODUCT_STAGES: ProductStage[] = ["idea", "alpha", "beta", "live", "growth"];
const SOURCE_KINDS: SourceKind[] = ["measured", "calculated", "benchmark", "assumed", "inferred", "qualitative"];
const DIRECTIONS: EvidenceDirection[] = ["supports", "contradicts", "context"];
const UNCERTAIN_LANGUAGE = /(가능|수 있|추정|may|might|could|possible)/i;
const CERTAIN_CAUSAL_LANGUAGE = /(확실히|명백히|증명(?:한다|했다|됨|되었다)?|원인은.{0,80}이다|definitely|proves?|the cause is)/i;
const NUMERIC_LANGUAGE = /\p{N}/u;
const DECISION_LANGUAGE = /(?:verdict|support|reject|adopt|accept|approve|approval|deploy|rollout|판정|결론|채택|기각|승인|반려|보류|배포)/iu;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function textList(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) return null;
  const values = value.map((item) => text(item, maxLength));
  return values.every((item): item is string => item !== null) ? values : null;
}

function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function subset(values: string[], allowed: Set<string>): boolean {
  return values.every((value) => allowed.has(value));
}

function clip(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function parseContext(value: unknown): AiSuggestionRequestV1["context"] | null {
  const item = record(value);
  if (!item) return null;
  const productName = text(item.productName, 200);
  const audience = text(item.audience, 300);
  const valueAction = text(item.valueAction, 300);
  const goal = text(item.goal, 300);
  const productStage = typeof item.productStage === "string" && PRODUCT_STAGES.includes(item.productStage as ProductStage)
    ? item.productStage as ProductStage
    : null;
  return productName && productStage && audience && valueAction && goal
    ? { productName, productStage, audience, valueAction, goal }
    : null;
}

function parseMetric(value: unknown): AiSuggestionRequestV1["metric"] | null {
  const item = record(value);
  if (!item) return null;
  const id = text(item.id, 128);
  const name = text(item.name, 200);
  const definition = text(item.definition, 300);
  const window = text(item.window, 100);
  return id && name && definition && window ? { id, name, definition, window } : null;
}

function parseEvidence(value: unknown): AiSuggestionRequestV1["evidence"] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 5) return null;
  const parsed: AiSuggestionRequestV1["evidence"] = [];
  for (const entry of value) {
    const item = record(entry);
    if (!item) return null;
    const id = text(item.id, 128);
    const observation = text(item.observation, 300);
    const detail = text(item.detail, 300);
    const sourceKind = typeof item.sourceKind === "string" && SOURCE_KINDS.includes(item.sourceKind as SourceKind) ? item.sourceKind as SourceKind : null;
    const direction = typeof item.direction === "string" && DIRECTIONS.includes(item.direction as EvidenceDirection) ? item.direction as EvidenceDirection : null;
    if (!id || !observation || !detail || !sourceKind || !direction) return null;
    parsed.push({ id, sourceKind, direction, observation, detail });
  }
  return unique(parsed.map((item) => item.id)) ? parsed : null;
}

function parseDraft(value: unknown, allowedIds: Set<string>): AiSuggestionRequestV1["draft"] | null {
  const item = record(value);
  if (!item) return null;
  const phenomenon = text(item.phenomenon, 300);
  const possibleCauses = textList(item.possibleCauses, 4, 240);
  const hypothesisChange = text(item.hypothesisChange, 300);
  const expectedBehavior = text(item.expectedBehavior, 300);
  const alternativeExplanation = text(item.alternativeExplanation, 300);
  const missingEvidence = text(item.missingEvidence, 300);
  const recommendedValidation = text(item.recommendedValidation, 300);
  const evidenceIds = textList(item.evidenceIds, 5, 128);
  if (!phenomenon || !possibleCauses || !hypothesisChange || !expectedBehavior || !alternativeExplanation || !missingEvidence || !recommendedValidation || !evidenceIds) return null;
  if (!unique(evidenceIds) || !subset(evidenceIds, allowedIds)) return null;
  return { phenomenon, possibleCauses, hypothesisChange, expectedBehavior, alternativeExplanation, missingEvidence, recommendedValidation, evidenceIds };
}

export function parseAiSuggestionRequest(value: unknown): ParseResult<AiSuggestionRequestV1> {
  const item = record(value);
  if (!item || item.schemaVersion !== 1 || item.task !== "diagnosis_hypothesis") return { ok: false, message: "AI 제안 요청 형식이 올바르지 않습니다." };
  const context = parseContext(item.context);
  const metric = parseMetric(item.metric);
  const evidence = parseEvidence(item.evidence);
  if (!context || !metric || !evidence) return { ok: false, message: "AI 제안에 필요한 제품 맥락, KPI 또는 근거를 확인하세요." };
  const draft = parseDraft(item.draft, new Set(evidence.map((entry) => entry.id)));
  return draft ? { ok: true, value: { schemaVersion: 1, task: "diagnosis_hypothesis", context, metric, evidence, draft } } : { ok: false, message: "AI 제안 초안과 근거 참조를 확인하세요." };
}

function parseCause(value: unknown, allowedIds: Set<string>): ModelCauseSuggestion | null {
  const item = record(value);
  if (!item || Object.keys(item).some((key) => !["statement", "evidenceIds"].includes(key))) return null;
  const statement = text(item.statement, 500);
  const evidenceIds = textList(item.evidenceIds, 5, 128);
  if (!statement || !evidenceIds || !unique(evidenceIds) || !subset(evidenceIds, allowedIds)) return null;
  if (!UNCERTAIN_LANGUAGE.test(statement) || !isSafeAdvisoryText(statement)) return null;
  return { statement, evidenceIds };
}

function compactForGuard(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\p{C}\p{M}\p{P}\p{S}\p{Z}\s_]+/gu, "");
}

export function isSafeAdvisoryText(value: string): boolean {
  const normalized = value.normalize("NFKC");
  return !CERTAIN_CAUSAL_LANGUAGE.test(normalized)
    && !NUMERIC_LANGUAGE.test(value)
    && !NUMERIC_LANGUAGE.test(normalized)
    && !DECISION_LANGUAGE.test(compactForGuard(normalized));
}

export function parseAiDiagnosisSuggestion(value: unknown, allowedEvidenceIds: string[]): ParseResult<AiDiagnosisSuggestion> {
  const item = record(value);
  const allowedKeys = ["summary", "possibleCauses", "hypothesisChange", "expectedBehavior", "alternativeExplanation", "missingEvidence", "recommendedValidation", "evidenceIds"];
  if (!item || Object.keys(item).some((key) => !allowedKeys.includes(key))) return { ok: false, message: "허용되지 않은 AI 출력 필드가 있습니다." };
  const allowedIds = new Set(allowedEvidenceIds);
  const summary = text(item.summary, 800);
  const hypothesisChange = text(item.hypothesisChange, 800);
  const expectedBehavior = text(item.expectedBehavior, 800);
  const alternativeExplanation = text(item.alternativeExplanation, 800);
  const missingEvidence = text(item.missingEvidence, 800);
  const recommendedValidation = text(item.recommendedValidation, 800);
  const evidenceIds = textList(item.evidenceIds, 10, 128);
  if (!summary || !hypothesisChange || !expectedBehavior || !alternativeExplanation || !missingEvidence || !recommendedValidation || !evidenceIds) return { ok: false, message: "AI 출력의 필수 텍스트를 확인할 수 없습니다." };
  const advisoryText = [summary, hypothesisChange, expectedBehavior, alternativeExplanation, missingEvidence, recommendedValidation];
  if (!advisoryText.every(isSafeAdvisoryText)) return { ok: false, message: "AI 출력에 수치 판정, 단정적 인과 또는 자동 실행 표현이 있습니다." };
  if (!unique(evidenceIds) || !subset(evidenceIds, allowedIds)) return { ok: false, message: "AI 출력이 존재하지 않는 근거를 참조했습니다." };
  if (!Array.isArray(item.possibleCauses) || item.possibleCauses.length === 0 || item.possibleCauses.length > 5) return { ok: false, message: "AI 원인 후보 형식이 올바르지 않습니다." };
  const possibleCauses = item.possibleCauses.map((cause) => parseCause(cause, allowedIds));
  if (!possibleCauses.every((cause): cause is ModelCauseSuggestion => cause !== null)) return { ok: false, message: "AI 원인 후보가 근거 또는 불확실성을 표시하지 않았습니다." };
  return { ok: true, value: { summary, possibleCauses, hypothesisChange, expectedBehavior, alternativeExplanation, missingEvidence, recommendedValidation, evidenceIds } };
}

export function buildAiSuggestionRequest(project: Project): AiSuggestionRequestV1 | null {
  if (!project.metric || !project.frictionCandidate || !project.hypothesis || project.evidence.length === 0) return null;
  const evidence = project.evidence.slice(0, 5).map((item) => ({
    id: clip(item.id, 128),
    sourceKind: item.sourceKind,
    direction: item.direction,
    observation: clip(item.observation, 300),
    detail: clip(item.detail, 300),
  }));
  const allowedIds = new Set(evidence.map((item) => item.id));
  const evidenceIds = project.hypothesis.evidenceIds.filter((id) => allowedIds.has(id)).slice(0, 5);
  if (evidenceIds.length === 0) return null;
  return {
    schemaVersion: 1,
    task: "diagnosis_hypothesis",
    context: {
      productName: clip(project.context.productName, 200),
      productStage: project.context.productStage,
      audience: clip(project.context.audience, 300),
      valueAction: clip(project.context.valueAction, 300),
      goal: clip(project.context.goal, 300),
    },
    metric: {
      id: clip(project.metric.id, 128),
      name: clip(project.metric.name, 200),
      definition: clip(project.metric.definition, 300),
      window: clip(project.metric.window, 100),
    },
    evidence,
    draft: {
      phenomenon: clip(project.frictionCandidate.phenomenon, 300),
      possibleCauses: project.frictionCandidate.possibleCauses.slice(0, 4).map((cause) => clip(cause, 240)),
      hypothesisChange: clip(project.hypothesis.change, 300),
      expectedBehavior: clip(project.hypothesis.expectedBehavior, 300),
      alternativeExplanation: clip(project.hypothesis.alternativeExplanation, 300),
      missingEvidence: clip(project.hypothesis.missingEvidence, 300),
      recommendedValidation: clip(project.frictionCandidate.recommendedValidation, 300),
      evidenceIds,
    },
  };
}

export function buildDeterministicSuggestion(input: AiSuggestionRequestV1): AiDiagnosisSuggestion {
  const safeText = (value: string, fallback: string): string => isSafeAdvisoryText(value) ? value : fallback;
  return {
    summary: safeText(input.draft.phenomenon, "선택한 근거와 현재 진단 초안을 함께 검토해야 합니다."),
    possibleCauses: input.draft.possibleCauses.map((cause) => ({
      statement: safeText(`${cause}일 가능성을 검증해야 합니다.`, "현재 근거와 연결된 원인 후보일 가능성을 검증해야 합니다."),
      evidenceIds: input.draft.evidenceIds,
    })),
    hypothesisChange: safeText(input.draft.hypothesisChange, "검증할 변경 범위를 사용자가 직접 확인해야 합니다."),
    expectedBehavior: safeText(input.draft.expectedBehavior, "기대 행동 변화가 나타날 가능성을 확인해야 합니다."),
    alternativeExplanation: safeText(input.draft.alternativeExplanation, "다른 설명 가능성도 함께 검토해야 합니다."),
    missingEvidence: safeText(input.draft.missingEvidence, "원인 후보를 구분할 추가 근거가 필요합니다."),
    recommendedValidation: safeText(input.draft.recommendedValidation, "추가 관찰과 실험으로 원인 후보를 검증해야 합니다."),
    evidenceIds: input.draft.evidenceIds,
  };
}

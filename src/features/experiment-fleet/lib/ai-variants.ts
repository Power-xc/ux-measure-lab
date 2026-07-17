import type { EvidenceDirection, Project, SourceKind } from "../../../entities/project/model.ts";
import { isSafeAdvisoryText } from "../../ai-diagnosis/lib/ai-diagnosis.ts";
import type { AiFallbackReason } from "../../../shared/server/ai-provider.ts";

// D-203: 웨이브당 AI 후보 상한. 검토 부담과 비용을 사전 등록 단계에서 제한한다.
export const MAX_VARIANT_CANDIDATES = 20;

export type AiVariantRequestV1 = {
  schemaVersion: 1;
  task: "fleet_variants";
  context: {
    productName: string;
    audience: string;
    valueAction: string;
    goal: string;
  };
  metric: {
    id: string;
    name: string;
    definition: string;
  };
  hypothesis: {
    change: string;
    expectedBehavior: string;
    guardrailMetric: string;
  };
  evidence: Array<{
    id: string;
    sourceKind: SourceKind;
    direction: EvidenceDirection;
    observation: string;
  }>;
  candidateCount: number;
};

export type AiVariantCandidate = {
  name: string;
  changeDescription: string;
  evidenceIds: string[];
};

export type AiVariantSuggestion = {
  candidates: AiVariantCandidate[];
};

export type AiVariantsResult =
  | { source: "model"; fallbackReason: null; suggestion: AiVariantSuggestion }
  | { source: "deterministic"; fallbackReason: AiFallbackReason; suggestion: AiVariantSuggestion };

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

const SOURCE_KINDS: SourceKind[] = ["measured", "calculated", "benchmark", "assumed", "inferred", "qualitative"];
const DIRECTIONS: EvidenceDirection[] = ["supports", "contradicts", "context"];

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function clip(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function parseContext(value: unknown): AiVariantRequestV1["context"] | null {
  const item = record(value);
  if (!item) return null;
  const productName = text(item.productName, 200);
  const audience = text(item.audience, 300);
  const valueAction = text(item.valueAction, 300);
  const goal = text(item.goal, 300);
  return productName && audience && valueAction && goal ? { productName, audience, valueAction, goal } : null;
}

function parseMetric(value: unknown): AiVariantRequestV1["metric"] | null {
  const item = record(value);
  if (!item) return null;
  const id = text(item.id, 128);
  const name = text(item.name, 200);
  const definition = text(item.definition, 300);
  return id && name && definition ? { id, name, definition } : null;
}

function parseHypothesis(value: unknown): AiVariantRequestV1["hypothesis"] | null {
  const item = record(value);
  if (!item) return null;
  const change = text(item.change, 300);
  const expectedBehavior = text(item.expectedBehavior, 300);
  const guardrailMetric = text(item.guardrailMetric, 200);
  return change && expectedBehavior && guardrailMetric ? { change, expectedBehavior, guardrailMetric } : null;
}

function parseEvidence(value: unknown): AiVariantRequestV1["evidence"] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 5) return null;
  const parsed: AiVariantRequestV1["evidence"] = [];
  for (const entry of value) {
    const item = record(entry);
    if (!item) return null;
    const id = text(item.id, 128);
    const observation = text(item.observation, 300);
    const sourceKind = typeof item.sourceKind === "string" && SOURCE_KINDS.includes(item.sourceKind as SourceKind) ? item.sourceKind as SourceKind : null;
    const direction = typeof item.direction === "string" && DIRECTIONS.includes(item.direction as EvidenceDirection) ? item.direction as EvidenceDirection : null;
    if (!id || !observation || !sourceKind || !direction) return null;
    parsed.push({ id, sourceKind, direction, observation });
  }
  return new Set(parsed.map((item) => item.id)).size === parsed.length ? parsed : null;
}

export function parseAiVariantRequest(value: unknown): ParseResult<AiVariantRequestV1> {
  const item = record(value);
  if (!item || item.schemaVersion !== 1 || item.task !== "fleet_variants") {
    return { ok: false, message: "AI 변형 후보 요청 형식이 올바르지 않습니다." };
  }
  const context = parseContext(item.context);
  const metric = parseMetric(item.metric);
  const hypothesis = parseHypothesis(item.hypothesis);
  const evidence = parseEvidence(item.evidence);
  const candidateCount = Number.isSafeInteger(item.candidateCount)
    && Number(item.candidateCount) >= 1 && Number(item.candidateCount) <= MAX_VARIANT_CANDIDATES
    ? Number(item.candidateCount)
    : null;
  if (!context || !metric || !hypothesis || !evidence || candidateCount === null) {
    return { ok: false, message: "AI 변형 후보에 필요한 맥락, 가설 또는 근거를 확인하세요." };
  }
  return { ok: true, value: { schemaVersion: 1, task: "fleet_variants", context, metric, hypothesis, evidence, candidateCount } };
}

function parseCandidate(value: unknown, allowedIds: Set<string>): AiVariantCandidate | null {
  const item = record(value);
  if (!item || Object.keys(item).some((key) => !["name", "changeDescription", "evidenceIds"].includes(key))) return null;
  const name = text(item.name, 100);
  const changeDescription = text(item.changeDescription, 300);
  if (!name || !changeDescription || !isSafeAdvisoryText(name) || !isSafeAdvisoryText(changeDescription)) return null;
  if (!Array.isArray(item.evidenceIds) || item.evidenceIds.length === 0 || item.evidenceIds.length > 5) return null;
  const evidenceIds = item.evidenceIds.map((id) => text(id, 128));
  if (!evidenceIds.every((id): id is string => id !== null && allowedIds.has(id))) return null;
  if (new Set(evidenceIds).size !== evidenceIds.length) return null;
  return { name, changeDescription, evidenceIds: evidenceIds as string[] };
}

export function parseAiVariantSuggestion(value: unknown, allowedEvidenceIds: string[], maxCandidates: number): ParseResult<AiVariantSuggestion> {
  const item = record(value);
  if (!item || Object.keys(item).some((key) => key !== "candidates")) {
    return { ok: false, message: "허용되지 않은 AI 출력 필드가 있습니다." };
  }
  if (!Array.isArray(item.candidates) || item.candidates.length === 0 || item.candidates.length > maxCandidates) {
    return { ok: false, message: "AI 변형 후보 개수가 요청 범위를 벗어났습니다." };
  }
  const allowedIds = new Set(allowedEvidenceIds);
  const candidates = item.candidates.map((candidate) => parseCandidate(candidate, allowedIds));
  if (!candidates.every((candidate): candidate is AiVariantCandidate => candidate !== null)) {
    return { ok: false, message: "AI 변형 후보가 근거 참조를 어겼거나 수치·판정 표현을 포함했습니다." };
  }
  const names = candidates.map((candidate) => candidate.name);
  if (new Set(names).size !== names.length) return { ok: false, message: "AI 변형 후보 이름이 중복되었습니다." };
  return { ok: true, value: { candidates } };
}

export function buildAiVariantRequest(project: Project, candidateCount: number): AiVariantRequestV1 | null {
  if (project.metric?.status !== "confirmed" || project.hypothesis?.status !== "ready" || project.evidence.length === 0) return null;
  if (!Number.isSafeInteger(candidateCount) || candidateCount < 1 || candidateCount > MAX_VARIANT_CANDIDATES) return null;
  return {
    schemaVersion: 1,
    task: "fleet_variants",
    context: {
      productName: clip(project.context.productName, 200),
      audience: clip(project.context.audience, 300),
      valueAction: clip(project.context.valueAction, 300),
      goal: clip(project.context.goal, 300),
    },
    metric: {
      id: clip(project.metric.id, 128),
      name: clip(project.metric.name, 200),
      definition: clip(project.metric.definition, 300),
    },
    hypothesis: {
      change: clip(project.hypothesis.change, 300),
      expectedBehavior: clip(project.hypothesis.expectedBehavior, 300),
      guardrailMetric: clip(project.hypothesis.guardrailMetric, 200),
    },
    evidence: project.evidence.slice(0, 5).map((item) => ({
      id: clip(item.id, 128),
      sourceKind: item.sourceKind,
      direction: item.direction,
      observation: clip(item.observation, 300),
    })),
    candidateCount,
  };
}

// 결정적 fallback은 후보를 지어내지 않는다. 가설 원안 하나만 검토 대상으로 되돌려준다.
export function buildDeterministicVariantCandidates(input: AiVariantRequestV1): AiVariantSuggestion {
  const change = isSafeAdvisoryText(input.hypothesis.change)
    ? input.hypothesis.change
    : "가설의 변경안을 변형 하나로 검토해야 합니다.";
  return {
    candidates: [{
      name: "가설 원안",
      changeDescription: change,
      evidenceIds: input.evidence.map((item) => item.id),
    }],
  };
}

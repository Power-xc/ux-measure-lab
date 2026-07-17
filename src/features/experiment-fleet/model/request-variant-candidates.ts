import type { AiFallbackReason, AiProviderRequest } from "../../../shared/server/ai-provider.ts";
import {
  parseAiVariantSuggestion,
  type AiVariantRequestV1,
  type AiVariantsResult,
} from "../lib/ai-variants.ts";

const FALLBACK_REASONS: AiFallbackReason[] = ["not_configured", "timeout", "provider_error", "invalid_output"];

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

// 서버 응답도 신뢰하지 않는다. 후보 텍스트·근거 참조를 클라이언트 경계에서 다시 검증한다.
export async function requestVariantCandidates(
  input: AiVariantRequestV1,
  options: { signal?: AbortSignal; request?: AiProviderRequest } = {},
): Promise<AiVariantsResult> {
  const request = options.request ?? fetch;
  const response = await request("/api/ai/fleet-variants", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: options.signal,
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("AI 변형 후보 서버의 응답을 읽지 못했습니다.");
  }
  const item = record(payload);
  if (!response.ok) {
    const message = item && typeof item.message === "string" ? item.message : "AI 변형 후보를 요청하지 못했습니다.";
    throw new Error(message);
  }
  if (!item) throw new Error("AI 변형 후보 응답 형식이 올바르지 않습니다.");
  const parsed = parseAiVariantSuggestion(item.suggestion, input.evidence.map((evidence) => evidence.id), input.candidateCount);
  if (!parsed.ok) throw new Error(parsed.message);
  if (item.source === "model" && item.fallbackReason === null) {
    return { source: "model", fallbackReason: null, suggestion: parsed.value };
  }
  if (item.source === "deterministic" && typeof item.fallbackReason === "string"
    && FALLBACK_REASONS.includes(item.fallbackReason as AiFallbackReason)) {
    return { source: "deterministic", fallbackReason: item.fallbackReason as AiFallbackReason, suggestion: parsed.value };
  }
  throw new Error("AI 변형 후보 출처를 확인하지 못했습니다.");
}

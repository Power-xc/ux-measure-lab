import {
  parseAiDiagnosisSuggestion,
  type AiDiagnosisResult,
  type AiFallbackReason,
  type AiSuggestionRequestV1,
} from "../lib/ai-diagnosis.ts";

export type AiDiagnosisRequest = (url: string, init: RequestInit) => Promise<Response>;

const FALLBACK_REASONS: AiFallbackReason[] = ["not_configured", "timeout", "provider_error", "invalid_output"];

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function requestDiagnosisSuggestion(
  input: AiSuggestionRequestV1,
  options: { signal?: AbortSignal; request?: AiDiagnosisRequest } = {},
): Promise<AiDiagnosisResult> {
  const request = options.request ?? fetch;
  const response = await request("/api/ai/diagnosis", {
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
    throw new Error("AI 제안 서버의 응답을 읽지 못했습니다.");
  }
  const item = record(payload);
  if (!response.ok) {
    const message = item && typeof item.message === "string" ? item.message : "AI 제안을 요청하지 못했습니다.";
    throw new Error(message);
  }
  if (!item) throw new Error("AI 제안 응답 형식이 올바르지 않습니다.");
  const parsed = parseAiDiagnosisSuggestion(item.suggestion, input.evidence.map((evidence) => evidence.id));
  if (!parsed.ok) throw new Error(parsed.message);
  if (item.source === "model" && item.fallbackReason === null) return { source: "model", fallbackReason: null, suggestion: parsed.value };
  if (item.source === "deterministic" && typeof item.fallbackReason === "string" && FALLBACK_REASONS.includes(item.fallbackReason as AiFallbackReason)) {
    return { source: "deterministic", fallbackReason: item.fallbackReason as AiFallbackReason, suggestion: parsed.value };
  }
  throw new Error("AI 제안 출처를 확인하지 못했습니다.");
}

import { parseAiSuggestionRequest } from "../../../../features/ai-diagnosis/lib/ai-diagnosis.ts";
import { generateDiagnosisSuggestion } from "../../../../features/ai-diagnosis/server/generate-diagnosis-suggestion.ts";
import { createRateLimiter, hasAllowedOrigin, isCrossSite, jsonResponse, readBoundedBody } from "../../../../shared/server/request-guards.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 32_768;
const checkRateLimit = createRateLimiter({ limit: 6, windowMs: 60_000, maxKeys: 1_000 });

type AiRuntimeEnvironment = {
  NODE_ENV?: string;
  UX_MEASURE_AI_ENABLED?: string;
};

export function isAiProviderRuntimeEnabled(environment: AiRuntimeEnvironment = process.env): boolean {
  return environment.NODE_ENV === "development" && environment.UX_MEASURE_AI_ENABLED === "true";
}

export async function POST(request: Request): Promise<Response> {
  if (!hasAllowedOrigin(request)) return jsonResponse({ error: "origin_not_allowed" }, { status: 403 });
  if (isCrossSite(request)) return jsonResponse({ error: "origin_not_allowed" }, { status: 403 });
  const limit = checkRateLimit(request);
  if (limit.limited) return jsonResponse({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return jsonResponse({ error: "unsupported_media_type" }, { status: 415 });
  const declaredLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (declaredLength > MAX_REQUEST_BYTES) return jsonResponse({ error: "request_too_large" }, { status: 413 });

  let text: string | null;
  try {
    text = await readBoundedBody(request, MAX_REQUEST_BYTES);
  } catch {
    return jsonResponse({ error: "invalid_request" }, { status: 400 });
  }
  if (text === null) return jsonResponse({ error: "request_too_large" }, { status: 413 });
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return jsonResponse({ error: "invalid_request" }, { status: 400 });
  }
  const parsed = parseAiSuggestionRequest(value);
  if (!parsed.ok) return jsonResponse({ error: "invalid_request", message: parsed.message }, { status: 400 });
  const aiEnabled = isAiProviderRuntimeEnabled();
  const result = await generateDiagnosisSuggestion(parsed.value, {
    apiKey: aiEnabled ? process.env.OPENAI_API_KEY : undefined,
    model: aiEnabled ? process.env.OPENAI_MODEL : undefined,
  });
  return jsonResponse(result);
}

import { ProductContextError } from "../../../features/product-context/lib/product-context.ts";
import { fetchProductPage } from "../../../features/product-context/server/fetch-product-page.ts";
import { createRateLimiter, hasAllowedOrigin, isCrossSite, jsonResponse, readBoundedBody } from "../../../shared/server/request-guards.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 4_096;
const checkRateLimit = createRateLimiter({ limit: 8, windowMs: 60_000, maxKeys: 1_000 });

function statusFor(error: ProductContextError): number {
  if (error.code === "invalid_url") return 400;
  if (error.code === "blocked_address") return 403;
  if (error.code === "response_too_large") return 413;
  if (error.code === "unsupported_content") return 415;
  if (error.code === "timeout") return 504;
  return 502;
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
  const text = await readBoundedBody(request, MAX_REQUEST_BYTES);
  if (text === null) return jsonResponse({ error: "request_too_large" }, { status: 413 });

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return jsonResponse({ error: "invalid_request" }, { status: 400 });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value) || typeof (value as Record<string, unknown>).url !== "string") {
    return jsonResponse({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const context = await fetchProductPage((value as Record<string, string>).url, { signal: request.signal });
    return jsonResponse({ context });
  } catch (error) {
    if (error instanceof ProductContextError) return jsonResponse({ error: error.code, message: error.message }, { status: statusFor(error) });
    return jsonResponse({ error: "upstream_failed", message: "제품 페이지를 분석하지 못했습니다." }, { status: 502 });
  }
}

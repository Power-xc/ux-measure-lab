import {
  createRateLimiter,
  jsonResponse,
  hasAllowedOrigin,
  isCrossSite,
  readBoundedBody,
} from "../../../shared/server/request-guards.ts";
import type { MeasurementOutcome, MeasurementQuery } from "../contract.ts";
import { parseMeasurementRequest } from "../lib/measurement-query.ts";
import { SessionMeasurementCache } from "../model/measurement-cache.ts";
import { parseMeasurementOutcome } from "../model/parse-measurement-outcome.ts";
import { createQueryHash, measurementMatchesQuery, MINIMUM_SAMPLE_SIZE, observationWindowFailure } from "./measure-service.ts";
import type { AdapterRegistry } from "./registry.ts";

const MAX_BODY_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

type HarnessRouteDeps = {
  registry: AdapterRegistry;
  now?: () => string;
  timeoutMs?: number;
};

const STATUS_BY_CODE: Record<Exclude<MeasurementOutcome, { ok: true }>["code"], number> = {
  unsupported_capability: 400,
  not_configured: 503,
  unauthorized: 401,
  rate_limited: 429,
  upstream_error: 502,
  invalid_response: 502,
  insufficient_sample: 200,
  timeout: 504,
};

function error(status: number, code: string, message: string, headers?: HeadersInit): Response {
  return jsonResponse({ ok: false, code, message }, { status, headers });
}

function isJson(request: Request): boolean {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function isClosedWindow(query: MeasurementQuery, now: string): boolean {
  if (!("window" in query)) return false;
  const current = new Date(now);
  if (!Number.isFinite(current.getTime())) return false;
  current.setUTCHours(0, 0, 0, 0);
  return Date.parse(query.window.to) < current.getTime();
}

async function parseBody(request: Request): Promise<unknown | null> {
  const body = await readBoundedBody(request, MAX_BODY_BYTES);
  if (body === null) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

export function createHarnessPost(deps: HarnessRouteDeps): (request: Request) => Promise<Response> {
  const limitRequest = createRateLimiter({ limit: 60, windowMs: 60_000, maxKeys: 1_000 });
  const closedWindowCache = new SessionMeasurementCache(200);
  return async (request: Request): Promise<Response> => {
    // 워크스페이스 API는 외부 사이트용 ingest와 달리 동일 출처에서만 호출한다.
    if (isCrossSite(request) || !hasAllowedOrigin(request)) {
      return error(403, "invalid_response", "동일 출처 요청만 허용됩니다.");
    }
    const rateLimit = limitRequest(request);
    if (rateLimit.limited) {
      return error(429, "rate_limited", "측정 요청이 너무 많습니다.", { "Retry-After": String(rateLimit.retryAfter) });
    }
    if (!isJson(request)) return error(415, "invalid_response", "JSON 요청만 허용됩니다.");
    const raw = await parseBody(request);
    if (raw === null) return error(413, "invalid_response", "요청 본문이 너무 큽니다.");
    const parsed = parseMeasurementRequest(raw);
    if (!parsed.ok) return error(400, "invalid_response", parsed.error);
    const adapter = deps.registry.get(parsed.value.adapterId);
    if (!adapter) return error(404, "not_configured", "선택한 측정 소스를 찾을 수 없습니다.");
    if (!adapter.supports(parsed.value.query.capability)) {
      return error(400, "unsupported_capability", "선택한 측정 소스가 이 질문 유형을 지원하지 않습니다.");
    }
    const windowFailure = observationWindowFailure(parsed.value.query);
    if (windowFailure) return jsonResponse(windowFailure, { status: STATUS_BY_CODE[windowFailure.code] });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const now = (deps.now ?? (() => new Date().toISOString()))();
    const query = parsed.value.query;
    const cache = isClosedWindow(query, now)
      ? closedWindowCache
      : new SessionMeasurementCache();
    let outcome: MeasurementOutcome;
    try {
      outcome = await adapter.measure(query, {
        now,
        signal: controller.signal,
        cache,
      });
    } catch {
      outcome = { ok: false, code: "upstream_error", message: "측정 소스를 읽지 못했습니다." };
    } finally {
      clearTimeout(timeout);
    }
    const trusted = parseMeasurementOutcome(outcome);
    if (!trusted || (trusted.ok && trusted.measurements.length === 0)) {
      return error(502, "invalid_response", "측정 결과 형식이 유효하지 않습니다.");
    }
    const queryHash = await createQueryHash(query);
    if (trusted.ok && trusted.measurements.some((measurement) => measurement.confidence.sampleSize < MINIMUM_SAMPLE_SIZE)) {
      return jsonResponse({ ok: false, code: "insufficient_sample", message: `최소 ${MINIMUM_SAMPLE_SIZE}개의 관찰 표본이 필요합니다.` });
    }
    if (trusted.ok && trusted.measurements.some((measurement) => !measurementMatchesQuery(measurement, parsed.value.adapterId, query, queryHash))) {
      return error(502, "invalid_response", "측정 결과 출처가 요청과 일치하지 않습니다.");
    }
    if (trusted.ok) return jsonResponse(trusted);
    const status = STATUS_BY_CODE[trusted.code];
    const headers = trusted.retryAfterMs === undefined
      ? undefined
      : { "Retry-After": String(Math.max(1, Math.ceil(trusted.retryAfterMs / 1_000))) };
    return jsonResponse(trusted, { status, headers });
  };
}

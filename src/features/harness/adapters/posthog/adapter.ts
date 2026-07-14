import {
  parseNormalizedMeasurement,
  type AdapterContext,
  type MeasurementOutcome,
  type MeasurementQuery,
  type SourceAdapter,
  type SourceAdapterMeta,
  type SourceCapability,
} from "../../contract.ts";
import { createQueryHash, normalizeMeasurementQuery, observationWindowFailure } from "../../server/measure-service.ts";
import { normalizePostHogResponse } from "./normalize.ts";
import { buildHogQLRequest, POSTHOG_QUERY_CAPABILITIES, PostHogQueryError } from "./query.ts";
import { LocalPostHogRateLimiter } from "./rate-limit.ts";

export type PostHogFetch = (url: string, init: RequestInit) => Promise<Response>;
export type PostHogEnvironment = {
  POSTHOG_HOST?: string;
  POSTHOG_PROJECT_ID?: string;
  POSTHOG_API_KEY?: string;
};

export type PostHogAdapterOptions = {
  env?: PostHogEnvironment;
  fetch?: PostHogFetch;
  rateLimiter?: LocalPostHogRateLimiter;
};

type PostHogConfig = { host: string; projectId: string; apiKey: string; region: "us" | "eu" };

const CLOUD_HOSTS = new Map<string, "us" | "eu">([
  ["https://us.posthog.com", "us"],
  ["https://eu.posthog.com", "eu"],
] as const);
const CAPABILITIES: SourceCapability[] = [...POSTHOG_QUERY_CAPABILITIES];

function configured(env: PostHogEnvironment): PostHogConfig | null {
  const host = env.POSTHOG_HOST?.trim().replace(/\/+$/, "") ?? "";
  const region = CLOUD_HOSTS.get(host);
  const projectId = env.POSTHOG_PROJECT_ID?.trim() ?? "";
  const apiKey = env.POSTHOG_API_KEY?.trim() ?? "";
  if (!region || !/^\d+$/.test(projectId) || !apiKey) return null;
  return { host, projectId, apiKey, region };
}

function processEnvironment(): PostHogEnvironment {
  return {
    POSTHOG_HOST: process.env.POSTHOG_HOST,
    POSTHOG_PROJECT_ID: process.env.POSTHOG_PROJECT_ID,
    POSTHOG_API_KEY: process.env.POSTHOG_API_KEY,
  };
}

function retryAfterMs(value: string | null, nowMs: number): number {
  if (!value) return 60_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1, Math.ceil(seconds * 1_000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(1, date - nowMs) : 60_000;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function failure(code: Exclude<MeasurementOutcome, { ok: true }>["code"], message: string, retry?: number): MeasurementOutcome {
  return retry === undefined ? { ok: false, code, message } : { ok: false, code, message, retryAfterMs: retry };
}

export class PostHogAdapter implements SourceAdapter {
  private readonly config: PostHogConfig | null;
  private readonly request: PostHogFetch;
  private readonly rateLimiter: LocalPostHogRateLimiter;

  constructor(options: PostHogAdapterOptions = {}) {
    this.config = configured(options.env ?? processEnvironment());
    this.request = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.rateLimiter = options.rateLimiter ?? new LocalPostHogRateLimiter();
  }

  meta(): SourceAdapterMeta {
    return {
      adapterId: "posthog",
      displayName: "PostHog (read-only)",
      kind: "connector",
      access: "read_only",
      ...(this.config ? { region: this.config.region } : {}),
      capabilities: [...CAPABILITIES],
    };
  }

  supports(capability: SourceCapability): boolean {
    return CAPABILITIES.includes(capability);
  }

  async measure(query: MeasurementQuery, ctx: AdapterContext): Promise<MeasurementOutcome> {
    if (!this.supports(query.capability)) return failure("unsupported_capability", "PostHog에서 지원하지 않는 측정 유형입니다.");
    if (!this.config) return failure("not_configured", "PostHog 연결 정보가 설정되지 않았습니다.");
    const nowMs = Date.parse(ctx.now);
    if (!Number.isFinite(nowMs) || new Date(nowMs).toISOString() !== ctx.now) return failure("invalid_response", "측정 시각이 유효하지 않습니다.");
    const normalizedQuery = normalizeMeasurementQuery(query);
    const windowFailure = observationWindowFailure(normalizedQuery);
    if (windowFailure) return windowFailure;
    const queryHash = await createQueryHash(normalizedQuery);
    const cacheKey = `${this.meta().adapterId}:${queryHash}`;
    const cached = ctx.cache.get(cacheKey);
    if (cached) return { ok: true, measurements: [...cached], degraded: [] };

    let hogql;
    try {
      hogql = buildHogQLRequest(normalizedQuery);
    } catch (error) {
      if (error instanceof PostHogQueryError) return failure("invalid_response", error.message);
      throw error;
    }
    const limit = this.rateLimiter.consume(nowMs);
    if (!limit.allowed) return failure("rate_limited", "PostHog 로컬 요청 한도에 도달했습니다.", limit.retryAfterMs);

    let response: Response;
    try {
      response = await this.request(`${this.config.host}/api/projects/${encodeURIComponent(this.config.projectId)}/query/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(hogql.body),
        signal: ctx.signal,
      });
    } catch (error) {
      return isAbort(error) || ctx.signal?.aborted
        ? failure("timeout", "PostHog 측정 요청 시간이 초과되었습니다.")
        : failure("upstream_error", "PostHog 측정 요청에 실패했습니다.");
    }
    if (response.status === 401 || response.status === 403) return failure("unauthorized", "PostHog 연결 권한을 확인하세요.");
    if (response.status === 429) return failure("rate_limited", "PostHog 요청 한도에 도달했습니다.", retryAfterMs(response.headers.get("retry-after"), nowMs));
    if (response.status >= 500) return failure("upstream_error", "PostHog 서비스가 측정 요청을 처리하지 못했습니다.");
    if (!response.ok) return failure("invalid_response", "PostHog 요청 또는 응답 형식이 유효하지 않습니다.");

    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      return failure("invalid_response", "PostHog 응답을 해석하지 못했습니다.");
    }
    const normalized = normalizePostHogResponse(normalizedQuery, hogql, raw, queryHash, ctx.now);
    if (!normalized.ok) {
      const message = normalized.code === "insufficient_sample" ? "측정에 필요한 표본이 부족합니다." : "PostHog 응답 스키마가 유효하지 않습니다.";
      return failure(normalized.code, message);
    }
    const parsed = normalized.measurements.map(parseNormalizedMeasurement);
    if (parsed.some((result) => !result.ok)) return failure("invalid_response", "정규화된 PostHog 측정 결과가 유효하지 않습니다.");
    const measurements = parsed.flatMap((result) => result.ok ? [result.value] : []);
    ctx.cache.set(cacheKey, measurements);
    return { ok: true, measurements, degraded: [] };
  }
}

export function createPostHogAdapter(options: PostHogAdapterOptions = {}): SourceAdapter {
  return new PostHogAdapter(options);
}

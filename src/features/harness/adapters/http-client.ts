import type {
  AdapterContext,
  MeasurementOutcome,
  MeasurementQuery,
  SourceAdapter,
  SourceAdapterMeta,
  SourceCapability,
} from "../contract.ts";
import { parseMeasurementOutcome } from "../model/parse-measurement-outcome.ts";
import { createQueryHash, measurementMatchesQuery, MINIMUM_SAMPLE_SIZE } from "../server/measure-service.ts";

export type HarnessFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type HttpAdapterOptions = {
  meta: SourceAdapterMeta;
  fetch?: HarnessFetch;
  endpoint?: string;
};

function failure(message: string): MeasurementOutcome {
  return { ok: false, code: "invalid_response", message };
}

function matchesRequest(
  outcome: MeasurementOutcome,
  adapterId: string,
  query: MeasurementQuery,
  queryHash: string,
): boolean {
  if (!outcome.ok) return true;
  return outcome.measurements.length > 0
    && outcome.measurements.every((measurement) => measurementMatchesQuery(measurement, adapterId, query, queryHash));
}

function isStablePastWindow(query: MeasurementQuery, now: string): boolean {
  if (!("window" in query)) return false;
  const today = new Date(now);
  if (!Number.isFinite(today.getTime())) return false;
  today.setUTCHours(0, 0, 0, 0);
  return Date.parse(query.window.to) < today.getTime();
}

export function createHarnessHttpAdapter(options: HttpAdapterOptions): SourceAdapter {
  const request = options.fetch ?? globalThis.fetch;
  const endpoint = options.endpoint ?? "/api/harness/measure";
  const meta = { ...options.meta, capabilities: [...options.meta.capabilities] };
  return {
    meta: () => ({ ...meta, capabilities: [...meta.capabilities] }),
    supports: (capability: SourceCapability) => meta.capabilities.includes(capability),
    measure: async (query: MeasurementQuery, context: AdapterContext): Promise<MeasurementOutcome> => {
      if (!meta.capabilities.includes(query.capability)) {
        return { ok: false, code: "unsupported_capability", message: "선택한 측정 소스가 이 질문 유형을 지원하지 않습니다." };
      }
      const queryHash = await createQueryHash(query);
      const cacheKey = `${meta.adapterId}:${queryHash}`;
      const cacheable = isStablePastWindow(query, context.now);
      const cached = cacheable ? context.cache.get(cacheKey) : undefined;
      if (cached) return { ok: true, measurements: [...cached], degraded: [] };
      let response: Response;
      try {
        response = await request(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adapterId: meta.adapterId, query }),
          signal: context.signal,
        });
      } catch {
        return context.signal?.aborted
          ? { ok: false, code: "timeout", message: "측정 요청 시간이 초과되었습니다." }
          : { ok: false, code: "upstream_error", message: "측정 서버에 연결하지 못했습니다." };
      }
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        return failure("측정 서버 응답을 해석하지 못했습니다.");
      }
      const outcome = parseMeasurementOutcome(raw);
      if (!outcome || (!response.ok && outcome.ok)) {
        return failure("측정 서버 응답을 신뢰할 수 없습니다.");
      }
      if (outcome.ok && outcome.measurements.some((measurement) => measurement.confidence.sampleSize < MINIMUM_SAMPLE_SIZE)) {
        return { ok: false, code: "insufficient_sample", message: `최소 ${MINIMUM_SAMPLE_SIZE}개의 관찰 표본이 필요합니다.` };
      }
      if (!matchesRequest(outcome, meta.adapterId, query, queryHash)) {
        return failure("측정 서버 응답을 신뢰할 수 없습니다.");
      }
      if (outcome.ok && cacheable) context.cache.set(cacheKey, outcome.measurements);
      return outcome;
    },
  };
}

export function createFirstPartyClientAdapter(fetch?: HarnessFetch): SourceAdapter {
  return createHarnessHttpAdapter({
    fetch,
    meta: {
      adapterId: "first-party",
      displayName: "UX MeasureLab Events",
      kind: "first_party",
      access: "read_write",
      capabilities: ["funnel", "interaction", "paths"],
    },
  });
}

export function createPostHogClientAdapter(fetch?: HarnessFetch): SourceAdapter {
  return createHarnessHttpAdapter({
    fetch,
    meta: {
      adapterId: "posthog",
      displayName: "PostHog (read-only)",
      kind: "connector",
      access: "read_only",
      capabilities: ["funnel", "interaction", "paths"],
    },
  });
}

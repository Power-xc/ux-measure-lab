import type { FunnelStep } from "../../../entities/measurement/model.ts";
import { analyzeFunnel, FunnelValidationError } from "../../measure-loop/lib/calculate-funnel.ts";
import type {
  AdapterContext,
  ConfidenceBand,
  MeasurementOutcome,
  MeasurementProvenance,
  MeasurementQuery,
  NormalizedMeasurement,
  SourceAdapterMeta,
  TimeWindow,
} from "../contract.ts";
import type { AggregateReader, InteractionSignal } from "./aggregate-reader.ts";
import { measureSegments } from "./measure-segments.ts";

export const MINIMUM_SAMPLE_SIZE = 30;
export const CONFIDENCE_MEDIUM_MINIMUM = 100;
export const CONFIDENCE_HIGH_MINIMUM = 1_000;

type SupportedQuery = Extract<MeasurementQuery, { capability: "funnel" | "interaction" | "paths" | "segments" }>;
export type MeasureDependencies = {
  reader: AggregateReader;
  meta: SourceAdapterMeta;
  context: AdapterContext;
  queryHash: string;
};

export type MeasureService = {
  measure(query: MeasurementQuery, context: AdapterContext): Promise<MeasurementOutcome>;
};

function normalizeTime(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : value.trim();
}

function normalizeWindow(window: TimeWindow): TimeWindow {
  return { from: normalizeTime(window.from), to: normalizeTime(window.to) };
}

export function normalizeMeasurementQuery(query: MeasurementQuery): MeasurementQuery {
  const window = "window" in query ? normalizeWindow(query.window) : undefined;
  switch (query.capability) {
    case "funnel":
      return {
        capability: "funnel",
        steps: query.steps.map((step) => step.trim()),
        window: window as TimeWindow,
        ...(query.segment ? { segment: { dimension: query.segment.dimension.trim(), value: query.segment.value.trim() } } : {}),
      };
    case "events":
      return { capability: "events", event: query.event.trim(), interval: query.interval, window: window as TimeWindow, ...(query.segment ? { segment: { dimension: query.segment.dimension.trim(), value: query.segment.value.trim() } } : {}) };
    case "paths":
      return { capability: "paths", startEvent: query.startEvent.trim(), endEvent: query.endEvent.trim(), window: window as TimeWindow };
    case "interaction":
      return { capability: "interaction", signals: [...new Set(query.signals)].sort(), window: window as TimeWindow, ...(query.target === undefined ? {} : { target: query.target.trim() }) };
    case "segments":
      return { capability: "segments", steps: query.steps.map((step) => step.trim()), dimension: query.dimension.trim(), window: window as TimeWindow };
    case "sessions":
      return { capability: "sessions", filter: query.filter.trim(), limit: query.limit, window: window as TimeWindow };
    case "recordings":
      return { capability: "recordings", sessionIds: [...new Set(query.sessionIds.map((id) => id.trim()))].sort() };
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, stableValue(record[key])]));
}

export async function createQueryHash(query: MeasurementQuery): Promise<string> {
  const canonical = JSON.stringify(stableValue(normalizeMeasurementQuery(query)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createConfidenceBand(sampleSize: number): ConfidenceBand {
  if (!Number.isSafeInteger(sampleSize) || sampleSize < 0) throw new RangeError("표본 수는 0 이상의 안전한 정수여야 합니다.");
  const level = sampleSize >= CONFIDENCE_HIGH_MINIMUM
    ? "high"
    : sampleSize >= CONFIDENCE_MEDIUM_MINIMUM ? "medium" : "low";
  return {
    level,
    sampleSize,
    basis: `관찰 표본 ${sampleSize}개를 기준으로 한 순서형 등급입니다.`,
    limits: "표본 규모만 반영하며 인과관계나 통계적 유의성을 나타내지 않습니다.",
  };
}

// segments 측정은 provenance.segment가 요청 dimension에 속한 값이어야 한다. 나머지 유형은 단일 라벨과 정확히 일치해야 한다.
function segmentMatchesQuery(segment: string, query: MeasurementQuery): boolean {
  if (query.capability === "segments") {
    return segment.startsWith(`${query.dimension}=`) && segment.length > query.dimension.length + 1;
  }
  const expected = "segment" in query && query.segment
    ? `${query.segment.dimension}=${query.segment.value}`
    : "전체 사용자";
  return segment === expected;
}

export function measurementMatchesQuery(
  measurement: NormalizedMeasurement,
  adapterId: string,
  input: MeasurementQuery,
  queryHash: string,
): boolean {
  const query = normalizeMeasurementQuery(input);
  if (!("window" in query)) return false;
  return measurement.provenance.adapterId === adapterId
    && measurement.provenance.capability === query.capability
    && measurement.provenance.queryHash === queryHash
    && measurement.provenance.window.from === query.window.from
    && measurement.provenance.window.to === query.window.to
    && segmentMatchesQuery(measurement.provenance.segment, query)
    && measurement.confidence.level === createConfidenceBand(measurement.confidence.sampleSize).level;
}

function isCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function insufficientSample(sampleSize: number): MeasurementOutcome | undefined {
  if (sampleSize >= MINIMUM_SAMPLE_SIZE) return undefined;
  return { ok: false, code: "insufficient_sample", message: `최소 ${MINIMUM_SAMPLE_SIZE}개의 관찰 표본이 필요합니다.` };
}

export function observationWindowFailure(query: MeasurementQuery): Exclude<MeasurementOutcome, { ok: true }> | undefined {
  if (!("window" in query)) return undefined;
  const from = Date.parse(query.window.from);
  const to = Date.parse(query.window.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
    return { ok: false, code: "invalid_response", message: "측정 기간이 유효하지 않습니다." };
  }
  return from === to
    ? { ok: false, code: "insufficient_sample", message: "관찰 기간은 0초보다 길어야 합니다." }
    : undefined;
}

function segmentLabel(query: SupportedQuery): string {
  if (query.capability !== "funnel" || !query.segment) return "전체 사용자";
  return `${query.segment.dimension}=${query.segment.value}`;
}

function provenance(query: SupportedQuery, deps: MeasureDependencies): MeasurementProvenance {
  return {
    adapterId: deps.meta.adapterId,
    capability: query.capability,
    source: deps.meta.displayName,
    observedAt: deps.context.now,
    period: `${query.window.from} ~ ${query.window.to}`,
    window: query.window,
    segment: segmentLabel(query),
    queryHash: deps.queryHash,
  };
}

function percentage(part: number, whole: number): number {
  return Math.round((part / whole) * 1_000) / 10;
}

async function measureFunnel(query: Extract<SupportedQuery, { capability: "funnel" }>, deps: MeasureDependencies): Promise<MeasurementOutcome> {
  const counts = await deps.reader.funnelCounts(query, deps.context.signal);
  if (counts.length !== query.steps.length || counts.some((count) => !isCount(count))) {
    return { ok: false, code: "invalid_response", message: "퍼널 집계 형식이 유효하지 않습니다." };
  }
  const sampleFailure = insufficientSample(counts[0] ?? 0);
  if (sampleFailure) return sampleFailure;
  const steps: FunnelStep[] = query.steps.map((label, index) => ({ id: `step-${index + 1}`, label, users: counts[index] }));
  const analysis = analyzeFunnel(steps);
  const largest = analysis.largestDropOff;
  const largestIndex = largest ? analysis.steps.findIndex((step) => step.id === largest.id) : -1;
  const previous = largestIndex > 0 ? analysis.steps[largestIndex - 1] : undefined;
  const observation = largest && previous
    ? `${previous.label}에서 ${largest.label} 사이의 이탈률은 ${largest.dropOffFromPrevious ?? 0}%로 관찰되었습니다.`
    : `${steps[0].label}에서 ${steps.at(-1)?.label ?? steps[0].label}까지의 전환율은 ${analysis.totalConversion}%입니다.`;
  const measurement: NormalizedMeasurement = {
    metricLabel: "퍼널 전환 및 이탈",
    observation,
    sourceKind: "calculated",
    direction: "context",
    values: {
      enteredUsers: counts[0],
      completedUsers: counts.at(-1) ?? 0,
      totalConversion: analysis.totalConversion,
      largestDropOffRate: largest?.dropOffFromPrevious ?? 0,
    },
    provenance: provenance(query, deps),
    confidence: createConfidenceBand(counts[0]),
  };
  return { ok: true, measurements: [measurement], degraded: [] };
}

const SIGNAL_LABELS: Record<InteractionSignal, string> = { rage: "반복 클릭", dead: "무반응 클릭", error: "오류 클릭" };

async function measureInteraction(query: Extract<SupportedQuery, { capability: "interaction" }>, deps: MeasureDependencies): Promise<MeasurementOutcome> {
  if (query.signals.length === 0) return { ok: false, code: "invalid_response", message: "마찰 신호를 하나 이상 선택해야 합니다." };
  const result = await deps.reader.interactionCounts(query, deps.context.signal);
  if (!isCount(result.sampleSize) || Object.values(result.counts).some((count) => count !== undefined && !isCount(count))) {
    return { ok: false, code: "invalid_response", message: "마찰 신호 집계 형식이 유효하지 않습니다." };
  }
  const sampleFailure = insufficientSample(result.sampleSize);
  if (sampleFailure) return sampleFailure;
  const measurements = query.signals.map<NormalizedMeasurement>((signal) => {
    const count = result.counts[signal] ?? 0;
    return {
      metricLabel: SIGNAL_LABELS[signal],
      observation: `${query.target || "선택한 영역"}에서 ${SIGNAL_LABELS[signal]} 신호 ${count}건이 관찰되었습니다.`,
      sourceKind: "measured",
      direction: "context",
      values: { signalCount: count, sampleSize: result.sampleSize, signalsPer100Samples: percentage(count, result.sampleSize) },
      provenance: provenance(query, deps),
      confidence: createConfidenceBand(result.sampleSize),
    };
  });
  return { ok: true, measurements, degraded: [] };
}

async function measurePaths(query: Extract<SupportedQuery, { capability: "paths" }>, deps: MeasureDependencies): Promise<MeasurementOutcome> {
  const result = await deps.reader.pathReach(query, deps.context.signal);
  if (!isCount(result.startCount) || !isCount(result.reachedCount) || result.reachedCount > result.startCount) {
    return { ok: false, code: "invalid_response", message: "여정 집계 형식이 유효하지 않습니다." };
  }
  const sampleFailure = insufficientSample(result.startCount);
  if (sampleFailure) return sampleFailure;
  const reachRate = percentage(result.reachedCount, result.startCount);
  const measurement: NormalizedMeasurement = {
    metricLabel: "여정 도달률",
    observation: `${query.startEvent} 표본 중 ${query.endEvent}에 도달한 비율은 ${reachRate}%입니다.`,
    sourceKind: "calculated",
    direction: "context",
    values: { startedUsers: result.startCount, reachedUsers: result.reachedCount, reachRate },
    provenance: provenance(query, deps),
    confidence: createConfidenceBand(result.startCount),
  };
  return { ok: true, measurements: [measurement], degraded: [] };
}

function supportsQuery(query: MeasurementQuery, meta: SourceAdapterMeta): query is SupportedQuery {
  return (query.capability === "funnel" || query.capability === "interaction" || query.capability === "paths" || query.capability === "segments")
    && meta.capabilities.includes(query.capability);
}

async function executeMeasurement(query: SupportedQuery, deps: MeasureDependencies): Promise<MeasurementOutcome> {
  if (query.capability === "funnel") return measureFunnel(query, deps);
  if (query.capability === "interaction") return measureInteraction(query, deps);
  if (query.capability === "segments") return measureSegments(query, deps);
  return measurePaths(query, deps);
}

export function createMeasureService(reader: AggregateReader, meta: SourceAdapterMeta): MeasureService {
  return {
    measure: async (input, context) => {
      const query = normalizeMeasurementQuery(input);
      if (!supportsQuery(query, meta)) {
        return { ok: false, code: "unsupported_capability", message: "이 측정 소스가 지원하지 않는 질문 유형입니다." };
      }
      const windowFailure = observationWindowFailure(query);
      if (windowFailure) return windowFailure;
      const queryHash = await createQueryHash(query);
      const cacheKey = `${meta.adapterId}:${queryHash}`;
      const cached = context.cache.get(cacheKey);
      if (cached) return { ok: true, measurements: [...cached], degraded: [] };
      try {
        const outcome = await executeMeasurement(query, { reader, meta, context, queryHash });
        if (outcome.ok) context.cache.set(cacheKey, outcome.measurements);
        return outcome;
      } catch (error) {
        if (error instanceof FunnelValidationError) return { ok: false, code: "invalid_response", message: error.message };
        if (context.signal?.aborted) return { ok: false, code: "timeout", message: "측정 요청 시간이 초과되었습니다." };
        return { ok: false, code: "upstream_error", message: "집계 데이터를 읽지 못했습니다." };
      }
    },
  };
}

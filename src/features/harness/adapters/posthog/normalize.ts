import type { FunnelStep } from "../../../../entities/measurement/model.ts";
import { analyzeFunnel } from "../../../measure-loop/lib/calculate-funnel.ts";
import type {
  MeasurementProvenance,
  MeasurementQuery,
  NormalizedMeasurement,
  TimeWindow,
} from "../../contract.ts";
import { createConfidenceBand, MINIMUM_SAMPLE_SIZE } from "../../server/measure-service.ts";
import type { HogQLRequest, PostHogQueryCapability } from "./query.ts";

const MAX_RESULT_ROWS = 10_000;
const SIGNAL_LABELS = { rage: "반복 클릭", dead: "무반응 클릭", error: "오류 클릭" } as const;

export type PostHogNormalization =
  | { ok: true; measurements: NormalizedMeasurement[] }
  | { ok: false; code: "invalid_response" | "insufficient_sample" };

type QueryResponse = { columns: string[]; results: unknown[][] };
type RawMeasurement =
  | { capability: "funnel"; counts: number[]; sampleSize: number }
  | { capability: "events"; values: Record<string, number>; sampleSize: number }
  | { capability: "paths"; startCount: number; reachedCount: number; sampleSize: number }
  | { capability: "interaction"; counts: number[]; sampleSize: number };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function response(value: unknown, expectedColumns: readonly string[]): QueryResponse | null {
  const body = record(value);
  if (!body || !Array.isArray(body.columns) || !Array.isArray(body.results) || body.results.length > MAX_RESULT_ROWS) return null;
  if (body.columns.length !== expectedColumns.length || !body.columns.every((item, index) => item === expectedColumns[index])) return null;
  if (!body.results.every(Array.isArray)) return null;
  return { columns: body.columns as string[], results: body.results as unknown[][] };
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function oneCountRow(data: QueryResponse): number[] | null {
  if (data.results.length !== 1 || data.results[0].length !== data.columns.length) return null;
  const values = data.results[0].map(count);
  return values.every((value): value is number => value !== null) ? values : null;
}

function rawFunnel(data: QueryResponse): RawMeasurement | null {
  const counts = oneCountRow(data);
  if (!counts || counts.length < 2 || counts.some((value, index) => index > 0 && value > counts[index - 1])) return null;
  return { capability: "funnel", counts, sampleSize: counts[0] };
}

function rawEvents(data: QueryResponse): RawMeasurement | null {
  const values: Record<string, number> = {};
  let sampleSize = 0;
  for (const row of data.results) {
    if (row.length !== 2 || typeof row[0] !== "string" || !row[0].trim() || row[0] in values) return null;
    const eventCount = count(row[1]);
    if (eventCount === null) return null;
    values[row[0]] = eventCount;
    sampleSize += eventCount;
    if (!Number.isSafeInteger(sampleSize)) return null;
  }
  return { capability: "events", values, sampleSize };
}

function rawPaths(data: QueryResponse): RawMeasurement | null {
  const counts = oneCountRow(data);
  if (!counts || counts.length !== 2 || counts[1] > counts[0]) return null;
  return { capability: "paths", startCount: counts[0], reachedCount: counts[1], sampleSize: counts[0] };
}

function rawInteraction(query: Extract<MeasurementQuery, { capability: "interaction" }>, data: QueryResponse): RawMeasurement | null {
  const counts = oneCountRow(data);
  if (!counts || counts.length !== query.signals.length + 1) return null;
  return { capability: "interaction", counts: counts.slice(1), sampleSize: counts[0] };
}

function rawMeasurement(query: MeasurementQuery, data: QueryResponse): RawMeasurement | null {
  if (query.capability === "funnel") return rawFunnel(data);
  if (query.capability === "events") return rawEvents(data);
  if (query.capability === "paths") return rawPaths(data);
  if (query.capability === "interaction") return rawInteraction(query, data);
  return null;
}

function windowOf(query: MeasurementQuery): TimeWindow | null {
  return "window" in query ? query.window : null;
}

function provenance(query: MeasurementQuery, queryHash: string, observedAt: string): MeasurementProvenance | null {
  const window = windowOf(query);
  if (!window) return null;
  const capability = query.capability as PostHogQueryCapability;
  const segment = "segment" in query && query.segment ? `${query.segment.dimension}=${query.segment.value}` : "전체 사용자";
  return {
    adapterId: "posthog",
    capability,
    source: "PostHog (read-only)",
    observedAt,
    period: `${window.from} ~ ${window.to}`,
    window,
    segment,
    queryHash,
  };
}

function percentage(part: number, whole: number): number {
  return Math.round((part / whole) * 1_000) / 10;
}

function funnelMeasurement(query: Extract<MeasurementQuery, { capability: "funnel" }>, raw: Extract<RawMeasurement, { capability: "funnel" }>, source: MeasurementProvenance): NormalizedMeasurement {
  const steps: FunnelStep[] = query.steps.map((label, index) => ({ id: `step-${index + 1}`, label, users: raw.counts[index] }));
  const analysis = analyzeFunnel(steps);
  const largest = analysis.largestDropOff;
  const largestIndex = largest ? analysis.steps.findIndex((step) => step.id === largest.id) : -1;
  const previous = largestIndex > 0 ? analysis.steps[largestIndex - 1] : undefined;
  const observation = largest && previous
    ? `${previous.label}에서 ${largest.label} 사이의 이탈률은 ${largest.dropOffFromPrevious ?? 0}%로 관찰되었습니다.`
    : `${steps[0].label}에서 ${steps.at(-1)?.label ?? steps[0].label}까지의 전환율은 ${analysis.totalConversion}%입니다.`;
  return {
    metricLabel: "퍼널 전환 및 이탈",
    observation,
    sourceKind: "calculated",
    direction: "context",
    values: {
      enteredUsers: raw.counts[0],
      completedUsers: raw.counts.at(-1) ?? 0,
      totalConversion: analysis.totalConversion,
      largestDropOffRate: largest?.dropOffFromPrevious ?? 0,
    },
    provenance: source,
    confidence: createConfidenceBand(raw.sampleSize),
  };
}

function eventsMeasurement(query: Extract<MeasurementQuery, { capability: "events" }>, raw: Extract<RawMeasurement, { capability: "events" }>, source: MeasurementProvenance): NormalizedMeasurement {
  return {
    metricLabel: `${query.event} 이벤트 수`,
    observation: `관찰 기간에 ${query.event} 이벤트가 ${raw.sampleSize.toLocaleString("ko-KR")}건 집계되었습니다.`,
    sourceKind: "measured",
    direction: "context",
    values: raw.values,
    provenance: source,
    confidence: createConfidenceBand(raw.sampleSize),
  };
}

function pathsMeasurement(query: Extract<MeasurementQuery, { capability: "paths" }>, raw: Extract<RawMeasurement, { capability: "paths" }>, source: MeasurementProvenance): NormalizedMeasurement {
  const reachRate = percentage(raw.reachedCount, raw.startCount);
  return {
    metricLabel: "여정 도달률",
    observation: `${query.startEvent} 표본 중 ${query.endEvent}에 도달한 비율은 ${reachRate}%입니다.`,
    sourceKind: "calculated",
    direction: "context",
    values: { startedUsers: raw.startCount, reachedUsers: raw.reachedCount, reachRate },
    provenance: source,
    confidence: createConfidenceBand(raw.sampleSize),
  };
}

function interactionMeasurements(query: Extract<MeasurementQuery, { capability: "interaction" }>, raw: Extract<RawMeasurement, { capability: "interaction" }>, source: MeasurementProvenance): NormalizedMeasurement[] {
  return query.signals.map((signal, index) => {
    const signalCount = raw.counts[index];
    return {
      metricLabel: SIGNAL_LABELS[signal],
      observation: `${query.target || "선택한 영역"}에서 ${SIGNAL_LABELS[signal]} 신호 ${signalCount}건이 관찰되었습니다.`,
      sourceKind: "measured",
      direction: "context",
      values: { signalCount, sampleSize: raw.sampleSize, signalsPer100Samples: percentage(signalCount, raw.sampleSize) },
      provenance: source,
      confidence: createConfidenceBand(raw.sampleSize),
    };
  });
}

function measurements(query: MeasurementQuery, raw: RawMeasurement, source: MeasurementProvenance): NormalizedMeasurement[] | null {
  if (query.capability === "funnel" && raw.capability === "funnel") return [funnelMeasurement(query, raw, source)];
  if (query.capability === "events" && raw.capability === "events") return [eventsMeasurement(query, raw, source)];
  if (query.capability === "paths" && raw.capability === "paths") return [pathsMeasurement(query, raw, source)];
  if (query.capability === "interaction" && raw.capability === "interaction") return interactionMeasurements(query, raw, source);
  return null;
}

export function normalizePostHogResponse(query: MeasurementQuery, request: HogQLRequest, value: unknown, queryHash: string, observedAt: string): PostHogNormalization {
  const data = response(value, request.columns);
  const raw = data ? rawMeasurement(query, data) : null;
  const source = provenance(query, queryHash, observedAt);
  if (!raw || !source) return { ok: false, code: "invalid_response" };
  if (raw.sampleSize < MINIMUM_SAMPLE_SIZE) return { ok: false, code: "insufficient_sample" };
  const normalized = measurements(query, raw, source);
  return normalized ? { ok: true, measurements: normalized } : { ok: false, code: "invalid_response" };
}

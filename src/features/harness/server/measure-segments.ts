import type { FunnelStep } from "../../../entities/measurement/model.ts";
import { analyzeFunnel } from "../../measure-loop/lib/calculate-funnel.ts";
import type {
  DegradedNote,
  MeasurementOutcome,
  MeasurementQuery,
  NormalizedMeasurement,
} from "../contract.ts";
import type { SegmentedFunnelRow } from "./aggregate-reader.ts";
import { createConfidenceBand, MINIMUM_SAMPLE_SIZE, type MeasureDependencies } from "./measure-service.ts";

type SegmentsQuery = Extract<MeasurementQuery, { capability: "segments" }>;

const MAX_SEGMENT_ROWS = 200;

function isCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isValidRow(row: SegmentedFunnelRow, stepCount: number): boolean {
  return row.value.trim().length > 0
    && row.counts.length === stepCount
    && row.counts.every(isCount);
}

function conversionRate(entered: number, completed: number): number {
  return entered === 0 ? 0 : Math.round((completed / entered) * 1_000) / 10;
}

function toMeasurement(query: SegmentsQuery, row: SegmentedFunnelRow, deps: MeasureDependencies): NormalizedMeasurement {
  const entered = row.counts[0];
  const completed = row.counts.at(-1) ?? 0;
  const rate = conversionRate(entered, completed);
  return {
    metricLabel: `변형 전환 · ${row.value}`,
    observation: `${query.dimension}=${row.value} 표본 ${entered}명 중 ${completed}명이 마지막 단계에 도달해 전환율 ${rate}%로 관찰되었습니다.`,
    sourceKind: "calculated",
    direction: "context",
    values: { enteredUsers: entered, completedUsers: completed, conversionRate: rate },
    provenance: {
      adapterId: deps.meta.adapterId,
      capability: "segments",
      source: deps.meta.displayName,
      observedAt: deps.context.now,
      period: `${query.window.from} ~ ${query.window.to}`,
      window: query.window,
      segment: `${query.dimension}=${row.value}`,
      queryHash: deps.queryHash,
    },
    confidence: createConfidenceBand(entered),
  };
}

// 변형별 퍼널 관찰. 표본이 최소 기준에 못 미치는 변형은 결과를 위조하지 않고 결손으로 알린다.
export async function measureSegments(query: SegmentsQuery, deps: MeasureDependencies): Promise<MeasurementOutcome> {
  const rows = await deps.reader.segmentedFunnelCounts(query, deps.context.signal);
  const values = rows.map((row) => row.value.trim());
  if (rows.length > MAX_SEGMENT_ROWS || new Set(values).size !== values.length
    || rows.some((row) => !isValidRow(row, query.steps.length))) {
    return { ok: false, code: "invalid_response", message: "변형별 집계 형식이 유효하지 않습니다." };
  }
  for (const row of rows) {
    // 증가 퍼널 등 불가능한 형태는 기존 퍼널 검증기가 거부한다.
    const steps: FunnelStep[] = query.steps.map((label, index) => ({ id: `step-${index + 1}`, label, users: row.counts[index] }));
    analyzeFunnel(steps);
  }
  const sorted = [...rows].sort((left, right) => (left.value < right.value ? -1 : 1));
  const measurable = sorted.filter((row) => row.counts[0] >= MINIMUM_SAMPLE_SIZE);
  if (measurable.length === 0) {
    return { ok: false, code: "insufficient_sample", message: `변형별로 최소 ${MINIMUM_SAMPLE_SIZE}개의 관찰 표본이 필요합니다.` };
  }
  const degraded: DegradedNote[] = sorted
    .filter((row) => row.counts[0] < MINIMUM_SAMPLE_SIZE)
    .map((row) => ({
      capability: "segments",
      reason: "insufficient_sample",
      detail: `${query.dimension}=${row.value}는 표본 ${row.counts[0]}개로 최소 ${MINIMUM_SAMPLE_SIZE}개 미만이라 제외되었습니다.`,
    }));
  return { ok: true, measurements: measurable.map((row) => toMeasurement(query, row, deps)), degraded };
}

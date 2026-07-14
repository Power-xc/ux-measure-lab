import { CONFIDENCE_LEVELS, SOURCE_CAPABILITIES, type EvidenceDirection, type SourceKind } from "../../entities/project/model.ts";
import { MAX_TEXT_LENGTH } from "../../shared/lib/input-policy.ts";

// 어휘의 단일 출처는 entities다(의존 방향: features → entities). 계약 사용처를 위해 재수출한다.
export { CONFIDENCE_LEVELS, SOURCE_CAPABILITIES } from "../../entities/project/model.ts";
export type { ConfidenceLevel, SourceCapability } from "../../entities/project/model.ts";
import type { ConfidenceLevel, SourceCapability } from "../../entities/project/model.ts";

export type SourceAdapterMeta = {
  adapterId: string;
  displayName: string;
  kind: "first_party" | "connector";
  access: "read_write" | "read_only";
  region?: string; // "us" | "eu" 등 리전 식별자. 커넥터는 리전별 base URL을 고른다.
  capabilities: SourceCapability[];
};

export type TimeWindow = { from: string; to: string }; // ISO, 폐구간
export type SegmentFilter = { dimension: string; value: string };

// 질문 유형별 쿼리 계약. capability로 구분되는 discriminated union이다.
export type MeasurementQuery =
  | { capability: "funnel"; steps: string[]; window: TimeWindow; segment?: SegmentFilter }
  | { capability: "events"; event: string; window: TimeWindow; interval: "day" | "week"; segment?: SegmentFilter }
  | { capability: "paths"; startEvent: string; endEvent: string; window: TimeWindow }
  | { capability: "interaction"; target?: string; signals: ("rage" | "dead" | "error")[]; window: TimeWindow }
  | { capability: "segments"; steps: string[]; dimension: string; window: TimeWindow }
  | { capability: "sessions"; filter: string; window: TimeWindow; limit: number }
  | { capability: "recordings"; sessionIds: string[] };

export type MeasurementProvenance = {
  adapterId: string;
  capability: SourceCapability;
  source: string; // 기존 Evidence.provenance.source와 정렬되는 소스 라벨
  observedAt: string; // 측정 실행 시각 (ISO). 주입된 now를 사용
  period: string; // 사람이 읽는 관찰 기간 라벨
  window: TimeWindow; // 기계 판독·캐시용 구간
  segment: string; // 기존 provenance.segment와 정렬, 기본 "전체 사용자"
  queryHash: string; // 캐시·재현 키
};

// 순서형 신뢰 등급. p-value·확률이 아니다.
export type ConfidenceBand = {
  level: ConfidenceLevel;
  sampleSize: number; // 관찰 표본 수 (사용자/세션/이벤트)
  basis: string; // 등급 근거: 표본·기간·소스 신뢰도
  limits: string; // 이 수치로 말할 수 없는 것
};

// 정규화된 측정 결과. Project에 저장되기 전 단계다.
export type NormalizedMeasurement = {
  metricLabel: string;
  observation: string; // 사람이 읽는 관찰 문장. 인과 표현 금지
  sourceKind: SourceKind; // 기존 enum 재사용
  direction: EvidenceDirection;
  values: Record<string, number>; // 원자료 정규화 값만. 파생 계산은 기존 TS 엔진이 소유
  provenance: MeasurementProvenance;
  confidence: ConfidenceBand;
};

export type AdapterErrorCode =
  | "unsupported_capability"
  | "not_configured"
  | "unauthorized"
  | "rate_limited"
  | "upstream_error"
  | "invalid_response"
  | "insufficient_sample"
  | "timeout";

// 부분 실패: 확보한 결과는 반환하고 결손을 함께 알린다.
export type DegradedNote = {
  capability: SourceCapability;
  reason: AdapterErrorCode;
  detail: string;
};

export type MeasurementOutcome =
  | { ok: true; measurements: NormalizedMeasurement[]; degraded: DegradedNote[] }
  | { ok: false; code: AdapterErrorCode; message: string; retryAfterMs?: number };

export interface MeasurementCache {
  get(queryHash: string): readonly NormalizedMeasurement[] | undefined;
  set(queryHash: string, measurements: readonly NormalizedMeasurement[]): void;
}

export type AdapterContext = {
  signal?: AbortSignal;
  now: string; // 주입된 시각. 어댑터는 내부에서 시계를 읽지 않는다
  cache: MeasurementCache;
};

export interface SourceAdapter {
  meta(): SourceAdapterMeta;
  supports(capability: SourceCapability): boolean;
  measure(query: MeasurementQuery, ctx: AdapterContext): Promise<MeasurementOutcome>;
}

// 런타임 검증: AI·업스트림이 만든 값이 이 경계를 넘지 못하게 한다.
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

type UnknownRecord = Record<string, unknown>;

const SOURCE_KINDS: readonly SourceKind[] = ["measured", "calculated", "benchmark", "assumed", "inferred", "qualitative"];
const EVIDENCE_DIRECTIONS: readonly EvidenceDirection[] = ["supports", "contradicts", "context"];
const MEASUREMENT_KEYS = ["metricLabel", "observation", "sourceKind", "direction", "values", "provenance", "confidence"] as const;
const PROVENANCE_KEYS = ["adapterId", "capability", "source", "observedAt", "period", "window", "segment", "queryHash"] as const;
const CONFIDENCE_KEYS = ["level", "sampleSize", "basis", "limits"] as const;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_TEXT_LENGTH;
}

function isRequiredString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isEnum<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function isIsoTimestamp(value: unknown): value is string {
  if (!isString(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isTimeBound(value: unknown): value is string {
  return isRequiredString(value) && Number.isFinite(Date.parse(value));
}

// unknown 필드 거부의 핵심: 실제 키 집합과 허용 키 집합이 정확히 일치해야 한다.
function hasExactKeys(record: UnknownRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "number" && Number.isFinite(item));
}

function isTimeWindow(value: unknown): value is TimeWindow {
  return isRecord(value) && hasExactKeys(value, ["from", "to"]) && isTimeBound(value.from) && isTimeBound(value.to);
}

function isProvenance(value: unknown): value is MeasurementProvenance {
  if (!isRecord(value) || !hasExactKeys(value, PROVENANCE_KEYS)) return false;
  return isRequiredString(value.adapterId)
    && isEnum(value.capability, SOURCE_CAPABILITIES)
    && isRequiredString(value.source)
    && isIsoTimestamp(value.observedAt)
    && isRequiredString(value.period)
    && isTimeWindow(value.window)
    && isRequiredString(value.segment)
    && isRequiredString(value.queryHash);
}

function isConfidenceBand(value: unknown): value is ConfidenceBand {
  if (!isRecord(value) || !hasExactKeys(value, CONFIDENCE_KEYS)) return false;
  return isEnum(value.level, CONFIDENCE_LEVELS)
    && isSafeInteger(value.sampleSize) && value.sampleSize >= 0
    && isRequiredString(value.basis)
    && isRequiredString(value.limits);
}

// 정규화 측정 결과의 런타임 검증. unknown 필드·타입 위조·수치 위조(문자열·NaN·Infinity)를 거부한다.
export function parseNormalizedMeasurement(value: unknown): ParseResult<NormalizedMeasurement> {
  if (!isRecord(value)) return { ok: false, error: "측정 결과는 객체여야 합니다." };
  if (!hasExactKeys(value, MEASUREMENT_KEYS)) return { ok: false, error: "허용되지 않은 필드가 있거나 필수 필드가 누락되었습니다." };
  if (!isRequiredString(value.metricLabel)) return { ok: false, error: "metricLabel이 유효하지 않습니다." };
  if (!isRequiredString(value.observation)) return { ok: false, error: "observation이 유효하지 않습니다." };
  if (!isEnum(value.sourceKind, SOURCE_KINDS)) return { ok: false, error: "sourceKind가 유효하지 않습니다." };
  if (!isEnum(value.direction, EVIDENCE_DIRECTIONS)) return { ok: false, error: "direction이 유효하지 않습니다." };
  if (!isNumberRecord(value.values)) return { ok: false, error: "values는 유한 수치만 담을 수 있습니다." };
  if (!isProvenance(value.provenance)) return { ok: false, error: "provenance가 유효하지 않습니다." };
  if (!isConfidenceBand(value.confidence)) return { ok: false, error: "confidence가 유효하지 않습니다." };
  return { ok: true, value: value as NormalizedMeasurement };
}

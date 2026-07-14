import type {
  MeasurementQuery,
  SegmentFilter,
  TimeWindow,
} from "../contract.ts";
import { MAX_TEXT_LENGTH } from "../../../shared/lib/input-policy.ts";

type UnknownRecord = Record<string, unknown>;

export type MeasurementRequest = {
  adapterId: string;
  query: MeasurementQuery;
};

export type QueryParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const SIGNALS = ["rage", "dead", "error"] as const;
const MAX_ITEMS = 100;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasKeys(record: UnknownRecord, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = [...required, ...optional];
  return required.every((key) => Object.hasOwn(record, key))
    && Object.keys(record).every((key) => allowed.includes(key));
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TEXT_LENGTH;
}

function parseTextList(value: unknown, minimum = 1): string[] | null {
  if (!Array.isArray(value) || value.length < minimum || value.length > MAX_ITEMS) return null;
  if (!value.every(isText)) return null;
  const values = value.map((item) => item.trim());
  return new Set(values).size === values.length ? values : null;
}

function parseWindow(value: unknown): TimeWindow | null {
  if (!isRecord(value) || !hasKeys(value, ["from", "to"])) return null;
  if (!isText(value.from) || !isText(value.to)) return null;
  const from = Date.parse(value.from);
  const to = Date.parse(value.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return null;
  return { from: value.from, to: value.to };
}

function parseSegment(value: unknown): SegmentFilter | null {
  if (!isRecord(value) || !hasKeys(value, ["dimension", "value"])) return null;
  if (!isText(value.dimension) || !isText(value.value)) return null;
  return { dimension: value.dimension.trim(), value: value.value.trim() };
}

function optionalSegment(record: UnknownRecord): SegmentFilter | undefined | null {
  if (!Object.hasOwn(record, "segment")) return undefined;
  return parseSegment(record.segment);
}

function parseFunnel(record: UnknownRecord): MeasurementQuery | null {
  if (!hasKeys(record, ["capability", "steps", "window"], ["segment"])) return null;
  const steps = parseTextList(record.steps, 2);
  const window = parseWindow(record.window);
  const segment = optionalSegment(record);
  if (!steps || !window || segment === null) return null;
  return segment ? { capability: "funnel", steps, window, segment } : { capability: "funnel", steps, window };
}

function parseEvents(record: UnknownRecord): MeasurementQuery | null {
  if (!hasKeys(record, ["capability", "event", "window", "interval"], ["segment"])) return null;
  const window = parseWindow(record.window);
  const segment = optionalSegment(record);
  if (!isText(record.event) || !window || segment === null || !["day", "week"].includes(String(record.interval))) return null;
  const interval = record.interval === "day" ? "day" : "week";
  return segment
    ? { capability: "events", event: record.event.trim(), window, interval, segment }
    : { capability: "events", event: record.event.trim(), window, interval };
}

function parsePaths(record: UnknownRecord): MeasurementQuery | null {
  if (!hasKeys(record, ["capability", "startEvent", "endEvent", "window"])) return null;
  const window = parseWindow(record.window);
  if (!isText(record.startEvent) || !isText(record.endEvent) || record.startEvent.trim() === record.endEvent.trim() || !window) return null;
  return { capability: "paths", startEvent: record.startEvent.trim(), endEvent: record.endEvent.trim(), window };
}

function parseInteraction(record: UnknownRecord): MeasurementQuery | null {
  if (!hasKeys(record, ["capability", "signals", "window"], ["target"])) return null;
  const signals = parseTextList(record.signals);
  const window = parseWindow(record.window);
  if (!signals || !window || !signals.every((signal) => SIGNALS.includes(signal as (typeof SIGNALS)[number]))) return null;
  if (Object.hasOwn(record, "target") && !isText(record.target)) return null;
  const typedSignals = signals as (typeof SIGNALS)[number][];
  return isText(record.target)
    ? { capability: "interaction", signals: typedSignals, window, target: record.target.trim() }
    : { capability: "interaction", signals: typedSignals, window };
}

function parseSegments(record: UnknownRecord): MeasurementQuery | null {
  if (!hasKeys(record, ["capability", "steps", "dimension", "window"])) return null;
  const steps = parseTextList(record.steps, 2);
  const window = parseWindow(record.window);
  if (!steps || !isText(record.dimension) || !window) return null;
  return { capability: "segments", steps, dimension: record.dimension.trim(), window };
}

function parseSessions(record: UnknownRecord): MeasurementQuery | null {
  if (!hasKeys(record, ["capability", "filter", "window", "limit"])) return null;
  const window = parseWindow(record.window);
  if (!isText(record.filter) || !window || !Number.isSafeInteger(record.limit) || Number(record.limit) < 1 || Number(record.limit) > MAX_ITEMS) return null;
  return { capability: "sessions", filter: record.filter.trim(), window, limit: Number(record.limit) };
}

function parseRecordings(record: UnknownRecord): MeasurementQuery | null {
  if (!hasKeys(record, ["capability", "sessionIds"])) return null;
  const sessionIds = parseTextList(record.sessionIds);
  return sessionIds ? { capability: "recordings", sessionIds } : null;
}

export function parseMeasurementQuery(value: unknown): QueryParseResult<MeasurementQuery> {
  if (!isRecord(value) || typeof value.capability !== "string") return { ok: false, error: "측정 query가 유효하지 않습니다." };
  const query = value.capability === "funnel" ? parseFunnel(value)
    : value.capability === "events" ? parseEvents(value)
      : value.capability === "paths" ? parsePaths(value)
        : value.capability === "interaction" ? parseInteraction(value)
          : value.capability === "segments" ? parseSegments(value)
            : value.capability === "sessions" ? parseSessions(value)
              : value.capability === "recordings" ? parseRecordings(value)
                : null;
  return query ? { ok: true, value: query } : { ok: false, error: "측정 query의 필드 또는 값이 유효하지 않습니다." };
}

export function parseMeasurementRequest(value: unknown): QueryParseResult<MeasurementRequest> {
  if (!isRecord(value) || !hasKeys(value, ["adapterId", "query"]) || !isText(value.adapterId)) {
    return { ok: false, error: "측정 요청이 유효하지 않습니다." };
  }
  const query = parseMeasurementQuery(value.query);
  return query.ok
    ? { ok: true, value: { adapterId: value.adapterId.trim(), query: query.value } }
    : query;
}

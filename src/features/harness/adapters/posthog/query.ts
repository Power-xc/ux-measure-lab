import type { MeasurementQuery } from "../../contract.ts";

export const POSTHOG_QUERY_CAPABILITIES = ["funnel", "events", "paths", "interaction"] as const;
export type PostHogQueryCapability = (typeof POSTHOG_QUERY_CAPABILITIES)[number];

export type HogQLRequest = {
  body: { query: { kind: "HogQLQuery"; query: string } };
  columns: string[];
};

export class PostHogQueryError extends Error {
  constructor() {
    super("PostHog 측정 쿼리가 유효하지 않습니다.");
    this.name = "PostHogQueryError";
  }
}

function sqlString(value: string): string {
  if (!value.trim() || value.length > 2_048) throw new PostHogQueryError();
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}

function checkedWindow(query: Extract<MeasurementQuery, { window: unknown }>): { from: string; to: string; seconds: number } {
  const fromMs = Date.parse(query.window.from);
  const toMs = Date.parse(query.window.to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) throw new PostHogQueryError();
  return { from: sqlString(query.window.from), to: sqlString(query.window.to), seconds: Math.max(1, Math.ceil((toMs - fromMs) / 1_000)) };
}

function segmentClause(query: Extract<MeasurementQuery, { capability: "funnel" | "events" }>): string {
  if (!query.segment) return "";
  return ` AND properties[${sqlString(query.segment.dimension)}] = ${sqlString(query.segment.value)}`;
}

function funnelRequest(query: Extract<MeasurementQuery, { capability: "funnel" }>): HogQLRequest {
  if (query.steps.length < 2 || query.steps.length > 20 || new Set(query.steps).size !== query.steps.length) throw new PostHogQueryError();
  const window = checkedWindow(query);
  const conditions = query.steps.map((step) => `event = ${sqlString(step)}`).join(", ");
  const columns = query.steps.map((_, index) => `step_${index + 1}`);
  const counts = query.steps.map((_, index) => `countIf(max_step >= ${index + 1}) AS step_${index + 1}`).join(",\n  ");
  const events = query.steps.map(sqlString).join(", ");
  const sql = `SELECT\n  ${counts}\nFROM (\n  SELECT person_id, windowFunnel(${window.seconds})(timestamp, ${conditions}) AS max_step\n  FROM events\n  WHERE event IN (${events}) AND timestamp >= parseDateTimeBestEffort(${window.from}) AND timestamp <= parseDateTimeBestEffort(${window.to})${segmentClause(query)}\n  GROUP BY person_id\n)`;
  return { body: { query: { kind: "HogQLQuery", query: sql } }, columns };
}

function eventsRequest(query: Extract<MeasurementQuery, { capability: "events" }>): HogQLRequest {
  const window = checkedWindow(query);
  const bucket = query.interval === "day" ? "toStartOfDay(timestamp)" : "toStartOfWeek(timestamp)";
  const sql = `SELECT toString(${bucket}) AS bucket, count() AS count\nFROM events\nWHERE event = ${sqlString(query.event)} AND timestamp >= parseDateTimeBestEffort(${window.from}) AND timestamp <= parseDateTimeBestEffort(${window.to})${segmentClause(query)}\nGROUP BY bucket\nORDER BY bucket`;
  return { body: { query: { kind: "HogQLQuery", query: sql } }, columns: ["bucket", "count"] };
}

function pathsRequest(query: Extract<MeasurementQuery, { capability: "paths" }>): HogQLRequest {
  const window = checkedWindow(query);
  const start = sqlString(query.startEvent);
  const end = sqlString(query.endEvent);
  const sql = `SELECT countIf(max_step >= 1) AS start_count, countIf(max_step >= 2) AS reached_count\nFROM (\n  SELECT person_id, windowFunnel(${window.seconds})(timestamp, event = ${start}, event = ${end}) AS max_step\n  FROM events\n  WHERE event IN (${start}, ${end}) AND timestamp >= parseDateTimeBestEffort(${window.from}) AND timestamp <= parseDateTimeBestEffort(${window.to})\n  GROUP BY person_id\n)`;
  return { body: { query: { kind: "HogQLQuery", query: sql } }, columns: ["start_count", "reached_count"] };
}

const SIGNAL_EVENTS = { rage: "$rageclick", dead: "$dead_click", error: "$exception" } as const;

function interactionRequest(query: Extract<MeasurementQuery, { capability: "interaction" }>): HogQLRequest {
  if (query.signals.length === 0 || new Set(query.signals).size !== query.signals.length) throw new PostHogQueryError();
  const window = checkedWindow(query);
  const selected = query.signals.map((signal) => [signal, SIGNAL_EVENTS[signal]] as const);
  const counts = selected.map(([signal, event]) => `countIf(event = ${sqlString(event)}) AS ${signal}_count`).join(",\n  ");
  const target = query.target
    ? ` AND (positionCaseInsensitive(toString(properties['$elements_chain']), ${sqlString(query.target)}) > 0 OR positionCaseInsensitive(toString(properties['$current_url']), ${sqlString(query.target)}) > 0)`
    : "";
  const sql = `SELECT count(DISTINCT person_id) AS sample_size,\n  ${counts}\nFROM events\nWHERE timestamp >= parseDateTimeBestEffort(${window.from}) AND timestamp <= parseDateTimeBestEffort(${window.to})${target}`;
  return { body: { query: { kind: "HogQLQuery", query: sql } }, columns: ["sample_size", ...query.signals.map((signal) => `${signal}_count`)] };
}

// PostHog Query API의 HogQL 문법과 autocapture 이벤트 이름은 실호출 전 공식 스키마로 재확인해야 한다.
export function buildHogQLRequest(query: MeasurementQuery): HogQLRequest {
  if (query.capability === "funnel") return funnelRequest(query);
  if (query.capability === "events") return eventsRequest(query);
  if (query.capability === "paths") return pathsRequest(query);
  if (query.capability === "interaction") return interactionRequest(query);
  throw new PostHogQueryError();
}

import {
  SOURCE_CAPABILITIES,
  parseNormalizedMeasurement,
  type AdapterErrorCode,
  type DegradedNote,
  type MeasurementOutcome,
  type NormalizedMeasurement,
  type SourceCapability,
} from "../contract.ts";
import { MAX_TEXT_LENGTH } from "../../../shared/lib/input-policy.ts";

type UnknownRecord = Record<string, unknown>;

const ERROR_CODES: readonly AdapterErrorCode[] = [
  "unsupported_capability",
  "not_configured",
  "unauthorized",
  "rate_limited",
  "upstream_error",
  "invalid_response",
  "insufficient_sample",
  "timeout",
];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(record: UnknownRecord, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = [...required, ...optional];
  return required.every((key) => Object.hasOwn(record, key))
    && Object.keys(record).every((key) => allowed.includes(key));
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TEXT_LENGTH;
}

function isCapability(value: unknown): value is SourceCapability {
  return typeof value === "string" && SOURCE_CAPABILITIES.some((capability) => capability === value);
}

function parseDegraded(value: unknown): DegradedNote | null {
  if (!isRecord(value) || !exactKeys(value, ["capability", "reason", "detail"])) return null;
  if (!isCapability(value.capability)) return null;
  if (typeof value.reason !== "string" || !ERROR_CODES.includes(value.reason as AdapterErrorCode)) return null;
  if (!isText(value.detail)) return null;
  return {
    capability: value.capability,
    reason: value.reason as AdapterErrorCode,
    detail: value.detail,
  };
}

function parseMeasurements(value: unknown): NormalizedMeasurement[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const measurements: NormalizedMeasurement[] = [];
  for (const item of value) {
    const parsed = parseNormalizedMeasurement(item);
    if (!parsed.ok) return null;
    measurements.push(parsed.value);
  }
  return measurements;
}

export function parseMeasurementOutcome(value: unknown): MeasurementOutcome | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") return null;
  if (value.ok) {
    if (!exactKeys(value, ["ok", "measurements", "degraded"])) return null;
    const measurements = parseMeasurements(value.measurements);
    if (!measurements || !Array.isArray(value.degraded)) return null;
    const degraded = value.degraded.map(parseDegraded);
    if (degraded.some((item) => item === null)) return null;
    return { ok: true, measurements, degraded: degraded.filter((item): item is DegradedNote => item !== null) };
  }
  if (!exactKeys(value, ["ok", "code", "message"], ["retryAfterMs"])) return null;
  if (typeof value.code !== "string" || !ERROR_CODES.includes(value.code as AdapterErrorCode) || !isText(value.message)) return null;
  if (value.retryAfterMs !== undefined && (!Number.isSafeInteger(value.retryAfterMs) || Number(value.retryAfterMs) < 0)) return null;
  return value.retryAfterMs === undefined
    ? { ok: false, code: value.code as AdapterErrorCode, message: value.message }
    : { ok: false, code: value.code as AdapterErrorCode, message: value.message, retryAfterMs: Number(value.retryAfterMs) };
}

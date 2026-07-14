// Runtime validator for the ingest batch payload.
// Binding contract: spec.md §4 (unifies the three research docs) + research-ingest.md §4.2.
// Wire event enum is the SDK form `pv|click|rage|dead|scroll|route|s_start|s_end`
// (`custom` is excluded in v1). These bounds MUST match supabase/migrations/0001_ingest.sql.

export const EVENT_TYPES = ["pv", "click", "rage", "dead", "scroll", "route", "s_start", "s_end"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES);

export const MAX_EVENTS_PER_BATCH = 50; // research-ingest.md §4.2
export const MAX_ID_BYTES = 128; // k / sid / aid / eid
export const MAX_PATH_BYTES = 2_048; // path (p) — clipped on overflow
export const MAX_REF_BYTES = 1_024; // referrer host (ref) — clipped on overflow
export const MAX_PROPS_BYTES = 4_096; // serialized props — event dropped on overflow

export type RawEvent = {
  eid: string;
  t: EventType;
  ts: number; // epoch milliseconds — spec.md §4가 wire 타입을 number로 확정
  p: string;
  ref?: string;
  props: Record<string, unknown>;
};

export type ValidEnvelope = {
  k: string;
  sent_at: string;
  sid: string;
  aid: string;
  events: unknown[];
};

export type EnvelopeResult = { ok: true; envelope: ValidEnvelope } | { ok: false };
export type EventValidation = { ok: true; event: RawEvent } | { ok: false };

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

// UTF-8 safe truncation: cut the byte buffer and drop any partial trailing
// code point via a streaming decode (the incomplete tail is never flushed).
export function clipToBytes(value: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length <= maxBytes) return value;
  return new TextDecoder().decode(bytes.subarray(0, maxBytes), { stream: true });
}

function isBoundedString(value: unknown, maxBytes: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && byteLength(value) <= maxBytes;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

// 이벤트 ts는 epoch ms(number). envelope의 sent_at(ISO 문자열)과 타입이 다르다.
function isEpochMs(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Whole-batch structural validation. Failure → 400. The `≤ 50 events` cap is
// enforced here so one forged batch cannot inflate downstream work.
export function parseEnvelope(raw: unknown): EnvelopeResult {
  if (!isPlainObject(raw)) return { ok: false };
  if (!isBoundedString(raw.k, MAX_ID_BYTES)) return { ok: false };
  if (!isTimestamp(raw.sent_at)) return { ok: false };
  if (!isBoundedString(raw.sid, MAX_ID_BYTES)) return { ok: false };
  if (!isBoundedString(raw.aid, MAX_ID_BYTES)) return { ok: false };
  if (!Array.isArray(raw.events) || raw.events.length > MAX_EVENTS_PER_BATCH) return { ok: false };
  return { ok: true, envelope: { k: raw.k, sent_at: raw.sent_at, sid: raw.sid, aid: raw.aid, events: raw.events } };
}

// Per-event validation. Invalid events are dropped while the batch continues
// (research-ingest.md §4.6, loss-tolerant layer). String fields are clipped;
// an oversized props object is dropped rather than silently truncated.
export function validateEvent(raw: unknown): EventValidation {
  if (!isPlainObject(raw)) return { ok: false };
  if (!isBoundedString(raw.eid, MAX_ID_BYTES)) return { ok: false };
  if (typeof raw.t !== "string" || !EVENT_TYPE_SET.has(raw.t)) return { ok: false };
  if (!isEpochMs(raw.ts)) return { ok: false };

  let path = "";
  if (raw.p !== undefined && raw.p !== null) {
    if (typeof raw.p !== "string") return { ok: false };
    path = clipToBytes(raw.p, MAX_PATH_BYTES);
  }

  let ref: string | undefined;
  if (raw.ref !== undefined && raw.ref !== null) {
    if (typeof raw.ref !== "string") return { ok: false };
    ref = clipToBytes(raw.ref, MAX_REF_BYTES);
  }

  let props: Record<string, unknown> = {};
  if (raw.props !== undefined && raw.props !== null) {
    if (!isPlainObject(raw.props)) return { ok: false };
    let serialized: string;
    try {
      serialized = JSON.stringify(raw.props);
    } catch {
      return { ok: false };
    }
    if (byteLength(serialized) > MAX_PROPS_BYTES) return { ok: false };
    props = raw.props;
  }

  return { ok: true, event: { eid: raw.eid, t: raw.t as EventType, ts: raw.ts, p: path, ref, props } };
}

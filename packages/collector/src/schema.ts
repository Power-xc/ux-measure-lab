// Wire contract. Fixed by measurement-harness spec.md §4 (binding decision that
// unifies the three research documents). Do not rename keys or enum values without
// changing the ingest contract in lockstep — the SDK and /api/ingest share this shape.

/** Collector + wire schema version. Bumped when the envelope or enum changes. */
export const COLLECTOR_VERSION = "1";

/**
 * Wire event type enum. spec.md §4 fixes exactly these eight values.
 * `custom` (ingest research doc) is excluded from v1; `route` and `s_*` are included.
 */
export const WIRE_EVENT_TYPES = ["pv", "click", "rage", "dead", "scroll", "route", "s_start", "s_end"] as const;

export type WireEventType = (typeof WIRE_EVENT_TYPES)[number];

/** Per-event property bag. Type-specific fields (sel, pct, from/to, reason, seq, pvid...) live here. */
export type EventProps = Record<string, string | number | boolean | null>;

/**
 * A single wire event. Kept to the exact fields spec.md §4 lists:
 * `{ eid, t, ts, p, ref?, props }`. Everything type-specific goes inside `props`
 * so the envelope stays stable across event types.
 */
export interface WireEvent {
  /** Client-generated idempotency key. Server dedups on (site, eid). */
  eid: string;
  /** Event type. */
  t: WireEventType;
  /** Client timestamp in epoch milliseconds. Server stamps its own received_at. */
  ts: number;
  /** Normalized pathname (query stripped by default, see mask.ts). */
  p: string;
  /** Referrer origin only (no path/query). Omitted when absent. */
  ref?: string;
  /** Type-specific observation fields. */
  props: EventProps;
}

/**
 * Batch envelope. Fixed by spec.md §4 to the ingest form `{ k, sent_at, sid, aid, events }`.
 * The visitor id is `aid` on the wire (SDK research doc's `vid` is unified to `aid` here).
 */
export interface BatchEnvelope {
  /** Public site key (destination project). Not a secret; server enforces origin + rate. */
  k: string;
  /** ISO-8601 timestamp of when the batch was sent (skew-correction anchor). */
  sent_at: string;
  /** Session id. */
  sid: string;
  /** Anonymous visitor id (pseudonymous). */
  aid: string;
  /** Events in the batch. SDK flushes at 20; ingest accepts up to 50. */
  events: WireEvent[];
}

/** Reasons a session lifecycle event is emitted (carried in props of s_start/s_end). */
export type SessionReason = "new" | "timeout" | "maxdur";

/** SPA route change kinds (carried in props of `route`). */
export type RouteKind = "push" | "replace" | "pop" | "hash";

/** Callback the capture modules use to hand a built observation to the pipeline. */
export type EmitFn = (type: WireEventType, props: EventProps) => void;

/** Build a batch envelope from a session context and a set of events. */
export function buildEnvelope(context: { key: string; sid: string; aid: string; sentAt: string }, events: WireEvent[]): BatchEnvelope {
  return { k: context.key, sent_at: context.sentAt, sid: context.sid, aid: context.aid, events };
}

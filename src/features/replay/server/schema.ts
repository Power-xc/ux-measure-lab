// Replay chunk envelope validation. spec.md (session-replay) §7·§8: replay wire is
// separate from the event envelope, and a chunk that would break the privacy policy
// (surviving form values, dangerous URL schemes) is rejected WHOLE — a partial drop
// could silently keep sensitive content flowing.

export const REPLAY_PURPOSE_VERSION = "replay-v1";
export const MAX_EVENTS_PER_CHUNK = 200;
export const MAX_SEQUENCE = 9_999;

export type ReplayChunk = {
  k: string;
  recordingId: string;
  sessionId: string;
  anonymousId: string;
  sequence: number;
  startedAt: string;
  endedAt: string;
  purposeVersion: string;
  events: unknown[];
};

export type EnvelopeResult =
  | { ok: true; chunk: ReplayChunk }
  | { ok: false; error: "invalid_envelope" | "unsupported_purpose" | "privacy_violation" };

type UnknownRecord = Record<string, unknown>;

const ENVELOPE_KEYS = ["k", "recording_id", "session_id", "anonymous_id", "sequence", "started_at", "ended_at", "purpose_version", "encoding", "events"] as const;
const DANGEROUS_CONTENT_RE = /javascript:|vbscript:|data:text\/html/i;
const FORM_VALUE_KEYS = ["value", "checked", "selected"];
const MAX_SCAN_DEPTH = 64;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as UnknownRecord : null;
}

function opaqueId(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

function isoBound(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function isReplayEvent(value: unknown): boolean {
  const item = record(value);
  return item !== null
    && Number.isSafeInteger(item.type)
    && Number.isSafeInteger(item.timestamp)
    && Number(item.timestamp) >= 0;
}

// Serialized-DOM attribute maps must not carry form values; anything else may use
// these key names freely (e.g. rrweb input events are excluded upstream anyway).
function attributesCarryFormValues(value: unknown, depth: number): boolean {
  if (depth > MAX_SCAN_DEPTH) return true;
  if (Array.isArray(value)) return value.some((item) => attributesCarryFormValues(item, depth + 1));
  const item = record(value);
  if (!item) return false;
  const attributes = record(item.attributes);
  if (attributes && FORM_VALUE_KEYS.some((key) => key in attributes)) return true;
  return Object.values(item).some((child) => attributesCarryFormValues(child, depth + 1));
}

export function violatesPrivacyPolicy(events: readonly unknown[]): boolean {
  if (DANGEROUS_CONTENT_RE.test(JSON.stringify(events))) return true;
  return events.some((event) => attributesCarryFormValues(event, 0));
}

export function parseReplayEnvelope(value: unknown): EnvelopeResult {
  const item = record(value);
  if (!item || !ENVELOPE_KEYS.every((key) => key in item) || Object.keys(item).some((key) => !ENVELOPE_KEYS.includes(key as (typeof ENVELOPE_KEYS)[number]))) {
    return { ok: false, error: "invalid_envelope" };
  }
  const k = opaqueId(item.k, 128);
  const recordingId = opaqueId(item.recording_id, 64);
  const sessionId = opaqueId(item.session_id, 64);
  const anonymousId = opaqueId(item.anonymous_id, 128);
  const startedAtMs = isoBound(item.started_at);
  const endedAtMs = isoBound(item.ended_at);
  const sequenceValid = Number.isSafeInteger(item.sequence) && Number(item.sequence) >= 0 && Number(item.sequence) <= MAX_SEQUENCE;
  if (!k || !recordingId || !sessionId || !anonymousId || startedAtMs === null || endedAtMs === null || !sequenceValid) {
    return { ok: false, error: "invalid_envelope" };
  }
  if (startedAtMs > endedAtMs || item.encoding !== "json") return { ok: false, error: "invalid_envelope" };
  if (!Array.isArray(item.events) || item.events.length === 0 || item.events.length > MAX_EVENTS_PER_CHUNK || !item.events.every(isReplayEvent)) {
    return { ok: false, error: "invalid_envelope" };
  }
  if (item.purpose_version !== REPLAY_PURPOSE_VERSION) return { ok: false, error: "unsupported_purpose" };
  if (violatesPrivacyPolicy(item.events)) return { ok: false, error: "privacy_violation" };
  return {
    ok: true,
    chunk: {
      k,
      recordingId,
      sessionId,
      anonymousId,
      sequence: Number(item.sequence),
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      purposeVersion: REPLAY_PURPOSE_VERSION,
      events: item.events,
    },
  };
}

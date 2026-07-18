// Bounded replay chunks. spec.md (session-replay) §7: every recording has hard
// quotas for events, bytes, chunks and duration. When a quota trips, the recorder
// pauses instead of degrading privacy or buffering without limit.

export type ReplayChunkEnvelope = {
  k: string;
  recording_id: string;
  session_id: string;
  anonymous_id: string;
  sequence: number;
  started_at: string;
  ended_at: string;
  purpose_version: string;
  encoding: "json";
  events: unknown[];
};

export type ReplayQuotas = {
  maxEventsPerChunk: number;
  maxChunkBytes: number;
  maxChunksPerRecording: number;
  maxRecordingMs: number;
  maxRecordingBytes: number;
};

export const DEFAULT_REPLAY_QUOTAS: ReplayQuotas = {
  maxEventsPerChunk: 200,
  maxChunkBytes: 256 * 1024,
  maxChunksPerRecording: 300,
  maxRecordingMs: 30 * 60_000,
  maxRecordingBytes: 20 * 1024 * 1024,
};

export type QuotaBreach = "chunk_count" | "recording_bytes" | "recording_duration";

type ChunkMeta = {
  k: string;
  recordingId: string;
  sessionId: string;
  anonymousId: string;
  purposeVersion: string;
};

function byteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export class ReplayChunkBuilder {
  private readonly meta: ChunkMeta;
  private readonly quotas: ReplayQuotas;
  private readonly startedAtMs: number;
  private events: unknown[] = [];
  private chunkBytes = 0;
  private chunkStartedAt: number | null = null;
  private lastEventAt = 0;
  private sequence = 0;
  private totalBytes = 0;

  constructor(meta: ChunkMeta, quotas: ReplayQuotas, startedAtMs: number) {
    this.meta = meta;
    this.quotas = quotas;
    this.startedAtMs = startedAtMs;
  }

  /** Returns the breach that should pause the recording, or null when within quota. */
  breach(nowMs: number): QuotaBreach | null {
    if (this.sequence >= this.quotas.maxChunksPerRecording) return "chunk_count";
    if (this.totalBytes > this.quotas.maxRecordingBytes) return "recording_bytes";
    if (nowMs - this.startedAtMs > this.quotas.maxRecordingMs) return "recording_duration";
    return null;
  }

  /** Buffer one sanitized event. Returns a full envelope when the chunk boundary is hit. */
  push(event: unknown, nowMs: number): ReplayChunkEnvelope | null {
    const size = byteSize(event);
    this.events.push(event);
    this.chunkBytes += size;
    this.totalBytes += size;
    this.chunkStartedAt = this.chunkStartedAt ?? nowMs;
    this.lastEventAt = nowMs;
    if (this.events.length >= this.quotas.maxEventsPerChunk || this.chunkBytes >= this.quotas.maxChunkBytes) {
      return this.flush(nowMs);
    }
    return null;
  }

  /** Emit the pending events as an envelope; null when nothing is buffered. */
  flush(nowMs: number): ReplayChunkEnvelope | null {
    if (this.events.length === 0) return null;
    const envelope: ReplayChunkEnvelope = {
      k: this.meta.k,
      recording_id: this.meta.recordingId,
      session_id: this.meta.sessionId,
      anonymous_id: this.meta.anonymousId,
      sequence: this.sequence,
      started_at: new Date(this.chunkStartedAt ?? nowMs).toISOString(),
      ended_at: new Date(this.lastEventAt || nowMs).toISOString(),
      purpose_version: this.meta.purposeVersion,
      encoding: "json",
      events: this.events,
    };
    this.sequence += 1;
    this.events = [];
    this.chunkBytes = 0;
    this.chunkStartedAt = null;
    return envelope;
  }

  /** Withdrawal path: drop everything that has not been sent. Nothing is flushed. */
  clear(): void {
    this.events = [];
    this.chunkBytes = 0;
    this.chunkStartedAt = null;
  }

  pendingCount(): number {
    return this.events.length;
  }
}

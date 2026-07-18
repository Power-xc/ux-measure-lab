// Replay recorder orchestration. spec.md (session-replay) §6 lifecycle:
// disabled → consented → paused/withdrawn/ended. The recording engine is injected
// and lazy-loaded so the SDK stays dependency-free and NOTHING engine-related runs
// before an explicit replay grant (SR-01). Withdrawal clears unsent buffers (SR-04).

import type { ReplayConsentGate } from "./replay-consent.ts";
import { ReplayChunkBuilder, type ReplayChunkEnvelope, type ReplayQuotas } from "./replay-chunk.ts";
import { sanitizeReplayEvent, type ReplayMaskPolicy } from "./replay-sanitize.ts";

export type ReplayRecorderState = "disabled" | "consented" | "paused" | "withdrawn" | "ended";

/** A recording engine starts emitting serialized events and returns its stop function. */
export type RecordingEngine = {
  start(emit: (event: unknown) => void): () => void;
};

export type ReplayRecorderConfig = {
  gate: ReplayConsentGate;
  loadEngine: () => Promise<RecordingEngine>;
  send: (envelope: ReplayChunkEnvelope) => void;
  siteKey: string;
  sessionId: string;
  anonymousId: string;
  purposeVersion: string;
  quotas: ReplayQuotas;
  policy?: ReplayMaskPolicy;
  now: () => number;
  createRecordingId: () => string;
};

export class ReplayRecorder {
  private readonly config: ReplayRecorderConfig;
  private state: ReplayRecorderState = "disabled";
  private stopEngine: (() => void) | null = null;
  private chunks: ReplayChunkBuilder | null = null;
  private recordingId: string | null = null;

  constructor(config: ReplayRecorderConfig) {
    this.config = config;
  }

  current(): ReplayRecorderState {
    return this.state;
  }

  currentRecordingId(): string | null {
    return this.recordingId;
  }

  /** No engine load, no identifier and no network before an explicit replay grant. */
  async start(): Promise<ReplayRecorderState> {
    if (this.state !== "disabled" && this.state !== "paused") return this.state;
    if (!this.config.gate.isRecordingAllowed()) return this.state;
    const engine = await this.config.loadEngine();
    if (this.config.gate.current() === "withdrawn") return this.state;
    if (!this.recordingId) {
      this.recordingId = this.config.createRecordingId();
      this.chunks = new ReplayChunkBuilder(
        {
          k: this.config.siteKey,
          recordingId: this.recordingId,
          sessionId: this.config.sessionId,
          anonymousId: this.config.anonymousId,
          purposeVersion: this.config.purposeVersion,
        },
        this.config.quotas,
        this.config.now(),
      );
    }
    this.stopEngine = engine.start((event) => this.handleEvent(event));
    this.state = "consented";
    return this.state;
  }

  private handleEvent(event: unknown): void {
    if (this.state !== "consented" || !this.chunks) return;
    const nowMs = this.config.now();
    const breach = this.chunks.breach(nowMs);
    if (breach) {
      this.pause();
      return;
    }
    const sanitized = sanitizeReplayEvent(event, this.config.policy);
    if (sanitized === null) return;
    const envelope = this.chunks.push(sanitized, nowMs);
    if (envelope) this.config.send(envelope);
  }

  /** Backpressure or hidden page: stop the engine but keep buffered events for resume. */
  pause(): void {
    if (this.state !== "consented") return;
    this.stopEngine?.();
    this.stopEngine = null;
    this.state = "paused";
  }

  /** Withdrawal stops immediately, drops unsent events and never restarts by itself. */
  withdraw(): void {
    this.stopEngine?.();
    this.stopEngine = null;
    this.chunks?.clear();
    this.config.gate.set("withdrawn");
    this.state = "withdrawn";
  }

  /** Normal end of a recording: flush the bounded final chunk. */
  end(): void {
    if (this.state !== "consented" && this.state !== "paused") return;
    this.stopEngine?.();
    this.stopEngine = null;
    const envelope = this.chunks?.flush(this.config.now()) ?? null;
    if (envelope) this.config.send(envelope);
    this.state = "ended";
  }
}

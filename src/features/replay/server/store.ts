// Replay storage contract. spec.md (session-replay) §7·§10: metadata and payload
// stay separate from behavior events, (site, recording, sequence) is the idempotency
// key, every recording carries hard quotas, and expiry means hard delete.

export const REPLAY_RETENTION_MAX_DAYS = 30;
export const RECORDING_MAX_CHUNKS = 300;
export const RECORDING_MAX_BYTES = 20 * 1024 * 1024;

export type ReplayRecordingMeta = {
  siteId: string;
  recordingId: string;
  sessionId: string;
  anonymousIdHash: string;
  startedAt: string;
  endedAt: string;
  chunkCount: number;
  byteSize: number;
  purposeVersion: string;
  expiresAt: string;
};

export type AppendChunkInput = {
  siteId: string;
  recordingId: string;
  sessionId: string;
  anonymousIdHash: string;
  sequence: number;
  startedAt: string;
  endedAt: string;
  byteSize: number;
  payload: string;
  purposeVersion: string;
  expiresAt: string;
};

export type AppendOutcome = "stored" | "duplicate" | "chunk_quota" | "byte_quota";

export type StoredChunk = { sequence: number; payload: string };

export interface ReplayStore {
  appendChunk(input: AppendChunkInput): Promise<AppendOutcome>;
  listRecordings(siteId: string): Promise<ReplayRecordingMeta[]>;
  readChunks(siteId: string, recordingId: string): Promise<StoredChunk[]>;
  deleteRecording(siteId: string, recordingId: string): Promise<number>;
  deleteVisitor(siteId: string, anonymousIdHash: string): Promise<number>;
  purgeExpired(nowIso: string): Promise<number>;
}

type RecordingEntry = {
  meta: ReplayRecordingMeta;
  chunks: Map<number, { payload: string; byteSize: number }>;
};

export class InMemoryReplayStore implements ReplayStore {
  private readonly sites = new Map<string, Map<string, RecordingEntry>>();

  private siteRecordings(siteId: string): Map<string, RecordingEntry> {
    const existing = this.sites.get(siteId);
    if (existing) return existing;
    const created = new Map<string, RecordingEntry>();
    this.sites.set(siteId, created);
    return created;
  }

  async appendChunk(input: AppendChunkInput): Promise<AppendOutcome> {
    const recordings = this.siteRecordings(input.siteId);
    const entry = recordings.get(input.recordingId) ?? {
      meta: {
        siteId: input.siteId,
        recordingId: input.recordingId,
        sessionId: input.sessionId,
        anonymousIdHash: input.anonymousIdHash,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        chunkCount: 0,
        byteSize: 0,
        purposeVersion: input.purposeVersion,
        expiresAt: input.expiresAt,
      },
      chunks: new Map(),
    };
    if (entry.chunks.has(input.sequence)) return "duplicate";
    if (entry.chunks.size >= RECORDING_MAX_CHUNKS) return "chunk_quota";
    if (entry.meta.byteSize + input.byteSize > RECORDING_MAX_BYTES) return "byte_quota";
    entry.chunks.set(input.sequence, { payload: input.payload, byteSize: input.byteSize });
    entry.meta.chunkCount = entry.chunks.size;
    entry.meta.byteSize += input.byteSize;
    if (input.startedAt < entry.meta.startedAt) entry.meta.startedAt = input.startedAt;
    if (input.endedAt > entry.meta.endedAt) entry.meta.endedAt = input.endedAt;
    recordings.set(input.recordingId, entry);
    return "stored";
  }

  async listRecordings(siteId: string): Promise<ReplayRecordingMeta[]> {
    return [...this.siteRecordings(siteId).values()]
      .map((entry) => ({ ...entry.meta }))
      .sort((left, right) => (left.startedAt < right.startedAt ? 1 : -1));
  }

  async readChunks(siteId: string, recordingId: string): Promise<StoredChunk[]> {
    const entry = this.siteRecordings(siteId).get(recordingId);
    if (!entry) return [];
    return [...entry.chunks.entries()]
      .sort(([left], [right]) => left - right)
      .map(([sequence, chunk]) => ({ sequence, payload: chunk.payload }));
  }

  async deleteRecording(siteId: string, recordingId: string): Promise<number> {
    return this.siteRecordings(siteId).delete(recordingId) ? 1 : 0;
  }

  async deleteVisitor(siteId: string, anonymousIdHash: string): Promise<number> {
    const recordings = this.siteRecordings(siteId);
    let deleted = 0;
    for (const [recordingId, entry] of recordings) {
      if (entry.meta.anonymousIdHash === anonymousIdHash) {
        recordings.delete(recordingId);
        deleted += 1;
      }
    }
    return deleted;
  }

  async purgeExpired(nowIso: string): Promise<number> {
    let purged = 0;
    for (const recordings of this.sites.values()) {
      for (const [recordingId, entry] of recordings) {
        if (entry.meta.expiresAt <= nowIso) {
          recordings.delete(recordingId);
          purged += 1;
        }
      }
    }
    return purged;
  }
}

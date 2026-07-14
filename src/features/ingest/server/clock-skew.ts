// Clock-skew correction (research-ingest.md §5.2).
// The server derives an authoritative event time from the client-claimed time
// using the batch-level offset, then clamps it to a sane window. Partition
// placement always uses `received_at` (§3.2), so a forged `ts` cannot move a row
// into another partition — this only affects query/sort ordering.

export type SkewLimits = {
  maxFutureMs: number; // reject drift ahead of the server clock
  maxPastMs: number; // reject drift older than retention
};

export type SkewInput = {
  clientTsMs: number; // parsed event `ts`
  sentAtMs: number; // parsed batch `sent_at`
  receivedAtMs: number; // server receive time (authoritative)
};

// offset ≈ received_at − sent_at ; ts = client_ts + offset (clamped).
export function correctTimestamp(input: SkewInput, limits: SkewLimits): number {
  const offset = input.receivedAtMs - input.sentAtMs;
  const projected = input.clientTsMs + offset;
  const upper = input.receivedAtMs + limits.maxFutureMs;
  const lower = input.receivedAtMs - limits.maxPastMs;
  return Math.min(Math.max(projected, lower), upper);
}

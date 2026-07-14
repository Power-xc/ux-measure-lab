type BucketState = {
  capacity: number;
  refillPerMs: number;
  tokens: number;
  updatedAt: number | null;
};

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterMs: number };

function available(bucket: BucketState, nowMs: number): number {
  if (bucket.updatedAt === null) return bucket.capacity;
  const elapsed = Math.max(0, nowMs - bucket.updatedAt);
  return Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillPerMs);
}

function waitForToken(tokens: number, refillPerMs: number): number {
  return Math.max(1, Math.ceil((1 - tokens) / refillPerMs));
}

export class LocalPostHogRateLimiter {
  private readonly minute: BucketState = { capacity: 240, refillPerMs: 240 / 60_000, tokens: 240, updatedAt: null };
  private readonly hour: BucketState = { capacity: 2_400, refillPerMs: 2_400 / 3_600_000, tokens: 2_400, updatedAt: null };

  consume(nowMs: number): RateLimitDecision {
    const minuteTokens = available(this.minute, nowMs);
    const hourTokens = available(this.hour, nowMs);
    if (minuteTokens < 1 || hourTokens < 1) {
      const minuteWait = minuteTokens < 1 ? waitForToken(minuteTokens, this.minute.refillPerMs) : 0;
      const hourWait = hourTokens < 1 ? waitForToken(hourTokens, this.hour.refillPerMs) : 0;
      return { allowed: false, retryAfterMs: Math.max(minuteWait, hourWait) };
    }
    this.minute.tokens = minuteTokens - 1;
    this.hour.tokens = hourTokens - 1;
    this.minute.updatedAt = nowMs;
    this.hour.updatedAt = nowMs;
    return { allowed: true };
  }
}

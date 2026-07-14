// Durable rate limiter (research-ingest.md §4.5).
// The existing in-memory limiter in shared/server/request-guards.ts is a single
// process counter — useless across serverless instances. This keeps the same
// `RateLimitResult` shape but makes the backend injectable: the real backend is
// Upstash Redis (shared across instances); the in-memory fake is for tests.

import type { RateLimitResult } from "../../../shared/server/request-guards.ts";

export type RateLimitConfig = { limit: number; windowMs: number };

export interface DurableRateLimiter {
  check(key: string, config: RateLimitConfig, nowMs: number): Promise<RateLimitResult>;
}

export class InMemoryDurableRateLimiter implements DurableRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  async check(key: string, config: RateLimitConfig, nowMs: number): Promise<RateLimitResult> {
    const current = this.windows.get(key);
    if (!current || current.resetAt <= nowMs) {
      this.windows.set(key, { count: 1, resetAt: nowMs + config.windowMs });
      return { limited: false, retryAfter: 0 };
    }
    current.count += 1;
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - nowMs) / 1_000));
    return { limited: current.count > config.limit, retryAfter };
  }
}

import { InMemoryDurableRateLimiter, type DurableRateLimiter, type RateLimitConfig } from "../rate-limit.ts";
import type { RateLimitResult } from "../../../../shared/server/request-guards.ts";

export type UpstashRestConfig = {
  url: string;
  token: string;
};

type CommandResult = { result: unknown };

function isCommandResults(value: unknown): value is CommandResult[] {
  return Array.isArray(value)
    && value.length === 3
    && value.every((entry) => typeof entry === "object" && entry !== null && "result" in entry);
}

function integer(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) ? parsed : null;
}

export class UpstashRateLimiter implements DurableRateLimiter {
  private readonly config: UpstashRestConfig;
  private readonly fetcher: typeof fetch;
  private readonly fallback: DurableRateLimiter;

  constructor(
    config: UpstashRestConfig,
    fetcher: typeof fetch = fetch,
    fallback?: DurableRateLimiter,
  ) {
    this.config = config;
    this.fetcher = fetcher;
    this.fallback = fallback ?? new InMemoryDurableRateLimiter();
  }

  async check(key: string, config: RateLimitConfig, nowMs: number): Promise<RateLimitResult> {
    try {
      return await this.checkShared(key, config);
    } catch {
      // 전역 일관성은 잃지만 무제한 허용을 피하려고 프로세스별 제한으로 강등한다.
      return this.fallback.check(key, config, nowMs);
    }
  }

  private async checkShared(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    const redisKey = `ux-measure:rate:${key}`;
    const response = await this.fetcher(`${this.config.url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", redisKey],
        ["PEXPIRE", redisKey, config.windowMs, "NX"],
        ["PTTL", redisKey],
      ]),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("upstash_rate_limit_failed");
    const payload: unknown = await response.json();
    if (!isCommandResults(payload)) throw new Error("upstash_rate_limit_response_invalid");
    const count = integer(payload[0].result);
    const ttlMs = integer(payload[2].result);
    if (count === null || ttlMs === null || ttlMs < 0) throw new Error("upstash_rate_limit_response_invalid");
    return {
      limited: count > config.limit,
      retryAfter: count > config.limit ? Math.max(1, Math.ceil(ttlMs / 1_000)) : 0,
    };
  }
}

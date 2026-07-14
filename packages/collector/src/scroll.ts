// Scroll depth milestones. research-sdk.md §6: pct = (scrollTop + viewport) /
// scrollHeight, throttled ~250ms; the 25/50/75/100 milestones fire once per
// pageview; the max pct is reported when the pageview ends. Pure `update()` so
// tests feed synthetic metrics with fixed timestamps.

import type { EmitFn } from "./schema.ts";

const MILESTONES = [25, 50, 75, 100] as const;
const THROTTLE_MS = 250;

/** A reading of the current scroll position. Injected so tests need no real layout. */
export interface ScrollMetrics {
  scrollTop: number;
  viewport: number;
  scrollHeight: number;
}

function computePct(metrics: ScrollMetrics): number {
  if (metrics.scrollHeight <= 0) return 0;
  const ratio = (metrics.scrollTop + metrics.viewport) / metrics.scrollHeight;
  const pct = Math.round(ratio * 100);
  return Math.max(0, Math.min(100, pct));
}

export class ScrollTracker {
  private emitted = new Set<number>();
  private maxPct = 0;
  private lastSampleAt = -Infinity;
  private readonly emit: EmitFn;

  constructor(emit: EmitFn) {
    this.emit = emit;
  }

  /** Reset for a new pageview (SPA route change or fresh load). */
  reset(): void {
    this.emitted = new Set<number>();
    this.maxPct = 0;
    this.lastSampleAt = -Infinity;
  }

  /** Highest reached percentage in the current pageview. */
  maxReached(): number {
    return this.maxPct;
  }

  /**
   * Sample the scroll position. Throttled to one effective sample per THROTTLE_MS.
   * Emits a `scroll` event the first time each milestone is reached or passed.
   */
  update(metrics: ScrollMetrics, now: number): void {
    if (now - this.lastSampleAt < THROTTLE_MS) return;
    this.lastSampleAt = now;
    const pct = computePct(metrics);
    if (pct > this.maxPct) this.maxPct = pct;
    for (const milestone of MILESTONES) {
      if (pct >= milestone && !this.emitted.has(milestone)) {
        this.emitted.add(milestone);
        this.emit("scroll", { pct: this.maxPct, ms: milestone });
      }
    }
  }
}

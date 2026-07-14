import type { MeasurementQuery, SegmentFilter, TimeWindow } from "../contract.ts";

type FunnelQuery = Extract<MeasurementQuery, { capability: "funnel" }>;
type InteractionQuery = Extract<MeasurementQuery, { capability: "interaction" }>;
type PathQuery = Extract<MeasurementQuery, { capability: "paths" }>;

export type InteractionSignal = InteractionQuery["signals"][number];
export type FunnelCountInput = {
  steps: readonly string[];
  window: TimeWindow;
  segment?: SegmentFilter;
};
export type InteractionCountInput = {
  signals: readonly InteractionSignal[];
  window: TimeWindow;
  target?: string;
};
export type PathReachInput = {
  startEvent: string;
  endEvent: string;
  window: TimeWindow;
};
export type InteractionCountResult = {
  sampleSize: number;
  counts: Partial<Record<InteractionSignal, number>>;
};
export type PathReachResult = {
  startCount: number;
  reachedCount: number;
};

export interface AggregateReader {
  funnelCounts(input: FunnelCountInput, signal?: AbortSignal): Promise<readonly number[]>;
  interactionCounts(input: InteractionCountInput, signal?: AbortSignal): Promise<InteractionCountResult>;
  pathReach(input: PathReachInput, signal?: AbortSignal): Promise<PathReachResult>;
}

export type InMemoryAggregateSeed = {
  funnels?: readonly { input: FunnelCountInput | FunnelQuery; counts: readonly number[] }[];
  interactions?: readonly { input: InteractionCountInput | InteractionQuery; result: InteractionCountResult }[];
  paths?: readonly { input: PathReachInput | PathQuery; result: PathReachResult }[];
};

// 통합 교체 지점: 실운영에서는 AggregateReader 구현만 영속 집계 소스로 바꾸고, 미설정 환경은 빈 기본값을 유지한다.

function normalizedTime(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : value.trim();
}

function windowKey(window: TimeWindow): string {
  return `${normalizedTime(window.from)}\u0000${normalizedTime(window.to)}`;
}

function funnelKey(input: FunnelCountInput): string {
  const segment = input.segment ? `${input.segment.dimension.trim()}=${input.segment.value.trim()}` : "";
  return `${input.steps.map((step) => step.trim()).join("\u0000")}\u0001${windowKey(input.window)}\u0001${segment}`;
}

function interactionKey(input: InteractionCountInput): string {
  const signals = [...new Set(input.signals)].sort().join("\u0000");
  return `${signals}\u0001${windowKey(input.window)}\u0001${input.target?.trim() ?? ""}`;
}

function pathKey(input: PathReachInput): string {
  return `${input.startEvent.trim()}\u0000${input.endEvent.trim()}\u0001${windowKey(input.window)}`;
}

function copyInteractionResult(result: InteractionCountResult): InteractionCountResult {
  return { sampleSize: result.sampleSize, counts: { ...result.counts } };
}

export class InMemoryAggregateReader implements AggregateReader {
  private readonly funnels = new Map<string, readonly number[]>();
  private readonly interactions = new Map<string, InteractionCountResult>();
  private readonly paths = new Map<string, PathReachResult>();

  constructor(seed: InMemoryAggregateSeed = {}) {
    for (const item of seed.funnels ?? []) this.funnels.set(funnelKey(item.input), [...item.counts]);
    for (const item of seed.interactions ?? []) {
      this.interactions.set(interactionKey(item.input), copyInteractionResult(item.result));
    }
    for (const item of seed.paths ?? []) this.paths.set(pathKey(item.input), { ...item.result });
  }

  async funnelCounts(input: FunnelCountInput, signal?: AbortSignal): Promise<readonly number[]> {
    signal?.throwIfAborted();
    return [...(this.funnels.get(funnelKey(input)) ?? input.steps.map(() => 0))];
  }

  async interactionCounts(input: InteractionCountInput, signal?: AbortSignal): Promise<InteractionCountResult> {
    signal?.throwIfAborted();
    return copyInteractionResult(this.interactions.get(interactionKey(input)) ?? { sampleSize: 0, counts: {} });
  }

  async pathReach(input: PathReachInput, signal?: AbortSignal): Promise<PathReachResult> {
    signal?.throwIfAborted();
    return { ...(this.paths.get(pathKey(input)) ?? { startCount: 0, reachedCount: 0 }) };
  }
}

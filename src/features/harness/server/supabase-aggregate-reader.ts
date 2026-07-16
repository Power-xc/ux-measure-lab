import type {
  AggregateReader,
  FunnelCountInput,
  InteractionCountInput,
  InteractionCountResult,
  InteractionSignal,
  PathReachInput,
  PathReachResult,
  SegmentedFunnelInput,
  SegmentedFunnelRow,
} from "./aggregate-reader.ts";

export type SupabaseAggregateReaderConfig = {
  url: string;
  serviceRoleKey: string;
  siteId: string;
};

type RpcName = "funnel_counts" | "interaction_counts" | "path_reach" | "segmented_funnel_counts";
type UnknownRecord = Record<string, unknown>;

type FunnelRow = {
  step: string;
  users: number;
};

type InteractionRow = {
  signal: string;
  count: number;
  sample_size: number;
};

type PathReachRow = {
  started: number;
  reached: number;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isFunnelRow(value: unknown): value is FunnelRow {
  return isRecord(value)
    && hasExactKeys(value, ["step", "users"])
    && typeof value.step === "string"
    && isCount(value.users);
}

function isInteractionRow(value: unknown): value is InteractionRow {
  return isRecord(value)
    && hasExactKeys(value, ["signal", "count", "sample_size"])
    && typeof value.signal === "string"
    && isCount(value.count)
    && isCount(value.sample_size);
}

function isPathReachRow(value: unknown): value is PathReachRow {
  return isRecord(value)
    && hasExactKeys(value, ["started", "reached"])
    && isCount(value.started)
    && isCount(value.reached)
    && value.reached <= value.started;
}

function invalidResponse(name: RpcName): never {
  throw new Error(`supabase_${name}_response_invalid`);
}

function parseFunnelRows(payload: unknown, steps: readonly string[]): readonly number[] {
  if (!Array.isArray(payload) || payload.length !== steps.length) invalidResponse("funnel_counts");
  return payload.map((row, index) => {
    if (!isFunnelRow(row) || row.step !== steps[index]) invalidResponse("funnel_counts");
    return row.users;
  });
}

function parseInteractionRows(
  payload: unknown,
  signals: readonly InteractionSignal[],
): InteractionCountResult {
  if (!Array.isArray(payload) || payload.length !== signals.length) invalidResponse("interaction_counts");
  let sampleSize: number | undefined;
  const counts: Partial<Record<InteractionSignal, number>> = {};
  for (const [index, row] of payload.entries()) {
    if (!isInteractionRow(row) || row.signal !== signals[index]) invalidResponse("interaction_counts");
    if (sampleSize !== undefined && sampleSize !== row.sample_size) invalidResponse("interaction_counts");
    sampleSize = row.sample_size;
    counts[signals[index]] = row.count;
  }
  return { sampleSize: sampleSize ?? 0, counts };
}

function parsePathReachRows(payload: unknown): PathReachResult {
  if (!Array.isArray(payload) || payload.length !== 1 || !isPathReachRow(payload[0])) {
    invalidResponse("path_reach");
  }
  return { startCount: payload[0].started, reachedCount: payload[0].reached };
}

type SegmentedRawRow = {
  value: string;
  step: string;
  users: number;
};

function isSegmentedRawRow(value: unknown): value is SegmentedRawRow {
  return isRecord(value)
    && hasExactKeys(value, ["value", "step", "users"])
    && typeof value.value === "string"
    && value.value.length > 0
    && typeof value.step === "string"
    && isCount(value.users);
}

// RPC는 값별로 step 순서가 이어진 평평한 행을 반환한다. 값 단위로 재조립하며 순서·중복을 검증한다.
function parseSegmentedRows(payload: unknown, steps: readonly string[]): readonly SegmentedFunnelRow[] {
  if (!Array.isArray(payload) || payload.length % steps.length !== 0) invalidResponse("segmented_funnel_counts");
  const rows: SegmentedFunnelRow[] = [];
  for (let offset = 0; offset < payload.length; offset += steps.length) {
    const group = payload.slice(offset, offset + steps.length);
    const first = group[0];
    if (!isSegmentedRawRow(first)) invalidResponse("segmented_funnel_counts");
    const counts = group.map((row, index) => {
      if (!isSegmentedRawRow(row) || row.value !== first.value || row.step !== steps[index]) {
        invalidResponse("segmented_funnel_counts");
      }
      return row.users;
    });
    if (rows.some((row) => row.value === first.value)) invalidResponse("segmented_funnel_counts");
    rows.push({ value: first.value, counts });
  }
  return rows;
}

export class SupabaseAggregateReader implements AggregateReader {
  private readonly config: SupabaseAggregateReaderConfig;
  private readonly fetcher: typeof fetch;

  constructor(config: SupabaseAggregateReaderConfig, fetcher: typeof fetch = fetch) {
    this.config = config;
    this.fetcher = fetcher;
  }

  private async rpc(name: RpcName, body: UnknownRecord, signal?: AbortSignal): Promise<unknown> {
    const baseUrl = this.config.url.replace(/\/$/, "");
    const response = await this.fetcher(`${baseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        apikey: this.config.serviceRoleKey,
        Authorization: `Bearer ${this.config.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal,
    });
    if (!response.ok) throw new Error(`supabase_${name}_failed`);
    try {
      return await response.json() as unknown;
    } catch {
      return invalidResponse(name);
    }
  }

  async funnelCounts(input: FunnelCountInput, signal?: AbortSignal): Promise<readonly number[]> {
    if (input.segment) throw new Error("supabase_funnel_segment_unsupported");
    const payload = await this.rpc("funnel_counts", {
      p_site_id: this.config.siteId,
      p_steps: input.steps,
      p_from: input.window.from,
      p_to: input.window.to,
    }, signal);
    return parseFunnelRows(payload, input.steps);
  }

  async interactionCounts(
    input: InteractionCountInput,
    signal?: AbortSignal,
  ): Promise<InteractionCountResult> {
    const payload = await this.rpc("interaction_counts", {
      p_site_id: this.config.siteId,
      p_signals: input.signals,
      p_from: input.window.from,
      p_to: input.window.to,
      p_target: input.target ?? null,
    }, signal);
    return parseInteractionRows(payload, input.signals);
  }

  async pathReach(input: PathReachInput, signal?: AbortSignal): Promise<PathReachResult> {
    const payload = await this.rpc("path_reach", {
      p_site_id: this.config.siteId,
      p_start_event: input.startEvent,
      p_end_event: input.endEvent,
      p_from: input.window.from,
      p_to: input.window.to,
    }, signal);
    return parsePathReachRows(payload);
  }

  async segmentedFunnelCounts(input: SegmentedFunnelInput, signal?: AbortSignal): Promise<readonly SegmentedFunnelRow[]> {
    const payload = await this.rpc("segmented_funnel_counts", {
      p_site_id: this.config.siteId,
      p_steps: input.steps,
      p_dimension: input.dimension,
      p_from: input.window.from,
      p_to: input.window.to,
    }, signal);
    return parseSegmentedRows(payload, input.steps);
  }
}

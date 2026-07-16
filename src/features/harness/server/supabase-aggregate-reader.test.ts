import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { SupabaseAggregateReader, type SupabaseAggregateReaderConfig } from "./supabase-aggregate-reader.ts";

type FetchCall = { url: string; init?: RequestInit };

const CONFIG: SupabaseAggregateReaderConfig = {
  url: "https://project.supabase.co/",
  serviceRoleKey: "service-key",
  siteId: "11111111-1111-1111-1111-111111111111",
};

const WINDOW = {
  from: "2026-07-01T00:00:00.000Z",
  to: "2026-07-08T00:00:00.000Z",
};

function fakeFetch(responses: readonly Response[]): { fetcher: typeof fetch; calls: FetchCall[] } {
  const queue = [...responses];
  const calls: FetchCall[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: input instanceof Request ? input.url : String(input), init });
    const response = queue.shift();
    if (!response) throw new Error("missing_fake_response");
    return response;
  };
  return { fetcher, calls };
}

test("SupabaseAggregateReader calls each aggregate RPC and maps valid rows", async () => {
  const fake = fakeFetch([
    Response.json([
      { step: "visit", users: 1_200 },
      { step: "signup", users: 420 },
    ]),
    Response.json([
      { signal: "rage", count: 12, sample_size: 300 },
      { signal: "error", count: 4, sample_size: 300 },
    ]),
    Response.json([{ started: 420, reached: 180 }]),
  ]);
  const reader = new SupabaseAggregateReader(CONFIG, fake.fetcher);

  assert.deepEqual(await reader.funnelCounts({ steps: ["visit", "signup"], window: WINDOW }), [1_200, 420]);
  assert.deepEqual(
    await reader.interactionCounts({ signals: ["rage", "error"], target: "/pricing", window: WINDOW }),
    { sampleSize: 300, counts: { rage: 12, error: 4 } },
  );
  assert.deepEqual(
    await reader.pathReach({ startEvent: "signup", endEvent: "activate", window: WINDOW }),
    { startCount: 420, reachedCount: 180 },
  );

  assert.deepEqual(fake.calls.map((call) => call.url), [
    "https://project.supabase.co/rest/v1/rpc/funnel_counts",
    "https://project.supabase.co/rest/v1/rpc/interaction_counts",
    "https://project.supabase.co/rest/v1/rpc/path_reach",
  ]);
  const funnelHeaders = new Headers(fake.calls[0].init?.headers);
  assert.equal(funnelHeaders.get("authorization"), "Bearer service-key");
  assert.equal(funnelHeaders.get("apikey"), "service-key");
  assert.deepEqual(JSON.parse(String(fake.calls[0].init?.body)) as unknown, {
    p_site_id: CONFIG.siteId,
    p_steps: ["visit", "signup"],
    p_from: WINDOW.from,
    p_to: WINDOW.to,
  });
  assert.deepEqual(JSON.parse(String(fake.calls[1].init?.body)) as unknown, {
    p_site_id: CONFIG.siteId,
    p_signals: ["rage", "error"],
    p_from: WINDOW.from,
    p_to: WINDOW.to,
    p_target: "/pricing",
  });
});

test("SupabaseAggregateReader rejects malformed aggregate rows", async () => {
  const fake = fakeFetch([
    Response.json([{ step: "signup", users: 10 }]),
    Response.json([{ signal: "rage", count: "12", sample_size: 300 }]),
    Response.json([{ started: 20, reached: 21 }]),
  ]);
  const reader = new SupabaseAggregateReader(CONFIG, fake.fetcher);

  await assert.rejects(
    reader.funnelCounts({ steps: ["visit"], window: WINDOW }),
    /funnel_counts_response_invalid/,
  );
  await assert.rejects(
    reader.interactionCounts({ signals: ["rage"], window: WINDOW }),
    /interaction_counts_response_invalid/,
  );
  await assert.rejects(
    reader.pathReach({ startEvent: "visit", endEvent: "signup", window: WINDOW }),
    /path_reach_response_invalid/,
  );
});

test("SupabaseAggregateReader rejects upstream errors and unsupported funnel segments", async () => {
  const fake = fakeFetch([new Response(null, { status: 503 })]);
  const reader = new SupabaseAggregateReader(CONFIG, fake.fetcher);

  await assert.rejects(
    reader.funnelCounts({ steps: ["visit"], window: WINDOW }),
    /supabase_funnel_counts_failed/,
  );
  await assert.rejects(
    reader.funnelCounts({
      steps: ["visit"],
      window: WINDOW,
      segment: { dimension: "plan", value: "team" },
    }),
    /supabase_funnel_segment_unsupported/,
  );
  assert.equal(fake.calls.length, 1);
});

test("SupabaseAggregateReader groups segmented funnel rows per variant value", async () => {
  const fake = fakeFetch([
    Response.json([
      { value: "baseline", step: "enter", users: 1_000 },
      { value: "baseline", step: "convert", users: 100 },
      { value: "v-1", step: "enter", users: 400 },
      { value: "v-1", step: "convert", users: 56 },
    ]),
  ]);
  const reader = new SupabaseAggregateReader(CONFIG, fake.fetcher);

  assert.deepEqual(
    await reader.segmentedFunnelCounts({ steps: ["enter", "convert"], dimension: "variant", window: WINDOW }),
    [
      { value: "baseline", counts: [1_000, 100] },
      { value: "v-1", counts: [400, 56] },
    ],
  );
  assert.equal(fake.calls[0].url, "https://project.supabase.co/rest/v1/rpc/segmented_funnel_counts");
  assert.deepEqual(JSON.parse(String(fake.calls[0].init?.body)) as unknown, {
    p_site_id: CONFIG.siteId,
    p_steps: ["enter", "convert"],
    p_dimension: "variant",
    p_from: WINDOW.from,
    p_to: WINDOW.to,
  });
});

test("SupabaseAggregateReader rejects segmented rows with broken grouping", async () => {
  const brokenStepOrder = fakeFetch([
    Response.json([
      { value: "v-1", step: "convert", users: 56 },
      { value: "v-1", step: "enter", users: 400 },
    ]),
  ]);
  await assert.rejects(
    new SupabaseAggregateReader(CONFIG, brokenStepOrder.fetcher)
      .segmentedFunnelCounts({ steps: ["enter", "convert"], dimension: "variant", window: WINDOW }),
    /segmented_funnel_counts_response_invalid/,
  );

  const duplicatedValue = fakeFetch([
    Response.json([
      { value: "v-1", step: "enter", users: 400 },
      { value: "v-1", step: "convert", users: 56 },
      { value: "v-1", step: "enter", users: 300 },
      { value: "v-1", step: "convert", users: 30 },
    ]),
  ]);
  await assert.rejects(
    new SupabaseAggregateReader(CONFIG, duplicatedValue.fetcher)
      .segmentedFunnelCounts({ steps: ["enter", "convert"], dimension: "variant", window: WINDOW }),
    /segmented_funnel_counts_response_invalid/,
  );
});

test("segmented funnel migration assigns visitors to their first variant value", async () => {
  const migration = await readFile(new URL("../../../../supabase/migrations/0003_segmented_funnel.sql", import.meta.url), "utf8");
  assert.match(migration, /distinct on \(e\.event_id\)/);
  assert.match(migration, /distinct on \(e\.anon_id\)/);
  assert.match(migration, /e\.props \? p_dimension/);
  assert.match(migration, /grant execute on function segmented_funnel_counts/);
});

test("aggregate RPC migration deduplicates retries and uses the collector selector key", async () => {
  const migration = await readFile(new URL("../../../../supabase/migrations/0002_aggregates.sql", import.meta.url), "utf8");
  assert.match(migration, /distinct on \(e\.event_id\)/);
  assert.match(migration, /e\.props ->> 'sel' = p_target/);
  assert.match(migration, /count\(distinct anon_id\)::bigint as sample_size/);
  assert.doesNotMatch(migration, /e\.props ->> 'target' = p_target/);
});

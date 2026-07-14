import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAggregateReader, type InMemoryAggregateSeed } from "./aggregate-reader.ts";

const WINDOW = { from: "2026-07-01T00:00:00.000Z", to: "2026-07-08T00:00:00.000Z" };

const SEED: InMemoryAggregateSeed = {
  funnels: [{
    input: { steps: ["visit", "signup", "activate"], window: WINDOW },
    counts: [1_200, 600, 240],
  }],
  interactions: [{
    input: { signals: ["rage", "dead"], window: WINDOW, target: "pricing" },
    result: { sampleSize: 500, counts: { rage: 32, dead: 18 } },
  }],
  paths: [{
    input: { startEvent: "signup", endEvent: "activate", window: WINDOW },
    result: { startCount: 600, reachedCount: 240 },
  }],
};

test("InMemoryAggregateReader returns seeded funnel, interaction, and path aggregates", async () => {
  const reader = new InMemoryAggregateReader(SEED);

  assert.deepEqual(
    await reader.funnelCounts({ steps: ["visit", "signup", "activate"], window: WINDOW }),
    [1_200, 600, 240],
  );
  assert.deepEqual(
    await reader.interactionCounts({ signals: ["dead", "rage"], window: WINDOW, target: "pricing" }),
    { sampleSize: 500, counts: { rage: 32, dead: 18 } },
  );
  assert.deepEqual(
    await reader.pathReach({ startEvent: "signup", endEvent: "activate", window: WINDOW }),
    { startCount: 600, reachedCount: 240 },
  );
});

test("InMemoryAggregateReader uses honest empty aggregates for unseeded queries", async () => {
  const reader = new InMemoryAggregateReader();

  assert.deepEqual(await reader.funnelCounts({ steps: ["visit", "signup"], window: WINDOW }), [0, 0]);
  assert.deepEqual(await reader.interactionCounts({ signals: ["rage"], window: WINDOW }), {
    sampleSize: 0,
    counts: {},
  });
  assert.deepEqual(await reader.pathReach({ startEvent: "visit", endEvent: "signup", window: WINDOW }), {
    startCount: 0,
    reachedCount: 0,
  });
});

test("InMemoryAggregateReader copies seed values instead of exposing mutable references", async () => {
  const counts = [100, 50];
  const reader = new InMemoryAggregateReader({
    funnels: [{ input: { steps: ["visit", "signup"], window: WINDOW }, counts }],
  });
  counts[0] = 1;

  const first = await reader.funnelCounts({ steps: ["visit", "signup"], window: WINDOW });
  assert.deepEqual(first, [100, 50]);
});

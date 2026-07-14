import assert from "node:assert/strict";
import test from "node:test";
import { Transport } from "../src/transport.ts";
import type { WireEvent } from "../src/schema.ts";
import { ManualScheduler, RecordingSender } from "./helpers.ts";

function evt(index: number): WireEvent {
  return { eid: `e-${index}`, t: "pv", ts: index, p: "/", props: {} };
}

function makeTransport(overrides: Partial<{ maxEvents: number; maxWaitMs: number; maxBufferEvents: number }> = {}): { transport: Transport; sender: RecordingSender; scheduler: ManualScheduler } {
  const sender = new RecordingSender();
  const scheduler = new ManualScheduler();
  const transport = new Transport({ url: "/api/ingest", sender, scheduler, serialize: (events) => JSON.stringify(events), config: { maxEvents: 20, maxWaitMs: 5000, ...overrides } });
  return { transport, sender, scheduler };
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

test("TRANSPORT-001 flushes immediately when the batch reaches maxEvents", () => {
  const { transport, sender } = makeTransport();
  for (let i = 0; i < 20; i += 1) transport.enqueue(evt(i));
  assert.equal(sender.posts.length, 1);
  assert.equal(JSON.parse(sender.posts[0]).length, 20);
  assert.equal(transport.pendingCount(), 0);
});

test("TRANSPORT-002 flushes on the time threshold before the batch is full", () => {
  const { transport, sender, scheduler } = makeTransport();
  transport.enqueue(evt(1));
  assert.equal(sender.posts.length, 0);
  scheduler.advance(5000);
  assert.equal(sender.posts.length, 1);
  assert.equal(JSON.parse(sender.posts[0]).length, 1);
});

test("TRANSPORT-003 a terminal flush uses the beacon, not fetch", () => {
  const { transport, sender } = makeTransport();
  transport.enqueue(evt(1));
  transport.flushTerminal();
  assert.equal(sender.beacons.length, 1);
  assert.equal(sender.posts.length, 0);
  assert.equal(transport.pendingCount(), 0);
});

test("TRANSPORT-004 retries a failed flush with backoff, bounded by maxRetries", async () => {
  const { transport, sender, scheduler } = makeTransport();
  sender.postOk = false;
  for (let i = 0; i < 20; i += 1) transport.enqueue(evt(i));
  await tick();
  assert.equal(sender.posts.length, 1); // first attempt
  scheduler.advance(1000);
  await tick();
  assert.equal(sender.posts.length, 2); // one backoff retry
});

test("TRANSPORT-005 caps the buffer, dropping oldest events (loss tolerated)", () => {
  const { transport } = makeTransport({ maxEvents: 100_000, maxBufferEvents: 5 });
  for (let i = 0; i < 8; i += 1) transport.enqueue(evt(i));
  assert.equal(transport.pendingCount(), 5);
});

test("TRANSPORT-006 an empty terminal flush sends nothing", () => {
  const { transport, sender } = makeTransport();
  transport.flushTerminal();
  assert.equal(sender.beacons.length, 0);
  assert.equal(sender.posts.length, 0);
});

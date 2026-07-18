import assert from "node:assert/strict";
import test from "node:test";
import { MemoryStore } from "../../../../packages/collector/src/storage.ts";
import type { ReplayChunkEnvelope } from "../../../../packages/collector/src/replay-chunk.ts";
import { parseReplayEnvelope } from "../server/schema.ts";
import { createDogfoodRecorder, type DogfoodRecorderDeps } from "./dogfood-recorder.ts";

type Emit = (event: unknown) => void;

function makeDeps(overrides: Partial<DogfoodRecorderDeps> = {}): DogfoodRecorderDeps & { sent: ReplayChunkEnvelope[]; emit(): Emit; loads(): number } {
  const sent: ReplayChunkEnvelope[] = [];
  let engineLoads = 0;
  let emit: Emit = () => undefined;
  let ids = 0;
  return {
    siteKey: "dogfood-key-0123456789abcdef",
    store: new MemoryStore(),
    signals: { gpc: false, dnt: false },
    send: (envelope) => sent.push(envelope),
    loadEngine: async () => {
      engineLoads += 1;
      return { start: (handler: Emit) => { emit = handler; return () => undefined; } };
    },
    now: () => Date.parse("2026-07-18T09:00:00.000Z"),
    createId: () => `id-${(ids += 1)}`,
    sent,
    emit: () => emit,
    loads: () => engineLoads,
    ...overrides,
  };
}

test("DOGFOOD-04 a granted dogfood recording produces envelopes the server schema accepts", async () => {
  const deps = makeDeps();
  const recorder = createDogfoodRecorder(deps);
  assert.equal(recorder.consent(), "unknown");
  assert.equal(await recorder.grant(), "consented");

  deps.emit()({ type: 2, timestamp: 1, data: { node: { tagName: "h1", attributes: {}, childNodes: [], textContent: "Dogfood Probe" } } });
  deps.emit()({ type: 3, timestamp: 2, data: { source: 2, type: 2, id: 4, x: 10, y: 10 } });
  recorder.end();

  assert.equal(deps.sent.length, 1, "end() flushes the bounded final chunk");
  const wire = JSON.parse(JSON.stringify(deps.sent[0])) as unknown;
  const parsed = parseReplayEnvelope(wire);
  assert.equal(parsed.ok, true, "the dogfood wire format passes the real ingest schema");
  const serialized = JSON.stringify(deps.sent[0]);
  assert.ok(!serialized.includes("Dogfood Probe"), "typed text is masked before it ever leaves the recorder");
});

test("DOGFOOD-05 GPC/DNT block recording even after an explicit grant click", async () => {
  const deps = makeDeps({ signals: { gpc: true, dnt: false } });
  const recorder = createDogfoodRecorder(deps);
  assert.equal(await recorder.grant(), "disabled");
  assert.equal(deps.loads(), 0, "the engine never loads under a privacy signal");
  assert.equal(deps.sent.length, 0);
});

test("DOGFOOD-06 withdrawal drops unsent events and persists across recorder instances", async () => {
  const store = new MemoryStore();
  const deps = makeDeps({ store });
  const recorder = createDogfoodRecorder(deps);
  await recorder.grant();
  deps.emit()({ type: 3, timestamp: 3, data: { source: 1, positions: [] } });
  recorder.withdraw();
  recorder.end();
  assert.equal(deps.sent.length, 0, "nothing buffered leaves after withdrawal");
  assert.equal(recorder.consent(), "withdrawn");

  const next = createDogfoodRecorder(makeDeps({ store }));
  assert.equal(next.consent(), "withdrawn", "withdrawal persists — no automatic restart");
  assert.equal(await next.grant(), "consented", "a new explicit grant is still possible");
});

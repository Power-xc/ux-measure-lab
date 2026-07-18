import assert from "node:assert/strict";
import test from "node:test";
import { ReplayConsentGate } from "../src/replay-consent.ts";
import { DEFAULT_REPLAY_QUOTAS, type ReplayChunkEnvelope, type ReplayQuotas } from "../src/replay-chunk.ts";
import { ReplayRecorder, type RecordingEngine } from "../src/replay-recorder.ts";
import { MemoryStore } from "../src/storage.ts";

const NO_SIGNALS = { gpc: false, dnt: false };

type Harness = {
  recorder: ReplayRecorder;
  gate: ReplayConsentGate;
  sent: ReplayChunkEnvelope[];
  emit: (event: unknown) => void;
  engineLoads: () => number;
  advance: (ms: number) => void;
};

function makeHarness(quotas: ReplayQuotas = DEFAULT_REPLAY_QUOTAS): Harness {
  const gate = new ReplayConsentGate(new MemoryStore(), NO_SIGNALS);
  const sent: ReplayChunkEnvelope[] = [];
  let emit: (event: unknown) => void = () => {};
  let engineLoadCount = 0;
  let nowMs = 1_000_000;
  const engine: RecordingEngine = {
    start(handler) {
      emit = handler;
      return () => { emit = () => {}; };
    },
  };
  const recorder = new ReplayRecorder({
    gate,
    loadEngine: async () => {
      engineLoadCount += 1;
      return engine;
    },
    send: (envelope) => sent.push(envelope),
    siteKey: "site-key",
    sessionId: "session-1",
    anonymousId: "anon-1",
    purposeVersion: "replay-v1",
    quotas,
    now: () => nowMs,
    createRecordingId: () => "rec-1",
  });
  return {
    recorder,
    gate,
    sent,
    emit: (event) => emit(event),
    engineLoads: () => engineLoadCount,
    advance: (ms) => { nowMs += ms; },
  };
}

const EVENT = { type: 3, timestamp: 1, data: { source: 1 } };

test("SR-01 nothing loads, identifies or sends before an explicit replay grant", async () => {
  const harness = makeHarness();
  assert.equal(await harness.recorder.start(), "disabled");
  assert.equal(harness.engineLoads(), 0);
  assert.equal(harness.recorder.currentRecordingId(), null);
  assert.equal(harness.sent.length, 0);
});

test("granting replay consent starts the engine and chunks flow with sequences", async () => {
  const harness = makeHarness({ ...DEFAULT_REPLAY_QUOTAS, maxEventsPerChunk: 2 });
  harness.gate.set("granted");
  assert.equal(await harness.recorder.start(), "consented");
  assert.equal(harness.engineLoads(), 1);

  harness.emit(EVENT);
  harness.emit(EVENT);
  harness.emit(EVENT);
  harness.recorder.end();

  assert.equal(harness.sent.length, 2);
  assert.deepEqual(harness.sent.map((chunk) => chunk.sequence), [0, 1]);
  assert.equal(harness.sent[0].purpose_version, "replay-v1");
  assert.equal(harness.sent[0].encoding, "json");
  assert.equal(harness.sent[0].events.length, 2);
  assert.equal(harness.sent[1].events.length, 1);
});

test("SR-04 withdrawal stops the engine, clears the unsent buffer and blocks restarts", async () => {
  const harness = makeHarness();
  harness.gate.set("granted");
  await harness.recorder.start();
  harness.emit(EVENT);

  harness.recorder.withdraw();
  assert.equal(harness.recorder.current(), "withdrawn");
  assert.equal(harness.sent.length, 0);
  assert.equal(harness.gate.current(), "withdrawn");

  harness.emit(EVENT);
  assert.equal(harness.sent.length, 0);
  assert.equal(await harness.recorder.start(), "withdrawn");
});

test("quota breaches pause the recording instead of degrading privacy", async () => {
  const harness = makeHarness({ ...DEFAULT_REPLAY_QUOTAS, maxRecordingMs: 1_000 });
  harness.gate.set("granted");
  await harness.recorder.start();
  harness.emit(EVENT);
  harness.advance(2_000);
  harness.emit(EVENT);
  assert.equal(harness.recorder.current(), "paused");

  harness.recorder.end();
  assert.equal(harness.recorder.current(), "ended");
  assert.equal(harness.sent.length, 1);
});

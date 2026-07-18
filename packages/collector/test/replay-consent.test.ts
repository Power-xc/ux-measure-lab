import assert from "node:assert/strict";
import test from "node:test";
import { ConsentGate } from "../src/consent.ts";
import { ReplayConsentGate } from "../src/replay-consent.ts";
import { MemoryStore } from "../src/storage.ts";

const NO_SIGNALS = { gpc: false, dnt: false };

test("SR-01a behavior-collection consent never implies replay consent", () => {
  const store = new MemoryStore();
  const behavior = new ConsentGate(store, { requireConsent: true, respectGpc: true }, NO_SIGNALS);
  behavior.set("granted");

  const replay = new ReplayConsentGate(store, NO_SIGNALS);
  assert.equal(replay.current(), "unknown");
  assert.equal(replay.isRecordingAllowed(), false);
});

test("SR-04a withdrawal persists and keeps recording blocked without a new explicit grant", () => {
  const store = new MemoryStore();
  const replay = new ReplayConsentGate(store, NO_SIGNALS);
  replay.set("granted");
  assert.equal(replay.isRecordingAllowed(), true);

  replay.set("withdrawn");
  assert.equal(replay.isRecordingAllowed(), false);
  assert.equal(new ReplayConsentGate(store, NO_SIGNALS).current(), "withdrawn");
});

test("replay consent honors GPC and DNT as unconditional blocks", () => {
  const store = new MemoryStore();
  const gated = new ReplayConsentGate(store, { gpc: true, dnt: false });
  gated.set("granted");
  assert.equal(gated.isRecordingAllowed(), false);

  const dnt = new ReplayConsentGate(new MemoryStore(), { gpc: false, dnt: true });
  dnt.set("granted");
  assert.equal(dnt.isRecordingAllowed(), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { ConsentGate } from "../src/consent.ts";
import { MemoryStore } from "../src/storage.ts";

const NO_SIGNALS = { gpc: false, dnt: false };
const REQUIRE = { requireConsent: true, respectGpc: true };

test("CONSENT-001 blocks collection until consent is explicitly granted (HAC-02)", () => {
  const gate = new ConsentGate(new MemoryStore(), REQUIRE, NO_SIGNALS);
  assert.equal(gate.isCollectionAllowed(), false);
  gate.set("granted");
  assert.equal(gate.isCollectionAllowed(), true);
  gate.set("denied");
  assert.equal(gate.isCollectionAllowed(), false);
});

test("CONSENT-002 persists the decision to the store", () => {
  const store = new MemoryStore();
  new ConsentGate(store, REQUIRE, NO_SIGNALS).set("granted");
  const reloaded = new ConsentGate(store, REQUIRE, NO_SIGNALS);
  assert.equal(reloaded.current(), "granted");
  assert.equal(reloaded.isCollectionAllowed(), true);
});

test("CONSENT-003 a respected GPC signal blocks even after a grant", () => {
  const gate = new ConsentGate(new MemoryStore(), REQUIRE, { gpc: true, dnt: false });
  gate.set("granted");
  assert.equal(gate.isCollectionAllowed(), false);
});

test("CONSENT-004 a respected DNT signal blocks collection", () => {
  const gate = new ConsentGate(new MemoryStore(), REQUIRE, { gpc: false, dnt: true });
  gate.set("granted");
  assert.equal(gate.isCollectionAllowed(), false);
});

test("CONSENT-005 privacy signals are ignored when respectGpc is off", () => {
  const gate = new ConsentGate(new MemoryStore(), { requireConsent: true, respectGpc: false }, { gpc: true, dnt: true });
  gate.set("granted");
  assert.equal(gate.isCollectionAllowed(), true);
});

test("CONSENT-006 without requireConsent, collection is allowed unless explicitly denied", () => {
  const gate = new ConsentGate(new MemoryStore(), { requireConsent: false, respectGpc: true }, NO_SIGNALS);
  assert.equal(gate.isCollectionAllowed(), true);
  gate.set("denied");
  assert.equal(gate.isCollectionAllowed(), false);
});

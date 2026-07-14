import assert from "node:assert/strict";
import test from "node:test";
import type { SourceAdapter, SourceAdapterMeta } from "../contract.ts";
import { createAdapterRegistry } from "./registry.ts";

function adapter(meta: SourceAdapterMeta): SourceAdapter {
  return {
    meta: () => meta,
    supports: (capability) => meta.capabilities.includes(capability),
    measure: async () => ({ ok: false, code: "not_configured", message: "테스트 어댑터" }),
  };
}

test("registry registers and retrieves adapters by stable id", () => {
  const firstParty = adapter({
    adapterId: "first-party",
    displayName: "First party",
    kind: "first_party",
    access: "read_write",
    capabilities: ["funnel", "paths"],
  });
  const registry = createAdapterRegistry([firstParty]);

  assert.equal(registry.get("first-party"), firstParty);
  assert.equal(registry.get("missing"), undefined);
  assert.deepEqual(registry.list(), [firstParty]);
});

test("registry matches only adapters that support the requested capability", () => {
  const funnel = adapter({
    adapterId: "funnel",
    displayName: "Funnel",
    kind: "connector",
    access: "read_only",
    capabilities: ["funnel"],
  });
  const paths = adapter({
    adapterId: "paths",
    displayName: "Paths",
    kind: "connector",
    access: "read_only",
    capabilities: ["paths"],
  });
  const registry = createAdapterRegistry([funnel, paths]);

  assert.deepEqual(registry.findByCapability("funnel"), [funnel]);
  assert.deepEqual(registry.findByCapability("interaction"), []);
});

test("registry rejects blank and duplicate adapter ids", () => {
  const valid = adapter({
    adapterId: "same",
    displayName: "Same",
    kind: "connector",
    access: "read_only",
    capabilities: ["funnel"],
  });
  const blank = adapter({
    adapterId: " ",
    displayName: "Blank",
    kind: "connector",
    access: "read_only",
    capabilities: ["funnel"],
  });
  const registry = createAdapterRegistry([valid]);

  assert.throws(() => registry.register(valid), /이미 등록/);
  assert.throws(() => registry.register(blank), /필수/);
});

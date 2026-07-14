import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { Dispatcher, bootstrap, installStub, type Controllable, type MlGlobal } from "../src/loader.ts";
import type { CollectorConfig } from "../src/core.ts";
import type { ConsentState } from "../src/consent.ts";

class FakeCollector implements Controllable {
  started = false;
  consents: ConsentState[] = [];
  readonly config: CollectorConfig;
  constructor(config: CollectorConfig) {
    this.config = config;
  }
  start(): void {
    this.started = true;
  }
  setConsent(state: ConsentState): void {
    this.consents.push(state);
  }
}

function harness(defaultKey?: string): { dispatch: Dispatcher; made: FakeCollector[] } {
  const made: FakeCollector[] = [];
  const dispatch = new Dispatcher((config) => {
    const collector = new FakeCollector(config);
    made.push(collector);
    return collector;
  }, defaultKey);
  return { dispatch, made };
}

test("LOADER-001 init builds and starts a collector with the config key", () => {
  const { dispatch, made } = harness();
  dispatch.dispatch("init", [{ key: "abc" }]);
  assert.equal(made.length, 1);
  assert.equal(made[0].started, true);
  assert.equal(made[0].config.key, "abc");
});

test("LOADER-002 init falls back to the stub's default key", () => {
  const { dispatch, made } = harness("def_key");
  dispatch.dispatch("init", [{}]);
  assert.equal(made[0].config.key, "def_key");
});

test("LOADER-003 init with no key anywhere is a no-op", () => {
  const { dispatch, made } = harness();
  dispatch.dispatch("init", [{}]);
  assert.equal(made.length, 0);
});

test("LOADER-004 consent before init is buffered and applied on init", () => {
  const { dispatch, made } = harness();
  dispatch.dispatch("consent", ["granted"]);
  dispatch.dispatch("init", [{ key: "abc" }]);
  assert.deepEqual(made[0].consents, ["granted"]);
});

test("LOADER-005 consent after init is forwarded immediately", () => {
  const { dispatch, made } = harness();
  dispatch.dispatch("init", [{ key: "abc" }]);
  dispatch.dispatch("consent", ["denied"]);
  assert.deepEqual(made[0].consents, ["denied"]);
});

test("LOADER-006 a second init is ignored (idempotent)", () => {
  const { dispatch, made } = harness();
  dispatch.dispatch("init", [{ key: "abc" }]);
  dispatch.dispatch("init", [{ key: "other" }]);
  assert.equal(made.length, 1);
  assert.equal(made[0].config.key, "abc");
});

test("LOADER-007 unknown commands and invalid consent values are ignored", () => {
  const { dispatch, made } = harness();
  dispatch.dispatch("init", [{ key: "abc" }]);
  dispatch.dispatch("track", ["custom"]); // not part of v1
  dispatch.dispatch("consent", ["maybe"]); // invalid state
  assert.deepEqual(made[0].consents, []);
});

test("LOADER-008 the stub buffers calls into a queue before bootstrap", () => {
  const win = {} as Window & { ml?: MlGlobal };
  const stub = installStub(win);
  stub("init", { key: "abc" });
  stub("consent", "granted");
  assert.equal(installStub(win), stub); // idempotent
  assert.deepEqual(stub.q, [["init", { key: "abc" }], ["consent", "granted"]]);
});

test("LOADER-009 bootstrap replaces the stub and drains the queued calls", () => {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "https://app.example.com/" });
  const win = dom.window as unknown as Window & { ml?: MlGlobal };
  const stub = installStub(win);
  stub.k = "site_key";
  stub("init", { key: "site_key", requireConsent: true }); // no consent → no events, no timers
  bootstrap(win);
  assert.equal(typeof win.ml, "function");
  assert.notEqual(win.ml, stub);
  assert.equal(win.ml?.q, undefined); // live dispatcher carries no queue
});

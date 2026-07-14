import assert from "node:assert/strict";
import test from "node:test";
import { Collector, resolveConfig } from "../src/core.ts";
import { WIRE_EVENT_TYPES } from "../src/schema.ts";
import { lastEnvelope, makeHarness, type Harness } from "./helpers.ts";

const START = 1_000_000;

function build(harness: Harness, overrides: Parameters<typeof resolveConfig>[0] = { key: "site_test" }): Collector {
  return new Collector(harness.env, resolveConfig({ capture: { click: true, rage: true, dead: false, scroll: true, route: true, text: false }, ...overrides }));
}

function click(harness: Harness, id: string): void {
  (harness.doc.getElementById(id) as unknown as { click: () => void }).click();
}

function flush(harness: Harness): void {
  harness.scheduler.advance(5000);
}

test("CORE-001 nothing is queued or sent before consent is granted (HAC-02)", () => {
  const harness = makeHarness({ startNow: START });
  harness.doc.body.innerHTML = `<button id="buy">Buy</button>`;
  const collector = build(harness);
  collector.start();

  click(harness, "buy"); // user interacts before consenting
  flush(harness);
  assert.equal(harness.sender.posts.length, 0, "no batch may be sent pre-consent");
  assert.equal(harness.sender.beacons.length, 0);

  collector.setConsent("granted");
  flush(harness);
  const envelope = lastEnvelope(harness.sender);
  assert.ok(envelope.events.some((event) => event.t === "pv"), "a pageview is emitted once consent is granted");
});

test("CORE-002 an input value is never queued or sent (HAC-03)", () => {
  const harness = makeHarness({ startNow: START });
  harness.doc.body.innerHTML = `<input id="email" value="topsecret@example.com">`;
  const collector = build(harness);
  collector.start();
  collector.setConsent("granted");

  click(harness, "email");
  flush(harness);
  const combined = harness.sender.posts.join("|");
  assert.ok(!combined.includes("topsecret"), "the input value must never appear on the wire");
  const envelope = lastEnvelope(harness.sender);
  const clickEvent = envelope.events.find((event) => event.t === "click");
  assert.ok(clickEvent, "the click itself is still recorded");
  assert.equal(clickEvent?.props.has_text, false);
  assert.equal(clickEvent?.props.text, null);
});

test("CORE-003 the wire envelope matches the binding contract exactly (spec §4)", () => {
  const harness = makeHarness({ startNow: START });
  const collector = build(harness);
  collector.start();
  collector.setConsent("granted");
  flush(harness);

  const envelope = lastEnvelope(harness.sender);
  assert.deepEqual(Object.keys(envelope).sort(), ["aid", "events", "k", "sent_at", "sid"]);
  assert.equal(envelope.k, "site_test");
  assert.ok(envelope.sid.length > 0 && envelope.aid.length > 0);
  for (const event of envelope.events) {
    assert.deepEqual(Object.keys(event).filter((key) => key !== "ref").sort(), ["eid", "p", "props", "t", "ts"]);
    assert.ok((WIRE_EVENT_TYPES as readonly string[]).includes(event.t), `unknown wire type ${event.t}`);
    assert.equal(event.p, "/pricing");
  }
});

test("CORE-004 the first event opens a session; 30min idle rotates it", () => {
  const harness = makeHarness({ startNow: START });
  harness.doc.body.innerHTML = `<button id="buy">Buy</button>`;
  const collector = build(harness);
  collector.start();
  collector.setConsent("granted");
  flush(harness);
  const opening = lastEnvelope(harness.sender).events;
  assert.equal(opening[0].t, "s_start", "the very first event is a session start");

  harness.setNow(START + 1_800_001); // more than 30 minutes later
  click(harness, "buy");
  flush(harness);
  const rotated = lastEnvelope(harness.sender).events;
  const ended = rotated.find((event) => event.t === "s_end");
  const started = rotated.find((event) => event.t === "s_start");
  assert.equal(ended?.props.reason, "timeout");
  assert.ok(started, "a new session starts after the timeout");
});

test("CORE-005 an SPA route change emits route + a spa pageview", () => {
  const harness = makeHarness({ startNow: START });
  const collector = build(harness);
  collector.start();
  collector.setConsent("granted");
  flush(harness);

  harness.win.history.pushState({}, "", "/checkout");
  flush(harness);
  const events = lastEnvelope(harness.sender).events;
  const route = events.find((event) => event.t === "route");
  const pageview = events.find((event) => event.t === "pv");
  assert.equal(route?.props.kind, "push");
  assert.equal(route?.props.to, "/checkout");
  assert.equal(pageview?.props.nav, "spa");
});

test("CORE-006 a webdriver-controlled visitor is dropped entirely", () => {
  const harness = makeHarness({ startNow: START, webdriver: true });
  harness.doc.body.innerHTML = `<button id="buy">Buy</button>`;
  const collector = build(harness);
  collector.start();
  collector.setConsent("granted");
  click(harness, "buy");
  flush(harness);
  assert.equal(collector.isActive(), false);
  assert.equal(harness.sender.posts.length, 0);
});

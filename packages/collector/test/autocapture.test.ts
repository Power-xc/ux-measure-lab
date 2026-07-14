import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { AutoCapture, DeadClickDetector, RageDetector, buildSelector } from "../src/autocapture.ts";
import type { EventProps, WireEventType } from "../src/schema.ts";

function docFrom(html: string): Document {
  return new JSDOM(`<!doctype html><body>${html}</body>`).window.document as unknown as Document;
}

// --- selector builder -------------------------------------------------------

test("SEL-001 data-ml-name wins over structural selectors", () => {
  const doc = docFrom(`<button data-ml-name="cta" class="css-1ab2c3">Buy</button>`);
  assert.equal(buildSelector(doc.querySelector("button") as Element), `[data-ml-name="cta"]`);
});

test("SEL-002 hashy classes are excluded, whitelisted classes kept, text never included", () => {
  const doc = docFrom(`<div id="panel"><button class="css-1ab2c3 primary">Buy now</button></div>`);
  const selector = buildSelector(doc.querySelector("button") as Element);
  assert.ok(selector.includes("button.primary"), selector);
  assert.ok(!selector.includes("css-1ab2c3"), selector);
  assert.ok(selector.includes("div#panel"), selector);
  assert.ok(!selector.toLowerCase().includes("buy"), selector);
});

test("SEL-003 a safe id anchors and stops the climb", () => {
  const doc = docFrom(`<main><section><button id="checkout">Go</button></section></main>`);
  assert.equal(buildSelector(doc.querySelector("button") as Element), "button#checkout");
});

test("SEL-004 nth-of-type disambiguates same-tag siblings", () => {
  const doc = docFrom(`<div id="p"><button>a</button><button class="go">b</button></div>`);
  const second = doc.querySelectorAll("button")[1];
  assert.equal(buildSelector(second), "div#p > button.go:nth-of-type(2)");
});

test("SEL-005 the selector path is bounded to depth 5", () => {
  const doc = docFrom(`<div><div><div><div><div><div><div><span class="leaf">x</span></div></div></div></div></div></div></div>`);
  const selector = buildSelector(doc.querySelector(".leaf") as Element);
  assert.ok(selector.split(" > ").length <= 5, selector);
});

// --- rage detection (HAC-04) ------------------------------------------------

test("RAGE-001 fires on the third click within 30px and 1000ms, reporting the first ts", () => {
  const rage = new RageDetector();
  assert.equal(rage.register(10, 10, 0).rage, false);
  assert.equal(rage.register(12, 12, 200).rage, false);
  const third = rage.register(15, 15, 400);
  assert.deepEqual(third, { rage: true, n: 3, t0: 0 });
});

test("RAGE-002 resets after firing so a fourth nearby click does not double-fire", () => {
  const rage = new RageDetector();
  rage.register(0, 0, 0);
  rage.register(0, 0, 100);
  rage.register(0, 0, 200);
  assert.equal(rage.register(0, 0, 300).rage, false);
});

test("RAGE-003 a jump beyond 30px breaks the cluster", () => {
  const rage = new RageDetector();
  rage.register(0, 0, 0);
  rage.register(0, 0, 100);
  const jumped = rage.register(200, 200, 200);
  assert.deepEqual(jumped, { rage: false, n: 1, t0: 200 });
});

test("RAGE-004 a gap beyond 1000ms breaks the cluster", () => {
  const rage = new RageDetector();
  rage.register(0, 0, 0);
  rage.register(0, 0, 500);
  const late = rage.register(0, 0, 2000);
  assert.equal(late.n, 1);
});

// --- dead-click detection ---------------------------------------------------

test("DEAD-001 emits only after the full wait elapses with no activity", () => {
  const dead = new DeadClickDetector(3000);
  dead.register("button#x", 0);
  assert.equal(dead.resolve(2999), null);
  assert.deepEqual(dead.resolve(3000), { sel: "button#x", waited: 3000 });
});

test("DEAD-002 activity within the window cancels the dead click", () => {
  const dead = new DeadClickDetector(3000);
  dead.register("button#x", 0);
  dead.notifyActivity();
  assert.equal(dead.resolve(5000), null);
});

test("DEAD-003 a resolved dead click is consumed once", () => {
  const dead = new DeadClickDetector(3000);
  dead.register("a", 0);
  assert.ok(dead.resolve(3000));
  assert.equal(dead.resolve(6000), null);
});

// --- click capture never reads input values (HAC-03) ------------------------

test("CAPTURE-001 clicking an input records the click but never its value", () => {
  const doc = docFrom(`<input id="email" value="secret@example.com">`);
  const win = (doc.defaultView as unknown) as Window;
  const events: Array<{ type: WireEventType; props: EventProps }> = [];
  let clock = 0;
  const capture = new AutoCapture({ doc, win, now: () => (clock += 1), emit: (type, props) => events.push({ type, props }), config: { rage: false, dead: false, captureText: true, deadWaitMs: 3000 } });
  capture.start();

  (doc.querySelector("#email") as HTMLElement).click();
  capture.stop();

  const click = events.find((event) => event.type === "click");
  assert.ok(click, "a click event should be recorded");
  assert.equal(click?.props.has_text, false);
  assert.equal(click?.props.text, null);
  assert.ok(!JSON.stringify(events).includes("secret"), "the input value must never appear in any event");
});

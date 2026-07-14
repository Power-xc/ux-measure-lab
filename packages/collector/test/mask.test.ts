import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { boundedText, isSensitiveTarget, normalizePath, normalizeReferrer } from "../src/mask.ts";

function el(html: string): Element {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  const first = dom.window.document.body.firstElementChild;
  if (!first) throw new Error("no element");
  return first as unknown as Element;
}

test("MASK-001 strips query string by default", () => {
  assert.equal(normalizePath("/pricing?utm_source=x&ref=y"), "/pricing");
});

test("MASK-002 keeps only whitelisted query params", () => {
  assert.equal(normalizePath("/p?plan=pro&utm=x", ["plan"]), "/p?plan=pro");
  assert.equal(normalizePath("/p?utm=x", ["plan"]), "/p");
});

test("MASK-003 masks email, uuid, long hex and numeric-id path segments", () => {
  assert.equal(normalizePath("/users/john@doe.com/settings"), "/users/:masked/settings");
  assert.equal(normalizePath("/o/550e8400-e29b-41d4-a716-446655440000"), "/o/:masked");
  assert.equal(normalizePath("/t/deadbeefdeadbeef99"), "/t/:masked");
  assert.equal(normalizePath("/order/100294"), "/order/:masked");
});

test("MASK-004 keeps short human-readable slugs", () => {
  assert.equal(normalizePath("/blog/how-to-measure-ux"), "/blog/how-to-measure-ux");
});

test("MASK-005 reduces referrer to origin only", () => {
  assert.equal(normalizeReferrer("https://google.com/search?q=secret"), "https://google.com");
  assert.equal(normalizeReferrer(""), undefined);
  assert.equal(normalizeReferrer("not a url"), undefined);
});

test("MASK-006 treats every input, password and contenteditable as sensitive (HAC-03)", () => {
  assert.equal(isSensitiveTarget(el("<input value='secret'>")), true);
  assert.equal(isSensitiveTarget(el("<textarea>secret</textarea>")), true);
  assert.equal(isSensitiveTarget(el("<select><option>a</option></select>")), true);
  assert.equal(isSensitiveTarget(el("<div contenteditable='true'>x</div>")), true);
});

test("MASK-007 treats payment and explicitly-masked fields as sensitive (HAC-03)", () => {
  assert.equal(isSensitiveTarget(el("<div autocomplete='cc-number'></div>")), true);
  assert.equal(isSensitiveTarget(el("<div name='card_number'></div>")), true);
  assert.equal(isSensitiveTarget(el("<div name='cvv'></div>")), true);
  assert.equal(isSensitiveTarget(el("<span data-ml-mask></span>")), true);
});

test("MASK-008 flags an element nested inside a sensitive ancestor", () => {
  const editable = el("<div contenteditable='true'><b id='deep'>x</b></div>");
  assert.equal(isSensitiveTarget(editable.querySelector("#deep")), true);
  const plainForm = el("<form><span id='inner'>x</span></form>");
  assert.equal(isSensitiveTarget(plainForm.querySelector("#inner")), false); // a plain form is not itself sensitive
});

test("MASK-009 a normal button is not sensitive", () => {
  assert.equal(isSensitiveTarget(el("<button>Buy now</button>")), false);
});

test("MASK-010 boundedText never returns text for sensitive targets and truncates otherwise", () => {
  assert.equal(boundedText(el("<input value='secret'>"), true), undefined);
  assert.equal(boundedText(el("<button>Buy now</button>"), false), undefined); // opt-out by default
  assert.equal(boundedText(el("<button>Buy now</button>"), true), "Buy now");
  const long = "x".repeat(200);
  assert.equal(boundedText(el(`<button>${long}</button>`), true)?.length, 128);
});

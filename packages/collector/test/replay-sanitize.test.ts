import assert from "node:assert/strict";
import test from "node:test";
import { maskText, sanitizeReplayEvent } from "../src/replay-sanitize.ts";

type AnyRecord = Record<string, unknown>;

function snapshotEvent(node: AnyRecord): AnyRecord {
  return { type: 2, timestamp: 1_000, data: { node } };
}

function nodeOf(event: unknown): AnyRecord {
  return ((event as AnyRecord).data as AnyRecord).node as AnyRecord;
}

test("SR-02 input, password and contenteditable values never survive any configuration", () => {
  const event = snapshotEvent({
    tagName: "form",
    attributes: {},
    childNodes: [
      { tagName: "input", attributes: { type: "text", value: "홍길동" }, childNodes: [] },
      { tagName: "input", attributes: { type: "password", value: "secret", checked: "checked" }, childNodes: [] },
      { tagName: "textarea", attributes: { value: "자유 서술" }, childNodes: [{ textContent: "자유 서술" }] },
      { tagName: "select", attributes: { value: "seoul" }, childNodes: [{ tagName: "option", attributes: { value: "seoul", selected: "selected" }, childNodes: [] }] },
    ],
  });
  const sanitized = sanitizeReplayEvent(event);
  const serialized = JSON.stringify(sanitized);
  assert.doesNotMatch(serialized, /홍길동|secret|자유 서술|seoul/);
  assert.doesNotMatch(serialized, /"value"|"checked"|"selected"/);
});

test("SR-02b incremental mutation attribute maps and text edits never carry values", () => {
  // rrweb IncrementalSnapshot (source 0) shape: bare attribute maps with no tagName,
  // plus text edits carrying rendered content. Both must be scrubbed like a node.
  const event = {
    type: 3,
    timestamp: 2_000,
    data: {
      source: 0,
      texts: [{ id: 23, value: "주문번호 A-1029" }],
      attributes: [
        { id: 39, attributes: { value: "홍길동", name: null } },
        { id: 44, attributes: { href: "https://host.example/u/9f8e7d6c5b4a3f2e1d0c", onclick: "steal()" } },
      ],
      removes: [],
      adds: [{ parentId: 5, nextId: null, node: { tagName: "input", attributes: { value: "secret" }, childNodes: [] } }],
    },
  };
  const sanitized = sanitizeReplayEvent(event) as AnyRecord;
  const data = sanitized.data as { texts: { value: string }[]; attributes: { attributes: AnyRecord }[] };
  const serialized = JSON.stringify(sanitized);
  // No raw content survives anywhere, and no event handler.
  assert.doesNotMatch(serialized, /홍길동|secret|주문번호|A-1029|9f8e7d6c5b4a3f2e1d0c/);
  assert.doesNotMatch(serialized, /onclick|steal\(\)/);
  // Attribute maps carry no form-value keys — this is what the server rejects wholesale.
  const attributeMaps = JSON.stringify(data.attributes.map((entry) => entry.attributes));
  assert.doesNotMatch(attributeMaps, /"value"|"checked"|"selected"/);
  // The text edit keeps its rrweb `value` key but only masked content, so replay still works.
  assert.match(data.texts[0].value, /^\*+ \*+$/);
});

test("SR-03 text, url and attribute masking leaves no raw identifiers", () => {
  const event = snapshotEvent({
    tagName: "div",
    attributes: { title: "주문자 kim@example.com", class: "row" },
    childNodes: [
      { textContent: "주문번호 123456789" },
      { tagName: "a", attributes: { href: "https://shop.example/orders/123456789?token=abcdefabcdefabcdefabcdef" }, childNodes: [] },
      { tagName: "a", attributes: { href: "javascript:alert(1)", onclick: "steal()" }, childNodes: [] },
    ],
  });
  const sanitized = sanitizeReplayEvent(event);
  const serialized = JSON.stringify(sanitized);
  assert.doesNotMatch(serialized, /kim@example\.com|123456789|abcdefabcdefabcdefabcdef/);
  assert.doesNotMatch(serialized, /javascript:|onclick/);
  assert.match(serialized, /:masked/);
});

test("blocked subtrees and embedded surfaces are removed entirely", () => {
  const event = snapshotEvent({
    tagName: "main",
    attributes: {},
    childNodes: [
      { tagName: "section", attributes: { class: "ml-block" }, childNodes: [{ textContent: "진료 기록" }] },
      { tagName: "section", attributes: { "data-ml-block": "" }, childNodes: [{ textContent: "결제 수단" }] },
      { tagName: "iframe", attributes: { src: "https://bank.example" }, childNodes: [] },
      { tagName: "canvas", attributes: {}, childNodes: [] },
      { tagName: "p", attributes: {}, childNodes: [{ textContent: "안내 문구" }] },
    ],
  });
  const sanitized = sanitizeReplayEvent(event);
  const serialized = JSON.stringify(sanitized);
  assert.doesNotMatch(serialized, /진료 기록|결제 수단|bank\.example|iframe|canvas/);
  assert.match(serialized, /\*\* \*\*/);
});

test("host policy can only add masking, never restore hard-blocked content", () => {
  const event = snapshotEvent({
    tagName: "div",
    attributes: {},
    childNodes: [
      { tagName: "aside", attributes: { class: "promo" }, childNodes: [{ textContent: "쿠폰 안내" }] },
      { tagName: "input", attributes: { value: "secret" }, childNodes: [] },
    ],
  });
  const sanitized = sanitizeReplayEvent(event, { blockClasses: ["promo"] });
  const serialized = JSON.stringify(sanitized);
  assert.doesNotMatch(serialized, /쿠폰 안내|promo|secret/);
});

test("incremental engine payloads share the same text and url scrubbing", () => {
  const incremental = {
    type: 3,
    timestamp: 2_000,
    data: { source: 5, text: "카드번호 4111111111111111", url: "https://shop.example/checkout?card=4111111111111111" },
  };
  const sanitized = sanitizeReplayEvent(incremental) as AnyRecord;
  const data = sanitized.data as AnyRecord;
  assert.equal(data.text, maskText("카드번호 4111111111111111"));
  assert.doesNotMatch(String(data.url), /4111111111111111/);
});

test("masking keeps document structure for layout playback", () => {
  const event = snapshotEvent({ tagName: "h1", attributes: {}, childNodes: [{ textContent: "결제 완료" }] });
  const sanitized = sanitizeReplayEvent(event);
  const heading = nodeOf(sanitized);
  assert.equal(heading.tagName, "h1");
  assert.equal((heading.childNodes as AnyRecord[]).length, 1);
});

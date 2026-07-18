import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReplaySandboxDocument,
  isReplayStatusMessage,
  REPLAY_FRAME_ANCESTORS,
  REPLAY_SANDBOX_ATTRIBUTE,
  REPLAY_SANDBOX_CSP,
  replayFrameOrigin,
  scrubReplayEventsForPlayback,
} from "./player-sandbox.ts";

function snapshotWith(node: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 2,
    timestamp: 1,
    data: { node: { type: 0, id: 1, childNodes: [node] }, initialOffset: { left: 0, top: 0 } },
  };
}

test("SR-09a playback scrub neutralizes script and embed-capable tags while keeping node ids", () => {
  const events = scrubReplayEventsForPlayback([
    snapshotWith({
      type: 2, id: 4, tagName: "body", attributes: {}, childNodes: [
        { type: 2, id: 20, tagName: "script", attributes: { src: "https://evil.invalid/x.js" }, childNodes: [{ type: 3, id: 21, textContent: "window.pwned = 1" }] },
        { type: 2, id: 30, tagName: "IFRAME", attributes: { src: "https://evil.invalid" }, childNodes: [] },
        { type: 2, id: 40, tagName: "link", attributes: { rel: "stylesheet", href: "https://evil.invalid/a.css" }, childNodes: [] },
      ],
    }),
  ]);
  const body = ((events[0] as { data: { node: { childNodes: unknown[] } } }).data.node.childNodes[0]) as { childNodes: { id: number; tagName: string; attributes: Record<string, unknown>; childNodes: unknown[] }[] };
  for (const [index, id] of [20, 30, 40].entries()) {
    const child = body.childNodes[index];
    assert.equal(child.id, id, "node ids survive for later mutation references");
    assert.equal(child.tagName, "noscript");
    assert.deepEqual(child.attributes, {});
    assert.deepEqual(child.childNodes, []);
  }
  assert.ok(!JSON.stringify(events).includes("pwned"), "script text does not survive");
});

test("SR-09a2 playback scrub strips remote resource URLs so the rebuild iframe fetches nothing", () => {
  const events = scrubReplayEventsForPlayback([
    snapshotWith({
      type: 2, id: 5, tagName: "img", childNodes: [],
      attributes: { src: "https://evil.invalid/beacon.png", srcset: "https://evil.invalid/2x.png 2x", alt: "*" },
    }),
    snapshotWith({
      type: 2, id: 6, tagName: "div", childNodes: [],
      attributes: { style: "background: url('https://evil.invalid/bg.png'); color: red", "data-x": "keep" },
    }),
    snapshotWith({
      type: 2, id: 7, tagName: "img", childNodes: [],
      attributes: { src: "data:image/svg+xml,<svg onload='x()'></svg>", alt: "keep" },
    }),
    { type: 3, timestamp: 9, data: { source: 8, styles: [{ id: 6, cssText: "a{background:url(https://evil.invalid/x.png)}" }] } },
  ]);
  const serialized = JSON.stringify(events);
  assert.ok(!serialized.includes("evil.invalid"), "no remote URL survives in any field");
  assert.ok(!/data:image\/svg/.test(serialized), "scriptable data: URLs are stripped too");
  assert.ok(serialized.includes("keep"), "unrelated attributes are untouched");
});

test("SR-09b playback scrub drops event handler attributes and dangerous URL schemes everywhere", () => {
  const events = scrubReplayEventsForPlayback([
    snapshotWith({
      type: 2, id: 5, tagName: "a", childNodes: [],
      attributes: { href: "javascript:alert(1)", onclick: "steal()", ONMOUSEOVER: "x()", title: "safe" },
    }),
    // Incremental mutation shapes carry bare attribute records and URL fields.
    { type: 3, timestamp: 2, data: { source: 0, attributes: [{ id: 5, attributes: { onfocus: "x()", href: "vbscript:evil" } }], adds: [], removes: [], texts: [] } },
    { type: 3, timestamp: 3, data: { source: 4, href: "data:text/html,<b>x</b>" } },
  ]);
  const serialized = JSON.stringify(events);
  assert.ok(!/onclick|onmouseover|onfocus/i.test(serialized));
  assert.ok(!/javascript:|vbscript:|data:text/i.test(serialized));
  assert.ok(serialized.includes("safe"), "benign attributes survive");
});

test("SR-09c playback scrub caps recursion depth instead of walking hostile nesting forever", () => {
  let deep: Record<string, unknown> = { tagName: "div", attributes: {}, childNodes: [] };
  for (let index = 0; index < 200; index += 1) deep = { tagName: "div", attributes: {}, childNodes: [deep] };
  const events = scrubReplayEventsForPlayback([snapshotWith({ type: 2, id: 4, ...deep })]);
  assert.equal(events.length, 1, "the event survives with the over-deep subtree cut off");
});

test("SR-09d the sandbox document ships a network-blocking CSP and a navigation-free sandbox", () => {
  // allow-same-origin keeps the frame on the loopback ALIAS origin (cross-origin to
  // the workspace); everything that would let content leave the frame stays blocked.
  assert.equal(REPLAY_SANDBOX_ATTRIBUTE, "allow-scripts allow-same-origin");
  for (const flag of ["allow-top-navigation", "allow-popups", "allow-forms", "allow-downloads", "allow-modals"]) {
    assert.ok(!REPLAY_SANDBOX_ATTRIBUTE.includes(flag), `${flag} must stay blocked`);
  }
  assert.ok(REPLAY_SANDBOX_CSP.startsWith("default-src 'none'"));
  assert.ok(REPLAY_SANDBOX_CSP.includes("form-action 'none'"));
  assert.ok(!REPLAY_FRAME_ANCESTORS.includes("https"), "only loopback workspaces may embed the frame");

  const doc = buildReplaySandboxDocument({ playerScript: "var player = 1;", playerStyle: ".rr-player { color: red; }" });
  assert.ok(doc.includes(`content="${REPLAY_SANDBOX_CSP}"`));
  assert.ok(doc.includes("var player = 1;"));
  assert.ok(doc.includes(".rr-player"));
  assert.ok(doc.includes('id="replay-root"'));
  assert.ok(!/https?:\/\//.test(doc), "the document itself references no remote URL");
});

test("SR-09d2 the player frame origin is the loopback alias or nothing at all", () => {
  assert.equal(replayFrameOrigin({ hostname: "127.0.0.1", origin: "http://127.0.0.1:3000" }), "http://localhost:3000");
  assert.equal(replayFrameOrigin({ hostname: "localhost", origin: "http://localhost:3000" }), "http://127.0.0.1:3000");
  assert.equal(replayFrameOrigin({ hostname: "ux-measure-lab.example", origin: "https://ux-measure-lab.example" }), null);
});

test("SR-09e inlined assets cannot break out of their script or style elements", () => {
  const doc = buildReplaySandboxDocument({
    playerScript: 'var x = "</script><script>window.escape = 1</script>";',
    playerStyle: "</style><script>window.escape = 2</script>",
  });
  assert.ok(doc.includes("<\\/script"), "script close sequence is escaped");
  assert.ok(!doc.includes('var x = "</script>'), "the raw close sequence never reaches the document");
  assert.ok(!doc.includes("</style><script>"), "style close sequence is removed");
  // Both closing script tags in the document belong to the two injected elements.
  const scriptClosings = doc.match(/<\/script>/g) ?? [];
  assert.equal(scriptClosings.length, 2, "no asset can terminate a script element early");
});

test("SR-09f the workspace accepts only the three allowlisted status messages", () => {
  assert.equal(isReplayStatusMessage({ type: "replay:ready" }), true);
  assert.equal(isReplayStatusMessage({ type: "replay:playing" }), true);
  assert.equal(isReplayStatusMessage({ type: "replay:error" }), true);
  assert.equal(isReplayStatusMessage({ type: "replay:load", events: [] }), false);
  assert.equal(isReplayStatusMessage({ type: "click" }), false);
  assert.equal(isReplayStatusMessage("replay:ready"), false);
  assert.equal(isReplayStatusMessage(null), false);
});

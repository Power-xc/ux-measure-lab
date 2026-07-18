// Sandboxed replay playback. spec.md (session-replay) §9: the player document is
// served from the loopback ALIAS origin (127.0.0.1 workspace ↔ localhost frame), so
// the browser itself enforces a cross-origin wall between player and workspace while
// rrweb can still rebuild into its nested same-origin iframe. The document's CSP
// blocks every network request, payload scripts and dangerous URLs are removed
// BEFORE the DOM is rebuilt, the frame and the workspace share a minimal message
// allowlist, and a payload that cannot be replayed stops playback without exposing
// raw markup. (A fully opaque origin — allow-scripts only — was measured to break
// the rebuild: a sandboxed-origin document cannot reach any child iframe document.)

/**
 * allow-same-origin keeps the frame on its REAL origin — the loopback alias, which
 * is still cross-origin to the workspace — so the player can script its own rebuild
 * iframe. Navigation, forms, popups, downloads and modals all stay blocked.
 */
export const REPLAY_SANDBOX_ATTRIBUTE = "allow-scripts allow-same-origin";

// default-src 'none' blocks fetch/XHR, images, fonts, media and nested frame loads
// for the player document AND the reconstructed DOM (about:blank children inherit
// this CSP). Only the inline player script and styles injected below may run.
export const REPLAY_SANDBOX_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'";

/**
 * The player frame may only ever live on the loopback pair, and only a loopback
 * workspace may embed it — public deployments never render this document.
 */
export const REPLAY_FRAME_ANCESTORS = "http://127.0.0.1:* http://localhost:*";

/** Resolve the alias origin that serves the sandbox document for this workspace. */
export function replayFrameOrigin(location: { hostname: string; origin: string }): string | null {
  if (location.hostname === "127.0.0.1") return location.origin.replace("127.0.0.1", "localhost");
  if (location.hostname === "localhost") return location.origin.replace("localhost", "127.0.0.1");
  return null; // not a loopback owner runtime: no playback surface at all
}

export type ReplaySandboxAssets = { playerScript: string; playerStyle: string };
export type ReplayPlayerStatus = "replay:ready" | "replay:playing" | "replay:error";

type UnknownRecord = Record<string, unknown>;

const PLAYBACK_BLOCKED_TAGS = new Set([
  "script", "link", "meta", "base", "iframe", "frame", "object", "embed",
  "canvas", "video", "audio", "style",
]);
// The nested rrweb rebuild iframe does not inherit the frame document's CSP, so any
// surviving remote URL would still fetch (a tracking/deanonymization vector). Every
// resource-loading attribute is therefore stripped at the payload layer unless it is
// an inline data: URI — playback shows interaction sequence, not remote media.
const URL_LOADING_ATTRS = new Set([
  "src", "srcset", "poster", "background", "data", "href", "action", "formaction",
  "xlink:href", "longdesc", "cite", "usemap", "codebase", "ping", "icon", "manifest", "lowsrc",
]);
const EVENT_HANDLER_RE = /^on/i;
const DANGEROUS_URL_RE = /^\s*(javascript|vbscript|data):/i;
const CSS_URL_RE = /url\(\s*['"]?[^)]*['"]?\s*\)/gi;
const MAX_DEPTH = 64;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as UnknownRecord : null;
}

function scrubAttributes(value: unknown): void {
  const attributes = record(value);
  if (!attributes) return;
  for (const key of Object.keys(attributes)) {
    const raw = attributes[key];
    if (EVENT_HANDLER_RE.test(key)) {
      delete attributes[key];
      continue;
    }
    if (typeof raw !== "string") continue;
    // javascript:/vbscript:/data: are dropped as dangerous (data:image/svg can script);
    // every remaining resource URL (remote or relative) is dropped so nothing fetches.
    if (DANGEROUS_URL_RE.test(raw) || URL_LOADING_ATTRS.has(key.toLowerCase())) delete attributes[key];
    // Inline styles can smuggle url(...) requests (background images, fonts).
    else if (key.toLowerCase() === "style" && raw.includes("url(")) attributes[key] = raw.replace(CSS_URL_RE, "none");
  }
}

// A blocked tag keeps its node id (later mutations may reference it) but loses its
// identity: it rebuilds as an empty <noscript> that can neither run nor fetch.
function neutralizeBlockedTag(node: UnknownRecord): void {
  const tag = typeof node.tagName === "string" ? node.tagName.toLowerCase() : "";
  if (!PLAYBACK_BLOCKED_TAGS.has(tag)) return;
  node.tagName = "noscript";
  node.attributes = {};
  node.childNodes = [];
  if (typeof node.textContent === "string") node.textContent = "";
}

function scrubValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return null;
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, depth + 1)).filter((item) => item !== null);
  }
  const item = record(value);
  if (!item) return value;
  if (typeof item.tagName === "string") neutralizeBlockedTag(item);
  if ("attributes" in item) scrubAttributes(item.attributes);
  for (const key of Object.keys(item)) {
    const raw = item[key];
    if (typeof raw === "string") {
      // Free-standing URL/style fields (incremental adds, adopted stylesheets) lose
      // dangerous schemes and any url(...) that would fetch a remote resource.
      if (DANGEROUS_URL_RE.test(raw)) item[key] = "";
      else if (raw.includes("url(")) item[key] = raw.replace(CSS_URL_RE, "none");
      continue;
    }
    item[key] = scrubValue(raw, depth + 1);
  }
  return item;
}

/**
 * The playback network backstop. The nested rrweb rebuild iframe does not inherit
 * the frame document CSP, so this scrub — not the CSP — is what guarantees no replay
 * payload can fetch a remote resource: active tags are neutralized, event handlers
 * and dangerous schemes dropped, and every remote resource URL stripped. It runs on
 * EVERY payload before it reaches the frame, on top of the record-time client
 * sanitizer and the ingest privacy rejection.
 */
export function scrubReplayEventsForPlayback(events: readonly unknown[]): unknown[] {
  return events
    .map((event) => scrubValue(structuredClone(event), 0))
    .filter((event): event is UnknownRecord => event !== null);
}

export function isReplayStatusMessage(value: unknown): value is { type: ReplayPlayerStatus } {
  const item = record(value);
  return item !== null && (item.type === "replay:ready" || item.type === "replay:playing" || item.type === "replay:error");
}

// A literal "</script" inside an inlined asset would terminate the element mid-source.
function inlineScript(source: string): string {
  return source.replace(/<\/script/gi, "<\\/script");
}

function inlineStyle(source: string): string {
  return source.replace(/<\/(style|script)/gi, "");
}

const LAYOUT_STYLE = [
  "html, body { margin: 0; padding: 0; background: #101418; color: #dce3ea; font-family: system-ui, sans-serif; overflow: hidden; }",
  "#replay-root { position: relative; height: calc(100vh - 92px); margin: 8px; overflow: hidden; }",
  "#replay-root iframe { border: 0; background: #ffffff; pointer-events: none; }",
  "#replay-controls { display: flex; align-items: center; gap: 10px; padding: 6px 12px; }",
  "#replay-controls button, #replay-controls select { padding: 4px 10px; border: 1px solid #3a4654; border-radius: 6px; background: #1a2129; color: #dce3ea; font: inherit; }",
  "#replay-track { position: relative; flex: 1; }",
  "#replay-track input { width: 100%; margin: 0; }",
  "#replay-markers { position: absolute; inset: -6px 0 auto; height: 4px; pointer-events: none; }",
  "#replay-markers i { position: absolute; top: 0; width: 3px; height: 4px; background: #5c9dff; }",
  "#replay-clock { min-width: 88px; font-variant-numeric: tabular-nums; font-size: 13px; }",
  "#replay-status { margin: 0; padding: 4px 12px 8px; font-size: 13px; }",
  "a { pointer-events: none; }",
].join("\n");

// The bootstrap is plain inline JS: it accepts exactly one `replay:load` message from
// the parent, drives the vendored @rrweb/replay core behind a minimal controller
// (pause, speed, timeline, click markers — spec §4), and reports back only through
// the status allowlist. A failed payload stops playback with a text notice — raw
// markup is never shown. (rrweb-player 2.1.0 was measured to ship without its
// Replayer wiring, so the controller is owned here; see research.md §1.)
const BOOTSTRAP = `(function () {
  "use strict";
  var statusNode = document.getElementById("replay-status");
  var started = false;
  function notify(type) { window.parent.postMessage({ type: type }, "*"); }
  function fail(message) {
    if (statusNode) statusNode.textContent = message;
    var root = document.getElementById("replay-root");
    if (root) root.textContent = "";
    var bar = document.getElementById("replay-controls");
    if (bar) bar.style.display = "none";
    notify("replay:error");
  }
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent || started) return;
    var data = event.data;
    if (!data || data.type !== "replay:load" || !Array.isArray(data.events)) return;
    started = true;
    if (data.events.length < 2) { fail("재생할 수 있는 녹화 데이터가 아닙니다."); return; }
    var exported = window.rrwebReplay;
    var Replayer = exported && (exported.Replayer || (exported.default && exported.default.Replayer));
    if (typeof Replayer !== "function") { fail("플레이어를 초기화하지 못했습니다."); return; }
    try {
      var root = document.getElementById("replay-root");
      var replayer = new Replayer(data.events, { root: root, speed: 1, mouseTail: false, showWarning: false, showDebug: false });
      var meta = replayer.getMetaData();
      var total = Math.max(1, meta.totalTime);
      var playing = false;
      var playButton = document.getElementById("replay-toggle");
      var range = document.getElementById("replay-timeline");
      var clock = document.getElementById("replay-clock");
      var marks = document.getElementById("replay-markers");
      for (var index = 0; index < data.events.length; index += 1) {
        var item = data.events[index];
        if (item && item.type === 3 && item.data && item.data.source === 2) {
          var mark = document.createElement("i");
          mark.style.left = Math.min(100, Math.max(0, ((item.timestamp - meta.startTime) / total) * 100)) + "%";
          marks.appendChild(mark);
        }
      }
      function fmt(ms) {
        var seconds = Math.floor(ms / 1000);
        return Math.floor(seconds / 60) + ":" + ("0" + (seconds % 60)).slice(-2);
      }
      function rescale() {
        var wrapper = root.querySelector(".replayer-wrapper");
        var frame = root.querySelector("iframe");
        if (!wrapper || !frame) return;
        var frameWidth = Number(frame.getAttribute("width")) || frame.offsetWidth || 1;
        var frameHeight = Number(frame.getAttribute("height")) || frame.offsetHeight || 1;
        var scale = Math.min(root.clientWidth / frameWidth, root.clientHeight / frameHeight, 1);
        wrapper.style.transform = "scale(" + scale + ")";
        wrapper.style.transformOrigin = "top left";
        wrapper.style.position = "absolute";
        wrapper.style.left = "0";
        wrapper.style.top = "0";
      }
      function paint() {
        var current = Math.min(Math.max(replayer.getCurrentTime(), 0), total);
        range.value = String(Math.round((current / total) * 1000));
        clock.textContent = fmt(current) + " / " + fmt(total);
        rescale();
      }
      function setPlaying(next) {
        playing = next;
        playButton.textContent = playing ? "일시정지" : "재생";
      }
      playButton.addEventListener("click", function () {
        if (playing) { replayer.pause(); setPlaying(false); return; }
        var offset = replayer.getCurrentTime();
        replayer.play(offset >= total ? 0 : offset);
        setPlaying(true);
      });
      range.addEventListener("input", function () {
        var offset = (Number(range.value) / 1000) * total;
        if (playing) replayer.play(offset); else replayer.pause(offset);
        paint();
      });
      document.getElementById("replay-speed").addEventListener("change", function (changeEvent) {
        replayer.setConfig({ speed: Number(changeEvent.target.value) || 1 });
      });
      replayer.on("finish", function () { setPlaying(false); });
      window.addEventListener("resize", rescale);
      window.setInterval(paint, 250);
      paint();
      if (statusNode) statusNode.textContent = "재생 준비가 끝났습니다.";
      notify("replay:playing");
    } catch (error) {
      fail("이 녹화는 재생할 수 없어 중단했습니다. 원본 내용은 표시하지 않습니다.");
    }
  });
  notify("replay:ready");
})();`;

/** Self-contained sandbox document: no URL reference leaves this string at runtime. */
export function buildReplaySandboxDocument(assets: ReplaySandboxAssets): string {
  return [
    "<!doctype html>",
    '<html lang="ko">',
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${REPLAY_SANDBOX_CSP}">`,
    `<style>${inlineStyle(assets.playerStyle)}</style>`,
    `<style>${LAYOUT_STYLE}</style>`,
    "</head>",
    "<body>",
    '<div id="replay-root"></div>',
    '<div id="replay-controls">',
    '<button id="replay-toggle" type="button">재생</button>',
    '<span id="replay-clock">0:00 / 0:00</span>',
    '<div id="replay-track"><div id="replay-markers"></div><input aria-label="재생 위치" id="replay-timeline" max="1000" min="0" step="1" type="range" value="0"></div>',
    '<select aria-label="재생 속도" id="replay-speed"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select>',
    "</div>",
    '<p id="replay-status" role="status">녹화 데이터를 기다리는 중…</p>',
    `<script>${inlineScript(assets.playerScript)}</script>`,
    `<script>${BOOTSTRAP}</script>`,
    "</body>",
    "</html>",
  ].join("\n");
}

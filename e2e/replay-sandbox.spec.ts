import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  buildReplaySandboxDocument,
  REPLAY_SANDBOX_CSP,
  scrubReplayEventsForPlayback,
} from "../src/features/replay/lib/player-sandbox";

// Gate 8 (session-replay spec §9) exercised against the REAL vendored @rrweb/replay
// 2.1.0 bundle across the loopback origin boundary: parent on 127.0.0.1 (the test
// baseURL), the sandbox frame served on localhost with its own network-blocking CSP.
// A deliberately hostile payload is scrubbed exactly as the workspace scrubs it, then
// we assert the sandbox executes no script, fetches nothing, and cannot reach the parent.

const require = createRequire(import.meta.url);
const distDir = dirname(require.resolve("@rrweb/replay"));
const playerScript = readFileSync(join(distDir, "replay.umd.min.cjs"), "utf8");
const playerStyle = readFileSync(join(distDir, "style.min.css"), "utf8");
const frameDocument = buildReplaySandboxDocument({ playerScript, playerStyle });
// The replay sandbox is a development-only feature, so the realistic parent is the
// dev workspace CSP (frame-src allows the loopback alias). Both parent and frame are
// served through route interception so the test does not depend on the prod-build CSP.
const PARENT_URL = "http://127.0.0.1:3000/__replay_sandbox_parent";
const FRAME_URL = "http://localhost:3000/__replay_sandbox_frame";
const FRAME_ORIGIN = "http://localhost:3000";
const PARENT_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; frame-src http://127.0.0.1:* http://localhost:*";

const START = 1_752_800_000_000;
const hostileEvents = [
  { type: 4, data: { href: "https://masked.example/checkout", width: 1280, height: 720 }, timestamp: START },
  {
    type: 2,
    data: {
      node: { type: 0, id: 1, childNodes: [
        { type: 1, id: 2, name: "html", publicId: "", systemId: "" },
        { type: 2, id: 3, tagName: "html", attributes: {}, childNodes: [
          { type: 2, id: 4, tagName: "head", attributes: {}, childNodes: [] },
          { type: 2, id: 5, tagName: "body", attributes: {}, childNodes: [
            { type: 2, id: 10, tagName: "h1", attributes: {}, childNodes: [{ type: 3, id: 11, textContent: "**** ****" }] },
            { type: 2, id: 20, tagName: "script", attributes: {}, childNodes: [{ type: 3, id: 21, textContent: "window.__pwned = true; try { window.top.__pwned = true; } catch (error) {}" }] },
            { type: 2, id: 30, tagName: "img", attributes: { src: "https://evil.invalid/beacon.png" }, childNodes: [] },
            { type: 2, id: 40, tagName: "button", attributes: { onclick: "fetch('https://evil.invalid/x')" }, childNodes: [{ type: 3, id: 41, textContent: "****" }] },
          ] },
        ] },
      ] },
      initialOffset: { left: 0, top: 0 },
    },
    timestamp: START + 20,
  },
  { type: 3, data: { source: 1, positions: [{ x: 40, y: 40, id: 40, timeOffset: -20 }] }, timestamp: START + 600 },
  { type: 3, data: { source: 2, type: 2, id: 40, x: 42, y: 44 }, timestamp: START + 1400 },
];

test("SR-09 the sandbox plays a scrubbed recording without script, network or parent access", async ({ page }) => {
  const scrubbed = scrubReplayEventsForPlayback(hostileEvents);

  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("evil.invalid")) externalRequests.push(request.url());
  });

  // Parent workspace document on 127.0.0.1 with the dev-equivalent frame-src CSP.
  await page.route(PARENT_URL, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      headers: { "Content-Security-Policy": PARENT_CSP },
      body: "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>",
    });
  });
  // Serve the frame document on the loopback alias with the strict CSP + ancestors.
  await page.route(FRAME_URL, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      headers: { "Content-Security-Policy": `${REPLAY_SANDBOX_CSP}; frame-ancestors http://127.0.0.1:* http://localhost:*` },
      body: frameDocument,
    });
  });

  await page.goto(PARENT_URL);
  await page.waitForLoadState("networkidle");

  // The workspace embeds the frame cross-origin and only ever sends scrubbed events.
  await page.evaluate(({ frameUrl, frameOrigin, events }) => {
    (window as unknown as { __statuses: string[] }).__statuses = [];
    window.addEventListener("message", (event: MessageEvent) => {
      const statuses = (window as unknown as { __statuses: string[] }).__statuses;
      const data = event.data as { type?: string } | null;
      if (!data || typeof data.type !== "string") return;
      statuses.push(data.type);
      const frame = document.getElementById("__replay_test_frame") as HTMLIFrameElement | null;
      if (data.type === "replay:ready") frame?.contentWindow?.postMessage({ type: "replay:load", events }, frameOrigin);
    });
    const frame = document.createElement("iframe");
    frame.id = "__replay_test_frame";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.style.cssText = "width:900px;height:600px";
    frame.src = frameUrl;
    document.body.appendChild(frame);
  }, { frameUrl: FRAME_URL, frameOrigin: FRAME_ORIGIN, events: scrubbed });

  // The bootstrap reports readiness and then playback through the status allowlist.
  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { __statuses: string[] }).__statuses), { timeout: 10_000 })
    .toContain("replay:playing");

  const frame = page.frames().find((candidate) => candidate.url() === FRAME_URL);
  expect(frame, "the sandbox frame is present").toBeTruthy();

  // rrweb rebuilt the DOM into its nested replay iframe: the masked heading is there.
  await expect(frame!.locator(".replayer-wrapper")).toHaveCount(1);
  await expect(frame!.frameLocator(".replayer-wrapper iframe").locator("h1")).toHaveText("**** ****");

  // No injected script ran (neither in the frame nor the parent) and nothing was fetched.
  expect(await page.evaluate(() => Boolean((window as unknown as { __pwned?: boolean }).__pwned))).toBe(false);
  expect(await frame!.evaluate(() => Boolean((window as unknown as { __pwned?: boolean }).__pwned))).toBe(false);
  expect(externalRequests, "no replay payload triggers a network request").toEqual([]);

  // The frame cannot reach across the origin boundary into the workspace.
  const parentReach = await frame!.evaluate(() => {
    try {
      return Boolean(window.parent.document.title || true) && "reached";
    } catch {
      return "blocked";
    }
  });
  expect(parentReach).toBe("blocked");
});

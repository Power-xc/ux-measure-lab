// Owner-only sandbox frame boundary. spec.md (session-replay) §5·§9: the player
// document is self-contained (vendored rrweb-player inlined, no asset URL), carries
// its own network-blocking CSP as an HTTP header, and may only be embedded by a
// loopback workspace. It renders nothing by itself — recording payloads arrive from
// the parent through the message allowlist, never through this response.

import {
  buildReplaySandboxDocument,
  REPLAY_FRAME_ANCESTORS,
  REPLAY_SANDBOX_CSP,
} from "../lib/player-sandbox.ts";

export type ReplayPlayerAssetName = "script" | "style";

export type ReplayFrameDeps = {
  enabled: boolean; // NODE_ENV=development + UX_MEASURE_REPLAY_ENABLED=true
  readAsset: (name: ReplayPlayerAssetName) => Promise<string>;
};

// The global next.config CSP would forbid framing entirely, so this route is excluded
// there and pins its OWN complete policy instead — strictly tighter on every fetch
// directive, plus the loopback-only frame-ancestors that replaces X-Frame-Options.
export const REPLAY_FRAME_HEADERS = {
  "Content-Security-Policy": `${REPLAY_SANDBOX_CSP}; frame-ancestors ${REPLAY_FRAME_ANCESTORS}`,
  "Cache-Control": "no-store",
  "Content-Type": "text/html; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

function fail(status: number): Response {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

export function createReplayFrameGet(deps: ReplayFrameDeps) {
  return async function handleReplayFrame(): Promise<Response> {
    if (!deps.enabled) return fail(404);
    try {
      const [playerScript, playerStyle] = await Promise.all([deps.readAsset("script"), deps.readAsset("style")]);
      if (!playerScript || !playerStyle) return fail(503);
      return new Response(buildReplaySandboxDocument({ playerScript, playerStyle }), { headers: REPLAY_FRAME_HEADERS });
    } catch {
      return fail(503);
    }
  };
}

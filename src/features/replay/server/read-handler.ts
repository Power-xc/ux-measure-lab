// Owner-only replay read/delete boundary. spec.md (session-replay) §5·§8: until
// authentication exists, the read path is enabled only on the loopback development
// runtime, is same-origin, exposes no stable public URL, and every response is
// no-store. Deletion covers a single recording or a whole anonymous visitor.

import { hasAllowedOrigin, isSameOriginRequest, jsonResponse } from "../../../shared/server/request-guards.ts";
import { sha256Hex } from "../../ingest/server/hash.ts";
import type { ReplayStore } from "./store.ts";

export type ReplayReadDeps = {
  enabled: boolean; // NODE_ENV=development + UX_MEASURE_REPLAY_ENABLED=true
  siteId: string | null; // single-tenant owner site; null → not provisioned
  store: ReplayStore;
  now: () => number;
};

export function isReplayRuntimeEnabled(environment: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return environment.NODE_ENV === "development" && environment.UX_MEASURE_REPLAY_ENABLED === "true";
}

const NO_STORE = { "Cache-Control": "no-store" };

function fail(status: number, error: string): Response {
  return jsonResponse({ error }, { status, headers: NO_STORE });
}

function guard(deps: ReplayReadDeps, request: Request): Response | { siteId: string } {
  if (!deps.enabled) return fail(404, "replay_disabled");
  // Same-origin only. An explicit Origin, when present, must still match the host,
  // so a cross-origin fetch that forges Sec-Fetch-Site cannot slip through.
  const origin = request.headers.get("origin");
  if (!isSameOriginRequest(request) || (origin !== null && !hasAllowedOrigin(request))) {
    return fail(403, "origin_not_allowed");
  }
  if (!deps.siteId) return fail(503, "not_provisioned");
  return { siteId: deps.siteId };
}

export function createReplayReadGet(deps: ReplayReadDeps) {
  return async function handleReplayRead(request: Request): Promise<Response> {
    const guarded = guard(deps, request);
    if (guarded instanceof Response) return guarded;
    // Expired payloads must never be served even before the daily purge runs.
    await deps.store.purgeExpired(new Date(deps.now()).toISOString());

    const recordingId = new URL(request.url).searchParams.get("recording");
    if (!recordingId) {
      const recordings = await deps.store.listRecordings(guarded.siteId);
      return jsonResponse({ recordings }, { headers: NO_STORE });
    }
    const chunks = await deps.store.readChunks(guarded.siteId, recordingId.trim());
    if (chunks.length === 0) return fail(404, "recording_unavailable");
    return jsonResponse(
      { recordingId: recordingId.trim(), chunks: chunks.map((chunk) => ({ sequence: chunk.sequence, events: JSON.parse(chunk.payload) as unknown })) },
      { headers: NO_STORE },
    );
  };
}

export function createReplayReadDelete(deps: ReplayReadDeps) {
  return async function handleReplayDelete(request: Request): Promise<Response> {
    const guarded = guard(deps, request);
    if (guarded instanceof Response) return guarded;

    const url = new URL(request.url);
    const recordingId = url.searchParams.get("recording")?.trim();
    const visitor = url.searchParams.get("visitor")?.trim();
    if (recordingId) {
      const deleted = await deps.store.deleteRecording(guarded.siteId, recordingId);
      return jsonResponse({ deleted }, { headers: NO_STORE });
    }
    if (visitor) {
      // Deletion requests arrive with the raw anonymous ID; only its hash is compared.
      const deleted = await deps.store.deleteVisitor(guarded.siteId, await sha256Hex(visitor));
      return jsonResponse({ deleted }, { headers: NO_STORE });
    }
    return fail(400, "invalid_request");
  };
}

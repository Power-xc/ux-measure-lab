import { defaultReplayStore } from "../../../../features/replay/server/default-store.ts";
import { readReplayDogfoodKey, REPLAY_DOGFOOD_SITE_ID } from "../../../../features/replay/server/env-site-store.ts";
import {
  createReplayReadDelete,
  createReplayReadGet,
  isReplayRuntimeEnabled,
  type ReplayReadDeps,
} from "../../../../features/replay/server/read-handler.ts";
import { jsonResponse } from "../../../../shared/server/request-guards.ts";
import { readServerEnv } from "../../../../shared/server/env.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function createDeps(): ReplayReadDeps {
  // The owner site is the env-provisioned loopback dogfood site when a key is set
  // (replay storage is in-memory here), otherwise the Supabase-provisioned site —
  // the same single-tenant boundary either way.
  const siteId = readReplayDogfoodKey(process.env)
    ? REPLAY_DOGFOOD_SITE_ID
    : (readServerEnv().supabase?.siteId ?? null);
  return {
    enabled: isReplayRuntimeEnabled(),
    siteId,
    store: defaultReplayStore,
    now: () => Date.now(),
  };
}

const get = createReplayReadGet(createDeps());
const del = createReplayReadDelete(createDeps());

export async function GET(request: Request): Promise<Response> {
  try {
    return await get(request);
  } catch {
    return jsonResponse({ error: "unavailable" }, { status: 503 });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    return await del(request);
  } catch {
    return jsonResponse({ error: "unavailable" }, { status: 503 });
  }
}

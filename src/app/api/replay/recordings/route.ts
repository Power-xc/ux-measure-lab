import { defaultReplayStore } from "../../../../features/replay/server/default-store.ts";
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
  return {
    enabled: isReplayRuntimeEnabled(),
    siteId: readServerEnv().supabase?.siteId ?? null,
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

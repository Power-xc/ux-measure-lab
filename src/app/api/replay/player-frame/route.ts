import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createReplayFrameGet,
  type ReplayPlayerAssetName,
} from "../../../../features/replay/server/player-frame.ts";
import { isReplayRuntimeEnabled } from "../../../../features/replay/server/read-handler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The package export map only exposes its entry point, so vendored dist files are
// read by their known subpath. process.cwd() is a runtime value (the loopback dev
// server's project root) — unlike import.meta.url, the bundler does not virtualize it.
const ASSET_FILES: Record<ReplayPlayerAssetName, string> = {
  script: "replay.umd.min.cjs",
  style: "style.min.css",
};
const cache = new Map<ReplayPlayerAssetName, string>();

async function readAsset(name: ReplayPlayerAssetName): Promise<string> {
  const cached = cache.get(name);
  if (cached) return cached;
  const path = join(process.cwd(), "node_modules", "@rrweb", "replay", "dist", ASSET_FILES[name]);
  const content = await readFile(path, "utf8");
  cache.set(name, content);
  return content;
}

const get = createReplayFrameGet({ enabled: isReplayRuntimeEnabled(), readAsset });

export async function GET(): Promise<Response> {
  try {
    return await get();
  } catch {
    return new Response(null, { status: 503 });
  }
}

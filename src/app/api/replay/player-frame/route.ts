import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createReplayFrameGet,
  type ReplayPlayerAssetName,
} from "../../../../features/replay/server/player-frame.ts";
import { isReplayRuntimeEnabled } from "../../../../features/replay/server/read-handler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const require = createRequire(import.meta.url);
// The package export map only exposes its entry point, so vendored dist files are
// located relative to the resolved entry instead of by subpath.
const ASSET_FILES: Record<ReplayPlayerAssetName, string> = {
  script: "replay.umd.min.cjs",
  style: "style.min.css",
};
const cache = new Map<ReplayPlayerAssetName, string>();

async function readAsset(name: ReplayPlayerAssetName): Promise<string> {
  const cached = cache.get(name);
  if (cached) return cached;
  const distDir = dirname(require.resolve("@rrweb/replay"));
  const content = await readFile(join(distDir, ASSET_FILES[name]), "utf8");
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

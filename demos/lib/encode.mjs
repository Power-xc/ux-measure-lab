import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { FPS } from "./stage.mjs";

const GIF_WIDTH = 960;
const MAX_COLORS = 128;
export const FFMPEG = process.env.FFMPEG_PATH || "/opt/homebrew/bin/ffmpeg";

// palettegen(stats_mode=diff) + paletteuse로 무한 반복 GIF를 만든다.
export function encodeGif(framesDir, outFile, { crop, width = GIF_WIDTH } = {}) {
  const cropFilter = crop ? `crop=${crop},` : "";
  const filter = `${cropFilter}scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff:max_colors=${MAX_COLORS}[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
  execFileSync(FFMPEG, ["-y", "-v", "error", "-framerate", String(FPS), "-i", join(framesDir, "%05d.png"), "-filter_complex", filter, "-loop", "0", outFile]);
  const frames = readdirSync(framesDir).filter((f) => f.endsWith(".png")).length;
  const mb = statSync(outFile).size / 1024 / 1024;
  return { frames, seconds: frames / FPS, mb };
}

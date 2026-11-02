#!/usr/bin/env node
// 사용법: node demos/record.mjs [hero harness fleet validate social ...]  (인자 없으면 전부)
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeGif } from "./lib/encode.mjs";
import { mockHarness } from "./lib/mock-harness.mjs";
import { openStage } from "./lib/stage.mjs";
import { fleet } from "./scenes/fleet.mjs";
import { harness } from "./scenes/harness.mjs";
import { hero } from "./scenes/hero.mjs";
import { social } from "./scenes/social.mjs";
import { validate } from "./scenes/validate.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(ROOT, "..", "assets", "demos");
const FRAMES_ROOT = join(ROOT, ".frames");
const BASE_URL = process.env.DEMO_BASE_URL || "http://127.0.0.1:3000";
const SCENES = [hero, harness, fleet, validate, social];

async function assertReachable() {
  try {
    const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (error) {
    console.error(`앱에 연결할 수 없습니다: ${BASE_URL} (${error.message})\n먼저 'npm run build && npx next start --hostname 127.0.0.1 -p 3100'로 서버를 띄우고 DEMO_BASE_URL을 지정하세요.`);
    process.exit(1);
  }
}

async function recordScene(scene) {
  const stage = await openStage({ baseUrl: BASE_URL, name: scene.name, framesRoot: FRAMES_ROOT, viewport: scene.viewport });
  try {
    await mockHarness(stage.page);
    if (scene.still) {
      const outFile = join(OUT_DIR, "social-preview.png");
      await scene.run(stage, { outFile });
      console.log(`social-preview.png  1280x640`);
      return;
    }
    await scene.run(stage);
    const out = join(OUT_DIR, `${scene.name}.gif`);
    const info = encodeGif(stage.dir, out, scene.encode);
    console.log(`${scene.name}.gif  프레임 ${info.frames}  ${info.seconds.toFixed(1)}s  ${info.mb.toFixed(2)}MB`);
  } finally {
    await stage.close();
  }
}

const wanted = process.argv.slice(2);
const unknown = wanted.filter((name) => !SCENES.some((scene) => scene.name === name));
if (unknown.length) {
  console.error(`알 수 없는 장면: ${unknown.join(", ")} (가능: ${SCENES.map((scene) => scene.name).join(", ")})`);
  process.exit(1);
}
const targets = wanted.length ? SCENES.filter((s) => wanted.includes(s.name)) : SCENES;
await assertReachable();
await mkdir(OUT_DIR, { recursive: true });
for (const scene of targets) await recordScene(scene);

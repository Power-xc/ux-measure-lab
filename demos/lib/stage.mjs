// 프레임 단위 캡처 무대: 가짜 커서, 부드러운 스크롤, 타이핑을 결정적으로 기록한다.
import { chromium } from "@playwright/test";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

export const FPS = 10;
export const VIEWPORT = { width: 960, height: 620 };
const SCALE = 1.5;
const GLIDE_PX_PER_FRAME = 90;
const GLIDE_MIN_FRAMES = 3;
const RING_FRAMES = 2;
// 장면별 속도: 느리면 설명용, 빠르면 전체 흐름 압축용.
export const TEMPO = {
  calm: { glideMax: 9, scrollFrames: 8, typeFrames: 10, settle: 0.5, typeAll: true },
  quick: { glideMax: 3, scrollFrames: 3, typeFrames: 3, settle: 0.1, typeAll: false },
};

const CURSOR_CSS = `
  html { scrollbar-width: none; }
  ::-webkit-scrollbar { display: none; }
  #demo-cursor { position: fixed; left: 0; top: 0; width: 22px; height: 22px; z-index: 2147483647; pointer-events: none; }
  #demo-ring { position: fixed; left: 0; top: 0; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 50%;
    border: 3px solid #1f3a8a; opacity: 0; z-index: 2147483646; pointer-events: none; }
`;
const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M2 1l15 9-6.5 1.5L8 18z" fill="#111827" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export async function openStage({ baseUrl, name, framesRoot, viewport = VIEWPORT }) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, deviceScaleFactor: SCALE, locale: "ko-KR", acceptDownloads: true });
  const page = await context.newPage();
  const dir = join(framesRoot, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const stage = new Stage(browser, page, dir, viewport);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await stage.installOverlay();
  return stage;
}

class Stage {
  constructor(browser, page, dir, viewport) {
    this.viewport = viewport;
    this.browser = browser;
    this.page = page;
    this.dir = dir;
    this.count = 0;
    this.pos = { x: 560, y: 360 };
    this.last = null;
    this.tempo = TEMPO.calm;
    this.recording = true;
  }

  async installOverlay() {
    await this.page.addStyleTag({ content: CURSOR_CSS });
    await this.page.evaluate(({ svg, pos }) => {
      const cursor = document.createElement("div");
      cursor.id = "demo-cursor";
      cursor.innerHTML = svg;
      const ring = document.createElement("div");
      ring.id = "demo-ring";
      document.body.append(ring, cursor);
      cursor.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    }, { svg: CURSOR_SVG, pos: this.pos });
  }

  async snap() {
    if (!this.recording) return;
    this.count += 1;
    this.last = join(this.dir, `${String(this.count).padStart(5, "0")}.png`);
    // 날짜 입력이 가로 스크롤을 밀어내면 되돌린다.
    await this.page.evaluate(() => { if (window.scrollX) window.scrollTo(0, window.scrollY); });
    await this.page.screenshot({ path: this.last });
  }

  // 정지 화면: 마지막 프레임을 복제해 일정 시간 유지한다.
  async hold(seconds) {
    if (!this.recording) return;
    if (!this.last) await this.snap();
    const frames = Math.round(seconds * FPS);
    for (let i = 0; i < frames; i += 1) {
      this.count += 1;
      const next = join(this.dir, `${String(this.count).padStart(5, "0")}.png`);
      await copyFile(this.last, next);
      this.last = next;
    }
  }

  // 화면이 바뀐 직후 한 번 새로 찍고 유지한다.
  async show(seconds) {
    await this.page.waitForTimeout(150);
    await this.snap();
    await this.hold(seconds - 1 / FPS);
  }

  // 녹화 없이 사전 단계를 빠르게 진행한다 (장면 시작 상태 준비용).
  async silent(fn) {
    const saved = { tempo: this.tempo, recording: this.recording };
    this.tempo = TEMPO.quick;
    this.recording = false;
    try {
      await fn();
    } finally {
      Object.assign(this, saved);
    }
  }

  async setCursor(x, y) {
    this.pos = { x, y };
    await this.page.evaluate(({ x, y }) => {
      document.getElementById("demo-cursor").style.transform = `translate(${x}px, ${y}px)`;
    }, { x, y });
  }

  async scrollIntoView(locator, align = 0.4) {
    const box = await locator.boundingBox();
    const { height } = this.viewport;
    if (box && box.y > 70 && box.y + box.height < height - 30) return;
    const current = await this.page.evaluate(() => window.scrollY);
    const wanted = Math.max(0, current + (box?.y ?? 0) - height * align);
    await this.scrollTo(wanted);
  }

  async scrollTo(wanted) {
    const current = await this.page.evaluate(() => window.scrollY);
    const frames = this.tempo.scrollFrames;
    for (let i = 1; i <= frames; i += 1) {
      await this.page.evaluate((y) => window.scrollTo(0, y), current + (wanted - current) * ease(i / frames));
      await this.snap();
    }
  }

  async glideTo(locator) {
    await this.scrollIntoView(locator);
    const box = await locator.boundingBox();
    const to = { x: box.x + Math.min(box.width * 0.5, 160), y: box.y + box.height / 2 };
    const from = this.pos;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const frames = Math.min(this.tempo.glideMax, Math.max(GLIDE_MIN_FRAMES, Math.round(distance / GLIDE_PX_PER_FRAME)));
    for (let i = 1; i <= frames; i += 1) {
      const t = ease(i / frames);
      await this.setCursor(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
      await this.snap();
    }
    return to;
  }

  async click(locator, { settle = this.tempo.settle } = {}) {
    const to = await this.glideTo(locator);
    for (let i = 0; i < RING_FRAMES; i += 1) {
      await this.page.evaluate(({ x, y, i }) => {
        const ring = document.getElementById("demo-ring");
        ring.style.transform = `translate(${x}px, ${y}px) scale(${0.5 + i * 0.5})`;
        ring.style.opacity = String(0.9 - i * 0.4);
      }, { ...to, i });
      if (i === 1) await this.page.mouse.click(to.x, to.y);
      await this.snap();
    }
    await this.page.evaluate(() => { document.getElementById("demo-ring").style.opacity = "0"; });
    await this.page.waitForTimeout(120);
    if (this.tempo.typeAll) await this.snap();
    await this.hold(settle);
  }

  async type(locator, text) {
    await this.glideTo(locator);
    await locator.click();
    await locator.fill("");
    const frames = Math.min(this.tempo.typeFrames, text.length);
    for (let i = 1; i <= frames; i += 1) {
      await locator.fill(text.slice(0, Math.ceil((text.length * i) / frames)));
      await this.snap();
    }
    await this.hold(this.tempo.typeAll ? 0.3 : 0.1);
  }

  // 빠른 속도에서는 첫 필드만 타이핑으로 보여주고 나머지는 곧바로 채운다.
  async field(locator, text, { first = false } = {}) {
    if (this.tempo.typeAll || first) return this.type(locator, text);
    await locator.fill(String(text));
  }

  // 값을 한 번에 채우는 입력(날짜·숫자)도 커서가 먼저 도착한 뒤 바뀐다.
  async value(locator, value) {
    if (!this.tempo.typeAll) return locator.fill(String(value));
    await this.glideTo(locator);
    await locator.click();
    await locator.fill(String(value));
    await this.snap();
    await this.hold(0.2);
  }

  async select(locator, value) {
    await this.glideTo(locator);
    await locator.selectOption(value);
    await this.snap();
    await this.hold(0.4);
  }

  async close() {
    await this.browser.close();
  }
}

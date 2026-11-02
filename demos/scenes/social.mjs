import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prepare } from "../lib/flows.mjs";

const TEMPLATE = fileURLToPath(new URL("../social.html", import.meta.url));
const SIZE = { width: 1280, height: 640 };

// 실제 앱 화면(퍼널 분석 단계)을 찍어 HTML 템플릿에 넣고 1280x640 PNG로 렌더링한다.
export const social = {
  name: "social",
  still: true,
  viewport: { width: 1000, height: 780 },
  async run(s, { outFile }) {
    await prepare(s, "diagnose");
    await s.page.getByRole("button", { name: /← Measure/ }).click();
    await s.page.getByText(/전체 전환율/).first().waitFor();
    await s.page.evaluate(() => window.scrollTo(0, 0));
    await s.page.waitForTimeout(300);
    const shot = await s.page.screenshot({ type: "png" });
    const card = await s.browser.newPage({ viewport: SIZE, deviceScaleFactor: 1 });
    await card.setContent(readFileSync(TEMPLATE, "utf8"));
    await card.evaluate((src) => { document.getElementById("app").src = src; }, `data:image/png;base64,${shot.toString("base64")}`);
    await card.waitForFunction(() => document.getElementById("app").complete);
    await card.screenshot({ path: outFile });
    await card.close();
  },
};

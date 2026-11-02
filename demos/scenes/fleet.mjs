import { prepare } from "../lib/flows.mjs";
import { TEMPO } from "../lib/stage.mjs";

const VARIANTS = "A안 | 책 등록 직후 노트 입력창 노출\nB안 | 등록 완료 화면에 노트 안내 배너";

export const fleet = {
  name: "fleet",
  viewport: { width: 1120, height: 700 },
  encode: { width: 1120 },
  async run(s) {
    const { page } = s;
    await prepare(s, "experiment");
    s.tempo = TEMPO.quick;
    await s.show(0.5);
    const box = page.locator("details").filter({ hasText: /함대 모드/ }).first();
    await s.click(box.locator("summary").filter({ hasText: /함대 모드/ }));
    await s.type(box.getByLabel(/변형 목록/), VARIANTS);
    await s.click(box.getByRole("button", { name: /함대 사전 등록/ }));
    await box.getByText(/PREREGISTERED FLEET/i).waitFor();
    await s.show(1.5);
    await s.click(box.locator("summary").filter({ hasText: /측정에서 채우기/ }));
    await s.value(box.getByLabel(/관찰 시작/), "2026-07-01T00:00");
    await s.value(box.getByLabel(/관찰 종료/), "2026-07-08T00:00");
    await s.click(box.getByRole("button", { name: /변형별 관찰 불러오기/ }));
    await box.getByText(/전환 수치를 채웠습니다/).waitFor();
    await s.show(1.5);
    await s.click(box.getByRole("button", { name: /웨이브 1 판정/ }), { settle: 0.3 });
    await box.getByText(/WAVE 1 VERDICTS/i).waitFor();
    await s.scrollIntoView(box.getByText(/WAVE 1 VERDICTS/i), 0.15);
    await s.show(2);
    await box.getByText(/승격 확정 웨이브 — 승격 후보를 신규 표본으로 재검증/).scrollIntoViewIfNeeded();
    await s.show(1.5);
    await s.value(box.getByLabel("A안 전환 사용자"), 56);
    await s.value(box.getByLabel("A안 전체 사용자"), 400);
    await s.click(box.getByRole("button", { name: /웨이브 2 판정/ }), { settle: 0.3 });
    await box.getByText(/승격 확정 — 후보가 신규 표본의 확정 웨이브를 통과/).waitFor();
    await s.scrollIntoView(box.getByText(/승격 확정 — 후보가/), 0.4);
    await s.show(2.5);
  },
};

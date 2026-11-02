import { prepare, STORY } from "../lib/flows.mjs";

export const harness = {
  name: "harness",
  async run(s) {
    const { page } = s;
    await prepare(s, "diagnose");
    const box = page.locator('section[aria-labelledby="harness-title"]');
    await box.scrollIntoViewIfNeeded();
    await s.scrollTo(await page.evaluate(() => window.scrollY - 60));
    await s.show(1);
    await s.type(box.getByLabel("측정 질문"), STORY.question);
    await s.value(box.getByLabel("측정 시작"), "2026-07-01T00:00");
    await s.value(box.getByLabel("측정 종료"), "2026-07-08T00:00");
    await s.click(box.getByRole("button", { name: "측정 실행" }));
    const apply = box.getByRole("button", { name: "Evidence로 적용" });
    await apply.waitFor();
    await s.scrollTo(await page.evaluate(() => window.scrollY + 280));
    await s.show(2.5);
    await s.click(apply, { settle: 0.3 });
    await box.getByText("측정 결과가 프로젝트 Evidence에 적용되었습니다.").waitFor();
    await s.show(2.5);
  },
};

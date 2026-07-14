import { expect, type Page, test } from "@playwright/test";
import type { MeasurementOutcome } from "../src/features/harness/contract";
import { parseMeasurementRequest } from "../src/features/harness/lib/measurement-query";
import { createQueryHash } from "../src/features/harness/server/measure-service";

async function createMeasuredProject(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByLabel(/프로젝트 이름/).fill("Harness Test");
  await page.getByRole("button", { name: /프로젝트 만들기/ }).click();

  const context = page.locator("section").filter({ has: page.getByText(/제품 프로필/) }).first();
  await context.getByLabel(/제품 이름/).fill("Harness Product");
  await context.getByLabel(/핵심 사용자/).fill("Product teams");
  await context.getByLabel(/핵심 가치 행동/).fill("Complete first report");
  await context.getByLabel(/측정 목표/).fill("Improve activation");
  await context.getByRole("button", { name: /Context 저장/ }).click();
  await page.getByRole("button", { name: /KPI 정의하기/ }).click();

  const metric = page.locator("section").filter({ has: page.getByText(/성공을 한 문장/) }).first();
  await metric.getByLabel(/KPI 이름/).fill("Activation rate");
  await metric.getByLabel(/^정의/).fill("Users who complete the first report");
  await metric.getByLabel(/계산식/).fill("Completed users / Started users × 100");
  await metric.getByRole("button", { name: /KPI 확정/ }).click();
  await page.getByRole("button", { name: /퍼널 연결하기/ }).click();
  await page.getByRole("button", { name: /샘플 사용/ }).click();
  await page.getByRole("button", { name: /이탈 진단하기/ }).click();
}

async function evidenceCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("ux-measure-lab.workspace.v1");
    const stored = raw ? JSON.parse(raw) as { projects?: { name?: string; evidence?: unknown[] }[] } : null;
    return stored?.projects?.find((project) => project.name === "Harness Product")?.evidence?.length ?? -1;
  });
}

test("measurement harness: empty aggregate reports insufficient sample without values", async ({ page }) => {
  await createMeasuredProject(page);
  const harness = page.locator('section[aria-labelledby="harness-title"]');
  await expect(harness).toBeVisible();
  await harness.getByLabel("측정 질문").fill("가입 퍼널에서 가장 큰 이탈은 어디인가요?");
  await harness.getByLabel("질문 유형").selectOption("funnel");
  await harness.getByLabel("측정 소스").selectOption("first-party");
  await harness.getByRole("button", { name: "측정 실행" }).click();

  const failure = harness.locator('[data-code="insufficient_sample"]');
  await expect(failure).toBeVisible();
  await expect(failure.getByText("표본 부족")).toBeVisible();
  await expect(harness.locator("dl")).toHaveCount(0);
  await expect(harness.getByRole("button", { name: "Evidence로 적용" })).toHaveCount(0);
  expect(await evidenceCount(page)).toBe(0);
});

test("HAC-08 and HAC-10: successful measurements stay draft, reuse session cache, then persist explicitly", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/harness/measure", async (route) => {
    requests += 1;
    const parsed = parseMeasurementRequest(route.request().postDataJSON());
    if (!parsed.ok || parsed.value.query.capability !== "funnel") {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ ok: false, code: "invalid_response", message: "invalid fixture" }) });
      return;
    }
    const query = parsed.value.query;
    const queryHash = await createQueryHash(query);
    const outcome: MeasurementOutcome = {
      ok: true,
      measurements: [{
        metricLabel: "퍼널 전환 및 이탈",
        observation: "visit에서 signup 사이의 이탈률은 40%로 관찰되었습니다.",
        sourceKind: "calculated",
        direction: "context",
        values: { enteredUsers: 120, completedUsers: 48, totalConversion: 40, largestDropOffRate: 40 },
        provenance: {
          adapterId: parsed.value.adapterId,
          capability: "funnel",
          source: "UX MeasureLab Events",
          observedAt: "2026-07-15T00:00:00.000Z",
          period: `${query.window.from} ~ ${query.window.to}`,
          window: query.window,
          segment: "전체 사용자",
          queryHash,
        },
        confidence: { level: "medium", sampleSize: 120, basis: "관찰 표본 120개를 기준으로 한 순서형 등급입니다.", limits: "인과관계나 통계적 유의성을 나타내지 않습니다." },
      }],
      degraded: [],
    };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(outcome) });
  });

  await createMeasuredProject(page);
  let harness = page.locator('section[aria-labelledby="harness-title"]');
  const question = "가입 퍼널에서 가장 큰 이탈은 어디인가요?";
  await harness.getByLabel("측정 질문").fill(question);
  await harness.getByLabel("측정 시작").fill("2026-07-01T00:00");
  await harness.getByLabel("측정 종료").fill("2026-07-08T00:00");
  await harness.getByRole("button", { name: "측정 실행" }).click();
  await expect(harness.getByRole("button", { name: "Evidence로 적용" })).toBeVisible();
  expect(await evidenceCount(page)).toBe(0);

  await harness.getByLabel("측정 질문").fill("다른 질문");
  await expect(harness.getByRole("button", { name: "Evidence로 적용" })).toHaveCount(0);
  await harness.getByLabel("측정 질문").fill(question);
  const loop = page.getByRole("navigation", { name: "Measure Loop" });
  await loop.getByRole("button", { name: /Context/ }).click();
  await loop.getByRole("button", { name: /Diagnose/ }).click();
  harness = page.locator('section[aria-labelledby="harness-title"]');
  await expect(harness.getByLabel("측정 질문")).toHaveValue(question);
  await harness.getByLabel("측정 시작").fill("2026-07-01T00:00");
  await harness.getByLabel("측정 종료").fill("2026-07-08T00:00");
  await harness.getByRole("button", { name: "측정 실행" }).click();
  await expect(harness.getByRole("button", { name: "Evidence로 적용" })).toBeVisible();
  expect(requests).toBe(1);
  expect(await evidenceCount(page)).toBe(0);

  await harness.getByRole("button", { name: "Evidence로 적용" }).click();
  await expect(harness.getByText("측정 결과가 프로젝트 Evidence에 적용되었습니다.")).toBeVisible();
  expect(await evidenceCount(page)).toBe(1);
});

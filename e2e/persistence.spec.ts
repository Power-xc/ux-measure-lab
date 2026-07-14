import { expect, test } from "@playwright/test";

test("persistence: project state survives page reload", async ({ page }) => {
  const STORAGE_KEY = "ux-measure-lab.workspace.v1";

  // Step 1: Create project and fill in context
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await page.getByLabel(/프로젝트 이름/).fill("Persistence Test");
  await page.getByRole("button", { name: /프로젝트 만들기/i }).click();
  await page.waitForTimeout(500);

  // Fill context
  const contextPanel = page.locator("section").filter({ has: page.getByText(/제품 프로필/i) }).first();
  await contextPanel.getByLabel(/제품 이름/i).fill("TestApp");
  await contextPanel.getByLabel(/핵심 사용자/i).fill("Designers");
  await contextPanel.getByLabel(/핵심 가치 행동/i).fill("Export design");
  await contextPanel.getByLabel(/측정 목표/i).fill("Measure export completion");
  await contextPanel.getByRole("button", { name: /Context 저장/i }).click();

  // Navigate to Metric
  await page.getByRole("button", { name: /KPI 정의하기/i }).click();

  // Fill metric
  const metricPanel = page.locator("section").filter({ has: page.getByText(/성공을 한 문장/i) }).first();
  await metricPanel.getByLabel(/KPI 이름/i).fill("Export Rate");
  await metricPanel.getByLabel(/정의/i).fill("Successful design exports");
  await metricPanel.getByLabel(/계산식/i).fill("Exports / Sessions");
  await metricPanel.getByRole("button", { name: /KPI 확정/i }).click();

  // Navigate to Funnel
  await page.getByRole("button", { name: /퍼널 연결하기/i }).click();

  // Use sample funnel
  await page.getByRole("button", { name: /샘플 사용/i }).click();
  await expect(page.getByText(/샘플 데이터/i).first()).toBeVisible();

  // Verify localStorage has data
  const storageValue = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
  expect(storageValue).toBeTruthy();
  const stored = JSON.parse(storageValue!);
  expect(stored.projects.length).toBeGreaterThan(0);
  expect(stored.projects[0].context.productName).toBe("TestApp");
  expect(stored.projects[0].metric).toBeTruthy();
  expect(stored.projects[0].funnelImport).toBeTruthy();

  // Step 2: Reload page and verify state is restored
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("main[id='workspace-content']")).toBeVisible();

  // Reload opens on the Context panel by design; navigate to the funnel step
  // and verify the imported sample funnel was restored.
  await page.getByRole("button", { name: /퍼널 데이터/ }).click();
  await expect(page.getByText(/샘플 데이터/i).first()).toBeVisible();

  // Verify localStorage still contains the data
  const storedAfterReload = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
  expect(storedAfterReload).toBeTruthy();
  const storedData = JSON.parse(storedAfterReload!);
  expect(storedData.projects[0].context.productName).toBe("TestApp");
  expect(storedData.projects[0].metric.name).toBe("Export Rate");
  expect(storedData.projects[0].funnelImport.source).toBe("sample");
});

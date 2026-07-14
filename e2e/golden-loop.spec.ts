import { expect, test } from "@playwright/test";

test("golden-loop: complete 8-step measure workflow", async ({ page }) => {
  // Step 0: Navigate to home and wait for hydration
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: /첫 제품 측정 루프/i })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");

  // Step 1: Create a new project through empty state form
  const projectInput = page.getByLabel(/프로젝트 이름/);
  await projectInput.fill("Test Project");
  await page.getByRole("button", { name: /프로젝트 만들기/i }).click();
  await page.waitForTimeout(500);

  // Verify we're on Context panel (step 1)
  await expect(page.getByText(/제품 프로필/i).first()).toBeVisible();

  // Step 1: Context - Fill in product context
  const contextPanel = page.locator("section").filter({ has: page.getByText(/제품 프로필/i) }).first();
  await contextPanel.getByLabel(/제품 이름/i).fill("TestApp");
  await contextPanel.getByLabel(/핵심 사용자/i).fill("Product Managers");
  await contextPanel.getByLabel(/핵심 가치 행동/i).fill("Complete first analysis");
  await contextPanel.getByLabel(/측정 목표/i).fill("Measure first-time user success");
  await contextPanel.getByRole("button", { name: /Context 저장/i }).click();

  // Step 1->2: Navigate to Metric
  await page.getByRole("button", { name: /KPI 정의하기/i }).click();
  await expect(page.getByText(/KPI DEFINITION/i).first()).toBeVisible();

  // Step 2: Metric - Fill in KPI definition
  const metricPanel = page.locator("section").filter({ has: page.getByText(/성공을 한 문장/i) }).first();
  await metricPanel.getByLabel(/KPI 이름/i).fill("First Report Completion");
  await metricPanel.getByLabel(/정의/i).fill("Users who generate their first analysis report successfully");
  await metricPanel.getByLabel(/계산식/i).fill("Completed users / Started users × 100");
  await metricPanel.getByLabel(/측정 기간/i).clear();
  await metricPanel.getByLabel(/측정 기간/i).fill("7 days");
  await metricPanel.getByRole("button", { name: /KPI 확정/i }).click();

  // Step 2->3: Navigate to Funnel
  await page.getByRole("button", { name: /퍼널 연결하기/i }).click();
  await expect(page.getByText(/퍼널 CSV 업로드/i).first()).toBeVisible();

  // Step 3: Funnel - Use sample data
  await page.getByRole("button", { name: /샘플 사용/i }).click();
  await expect(page.getByText(/샘플 데이터/i).first()).toBeVisible();
  await expect(page.getByText(/전체 전환율/i).first()).toBeVisible();

  // Step 3->4: Navigate to Diagnosis
  await page.getByRole("button", { name: /이탈 진단하기/i }).click();
  await expect(page.getByText(/04 · DIAGNOSE/i).first()).toBeVisible();

  // Step 4: Diagnosis - Create the friction candidate first
  await page.getByRole("button", { name: /마찰 후보 만들기/i }).click();
  await page.waitForTimeout(300);

  // Then navigate to hypothesis
  await page.getByRole("button", { name: /가설 편집하기/i }).click();
  await expect(page.getByText(/관찰을 반증 가능한 변화 가설/i).first()).toBeVisible();

  // Step 5: Hypothesis - Fill in hypothesis
  const hypothesisPanel = page.locator("section").filter({ has: page.getByText(/관찰을 반증 가능한 변화 가설/i) }).first();
  await hypothesisPanel.getByLabel(/관찰/i).fill("High drop-off at signup step");
  await hypothesisPanel.getByLabel(/변경안/i).fill("Simplify signup form");
  await hypothesisPanel.getByLabel(/예상 행동 변화/i).fill("More users complete signup");
  await hypothesisPanel.getByLabel(/Guardrail metric/i).fill("Signup error rate");
  await hypothesisPanel.getByLabel(/대안 설명/i).fill("Could be due to browser compatibility");
  await hypothesisPanel.getByLabel(/누락 근거/i).fill("Need session replay data");
  await hypothesisPanel.getByRole("button", { name: /가설 확정/i }).click();
  await page.waitForTimeout(300);

  // Step 5->6: Navigate to Experiment
  await page.getByRole("button", { name: /실험 설계하기/i }).click();
  await expect(page.getByText(/결과를 보기 전에 판정 기준/i).first()).toBeVisible();

  // Step 6: Experiment - Fill in experiment plan
  const experimentPanel = page.locator("section").filter({ has: page.getByText(/결과를 보기 전에 판정 기준/i) }).first();
  await experimentPanel.getByLabel(/성공 기준/i).clear();
  await experimentPanel.getByLabel(/성공 기준/i).fill("5");
  await experimentPanel.getByLabel(/실패 기준/i).clear();
  await experimentPanel.getByLabel(/실패 기준/i).fill("0");
  await experimentPanel.getByLabel(/최소 표본/i).clear();
  await experimentPanel.getByLabel(/최소 표본/i).fill("500");
  await experimentPanel.getByLabel(/계획 기간 \(일\)/i).clear();
  await experimentPanel.getByLabel(/계획 기간 \(일\)/i).fill("14");
  await experimentPanel.getByRole("button", { name: /실험 사전 등록/i }).click();

  // Step 6->7: Navigate to Validation
  await page.getByRole("button", { name: /결과 입력하기/i }).click();
  await expect(page.getByText(/실험 결과와 판정 근거/i).first()).toBeVisible();

  // Step 7: Validation - Fill in experiment results
  const validationPanel = page.locator("section").filter({ has: page.getByText(/실험 결과와 판정 근거/i) }).first();
  // Open the result entry form
  const resultSummary = validationPanel.locator("summary").filter({ hasText: /결과 입력/ });
  const isOpen = await validationPanel.locator("details[open]").isVisible();
  if (!isOpen) {
    await resultSummary.click();
  }

  await validationPanel.getByLabel(/전환 사용자/).first().clear();
  await validationPanel.getByLabel(/전환 사용자/).first().fill("1500");
  await validationPanel.getByLabel(/전체 사용자/).first().clear();
  await validationPanel.getByLabel(/전체 사용자/).first().fill("2500");

  const variantConvertedFields = validationPanel.getByLabel(/전환 사용자/);
  await variantConvertedFields.nth(1).clear();
  await variantConvertedFields.nth(1).fill("1625");

  const variantTotalFields = validationPanel.getByLabel(/전체 사용자/);
  await variantTotalFields.nth(1).clear();
  await variantTotalFields.nth(1).fill("2500");

  await validationPanel.getByLabel(/실제 관찰 기간 \(일\)/i).clear();
  await validationPanel.getByLabel(/실제 관찰 기간 \(일\)/i).fill("14");

  await validationPanel.getByRole("button", { name: /결과 계산/i }).click();
  await page.waitForTimeout(500);

  // Step 7->8: Navigate to Decision
  await page.getByRole("button", { name: /사람의 결정 기록 →/i }).click();
  await expect(page.getByText(/실험 판정과 제품 결정/i).first()).toBeVisible();

  // Step 8: Decision - Record human decision
  const decisionPanel = page.locator("section").filter({ has: page.getByText(/실험 판정과 제품 결정/i) }).first();
  // Select "Adopt" decision
  await decisionPanel.getByRole("radio", { name: /Adopt/ }).check();
  // Fill in rationale
  await decisionPanel.getByLabel(/결정 근거/i).fill("Results show meaningful improvement with no guardrail issues");
  // Fill in next action
  await decisionPanel.getByLabel(/다음 행동/i).fill("Roll out simplified form to 10% of users");
  // Save decision
  await decisionPanel.getByRole("button", { name: /Decision 저장/i }).click();

  // Verify decision was saved
  await expect(page.getByText("Decision recorded").first()).toBeVisible();

  // Export markdown report (this demonstrates the report generation)
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Markdown 리포트/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/experiment-report\.md$/);
});

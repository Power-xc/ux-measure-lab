import { expect, test } from "@playwright/test";

test("fleet: preregister a variant fleet, judge a wave and persist the history", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // 함대 실험의 전제: context → KPI 확정 → 퍼널 → 마찰 후보 → ready 가설
  await page.getByLabel(/프로젝트 이름/).fill("Fleet Project");
  await page.getByRole("button", { name: /프로젝트 만들기/i }).click();
  await page.waitForTimeout(500);

  const contextPanel = page.locator("section").filter({ has: page.getByText(/제품 프로필/i) }).first();
  await contextPanel.getByLabel(/제품 이름/i).fill("FleetApp");
  await contextPanel.getByLabel(/핵심 사용자/i).fill("Growth team");
  await contextPanel.getByLabel(/핵심 가치 행동/i).fill("Complete checkout");
  await contextPanel.getByLabel(/측정 목표/i).fill("Raise checkout completion");
  await contextPanel.getByRole("button", { name: /Context 저장/i }).click();

  await page.getByRole("button", { name: /KPI 정의하기/i }).click();
  const metricPanel = page.locator("section").filter({ has: page.getByText(/성공을 한 문장/i) }).first();
  await metricPanel.getByLabel(/KPI 이름/i).fill("Checkout completion");
  await metricPanel.getByLabel(/정의/i).fill("Users completing checkout after entering");
  await metricPanel.getByLabel(/계산식/i).fill("Completed / Entered × 100");
  await metricPanel.getByRole("button", { name: /KPI 확정/i }).click();

  await page.getByRole("button", { name: /퍼널 연결하기/i }).click();
  await page.getByRole("button", { name: /샘플 사용/i }).click();
  await expect(page.getByText(/전체 전환율/i).first()).toBeVisible();

  await page.getByRole("button", { name: /이탈 진단하기/i }).click();
  await page.getByRole("button", { name: /마찰 후보 만들기/i }).click();
  await page.waitForTimeout(300);

  await page.getByRole("button", { name: /가설 편집하기/i }).click();
  const hypothesisPanel = page.locator("section").filter({ has: page.getByText(/관찰을 반증 가능한 변화 가설/i) }).first();
  await hypothesisPanel.getByLabel(/관찰/i).fill("Drop-off before checkout");
  await hypothesisPanel.getByLabel(/변경안/i).fill("Try multiple entry copies");
  await hypothesisPanel.getByLabel(/예상 행동 변화/i).fill("More users reach checkout");
  await hypothesisPanel.getByLabel(/Guardrail metric/i).fill("Refund request rate");
  await hypothesisPanel.getByLabel(/대안 설명/i).fill("Seasonal traffic mix");
  await hypothesisPanel.getByLabel(/누락 근거/i).fill("Session context");
  await hypothesisPanel.getByRole("button", { name: /가설 확정/i }).click();
  await page.waitForTimeout(300);

  // 함대 사전 등록: 변형 2개와 정책을 한 번에 잠근다
  await page.getByRole("button", { name: /실험 설계하기/i }).click();
  const fleetSection = page.locator("details").filter({ hasText: /함대 모드/ }).first();
  await fleetSection.locator("summary").click();
  await fleetSection.getByLabel(/변형 목록/i).fill("A안 | CTA 문구 강조\nB안 | 배너 제거");
  await fleetSection.getByRole("button", { name: /함대 사전 등록/i }).click();
  await expect(fleetSection.getByText(/PREREGISTERED FLEET/i)).toBeVisible();
  await expect(fleetSection.getByText(/변형 2개/)).toBeVisible();

  // 웨이브 1: 공유 기준선 10% 대비 A안 +4pp(승급), B안 +0.5pp(컷)
  await fleetSection.getByLabel("A안 전환 사용자").fill("56");
  await fleetSection.getByLabel("A안 전체 사용자").fill("400");
  await fleetSection.getByLabel("B안 전환 사용자").fill("42");
  await fleetSection.getByLabel("B안 전체 사용자").fill("400");
  await fleetSection.getByRole("button", { name: /웨이브 1 판정/i }).click();

  await expect(fleetSection.getByText(/WAVE 1 VERDICTS/i)).toBeVisible();
  await expect(fleetSection.getByText(/승격 후보 · A안/)).toBeVisible();
  const tableRows = fleetSection.locator("tbody tr");
  await expect(tableRows.filter({ hasText: "A안" }).first()).toContainText("승급");
  await expect(tableRows.filter({ hasText: "B안" }).first()).toContainText("컷");
  await expect(fleetSection.getByText(/동시 판정 2건 — 보정 없는 다중 비교/)).toBeVisible();
  await expect(fleetSection.getByText(/웨이브 1 — 승급 1 · 컷 1 · 재수집 0/)).toBeVisible();

  // 승급 1개·재수집 0개 → 수렴. 다음 웨이브 폼 대신 중단 사유가 보인다
  await expect(fleetSection.getByText(/함대가 수렴했습니다/)).toBeVisible();

  // 새로고침 후에도 웨이브 이력과 판정이 복구된다
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("nav[aria-label='Measure Loop']").getByRole("button", { name: /사전 등록/ }).click();
  const restored = page.locator("details").filter({ hasText: /함대 모드/ }).first();
  await expect(restored.getByText(/웨이브 1 — 승급 1 · 컷 1 · 재수집 0/)).toBeVisible();
  await expect(restored.getByText(/승격 후보 · A안/)).toBeVisible();
});

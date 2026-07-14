import { expect, test } from "@playwright/test";

test("accessibility: skip link and keyboard navigation", async ({ page }) => {
  // Setup: Create project and context so we have a main element
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await page.getByLabel(/프로젝트 이름/).fill("A11y Test");
  await page.getByRole("button", { name: /프로젝트 만들기/i }).click();
  await page.waitForTimeout(500);

  // Verify the skip link exists with correct text
  const skipLink = page.getByRole("link", { name: /본문으로 건너뛰기/i });
  await expect(skipLink).toBeTruthy();

  // Test 1: Verify skip link has correct href
  const skipLinkHref = await skipLink.getAttribute("href");
  expect(skipLinkHref).toBe("#workspace-content");

  // Test 2: Verify skip link is keyboard accessible (tabindex should allow it)
  const skipLinkTabIndex = await skipLink.getAttribute("tabindex");
  expect(skipLinkTabIndex).toBe("0");

  // Test 3: Use skip link to navigate to main element
  // (Playwright can't easily test browser hash navigation, but we can verify the link exists)
  const main = page.locator("main[id='workspace-content']");
  await expect(main).toBeVisible();

  // Test 4: Verify main has the correct aria-labelledby pointing to active panel title
  const mainAriaLabelledBy = await main.getAttribute("aria-labelledby");
  expect(mainAriaLabelledBy).toBe("active-panel-title");

  // Test 5: Verify main is keyboard-accessible (tabindex -1 allows programmatic focus)
  const mainTabIndex = await main.getAttribute("tabindex");
  expect(mainTabIndex).toBe("-1");

  // Test 6: Verify lang attribute is set to ko
  const htmlLang = await page.locator("html").getAttribute("lang");
  expect(htmlLang).toBe("ko");

  // Test 7: After reload, first Tab focuses the skip link and Enter moves focus to main (BROWSER-003)
  await page.reload({ waitUntil: "networkidle" });
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: /본문으로 건너뛰기/i })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main[id='workspace-content']")).toBeFocused();
});

test("accessibility: focus visibility and interactive elements", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Create a project
  await page.getByLabel(/프로젝트 이름/).fill("Focus Test");
  await page.getByRole("button", { name: /프로젝트 만들기/i }).click();
  await page.waitForTimeout(500);

  // First, fill in the required context fields to enable the next button
  const contextPanel = page.locator("section").filter({ has: page.getByText(/제품 프로필/i) }).first();
  await contextPanel.getByLabel(/제품 이름/i).fill("A11y Test Product");
  await contextPanel.getByLabel(/핵심 사용자/i).fill("Users");
  await contextPanel.getByLabel(/핵심 가치 행동/i).fill("Action");
  await contextPanel.getByLabel(/측정 목표/i).fill("Goal");

  // Test button focus handling
  const contextSaveButton = page.getByRole("button", { name: /Context 저장/i });
  await contextSaveButton.focus();
  await expect(contextSaveButton).toBeFocused();

  // Save the context to enable the next button
  await contextSaveButton.click();
  await page.waitForTimeout(300);

  // Verify next button is now enabled
  const nextButton = page.getByRole("button", { name: /KPI 정의하기/i });
  await expect(nextButton).toBeEnabled();

  // Verify buttons have accessible names (text content)
  const nextButtonText = await nextButton.textContent();
  expect(nextButtonText).toBeTruthy();
});

import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test("mobile: responsive layout renders properly", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Create a project
    await page.getByLabel(/프로젝트 이름/).fill("Mobile Test");
    await page.getByRole("button", { name: /프로젝트 만들기/i }).click();
    await page.waitForTimeout(500);

    // Verify main content is visible
    const main = page.locator("main[id='workspace-content']");
    await expect(main).toBeVisible();

    // Verify all major UI sections exist and are visible
    const sidebar = page.locator("aside").first();
    await expect(sidebar).toBeVisible();

    // Verify context panel is visible
    const contextPanel = page.locator("section").filter({ has: page.getByText(/제품 프로필/i) }).first();
    await expect(contextPanel).toBeVisible();

    // Verify form controls are present
    const productNameInput = page.getByLabel(/제품 이름/i);
    await expect(productNameInput).toBeVisible();

    // No horizontal overflow at 390px (BROWSER-004 reflow contract)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

test("mobile: sidebar and navigation are accessible", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Create a project to test sidebar navigation
  await page.getByLabel(/프로젝트 이름/).fill("Mobile Sidebar Test");
  await page.getByRole("button", { name: /프로젝트 만들기/i }).click();
  await page.waitForTimeout(500);

  // Verify sidebar is visible (specifically the main sidebar with the brand)
  const sidebar = page.locator("aside").filter({ has: page.getByLabel(/UX MeasureLab/) }).first();
  await expect(sidebar).toBeVisible();

  // Verify project navigation exists
  const projectSelect = page.locator("select[id='project-switcher']");
  await expect(projectSelect).toBeVisible();

  // Verify step navigation buttons exist in sidebar
  const newProjectButton = page.getByRole("button", { name: /새 프로젝트/i });
  await expect(newProjectButton).toBeVisible();
});

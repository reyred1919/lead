import { expect, test } from "@playwright/test";
import { capture, login } from "./helpers";

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 90 + 10)}`.slice(-7);

test("document is Persian RTL", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "fa");
});

test("invalid login shows an error", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#username", "specialist1");
  await page.fill("#password", "wrong-password");
  await page.click("button[type=submit]");
  await expect(page.getByRole("alert")).toContainText("نادرست");
});

for (const user of ["specialist1", "dg", "admin"]) {
  test(`universal quick capture by ${user}`, async ({ page }) => {
    await login(page, user);
    const name = `مخاطب آزمون ${user} ${uniq()}`;
    await capture(page, name, `0912${uniq()}`);
    await expect(page.getByRole("heading", { name: "ثبت شد" })).toBeVisible();
    await page.getByRole("button", { name: "مشاهده جزئیات" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.locator("main").getByText(/DEMO-(TECH|ENERGY)-1405/).first()).toBeVisible();
  });
}

test("capture validation errors are shown", async ({ page }) => {
  await login(page, "specialist1");
  await page.goto("/capture");
  await page.click("button[type=submit]");
  await expect(page.getByText("نام مخاطب الزامی است.")).toBeVisible();
  await expect(page.getByText("حداقل یک محصول مورد علاقه را انتخاب کنید.")).toBeVisible();
});

test("offline capture is queued and synced without duplicates", async ({ page, context }) => {
  await login(page, "specialist2");
  await page.goto("/capture");
  await expect(page.locator("#contact_name")).toBeVisible();
  await context.setOffline(true);
  const name = `آفلاین ${uniq()}`;
  await page.fill("#contact_name", name);
  await page.fill("#mobile", `0912${uniq()}`);
  await page.getByRole("group", { name: "محصولات" }).getByRole("button").first().click();
  await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: "در صف همگام‌سازی" })).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.goto("/capture/queue");
  await expect(page.getByText("همگام‌شده").first()).toBeVisible({ timeout: 25_000 });
  await page.goto(`/leads?scope=mine&q=${encodeURIComponent(name)}`);
  await expect(page.locator("main").getByText(name).locator("visible=true")).toHaveCount(1, { timeout: 10_000 });
});

test("specialist cannot reach admin pages or APIs", async ({ page }) => {
  await login(page, "specialist1");
  await page.goto("/admin/users");
  await expect(page.getByText("دسترسی مجاز نیست")).toBeVisible();
  const status = await page.evaluate(async () => (await fetch("/api/v1/notify/providers")).status);
  expect(status).toBe(403);
});

test("referral → accept → qualify → tag", async ({ page, isMobile }) => {
  test.skip(!!isMobile, "desktop flow");
  await login(page, "mdm");
  await capture(page, `ارجاع ${uniq()}`, `0912${uniq()}`);
  await page.getByRole("button", { name: "مشاهده جزئیات" }).click();
  await expect(page.getByRole("button", { name: "ارجاع", exact: true })).toBeVisible();
  const url = page.url();
  await page.getByRole("button", { name: "ارجاع", exact: true }).click();
  await page.getByRole("dialog").getByRole("option").filter({ hasText: "پرهام" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "ارجاع", exact: true }).click();
  await expect(page.getByText("ارجاع ثبت شد")).toBeVisible();
  await page.context().clearCookies();
  await login(page, "planmgr");
  await page.goto(url);
  await page.getByRole("button", { name: "پذیرش ارجاع" }).click();
  await expect(page.getByText("ارجاع پذیرفته شد")).toBeVisible();
  await page.getByRole("button", { name: "ارزیابی و ایجاد فرصت" }).click();
  await page.getByRole("button", { name: "ایجاد فرصت" }).click();
  await expect(page.getByText("فرصت ایجاد شد")).toBeVisible();
  await page.getByRole("button", { name: "افزودن برچسب" }).click();
  await page.getByRole("option").first().click();
  await expect(page.getByRole("button", { name: /^حذف برچسب/ })).toHaveCount(1);
});

test("mobile layout has no horizontal overflow", async ({ page }) => {
  await login(page, "specialist1");
  for (const path of ["/", "/capture", "/leads", "/inbox", "/notifications"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
});

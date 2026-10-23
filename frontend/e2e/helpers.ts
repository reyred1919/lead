import { expect, type Page } from "@playwright/test";

export const PASSWORD = "Demo@Expo1405";

export async function login(page: Page, username: string) {
  await page.goto("/login");
  await page.fill("#username", username);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await expect(page).toHaveURL(/\/$/);
}

export async function capture(page: Page, name: string, mobile: string) {
  await page.goto("/capture");
  await page.fill("#contact_name", name);
  await page.fill("#mobile", mobile);
  await page.getByRole("group", { name: "محصولات" }).getByRole("button").first().click();
  await page.click("button[type=submit]");
}

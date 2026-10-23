import { expect, test } from "@playwright/test";
import { api, apiLogin, expectNoOverflow, loginAs, press, tc, uiLogin } from "./support";

test.describe("Auth & session", () => {
  test("TC-AUTH-01 invalid password shows error, no session", async ({ page }, info) => {
    tc(info, "TC-AUTH-01", { role: "anonymous", route: "/login", action: "login invalid", req: "§2 auth", expected: "error + stays on login" });
    await uiLogin(page, "specialist1", "wrong-password-123");
    await expect(page.getByRole("alert")).toContainText("نادرست");
    await expect(page).toHaveURL(/\/login/);
    expect((await api(page, "GET", "/auth/me")).status).toBeGreaterThanOrEqual(401);
  });

  test("TC-AUTH-02 login then logout clears session and protected routes redirect", async ({ page }, info) => {
    tc(info, "TC-AUTH-02", { role: "specialist1", route: "/", action: "login/logout", expected: "logout returns to /login; /leads redirects" });
    await uiLogin(page, "specialist1");
    await expect(page).toHaveURL(/\/$/);
    if ((page.viewportSize()?.width ?? 1440) >= 1024) {
      await page.getByRole("button", { name: "خروج" }).click();
    } else {
      await press(info, page.getByRole("button", { name: "بیشتر" }));
      await press(info, page.getByRole("dialog").getByRole("button", { name: "خروج" }));
    }
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/leads");
    await expect(page).toHaveURL(/\/login\?next=%2Fleads/);
  });

  test("TC-AUTH-03 login rate-limit message is shown for HTTP 429 (UI mapping; server limit covered in pytest)", async ({ page }, info) => {
    tc(info, "TC-AUTH-03", { role: "anonymous", route: "/login", action: "rate limit UI", expected: "Persian throttle message" });
    await page.route("**/api/v1/auth/login", (r) => r.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ detail: "Request was throttled." }) }));
    await uiLogin(page, "specialist1");
    await expect(page.getByRole("alert")).toContainText("چند دقیقه");
  });

  test("TC-AUTH-04 expired session during use redirects to login", async ({ page, context }, info) => {
    tc(info, "TC-AUTH-04", { role: "planmgr", route: "/leads", action: "session expiry", expected: "redirect to /login with next" });
    await loginAs(page, "planmgr", "/leads");
    await expect(page.locator("main").getByText(/لید در محدوده/)).toBeVisible();
    await context.clearCookies(); // server-side session no longer presented == expired
    await page.goto("/inbox");
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test("TC-AUTH-05 expired session on in-app navigation (SPA, no reload) redirects to login", async ({ page, context }, info) => {
    tc(info, "TC-AUTH-05", { role: "planmgr", route: "/leads→/inbox", action: "session expiry SPA", expected: "redirect to /login, not an error card" });
    await loginAs(page, "planmgr", "/");
    await context.clearCookies();
    const nav = page.getByRole("link", { name: /^لیدها/ }).locator("visible=true").first();
    await nav.click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test("TC-AUTH-06 activation/reset link: set password, link is single-use, new password works", async ({ page, browser }, info) => {
    tc(info, "TC-AUTH-06", { role: "admin→new user", route: "/reset-password", action: "activation", expected: "single-use, new password works" });
    await apiLogin(page, "admin");
    const username = `qa_reset_${Date.now().toString(36)}`;
    const created = await api(page, "POST", "/users", { username, first_name: "آزمون", last_name: "بازنشانی", mobile: "09120009999", title: "QA" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const link = new URL(created.body.activation.demo_link);
    const ctx = await browser.newContext({ locale: "fa-IR" });
    const p = await ctx.newPage();
    const url = `${info.project.use.baseURL}${link.pathname}${link.search}`;
    await p.goto(url);
    await expect(p.getByRole("heading", { name: "فعال‌سازی حساب" })).toBeVisible();
    const newPw = `Qa-${Date.now()}-Pass!`;
    await p.fill("#np", newPw);
    await p.fill("#npc", newPw);
    await p.getByRole("button", { name: "ثبت رمز" }).click();
    await expect(p.getByText("رمز عبور با موفقیت ثبت شد.")).toBeVisible();
    await p.goto(url);
    await expect(p.getByText(/نامعتبر یا منقضی/)).toBeVisible();
    await uiLogin(p, username, newPw);
    await expect(p).toHaveURL(/\/$/);
    await ctx.close();
  });
});

test.describe("Event context", () => {
  test("TC-CTX-01 single active membership: event is locked in capture", async ({ page }, info) => {
    tc(info, "TC-CTX-01", { role: "specialist1", route: "/capture", action: "event context", expected: "locked single event" });
    await loginAs(page, "specialist1", "/capture");
    await expect(page.getByLabel("رویداد قفل‌شده")).toBeVisible();
    await expect(page.locator("main").getByLabel("رویداد", { exact: true })).toHaveCount(0);
    await expectNoOverflow(page, "capture");
  });

  test("TC-CTX-02 two active events: selector switches products and persists across reload", async ({ page }, info) => {
    tc(info, "TC-CTX-02", { role: "qa_dual", route: "/capture", action: "event selector", expected: "products follow selected event; persists in session" });
    await loginAs(page, "qa_dual", "/capture");
    const sel = page.locator("main").getByLabel("رویداد", { exact: true });
    await expect(sel).toBeVisible();
    const energyId = await sel.locator("option", { hasText: "انرژی" }).getAttribute("value");
    await sel.selectOption(energyId!);
    await expect(page.getByRole("group", { name: "محصولات" })).toContainText("کنتور هوشمند");
    await page.reload();
    await expect(page.locator("main").getByLabel("رویداد", { exact: true })).toHaveValue(energyId!);
    await expect(page.getByRole("group", { name: "محصولات" })).not.toContainText("پارکینگ هوشمند");
  });

  test("TC-CTX-03 no membership: capture disabled with explanation", async ({ page }, info) => {
    tc(info, "TC-CTX-03", { role: "qa_nomember", route: "/capture", action: "capture without membership", expected: "disabled + message; API 403" });
    await loginAs(page, "qa_nomember", "/capture");
    await expect(page.getByText("ثبت لید در دسترس نیست")).toBeVisible();
    await expect(page.getByText(/عضو فعال هیچ رویدادی نیستید/)).toBeVisible();
    const r = await api(page, "POST", "/interactions", { event_id: "00000000-0000-0000-0000-000000000000", contact_name: "x", mobile: "09120000000", product_ids: ["x"] });
    expect([400, 403, 404]).toContain(r.status);
  });

  test("TC-CTX-04 only closed/archived events: capture blocked, home explains", async ({ page }, info) => {
    tc(info, "TC-CTX-04", { role: "qa_closed", route: "/", action: "closed event context", expected: "no active event; capture unavailable" });
    await loginAs(page, "qa_closed", "/");
    await expect(page.getByText(/عضو فعال رویدادی نیستید/)).toBeVisible();
    await page.goto("/capture");
    await expect(page.getByText(/فعال نیستند/)).toBeVisible();
  });
});

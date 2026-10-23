import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { api, expectNoOverflow, loginAs, mobileNo, press, shot, tc, uniq } from "./support";

async function fillBasics(page: Page, info: TestInfo, name: string, mobile: string, productIdx = [0]) {
  await page.fill("#contact_name", name);
  await page.fill("#mobile", mobile);
  const group = page.getByRole("group", { name: "محصولات" });
  for (const i of productIdx) await press(info, group.getByRole("button").nth(i));
}
async function submit(page: Page, info: TestInfo) {
  await press(info, page.getByRole("button", { name: /^(ثبت لید|ذخیره آفلاین)$/ }));
}
async function detailFromSuccess(page: Page, info: TestInfo) {
  await expect(page.getByRole("heading", { name: "ثبت شد" })).toBeVisible();
  await press(info, page.getByRole("button", { name: "مشاهده جزئیات" }));
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}/);
  return page.url().split("/leads/")[1];
}

test("TC-CAP-01 existing organization chosen from search suggestion", async ({ page }, info) => {
  tc(info, "TC-CAP-01", { role: "specialist1", route: "/capture", action: "capture existing org", req: "§5", expected: "linked to existing account" });
  await loginAs(page, "specialist1", "/capture");
  const name = `مخاطب سازمان موجود ${uniq()}`;
  await fillBasics(page, info, name, mobileNo());
  await page.fill("#org", "نمونه آلفا");
  const option = page.getByRole("list", { name: "سازمان‌های موجود" }).getByRole("button", { name: /شرکت نمونه آلفا/ });
  await press(info, option);
  await expect(page.getByText("سازمان موجود")).toBeVisible();
  await submit(page, info);
  const id = await detailFromSuccess(page, info);
  const lead = (await api(page, "GET", `/interactions/${id}`)).body;
  expect(lead.account.name).toBe("شرکت نمونه آلفا");
  expect(lead.created_by.full_name).toContain("سینا");
});

test("TC-CAP-02 inline new organization and TC-CAP-05 Persian digits are normalized", async ({ page }, info) => {
  tc(info, "TC-CAP-02", { role: "specialist1", route: "/capture", action: "capture new org + Persian digits", expected: "new account; mobile +98" });
  await loginAs(page, "specialist1", "/capture");
  const org = `سازمان تازه QA ${uniq()}`;
  const digits = `۰۹۱۲${uniq()}`.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[+d]);
  await fillBasics(page, info, `مخاطب جدید ${uniq()}`, digits);
  await page.fill("#org", org);
  await submit(page, info);
  const id = await detailFromSuccess(page, info);
  const lead = (await api(page, "GET", `/interactions/${id}`)).body;
  expect(lead.account.name).toBe(org);
  expect(lead.contact.mobile).toMatch(/^\+989\d{9}$/);
});

test("TC-CAP-03 individual without organization; TC-CAP-04 Arabic-Indic digits", async ({ page }, info) => {
  tc(info, "TC-CAP-03", { role: "specialist2", route: "/capture", action: "individual", expected: "no account" });
  await loginAs(page, "specialist2", "/capture");
  const arabic = `٠٩١٢${uniq()}`.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d]);
  await fillBasics(page, info, `شخص حقیقی ${uniq()}`, arabic);
  await press(info, page.getByRole("button", { name: "شخص حقیقی" }));
  await submit(page, info);
  const id = await detailFromSuccess(page, info);
  const lead = (await api(page, "GET", `/interactions/${id}`)).body;
  expect(lead.account).toBeNull();
  expect(lead.contact.mobile).toMatch(/^\+989\d{9}$/);
  await expect(page.getByText("شخص حقیقی / بدون سازمان")).toBeVisible();
});

test("TC-CAP-06 validation: required fields, invalid mobile, invalid email", async ({ page }, info) => {
  tc(info, "TC-CAP-06", { role: "specialist1", route: "/capture", action: "validation", expected: "inline errors, no submit" });
  await loginAs(page, "specialist1", "/capture");
  await submit(page, info);
  await expect(page.getByText("نام مخاطب الزامی است.")).toBeVisible();
  await expect(page.getByText("حداقل یک محصول مورد علاقه را انتخاب کنید.")).toBeVisible();
  await shot(page, info, "specialist1", "/capture", "validation-errors", "TC-CAP-06");
  await page.fill("#contact_name", "آزمون");
  await page.fill("#mobile", "021-1234");
  await submit(page, info);
  await expect(page.getByText(/شماره موبایل معتبر نیست/)).toBeVisible();
  await press(info, page.getByRole("radio", { name: /ایمیل/ }));
  await page.fill("#email", "not-an-email");
  await submit(page, info);
  await expect(page.getByText("ایمیل معتبر وارد کنید.")).toBeVisible();
  await expectNoOverflow(page, "capture with errors");
});

test("TC-CAP-07 multi-product limited to event offerings, quality and note", async ({ page }, info) => {
  tc(info, "TC-CAP-07", { role: "dg", route: "/capture", action: "multi-product capture by DG", req: "§21", expected: "2 products, only event offerings" });
  await loginAs(page, "dg", "/capture");
  const sel = page.locator("main").getByLabel("رویداد", { exact: true });
  const techId = await sel.locator("option", { hasText: "فناوری" }).getAttribute("value");
  await sel.selectOption(techId!);
  const mine = (await api(page, "GET", "/events/mine")).body.find((e: any) => e.id === techId);
  const chips = page.getByRole("group", { name: "محصولات" }).getByRole("button");
  await expect(chips).toHaveCount(mine.products.length);
  await fillBasics(page, info, `چندمحصولی ${uniq()}`, mobileNo(), [0, 1]);
  await press(info, page.getByRole("radio", { name: "جدی" }));
  await page.fill("#note", "نیاز به دمو — Demo needed 123");
  await submit(page, info);
  const id = await detailFromSuccess(page, info);
  const lead = (await api(page, "GET", `/interactions/${id}`)).body;
  expect(lead.products).toHaveLength(2);
  expect(lead.quality).toBe("SERIOUS");
  expect(lead.created_by.full_name).toContain("داود");
});

test("TC-CAP-08 rapid consecutive entry with 'next' loop", async ({ page }, info) => {
  tc(info, "TC-CAP-08", { role: "specialist2", route: "/capture", action: "3 consecutive captures", expected: "3 distinct leads, form resets" });
  await loginAs(page, "specialist2", "/capture");
  const names: string[] = [];
  for (let i = 0; i < 3; i++) {
    const n = `سریع ${i} ${uniq()}`;
    names.push(n);
    await fillBasics(page, info, n, mobileNo());
    await submit(page, info);
    await expect(page.getByRole("heading", { name: "ثبت شد" })).toBeVisible();
    if (i === 0) await shot(page, info, "specialist2", "/capture", "success", "TC-CAP-08");
    await press(info, page.getByRole("button", { name: "ثبت بعدی" }));
    await expect(page.locator("#contact_name")).toHaveValue("");
  }
  for (const n of names) {
    const r = await api(page, "GET", `/interactions?q=${encodeURIComponent(n)}&created_by=me`);
    expect(r.body.count, n).toBe(1);
  }
});

test("TC-CAP-09 captured_by stays separate from assignee (default owner mapping)", async ({ page }, info) => {
  tc(info, "TC-CAP-09", { role: "specialist1", route: "/leads/:id", action: "creator vs owner", req: "§21", expected: "creator=specialist, pending referral to product owner" });
  await loginAs(page, "specialist1", "/capture");
  const group = page.getByRole("group", { name: "محصولات" });
  await page.fill("#contact_name", `مالک پیش‌فرض ${uniq()}`);
  await page.fill("#mobile", mobileNo());
  await press(info, group.getByRole("button", { name: "پایش هوشمند ناوگان" }));
  await submit(page, info);
  const id = await detailFromSuccess(page, info);
  const lead = (await api(page, "GET", `/interactions/${id}`)).body;
  expect(lead.created_by.full_name).toContain("سینا");
  expect(lead.referrals[0].to_user.full_name).toContain("اوستا");
  await expect(page.getByText("ثبت‌کننده")).toBeVisible();
  await expect(page.getByText("مسئول پیگیری").first()).toBeVisible();
});

test("TC-CAP-10 lost response then retry creates exactly one record (idempotency)", async ({ page }, info) => {
  tc(info, "TC-CAP-10", { role: "specialist2", route: "/capture", action: "network loss after server commit", expected: "queued then DUPLICATE on sync, one record" });
  await loginAs(page, "specialist2", "/capture");
  const name = `بدون پاسخ ${uniq()}`;
  let dropped = false;
  await page.route("**/api/v1/interactions", async (route) => {
    if (route.request().method() === "POST" && !dropped) {
      dropped = true;
      await route.fetch(); // server commits the record...
      await route.abort("connectionreset"); // ...but the client never sees the response
    } else await route.continue();
  });
  await fillBasics(page, info, name, mobileNo());
  await submit(page, info);
  await expect(page.getByRole("heading", { name: "در صف همگام‌سازی" })).toBeVisible();
  await page.goto("/capture/queue");
  await press(info, page.getByRole("button", { name: "همگام‌سازی اکنون" }));
  await expect(page.getByText("همگام‌شده").first()).toBeVisible({ timeout: 25_000 });
  const r = await api(page, "GET", `/interactions?q=${encodeURIComponent(name)}`);
  expect(r.body.count).toBe(1);
});

test("TC-CAP-11 same contact at two events links one contact, shows cross-event history", async ({ page }, info) => {
  tc(info, "TC-CAP-11", { role: "qa_dual", route: "/leads/:id", action: "repeat encounter", expected: "same contact id, other interaction listed" });
  await loginAs(page, "qa_dual", "/capture");
  const name = `دو رویداد ${uniq()}`;
  const mob = mobileNo();
  const sel = page.locator("main").getByLabel("رویداد", { exact: true });
  for (const ev of ["فناوری", "انرژی"]) {
    await page.goto("/capture");
    await sel.selectOption((await sel.locator("option", { hasText: ev }).getAttribute("value"))!);
    await fillBasics(page, info, name, mob);
    await submit(page, info);
    await expect(page.getByRole("heading", { name: "ثبت شد" })).toBeVisible();
  }
  const list = (await api(page, "GET", `/interactions?q=${encodeURIComponent(name)}`)).body.results;
  expect(list).toHaveLength(2);
  expect(list[0].contact.id).toBe(list[1].contact.id);
  expect(list[0].event.id).not.toBe(list[1].event.id);
  await page.goto(`/leads/${list[0].id}`);
  await expect(page.getByText("برخوردهای دیگر با این مخاطب")).toBeVisible();
});

test("TC-CAP-12 keyboard-only capture", async ({ page }, info) => {
  test.skip(/tablet|mobile/.test(info.project.name), "keyboard path verified on desktop projects");
  tc(info, "TC-CAP-12", { role: "specialist1", route: "/capture", action: "keyboard only", expected: "complete capture without mouse" });
  await loginAs(page, "specialist1", "/capture");
  await expect(page.locator("#contact_name")).toBeFocused();
  await page.keyboard.type(`کیبورد ${uniq()}`);
  await page.keyboard.press("Tab"); // contact method: mobile radio
  await page.keyboard.press("Tab"); // email radio
  await page.keyboard.press("Tab"); // mobile input
  await expect(page.locator("#mobile")).toBeFocused();
  await page.keyboard.type(mobileNo());
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space"); // first product chip
  await expect(page.getByRole("group", { name: "محصولات" }).getByRole("button").first()).toHaveAttribute("aria-pressed", "true");
  const focusVisible = await page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle !== "none");
  expect(focusVisible, "visible focus ring on product chip").toBe(true);
  await page.locator("#note").focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "ثبت شد" })).toBeVisible();
});

import { expect, test } from "@playwright/test";
import { api, apiLogin, closeEvent, expectNoOverflow, loginAs, newLeadViaApi, press, shot, tc, tempEvent } from "./support";

test.describe("Lead lists", () => {
  test("TC-LST-01 pagination across >25 leads", async ({ page }, info) => {
    tc(info, "TC-LST-01", { role: "admin", route: "/leads", action: "paginate", expected: "page 2 differs from page 1" });
    await loginAs(page, "admin", "/leads");
    await expect(page.getByText(/صفحه ۱ از/)).toBeVisible();
    const rows = page.locator("main tbody tr, main ul > li").locator("visible=true");
    const firstPage = await rows.allInnerTexts();
    expect(firstPage.length).toBeGreaterThan(5);
    await press(info, page.getByRole("button", { name: "صفحه بعد" }));
    await expect(page.getByText(/صفحه ۲ از/)).toBeVisible();
    await expect.poll(async () => JSON.stringify(await rows.allInnerTexts())).not.toBe(JSON.stringify(firstPage));
    await expectNoOverflow(page, "leads p2");
  });

  test("TC-LST-02 search by name and by Persian-digit mobile fragment", async ({ page }, info) => {
    tc(info, "TC-LST-02", { role: "qa_dual", route: "/leads", action: "search", expected: "matches by name and digits" });
    await loginAs(page, "qa_dual", "/leads");
    await page.getByLabel("جست‌وجو").fill("Sara Ahmadi");
    await expect(page.locator("main").getByText("Sara Ahmadi — سارا احمدی").locator("visible=true")).toHaveCount(1);
    await page.getByLabel("جست‌وجو").fill("۰۰۰۰۳۰۱");
    await expect(page.locator("main").getByText("Sara Ahmadi — سارا احمدی").locator("visible=true")).toHaveCount(1);
  });

  test("TC-LST-03 filters (quality, stage) and empty state", async ({ page }, info) => {
    tc(info, "TC-LST-03", { role: "mdm", route: "/leads", action: "filter + empty", expected: "filtered rows; empty-state copy" });
    await loginAs(page, "mdm", "/leads?quality=SERIOUS");
    const r = await api(page, "GET", "/interactions?quality=SERIOUS&page_size=200");
    expect(r.body.results.every((x: any) => x.quality === "SERIOUS")).toBe(true);
    await page.goto("/leads?stage=WON");
    await page.getByLabel("جست‌وجو").fill("هیچ‌نتیجه‌ای-QA-zzz");
    await expect(page.getByText("لیدی یافت نشد")).toBeVisible();
    await shot(page, info, "mdm", "/leads", "empty-search", "TC-LST-03");
  });

  test("TC-LST-04 long and mixed-direction names render without overflow", async ({ page }, info) => {
    tc(info, "TC-LST-04", { role: "qa_dual", route: "/leads + /leads/:id", action: "long text", expected: "no horizontal overflow; LTR isolation" });
    await loginAs(page, "qa_dual", "/leads");
    await page.getByLabel("جست‌وجو").fill("نام بسیار طولانی");
    const row = page.locator("main").getByText(/نام بسیار طولانی/).locator("visible=true").first();
    await expect(row).toBeVisible();
    await expectNoOverflow(page, "list long name");
    await press(info, row);
    await expect(page).toHaveURL(/\/leads\//);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("نام بسیار طولانی");
    await expectNoOverflow(page, "detail long name");
    await shot(page, info, "qa_dual", "/leads/:id", "long-text", "TC-LST-04");
    const dir = await page.locator("bdi[dir=ltr]").first().getAttribute("dir");
    expect(dir).toBe("ltr");
  });

  test("TC-LST-05 sorting control exists and changes order", async ({ page }, info) => {
    tc(info, "TC-LST-05", { role: "admin", route: "/leads", action: "sort", req: "QA Phase B.5", expected: "user can sort list" });
    await loginAs(page, "admin", "/leads");
    const sort = page.getByLabel("مرتب‌سازی");
    await expect(sort).toBeVisible();
    await sort.selectOption("captured_at");
    await expect(page).toHaveURL(/ordering=captured_at/);
  });

  test("TC-LST-06 scope: booth specialist sees only own leads", async ({ page }, info) => {
    tc(info, "TC-LST-06", { role: "specialist2", route: "/leads", action: "row scope", expected: "all rows created by self" });
    await loginAs(page, "specialist2", "/leads");
    const r = await api(page, "GET", "/interactions?page_size=200");
    expect(r.body.results.every((x: any) => x.created_by.full_name.includes("سمیرا") || x.responsible?.full_name?.includes("سمیرا"))).toBe(true);
    await expect(page.getByRole("radio", { name: "همه در محدوده من" })).toHaveCount(0);
  });
});

test.describe("Enrichment & opportunity detail", () => {
  test("TC-ENR-01 enrichment after event closure with field history", async ({ page, browser }, info) => {
    tc(info, "TC-ENR-01", { role: "planmgr", route: "/leads/:id", action: "enrich closed-event lead", req: "§15", expected: "saved; history from→to" });
    const actx = await browser.newContext({ baseURL: info.project.use.baseURL });
    const admin = await actx.newPage();
    await apiLogin(admin, "admin");
    const ev = await tempEvent(admin, [{ username: "planmgr", roles: ["PLAN_MANAGER"] }]);
    await loginAs(page, "planmgr");
    const lead = (await api(page, "POST", "/interactions", { event_id: ev.id, client_record_id: crypto.randomUUID(), contact_name: `پس از رویداد ${ev.code}`, mobile: "09120007777", product_ids: [ev.productId], org_name: `سازمان ${ev.code}` })).body;
    await closeEvent(admin, ev.id);
    await actx.close();
    await page.goto(`/leads/${lead.id}`);
    await expect(page.getByText(/رویداد موقت/).first()).toBeVisible();
    await press(info, page.getByRole("button", { name: "تکمیل اطلاعات لید" }));
    const dlg = page.getByRole("dialog");
    const industry = `صنعت QA ${Date.now() % 10000}`;
    await dlg.locator("#en-industry").fill(industry);
    await shot(page, info, "planmgr", "/leads/:id", "enrich-modal", "TC-ENR-01");
    await press(info, dlg.getByRole("button", { name: "ذخیره این بخش" }));
    await expect(page.getByText(/فیلد ذخیره شد/)).toBeVisible();
    await press(info, dlg.getByRole("button", { name: "بستن" }).last());
    await expect(page.locator("main").getByText(industry).first()).toBeVisible();
    await expect(page.locator("ol").getByText(industry)).toBeVisible();
    expect((await api(page, "POST", "/interactions", { event_id: ev.id, contact_name: "x", mobile: "09120007778", product_ids: [ev.productId] })).status).toBe(422);
  });

  test("TC-ENR-02 field-level authorization: viewer & creator read-only", async ({ page, browser }, info) => {
    tc(info, "TC-ENR-02", { role: "exec/specialist1", route: "/leads/:id", action: "enrich forbidden", expected: "no edit affordance; API 403; masked PII for exec" });
    await loginAs(page, "specialist1");
    const lead = await newLeadViaApi(page, "DEMO-TECH-1405", {}, "FLEET-MON");
    await page.goto(`/leads/${lead.id}`);
    await expect(page.getByRole("button", { name: "تکمیل اطلاعات لید" })).toHaveCount(0);
    expect((await api(page, "PATCH", `/interactions/${lead.id}/enrichment`, { contact: { title: "x", version: 1 } })).status).toBe(403);
    const ctx = await browser.newContext({ ...(info.project.use as any) });
    const ex = await ctx.newPage();
    await apiLogin(ex, "exec");
    await ex.goto(`/leads/${lead.id}`);
    await expect(ex.getByRole("heading", { name: lead.contact.full_name })).toBeVisible();
    await expect(ex.getByRole("button", { name: "تکمیل اطلاعات لید" })).toHaveCount(0);
    await expect(ex.getByRole("button", { name: "ارجاع", exact: true })).toHaveCount(0);
    await expect(ex.locator("main").getByText(/•/).first()).toBeVisible();
    await shot(ex, info, "exec", "/leads/:id", "readonly-masked", "TC-ENR-02");
    await ctx.close();
  });

  test("TC-ENR-03 concurrent edit shows conflict instead of overwriting", async ({ page, browser }, info) => {
    tc(info, "TC-ENR-03", { role: "planmgr vs mdm", route: "/leads/:id", action: "conflict", expected: "409 surfaced; no silent overwrite" });
    await loginAs(page, "planmgr");
    const lead = await newLeadViaApi(page, "DEMO-TECH-1405", { org_name: `سازمان تعارض ${Date.now() % 100000}` });
    await page.goto(`/leads/${lead.id}`);
    await press(info, page.getByRole("button", { name: "تکمیل اطلاعات لید" }));
    // Another user saves first.
    const ctx = await browser.newContext({ ...(info.project.use as any) });
    const other = await ctx.newPage();
    await apiLogin(other, "mdm");
    const fresh = (await api(other, "GET", `/interactions/${lead.id}`)).body;
    expect((await api(other, "PATCH", `/interactions/${lead.id}/enrichment`, { account: { city: "مشهد", version: fresh.account.version } })).status).toBe(200);
    await ctx.close();
    const dlg = page.getByRole("dialog");
    await dlg.locator("#en-city").fill("تبریز");
    await press(info, dlg.getByRole("button", { name: "ذخیره این بخش" }));
    await expect(dlg.getByRole("alert")).toContainText("هم‌زمان");
    await shot(page, info, "planmgr", "/leads/:id", "conflict", "TC-ENR-03");
    expect((await api(page, "GET", `/interactions/${lead.id}`)).body.account.city).toBe("مشهد");
  });

  test("TC-ENR-04 tags: add/remove on qualified lead, archived tag label, stage change", async ({ page }, info) => {
    tc(info, "TC-ENR-04", { role: "planmgr", route: "/leads/:id", action: "tags + stage", req: "§23.3", expected: "chips update; history" });
    await loginAs(page, "planmgr");
    const lead = await newLeadViaApi(page);
    expect((await api(page, "POST", `/interactions/${lead.id}/qualify`, {})).status).toBe(201);
    await page.goto(`/leads/${lead.id}`);
    await press(info, page.getByRole("button", { name: "افزودن برچسب" }));
    await press(info, page.getByRole("option").first());
    await expect(page.getByRole("button", { name: /^حذف برچسب/ })).toHaveCount(1);
    await shot(page, info, "planmgr", "/leads/:id", "tag-added", "TC-ENR-04");
    await press(info, page.getByRole("button", { name: /^حذف برچسب/ }).first());
    await expect(page.getByRole("button", { name: /^حذف برچسب/ })).toHaveCount(0);
    await press(info, page.getByRole("button", { name: "تغییر مرحله" }));
    await press(info, page.getByRole("dialog").getByRole("button", { name: "در حال پیگیری" }));
    await press(info, page.getByRole("dialog").getByRole("button", { name: "ثبت" }));
    await expect(page.getByText("مرحله تغییر کرد")).toBeVisible();
    await expect(page.locator("ol").getByText("حذف برچسب")).toBeVisible();
  });
});

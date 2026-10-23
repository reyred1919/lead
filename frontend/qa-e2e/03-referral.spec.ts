import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { api, apiLogin, expectNoOverflow, loginAs, newLeadViaApi, pickUser, press, shot, tc } from "./support";

/** Referral lifecycle executed on EVERY viewport project (desktop, tablet, mobile) — no device skips. */

async function asUser(browser: Browser, info: TestInfo, username: string) {
  const ctx = await browser.newContext({ ...(info.project.use as any) });
  const page = await ctx.newPage();
  await apiLogin(page, username);
  return { ctx, page };
}

async function openReferDialog(page: Page, info: TestInfo) {
  await press(info, page.getByRole("button", { name: "ارجاع", exact: true }));
  const dlg = page.getByRole("dialog");
  await expect(dlg).toBeVisible();
  return dlg;
}

test("TC-REF-01..05 create → accept → qualify → task → complete (UI on this device)", async ({ page, browser }, info) => {
  tc(info, "TC-REF-01", { role: "mdm→planmgr", route: "/leads/:id", action: "referral lifecycle", req: "§7", expected: "full lifecycle on device" });
  await loginAs(page, "mdm");
  const lead = await newLeadViaApi(page, "DEMO-TECH-1405", { contact_name: `ارجاع دستگاه ${info.project.name} ${Date.now() % 100000}` });
  await page.goto(`/leads/${lead.id}`);
  await expectNoOverflow(page, "lead detail (mdm)");
  const dlg = await openReferDialog(page, info);
  await press(info, dlg.getByRole("radio", { name: "ارزیابی" }));
  await pickUser(dlg, page, info, "پرهام");
  await dlg.locator("#ref-reason").fill("لطفاً ارزیابی شود — QA");
  await shot(page, info, "mdm", "/leads/:id", "refer-modal", "TC-REF-01");
  await press(info, dlg.getByRole("button", { name: "ارجاع", exact: true }));
  await expect(page.getByText("ارجاع ثبت شد")).toBeVisible();
  await expect(page.getByText(/در انتظار پذیرش/).first()).toBeVisible();

  // Recipient: inbox → accept (TC-REF-02)
  const pm = await asUser(browser, info, "planmgr");
  await pm.page.goto("/inbox");
  const row = pm.page.locator("li", { hasText: lead.contact.full_name });
  await expect(row).toBeVisible();
  await expectNoOverflow(pm.page, "inbox");
  await shot(pm.page, info, "planmgr", "/inbox", "incoming-referral", "TC-REF-02");
  await press(info, row.getByRole("button", { name: "پذیرش" }));
  await expect(pm.page.getByText("ارجاع پذیرفته شد")).toBeVisible();
  // in-app notification for the referral (TC-REF-07)
  const notes = (await api(pm.page, "GET", "/notifications?filter=all&page_size=50")).body.results;
  expect(notes.some((n: any) => n.title.includes(lead.contact.full_name))).toBe(true);

  // Qualify + task with Jalali due date (TC-REF-05)
  await pm.page.goto(`/leads/${lead.id}`);
  await press(info, pm.page.getByRole("button", { name: "ارزیابی و ایجاد فرصت" }));
  await press(info, pm.page.getByRole("dialog").getByRole("button", { name: "ایجاد فرصت" }));
  await expect(pm.page.getByText("فرصت ایجاد شد")).toBeVisible();
  await press(info, pm.page.getByRole("button", { name: "وظیفه", exact: true }));
  const tdlg = pm.page.getByRole("dialog");
  await tdlg.locator("#task-title").fill("تماس پیگیری QA");
  await press(info, tdlg.getByRole("button", { name: /انتخاب تاریخ/ }));
  await press(info, pm.page.getByRole("button", { name: "ماه بعد" }));
  await press(info, pm.page.getByRole("grid").getByRole("button").nth(9));
  await press(info, pm.page.getByRole("button", { name: "تأیید" }));
  await press(info, tdlg.getByRole("button", { name: "ثبت وظیفه" }));
  await expect(pm.page.getByText("وظیفه تعریف شد")).toBeVisible();
  const detail = (await api(pm.page, "GET", `/interactions/${lead.id}`)).body;
  const task = detail.tasks[0];
  expect(new Date(task.due_at).getTime()).toBeGreaterThan(Date.now());
  await pm.page.reload();
  await press(info, pm.page.getByRole("button", { name: "انجام شد" }).first());
  await pm.page.getByRole("dialog").getByLabel("نتیجه").fill("تماس گرفته شد");
  await press(info, pm.page.getByRole("dialog").getByRole("button", { name: "ثبت انجام" }));
  await expect(pm.page.getByText("وظیفه انجام شد")).toBeVisible();
  const after = (await api(pm.page, "GET", `/interactions/${lead.id}`)).body;
  expect(after.tasks[0].status).toBe("DONE");
  expect(after.created_by.full_name).toContain("مریم");
  expect(after.opportunity.owner.full_name).toContain("پرهام");
  await shot(pm.page, info, "planmgr", "/leads/:id", "after-workflow", "TC-REF-05");
  await pm.ctx.close();
});

test("TC-REF-03/04 return with mandatory reason, returned box, reassign keeps history", async ({ page, browser }, info) => {
  tc(info, "TC-REF-03", { role: "mdm→owner→planmgr", route: "/inbox", action: "return + reassign", expected: "reason required; history kept" });
  await loginAs(page, "mdm");
  const lead = await newLeadViaApi(page, "DEMO-TECH-1405", { contact_name: `بازگشت ${info.project.name} ${Date.now() % 100000}` });
  const owner = (await api(page, "GET", "/users?q=owner")).body.results.find((u: any) => u.username === "owner");
  const r = await api(page, "POST", `/interactions/${lead.id}/refer`, { to_user_id: owner.id, reason: "ارجاع بین‌محصولی" });
  expect(r.status).toBe(201);

  const ow = await asUser(browser, info, "owner");
  await ow.page.goto("/inbox");
  const row = ow.page.locator("li", { hasText: lead.contact.full_name });
  await press(info, row.getByRole("button", { name: "بازگرداندن" }));
  const dlg = ow.page.getByRole("dialog");
  await expect(dlg.getByRole("button", { name: "بازگرداندن" })).toBeDisabled();
  await dlg.getByLabel("دلیل").fill("خارج از حوزه محصول — QA");
  await press(info, dlg.getByRole("button", { name: "بازگرداندن" }));
  await expect(ow.page.getByText("ارجاع بازگردانده شد")).toBeVisible();
  await ow.ctx.close();

  await page.goto("/inbox?tab=returned");
  const ret = page.locator("li", { hasText: lead.contact.full_name });
  await expect(ret).toContainText("خارج از حوزه محصول");
  await press(info, ret.getByRole("button", { name: "ارجاع مجدد" }));
  const d2 = await openReferDialog(page, info);
  await pickUser(d2, page, info, "پرهام");
  await press(info, d2.getByRole("button", { name: "ارجاع", exact: true }));
  await expect(page.getByText("ارجاع ثبت شد")).toBeVisible();
  const detail = (await api(page, "GET", `/interactions/${lead.id}`)).body;
  expect(detail.referrals.map((x: any) => x.status).sort()).toEqual(["PENDING", "RETURNED"]);
  await page.reload();
  await expect(page.getByText(/بازگشت ارجاع/).first()).toBeVisible();
});

test("TC-REF-06 negative: specialist has no referral affordance and API refuses", async ({ page }, info) => {
  tc(info, "TC-REF-06", { role: "specialist1", route: "/leads/:id", action: "refer (forbidden)", expected: "no button; API 403" });
  await loginAs(page, "specialist1");
  const lead = await newLeadViaApi(page);
  await page.goto(`/leads/${lead.id}`);
  await expect(page.getByRole("heading", { name: lead.contact.full_name })).toBeVisible();
  await expect(page.getByRole("button", { name: "ارجاع", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "تکمیل اطلاعات لید" })).toHaveCount(0);
  const users = await api(page, "GET", "/users?q=planmgr");
  expect(users.status).toBe(403);
  const r = await api(page, "POST", `/interactions/${lead.id}/refer`, { to_user_id: lead.created_by.id });
  expect(r.status).toBe(403);
});

test("TC-REF-08 overdue task is flagged in inbox", async ({ page }, info) => {
  tc(info, "TC-REF-08", { role: "planmgr", route: "/inbox?tab=tasks", action: "overdue", expected: "معوق badge" });
  await loginAs(page, "planmgr");
  const lead = await newLeadViaApi(page);
  const t = await api(page, "POST", `/interactions/${lead.id}/tasks`, { title: `معوق QA ${Date.now() % 100000}`, due_at: new Date(Date.now() - 3600_000).toISOString() });
  expect(t.status).toBe(201);
  await page.goto("/inbox?tab=tasks");
  await expect(page.locator("li", { hasText: t.body.title })).toContainText("معوق");
});

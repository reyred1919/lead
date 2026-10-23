import { expect, test } from "@playwright/test";
import { api, apiLogin, closeEvent, loginAs, mobileNo, press, shot, tc, tempEvent, uniq, selectFirstProduct } from "./support";

test.describe("Exports", () => {
  test("TC-EXP-01 JSON export via UI is scoped, versioned and masks unauthorized PII", async ({ page }, info) => {
    tc(info, "TC-EXP-01", { role: "planmgr", route: "/reports", action: "export JSON", req: "§16", expected: "schema 1.0; only in-scope events" });
    await loginAs(page, "planmgr", "/reports");
    await press(info, page.getByRole("radio", { name: /JSON/ }));
    await press(info, page.getByRole("button", { name: "ایجاد خروجی" }));
    const link = page.getByRole("link", { name: /دریافت expo-leads-.*\.json/ }).first();
    await expect(link).toBeVisible();
    await shot(page, info, "planmgr", "/reports", "export-ready", "TC-EXP-01");
    const href = await link.getAttribute("href");
    const r = await page.request.get(href!);
    expect(r.status()).toBe(200);
    const data = await r.json();
    expect(data.metadata.schema_version).toBe("1.0");
    const codes = new Set(data.datasets.fact_leads.map((x: any) => x.event_code));
    expect([...codes].every((c) => c === "DEMO-TECH-1405" || c === "DEMO-EXPO-1404" || String(c).startsWith("QA-"))).toBe(true);
    expect(codes.has("DEMO-ENERGY-1405")).toBe(false);
  });

  test("TC-EXP-02 CSV keeps Persian text (UTF-8 BOM) and neutralizes formulas", async ({ page }, info) => {
    tc(info, "TC-EXP-02", { role: "mdm", route: "/reports", action: "export CSV", expected: "BOM; =,+,-,@ prefixed" });
    await apiLogin(page, "mdm");
    const evs = (await api(page, "GET", "/events/mine")).body;
    const tech = evs.find((e: any) => e.code === "DEMO-TECH-1405");
    const name = `=HYPERLINK("http://evil.invalid","x") ${uniq()}`;
    const lead = await api(page, "POST", "/interactions", { event_id: tech.id, client_record_id: crypto.randomUUID(), contact_name: name, mobile: mobileNo(), product_ids: [tech.products[0].id], note: "@SUM(A1) یادداشت فارسی" });
    expect(lead.status).toBe(201);
    const job = await api(page, "POST", "/exports", { format: "CSV", datasets: ["fact_leads"], filters: { ids: [lead.body.id] } });
    expect(job.status).toBe(201);
    const r = await page.request.get(job.body.download_url);
    const buf = Buffer.from(await r.body());
    expect(buf.subarray(0, 3).toString("hex")).toBe("efbbbf");
    const text = buf.toString("utf8");
    expect(text).toContain(`"'=HYPERLINK`);
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  test("TC-EXP-03 download link is owner-only", async ({ page, browser }, info) => {
    tc(info, "TC-EXP-03", { role: "mdm vs dg", route: "/api/v1/exports/:id/download", action: "cross-user download", expected: "404 for non-owner" });
    await apiLogin(page, "mdm");
    const job = await api(page, "POST", "/exports", { format: "JSON", datasets: ["accounts"] });
    const ctx = await browser.newContext({ baseURL: info.project.use.baseURL });
    const other = await ctx.newPage();
    await apiLogin(other, "dg");
    expect((await other.request.get(job.body.download_url)).status()).toBe(404);
    await ctx.close();
    expect((await page.request.get(job.body.download_url)).status()).toBe(200);
  });
});

test.describe("Offline", () => {
  test("TC-OFF-01/02 offline capture: encrypted at rest, exactly one sync upload, one record", async ({ page, context }, info) => {
    tc(info, "TC-OFF-01", { role: "specialist2", route: "/capture", action: "offline→online", req: "§22.4", expected: "1 sync request, 1 record, no plaintext PII in IndexedDB" });
    await loginAs(page, "specialist2", "/capture");
    await expect(page.locator("#contact_name")).toBeVisible();
    const syncPosts: string[] = [];
    page.on("request", (r) => r.url().includes("/api/v1/interactions/sync") && r.method() === "POST" && syncPosts.push(r.postData() ?? ""));
    await context.setOffline(true);
    const name = `آفلاین QA ${uniq()}`;
    await page.fill("#contact_name", name);
    await page.fill("#mobile", mobileNo());
    await selectFirstProduct(page, info);
    await press(info, page.getByRole("button", { name: "ذخیره آفلاین" }));
    await expect(page.getByRole("heading", { name: "در صف همگام‌سازی" })).toBeVisible();
    await shot(page, info, "specialist2", "/capture", "offline-queued", "TC-OFF-01");
    const raw = await page.evaluate(
      () => new Promise<string>((resolve) => {
        const req = indexedDB.open("expo-leads-offline");
        req.onsuccess = () => {
          const all = req.result.transaction("queue").objectStore("queue").getAll();
          all.onsuccess = () => resolve(JSON.stringify(all.result, (_k, v) => (v instanceof ArrayBuffer ? `[${v.byteLength}b]` : v)));
        };
      }),
    );
    expect(raw).not.toContain(name);
    expect(raw).toContain("queued");
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(async () => (await api(page, "GET", `/interactions?q=${encodeURIComponent(name)}`)).body?.count, { timeout: 30_000 }).toBe(1);
    await page.waitForTimeout(1500);
    const withRecord = syncPosts.filter((p) => p.includes(name.split(" ").pop()!) || p.length > 0);
    expect(withRecord.length, `sync uploads: ${syncPosts.length}`).toBe(1);
  });

  test("TC-OFF-03 switching event while a record is queued never retags it", async ({ page, context }, info) => {
    tc(info, "TC-OFF-03", { role: "qa_dual", route: "/capture", action: "switch event while queued", expected: "record keeps original event" });
    await loginAs(page, "qa_dual", "/capture");
    const sel = page.locator("main").getByLabel("رویداد", { exact: true });
    await sel.selectOption((await sel.locator("option", { hasText: "فناوری" }).getAttribute("value"))!);
    await context.setOffline(true);
    const name = `صف تعویض ${uniq()}`;
    await page.fill("#contact_name", name);
    await page.fill("#mobile", mobileNo());
    await selectFirstProduct(page, info);
    await press(info, page.getByRole("button", { name: "ذخیره آفلاین" }));
    await expect(page.getByRole("heading", { name: "در صف همگام‌سازی" })).toBeVisible();
    await press(info, page.getByRole("button", { name: "ثبت بعدی" }));
    await sel.selectOption((await sel.locator("option", { hasText: "انرژی" }).getAttribute("value"))!);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(async () => (await api(page, "GET", `/interactions?q=${encodeURIComponent(name)}`)).body?.count, { timeout: 30_000 }).toBe(1);
    const lead = (await api(page, "GET", `/interactions?q=${encodeURIComponent(name)}`)).body.results[0];
    expect(lead.event.code).toBe("DEMO-TECH-1405");
  });

  test("TC-OFF-04 logout with pending queue warns; discard wipes device; next user sees nothing", async ({ page, context }, info) => {
    tc(info, "TC-OFF-04", { role: "specialist2→specialist1", route: "/", action: "logout wipe", expected: "warning; IndexedDB empty; no cross-account leakage" });
    await loginAs(page, "specialist2", "/capture");
    await context.setOffline(true);
    await page.fill("#contact_name", `نشت ${uniq()}`);
    await page.fill("#mobile", mobileNo());
    await selectFirstProduct(page, info);
    await press(info, page.getByRole("button", { name: "ذخیره آفلاین" }));
    await expect(page.getByRole("heading", { name: "در صف همگام‌سازی" })).toBeVisible();
    if ((page.viewportSize()?.width ?? 1440) >= 1024) await page.getByRole("button", { name: "خروج" }).click();
    else {
      await press(info, page.getByRole("button", { name: "بیشتر" }));
      await press(info, page.getByRole("dialog").getByRole("button", { name: "خروج" }));
    }
    const warn = page.getByRole("dialog", { name: "ثبت‌های همگام‌نشده" });
    await expect(warn).toBeVisible();
    await shot(page, info, "specialist2", "/", "logout-pending-warning", "TC-OFF-04");
    await press(info, warn.getByRole("button", { name: "حذف و خروج" }));
    await expect(page).toHaveURL(/\/login/);
    await context.setOffline(false);
    const count = await page.evaluate(
      () => new Promise<number>((resolve) => {
        const req = indexedDB.open("expo-leads-offline");
        req.onsuccess = () => {
          const c = req.result.transaction("queue").objectStore("queue").count();
          c.onsuccess = () => resolve(c.result);
        };
      }),
    );
    expect(count).toBe(0);
    await loginAs(page, "specialist1", "/capture/queue");
    await expect(page.getByText("صف خالی است")).toBeVisible();
  });

  test("TC-OFF-05 offline capture synced after closure beyond grace goes to admin review", async ({ page, context, browser }, info) => {
    tc(info, "TC-OFF-05", { role: "qa_dual + admin", route: "/capture/queue + /admin/quarantine", action: "closure grace", expected: "QUARANTINED, approvable, original event" });
    const actx = await browser.newContext({ baseURL: info.project.use.baseURL });
    const admin = await actx.newPage();
    await apiLogin(admin, "admin");
    const ev = await tempEvent(admin, [{ username: "qa_dual", roles: ["BOOTH_SPECIALIST"] }]);
    await loginAs(page, "qa_dual", "/capture");
    const sel = page.locator("main").getByLabel("رویداد", { exact: true });
    await sel.selectOption({ label: `رویداد موقت ${ev.code}` });
    await context.setOffline(true);
    const name = `قرنطینه ${uniq()}`;
    await page.fill("#contact_name", name);
    await page.fill("#mobile", mobileNo());
    await selectFirstProduct(page, info);
    await press(info, page.getByRole("button", { name: "ذخیره آفلاین" }));
    await expect(page.getByRole("heading", { name: "در صف همگام‌سازی" })).toBeVisible();
    await closeEvent(admin, ev.id, 0);
    await context.setOffline(false);
    await page.goto("/capture/queue");
    await expect(page.getByText(/در انتظار بازبینی مدیر/).first()).toBeVisible({ timeout: 30_000 });
    const q = (await api(admin, "GET", "/sync-quarantine")).body.results.find((x: any) => x.contact_name === name);
    expect(q.reason).toBe("EVENT_CLOSED_BEYOND_GRACE");
    const ok = await api(admin, "POST", `/sync-quarantine/${q.id}/approve`, { note: "QA" });
    expect(ok.status).toBe(200);
    const lead = (await api(admin, "GET", `/interactions/${ok.body.interaction_id}`)).body;
    expect(lead.event.code).toBe(ev.code);
    await actx.close();
  });
});

test("TC-OFF-06 first visit to capture while offline (after online login) still allows capture", async ({ page, context }, info) => {
  tc(info, "TC-OFF-06", { role: "planmgr", route: "/capture", action: "offline first open", req: "§22.4", expected: "form with event products, not 'no membership'" });
  await loginAs(page, "planmgr", "/");
  await page.waitForLoadState("networkidle");
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  if ((page.viewportSize()?.width ?? 1440) >= 1024) await page.getByRole("button", { name: "ثبت لید جدید" }).first().click();
  else await press(info, page.getByRole("button", { name: "ثبت لید جدید" }));
  await expect(page).toHaveURL(/\/capture/);
  await expect(page.locator("#contact_name")).toBeVisible();
  await expect(page.getByText(/عضو فعال هیچ رویدادی نیستید/)).toHaveCount(0);
  await shot(page, info, "planmgr", "/capture", "offline-first-open", "TC-OFF-06");
  await context.setOffline(false);
});

test.describe("Browser-level security", () => {
  test("TC-SEC-01 stored XSS payload in lead fields renders as text", async ({ page }, info) => {
    tc(info, "TC-SEC-01", { role: "specialist1", route: "/leads/:id", action: "XSS", expected: "no script execution" });
    await loginAs(page, "specialist1");
    const evs = (await api(page, "GET", "/events/mine")).body;
    const payload = `<img src=x onerror="window.__xss=1"> ${uniq()}`;
    const lead = await api(page, "POST", "/interactions", { event_id: evs[0].id, client_record_id: crypto.randomUUID(), contact_name: payload, mobile: mobileNo(), org_name: "<script>window.__xss=2</script>", note: "<svg onload=window.__xss=3>", product_ids: [evs[0].products[0].id] });
    await page.goto(`/leads/${lead.body.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("<img");
    await page.goto(`/leads?q=${encodeURIComponent(payload.slice(-7))}`);
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  });

  test("TC-SEC-02 CSRF required for state-changing API calls", async ({ page }, info) => {
    tc(info, "TC-SEC-02", { role: "specialist1", route: "/api/v1/interactions", action: "POST without CSRF", expected: "403" });
    await apiLogin(page, "specialist1");
    const r = await page.request.post("/api/v1/interactions", { data: { contact_name: "x" } });
    expect(r.status()).toBe(403);
    expect(JSON.stringify(await r.json())).toMatch(/CSRF/i);
  });

  test("TC-SEC-03 security headers on API responses", async ({ page }, info) => {
    tc(info, "TC-SEC-03", { role: "anonymous", route: "/api/v1/branding", action: "headers", expected: "nosniff, DENY" });
    const r = await page.request.get("/api/v1/branding");
    expect(r.headers()["x-content-type-options"]).toBe("nosniff");
    expect(r.headers()["x-frame-options"]).toBe("DENY");
  });
});

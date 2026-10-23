import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { api, apiLogin, appendJsonl, device, overflow, press, shot, tc } from "./support";

/**
 * Role × route × viewport matrix. EXPECTED access is hard-coded from docs/permissions-matrix.md and the seed
 * (independent oracle) — it is NOT read back from the application.
 */
const PERSONAS = ["admin", "mdm", "dg", "exec", "evmgr", "planmgr", "owner", "specialist1", "qa_dual", "qa_nomember", "qa_closed"] as const;
type P = (typeof PERSONAS)[number];
const ALL: P[] = [...PERSONAS];

const ROUTES: { path: string; allowed: P[]; nav: boolean }[] = [
  { path: "/", allowed: ALL, nav: true },
  { path: "/capture", allowed: ALL, nav: false },
  { path: "/capture/queue", allowed: ALL, nav: false },
  { path: "/leads", allowed: ALL, nav: true },
  { path: "/leads/:id", allowed: ALL, nav: false },
  { path: "/inbox", allowed: ALL, nav: true },
  { path: "/notifications", allowed: ALL, nav: true },
  { path: "/profile", allowed: ALL, nav: false },
  { path: "/dashboard", allowed: ["admin", "mdm", "dg", "exec", "evmgr", "planmgr"], nav: true },
  { path: "/reports", allowed: ["admin", "mdm", "dg", "evmgr", "planmgr"], nav: true },
  { path: "/messages", allowed: ["admin", "mdm", "dg", "evmgr", "planmgr"], nav: true },
  { path: "/admin/events", allowed: ["admin", "mdm", "evmgr"], nav: true },
  { path: "/admin/users", allowed: ["admin"], nav: true },
  { path: "/admin/catalog", allowed: ["admin", "mdm"], nav: true },
  { path: "/admin/accounts", allowed: ["admin", "mdm", "dg", "exec"], nav: true },
  { path: "/admin/duplicates", allowed: ["admin", "mdm"], nav: true },
  { path: "/admin/quarantine", allowed: ["admin", "mdm"], nav: true },
  { path: "/admin/tags", allowed: ["admin", "mdm"], nav: true },
  { path: "/admin/notify", allowed: ["admin", "mdm"], nav: true },
  { path: "/admin/branding", allowed: ["admin", "mdm"], nav: true },
  { path: "/admin/roles", allowed: ["admin"], nav: true },
  { path: "/admin/audit", allowed: ["admin", "mdm"], nav: true },
];
const VISUAL_DEVICES = ["desktop-1440", "tablet-768", "mobile-390"];
const axeDone = new Set<string>();

async function menuHrefs(page: Page, info: TestInfo) {
  const wide = (page.viewportSize()?.width ?? 1440) >= 1024;
  if (wide) return page.locator("aside a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  const tabs = await page.locator("nav[aria-label='ناوبری پایین'] a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  await press(info, page.getByRole("button", { name: "بیشتر" }));
  const sheet = await page.getByRole("dialog").locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  await page.keyboard.press("Escape");
  return [...tabs, ...sheet];
}

for (const persona of PERSONAS) {
  test(`TC-MTX ${persona}: route access, menu affordances, screenshots, overflow, axe`, async ({ page }, info) => {
    test.setTimeout(240_000);
    tc(info, `TC-MTX-${persona}`, { role: persona, route: "*", action: "route matrix", expected: "matches permissions matrix" });
    const dev = device(info);
    const visual = VISUAL_DEVICES.includes(dev);
    await apiLogin(page, persona);
    const leads = (await api(page, "GET", "/interactions?page_size=1")).body;
    const leadId = leads?.results?.[0]?.id;
    await page.goto("/");
    await expect(page.locator("main#main")).toBeVisible();
    const hrefs = await menuHrefs(page, info);
    for (const r of ROUTES) {
      const expected = r.allowed.includes(persona) ? "ALLOW" : "DENY";
      let path = r.path;
      if (path === "/leads/:id") {
        if (!leadId) {
          appendJsonl(`matrix-${dev}.jsonl`, { persona, route: r.path, viewport: dev, action: "view", expected, observed: "N/A (no visible lead)", menu: "n/a", result: "SKIP" });
          continue;
        }
        path = `/leads/${leadId}`;
      }
      await page.goto(path);
      await expect(page.locator("main#main")).toBeVisible();
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(250);
      const denied = await page.getByText("دسترسی مجاز نیست").isVisible().catch(() => false);
      const errorCard = await page.getByText(/^(بارگذاری ناموفق بود|صفحه یافت نشد|یافت نشد)$/).first().isVisible().catch(() => false);
      const observed = denied ? "DENY" : errorCard ? "ERROR" : "ALLOW";
      const menu = r.nav ? (hrefs.includes(r.path) ? "shown" : "hidden") : "n/a";
      const menuOk = !r.nav || (menu === "shown") === (expected === "ALLOW");
      const o = await overflow(page);
      const row: Record<string, unknown> = { persona, route: r.path, viewport: dev, action: "view", expected, observed, menu, overflow_px: o.overflow, result: observed === expected && menuOk && o.overflow <= 1 ? "PASS" : "FAIL" };
      if (visual) {
        row.screenshot = (await shot(page, info, persona, r.path, observed === "ALLOW" ? "ready" : "denied", `TC-MTX-${persona}`)).split("/qa/")[1];
        const key = `${r.path}|${dev}|${observed}`;
        if (observed === "ALLOW" && !axeDone.has(key)) {
          axeDone.add(key);
          const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
          for (const v of res.violations) {
            appendJsonl(`axe-${dev}.jsonl`, { persona, route: r.path, viewport: dev, id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) });
          }
          row.axe_violations = res.violations.length;
        }
      }
      appendJsonl(`matrix-${dev}.jsonl`, row);
      expect.soft(observed, `${persona} ${r.path} on ${dev}`).toBe(expected);
      expect.soft(menuOk, `${persona} menu ${r.path} on ${dev}: ${menu}`).toBe(true);
      expect.soft(o.overflow, `${persona} overflow ${r.path} on ${dev}: ${JSON.stringify(o.offenders)}`).toBeLessThanOrEqual(1);
    }
  });
}

test("TC-VIS-STATES loading, error, offline banner, popovers and toasts", async ({ page, context }, info) => {
  test.skip(!VISUAL_DEVICES.includes(device(info)), "state gallery captured on the three reference viewports");
  tc(info, "TC-VIS-STATES", { role: "planmgr", route: "various", action: "state gallery", expected: "every state renders without overflow" });
  await apiLogin(page, "planmgr");
  // loading skeleton
  await page.route("**/api/v1/interactions?*", async (r) => { await new Promise((x) => setTimeout(x, 2500)); await r.continue(); });
  await page.goto("/leads");
  await expect(page.getByRole("status", { name: "در حال بارگذاری" })).toBeVisible();
  await shot(page, info, "planmgr", "/leads", "loading", "TC-VIS-STATES");
  await page.unrouteAll({ behavior: "ignoreErrors" });
  // server error
  await page.route("**/api/v1/interactions?*", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "خطای آزمایشی سرور" }) }));
  await page.goto("/leads");
  await expect(page.getByText("بارگذاری ناموفق بود")).toBeVisible({ timeout: 15_000 });
  await shot(page, info, "planmgr", "/leads", "server-error", "TC-VIS-STATES");
  await page.unrouteAll({ behavior: "ignoreErrors" });
  // filters panel + Jalali date picker popover
  await page.goto("/reports");
  await press(info, page.locator("main button:has(svg.lucide-calendar-days)").first());
  await expect(page.getByRole("grid")).toBeVisible();
  const before = await page.getByRole("button", { name: /ماه/ }).first().isVisible();
  expect(before).toBe(true);
  await press(info, page.getByRole("button", { name: "ماه بعد" }));
  await shot(page, info, "planmgr", "/reports", "datepicker-open", "TC-VIS-STATES");
  await page.keyboard.press("Escape");
  // offline banner
  await page.goto("/capture");
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByText(/آفلاین هستید/)).toBeVisible();
  await shot(page, info, "planmgr", "/capture", "offline", "TC-VIS-STATES");
  await context.setOffline(false);
  // user menu / more sheet on narrow screens
  if ((page.viewportSize()?.width ?? 1440) < 1024) {
    await press(info, page.getByRole("button", { name: "بیشتر" }));
    await shot(page, info, "planmgr", "/", "more-sheet", "TC-VIS-STATES");
    await page.keyboard.press("Escape");
  }
});

test("TC-VIS-JALALI date picker round-trips value and month/year navigation", async ({ page }, info) => {
  test.skip(device(info) !== "desktop-1440", "logic check on one viewport");
  tc(info, "TC-VIS-JALALI", { role: "planmgr", route: "/reports", action: "jalali picker", expected: "selected Jalali day shown identically after pick" });
  await apiLogin(page, "planmgr");
  await page.goto("/reports");
  const trigger = page.locator("main button:has(svg.lucide-calendar-days)").first();
  await press(info, trigger);
  await page.getByLabel("سال").selectOption({ index: 5 });
  await press(info, page.getByRole("button", { name: "ماه بعد" }));
  const day = page.getByRole("grid").getByRole("button").nth(14);
  const label = await day.getAttribute("aria-label");
  await press(info, day);
  const [d, month, year] = (label ?? "").split(" ");
  const triggerText = await page.locator("main button:has(svg.lucide-calendar-days)").first().innerText().catch(() => "");
  const shown = await page.locator("main").innerText();
  expect(shown, `picked ${label}, trigger: ${triggerText}`).toContain(`${d} ${month} ${year}`);
});

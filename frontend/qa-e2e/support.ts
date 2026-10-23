import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

export const PASSWORD = "Demo@Expo1405";
export const QA_ROOT = path.resolve(process.cwd(), "../qa");
export const SHA = process.env.QA_SHA ?? "unknown";

export const uniq = () => `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`.slice(-7);
export const mobileNo = () => `0912${uniq()}`;

export function device(info: TestInfo) {
  return info.project.name;
}
export function isTouch(info: TestInfo) {
  return /tablet|mobile/.test(info.project.name);
}
export function isNarrow(page: Page) {
  return (page.viewportSize()?.width ?? 1440) < 1024;
}

/** Tap on touch projects, click otherwise (real touch emulation, not synthetic clicks). */
export async function press(info: TestInfo, loc: Locator) {
  await loc.scrollIntoViewIfNeeded();
  if (isTouch(info)) await loc.tap();
  else await loc.click();
}

function csrf(cookies: { name: string; value: string }[]) {
  return cookies.find((c) => c.name === "csrftoken")?.value ?? "";
}

export async function apiLogin(page: Page, username: string, password = PASSWORD) {
  await page.request.get("/api/v1/auth/csrf");
  const token = csrf(await page.context().cookies());
  const r = await page.request.post("/api/v1/auth/login", { data: { username, password }, headers: { "X-CSRFToken": token } });
  expect(r.status(), `login ${username}`).toBe(200);
}

export async function api(page: Page, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, data?: unknown) {
  const token = csrf(await page.context().cookies());
  const r = await page.request.fetch(`/api/v1${url}`, { method, data, headers: { "X-CSRFToken": token } });
  let body: any = null;
  try {
    body = await r.json();
  } catch {
    body = null;
  }
  return { status: r.status(), body };
}

export async function loginAs(page: Page, username: string, to = "/") {
  await apiLogin(page, username);
  await page.goto(to);
  await expect(page.locator("main#main")).toBeVisible();
}

export async function uiLogin(page: Page, username: string, password = PASSWORD) {
  await page.goto("/login");
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
}

/** Annotates a test with requirement/case metadata consumed by qa/scripts/report.py. */
export function tc(info: TestInfo, id: string, meta: { role?: string; route?: string; action?: string; req?: string; expected?: string } = {}) {
  info.annotations.push({ type: "case", description: JSON.stringify({ id, ...meta }) });
}

export async function overflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const offenders: string[] = [];
    if (doc.scrollWidth > doc.clientWidth + 1) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > doc.clientWidth + 1 || r.left < -1) && getComputedStyle(el).position !== "fixed") {
          offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
          if (offenders.length > 5) break;
        }
      }
    }
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, overflow: doc.scrollWidth - doc.clientWidth, offenders };
  });
}

export async function expectNoOverflow(page: Page, label = "") {
  const o = await overflow(page);
  expect(o.overflow, `horizontal overflow ${label}: ${JSON.stringify(o)}`).toBeLessThanOrEqual(1);
}

export function appendJsonl(file: string, row: unknown) {
  const p = path.join(QA_ROOT, "results", file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(row) + "\n");
}

export function shotPath(role: string, dev: string, route: string, state: string) {
  const safe = route.replace(/^\//, "").replace(/[/:?=&]+/g, "_") || "home";
  const p = path.join(QA_ROOT, "screenshots", SHA, role, dev, `${safe}__${state}.png`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return p;
}

/** Full-page screenshot with deterministic motion; records it in the screenshot manifest. */
export async function shot(page: Page, info: TestInfo, role: string, route: string, state: string, caseId = "") {
  const dev = device(info);
  const file = shotPath(role, dev, route, state);
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" }).catch(() => undefined);
  await page.screenshot({ path: file, fullPage: true });
  appendJsonl(`screenshots-${dev}.jsonl`, { file: path.relative(QA_ROOT, file), role, device: dev, route, state, caseId, viewport: page.viewportSize() });
  return file;
}

export async function newLeadViaApi(page: Page, eventCode = "DEMO-TECH-1405", extra: Record<string, unknown> = {}, productCode = "SMART-PARK") {
  const events = (await api(page, "GET", "/events/mine")).body as any[];
  const ev = events.find((e) => e.code === eventCode) ?? events[0];
  const product = ev.products.find((p: any) => p.code === productCode) ?? ev.products[0];
  const r = await api(page, "POST", "/interactions", {
    event_id: ev.id, client_record_id: crypto.randomUUID(), contact_name: `لید QA ${uniq()}`, mobile: mobileNo(),
    product_ids: [product.id], quality: "FOLLOW_UP", ...extra,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}

/** Types into the async user picker and selects the match once the debounced search has settled. */
export async function pickUser(scope: Locator, page: Page, info: TestInfo, query: string) {
  const settled = page.waitForResponse((r) => r.url().includes("/api/v1/users") && decodeURIComponent(r.url()).includes(`q=${query}`));
  await scope.getByLabel("جست‌وجوی کاربر").fill(query);
  await settled;
  await page.waitForTimeout(150);
  await press(info, scope.getByRole("option", { name: new RegExp(query) }).first());
  await expect(scope.getByRole("option", { name: new RegExp(query) }).first()).toHaveAttribute("aria-selected", "true");
}

/** Creates an isolated ACTIVE event (as admin) with one product and the given members. */
export async function tempEvent(admin: Page, members: { username: string; roles?: string[] }[], productCode = "SMART-PARK") {
  const code = `QA-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;
  const now = Date.now();
  const ev = await api(admin, "POST", "/events", { code, display_name: `رویداد موقت ${code}`, starts_at: new Date(now - 3600_000).toISOString(), ends_at: new Date(now + 86400_000).toISOString(), sync_grace_hours: 24 });
  expect(ev.status, JSON.stringify(ev.body)).toBe(201);
  const products = (await api(admin, "GET", "/products?status=ACTIVE")).body as any[];
  const product = products.find((p) => p.code === productCode)!;
  expect((await api(admin, "POST", `/events/${ev.body.id}/products`, { product: product.id })).status).toBe(201);
  for (const m of members) {
    const u = (await api(admin, "GET", `/users?q=${m.username}`)).body.results.find((x: any) => x.username === m.username);
    const r = await api(admin, "POST", `/events/${ev.body.id}/members`, { user: u.id, role_codes: m.roles ?? [] });
    expect([200, 201]).toContain(r.status);
  }
  let v = ev.body.version;
  for (const status of ["READY", "ACTIVE"]) {
    const t = await api(admin, "POST", `/events/${ev.body.id}/transition`, { status, version: v });
    expect(t.status, JSON.stringify(t.body)).toBe(200);
    v = t.body.version;
  }
  return { id: ev.body.id as string, code, productId: product.id as string, version: v as number };
}

export async function closeEvent(admin: Page, eventId: string, graceHours?: number) {
  let d = (await api(admin, "GET", `/events/${eventId}`)).body;
  if (graceHours !== undefined) {
    d = (await api(admin, "PATCH", `/events/${eventId}`, { sync_grace_hours: graceHours, version: d.version })).body;
  }
  const t = await api(admin, "POST", `/events/${eventId}/transition`, { status: "CLOSED", version: d.version });
  expect(t.status, JSON.stringify(t.body)).toBe(200);
}

/** Ensures the first product chip of the capture form is selected (single-product events pre-select it). */
export async function selectFirstProduct(page: Page, info: TestInfo) {
  const chip = page.getByRole("group", { name: "محصولات" }).getByRole("button").first();
  if ((await chip.getAttribute("aria-pressed")) !== "true") await press(info, chip);
  await expect(chip).toHaveAttribute("aria-pressed", "true");
}

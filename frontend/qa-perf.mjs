// Mobile render probe: 390x844, CPU 4x slowdown, ~1.6 Mbps / 150ms RTT network (emulated). Local build preview.
import { chromium } from "playwright";
const BASE = process.env.QA_BASE_URL ?? "http://localhost:5174";
const browser = await chromium.launch({ executablePath: undefined });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "fa-IR", timezoneId: "Asia/Tehran" });
const page = await ctx.newPage();
await page.request.get(`${BASE}/api/v1/auth/csrf`);
const token = (await ctx.cookies()).find((c) => c.name === "csrftoken").value;
await page.request.post(`${BASE}/api/v1/auth/login`, { data: { username: "specialist1", password: "Demo@Expo1405" }, headers: { "X-CSRFToken": token } });
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
const results = {};
for (const path of ["/login", "/", "/capture", "/leads"]) {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    await page.goto(`${BASE}${path}`, { waitUntil: "load" });
    const lcp = await page.evaluate(() => new Promise((res) => {
      let v = 0;
      new PerformanceObserver((l) => { for (const e of l.getEntries()) v = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
      setTimeout(() => res(v), 2500);
    }));
    const nav = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, transfer: n.transferSize }; });
    runs.push({ lcp: Math.round(lcp), ...nav });
  }
  const med = (k) => runs.map((r) => r[k]).sort((a, b) => a - b)[1];
  results[path] = { lcp_ms_median: med("lcp"), dcl_ms_median: Math.round(med("dcl")), runs };
}
console.log(JSON.stringify({ note: process.env.QA_PERF_NOTE ?? "Vite DEV server (unbundled modules) under emulated mobile CPU/network; production build would be faster. Not a field measurement.", budget_lcp_ms: 2500, results }, null, 1));
await browser.close();

// Targeted capture of the unauthenticated screens (absent from the QA matrix because those tests start signed-in).
// Same browser/settings as frontend/qa.config.ts: Chromium, fa-IR, Asia/Tehran; product code untouched.
import { chromium } from "/home/user/lead/frontend/node_modules/playwright/index.mjs";
const OUT = process.argv[2], BASE = "http://localhost:5174";
const devices = { "desktop-1440": { viewport: { width: 1440, height: 900 } }, "tablet-768": { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, "mobile-390": { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
const b = await chromium.launch();
for (const [name, opts] of Object.entries(devices)) {
  const ctx = await b.newContext({ ...opts, locale: "fa-IR", timezoneId: "Asia/Tehran", baseURL: BASE });
  const p = await ctx.newPage();
  await p.goto("/login"); await p.waitForLoadState("networkidle");
  await p.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important}" });
  await p.screenshot({ path: `${OUT}/${name}__login.png`, fullPage: true });
  await p.goto("/reset-password?token=qa-invalid-demo-token"); await p.waitForLoadState("networkidle");
  await p.screenshot({ path: `${OUT}/${name}__reset-invalid.png`, fullPage: true });
  await ctx.close();
}
await b.close();
console.log("ok");

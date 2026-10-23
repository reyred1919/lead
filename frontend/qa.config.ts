import { defineConfig } from "@playwright/test";
import fs from "node:fs";

/**
 * Independent QA suite. Runs against the isolated QA stack (qa/scripts/qa-stack.sh: API :8001, UI :5174).
 * All projects are Chromium emulation (no physical devices). WebKit/Firefox are added only when their
 * binaries exist; otherwise they are reported as BLOCKED by qa/scripts/report.py.
 */
const BASE = process.env.QA_BASE_URL ?? "http://localhost:5174";
const browsersDir = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
const has = (prefix: string) => fs.existsSync(browsersDir) && fs.readdirSync(browsersDir).some((d) => d.startsWith(prefix));

const common = { locale: "fa-IR", timezoneId: "Asia/Tehran", baseURL: BASE };
const touch = { hasTouch: true, isMobile: true, deviceScaleFactor: 2 };

const projects: any[] = [
  { name: "desktop-1440", use: { ...common, browserName: "chromium", viewport: { width: 1440, height: 900 } } },
  { name: "desktop-1920", use: { ...common, browserName: "chromium", viewport: { width: 1920, height: 1080 } } },
  { name: "tablet-768", use: { ...common, ...touch, browserName: "chromium", viewport: { width: 768, height: 1024 } } },
  { name: "tablet-1024", use: { ...common, ...touch, browserName: "chromium", viewport: { width: 1024, height: 768 } } },
  { name: "mobile-390", use: { ...common, ...touch, browserName: "chromium", viewport: { width: 390, height: 844 } } },
  { name: "mobile-375", use: { ...common, ...touch, browserName: "chromium", viewport: { width: 375, height: 667 } } },
];
if (has("webkit")) {
  projects.push({ name: "webkit-desktop", use: { ...common, browserName: "webkit", viewport: { width: 1440, height: 900 } } });
  projects.push({ name: "webkit-mobile", use: { ...common, browserName: "webkit", ...touch, viewport: { width: 390, height: 844 } } });
}
if (has("firefox")) projects.push({ name: "firefox-desktop", use: { ...common, browserName: "firefox", viewport: { width: 1440, height: 900 } } });

export default defineConfig({
  testDir: "qa-e2e",
  outputDir: process.env.QA_OUT ?? "../qa/traces/test-output",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: Number(process.env.QA_WORKERS ?? 2),
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: process.env.QA_JSON ?? "../qa/results/playwright.json" }]],
  use: { trace: "retain-on-failure", video: "retain-on-failure", screenshot: "only-on-failure", actionTimeout: 15_000 },
  projects,
});

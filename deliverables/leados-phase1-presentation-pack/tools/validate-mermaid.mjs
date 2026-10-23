import { JSDOM } from "jsdom";
import fs from "node:fs";
const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window; globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.DOMParser = dom.window.DOMParser; globalThis.Element = dom.window.Element; globalThis.HTMLElement = dom.window.HTMLElement;
const mermaid = (await import("mermaid")).default;
mermaid.initialize({ startOnLoad: false });
let total = 0, bad = 0;
for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, "utf8");
  const blocks = [...src.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);
  for (const [i, b] of blocks.entries()) {
    total++;
    try { await mermaid.parse(b); } catch (e) { bad++; console.log(`FAIL ${file} #${i + 1}: ${String(e.message || e).split("\n").slice(0, 4).join(" | ")}`); }
  }
}
console.log(`mermaid blocks: ${total}, invalid: ${bad}`);
process.exit(bad ? 1 : 0);

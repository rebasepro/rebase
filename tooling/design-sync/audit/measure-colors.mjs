import { chromium } from "playwright";
import { pathToFileURL } from "url";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
await p.goto(pathToFileURL("/Users/francesco/rebase/.design-sync/audit/color-audit.html").href);
await p.waitForTimeout(1500);
const rows = await p.evaluate(() => window.__colors());
await b.close();
// WCAG AA: 4.5 for normal text, 3.0 for large (>=18.66px bold or >=24px)
const need = r => (r.size >= 24 || (r.size >= 18.66 && +r.weight >= 700)) ? 3.0 : 4.5;
const fails = rows.filter(r => r.ratio < need(r));
const weak = rows.filter(r => r.ratio >= need(r) && r.ratio < need(r) + 1);
console.log(`checked ${rows.length} colour combinations\n`);
console.log(`=== BELOW WCAG AA (${fails.length}) ===`);
fails.sort((a,b)=>a.ratio-b.ratio).forEach(r =>
  console.log(`  ${String(r.ratio).padStart(5)}:1  need ${need(r)}  ${r.k.padEnd(34)} ${r.fg} on ${r.bg}`));
console.log(`\n=== marginal, within 1.0 of the threshold (${weak.length}) ===`);
weak.sort((a,b)=>a.ratio-b.ratio).forEach(r =>
  console.log(`  ${String(r.ratio).padStart(5)}:1  ${r.k}`));

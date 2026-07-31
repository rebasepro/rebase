import { chromium } from "playwright";
import { pathToFileURL } from "url";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
await p.goto(pathToFileURL("/Users/francesco/rebase/.design-sync/audit/size-audit.html").href);
await p.waitForTimeout(1200);
const rows = await p.evaluate(() => window.__measure());
await b.close();

const byComp = new Map();
for (const r of rows) {
    if (!byComp.has(r.component)) byComp.set(r.component, []);
    byComp.get(r.component).push(r);
}

console.log("RENDERED HEIGHTS (px)\n");
const ORDER = ["smallest", "small", "medium", "large", "xl", "2xl"];
const hdr = "component".padEnd(22) + ORDER.map(s => s.padStart(9)).join("");
console.log(hdr);
console.log("-".repeat(hdr.length));
for (const [comp, list] of byComp) {
    const m = Object.fromEntries(list.map(r => [r.size, r.h]));
    console.log(comp.padEnd(22) + ORDER.map(s => (m[s] == null ? "-" : String(m[s])).padStart(9)).join(""));
}

// coherence check: for each size name, do the inline form controls agree?
console.log("\n\nSAME-SIZE-NAME AGREEMENT (controls that sit side by side)\n");
const INLINE = ["Button", "LoadingButton", "TextField", "DebouncedTextField", "Select", "MultiSelect", "SearchBar", "DateTimeField", "IconButton"];
for (const s of ORDER) {
    const vals = INLINE.map(c => {
        const row = (byComp.get(c) || []).find(r => r.size === s);
        return row ? { c, h: row.h } : null;
    }).filter(Boolean);
    if (vals.length < 2) continue;
    const heights = [...new Set(vals.map(v => v.h))].sort((a, b) => a - b);
    const spread = heights[heights.length - 1] - heights[0];
    const flag = spread === 0 ? "OK  " : spread <= 2 ? "~   " : "MISMATCH";
    console.log(`${flag} size="${s}"  spread ${spread}px  ->  ` + vals.map(v => `${v.c}:${v.h}`).join("  "));
}

/**
 * Landing-page drift audit.
 *
 * Compares what the page actually computes against the design system's own
 * tokens, read from packages/ui/dist/theme.css on disk.
 *
 * Reading tokens from the *page* does not work: Tailwind v4 tree-shakes
 * `@theme` variables that nothing references, so unused tokens are simply
 * absent from :root and every value looks like drift.
 *
 * Usage: node ../.design-sync/audit/site-drift.mjs [url]
 */
import { chromium } from "playwright";
import fs from "fs";

const URL = process.argv[2] || "http://localhost:4331/";
const THEME = "/Users/francesco/rebase/packages/ui/dist/theme.css";

const src = fs.readFileSync(THEME, "utf8");
const rawColors = [...src.matchAll(/(--color-[\w-]+):\s*([^;]+);/g)].map(m => m[2].trim());
// site-level overrides that are legitimately not in the DS file
const siteExtra = ["#359aff", "#0061c2"];
// the control scale and Tailwind's default type scale (the DS does not restate it)
const CONTROL = [28, 32, 40, 48, 56, 64];
const TEXT = [10, 11, 12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72, 96, 128];

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await p.addStyleTag({ content: "#cookie-banner{display:none!important}" });
await p.waitForTimeout(1500);

const out = await p.evaluate(({ rawColors, siteExtra, CONTROL, TEXT }) => {
    // resolve every token (incl. oklch(from ...)) to a concrete rgb string
    const probe = document.createElement("span");
    document.body.appendChild(probe);
    const resolve = (v) => { probe.style.color = ""; probe.style.color = v; return getComputedStyle(probe).color; };
    const TOKENS = new Set();
    [...rawColors, ...siteExtra].forEach(v => { const r = resolve(v); if (r && r !== "rgb(0, 0, 0)") TOKENS.add(r); });
    // surface/neutral ramps come from Tailwind's palette via @theme too
    probe.remove();

    const heights = {}, sizes = {}, radii = {}, offColor = {}, fams = {};
    const offScale = [];

    document.querySelectorAll("body *").forEach(el => {
        const cs = getComputedStyle(el), r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;

        const tag = el.tagName;
        if ((tag === "A" || tag === "BUTTON") && r.height >= 18 && r.width >= 40 &&
            (cs.backgroundColor !== "rgba(0, 0, 0, 0)" || parseFloat(cs.borderTopWidth) > 0)) {
            const h = Math.round(r.height);
            heights[h] = (heights[h] || 0) + 1;
            if (!CONTROL.includes(h)) offScale.push({ h, t: (el.textContent || "").trim().slice(0, 28) });
        }

        const ownText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
        if (ownText) {
            const fs2 = Math.round(parseFloat(cs.fontSize));
            sizes[fs2] = (sizes[fs2] || 0) + 1;
            const f = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim();
            fams[f] = (fams[f] || 0) + 1;
            const c = cs.color;
            if (c && !c.startsWith("rgba") && !TOKENS.has(c) &&
                c !== "rgb(255, 255, 255)" && c !== "rgb(0, 0, 0)") {
                offColor[c] = (offColor[c] || 0) + 1;
            }
        }
        const br = cs.borderTopLeftRadius;
        if (br && br !== "0px" && parseFloat(br) < 500) radii[br] = (radii[br] || 0) + 1;
    });
    return { heights, sizes, radii, offColor, fams, offScale, tokenCount: TOKENS.size };
}, { rawColors, siteExtra, CONTROL, TEXT });
await b.close();

const sortNum = o => Object.entries(o).sort((a, b) => +a[0] - +b[0]);
const sortCnt = o => Object.entries(o).sort((a, b) => b[1] - a[1]);

console.log(`resolved ${out.tokenCount} DS colour tokens\n`);
console.log("── CONTROL HEIGHTS ──  DS scale: " + CONTROL.join("/"));
sortNum(out.heights).forEach(([h, n]) =>
    console.log(`   ${String(h).padStart(4)}px x${String(n).padEnd(3)} ${CONTROL.includes(+h) ? "on scale" : "  drift"}`));
console.log(`   off-scale controls: ${out.offScale.length}`);
out.offScale.slice(0, 8).forEach(c => console.log(`      ${String(c.h).padStart(3)}px "${c.t}"`));

console.log("\n── TEXT SIZES ──  DS/Tailwind scale: " + TEXT.slice(0, 8).join("/") + "…");
sortNum(out.sizes).forEach(([s, n]) =>
    console.log(`   ${String(s).padStart(4)}px x${String(n).padEnd(4)} ${TEXT.includes(+s) ? "on scale" : "  drift"}`));

console.log("\n── FONT FAMILIES ──");
sortCnt(out.fams).forEach(([f, n]) => console.log(`   ${String(n).padStart(4)}x ${f}`));

console.log("\n── TEXT COLOURS MATCHING NO TOKEN ──");
const oc = sortCnt(out.offColor);
if (!oc.length) console.log("   none");
oc.slice(0, 10).forEach(([c, n]) => console.log(`   ${String(n).padStart(4)}x ${c}`));

console.log("\n── BORDER RADII ──");
sortCnt(out.radii).forEach(([r, n]) => console.log(`   ${String(n).padStart(4)}x ${r}`));

/**
 * Contrast gate over the chroma slabs — the two sections that invert the page.
 *
 * Every other section on the site is light-on-dark, so a value written once
 * keeps working. The claim slab (deep blue) and the close slab (coral) are the
 * exceptions: they are bright grounds carrying content authored in the dark
 * ground's vocabulary, and `global.css` remaps that vocabulary rule by rule —
 * see "The close, inverted". The block's own instruction is that a new element
 * needs a line there rather than a hand-tuned class.
 *
 * Two ways that fails silently, both of which were live on the home page until
 * 2026-09-10 and neither of which a grep can see:
 *
 *   1. An element arrives with no line written for it. "How it compares" and
 *      the security blog link were `text-surface-400` with `hover:text-white` —
 *      1.29:1 on coral and 4.19:1 on the blue. 1.29:1 is not hard to read, it
 *      is invisible.
 *   2. A line is written, and then the element it names changes. The Cloud
 *      lane's badge had a rule keyed on `bg-amber-400/15`; the badge became
 *      `bg-white/10`, `bg-amber-400/15` stopped existing anywhere in the site,
 *      and the rule went on passing review while the badge fell back to
 *      2.20:1.
 *
 * Both are only visible by RENDERING and measuring, which is what this does:
 * every text run on a chroma slab, its computed colour against the ground it
 * actually composites over, at the AA threshold for its size.
 *
 * WHAT IT DOES NOT COVER. An element sitting on an OPAQUE background that is
 * not the slab is a product surface with its own ladder — /product paints its
 * collection figure on the claim slab, and those cards are `--surface-card` and
 * `--surface-sheet` regardless of what is behind them. Their contrast is a
 * question about the muted text tier versus the surface ladder, not about slab
 * ink, and answering it here would mean this gate owned two unrelated rules. A
 * translucent tint IS still the slab (the badge is `bg-white/10` over coral),
 * so those composite through and are checked.
 *
 * Run: `pnpm check:slab-ink` — needs `dist/`, and starts its own preview server.
 */
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const DIST = "dist";
if (!existsSync(DIST)) {
    console.error("dist/ not found — run `pnpm build` first.");
    process.exit(2);
}

/* Every route that renders a chroma slab. `/product` is here because it takes
   the claim slab for its collection figure (see "THE FOUR GROUNDS"), and the
   locales because German and French reflow the copy the slabs carry. */
const ROUTES = ["/", "/product", "/es", "/de", "/fr"];

/* A free high port, so this never collides with a dev server or another gate. */
const PORT = 4400 + Math.floor(Math.random() * 400);
const server = spawn("npx", ["astro", "preview", "--port", String(PORT)], { stdio: "ignore" });
const stop = () => { try { server.kill(); } catch { /* already gone */ } };
process.on("exit", stop);
process.on("SIGINT", () => { stop(); process.exit(130); });

const BASE = `http://localhost:${PORT}`;
const up = async () => {
    for (let i = 0; i < 60; i++) {
        try { if ((await fetch(BASE + "/")).ok) return true; } catch { /* not yet */ }
        await new Promise(r => setTimeout(r, 500));
    }
    return false;
};
if (!await up()) { console.error(`preview server never came up on ${PORT}`); stop(); process.exit(2); }

const MEASURE = () => {
    // Computed styles come back as rgb() for most values but as oklab()/oklch()
    // for the slab grounds, which are authored `oklch(from ...)`. Rasterising a
    // 1x1 pixel is the only parser that handles every syntax Chrome may emit.
    const cv = document.createElement("canvas"); cv.width = cv.height = 1;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    const px = (s) => {
        if (!s) return null;
        cx.clearRect(0, 0, 1, 1);
        cx.fillStyle = "#000"; cx.fillStyle = s;
        cx.fillRect(0, 0, 1, 1);
        const d = cx.getImageData(0, 0, 1, 1).data;
        return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
    };
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
    const ratio = (fg, bg) => { const x = L(fg), y = L(bg); const [hi, lo] = x > y ? [x, y] : [y, x]; return (hi + 0.05) / (lo + 0.05); };
    const hex = (c) => "#" + [c.r, c.g, c.b].map(n => Math.round(n).toString(16).padStart(2, "0")).join("");

    const out = [];
    for (const slab of document.querySelectorAll(".ground-chroma")) {
        const probe = document.createElement("div");
        probe.style.cssText = "position:absolute;width:0;height:0;background:var(--ground)";
        slab.appendChild(probe);
        const ground = px(getComputedStyle(probe).backgroundColor);
        probe.remove();
        if (!ground) continue;
        const which = slab.className.includes("ground-close") ? "close" : "claim";

        for (const el of slab.querySelectorAll("*")) {
            if (el.closest(".frame")) continue;      // a frame is its own dark surface
            if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
            const cs = getComputedStyle(el);
            if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) continue;
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            const fg = px(cs.color);
            if (!fg || fg.a === 0) continue;

            // Resolve what this text actually composites over. Collect every
            // painted ancestor up to the slab, stopping at the first OPAQUE one:
            // that is a product surface with its own ladder, so the run is out
            // of scope (see the header). Otherwise the base is the slab ground
            // and the translucent layers paint onto it outermost-first — a tint
            // of the slab is still the slab.
            //
            // Stopping at the FIRST painted ancestor instead, whatever its
            // alpha, is wrong and reports three false failures on /product: the
            // form figure's `.field` is `--surface-field`, white at 0.04, and
            // taking that as "translucent, therefore on the slab" composites a
            // field that sits on an opaque #181818 card over deep blue.
            const layers = [];
            let ownSurface = false;
            for (let q = el; q && q !== slab; q = q.parentElement) {
                const pb = px(getComputedStyle(q).backgroundColor);
                if (!pb || pb.a === 0) continue;
                if (pb.a > 0.5) { ownSurface = true; break; }
                layers.push(pb);
            }
            if (ownSurface) continue;
            let bg = ground;
            for (const layer of layers.reverse()) bg = over(layer, bg);

            const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
            const large = size >= 24 || (size >= 18.66 && bold);
            const need = large ? 3 : 4.5;
            const got = ratio(over(fg, bg), bg);
            if (got < need) out.push({
                slab: which, ratio: +got.toFixed(2), need, fg: hex(fg), bg: hex(bg),
                px: Math.round(size), tag: el.tagName.toLowerCase(),
                cls: el.className.toString().split(/\s+/).slice(0, 4).join(" "),
                text: el.textContent.trim().replace(/\s+/g, " ").slice(0, 40),
            });
        }
    }
    return out;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const page = await ctx.newPage();

let failures = 0, slabs = 0;
for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: "load", timeout: 90000 });
    await page.waitForTimeout(500);
    slabs += await page.evaluate(() => document.querySelectorAll(".ground-chroma").length);
    const rows = await page.evaluate(MEASURE);
    if (rows.length) {
        console.log(`\n${route}`);
        for (const f of rows) {
            console.log(`  ${String(f.ratio).padStart(5)} / ${f.need}  ${f.fg} on ${f.bg}  ${f.px}px  ${f.slab} slab`);
            console.log(`         <${f.tag} class="${f.cls}">  "${f.text}"`);
        }
        failures += rows.length;
    }
}
await browser.close();
stop();

console.log(
    `\n${failures} text runs below AA across ${slabs} chroma slabs on ${ROUTES.length} routes.` +
    (failures ? "\nFix by adding a line to the remap block in global.css, not by hand-tuning the markup." : ""),
);
process.exit(failures ? 1 : 0);

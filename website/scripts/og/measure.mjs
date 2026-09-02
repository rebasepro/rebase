import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(pathToFileURL("/Users/francesco/rebase/website/dist/index.html").href, { waitUntil: "load" });
await page.addStyleTag({ content: ".animate-on-scroll{opacity:1!important;transform:none!important}" });
await page.waitForTimeout(600);
const boxes = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("section, .chapter, #s-case-study").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.height < 40) return;
        out.push({
            id: el.id || el.className.slice(0, 60),
            top: Math.round(r.top + scrollY),
            bottom: Math.round(r.bottom + scrollY),
            h: Math.round(r.height),
        });
    });
    return out;
});
for (const b of boxes) console.log(String(b.top).padStart(6), "→", String(b.bottom).padStart(6), String(b.h).padStart(6), b.id);
await browser.close();

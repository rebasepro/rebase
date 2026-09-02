// Screenshots from dist/, for a PR. Run from the repo root:
//   node website/scripts/og/shots.mjs /tmp/rebase-shots
//
// `fullPage` fails on these pages under swiftshader (the Neat canvas plus a
// 10,000px document exceeds what the capture can allocate), so each page is
// taken as a few scrolled 1280x1600 frames and the frames are what the PR shows.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const OUT = process.argv[2] ?? "/tmp/rebase-shots";
const BASE = process.argv[3] ?? "http://127.0.0.1:4321";
mkdirSync(OUT, { recursive: true });
const PAGES = [
    ["home", "index.html", 3],
    ["security", "security/index.html", 2],
    ["agencies", "agencies/index.html", 2],
    ["rebase-vs-supabase", "rebase-vs-supabase/index.html", 2],
    ["es-home", "es/index.html", 2],
];

const H = 1600;
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: H }, deviceScaleFactor: 1 });
// Otherwise the consent modal sits over the hero in every shot.
await ctx.addCookies([{ name: "cookie-consent", value: "accepted", url: BASE }]);
const page = await ctx.newPage();
for (const [name, file, frames] of PAGES) {
    await page.goto(`${BASE}/${file}`, { waitUntil: "load" });
    await page.addStyleTag({ content: ".animate-on-scroll{opacity:1!important;transform:none!important}" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1000);
    for (let i = 0; i < frames; i++) {
        await page.evaluate((y) => window.scrollTo(0, y), i * H);
        await page.waitForTimeout(700);
        const suffix = frames > 1 ? `-${i + 1}` : "";
        await page.screenshot({ path: `${OUT}/${name}${suffix}.png` });
    }
    console.log(name);
}
await browser.close();

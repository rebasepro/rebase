// Renders public/img/teaser.png and public/img/twitter_teaser.png (1200x630)
// from scripts/og/teaser.html. Run from the repo root:
//   node website/scripts/og/render.mjs
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, "../..");

const fontHead = require.resolve(
    "@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2",
    { paths: [site] },
);
const fontBody = require.resolve(
    "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
    { paths: [site] },
);

const html = readFileSync(resolve(here, "teaser.html"), "utf8")
    .replace("FONT_HEAD", pathToFileURL(fontHead).href)
    .replace("FONT_BODY", pathToFileURL(fontBody).href)
    .replace("LOGO_SRC", pathToFileURL(resolve(site, "public/img/rebase_logo.svg")).href);

const tmp = resolve(here, ".teaser.rendered.html");
writeFileSync(tmp, html);

const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
});
await page.goto(pathToFileURL(tmp).href, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
const out = resolve(site, "public/img/teaser.png");
await page.screenshot({ path: out, type: "png" });
await browser.close();

// One card, two filenames: og:image and twitter:image both point at the same
// artwork, and they used to drift apart.
copyFileSync(out, resolve(site, "public/img/twitter_teaser.png"));
console.log("wrote public/img/teaser.png and public/img/twitter_teaser.png");

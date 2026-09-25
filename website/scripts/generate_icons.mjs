/**
 * Render the raster icons from `public/favicon.svg`.
 *
 * The site shipped only the SVG favicon. `/apple-touch-icon.png`,
 * `/favicon.ico` and a web manifest all returned the 404 page, so an iOS home
 * screen bookmark got a screenshot of the page, a pinned tab or an old browser
 * got nothing, and "Add to home screen" on Android had no icon to use.
 *
 * Committed, not built — the same reasoning as `generate_og_images.mjs`: they
 * change when the mark changes, and a build should not need a browser. Re-run by
 * hand after editing the SVG:
 *
 *     node website/scripts/generate_icons.mjs
 *
 * The apple-touch-icon sits on the page ground (#0A0A0A) with padding: iOS
 * fills transparency with black and rounds the corners itself, and the mark
 * drawn edge to edge loses its own rounded silhouette under that mask.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, "..");
const PUBLIC = path.join(SITE, "public");
const require = createRequire(path.join(SITE, "package.json"));
const { chromium } = require("@playwright/test");

const GROUND = "#0A0A0A";
const svg = await readFile(path.join(PUBLIC, "favicon.svg"), "utf8");
const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

/** [file, size, padding as a fraction of the size, background or null] */
const ICONS = [
    ["favicon-32.png", 32, 0, null],
    ["apple-touch-icon.png", 180, 0.14, GROUND],
    ["icon-192.png", 192, 0.1, null],
    ["icon-512.png", 512, 0.1, null],
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [file, size, pad, bg] of ICONS) {
    const inset = Math.round(size * pad);
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
        `<html><body style="margin:0;width:${size}px;height:${size}px;background:${bg ?? "transparent"}">` +
        `<img src="${dataUri}" style="display:block;position:absolute;left:${inset}px;top:${inset}px;` +
        `width:${size - 2 * inset}px;height:${size - 2 * inset}px"></body></html>`
    );
    await page.waitForFunction(() => document.images[0]?.complete);
    await page.screenshot({ path: path.join(PUBLIC, file), omitBackground: !bg });
    console.log(`✓ ${file} (${size}×${size})`);
}
await browser.close();

// favicon.ico: the 32px PNG wrapped in an ICO container (PNG-in-ICO is valid
// since Windows Vista and in every current browser).
const png = await readFile(path.join(PUBLIC, "favicon-32.png"));
const header = Buffer.alloc(6 + 16);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // one image
header.writeUInt8(32, 6); // width
header.writeUInt8(32, 7); // height
header.writeUInt8(0, 8); // palette
header.writeUInt8(0, 9); // reserved
header.writeUInt16LE(1, 10); // colour planes
header.writeUInt16LE(32, 12); // bits per pixel
header.writeUInt32LE(png.length, 14); // image size
header.writeUInt32LE(22, 18); // image offset
await writeFile(path.join(PUBLIC, "favicon.ico"), Buffer.concat([header, png]));
console.log("✓ favicon.ico");

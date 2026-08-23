/**
 * Renders website/og/card.html into every preview image the project serves.
 *
 * One template, three outputs, so the GitHub social preview and the site's
 * og:image can never drift apart again:
 *
 *   img/social-preview.png  1280x640  GitHub repo → Settings → Social preview
 *   img/teaser.png          1200x630  og:image      (Layout.astro:41)
 *   img/twitter_teaser.png  1200x630  twitter:image (Layout.astro:181)
 *
 * The mark is read straight from website/public/logo.svg by the template, so
 * a logo change lands here on the next run with nothing to copy by hand.
 *
 * Each page is captured at deviceScaleFactor 2 and downsampled with Lanczos:
 * the mark is 64 flat-fill facets meeting along long diagonals, and almost all
 * of its antialiasing lives in the blend colours between two fills. Supersample,
 * never colour-quantise. See scripts/README or `magick -help` for the flags.
 *
 *   node website/og/render.mjs [--open]
 */
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const card = join(here, "card.html");
const out = resolve(here, "..", "public", "img");

const TARGETS = [
    { file: "social-preview.png", width: 1280, height: 640, label: "GitHub social preview" },
    { file: "teaser.png", width: 1200, height: 630, label: "og:image" },
    { file: "twitter_teaser.png", width: 1200, height: 630, label: "twitter:image" },
];

const scratch = mkdtempSync(join(tmpdir(), "rebase-og-"));
const browser = await chromium.launch();

try {
    for (const target of TARGETS) {
        const page = await browser.newPage({
            viewport: { width: target.width, height: target.height },
            deviceScaleFactor: 2,
        });
        await page.goto(`file://${card}`, { waitUntil: "networkidle" });
        // Google Fonts and the inline <img> both resolve after load; a capture
        // that races them ships fallback metrics.
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() =>
            Promise.all(
                [...document.images].map((img) => (img.complete ? null : img.decode().catch(() => null))),
            ),
        );

        const supersampled = join(scratch, `2x-${target.file}`);
        await page.screenshot({ path: supersampled });
        await page.close();

        const dest = join(out, target.file);
        execFileSync("magick", [
            supersampled,
            "-filter",
            "Lanczos",
            "-resize",
            `${target.width}x${target.height}`,
            "-depth",
            "8",
            "-strip",
            `PNG32:${dest}`,
        ]);

        const kb = Math.round(statSync(dest).size / 1024);
        console.log(`  ${target.width}x${target.height}  ${kb}KB  img/${target.file}  — ${target.label}`);
    }
} finally {
    await browser.close();
    rmSync(scratch, { recursive: true, force: true });
}

if (process.argv.includes("--open")) {
    execFileSync("open", TARGETS.map((t) => join(out, t.file)));
}

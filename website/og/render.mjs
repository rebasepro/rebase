/**
 * Renders the GitHub social preview from website/og/card.html — the same
 * template, glow and seat as every og:image the site serves, so the repo card
 * and the site's cards cannot drift apart.
 *
 *   img/social-preview.png  1280x640  GitHub repo → Settings → Social preview
 *
 * It no longer writes `teaser.png` / `twitter_teaser.png`: those belong to
 * `scripts/og/render.mjs`, and this run used to overwrite them as a side effect.
 *
 * The copy is the home hero's, read from the i18n source the hero reads
 * (`src/i18n/en.ts`): the badge as the eyebrow, `hero.title.part1` and `part2`
 * as the headline's two lines, `hero.subtitle` under it, and the install
 * command from `HomeContent.astro`. The card's previous tagline outlived the
 * hero it was written for; reading the source is what keeps it from doing that
 * again.
 *
 * The page is captured at deviceScaleFactor 2 and downsampled with Lanczos:
 * the mark is 64 flat-fill facets meeting along long diagonals, and almost all
 * of its antialiasing lives in the blend colours between two fills.
 * Supersample, never colour-quantise.
 *
 *   node website/og/render.mjs [--open]
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { openCardRenderer } from "../scripts/og/neat.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, "..");
const out = join(site, "public", "img");

/** One string from `src/i18n/en.ts`, by key. Fails loudly rather than render a blank. */
const en = readFileSync(join(site, "src", "i18n", "en.ts"), "utf8");
function copy(key) {
    const m = new RegExp(`^\\s*"${key.replace(/\./g, "\\.")}":\\s*"((?:[^"\\\\]|\\\\.)*)",?\\s*$`, "m").exec(en);
    if (!m) throw new Error(`src/i18n/en.ts has no "${key}" — the social preview reads the home hero's copy from there`);
    return JSON.parse(`"${m[1]}"`);
}

const home = readFileSync(join(site, "src", "components", "pages", "HomeContent.astro"), "utf8");
const install = /const INSTALL_COMMAND = "([^"]+)"/.exec(home)?.[1];
if (!install) throw new Error("HomeContent.astro has no INSTALL_COMMAND");

const card = {
    route: "/",
    eyebrow: copy("hero.badge"),
    title: `${copy("hero.title.part1")}\n${copy("hero.title.part2")}`,
    // Trusted, in-repo markup: the hero sets its `<strong>`s bright.
    subHtml: copy("hero.subtitle"),
    cmd: install,
};

const target = { file: "social-preview.png", width: 1280, height: 640 };
const scratch = mkdtempSync(join(tmpdir(), "rebase-og-"));
const renderer = await openCardRenderer();

try {
    const result = await renderer.render(card, { width: target.width, height: target.height, deviceScaleFactor: 2 });
    if (!result.buffer) throw new Error(`social preview did not render: ${result.why}`);
    const supersampled = join(scratch, `2x-${target.file}`);
    writeFileSync(supersampled, result.buffer);

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
    console.log(`  ${target.width}x${target.height}  ${kb}KB  img/${target.file}  — GitHub social preview`);
    // GitHub refuses a social preview over 1MB.
    if (kb > 1000) throw new Error(`img/${target.file} is ${kb}KB; GitHub's ceiling is 1MB`);
} finally {
    await renderer.close();
    rmSync(scratch, { recursive: true, force: true });
}

if (process.argv.includes("--open")) {
    execFileSync("open", [join(out, target.file)]);
}

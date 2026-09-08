/**
 * Render the per-post blog artwork.
 *
 * Every post shared one grey placeholder icon on /blog and one static
 * `og/blog.png` when shared, so seven posts previewed as the same link and the
 * index read as a table of contents with a broken image next to each row.
 *
 * The artwork is the site's own gradient. `@firecms/neat` draws a ribbon in
 * WebGL, and `NeatBackground.tsx` already frames every *page* on the site by
 * hashing its path to a seat on a closed orbit — a page looks like itself on
 * every load, and its neighbours look different. This does the same thing for
 * posts, offline, and writes the frame to a file:
 *
 *     node website/scripts/generate_blog_images.mjs            # only what is missing
 *     node website/scripts/generate_blog_images.mjs --force    # re-render everything
 *     node website/scripts/generate_blog_images.mjs --only <slug>
 *     node website/scripts/generate_blog_images.mjs --check   # CI: nothing missing
 *
 * One file per post: `img/blog/og/<slug>.png`, 1200×630, the gradient with the
 * title burned in behind a scrim.
 *
 * On the site itself the hero and the /blog cards mount `NeatBackground`
 * directly — the live component, seated off the post slug — so nothing there
 * needs a picture. The social card is the one place that cannot: a crawler runs
 * no WebGL and reads no HTML, so that half has to be pixels.
 *
 * They are **committed**, following `generate_og_images.mjs`: `astro build`
 * must not depend on a browser, and artwork that fails to render must not be
 * able to fail a deploy.
 *
 * The images are a pure function of the slug, so re-running rewrites the same
 * bytes and a post's artwork never changes under it. That is also why the pose
 * is hashed rather than random: a random pose would churn every image on every
 * run, and the diff would be unreviewable.
 */
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, "..");
const require = createRequire(path.join(SITE, "package.json"));
// `@playwright/test` is the declared dependency; `playwright` is its peer and is
// not always hoisted where a bare specifier from `website/` can see it. Same
// resolution the other renderers use.
const { chromium } = require("@playwright/test");

const POSTS = path.join(SITE, "src", "content", "blog");
const OUT_ART = path.join(SITE, "public", "img", "blog");
const OUT_OG = path.join(OUT_ART, "og");
import { BASE, poseFor, IMAGE_STATS, ART, OG, ART_QUALITY, NEAT as NEAT_ENTRY } from "./og/neat.mjs";
const NEAT = NEAT_ENTRY;

/** `---` frontmatter, enough of it to read a title and a date. */
function frontmatter(source) {
    const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
    if (!block) return null;
    const out = {};
    for (const line of block[1].split("\n")) {
        const m = /^([A-Za-z_][\w]*):\s*(.*)$/.exec(line);
        if (!m) continue;
        out[m[1]] = m[2].trim().replace(/^["'](.*)["']$/s, "$1");
    }
    return out;
}

/**
 * The page rendered for one post: a canvas, and for the OG card the type over
 * it.
 *
 * The scrim is not decoration. The pose is a function of the slug, so where the
 * bright part of the ribbon lands is not knowable when this is written — one
 * post's title would sit on near-black and the next one's on a field of yellow.
 * A left-weighted dark gradient makes the text legible against any frame the
 * orbit produces, at the cost of dimming artwork the title is covering anyway.
 */
function pageHtml({ config, width, height, card }) {
    const scrim = card
        ? `<div class="scrim"></div><div class="card">
             <div class="eyebrow">${escapeHtml(card.eyebrow)}</div>
             <div class="spacer"></div>
             <h1>${escapeHtml(card.title)}</h1>
             <div class="foot"><img src="/logo.svg" alt=""><div class="word">Rebase</div><div class="host">rebase.pro</div></div>
           </div><div class="rule"></div>`
        : "";
    return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: #0b0d12; }
  #stage { position: relative; width: ${width}px; height: ${height}px; }
  canvas { display: block; width: ${width}px; height: ${height}px; }
  .scrim {
    position: absolute; inset: 0;
    background:
      linear-gradient(100deg, rgba(8,10,15,.94) 0%, rgba(8,10,15,.82) 34%, rgba(8,10,15,.28) 62%, rgba(8,10,15,.12) 100%),
      linear-gradient(0deg, rgba(8,10,15,.55) 0%, rgba(8,10,15,0) 45%);
  }
  /* The site's own type and mark, served by the script's HTTP server — the
     same files Layout.astro ships. Until 2026-09-09 this set in the system
     font at 700 with a blue square for a logo. */
  @font-face { font-family: "Instrument Sans Variable"; src: url("/font-head.woff2") format("woff2"); font-weight: 100 900; }
  @font-face { font-family: "Inter Variable"; src: url("/font-body.woff2") format("woff2"); font-weight: 100 900; }
  @font-face { font-family: "JetBrains Mono"; src: url("/font-mono.woff2") format("woff2"); font-weight: 400 700; }
  .card {
    position: absolute; inset: 0; display: flex; flex-direction: column;
    padding: 72px 84px; color: #FFFFFF;
    font-family: "Inter Variable", system-ui, sans-serif; -webkit-font-smoothing: antialiased;
  }
  .spacer { flex: 1; }
  .eyebrow {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 17px; letter-spacing: .18em; text-transform: uppercase; color: #B4B8BD;
  }
  h1 {
    font-family: "Instrument Sans Variable", system-ui, sans-serif;
    font-size: 64px; line-height: 1.08; font-weight: 600; letter-spacing: -.025em;
    max-width: 19ch; text-wrap: balance; text-shadow: 0 2px 30px rgba(0,0,0,.55);
  }
  .foot { display: flex; align-items: center; gap: 16px; margin-top: 34px; }
  .foot img { width: 46px; height: 46px; display: block; }
  .word {
    font-family: "Instrument Sans Variable", system-ui, sans-serif;
    font-size: 30px; font-weight: 600; letter-spacing: -.02em;
  }
  .host { margin-left: auto; font-size: 19px; color: #8A8F94; }
  .rule { position: absolute; left: 0; right: 0; bottom: 0; height: 6px; background: #0070F4; }
</style></head>
<body><div id="stage"><canvas id="c"></canvas>${scrim}</div>
<script type="application/json" id="cfg">${JSON.stringify(config)}</script>
<script type="module">
  import { NeatGradient } from "/neat.js";
  const canvas = document.querySelector("#c");
  const gradient = new NeatGradient({
      ref: canvas,
      ...JSON.parse(document.querySelector("#cfg").textContent)
  });
  // Fonts first, so the card is not captured in the fallback face. Then, since
  // speed 0 freezes the shader clock and the ribbon is drawn once and holds,
  // two frames: the first sizes the drawing buffer from the canvas's laid-out
  // box, the second draws into it at that size.
  await document.fonts.ready;
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__ready = true; }));
</script>
</body></html>`;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

const args = process.argv.slice(2);
const force = args.includes("--force");
// Guarded, because `indexOf` returns -1 when the flag is absent and `args[0]`
// is then whatever else was passed: a bare `--force` set `only` to "--force"
// and filtered every post out. The empty-run check below is what caught it.
const onlyAt = args.indexOf("--only");
const only = onlyAt === -1 ? null : args[onlyAt + 1];

const files = (await readdir(POSTS)).filter((f) => f.endsWith(".md") || f.endsWith(".mdx"));
const posts = [];
for (const file of files) {
    const slug = file.replace(/\.mdx?$/, "");
    if (only && slug !== only) continue;
    const data = frontmatter(await readFile(path.join(POSTS, file), "utf8"));
    if (!data?.title) {
        console.warn(`! ${file}: no title in frontmatter, skipped`);
        continue;
    }
    // A parked post gets no artwork: it has no URL to share and may never.
    if (data.draft === "true") continue;
    posts.push({ slug, title: data.title, pubDate: data.pubDate });
}
posts.sort((a, b) => a.slug.localeCompare(b.slug));

if (!posts.length) {
    console.error("No posts found — refusing to report success over an empty run.");
    process.exit(1);
}

/**
 * `--check`: every publishable post has both files, and nothing else.
 *
 * Needs no browser and no build, so it can run in any pipeline. Without it the
 * failure mode is silent and remote: a post is written, merged, published on
 * its `pubDate` by a scheduled build nobody is watching, and the hero and the
 * social card are both 404s — visible to every reader and to nobody on the
 * team, because the page itself renders fine.
 */
if (args.includes("--check")) {
    const missing = [];
    for (const post of posts) {
        const file = path.join(OUT_OG, `${post.slug}.png`);
        if (!existsSync(file)) missing.push(path.relative(SITE, file));
    }
    if (missing.length) {
        console.error(`✗ ${missing.length} blog image(s) missing:`);
        for (const m of missing) console.error(`  ${m}`);
        console.error("\nRun: node website/scripts/generate_blog_images.mjs");
        process.exit(1);
    }
    console.log(`✓ All ${posts.length} post(s) have artwork and a social card.`);
    process.exit(0);
}

await mkdir(OUT_ART, { recursive: true });
await mkdir(OUT_OG, { recursive: true });

// What the card page may fetch: the shader, and the site's type and mark.
const STATIC = {
    "/neat.js": [NEAT, "text/javascript"],
    "/logo.svg": [path.join(SITE, "public", "img", "rebase_logo.svg"), "image/svg+xml"],
    "/font-head.woff2": [
        require.resolve("@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2", { paths: [SITE] }),
        "font/woff2",
    ],
    "/font-body.woff2": [
        require.resolve("@fontsource-variable/inter/files/inter-latin-wght-normal.woff2", { paths: [SITE] }),
        "font/woff2",
    ],
    "/font-mono.woff2": [path.join(SITE, "public", "fonts", "jetbrains-mono-latin.woff2"), "font/woff2"],
};
const server = createServer(async (req, res) => {
    const hit = STATIC[req.url.split("?")[0]];
    if (!hit) { res.statusCode = 404; res.end(""); return; }
    res.setHeader("content-type", hit[1]);
    res.end(await readFile(hit[0]));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://localhost:${server.address().port}`;

// Playwright's own Chromium is a `playwright install` away, which a checkout
// that never runs the browser tests does not have. Fall back to the Chrome on
// the machine, the same escape hatch `generate_og_images.mjs` offers.
const channel = process.env.OG_CHROME_CHANNEL ?? "chrome";
const browser = await chromium.launch({
    channel,
    // SwiftShader, so this renders the same on a CI box with no GPU as it does
    // on a laptop. A hardware renderer would produce different pixels per
    // machine and make every re-run a diff.
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
});

let written = 0;
let skipped = 0;
const failures = [];

/**
 * One frame: open a page, wait for the ribbon, encode it, measure it.
 *
 * Returns `null` rather than throwing when the gradient never draws, because
 * the caller renders the same post at several seats and one bad seat is not a
 * reason to abandon the post. A run where *every* seat returns null is the
 * failure, and the caller reports that.
 *
 * The smoke test lives here — luminance range and chroma barely above a flat
 * fill — and it is deliberately not the quality bar. This one answers "did the
 * shader run at all"; the caller decides whether the frame is worth keeping.
 */
async function renderOnce({ config, width, height, card, type, quality }) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    try {
        await page.route(`${origin}/render`, (route) =>
            route.fulfill({ contentType: "text/html", body: pageHtml({ config, width, height, card } ) })
        );
        await page.goto(`${origin}/render`, { waitUntil: "load" });
        try {
            await page.waitForFunction(() => window.__ready === true, { timeout: 30000 });
        } catch {
            return null;
        }
        const buffer = await page.screenshot(
            type === "jpeg" ? { type: "jpeg", quality } : { type: "png" }
        );
        const stats = await page.evaluate(
            IMAGE_STATS,
            `data:image/${type};base64,${buffer.toString("base64")}`
        );
        if (stats.range < 25 || stats.chroma < 8) return null;
        return { buffer, stats };
    } finally {
        await page.close();
    }
}

for (const post of posts) {
    const ogFile = path.join(OUT_OG, `${post.slug}.png`);
    if (!force && existsSync(ogFile)) {
        skipped++;
        continue;
    }

    const eyebrow = post.pubDate
        ? new Date(post.pubDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
        : "Blog";

    // ── Pick the seat by looking at the picture ───────────────────────────
    //
    // The orbit alone gives a *reproducible* frame, not a good one. Two of the
    // first six were poor in different ways: one seated the camera far enough
    // back that the ribbon was a shard in the corner of a black rectangle, and
    // one landed on a stretch of the texture where every band is a muted brown.
    // Both scored fine on "did the shader run", because that question cannot
    // tell a composition from an accident.
    //
    // So the orbit proposes and the image disposes: render, measure, and if the
    // frame is mostly void or nearly grey, step to the next seat and look
    // again. The step is the golden ratio, which walks the unit interval
    // without revisiting and without falling into step with the periodic terms
    // in `poseFor` — a step of 0.1 puts the fourth attempt back near the first
    // on the two double-frequency terms.
    //
    // It stays a pure function of the slug: same post, same sequence of seats,
    // same winner, same bytes. And if no seat clears the bar, the best one seen
    // is used rather than failing — the bar is a preference, and a post with no
    // artwork is worse than a post with dim artwork.
    const GOLDEN = 0.6180339887;
    const MAX_SEATS = 8;
    const WANT = { ink: 0.34, chroma: 26 };

    let pose = null;
    let best = null;
    for (let seat = 0; seat < MAX_SEATS; seat++) {
        const candidate = poseFor(post.slug, seat * GOLDEN);
        const probe = await renderOnce({
            config: { ...BASE, ...candidate },
            ...ART,
            card: null,
            type: "jpeg",
            quality: ART_QUALITY,
        });
        if (!probe) continue;
        const score = probe.stats.ink + probe.stats.chroma / 200;
        if (!best || score > best.score) best = { ...probe, pose: candidate, score, seat };
        if (probe.stats.ink >= WANT.ink && probe.stats.chroma >= WANT.chroma) {
            best = { ...probe, pose: candidate, score, seat };
            break;
        }
    }

    if (!best) {
        failures.push(`${post.slug}: no seat rendered at all`);
        continue;
    }
    pose = best.pose;
    if (best.stats.ink < WANT.ink || best.stats.chroma < WANT.chroma) {
        console.log(
            `  ~ ${post.slug}: no seat cleared the bar in ${MAX_SEATS}; ` +
            `using the best (ink ${(best.stats.ink * 100).toFixed(0)}%, chroma ${best.stats.chroma.toFixed(0)})`
        );
    }

    const card = await renderOnce({
        config: { ...BASE, ...pose },
        ...OG,
        card: { eyebrow, title: post.title },
        type: "png",
    });
    if (!card) {
        failures.push(`${post.slug}: the social card did not render`);
        continue;
    }
    await writeFile(ogFile, card.buffer);
    written++;

    console.log(`✓ ${post.slug}  (seat ${best.seat}, ink ${(best.stats.ink * 100).toFixed(0)}%)`);
}

await browser.close();
server.close();

if (failures.length) {
    console.error(`\n✗ ${failures.length} render(s) failed:`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
}

console.log(
    `\n${written} image(s) written, ${skipped} post(s) already had artwork.` +
    `\nIn website/public/img/blog/. Commit them.`
);

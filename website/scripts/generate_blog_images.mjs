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
 * Two files per post, because they are read at different sizes for different
 * reasons:
 *
 *  - `img/blog/<slug>.jpg` — 1600×800, no text. The hero above the title on
 *    the post page, and the card thumbnail on /blog. Text here would be the
 *    headline twice, six lines apart.
 *  - `img/blog/og/<slug>.png` — 1200×630, the same gradient with the title
 *    burned in behind a scrim. A social crawler renders no WebGL and reads no
 *    HTML, so this half has to be pixels.
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
const NEAT = require.resolve("@firecms/neat/dist/index.es.js", { paths: [SITE] });

/**
 * The licence is domain-locked to rebase.pro, and `@firecms/neat` accepts
 * `localhost` alongside it — which is why this serves the page over HTTP rather
 * than opening a `file://` URL. The check also runs through `crypto.subtle`,
 * and Web Crypto is only exposed in a secure context: `file://` is not one, so
 * a file URL fails the licence check and renders a watermark over every card.
 */
const LICENSE_KEY =
    "NEAT-eyJkb21haW4iOiJyZWJhc2UucHJvIiwiZW1haWwiOiJmcmFuY2VzY29AZmlyZWNtcy5jbyIsImlhdCI6MTc4MTQ4MTE5NX0.0gblm3vGqyk_e9WJ8OTO5SHQ8qF8HmgJQkt_qElKskW5YqOiHPc24ppKmpI6utufEtqbyJ58Vt_uAB2HNtprFQ";

const ART = { width: 1600, height: 800 };
const OG = { width: 1200, height: 630 };
// The hero is served from our own pages at 1600px wide, where a lossless
// gradient is megabytes and a quality-92 JPEG is ~60KB with nothing visible
// lost. The OG card stays PNG: it carries type, and JPEG rings around 68px
// letterforms.
const ART_QUALITY = 92;

/**
 * The gradient, minus the seat it is viewed from.
 *
 * Lifted from `NeatBackground.tsx` so the artwork is the same material as the
 * site's own backgrounds, with three deliberate departures:
 *
 *  - `resolution` is 0.11, near the site's 0.05 and nowhere near 1.
 *
 *    This field is misleadingly named: its setter calls `_updateGeometry()`, so
 *    it is the ribbon's **mesh subdivision**, not a render scale. That makes it
 *    the single control over whether the artwork is angular or curvy, and the
 *    site is angular. A dense mesh (0.45) bends the ribbon into smooth organic
 *    curves that look nothing like the rest of the site; a coarse one leaves
 *    large flat facets with hard straight edges, which — with `flatShading` —
 *    is the faceted look every page background already has.
 *
 *    Too coarse is its own failure: past about 0.05 the frame is two or three
 *    enormous slabs, and zooming in at that mesh magnifies slabs rather than
 *    revealing detail. 0.11 is where a frame holds a dozen or so facets.
 *  - `backgroundAlpha` is 1 against the site's 0, because a PNG has nothing
 *    behind it to composite onto. `backgroundColor` is the site's own ground.
 *  - `colorBrightness` is raised. On the site the canvas sits at `opacity:
 *    0.55` over a dark page; here it is the whole image and 0.25 renders as
 *    near-black.
 *
 * `textureBandDensity: 0.1` is the site's value and is doing most of the work:
 * it is what makes the ribbon read as broad planes of colour rather than fine
 * stripes, which is the difference between artwork and a test pattern.
 */
const BASE = {
    licenseKey: LICENSE_KEY,
    colors: [
        { color: "#FB5066", enabled: true },
        { color: "#36CCD6", enabled: true },
        { color: "#FFC600", enabled: true },
        { color: "#8B6AE6", enabled: true },
        { color: "#2E0EC7", enabled: true },
        { color: "#FF9A9E", enabled: true },
    ],
    speed: 0,
    horizontalPressure: 3,
    verticalPressure: 3,
    waveFrequencyX: 3,
    waveFrequencyY: 5,
    waveAmplitude: 10,
    shadows: 2,
    highlights: 6,
    // Brighter and more saturated than the site's 0.25/1. On the site the
    // canvas sits at `opacity: 0.55` over a dark page; here it is the whole
    // image. Brightness alone washes the palette toward pastel orange, so the
    // saturation comes up with it to keep the reds, cyans and violets reading
    // as themselves.
    colorBrightness: 0.85,
    colorSaturation: 1.2,
    wireframe: false,
    colorBlending: 3,
    backgroundColor: "#0b0d12",
    backgroundAlpha: 1,
    grainScale: 0,
    grainSparsity: 0,
    grainIntensity: 0,
    grainSpeed: 2.4,
    resolution: 0.11,
    yOffsetWaveMultiplier: 7.2,
    yOffsetColorMultiplier: 6.8,
    yOffsetFlowMultiplier: 7.7,
    flowDistortionA: 0.4,
    flowDistortionB: 2.6,
    flowScale: 1.9,
    flowEase: 0.94,
    flowEnabled: true,
    enableProceduralTexture: true,
    transparentTextureVoid: false,
    textureVoidLikelihood: 0.59,
    textureVoidWidthMin: 120,
    textureVoidWidthMax: 330,
    // The site's value, and it survives the coarse mesh: 0.1 paints each facet
    // as a broad plane of colour. Raising it to 0.4 threads thin stripes across
    // the facets, which fights the geometry and reads as busy rather than bold.
    textureBandDensity: 0.1,
    textureColorBlending: 0,
    textureEase: 0.86,
    textureShapeTriangles: 51,
    textureShapeCircles: 0,
    textureShapeBars: 15,
    textureShapeSquiggles: 0,
    proceduralBackgroundColor: "#000000",
    domainWarpEnabled: false,
    vignetteIntensity: 0,
    fresnelEnabled: false,
    iridescenceEnabled: false,
    bloomIntensity: 0,
    chromaticAberration: 0,
    shapeType: "ribbon",
    shapeRotationX: 0,
    shapeRotationY: 0,
    shapeRotationZ: 0,
    cameraZ: 0,
    cameraRotationZ: 0,
    cameraLock: false,
    silhouetteFade: 0,
    // NOT 0, which is what `NeatBackground.tsx` carries. On a "ribbon" shape a
    // `ribbonFade` of exactly 0 renders nothing at all — the canvas comes back
    // as a flat fill of `backgroundColor`, with no error and no warning. 0.001
    // renders; 0.08 is the value the site uses for the cylinder shape and looks
    // right here. This cost an hour, and it is the reason the guard below
    // measures pixels instead of trusting the run to have worked.
    ribbonFade: 0.08,
    flatShading: true,
};

/**
 * FNV-1a, the same hash `NeatBackground.tsx` uses on pathnames.
 *
 * Any stable hash would do. This one spreads short, near-identical keys — and
 * blog slugs are the extreme case, since they all start with a date in the same
 * year — instead of clustering them at one seat.
 */
function hash01(key) {
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967296;
}

const TAU = Math.PI * 2;

/**
 * A seat on a closed orbit, one per slug.
 *
 * Every term rides at its own frequency and phase so two posts that land near
 * each other on the camera still separate on the twist, the bend or the texture
 * — the same trick as the site's hero orbit, for the same reason: a table of
 * hand-picked poses has to be extended whenever a post is written, and goes
 * stale silently when one is renamed.
 *
 * The ranges are the ones that still read as the same composition. They were
 * chosen by rendering the four quadrants and looking, not by guessing:
 *
 *  - `cameraZoom` below ~4 walks the camera far enough back that the ribbon
 *    stops filling the frame and leaves a flat black third along the bottom.
 *    Above ~7 the bands magnify past the point where the ribbon is legible as
 *    a surface, and the result reads as a candy stripe.
 *  - `cameraY` past about -7 lifts the ribbon out of frame entirely.
 *  - `textureSeed` is the strongest term of the lot — it redraws the colour
 *    banding wholesale — so it gets the widest range and its own frequency.
 */
function poseFor(slug, offset = 0) {
    // The offset walks the same orbit rather than perturbing the terms, so a
    // later seat is as composed as the first — it is a different chair in the
    // same room, not the first chair nudged.
    const t = (hash01(slug) + offset) % 1;
    return {
        cameraX: 4 * Math.sin(TAU * t),
        cameraY: -3 + 2.6 * Math.cos(TAU * t + 0.9),
        cameraRotationX: 0.46 + 0.15 * Math.sin(TAU * 2 * t),
        cameraRotationY: 0.34 + 0.16 * Math.cos(TAU * t + 1.7),
        cameraZoom: 5.5 + 1.4 * Math.sin(TAU * t + 2.4),
        planeBend: 0.15 + 0.34 * Math.sin(TAU * t + 2.1),
        planeTwist: 0.7 + 0.32 * Math.cos(TAU * 2 * t + 0.7),
        yOffset: 140 * Math.sin(TAU * t + 3.4),
        textureSeed: Math.floor(1 + 997 * hash01(`${slug}#texture`)),
    };
}

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
             <div class="foot"><div class="mark"></div><div class="word">Rebase</div><div class="host">rebase.pro</div></div>
           </div>`
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
  .card {
    position: absolute; inset: 0; display: flex; flex-direction: column;
    padding: 76px 80px; color: #f5f7fa;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
  }
  .spacer { flex: 1; }
  .eyebrow {
    font-size: 24px; font-weight: 600; letter-spacing: .14em;
    text-transform: uppercase; color: #b9c0d0;
  }
  h1 {
    font-size: 68px; line-height: 1.07; font-weight: 700; letter-spacing: -.026em;
    max-width: 19ch; text-wrap: balance; text-shadow: 0 2px 30px rgba(0,0,0,.55);
  }
  .foot { display: flex; align-items: center; gap: 16px; margin-top: 34px; }
  .mark { width: 42px; height: 42px; border-radius: 11px; background: linear-gradient(135deg, #6366f1, #22d3ee); }
  .word { font-size: 30px; font-weight: 650; letter-spacing: -.012em; }
  .host { margin-left: auto; font-size: 24px; color: #b9c0d0; }
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
  // speed 0 freezes the shader clock, so the ribbon is drawn once and holds.
  // Two frames are still needed: the first sizes the drawing buffer from the
  // canvas's laid-out box, the second draws into it at that size.
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__ready = true; }));
</script>
</body></html>`;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/**
 * Does the image we are about to commit actually have a gradient on it?
 *
 * Every way this can fail — a WebGL context the sandbox refuses, a licence that
 * does not validate, a pose that walks the camera off the end of the ribbon —
 * fails to a flat fill rather than to an exception, and a committed 1600×800
 * rectangle of #0b0d12 looks exactly like a successful run in the console.
 *
 * This measures the **screenshot**, not the canvas. The obvious version reads
 * the drawing buffer back with `gl.readPixels`, and it reports every good
 * render as flat: the buffer is cleared once the frame is composited, and
 * anything running after that reads zeroes, which is precisely the "guard that
 * cannot tell success from failure" this exists to prevent. Measuring the
 * encoded output is also the stronger question — it covers the scrim and the
 * type, so it fails if the card renders as a black slab for any reason at all,
 * not only a WebGL one.
 */
const IMAGE_STATS = async (dataUrl) => {
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    let min = 255;
    let max = 0;
    let chroma = 0;
    let ink = 0;
    let n = 0;
    // Every 37th pixel: coprime with the row width, so the walk crosses columns
    // instead of sampling one stripe down the image.
    for (let i = 0; i < bitmap.width * bitmap.height; i += 37) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (lum < min) min = lum;
        if (lum > max) max = lum;
        chroma += Math.max(r, g, b) - Math.min(r, g, b);
        // "Ink" is a pixel the ribbon actually covers, as opposed to the void
        // behind it. The ground is #0b0d12 — luminance about 12 — so anything
        // above 26 is paint. This is the number that separates a composition
        // from a black rectangle with a shard in one corner, and neither the
        // luminance range nor the mean chroma can see the difference: one bright
        // corner satisfies both.
        if (lum > 26) ink++;
        n++;
    }
    return { ok: true, range: max - min, chroma: chroma / n, ink: ink / n };
};

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
        for (const file of [path.join(OUT_ART, `${post.slug}.jpg`), path.join(OUT_OG, `${post.slug}.png`)]) {
            if (!existsSync(file)) missing.push(path.relative(SITE, file));
        }
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

const server = createServer(async (req, res) => {
    if (req.url.startsWith("/neat.js")) {
        res.setHeader("content-type", "text/javascript");
        res.end(await readFile(NEAT));
        return;
    }
    res.statusCode = 404;
    res.end("");
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
    const artFile = path.join(OUT_ART, `${post.slug}.jpg`);
    const ogFile = path.join(OUT_OG, `${post.slug}.png`);
    if (!force && existsSync(artFile) && existsSync(ogFile)) {
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
    await writeFile(artFile, best.buffer);
    written++;

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

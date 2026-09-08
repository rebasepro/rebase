/**
 * Render the per-page Open Graph images.
 *
 * Every route shared the same `teaser.png`, so a link to /pricing, /docs and
 * /rls-check all previewed identically — the one place a reader decides whether
 * to click, saying nothing about what they would be clicking.
 *
 * The card is the site's own material: the Neat ribbon `NeatBackground.tsx`
 * draws behind every page (config shared with the blog artwork through
 * `og/neat.mjs`), Instrument Sans for the display line and Inter for the rest —
 * the same files `Layout.astro` ships — and the actual logo. Until 2026-09-09
 * this file drew a system font over two radial gradients with a blue square
 * for a mark, which is not what the site looks like.
 *
 * The images are **committed**, not built on demand: they change a few times a
 * year, `astro build` should not depend on a browser, and a preview that fails
 * to generate must not be able to fail a deploy. Re-run this by hand after
 * editing `CARDS` below:
 *
 *     node website/scripts/generate_og_images.mjs
 *
 * Playwright renders them because the alternative — hand-authoring SVG — puts
 * text layout in a file nobody can see the result of, and OG images are read at
 * 1200×630 in a preview card where a single wrapped line is the difference
 * between legible and not.
 */
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
// The same derivation the llms.txt generator and the count gate use. A number
// baked into a PNG is the hardest kind to notice going stale: this card kept
// the previous count for as long as nobody re-rendered it.
import { countPackageChecks } from "../../tooling/scripts/docs-verify/check-rls-check-count.mjs";
import { BASE, poseFor, hash01, IMAGE_STATS, NEAT, CHROMIUM_ARGS } from "./og/neat.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, "..");
const OUT = path.join(SITE, "public", "img", "og");
// `@playwright/test` is the dependency this repo declares; `playwright` is its
// peer and is not always hoisted where a bare specifier from `website/` can see
// it. Resolving through the test package works in both layouts.
const require = createRequire(path.join(SITE, "package.json"));
const { chromium } = require("@playwright/test");

const RLS_CHECK_COUNT = countPackageChecks(path.resolve(SITE, ".."));
if (!RLS_CHECK_COUNT) {
    throw new Error(
        "Could not read the rls-check CHECKS array — refusing to render a count into a card."
    );
}

/**
 * One card per route worth sharing.
 *
 * `eyebrow` is the section, `title` the thing itself, `sub` the one line that
 * makes it worth a click. Kept short deliberately: a preview card crops, and
 * every platform crops differently.
 */
const CARDS = [
    {
        slug: "home",
        eyebrow: "Open source · MIT",
        title: "The backend that can't forget a permission check",
        sub: "Access rules compiled into Postgres row‑level security. Open source, on the Postgres you already have."
    },
    {
        slug: "docs",
        eyebrow: "Documentation",
        title: "Build on Rebase",
        sub: "Quickstart, collections, row-level security, deployment — in six languages."
    },
    {
        slug: "pricing",
        eyebrow: "Pricing",
        title: "The framework is free. Always.",
        sub: "MIT-licensed and self-hostable. Rebase Cloud runs it for you."
    },
    {
        slug: "rls-check",
        eyebrow: "Free tool",
        // Not the command as the title: `@rebasepro/rls-check` has no break
        // opportunity and wrapped mid-word at this size.
        title: "Find the tables anyone can read",
        // The command as the tool documents it: it reads `DATABASE_URL` from the
        // environment. Spelling `$DATABASE_URL` on a shared card teaches people
        // to put a connection string with a password into their shell history.
        sub: `npx @rebasepro/rls-check — ${RLS_CHECK_COUNT} checks, no signup.`
    },
    {
        slug: "backend",
        eyebrow: "Backend",
        title: "Postgres, with the boring parts done",
        sub: "Auth, storage, realtime, backups and a typed SDK generated from your schema."
    },
    {
        slug: "compare",
        eyebrow: "Compare",
        title: "Rebase vs the alternatives",
        sub: "Where it fits against Supabase, Firebase, Payload, Directus and Hasura."
    },
    {
        slug: "blog",
        eyebrow: "Blog",
        title: "Notes from building Rebase",
        sub: "What we shipped, what broke, and what it taught us."
    }
];

/** The one-line command a card can carry in its footer, where the page has one. */
const COMMANDS = {
    home: "pnpm dlx @rebasepro/cli init",
    "rls-check": "npx @rebasepro/rls-check",
};

// The fonts Layout.astro ships, straight from the same packages, so the card
// sets in the site's type and not in whatever the rendering machine has.
const FONT_HEAD = require.resolve(
    "@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2",
    { paths: [SITE] }
);
const FONT_BODY = require.resolve(
    "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
    { paths: [SITE] }
);
const FONT_MONO = path.join(SITE, "public", "fonts", "jetbrains-mono-latin.woff2");
const LOGO = path.join(SITE, "public", "img", "rebase_logo.svg");

const escapeHtml = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * The card. The ribbon fills the frame; a left-weighted scrim keeps the type
 * legible against whatever seat the orbit produced (the pose is a function of
 * the slug, so where the bright part lands is not knowable here). Ground,
 * weights and colours follow SITE-STORY §6 — #08090A, display at 600, body
 * grey #B4B8BD lifted a step because it sits on a scrim, the 6px brand rule.
 */
const html = ({ config, card }) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @font-face { font-family: "Instrument Sans Variable"; src: url("/font-head.woff2") format("woff2"); font-weight: 100 900; }
  @font-face { font-family: "Inter Variable"; src: url("/font-body.woff2") format("woff2"); font-weight: 100 900; }
  @font-face { font-family: "JetBrains Mono"; src: url("/font-mono.woff2") format("woff2"); font-weight: 400 700; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; overflow: hidden; background: #08090A; }
  #stage { position: relative; width: 1200px; height: 630px; }
  canvas { display: block; width: 1200px; height: 630px; }
  .scrim {
    position: absolute; inset: 0;
    background:
      linear-gradient(100deg, rgba(8,9,10,.97) 0%, rgba(8,9,10,.90) 40%, rgba(8,9,10,.42) 66%, rgba(8,9,10,.10) 100%),
      linear-gradient(0deg, rgba(8,9,10,.62) 0%, rgba(8,9,10,0) 42%);
  }
  .page {
    position: absolute; inset: 0; padding: 68px 84px 66px;
    display: flex; flex-direction: column; justify-content: space-between;
    color: #FFFFFF; font-family: "Inter Variable", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .brand { display: flex; align-items: center; gap: 16px; }
  .brand img { width: 46px; height: 46px; display: block; }
  .brand span {
    font-family: "Instrument Sans Variable", system-ui, sans-serif;
    font-size: 30px; font-weight: 600; letter-spacing: -0.02em;
  }
  .eyebrow {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 17px; letter-spacing: .18em; text-transform: uppercase; color: #B4B8BD;
    margin-bottom: 22px;
  }
  h1 {
    font-family: "Instrument Sans Variable", system-ui, sans-serif;
    font-weight: 600; font-size: 64px; line-height: 1.08; letter-spacing: -0.025em;
    max-width: 700px; text-wrap: balance;
  }
  p.sub {
    margin-top: 24px; font-size: 25px; line-height: 1.44; color: #C9CDD3;
    max-width: 34ch; font-weight: 400;
  }
  .foot { display: flex; align-items: baseline; justify-content: space-between; font-size: 19px; color: #8A8F94; }
  .foot .cmd { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 18px; color: #A6ABB1; }
  .rule { position: absolute; left: 0; right: 0; bottom: 0; height: 6px; background: #0070F4; }
</style></head>
<body><div id="stage"><canvas id="c"></canvas>
  <div class="scrim"></div>
  <div class="page">
    <div class="brand"><img src="/logo.svg" alt=""><span>Rebase</span></div>
    <div>
      <div class="eyebrow">${escapeHtml(card.eyebrow)}</div>
      <h1>${escapeHtml(card.title)}</h1>
      <p class="sub">${escapeHtml(card.sub)}</p>
    </div>
    <div class="foot"><span>rebase.pro</span>${card.cmd ? `<span class="cmd">${escapeHtml(card.cmd)}</span>` : ""}</div>
  </div>
  <div class="rule"></div>
</div>
<script type="application/json" id="cfg">${JSON.stringify(config)}</script>
<script type="module">
  import { NeatGradient } from "/neat.js";
  new NeatGradient({ ref: document.querySelector("#c"), ...JSON.parse(document.querySelector("#cfg").textContent) });
  // Fonts first, so the screenshot is not taken in the fallback face; then two
  // frames, because the first sizes the drawing buffer and the second draws.
  await document.fonts.ready;
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__ready = true; }));
</script>
</body></html>`;

/** The bare ribbon, for choosing a seat: no scrim, no type, so the measurement is of the artwork. */
const probeHtml = ({ config }) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; } html, body { width: 1200px; height: 630px; overflow: hidden; background: #08090A; }
  canvas { display: block; width: 1200px; height: 630px; }
</style></head><body><canvas id="c"></canvas>
<script type="application/json" id="cfg">${JSON.stringify(config)}</script>
<script type="module">
  import { NeatGradient } from "/neat.js";
  new NeatGradient({ ref: document.querySelector("#c"), ...JSON.parse(document.querySelector("#cfg").textContent) });
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__ready = true; }));
</script></body></html>`;

await mkdir(OUT, { recursive: true });

// Served over HTTP, not file://, because the Neat licence is domain-locked and
// validates through Web Crypto, which only exists in a secure context —
// `localhost` is one, a file URL is not (see og/neat.mjs).
const STATIC = {
    "/neat.js": [NEAT, "text/javascript"],
    "/logo.svg": [LOGO, "image/svg+xml"],
    "/font-head.woff2": [FONT_HEAD, "font/woff2"],
    "/font-body.woff2": [FONT_BODY, "font/woff2"],
    "/font-mono.woff2": [FONT_MONO, "font/woff2"],
};
const server = createServer(async (req, res) => {
    const hit = STATIC[req.url.split("?")[0]];
    if (!hit) { res.statusCode = 404; res.end(""); return; }
    res.setHeader("content-type", hit[1]);
    res.end(await readFile(hit[0]));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://localhost:${server.address().port}`;

// Playwright's own Chromium by default; `OG_CHROME_CHANNEL=chrome` renders
// through the Chrome already on the machine when the bundled one is absent.
const browser = await chromium.launch({
    ...(process.env.OG_CHROME_CHANNEL ? { channel: process.env.OG_CHROME_CHANNEL } : {}),
    args: CHROMIUM_ARGS,
});

// `--only <slug>` re-renders one card; `OG_DEBUG=1` prints every seat it tried.
const onlyAt = process.argv.indexOf("--only");
const only = onlyAt === -1 ? null : process.argv[onlyAt + 1];
const debug = !!process.env.OG_DEBUG;

async function renderOnce(body) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    try {
        await page.route(`${origin}/render`, (route) => route.fulfill({ contentType: "text/html", body }));
        await page.goto(`${origin}/render`, { waitUntil: "load" });
        try {
            await page.waitForFunction(() => window.__ready === true, { timeout: 30000 });
        } catch {
            return { why: `timeout${pageErrors.length ? " · " + pageErrors.join(" | ") : ""}` };
        }
        const buffer = await page.screenshot({ type: "png" });
        const stats = await page.evaluate(IMAGE_STATS, `data:image/png;base64,${buffer.toString("base64")}`);
        if (stats.range < 25 || stats.chroma < 8) return { why: `flat ${JSON.stringify(stats)}` };
        return { buffer, stats };
    } finally {
        await page.close();
    }
}

// The orbit proposes and the image disposes — same procedure and thresholds as
// the blog artwork: step seats by the golden ratio until a frame has enough
// ink and colour, else keep the best seen. A pure function of the slug, so a
// re-run rewrites the same bytes.
const GOLDEN = 0.6180339887;
const MAX_SEATS = 8;
const WANT = { ink: 0.34, chroma: 26 };

const failures = [];
for (const card of CARDS) {
    if (only && card.slug !== only) continue;
    let best = null;
    for (let seat = 0; seat < MAX_SEATS; seat++) {
        // `poseFor` keys the texture seed on the slug alone, so a seed whose
        // texture is all void blanks every seat of the orbit — which is what
        // `og/home` did. Later seats redraw the texture too.
        const key = `og/${card.slug}`;
        const pose = {
            ...poseFor(key, seat * GOLDEN),
            ...(seat ? { textureSeed: Math.floor(1 + 997 * hash01(`${key}#texture#${seat}`)) } : {}),
        };
        const probe = await renderOnce(probeHtml({ config: { ...BASE, ...pose } }));
        if (debug) console.log(`  ${card.slug} seat ${seat}:`, probe?.stats ? JSON.stringify(probe.stats) : probe?.why ?? "?");
        if (!probe?.buffer) continue;
        const score = probe.stats.ink + probe.stats.chroma / 200;
        if (!best || score > best.score) best = { pose, score, stats: probe.stats, seat };
        if (probe.stats.ink >= WANT.ink && probe.stats.chroma >= WANT.chroma) break;
    }
    if (!best) {
        failures.push(`${card.slug}: the ribbon never rendered`);
        continue;
    }
    const final = await renderOnce(
        html({ config: { ...BASE, ...best.pose }, card: { ...card, cmd: COMMANDS[card.slug] } })
    );
    if (!final?.buffer) {
        failures.push(`${card.slug}: the card rendered flat`);
        continue;
    }
    await writeFile(path.join(OUT, `${card.slug}.png`), final.buffer);
    console.log(`✓ og/${card.slug}.png  (seat ${best.seat}, ink ${best.stats.ink.toFixed(2)}, chroma ${best.stats.chroma.toFixed(0)})`);
}

await browser.close();
server.close();

if (failures.length) {
    console.error(`\n✗ ${failures.length} card(s) not written:`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
}
console.log(`\n${CARDS.length} image(s) in website/public/img/og/. Commit them.`);

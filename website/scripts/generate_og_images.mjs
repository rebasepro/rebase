/**
 * Render the per-page Open Graph images.
 *
 * Every route shared the same `teaser.png`, so a link to /pricing, /docs and
 * /rls-check all previewed identically — the one place a reader decides whether
 * to click, saying nothing about what they would be clicking.
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
// `@playwright/test` is the dependency this repo declares; `playwright` is its
// peer and is not always hoisted where a bare specifier from `website/` can see
// it. Resolving through the test package works in both layouts.
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "..", "public", "img", "og");

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
        title: "The backend your Postgres deserves",
        sub: "REST, auth, storage, realtime and an admin panel over a database you own."
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
        sub: "npx @rebasepro/rls-check $DATABASE_URL — fourteen checks, no signup."
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

/** The card, as one self-contained page. Fonts are the system stack, so nothing loads. */
const html = ({ eyebrow, title, sub }) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; display: flex; flex-direction: column;
    justify-content: space-between; padding: 76px 80px;
    background: #0b0d12;
    background-image:
      radial-gradient(900px 500px at 78% -8%, rgba(99,102,241,.34), transparent 62%),
      radial-gradient(700px 460px at 6% 108%, rgba(16,185,129,.20), transparent 60%);
    color: #f5f7fa;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
  }
  .eyebrow {
    font-size: 24px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase;
    color: #8b93a7;
  }
  h1 {
    font-size: 78px; line-height: 1.06; font-weight: 700; letter-spacing: -.026em;
    max-width: 17ch;
  }
  p { font-size: 30px; line-height: 1.42; color: #b6bdcc; max-width: 30ch; margin-top: 26px; }
  .foot { display: flex; align-items: center; gap: 16px; }
  .mark {
    width: 42px; height: 42px; border-radius: 11px;
    background: linear-gradient(135deg, #6366f1, #22d3ee);
  }
  .word { font-size: 30px; font-weight: 650; letter-spacing: -.012em; }
  .host { margin-left: auto; font-size: 24px; color: #8b93a7; }
</style></head>
<body>
  <div><div class="eyebrow">${eyebrow}</div></div>
  <div><h1>${title}</h1><p>${sub}</p></div>
  <div class="foot">
    <div class="mark"></div><div class="word">Rebase</div>
    <div class="host">rebase.pro</div>
  </div>
</body></html>`;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });

for (const card of CARDS) {
    await page.setContent(html(card), { waitUntil: "load" });
    await page.screenshot({ path: path.join(OUT, `${card.slug}.png`) });
    console.log(`✓ og/${card.slug}.png`);
}

await browser.close();
console.log(`\n${CARDS.length} image(s) in website/public/img/og/. Commit them.`);

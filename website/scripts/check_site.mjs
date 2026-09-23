/**
 * Static gate over `dist/` — the checks no test was reading.
 *
 * SITE-STORY §7 records that each drifted fact "had drifted into two or more
 * versions across the site, because no gate reads prose". This reads the built
 * HTML, which is the only place the locale fan-out, the heading ladder and the
 * link graph actually exist. Run it after `astro build`.
 *
 * Every check here is one that fired on a real defect found on 2026-09-03.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const DIST = "dist";
if (!existsSync(DIST)) {
    console.error("dist/ not found — run `pnpm build` first.");
    process.exit(2);
}

/**
 * Every generated page, as a route string -> file path, and every emitted file
 * as its `dist`-relative path.
 *
 * The file set is what makes the link check honest. `existsSync(join(DIST, r))`
 * — what this used to ask — says `true` for a *directory*, so `/docs/deployment`
 * "resolved" for the eleven months it had sub-pages and no `index.html`, and
 * `0 failures` was printed over a 404 that was live on the home page. It is
 * also case-insensitive on macOS, so `/docs/ui/components/Card` passed here and
 * 404ed on the Linux host that serves the site.
 */
const pages = new Map();
const files = new Set();
(function walk(dir) {
    for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else {
            files.add(relative(DIST, p).split("\\").join("/"));
            if (e === "index.html") {
                const route = "/" + relative(DIST, dir).split("\\").join("/");
                pages.set(route === "/." ? "/" : route, p);
            }
        }
    }
})(DIST);

/* Marketing pages only. `/docs/**` is generated from the packages' AST and is
   gated by `pnpm verify:docs`; component reference pages legitimately share a
   title across locales because a component name is a proper noun.

   The link check is the exception: it runs over `linkPages` — every page in
   `dist` — because the site chrome a docs page renders (the logo, the language
   picker, the footer) is hand-written, is on 1100 pages nobody was reading, and
   is exactly where the dead `/it` and `/pt` logo links lived. */
const IGNORED = /^\/(?:[a-z]{2}\/)?(?:docs|pagefind|_astro|dev|404)(?:\/|$)/;
const linkPages = new Map(pages);
for (const r of [...pages.keys()]) if (IGNORED.test(r)) pages.delete(r);

const failures = [];
const fail = (route, check, detail) => failures.push({ route, check, detail });

/**
 * Routes that resolve: a page with an `index.html`, or a real *file* emitted at
 * that exact path. Both tests are exact-match against what the build wrote, so
 * a directory with no index and a link whose casing differs from the emitted
 * one both read as broken — which is what the host does with them.
 */
const resolves = (r, pageRoutes, fileSet) => {
    const route = r.replace(/\/$/, "") || "/";
    if (pageRoutes.has(route)) return true;
    return fileSet.has(route.replace(/^\//, ""));
};
const routeExists = (r) => resolves(r, linkPages, files);

/* Self-test. Each case is a defect this gate has shipped: a link to a directory
   with no `index.html`, and a link whose casing differs from the emitted path.
   It runs on every invocation because a link checker that has quietly stopped
   checking looks exactly like a site with no broken links. */
{
    const p = new Map([["/docs/ui/components/card", "x"]]);
    const f = new Set(["docs/ui/components/card/index.html", "llms.txt"]);
    const cases = [
        ["/docs/deployment", false, "a directory with no index.html is not a route"],
        ["/docs/ui/components/Card", false, "route casing must match the emitted path"],
        ["/docs/ui/components/card", true, "a real page resolves"],
        ["/docs/ui/components/card/", true, "a trailing slash resolves"],
        ["/llms.txt", true, "an emitted file resolves"],
        ["/LLMS.txt", false, "file casing must match too"],
    ];
    for (const [route, want, why] of cases) {
        if (resolves(route, p, f) !== want) {
            console.error(`check_site self-test failed: ${route} — ${why}`);
            process.exit(2);
        }
    }
}

/* SITE-STORY §2, the naming sheet. Only phrases that can ONLY be naming Rebase's
   own product: a competitor keeps its own name, and the tree legitimately says
   "Admin UI" about PocketBase's and Directus's products. A bare /\bAdmin UI\b/
   would fire on those and train everyone to ignore this check. */
const BANNED = [
    /\bRebase Admin\b/, /\bRebase admin (?:UI|panel|console)\b/i,
    /\bthe Rebase Studio\b/, /\badmin console\b/i, /\badmin scaffolding\b/i,
];

// 1. Internal links resolve, on every page in `dist`. The cookie banner
//    shipped 114 404s this way: a localised prefix on a route that exists only
//    at the root. The docs logo shipped 378 more, pointing at `/it` and `/pt`.
for (const [route, file] of [...linkPages].sort()) {
    const html = readFileSync(file, "utf8");
    const body = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
    for (const m of body.matchAll(/href="(\/[^"#?]*)/g)) {
        const href = m[1].replace(/\/$/, "") || "/";
        if (href.startsWith("/_astro") || href.startsWith("/pagefind")) continue;
        if (!routeExists(href)) fail(route, "broken-link", href);
    }
}

for (const [route, file] of [...pages].sort()) {
    const html = readFileSync(file, "utf8");
    const body = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");

    // 2. Exactly one <h1>. Two policy pages rendered their title in a <div>.
    const h1s = body.match(/<h1[\s>]/g) ?? [];
    if (h1s.length !== 1) fail(route, "h1-count", `${h1s.length} <h1>`);

    // 3. No skipped heading level in document order (h1 -> h3 is a skip).
    const levels = [...body.matchAll(/<h([1-6])[\s>]/g)].map((m) => +m[1]);
    for (let i = 1; i < levels.length; i++) {
        if (levels[i] > levels[i - 1] + 1)
            fail(route, "heading-skip", `h${levels[i - 1]} -> h${levels[i]}`);
    }

    // 4. SITE-STORY §6: meta titles are `<Page> — Rebase`, em dash.
    const title = body.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim();
    if (!title) fail(route, "meta-title", "missing");
    else if (!title.includes("—")) fail(route, "meta-title", title);

    // 5. §2 naming sheet.
    for (const re of BANNED) {
        const hit = body.match(re);
        if (hit) fail(route, "banned-term", hit[0]);
    }
}

/* 6. The locale fan-out: a string that is identical in every locale is a
      string that was never translated. Checked on the two strings every page
      sets deliberately and a search result shows: <title>, and the meta
      description — `/compare` hardcoded its description as an English literal
      while taking its title from the i18n file next to it, and shipped the
      same English sentence to German, Spanish and French readers.

      The three-word carve-out is the same on both: a short string is often a
      proper noun that is the same in every language. */
const META = [
    ["untranslated-title", /<title>([\s\S]*?)<\/title>/],
    ["untranslated-description", /<meta\s+name="description"\s+content="([^"]*)"/]
];
for (const [route, file] of pages) {
    if (!/^\/(es|de|fr)\//.test(route)) continue;
    // Pages kept out of the index are not localisation surfaces (`/pitch`).
    if (/noindex/i.test(readFileSync(file, "utf8"))) continue;
    const en = pages.get(route.replace(/^\/(es|de|fr)/, "") || "/");
    if (!en) continue;
    for (const [check, re] of META) {
        const read = (f) => readFileSync(f, "utf8").match(re)?.[1]?.trim();
        const got = read(file);
        if (got && got === read(en) && got.replace("— Rebase", "").trim().split(/\s+/).length > 2)
            fail(route, check, got);
    }
}

/* 7. Every English marketing route has a `.md` mirror.
      `[page].md.ts` derives its slug list from the routes, so this is the
      assertion that the derivation still sees them all — the hand-kept list it
      replaced was sixteen slugs against thirty-one routes, and `/pricing`,
      `/rls-check` and all eight comparison pages had no mirror at all. */
{
    const routeDir = new URL("../src/pages/[...lang]/", import.meta.url);
    const wanted = readdirSync(routeDir)
        .filter((f) => f.endsWith(".astro"))
        .map((f) => f.replace(/\.astro$/, ""));
    for (const slug of wanted) {
        if (!files.has(`${slug}.md`))
            fail(`/${slug}`, "missing-md-mirror", `${slug}.md is not in dist/`);
    }
    // `public/` is copied verbatim into `dist`, so a `.md` that came from there
    // (`sitemap.md`) is an asset, not a route mirror.
    const assets = new Set(
        readdirSync(new URL("../public/", import.meta.url)).filter((f) => f.endsWith(".md"))
    );
    for (const f of files) {
        const m = /^([a-z0-9-]+)\.md$/.exec(f);
        if (m && m[1] !== "index" && !assets.has(f) && !wanted.includes(m[1]))
            fail(`/${m[1]}`, "orphan-md-mirror", `${f} mirrors no route`);
    }
}

/* 8. Every localised marketing route declares its translations in the HTML,
      and no `noindex` page is in the sitemap.

      The docs emit six `<link rel="alternate">` per page and the marketing
      pages emitted none, so the signal existed only in `sitemap-0.xml` — the
      weaker of the two places — and the two halves of the site disagreed about
      the convention. `/pitch` had the opposite problem: `noindex, nofollow` in
      the page and four rows in the sitemap. */
{
    const marketingLocales = ["en", "es", "de", "fr"];
    const sitemapFiles = [...files].filter((f) => /^sitemap-\d+\.xml$/.test(f));
    const sitemap = sitemapFiles
        .map((f) => readFileSync(join(DIST, f), "utf8"))
        .join("");

    for (const [route, file] of pages) {
        const html = readFileSync(file, "utf8");
        const noindex = /content="noindex/i.test(html);
        const inSitemap = sitemap.includes(`<loc>https://rebase.pro${route === "/" ? "/" : route + "/"}</loc>`);

        if (noindex && inSitemap) fail(route, "noindex-in-sitemap", route);
        if (noindex) continue;

        // `/blog/**` and `/policy/**` are English-only routes: they have no
        // translation, and an alternate at `/de/blog/…` would be a 404 in an
        // index. A route is localised iff its Spanish twin was built.
        const english = route.replace(/^\/(es|de|fr)(?=\/|$)/, "") || "/";
        if (!pages.has(english === "/" ? "/es" : `/es${english}`)) continue;

        const alternates = new Set(
            [...html.matchAll(/rel="alternate"\s+hreflang="([^"]+)"/g)].map((m) => m[1])
        );
        const missing = [...marketingLocales, "x-default"].filter((l) => !alternates.has(l));
        if (missing.length) fail(route, "missing-hreflang", missing.join(", "));
    }
}

/* 9. Text a visitor reads that nobody wrote. All three shipped at once and were
      found by looking at the live site (2026-09-23), on every page:

      - An entity escaped twice (`&amp;rarr;`). An i18n value holding `&rarr;`
        or `&nbsp;`, rendered through `{t()}` rather than `set:html`, prints the
        entity: "How to fix it &rarr;" ×15 on /rls-check, "Deploy&nbsp;on…"
        on /security, "AI &AMP; AGENTS" on /ai.
      - A <summary> with no text. ComparisonFaq resolves i18n KEYS; /rls-check
        passed it sentences and shipped six blank FAQ rows (and an empty
        FAQPage schema).
      - A word glued to a link. Astro drops the line break between `{expr}` and
        a following `<a>`, so the cookie banner on every page read "you consent
        toour use of cookies". `{" "}` is the fix.

      Every page, docs included — the cookie banner and the chrome are on all
      of them. Code is exempt: a code sample may spell an entity on purpose. */
/** Every defect of the three kinds above in one page's HTML, as [check, detail]. */
function textDefects(html) {
    const text = html
        .replace(/<script[\s\S]*?<\/script>/g, "")
        .replace(/<style[\s\S]*?<\/style>/g, "")
        .replace(/<pre[\s\S]*?<\/pre>/g, "")
        .replace(/<code[\s\S]*?<\/code>/g, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        // Attribute values are not text: an island's `props` carries code
        // samples with their quotes escaped, `&amp;quot;` and all.
        .replace(/\s[\w:.@-]+="[^"]*"/g, "");
    const around = (i) => text.slice(Math.max(0, i - 40), i + 40).replace(/\s+/g, " ");
    const found = [];

    const entity = /&amp;(?:[a-zA-Z]{2,8}|#\d{2,5});/.exec(text);
    if (entity) found.push(["escaped-entity", around(entity.index)]);

    for (const m of text.matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>/g)) {
        if (!m[1].replace(/<[^>]+>/g, "").trim()) {
            found.push(["empty-summary", around(m.index)]);
            break;
        }
    }

    const glued = /[a-z]<a\b[^>]*>[a-z]|<\/a>[a-z]{2}/.exec(text);
    if (glued) found.push(["text-glued-to-link", around(glued.index)]);
    return found;
}

/* Self-test, for the same reason as the link one: each shipped defect must
   still be caught, and each look-alike that is fine must still pass. */
{
    const cases = [
        ['<a href="/x">How to fix it &amp;rarr;</a>', "escaped-entity"],
        ["<p>Deploy&amp;nbsp;on&amp;nbsp;Your&amp;nbsp;Terms</p>", "escaped-entity"],
        ['<summary class="flex"><span></span><svg viewBox="0 0 24 24"><path d="M12 5v14"/></svg></summary>', "empty-summary"],
        ['<p>you consent to<a href="/policy" target="_blank">our use of cookies</a>.</p>', "text-glued-to-link"],
        ['<astro-island props="{&quot;code&quot;:[0,&quot;variant=&amp;quot;{v}&amp;quot;&quot;]}"></astro-island>', null],
        ["<pre>&amp;rarr; is spelled like this</pre>", null],
        ['<summary><span>Is it safe?</span></summary>', null],
        ['<p>the <a href="/security">security page</a>s and <a href="/x">links</a>.</p>', null],
    ];
    for (const [html, want] of cases) {
        const got = textDefects(html).map(([check]) => check);
        if (want ? !got.includes(want) : got.length) {
            console.error(`check_site self-test failed: ${want ?? "no defect"} expected for ${html} — got ${got.join(", ") || "none"}`);
            process.exit(2);
        }
    }
}

for (const [route, file] of linkPages) {
    for (const [check, detail] of textDefects(readFileSync(file, "utf8"))) fail(route, check, detail);
}

const byCheck = {};
for (const f of failures) (byCheck[f.check] ??= []).push(f);

for (const [check, list] of Object.entries(byCheck)) {
    console.log(`\n${check}  (${list.length})`);
    const seen = new Set();
    for (const f of list) {
        const k = `${f.check}:${f.detail}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const n = list.filter((x) => x.detail === f.detail).length;
        console.log(`  ${f.detail}${n > 1 ? `  ×${n}` : ""}   e.g. ${f.route}`);
    }
}

console.log(
    `\n${failures.length} failures across ${pages.size} marketing pages ` +
        `(links checked on all ${linkPages.size}).`
);
process.exit(failures.length ? 1 : 0);

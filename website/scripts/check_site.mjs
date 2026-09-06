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
      string that was never translated. Only checked on <title>, which every
      page sets deliberately. */
for (const [route, file] of pages) {
    if (!/^\/(es|de|fr)\//.test(route)) continue;
    // Pages kept out of the index are not localisation surfaces (`/pitch`).
    if (/noindex/i.test(readFileSync(file, "utf8"))) continue;
    const en = pages.get(route.replace(/^\/(es|de|fr)/, "") || "/");
    if (!en) continue;
    const t = (f) => readFileSync(f, "utf8").match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim();
    const got = t(file);
    if (got && got === t(en) && got.replace("— Rebase", "").trim().split(/\s+/).length > 2)
        fail(route, "untranslated-title", got);
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

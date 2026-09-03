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

/** Every generated page, as a route string -> file path. */
const pages = new Map();
(function walk(dir) {
    for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (e === "index.html") {
            const route = "/" + relative(DIST, dir).split("\\").join("/");
            pages.set(route === "/." ? "/" : route, p);
        }
    }
})(DIST);

/* Marketing pages only. `/docs/**` is generated from the packages' AST and is
   gated by `pnpm verify:docs`; component reference pages legitimately share a
   title across locales because a component name is a proper noun. */
const IGNORED = /^\/(?:[a-z]{2}\/)?(?:docs|pagefind|_astro)(?:\/|$)/;
for (const r of [...pages.keys()]) if (IGNORED.test(r)) pages.delete(r);

const failures = [];
const fail = (route, check, detail) => failures.push({ route, check, detail });

/** Routes that resolve: every index.html, plus any real file in dist. */
const routeExists = (r) => {
    if (pages.has(r) || pages.has(r.replace(/\/$/, ""))) return true;
    const asFile = join(DIST, r.replace(/^\//, ""));
    return existsSync(asFile);
};

/* SITE-STORY §2: banned as a name for Rebase's own product. The carve-out is
   competitor copy in `alternatives.ts`, which keeps a competitor's own name. */
const BANNED = [/\bRebase Admin\b/, /\bAdmin UI\b/, /\badmin console\b/i, /\badmin scaffolding\b/i, /\bthe Rebase Studio\b/];

for (const [route, file] of [...pages].sort()) {
    const html = readFileSync(file, "utf8");
    const body = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");

    // 1. Internal links resolve. The cookie banner shipped 114 404s this way:
    //    a localised prefix on a route that exists only at the root.
    for (const m of body.matchAll(/href="(\/[^"#?]*)/g)) {
        const href = m[1].replace(/\/$/, "") || "/";
        if (href.startsWith("/_astro") || href.startsWith("/pagefind")) continue;
        if (!routeExists(href)) fail(route, "broken-link", href);
    }

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
    else if (!title.includes("—") && !/^Rebase\b/.test(title))
        fail(route, "meta-title", title);

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
    const en = pages.get(route.replace(/^\/(es|de|fr)/, "") || "/");
    if (!en) continue;
    const t = (f) => readFileSync(f, "utf8").match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim();
    if (t(file) && t(file) === t(en)) fail(route, "untranslated-title", t(file));
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

console.log(`\n${failures.length} failures across ${pages.size} pages.`);
process.exit(failures.length ? 1 : 0);

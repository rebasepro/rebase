/**
 * Source gate: no theme token may change what a stock Tailwind class does.
 *
 * Tailwind v4 builds functional utilities out of theme namespaces, so every
 * `--spacing-<name>` token mints `mt-<name>`, `w-<name>`, `inline-<name>` and
 * the rest. When `<name>` happens to complete the name of a STATIC utility,
 * Tailwind emits both rules under the one class. The home page's spacing scale
 * had a step called `block` until 2026-09-27, so `inline-block` meant
 * `display: inline-block` AND `inline-size: var(--spacing-block)` — 80px — on
 * every element that used it: 29 call sites, the pitch deck, the legal pages,
 * the docs. The first one anybody noticed was the typing caret in the home
 * page's SDK demo, drawn as a grey bar 80px wide, and the type tooltip beside
 * it crushed into an 80px column.
 *
 * Nothing about that is visible in a diff. The token looked like a spacing
 * decision and `inline-block` looked like `inline-block`. So this compiles
 * every class-like word the site's sources contain twice — against the site's
 * own stylesheet and against bare `tailwindcss` — and fails when a class the
 * site uses sets a property Tailwind's own version of that class does not.
 * Values may differ (that is what a theme is for); the set of properties may
 * not grow.
 *
 * Only rules whose whole selector is that one class are compared, so a scoped
 * restatement like `.ground-close .border-dashed` is left alone.
 *
 * Run: `node scripts/check_utilities.mjs` (pnpm check:utilities). No build
 * needed; it takes about a second.
 */
import { compile } from "tailwindcss";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createRequire } from "node:module";

const CSS = "src/styles/global.css";
/* The directories global.css's own `@source` lines point Tailwind at. */
const ROOTS = ["src", "../packages/ui/src", "../packages/app/src"];

const requireFrom = (dir) => createRequire(join(dir, "noop.js"));
const loadStylesheet = async (id, base) => {
    const path = id.startsWith(".") || id.startsWith("/")
        ? resolve(base, id)
        : id === "tailwindcss"
            ? requireFrom(base).resolve("tailwindcss/index.css")
            : requireFrom(base).resolve(id);
    return { path, base: dirname(path), content: readFileSync(path, "utf8") };
};
const loadModule = async (id, base) => {
    const path = requireFrom(base).resolve(id);
    const mod = await import(path);
    return { path, base: dirname(path), module: mod.default ?? mod };
};
const options = { base: resolve(dirname(CSS)), loadStylesheet, loadModule };

/* Over-collecting is harmless — a word that is not a class compiles to nothing
   in both passes — so this reads every word, not just `class=` attributes. */
const candidates = new Set();
function walk(dir) {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist") continue;
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(astro|tsx|ts|jsx|js|mdx|md|css|html)$/.test(entry)) {
            for (const m of readFileSync(path, "utf8").matchAll(/[!a-z@][a-z0-9:@/\-.\[\]#%_()]*/g)) {
                candidates.add(m[0]);
            }
        }
    }
}
for (const root of ROOTS) if (existsSync(root)) walk(root);

/* `.cls { a: 1; b: 2 }` → Map(".cls" → {a, b}). Custom properties are
   Tailwind's own plumbing (`--tw-*`) and are skipped. */
function propertiesBySelector(css) {
    const out = new Map();
    for (const [, selector, body] of css.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
        const s = selector.trim();
        if (!/^\.[^\s,:>+~]+$/.test(s)) continue;
        const props = out.get(s) ?? new Set();
        for (const decl of body.split(";")) {
            const prop = decl.split(":")[0].trim();
            if (prop && !prop.startsWith("--")) props.add(prop);
        }
        out.set(s, props);
    }
    return out;
}

const list = [...candidates];
const site = propertiesBySelector((await compile(readFileSync(CSS, "utf8"), options)).build(list));
const stock = propertiesBySelector((await compile(`@import "tailwindcss";`, options)).build(list));

const failures = [];
for (const [selector, stockProps] of stock) {
    const siteProps = site.get(selector);
    if (!siteProps) continue;
    const added = [...siteProps].filter((p) => !stockProps.has(p));
    if (added.length) failures.push({ selector, stockProps: [...stockProps], added });
}

if (failures.length) {
    console.error(`check:utilities — ${failures.length} stock Tailwind class(es) changed by the site's theme:\n`);
    for (const f of failures) {
        console.error(`  ${f.selector}`);
        console.error(`    Tailwind sets: ${f.stockProps.join(", ")}`);
        console.error(`    the site adds: ${f.added.join(", ")}`);
    }
    console.error(`\nA theme token's name completes a static utility's name (a spacing step called`);
    console.error(`\`block\` turns \`inline-block\` into a width). Rename the token in ${CSS}.`);
    process.exit(1);
}
console.log(`check:utilities — ${stock.size} stock classes compared, none changed by the theme.`);

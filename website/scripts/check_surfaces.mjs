/**
 * Source gate over the marketing site's grounds — the one check that would have
 * caught `--color-page-raised: #14161b`.
 *
 * The site shares `@rebasepro/ui`'s surface ladder (see the "Semantic surfaces"
 * block in ui/theme.css). It still has its own ground SCALE — base, raised, the
 * two chroma slabs — because "which kind of section is this" is a marketing
 * question the product has no opinion about. What it must not have again is its
 * own ground VALUES.
 *
 * Between 2026-08 and 2026-09-10 it did: two hand-picked hexes, `#08090a` and
 * `#14161b`, that belonged to no ladder. `#14161b` sits BETWEEN `--surface-sheet`
 * (#131313) and `--surface-card` (#181818) and is the one cool value in an
 * otherwise strictly neutral stack, so on a raised chapter every card header —
 * painted `bg-surface-sheet`, the same role the product's own tables use — came
 * out darker than the section it sat on. Cards were holes cut into their own
 * ground, which is the exact failure the surface system was written to end.
 *
 * Nobody saw it for six weeks because a hex in a token block looks like a
 * decision. So the rules below are about PROVENANCE, not about lightness: a
 * ground may only name a rung, and no surface may name a value below the
 * ladder's floor. Both are things a reviewer cannot eyeball and a diff hides.
 *
 * Run: `node scripts/check_surfaces.mjs` (pnpm check:surfaces). No build needed.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";

const ROOT = "src";
const CSS = "src/styles/global.css";
const LANDING = "src/pages/[...lang]/index.astro";

const failures = [];
const fail = (file, rule, detail) => failures.push({ file, rule, detail });

/* Every source file, so a banned class cannot hide in a component nobody greps. */
const sources = [];
(function walk(dir) {
    for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(astro|tsx|ts|jsx|js|mdx|css)$/.test(e)) sources.push(p);
    }
})(ROOT);

/* ── What "the landing page" means, as a set of files ─────────────────────────
   Rule 2 below is the one with teeth, and the rest of the site has not been
   through this pass yet — 240-odd `bg-surface-900/50` cards across the deep
   pages, the pitch deck and the docs mirrors, each of which needs looking at
   rather than sed-ing. Gating all of them today would mean either a red gate
   nobody can go green on or an ignore list that quietly grows.
   So the rule runs over the home route's actual import graph, walked from the
   entry rather than listed. A section moved onto the home page is covered the
   moment it is imported, and one moved off stops being this gate's business —
   neither needs anyone to remember to edit a list here. */
const EXT = ["", ".astro", ".tsx", ".ts", ".jsx", ".js"];
const landing = new Set();
(function follow(file) {
    const abs = resolve(file);
    if (landing.has(abs) || !existsSync(abs) || statSync(abs).isDirectory()) return;
    landing.add(abs);
    const src = readFileSync(abs, "utf8");
    for (const m of src.matchAll(/(?:^|\n)\s*import\s[^;'"]*['"](\.[^'"]+)['"]/g)) {
        for (const ext of EXT) {
            const cand = resolve(dirname(abs), m[1] + ext);
            if (existsSync(cand) && !statSync(cand).isDirectory()) { follow(cand); break; }
        }
    }
})(LANDING);

/* ── 1. The retired page-ground tokens stay retired ──────────────────────────
   `bg-page-ground` was the site-wide base ground and `--color-page-raised` the
   raised one. Both are gone; the roles are the declaration site now. A
   half-reverted merge that brings either back reintroduces the split scale
   silently, because both names still READ as correct. */
const RETIRED = [
    [/\bbg-page-(?:ground|raised)\b/, "use bg-surface-frame (base) or a ground utility"],
    [/--color-page-(?:ground|raised)\s*:/, "grounds come from --surface-* roles, not from a page token"],
];

/* ── 2. Nothing paints below the ladder's floor ──────────────────────────────
   `--color-surface-950` is #000000 and `surface-900` is #0a0a0a: the first is
   below every ground on the site and the second is level with the base one. As
   a BACKGROUND either makes the element a hole rather than a surface — which is
   how `.frame` spent six weeks darker than the section it sat in. They remain
   fine as borders, rings, shadows and gradient stops, so this matches the
   background utilities only. */
const HOLE = /\bbg-surface-9(?:00|50)(?:\/\d+)?\b/;

/* A comment may cite a banned name in prose — this file's own header does, and
   so does the block in global.css that records why the tokens were retired.
   Line-shape matching cannot tell those apart from code, so block state is
   tracked across the file rather than guessed per line. */
const stripComments = (src) => {
    const out = [];
    let block = null;                    // "/*" | "<!--" | null
    for (const line of src.split("\n")) {
        let rest = line, kept = "";
        while (rest) {
            if (block) {
                const close = rest.indexOf(block === "/*" ? "*/" : "-->");
                if (close === -1) { rest = ""; break; }
                rest = rest.slice(close + (block === "/*" ? 2 : 3));
                block = null;
                continue;
            }
            const b = rest.indexOf("/*"), h = rest.indexOf("<!--"), l = rest.indexOf("//");
            const next = [[b, "/*"], [h, "<!--"], [l, "//"]].filter(([i]) => i !== -1).sort((x, y) => x[0] - y[0])[0];
            if (!next) { kept += rest; break; }
            kept += rest.slice(0, next[0]);
            if (next[1] === "//") break;
            block = next[1];
            rest = rest.slice(next[0] + next[1].length);
        }
        out.push(kept);
    }
    return out;
};

for (const p of sources) {
    const rel = relative(".", p);
    const isLanding = landing.has(resolve(p));
    stripComments(readFileSync(p, "utf8")).forEach((line, i) => {
        for (const [re, hint] of RETIRED) {
            if (re.test(line)) fail(rel, "retired-token", `${i + 1}: ${hint}`);
        }
        if (isLanding && HOLE.test(line)) {
            fail(rel, "below-the-floor", `${i + 1}: ${line.match(HOLE)[0]} — a background must be a rung, not a hole`);
        }
    });
}

/* ── 3. A ground names a rung; it never spells a colour ──────────────────────
   The load-bearing rule. `--ground` and `--ground-lift` may resolve to a
   `--surface-*` role or to the chroma slab's own hue expression, and to nothing
   else. A literal hex here is a value that has left the ladder — exactly the
   shape of the defect this file is named after. */
const css = readFileSync(CSS, "utf8");
const cssLines = css.split("\n");
const GROUND_DECL = /^\s*(--ground(?:-lift)?)\s*:\s*(.+?);/;
const ALLOWED = /^(?:var\(--surface-[a-z-]+\)|var\(--hue\)|oklch\(from\s)/;

let groundsSeen = 0;
cssLines.forEach((line, i) => {
    const m = line.match(GROUND_DECL);
    if (!m) return;
    groundsSeen++;
    const [, name, value] = m;
    if (!ALLOWED.test(value.trim())) {
        fail(relative(".", CSS), "ground-is-not-a-rung",
            `${i + 1}: ${name}: ${value} — name a --surface-* role (or the slab's --hue), never a colour`);
    }
});
if (groundsSeen === 0) {
    fail(relative(".", CSS), "ground-is-not-a-rung", "no --ground declarations found — did the ground block move?");
}

/* ── 4. `.frame` lifts off whatever it landed on ─────────────────────────────
   The same `.frame` appears on the base ground, on a raised chapter and on a
   coral slab, so its colour cannot be a constant — that is what pinned every
   frame on the site to #000. It reads `--ground-lift`, and each ground states
   its own next rung. Asserting the declaration is what stops a future "just
   make it dark" from re-freezing it. */
if (!/@utility frame\s*\{[^}]*background:\s*var\(--ground-lift\)/s.test(css)) {
    fail(relative(".", CSS), "frame-lift",
        "`@utility frame` must paint var(--ground-lift) so a demo lifts off whichever ground it landed on");
}

/* ── 5. Every ground states its own next rung ────────────────────────────────
   A ground that sets `--ground` and forgets `--ground-lift` inherits the rung
   of the section around it, so cards on it land at the wrong step — silently,
   and only on that one section. */
const groundBlocks = [...css.matchAll(/(?:@utility\s+(ground-[a-z]+)|\.(ground-[a-z]+))\s*\{([^}]*)\}/g)];
for (const [, utilName, className, body] of groundBlocks) {
    const name = utilName || className;
    // `.ground-claim`/`.ground-close` are the two arms of `ground-chroma`, which
    // declares the lift for both; only a block that sets its own `--ground`
    // without inheriting one needs to answer for the rung.
    if (!/--ground\s*:/.test(body)) continue;
    if (/--ground-lift\s*:/.test(body)) continue;
    if (/^ground-(?:claim|close)$/.test(name)) continue;
    fail(relative(".", CSS), "ground-without-a-rung",
        `${name} sets --ground but no --ground-lift, so cards on it inherit the surrounding rung`);
}

const byRule = {};
for (const f of failures) (byRule[f.rule] ??= []).push(f);
for (const [rule, list] of Object.entries(byRule)) {
    console.log(`\n${rule} (${list.length})`);
    for (const f of list) console.log(`  ${f.file}  ${f.detail}`);
}
console.log(
    `\n${failures.length} failures — ${landing.size} landing-page files on the ladder rule, ` +
    `${sources.length} source files on the retired-token rule, ${groundsSeen} ground declarations.`,
);
process.exit(failures.length ? 1 : 0);

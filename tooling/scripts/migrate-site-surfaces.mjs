#!/usr/bin/env node
/**
 * Retarget the marketing site's hand-built admin mockups from numbered surface
 * tokens to the semantic roles in packages/ui/src/theme.css.
 *
 *   node tooling/scripts/migrate-site-surfaces.mjs website/src/components            # dry run
 *   node tooling/scripts/migrate-site-surfaces.mjs website/src/components --write    # apply
 *
 * The site is dark-only for product surfaces (`<html data-theme="dark">`), so
 * its demos wrote single dark tokens rather than light/dark pairs, and a few
 * old pairs copied from the panel. Unlike `migrate-surfaces.mjs`, which only
 * ever replaces whole pairs, this one has to decide what a lone `bg-surface-900`
 * IS — a card or a sheet — and it decides from the rest of the same class
 * string: a bordered, padded, rounded box is a card; anything else at that
 * value is a sheet region. The rules are listed once, in ORDER, and every
 * replacement is logged per file so a wrong guess is a one-line revert.
 *
 * Only class strings are touched: `class="…"`, `className="…"`, and any quoted
 * string inside `cls(` / `className={` / template literals is left alone
 * unless it is a plain quoted string, so JS that builds class names by hand is
 * not rewritten under it.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

const args = process.argv.slice(2);
const write = args.includes("--write");
const roots = args.filter((a) => !a.startsWith("--"));
if (roots.length === 0) {
    console.error("usage: migrate-site-surfaces.mjs <dir...> [--write]");
    process.exit(1);
}

const EXTS = new Set([".tsx", ".astro"]);
const SKIP = /\/(docs|starlight|node_modules)\//;

function walk(dir, out = []) {
    // A root may be a single file, so a section next to the demos folder can be
    // named on the command line without pulling in the whole marketing site.
    if (statSync(dir).isFile()) {
        if (EXTS.has(extname(dir))) out.push(dir);
        return out;
    }
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (SKIP.test(p + "/")) continue;
        const st = statSync(p);
        if (st.isDirectory()) walk(p, out);
        else if (EXTS.has(extname(name))) out.push(p);
    }
    return out;
}

/** Whole-token boundary: never match inside another class. */
const tok = (s) => new RegExp(`(^|\\s)${s.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&")}(?=\\s|$)`, "g");

/**
 * Rules run in order over one class string. `when` (optional) inspects the
 * whole string; `from` is the exact token; `to` the replacement.
 */
const RULES = [
    // ── old light/dark pairs copied from the panel ──
    { from: "bg-surface-50 dark:bg-surface-900", to: "bg-surface-sheet" },
    { from: "bg-surface-50 dark:bg-surface-950", to: "bg-surface-frame" },
    { from: "bg-surface-100 dark:bg-surface-800", to: "bg-surface-raised" },
    { from: "bg-surface-100 dark:bg-surface-950", to: "bg-surface-well" },
    { from: "bg-surface-50 dark:bg-surface-800/30", to: "bg-surface-field" },
    { from: "bg-white dark:bg-surface-900", to: "bg-surface-card" },
    { from: "bg-white dark:bg-surface-950", to: "bg-surface-card" },
    // alpha pairs copied from older panel code; the light half never renders here
    { from: "bg-surface-50/90 dark:bg-surface-900/90", to: "bg-surface-sheet" },
    { from: "bg-surface-100/50 dark:bg-surface-800/20", to: "bg-surface-field" },
    { from: "bg-surface-100/30 dark:bg-surface-800/10", to: "bg-surface-field" },
    { from: "bg-surface-200/20 dark:bg-surface-800/30", to: "bg-surface-field" },
    { from: "bg-surface-200/40 dark:bg-surface-700/50", to: "bg-surface-raised" },
    { from: "bg-surface-200/30 dark:bg-surface-700/40", to: "bg-surface-raised" },
    { from: "hover:bg-surface-200/50 dark:hover:bg-surface-800/50", to: "hover:bg-surface-hover" },
    { from: "hover:bg-surface-100 dark:hover:bg-surface-800", to: "hover:bg-surface-hover" },
    { from: "border-surface-200/30 dark:border-surface-700/40", to: "border-hairline" },
    { from: "border-surface-300/40 dark:border-surface-700/50", to: "border-hairline" },
    { from: "border-surface-200 dark:border-surface-700/60", to: "border-hairline" },
    { from: "border-surface-200 dark:border-surface-800", to: "border-hairline" },

    // ── lone `dark:` halves and pairs with a dead light half ──
    { from: "bg-white dark:bg-surface-900/50", to: "bg-surface-card" },
    { from: "bg-white dark:bg-surface-800", to: "bg-surface-card" },
    { from: "bg-surface-accent-200/60 dark:bg-surface-800 dark:bg-opacity-50", to: "bg-surface-raised" },
    { from: "hover:bg-surface-accent-100 dark:hover:bg-surface-800", to: "hover:bg-surface-hover" },
    { from: "hover:bg-surface-200/50 dark:hover:bg-surface-800", to: "hover:bg-surface-hover" },
    { from: "dark:hover:bg-surface-800", to: "hover:bg-surface-hover" },
    { from: "dark:bg-surface-950", to: "bg-surface-frame" },
    { from: "dark:bg-surface-900", to: "bg-surface-card", when: (s) => /(^|\s)border(\s|$)/.test(s) && /\b(rounded|p-\d|px-\d|py-\d)/.test(s) },
    { from: "dark:bg-surface-900", to: "bg-surface-sheet" },
    { from: "dark:bg-surface-800", to: "bg-surface-raised" },
    { from: "dark:border-surface-700", to: "border-hairline-strong" },
    { from: "dark:border-surface-800", to: "border-hairline" },

    // ── hover edges ──
    { from: "hover:border-surface-700/60", to: "hover:border-hairline-strong" },
    { from: "hover:border-surface-700", to: "hover:border-hairline-strong" },
    { from: "hover:border-surface-600", to: "hover:border-hairline-strong" },
    { from: "hover:border-surface-800", to: "hover:border-hairline-strong" },
    { from: "hover:bg-surface-800/20", to: "hover:bg-surface-hover" },

    // ── translucent grounds and edges the first table missed ──
    { from: "bg-surface-950/80", to: "bg-surface-well/85" },
    { from: "bg-surface-900/90", to: "bg-surface-sheet" },
    { from: "bg-surface-900/80", to: "bg-surface-sheet" },
    { from: "bg-surface-900/10", to: "bg-surface-field" },
    { from: "bg-surface-800/80", to: "bg-surface-raised" },
    { from: "bg-surface-800/10", to: "bg-surface-field" },
    { from: "bg-surface-700/40", to: "bg-surface-raised-hover" },
    { from: "border-surface-700/80", to: "border-hairline-strong" },
    { from: "border-surface-700/10", to: "border-hairline" },
    { from: "border-surface-800/70", to: "border-hairline" },
    { from: "border-surface-800/25", to: "border-hairline" },
    { from: "border-surface-850", to: "border-hairline" },
    { from: "divide-surface-900", to: "divide-hairline" },
    { from: "divide-surface-800/50", to: "divide-hairline" },

    // ── interaction fills ──
    { from: "hover:bg-surface-900/30", to: "hover:bg-surface-hover" },
    { from: "hover:bg-surface-900/40", to: "hover:bg-surface-hover" },
    { from: "hover:bg-surface-900/50", to: "hover:bg-surface-hover" },
    { from: "hover:bg-surface-900/60", to: "hover:bg-surface-hover" },
    { from: "hover:bg-surface-900", to: "hover:bg-surface-hover" },
    { from: "hover:bg-surface-800/30", to: "hover:bg-surface-hover" },
    { from: "hover:bg-surface-800/40", to: "hover:bg-surface-hover" },
    { from: "hover:bg-surface-800/50", to: "hover:bg-surface-hover" },
    { from: "hover:bg-surface-800/60", to: "hover:bg-surface-hover" },
    { from: "hover:bg-surface-800", to: "hover:bg-surface-hover" },
    { from: "hover:bg-surface-700/50", to: "hover:bg-surface-raised-hover" },
    { from: "hover:bg-surface-700", to: "hover:bg-surface-raised-hover" },
    { from: "group-hover:bg-surface-800/40", to: "group-hover:bg-surface-hover" },
    { from: "group-hover:bg-surface-800", to: "group-hover:bg-surface-hover" },

    // ── hairlines drawn as backgrounds ──
    { from: "bg-surface-800", to: "bg-hairline", when: (s) => /\b(w-px|h-px)\b/.test(s) },
    { from: "bg-surface-700", to: "bg-hairline-strong", when: (s) => /\b(w-px|h-px)\b/.test(s) },

    // ── the frame: the darkest ground a mockup paints ──
    { from: "bg-surface-950", to: "bg-surface-frame" },
    { from: "bg-surface-950/20", to: "bg-surface-well/40" },
    { from: "bg-surface-950/30", to: "bg-surface-well/50" },
    { from: "bg-surface-950/40", to: "bg-surface-well/60" },
    { from: "bg-surface-950/50", to: "bg-surface-well/70" },
    { from: "bg-surface-950/60", to: "bg-surface-well/80" },

    // ── 900: a bordered, padded box is a card; a region is the sheet ──
    { from: "bg-surface-900", to: "bg-surface-card", when: (s) => /(^|\s)border(\s|$)/.test(s) && /\b(rounded|p-\d|px-\d|py-\d)/.test(s) },
    { from: "bg-surface-900", to: "bg-surface-sheet" },
    // a translucent 900 on a band with a rule is the same band; on a chip it is raised
    { from: "bg-surface-900/60", to: "bg-surface-sheet", when: (s) => /\bborder-[bt]\b/.test(s) },
    { from: "bg-surface-900/40", to: "bg-surface-sheet", when: (s) => /\bborder-[bt]\b/.test(s) },
    { from: "bg-surface-900/60", to: "bg-surface-raised" },
    { from: "bg-surface-900/50", to: "bg-surface-raised" },
    { from: "bg-surface-900/40", to: "bg-surface-raised" },
    { from: "bg-surface-900/30", to: "bg-surface-field" },
    { from: "bg-surface-900/20", to: "bg-surface-field" },

    // ── 800: tiles, chips, wells ──
    { from: "bg-surface-800", to: "bg-surface-raised" },
    { from: "bg-surface-800/70", to: "bg-surface-raised" },
    { from: "bg-surface-800/60", to: "bg-surface-raised" },
    { from: "bg-surface-800/50", to: "bg-surface-raised" },
    { from: "bg-surface-800/40", to: "bg-surface-raised" },
    { from: "bg-surface-800/30", to: "bg-surface-field" },
    { from: "bg-surface-800/20", to: "bg-surface-field" },
    { from: "bg-surface-700", to: "bg-surface-raised-hover" },
    { from: "bg-surface-700/50", to: "bg-surface-raised-hover" },

    // ── borders: a soft line is the hairline, the solid 700 is the strong one ──
    { from: "border-surface-200/40 dark:border-surface-700/40", to: "border-hairline" },
    { from: "border-surface-200/20 dark:border-surface-700/30", to: "border-hairline" },
    { from: "border-surface-200 dark:border-surface-700", to: "border-hairline-strong" },
    { from: "border-surface-200/60 dark:border-surface-700/60", to: "border-hairline" },
    { from: "border-surface-800/30", to: "border-hairline" },
    { from: "border-surface-800/40", to: "border-hairline" },
    { from: "border-surface-800/50", to: "border-hairline" },
    { from: "border-surface-800/60", to: "border-hairline" },
    { from: "border-surface-800/80", to: "border-hairline" },
    { from: "border-surface-800", to: "border-hairline" },
    { from: "border-surface-900", to: "border-hairline" },
    { from: "border-surface-700/30", to: "border-hairline" },
    { from: "border-surface-700/40", to: "border-hairline" },
    { from: "border-surface-700/50", to: "border-hairline" },
    { from: "border-surface-700/60", to: "border-hairline" },
    { from: "border-surface-700/70", to: "border-hairline-strong" },
    { from: "border-surface-700", to: "border-hairline-strong" },
    { from: "border-surface-600", to: "border-hairline-strong" },
    { from: "divide-surface-800/40", to: "divide-hairline" },
    { from: "divide-surface-800/60", to: "divide-hairline" },
    { from: "divide-surface-800", to: "divide-hairline" },
    { from: "divide-surface-700/60", to: "divide-hairline" },
    { from: "divide-surface-700", to: "divide-hairline-strong" }
];

// Every quoted string that looks like a class list: `class="…"`,
// `className="…"`, and plain string literals inside cls()/className={} — any
// double- or single-quoted literal that contains a surface token.
const LITERAL = /(["'`])((?:(?!\1)[^\\\n]|\\.)*?(?:bg|border|divide)-surface-[0-9]+(?:(?!\1)[^\\\n]|\\.)*?)\1/g;

const perRule = new Map();
const leftovers = new Map();
let files = 0;

for (const root of roots) {
    for (const file of walk(root)) {
        const src = readFileSync(file, "utf8");
        const log = [];
        const next = src.replace(LITERAL, (whole, q, body) => {
            let s = body;
            for (const rule of RULES) {
                if (rule.when && !rule.when(s)) continue;
                const re = tok(rule.from);
                if (!re.test(s)) continue;
                s = s.replace(tok(rule.from), (m, lead) => `${lead}${rule.to}`);
                perRule.set(rule.from, (perRule.get(rule.from) || 0) + 1);
                log.push(`${rule.from} -> ${rule.to}`);
            }
            return `${q}${s}${q}`;
        });
        const left = next.match(/(?:hover:|group-hover:)?(?:bg|border|divide)-surface-[0-9]+(?:\/[0-9]+)?/g);
        if (left) leftovers.set(file, [...new Set(left)]);
        if (next !== src) {
            files++;
            if (write) writeFileSync(file, next);
            console.log(`${write ? "wrote" : "would write"} ${relative(process.cwd(), file)} (${log.length})`);
        }
    }
}

console.log(`\n${files} files${write ? "" : " (dry run)"}`);
for (const [from, n] of [...perRule.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${from}`);
if (leftovers.size) {
    console.log(`\nleft as numbered (${leftovers.size} files):`);
    for (const [file, toks] of leftovers) console.log(`  ${relative(process.cwd(), file)}: ${toks.join(" ")}`);
}

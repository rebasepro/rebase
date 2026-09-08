#!/usr/bin/env node
/**
 * Migrate hand-picked light/dark surface class pairs to the semantic surface
 * roles introduced in packages/ui/src/theme.css (September 2026).
 *
 *   node tooling/scripts/migrate-surfaces.mjs packages/ui/src            # dry run
 *   node tooling/scripts/migrate-surfaces.mjs packages/ui/src --write    # apply
 *
 * Only WHOLE pairs are replaced, so a stray `dark:` half is never left behind.
 * Pairs that need a per-file decision (frame vs. card, track vs. field) are
 * deliberately not in the table; the script lists the files that still carry
 * them under "ambiguous" so they can be edited by hand.
 * See docs/plans/surface-system-2026-09.md for the mapping rationale.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const MAPPING = [
    // backgrounds: solid surfaces
    ["bg-white dark:bg-surface-900", "bg-surface-card"],
    ["bg-white dark:bg-surface-950", "bg-surface-card"],
    ["bg-white dark:bg-surface-800", "bg-surface-card"],
    ["bg-surface-50 dark:bg-surface-800", "bg-surface-sheet"],
    ["bg-surface-100 dark:bg-surface-900", "bg-surface-raised"],
    ["bg-surface-100 dark:bg-surface-800", "bg-surface-raised"],
    ["bg-surface-200 dark:bg-surface-700", "bg-surface-raised"],
    ["bg-surface-accent-100 dark:bg-surface-accent-800", "bg-surface-raised"],
    ["bg-surface-accent-50 dark:bg-surface-accent-900", "bg-surface-raised"],
    ["bg-surface-accent-200 dark:bg-surface-accent-800", "bg-surface-raised"],
    ["bg-white/80 dark:bg-surface-900/80", "bg-surface-scrim"],
    // separators drawn as backgrounds
    ["dark:bg-surface-700 bg-surface-200", "bg-hairline"],
    ["bg-surface-200 dark:bg-surface-700 h-px", "bg-hairline h-px"],
    ["bg-surface-accent-100 dark:bg-surface-900 m-[5px]", "bg-hairline m-[5px]"],
    // borders
    ["border-surface-200/60 dark:border-surface-700/60", "border-hairline"],
    ["border-surface-200 dark:border-surface-700/60", "border-hairline"],
    ["border-surface-200 dark:border-surface-800", "border-hairline"],
    ["border-surface-200 dark:border-surface-950", "border-hairline"],
    ["border-surface-200/40 dark:border-surface-700/40", "border-hairline"],
    ["border-surface-200 dark:border-surface-700", "border-hairline-strong"],
    ["border-surface-300 dark:border-surface-700", "border-hairline-strong"],
    ["border-surface-300 dark:border-surface-600", "border-hairline-strong"],
    ["divide-surface-100 dark:divide-surface-700 dark:divide-opacity-70 dark:divide-surface-700/70", "divide-hairline"],
    ["divide-surface-200/60 dark:divide-surface-700/60", "divide-hairline"],
    // hover on a transparent ground
    ["hover:bg-surface-accent-200 hover:bg-opacity-75 hover:bg-surface-accent-200/75 dark:hover:bg-surface-accent-800", "hover:bg-surface-hover"],
    ["hover:bg-surface-accent-200 hover:bg-opacity-40 hover:bg-surface-accent-200/40 dark:hover:bg-surface-800 dark:hover:bg-opacity-40 dark:hover:bg-surface-800/40", "hover:bg-surface-hover"],
    ["hover:bg-surface-accent-200/75 dark:hover:bg-surface-accent-800", "hover:bg-surface-hover"],
    ["hover:bg-surface-accent-100 dark:hover:bg-surface-800", "hover:bg-surface-hover"],
    ["hover:bg-surface-accent-100 dark:hover:bg-surface-accent-900", "hover:bg-surface-hover"],
    ["hover:bg-surface-accent-100 dark:hover:bg-surface-accent-800", "hover:bg-surface-hover"],
    ["hover:bg-surface-accent-50 dark:hover:bg-surface-800", "hover:bg-surface-hover"],
    ["hover:bg-surface-accent-200 dark:hover:bg-surface-accent-800", "hover:bg-surface-hover"],
    ["hover:bg-surface-100 dark:hover:bg-surface-900", "hover:bg-surface-hover"],
    ["hover:bg-surface-100 dark:hover:bg-surface-800", "hover:bg-surface-hover"],
    ["hover:bg-surface-100 dark:hover:bg-surface-950", "hover:bg-surface-hover"],
    ["hover:bg-surface-200 dark:hover:bg-surface-800", "hover:bg-surface-hover"],
    ["hover:bg-surface-50 dark:hover:bg-surface-700", "hover:bg-surface-hover"],
    ["group-hover:bg-surface-accent-50 dark:group-hover:bg-surface-800", "group-hover:bg-surface-hover"],
    // hover on a raised solid
    ["hover:bg-surface-accent-200 dark:hover:bg-surface-accent-700", "hover:bg-surface-raised-hover"],
    // selected / checked / open on a transparent ground
    ["data-[state=checked]:focus:bg-surface-accent-200 data-[state=checked]:dark:focus:bg-surface-900", "data-[state=checked]:focus:bg-surface-active"],
    ["data-[state=checked]:bg-surface-accent-100 data-[state=checked]:dark:bg-surface-accent-800", "data-[state=checked]:bg-surface-active"],
    ["focus:bg-surface-accent-100 dark:focus:bg-surface-900", "focus:bg-surface-hover"],
    ["aria-[selected=true]:bg-surface-accent-100 aria-[selected=true]:dark:bg-surface-accent-900", "aria-[selected=true]:bg-surface-active"],
    ["data-[state=open]:bg-surface-accent-100 data-[state=open]:dark:bg-surface-900", "data-[state=open]:bg-surface-active"],
    ["bg-surface-accent-200 dark:bg-surface-accent-950", "bg-surface-active"]
];

const AMBIGUOUS = [
    "bg-surface-50 dark:bg-surface-900",
    "bg-surface-50 dark:bg-surface-950",
    "bg-surface-100 dark:bg-surface-950",
    "hover:bg-primary/5 dark:hover:bg-primary/5",
    "hover:bg-primary/5",
    "dark:bg-surface-accent-",
    "bg-surface-accent-"
];

/**
 * A lone `dark:bg-surface-N` with no light half is the other way the ladder
 * breaks: the whole-pair rule above never sees it, and the first sweep left
 * `dark:bg-surface-800` (#111111, darker than the sheet) as the collection
 * container. Every remaining one outside Studio is listed here with the reason
 * it is not a surface; anything else is a finding. `--check` makes that a
 * failing exit, so this file doubles as the gate for the rule.
 */
const LONE_DARK = /(?:^|[\s"'`])dark:(?:hover:)?bg-surface-(?:accent-)?\d+(?:\/[\d.]+)?(?=$|[\s"'`])/g;
const LONE_DARK_ALLOWED = [
    ["packages/ui/src/components/Checkbox.tsx", "disabled checkbox fill; out of scope, a separate decision"],
    ["packages/ui/src/components/BooleanSwitch.tsx", "the knob, a glyph on the track"],
    ["packages/cms/src/form/field_bindings/BinaryFieldBinding.tsx", "a status dot, a glyph"],
    ["packages/cms/src/form/field_bindings/VectorFieldBinding.tsx", "a status dot, a glyph"],
    ["packages/cms/src/components/PropertyConfigBadge.tsx", "a disabled badge under white ink, not a surface"],
    ["packages/cms/src/preview/components/EmptyValue.tsx", "an inline placeholder pill, a glyph"],
    ["packages/cms/src/editor/extensions/HighlightDecorationExtension.ts", "a text-range tint that carries meaning"],
    ["packages/app/src/debug/crm-dashboard/CrmDashboardDemo.tsx", "the toast's inverse ground, the tooltip exception"],
    ["app/frontend/src/BodyPartsField.tsx", "a body-part marker dot, a glyph"]
];
const STUDIO = /\/studio\//;

const EXTS = new Set([".tsx", ".ts", ".astro", ".mdx"]);
const args = process.argv.slice(2);
const write = args.includes("--write");
const check = args.includes("--check");
const roots = args.filter((a) => !a.startsWith("--"));
if (roots.length === 0) {
    console.error("usage: migrate-surfaces.mjs <dir...> [--write]");
    process.exit(1);
}

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) walk(p, out);
        else if (EXTS.has(extname(name))) out.push(p);
    }
    return out;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
// A pair must be bounded by a quote, a space or a line edge on both sides so
// `bg-surface-50 dark:bg-surface-800` never matches inside `...-800/60`.
const rules = MAPPING.map(([from, to]) => [new RegExp(`(^|[\\s"'\`])${escape(from)}(?=$|[\\s"'\`])`, "g"), from, to]);

let totalHits = 0;
const perRule = new Map();
const ambiguous = new Map();
const loneFindings = new Map();
const loneAllowed = new Map();
for (const root of roots) {
    for (const file of walk(root)) {
        let src = readFileSync(file, "utf8");
        let next = src;
        for (const [re, from, to] of rules) {
            next = next.replace(re, (m, lead) => {
                totalHits++;
                perRule.set(from, (perRule.get(from) || 0) + 1);
                return `${lead}${to}`;
            });
        }
        // Comments mention the retired patterns by name (that is how a rule gets
        // explained where it applies); only code lines count.
        const code = next.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
        const allowed = LONE_DARK_ALLOWED.find(([p]) => file.endsWith(p));
        const left = allowed ? [] : AMBIGUOUS.filter((a) => code.includes(a));
        if (left.length) ambiguous.set(file, left);
        if (!STUDIO.test(file)) {
            const lone = code.match(LONE_DARK);
            if (lone) {
                (allowed ? loneAllowed : loneFindings).set(file, allowed ? allowed[1] : lone.map((s) => s.trim()).join(" | "));
            }
        }
        if (next !== src) {
            if (write) writeFileSync(file, next);
            console.log(`${write ? "wrote" : "would write"} ${file}`);
        }
    }
}
console.log(`\n${totalHits} replacements${write ? "" : " (dry run)"}`);
for (const [from, n] of [...perRule.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${from}`);
if (ambiguous.size) {
    console.log(`\nambiguous, edit by hand (${ambiguous.size} files):`);
    for (const [file, pats] of ambiguous) console.log(`  ${file}: ${pats.join(" | ")}`);
}
if (loneAllowed.size) {
    console.log(`\nlone dark halves kept on purpose (${loneAllowed.size} files):`);
    for (const [file, why] of loneAllowed) console.log(`  ${file}: ${why}`);
}
if (loneFindings.size) {
    console.log(`\nlone dark halves with no light half, outside Studio (${loneFindings.size} files):`);
    for (const [file, pats] of loneFindings) console.log(`  ${file}: ${pats}`);
}
if (check && (totalHits || ambiguous.size || loneFindings.size)) {
    console.error("\nsurface check failed: a background is still chosen by number rather than by role");
    process.exit(1);
}

/**
 * A Tailwind colour utility naming a token the theme does not define.
 *
 * Tailwind v4 derives colour utilities from `--color-*` entries in `@theme`.
 * Ask for one that is not there and it does not warn, does not fall back and
 * does not fail the build — it emits no rule at all, and the element keeps
 * whatever it inherited. The class sits in the source looking correct forever.
 *
 * `packages/ui/src/theme.css` defines `--color-primary`, `-light`, `-dark` and
 * `-bg`, and no numbered scale. Fifteen utilities across five packages asked
 * for one anyway — `text-primary-600 dark:text-primary-400` on the CMS list
 * row's title, `bg-primary-50 dark:bg-primary-900/20` on the selected row in
 * `CollectionListView`, `focus:border-primary-solid` on all three drop zones,
 * `dark:bg-primary-bg-dark` on the sorted table header, `dark:text-surface-650`
 * on out-of-month calendar days. Every one of them was dead: the list row never
 * changed colour on hover, the selected row was indistinguishable from its
 * neighbours, and the calendar's out-of-month days rendered BRIGHTER than the
 * in-month ones in dark mode, because the dark half of the pair generated
 * nothing and the light `text-surface-300` applied on both themes.
 *
 * None of that is visible in a diff, in a type error or in a test. It is only
 * visible by grepping the built stylesheet for a utility and finding it absent,
 * which is what this does without needing the build.
 *
 * Scope is deliberately the custom families this repo defines — `primary`,
 * `surface`, `hairline` and friends. Tailwind's own palette (`text-red-500`)
 * is left alone, so the check has no opinion to be wrong about.
 *
 *     pnpm check:theme-tokens
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/**
 * Tracked files under a package's or app's own `src/`. Scaffold templates live
 * under `packages/cli/templates/` and compile their own Tailwind against their
 * own `index.css`, so their tokens must not vouch for a class the product
 * ships — the pattern's single `[^/]+` segment leaves them out of both lists.
 */
const ALL_TRACKED = execFileSync("git", ["ls-files"], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28
}).trim().split("\n").filter(Boolean);
const tracked = (re) => ALL_TRACKED.filter((f) => re.test(f));

/** Utility prefixes that take a colour. */
const COLOR_PREFIXES = [
    "bg", "text", "border", "ring", "ring-offset", "shadow", "inset-shadow",
    "fill", "stroke", "from", "via", "to", "decoration", "outline", "accent",
    "caret", "divide", "placeholder"
];
const UTILITY = new RegExp(`^(${COLOR_PREFIXES.join("|")})-(.+)$`);

/** `dark:`, `group-hover:`, `data-[state=open]:`, `@md:`, `max-sm:` … */
const VARIANT = /^@?[a-z0-9-]+(\[[^\]]*\])?:/;

/** `/40`, `/[0.06]` */
const OPACITY = /\/(\d+(\.\d+)?|\[[^\]]*\])$/;

/**
 * Every `--color-*` declared inside an `@theme` block, anywhere in the styles
 * the app compiles. Plain custom properties outside `@theme` — the semantic
 * surfaces at the bottom of theme.css — generate no utility and are not read
 * here; the `@theme inline` entries that alias them are.
 */
function declaredTokens() {
    const tokens = new Set();
    const files = tracked(/^(packages|app)\/[^/]+\/src\/.*\.css$/);

    for (const file of files) {
        const css = fs.readFileSync(path.join(ROOT, file), "utf8");
        for (const open of [...css.matchAll(/@theme[^{]*\{/g)]) {
            // walk to the matching brace, so a nested block cannot end it early
            let depth = 1;
            let i = open.index + open[0].length;
            const start = i;
            while (i < css.length && depth > 0) {
                if (css[i] === "{") depth++;
                else if (css[i] === "}") depth--;
                i++;
            }
            for (const m of css.slice(start, i - 1).matchAll(/--color-([a-z0-9-]+)\s*:/g)) {
                tokens.add(m[1]);
            }
        }
    }
    return tokens;
}

const tokens = declaredTokens();
if (tokens.size === 0) {
    console.error("check:theme-tokens: found no @theme colour tokens at all — the parser or the paths are wrong.");
    process.exit(1);
}

/** `primary`, `surface`, `text`, `hairline`, … — the families this repo owns. */
const families = new Set([...tokens].map((t) => t.split("-")[0]));

const sources = tracked(/^(packages|app)\/[^/]+\/src\/.*\.tsx?$/);

const findings = [];
for (const file of sources) {
    const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n");
    lines.forEach((line, n) => {
        for (const lit of line.matchAll(/["'`]([^"'`\n]*)["'`]/g)) {
            if (lit[1].includes("${")) continue;
            for (const raw of lit[1].split(/\s+/)) {
                let tok = raw.replace(/^!/, "").replace(/!$/, "");
                while (VARIANT.test(tok)) tok = tok.replace(VARIANT, "");
                tok = tok.replace(OPACITY, "");
                if (!tok || tok.includes("[")) continue;
                const m = UTILITY.exec(tok);
                if (!m) continue;
                const color = m[2];
                if (!families.has(color.split("-")[0])) continue;   // Tailwind's own palette
                if (tokens.has(color)) continue;
                findings.push({ file, line: n + 1, tok: raw, color });
            }
        }
    });
}

if (findings.length === 0) {
    console.log(`check:theme-tokens: ${sources.length} files, ${tokens.size} colour tokens, no dead utilities.`);
    process.exit(0);
}

console.error(`check:theme-tokens: ${findings.length} colour utilities name a token no @theme block defines.`);
console.error("Tailwind emits NO rule for these — the element silently keeps whatever it inherited.\n");
for (const f of findings) {
    const near = [...tokens]
        .filter((t) => t.split("-")[0] === f.color.split("-")[0])
        .sort();
    console.error(`  ${f.file}:${f.line}`);
    console.error(`    ${f.tok}  →  --color-${f.color} is not defined`);
    console.error(`    defined in this family: ${near.join(", ")}\n`);
}
console.error("Use a token that exists, or add one to packages/ui/src/theme.css.");
process.exit(1);

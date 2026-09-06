/**
 * No documentation page teaches `defineFunction` from the package root.
 *
 * Custom functions have their own entry point, `@rebasepro/server/functions`,
 * and the reason is portability rather than tidiness: the root reaches the
 * whole framework — boot, the collection loader, the backup routes, the SPA
 * server, `@hono/node-server`, `ws`, `jsonwebtoken`, Drizzle — so a function
 * file that imports from it can only ever resolve inside a Node process,
 * however portable the function's own code is. `check:portable-core` holds that
 * boundary in the shipped source. Nothing held it in the prose.
 *
 * Both resolve, which is what makes this the quiet kind of wrong: two pages gave
 * opposite instructions — `backend/custom-functions.md` said "Import from
 * `@rebasepro/server/functions`, not from `@rebasepro/server`" while
 * `troubleshooting.md` said "Author with `defineFunction(...)` from
 * `@rebasepro/server`" — and the reader who followed the second one lost
 * portability with no error anywhere to tell them.
 *
 * ## What counts
 *
 * A line that names `defineFunction` and also names `@rebasepro/server` without
 * the `/functions` subpath. Line-scoped deliberately: it catches the prose
 * sentence and the fenced import alike, and it does not fire on the page that
 * names the root precisely in order to warn against it, because that sentence
 * does not mention `defineFunction`.
 *
 * The CHANGELOG is excluded, as it is from the other prose gates: the entry
 * that shipped the subpath quotes the old import to explain what changed, and a
 * released changelog is a record rather than a claim. So are `docs/audits/` and
 * `docs/plans/` — working notes about the defect, not instructions.
 *
 * Run: node tooling/scripts/docs-verify/check-portable-imports.mjs
 */
import { readFileSync, globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "..", "..", "..");

const GREEN = "[0;32m";
const RED = "[0;31m";
const DIM = "[2m";
const NC = "[0m";

/** The authoring helper and the subpath that carries it. */
const HELPER = "defineFunction";
const ROOT_PACKAGE = "@rebasepro/server";
const SUBPATH = "@rebasepro/server/functions";

/**
 * Every documentation surface, in every locale.
 *
 * The locales are included even though they are machine-translated from
 * English: a translation carries the import line through untouched, so a wrong
 * one is wrong in six places and a fix has to reach all six.
 */
function docFiles(root) {
    return [
        ...globSync("docs/**/*.md", { cwd: root }),
        ...globSync("website/src/content/docs/**/*.md", { cwd: root }),
        ...globSync("website/src/content/docs/**/*.mdx", { cwd: root }),
        ...globSync("tooling/rebase-agent-skills/**/*.md", { cwd: root }),
        ...globSync("examples/*/*.md", { cwd: root }),
        ...globSync("AGENT.md", { cwd: root }),
        ...globSync(".agent/workflows/*.md", { cwd: root }),
        ...globSync("README.md", { cwd: root })
    ].filter(rel =>
        !/CHANGELOG/i.test(rel)
        && !rel.includes("/blog/")
        && !rel.startsWith("docs/audits/")
        && !rel.startsWith("docs/plans/"));
}

/**
 * The helper, then `from`, then the bare root — the shape of both the fenced
 * import and the English sentence, on one line.
 *
 * Ordered, and that is what keeps it honest. `cron-jobs.md` describes the
 * singleton with "the same object `import { rebase } from "@rebasepro/server"`
 * returns, and the same one `defineFunction` hands its callback" — the package
 * and the helper on one wrapped line, teaching nothing about how to import the
 * helper. Requiring the helper *before* the specifier tells the two apart.
 *
 * The 60-character window keeps "helper … from … root" to one clause: the
 * sentence and the import statement are both far shorter than that, and a page
 * that mentions the helper and then names the root for some unrelated reason
 * two clauses later is not making a claim about how to import it.
 */
const INLINE = new RegExp(
    `${HELPER}.{0,60}?\\bfrom\\b[\\s\`"'()]{0,4}${ROOT_PACKAGE.replace("/", "\\/")}(?!\\/functions)`
);

/**
 * A multi-line `import { … } from "@rebasepro/server"` naming the helper.
 *
 * The line rule cannot see this one, and it is the shape a longer import list
 * takes as soon as a formatter wraps it.
 */
const MULTILINE = new RegExp(
    `import\\s*(?:type\\s*)?\\{[^}]*\\b${HELPER}\\b[^}]*\\}\\s*from\\s*["'\`]${ROOT_PACKAGE.replace("/", "\\/")}["'\`]`,
    "g"
);

/**
 * @param {string} line
 * @returns {boolean} true when this line teaches the root import.
 */
export function teachesRootImport(line) {
    return line.includes(HELPER) && INLINE.test(line);
}

export function checkPortableImports(root = DEFAULT_ROOT) {
    const findings = [];
    let scanned = 0;

    const message = `${HELPER} is taught from \`${ROOT_PACKAGE}\`. It must be \`${SUBPATH}\` — `
        + "the root pulls in the whole Node-only framework, so a function written from "
        + "this page cannot run anywhere else. Both resolve, so nothing else will say so.";

    for (const rel of docFiles(root)) {
        const text = readFileSync(path.join(root, rel), "utf8");
        if (!text.includes(HELPER)) continue;
        scanned += 1;

        const flagged = new Set();
        text.split("\n").forEach((line, index) => {
            if (teachesRootImport(line)) flagged.add(index + 1);
        });
        for (const match of text.matchAll(MULTILINE)) {
            flagged.add(text.slice(0, match.index).split("\n").length);
        }

        for (const line of [...flagged].sort((a, b) => a - b)) {
            findings.push({ file: rel, line, message });
        }
    }

    return { findings, scanned };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { findings, scanned } = checkPortableImports();
    if (findings.length === 0) {
        console.log(`${GREEN}✓ ${scanned} page(s) mention ${HELPER}; all of them import it from ${SUBPATH}.${NC}`);
    } else {
        console.log(`${RED}✗ ${findings.length} page(s) teach ${HELPER} from the package root:${NC}`);
        for (const finding of findings) {
            console.log(`  ${RED}${finding.file}:${finding.line}${NC}\n      ${DIM}${finding.message}${NC}`);
        }
        process.exitCode = 1;
    }
}

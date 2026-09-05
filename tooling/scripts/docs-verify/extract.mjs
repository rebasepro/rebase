/**
 * Extracts fenced code blocks from Markdown/MDX, tracking the source line of
 * every block so compiler diagnostics can be reported against the doc, not
 * against the generated scratch file.
 */
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";

/** Fence languages we typecheck. `js` is compiled as TS — see README note. */
const CHECKED_LANGS = new Set(["ts", "typescript", "tsx", "js", "javascript", "jsx"]);

/**
 * A ```diff fence carries migration guidance, and until now none of it was ever
 * compiled — `diff` is not in CHECKED_LANGS, so every one was silently skipped.
 *
 * That is how 0.13's headline migration shipped wrong. The changelog told readers
 * to rewrite `rebase.data.projects.find()` as `rebase.dataAsAdmin.projects.find()`;
 * the removal was real and the runtime alias was real, but the replacement line
 * did not typecheck against an untyped server singleton. Prose about types is
 * still code, and this is the one kind of code a reader copies while their build
 * is already broken.
 *
 * Opt in per fence by naming the language in the meta — the fence declares what
 * it is rather than a heuristic guessing:
 *
 *     ```diff ts
 *     - const rows = await rebase.data.projects.find();
 *     + const rows = await rebase.dataAsAdmin.projects.find();
 *     ```
 *
 * Untagged ```diff fences stay skipped, because plenty of them are env files,
 * YAML or shell.
 */
const DIFF_LANG_IN_META = /(^|\s)(ts|typescript|tsx|js|javascript|jsx)(\s|$)/;

/**
 * Reduce a diff body to the code it is telling the reader to end up with.
 *
 * Removed lines become EMPTY rather than being dropped: a `-` line is the old
 * API, which after a breaking change does not compile by design, and deleting
 * the line outright would shift every subsequent line number so diagnostics
 * pointed at the wrong line of the doc.
 */
function applyDiff(lines) {
    return lines.map((line) => {
        if (/^\s*-/.test(line)) return "";
        // `+ foo` and ` foo` (context) both become `foo`: strip the marker and
        // the single space diff convention puts after it.
        const plus = line.match(/^(\s*)\+ ?(.*)$/);
        if (plus) return plus[1] + plus[2];
        return line.replace(/^ /, "");
    });
}

/**
 * Opt-out for deliberately-pseudocode blocks. Either form works:
 *   ```ts no-verify
 *   <!-- docs-verify: ignore -->  (on the line immediately above the fence)
 * The comment form exists because some fences carry a `title="..."` meta that
 * Starlight renders, and authors may prefer keeping the meta clean.
 */
const META_OPT_OUT = /(^|\s)no-verify(\s|$)/;
const COMMENT_OPT_OUT = /<!--\s*docs-verify:\s*ignore\s*-->/;

/**
 * A ratchet on the opt-out.
 *
 * Every `no-verify` is a fence the reader can copy and the verifier will not
 * read. The mechanism is necessary — some fences really are pseudocode — but it
 * is also the cheapest way to make a failing check go away, and nothing stopped
 * the number climbing. It sat at 96 before the strictNullChecks and
 * whole-declaration passes landed; those turned up 25 more fences whose owners
 * are other workstreams (W2-03, W4-03, W10-02), each marked with an HTML
 * comment naming the task that will unmark it.
 *
 * So: the number may go down, never up. Lower this constant when you clear
 * fences; raising it needs a reason written next to it.
 */
export const NO_VERIFY_BUDGET = 121;

/**
 * The repository's own agent instructions.
 *
 * These are documentation by every definition that matters — an agent reads
 * them before it writes a line — and no glob in this repository covered them.
 * That is not a hypothetical gap: while every checked surface stayed clean,
 * `AGENT.md` and `.agent/workflows/schema-migration.md` went on teaching
 * `cardinality` + `direction` on a relation for months after the authored
 * relation type became a closed `kind` union and `direction` stopped existing
 * anywhere in `packages/types`.
 *
 * `AGENT.md` is `.gitignore`d (it is the maintainer's local copy), so it is
 * absent in CI and contributes nothing there. It is globbed anyway: the local
 * run is where it gets edited, and a glob that matches nothing costs nothing.
 * The two tracked surfaces — `.agents/` and `.agent/workflows/` — are what the
 * blocking CI gate actually holds.
 */
export const AGENT_INSTRUCTION_GLOBS = [
    "AGENT.md",
    ".agents/*.md",
    ".agent/workflows/*.md"
];

/** Default doc + skill sources, relative to the monorepo root. */
export const DEFAULT_GLOBS = [
    // English only: the other five locales are machine-translated from these by
    // website/scripts/translate_docs.mjs, so a fix here propagates. Locales are
    // covered by the cheaper identifier check instead.
    "website/src/content/docs/docs/**/*.md",
    "website/src/content/docs/docs/**/*.mdx",
    "tooling/rebase-agent-skills/**/*.md",
    // One level deep: every example has its own `node_modules` here, and a
    // `**` glob would walk into it.
    "examples/*/*.md",
    ...AGENT_INSTRUCTION_GLOBS
];

/**
 * @typedef {object} Snippet
 * @property {string} file      doc path, relative to root
 * @property {number} line      1-based line of the block's first code line
 * @property {string} lang      fence language as written
 * @property {string} code      block body
 * @property {string} id        stable slug used for the scratch filename
 */

/**
 * @param {string} root
 * @param {string[]} [globs]
 * @returns {{ snippets: Snippet[], skipped: number, skippedFences: Array<{ file: string, line: number, lang: string }>, files: number }}
 */
export function extractSnippets(root, globs = DEFAULT_GLOBS) {
    const files = [...new Set(globs.flatMap((g) => globSync(g, { cwd: root })))].sort();
    /** @type {Snippet[]} */
    const snippets = [];
    /** @type {Array<{ file: string, line: number, lang: string }>} */
    const skippedFences = [];
    let skipped = 0;

    for (const file of files) {
        const text = readFileSync(path.join(root, file), "utf8");
        const lines = text.split("\n");
        let inFence = false;
        let fenceIndent = "";
        let fenceChar = "";
        let fenceLen = 0;
        let lang = "";
        let isDiff = false;
        let optedOut = false;
        let bodyStart = 0;
        /** @type {string[]} */
        let body = [];
        let n = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const open = line.match(/^([ \t]*)(`{3,}|~{3,})([A-Za-z0-9+#-]*)(.*)$/);

            if (!inFence) {
                if (!open) continue;
                inFence = true;
                fenceIndent = open[1];
                fenceChar = open[2][0];
                fenceLen = open[2].length;
                lang = (open[3] || "").toLowerCase();
                // A language-tagged diff is compiled as that language, with the
                // diff markers resolved when the fence closes.
                isDiff = lang === "diff";
                if (isDiff) {
                    const tagged = open[4].toLowerCase().match(DIFF_LANG_IN_META);
                    lang = tagged ? tagged[2] : lang;
                }
                const prev = i > 0 ? lines[i - 1] : "";
                optedOut = META_OPT_OUT.test(open[4]) || COMMENT_OPT_OUT.test(prev);
                bodyStart = i + 2; // 1-based line of the first body line
                body = [];
                continue;
            }

            // Closing fence: same char, at least as long, nothing but the fence.
            const close = line.match(/^([ \t]*)(`{3,}|~{3,})[ \t]*$/);
            if (close && close[2][0] === fenceChar && close[2].length >= fenceLen) {
                inFence = false;
                if (CHECKED_LANGS.has(lang)) {
                    if (optedOut) {
                        skipped++;
                        skippedFences.push({ file, line: bodyStart, lang });
                    } else {
                        const dedented = body
                            .map((l) => (fenceIndent && l.startsWith(fenceIndent) ? l.slice(fenceIndent.length) : l));
                        const code = (isDiff ? applyDiff(dedented) : dedented).join("\n");
                        if (code.trim()) {
                            snippets.push({
                                file,
                                line: bodyStart,
                                lang,
                                code,
                                id: `${file.replace(/[^A-Za-z0-9]+/g, "_")}__${++n}`
                            });
                        }
                    }
                }
                continue;
            }
            body.push(line);
        }
    }

    return { snippets, skipped, skippedFences, files: files.length };
}

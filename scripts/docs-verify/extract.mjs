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
 * Opt-out for deliberately-pseudocode blocks. Either form works:
 *   ```ts no-verify
 *   <!-- docs-verify: ignore -->  (on the line immediately above the fence)
 * The comment form exists because some fences carry a `title="..."` meta that
 * Starlight renders, and authors may prefer keeping the meta clean.
 */
const META_OPT_OUT = /(^|\s)no-verify(\s|$)/;
const COMMENT_OPT_OUT = /<!--\s*docs-verify:\s*ignore\s*-->/;

/** Default doc + skill sources, relative to the monorepo root. */
export const DEFAULT_GLOBS = [
    // English only: the other five locales are machine-translated from these by
    // website/scripts/translate_docs.mjs, so a fix here propagates. Locales are
    // covered by the cheaper identifier check instead.
    "website/src/content/docs/docs/**/*.md",
    "website/src/content/docs/docs/**/*.mdx",
    "rebase-agent-skills/**/*.md"
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
 * @returns {{ snippets: Snippet[], skipped: number, files: number }}
 */
export function extractSnippets(root, globs = DEFAULT_GLOBS) {
    const files = [...new Set(globs.flatMap((g) => globSync(g, { cwd: root })))].sort();
    /** @type {Snippet[]} */
    const snippets = [];
    let skipped = 0;

    for (const file of files) {
        const text = readFileSync(path.join(root, file), "utf8");
        const lines = text.split("\n");
        let inFence = false;
        let fenceIndent = "";
        let fenceChar = "";
        let fenceLen = 0;
        let lang = "";
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
                    } else {
                        const code = body
                            .map((l) => (fenceIndent && l.startsWith(fenceIndent) ? l.slice(fenceIndent.length) : l))
                            .join("\n");
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

    return { snippets, skipped, files: files.length };
}

#!/usr/bin/env node
/**
 * No tracked text source may contain a raw C0 control character.
 *
 * This gate exists because the failure mode is invisible by construction.
 * `packages/client/src/collection.ts` carried a literal NUL inside a sentinel
 * string — `"\0missing"`, written as the byte rather than the escape. The value
 * was correct and the code worked. What broke was every search over it: grep and
 * ripgrep classify a file containing NUL as binary and skip it *silently*, with
 * no warning and exit status 1, which is indistinguishable from "no matches".
 *
 * So 418 lines of the client's core collection API — `CollectionClient`,
 * `observe`, `createMany` — returned nothing for every query anyone ran. An
 * empty grep result is normally evidence of absence; over that file it was
 * evidence of nothing at all. This is the bug class recorded in
 * `docs/bug-classes.md`: the tool reports success while doing no work.
 *
 * The fix is always the escape (`\0`, `\u0000`, `\x1b`) — identical value, and
 * the source stays plain ASCII.
 *
 *     pnpm check:control-chars
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Extensions this gate covers: the ones a human writes and a human greps.
 * Binary assets and lockfiles are none of its business.
 */
const TEXT_EXTENSIONS = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".md", ".mdx", ".json", ".yml", ".yaml", ".css", ".html", ".astro", ".sql"
]);

/**
 * Legal in text: tab, newline, carriage return — and ESC (`\x1b`).
 *
 * ESC is deliberately allowed, and checking rather than assuming is what
 * settled it. The first draft of this gate forbade the whole C0 range and
 * immediately failed on eight lines of working code: ANSI colour sequences in
 * `packages/cli/bin/rebase.js`, `tooling/scripts/verify-docs.mjs` and
 * `cloud/context.ts`. Those files grep fine — `grep -c ''` reads every line of
 * all three. Only NUL (and invalid encoding) puts grep into binary mode, so
 * only NUL produces the silent-skip this gate exists to prevent. Forbidding ESC
 * would have been a style opinion enforced as a correctness gate, breaking CI
 * over a problem that does not exist.
 *
 * The rest of C0 stays forbidden: nothing in the repository uses it, and none
 * of it has a legitimate place in a source file.
 *
 * Deliberately *not* including the C1 range or Unicode formatting characters
 * (zero-width space, bidi overrides). Those are a different problem — homoglyph
 * and bidi attacks — and want their own gate with its own allow-list, not a
 * silent widening of this one.
 */
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/;

function trackedFiles() {
    const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    return out.toString("utf-8").split("\0").filter(Boolean);
}

const offenders = [];

for (const rel of trackedFiles()) {
    if (!TEXT_EXTENSIONS.has(path.extname(rel))) continue;

    const abs = path.join(ROOT, rel);
    // A tracked path can be absent in a sparse or partial checkout.
    if (!fs.existsSync(abs)) continue;

    // Read as latin1 so every byte maps to exactly one char and nothing is
    // replaced: decoding as UTF-8 first would turn an invalid sequence into
    // U+FFFD and could mask the very byte being looked for.
    const text = fs.readFileSync(abs, "latin1");
    if (!FORBIDDEN.test(text)) continue;

    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
        const match = FORBIDDEN.exec(lines[i]);
        if (!match) continue;
        const code = match[0].charCodeAt(0);
        offenders.push({
            file: rel,
            line: i + 1,
            column: match.index + 1,
            escape: `\\x${code.toString(16).padStart(2, "0")}`
        });
    }
}

if (offenders.length > 0) {
    console.error(`✗ ${offenders.length} raw control character(s) in tracked sources:\n`);
    for (const o of offenders) {
        console.error(`  ${o.file}:${o.line}:${o.column}  ${o.escape}`);
    }
    console.error(
        "\n  A file containing one of these is treated as binary by grep and ripgrep," +
        "\n  which then skip it in silence — searches over it return nothing, and that" +
        "\n  reads exactly like 'no matches'." +
        "\n\n  Write the escape instead (\\0, \\u0000, \\x1b). Same value, greppable source.\n"
    );
    process.exit(1);
}

console.log("✓ no raw control characters in tracked sources");

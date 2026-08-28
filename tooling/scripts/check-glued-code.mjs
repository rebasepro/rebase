#!/usr/bin/env node
/**
 * A line break between prose and an inline `<code>` tag eats the space.
 *
 * Astro does not collapse the newline between a word and an adjacent tag the
 * way a browser collapses whitespace in a text node — it drops it. So this,
 * which looks correct in every editor:
 *
 *     Point it at your own Postgres, or run
 *     <code>rebase dev</code> and get one.
 *
 * renders as "or runrebase dev and get one". JSX does the same thing for the
 * same reason, which is why `.tsx` is scanned too: newlines adjacent to a tag
 * are removed rather than condensed.
 *
 * ## Why a check and not a note in a style guide
 *
 * It is invisible. The source reads correctly, the diff reads correctly, and
 * the bug is one missing space in the middle of a paragraph — the kind of thing
 * a reader registers as "this site feels sloppy" without ever locating. Two
 * instances shipped this way and survived every review the pages have had:
 * "a row changed frompsql" on /backend and "anadmin key" on /developers, plus
 * five more on /europe. All were found by measuring the rendered gap between
 * two boxes, not by reading.
 *
 * ## What counts
 *
 * A line ending in prose immediately followed by a line opening `<code>`, or a
 * line ending in `</code>` immediately followed by a line opening with a word.
 * The previous line must end in something a sentence can end in — a letter,
 * digit or punctuation — so that a JSX return like `const el = (` on the line
 * above a `<code>` element is not a finding. There is no text there to glue to.
 *
 * Only `<code>` is checked. The same hazard exists for every inline tag, but
 * `<span>` is how the syntax-highlighted samples in page frontmatter are built,
 * and those live inside `<pre>` where the whitespace is preserved and the rule
 * inverts — 200 of them would be findings, all of them wrong.
 *
 * ## Fixing one
 *
 * Keep the word and the tag on the same source line. A line break is fine
 * between two words; it is only the boundary with a tag that loses the space.
 *
 *     pnpm check:glued-code
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCANNED = ["website/src"];

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

/**
 * Characters a sentence can end on.
 *
 * Deliberately excludes the openers — `(`, `{`, `=`, `>` — because a line
 * ending in one of those is structure, not prose: `const el = (` above a
 * `<code>` element is JSX, and there is nothing for the tag to glue to.
 */
const PROSE_END = /[A-Za-z0-9,.:;!?%)\]"'»”’\-—–]$/;

function sourceFiles(dir) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return [];
    const out = [];
    const walk = (d) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) {
                if (!/node_modules/.test(full)) walk(full);
            } else if (/\.(astro|tsx)$/.test(entry.name)) {
                out.push(full);
            }
        }
    };
    walk(abs);
    return out;
}

const findings = [];

for (const file of SCANNED.flatMap(sourceFiles)) {
    const rel = path.relative(ROOT, file);
    const lines = fs.readFileSync(file, "utf8").split("\n");

    for (let i = 0; i < lines.length - 1; i++) {
        const prev = lines[i].replace(/[ \t]+$/, "");
        const next = lines[i + 1].replace(/^[ \t]+/, "");

        // A word, then a tag on the next line.
        if (PROSE_END.test(prev) && /^<code[ >]/.test(next)) {
            const word = prev.match(/(\S+)$/)?.[1] ?? "";
            const text = next.match(/^<code[^>]*>([^<]*)/)?.[1] ?? "…";
            findings.push({ rel, line: i + 1, glued: `${word}${text}`, word });
        }
        // A tag, then a word on the next line.
        else if (/<\/code>$/.test(prev) && /^[A-Za-z(]/.test(next)) {
            const text = prev.match(/>([^<]*)<\/code>$/)?.[1] ?? "…";
            const word = next.match(/^(\S+)/)?.[1] ?? "";
            findings.push({ rel, line: i + 1, glued: `${text}${word}`, word });
        }
    }
}

if (findings.length === 0) {
    console.log(green("✓ No line break falls between prose and an inline <code> tag."));
    process.exit(0);
}

console.error(red(`\n✗ ${findings.length} place(s) where a rendered space disappears.\n`));

let current = "";
for (const f of findings) {
    if (f.rel !== current) {
        current = f.rel;
        console.error(`  ${bold(current)}`);
    }
    console.error(`    line ${f.line}: renders as ${red(`"${f.glued}"`)}`);
}

console.error(dim(
    "\n  Astro and JSX drop the newline between a word and an adjacent tag rather\n" +
    "  than collapsing it to a space, so the two run together in the browser.\n" +
    "  Keep the word and the <code> on one source line — breaking between two\n" +
    "  words is fine, it is only the boundary with the tag that loses the space.\n"
));

process.exit(1);

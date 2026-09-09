#!/usr/bin/env node
/**
 * The Schema-as-Code page shows what the generators actually emit.
 *
 * `architecture/schema-as-code.md` is the page that explains the whole idea, so
 * it is the page most likely to be read by somebody deciding whether to adopt
 * this — and its worked example was hand-written, once, and then left. It showed
 * `serial("id").primaryKey()`, `varchar("name")`, `.default(true)` and
 * `.defaultNow()`; the generator emits `text("id").primaryKey()`, `text`, no
 * column default at all, and `timestamp(…, { withTimezone: true, mode: 'string' })`.
 * It showed `CREATE TABLE products` in a nameless schema with a `SERIAL` key,
 * against a generator that writes `"public"."products"` with a `TEXT` key and a
 * `CREATE SCHEMA "rebase"` above it. Nothing on the page was true and nothing
 * could have said so.
 *
 * So the sample is not written any more, it is **generated**. Three fenced
 * blocks are marked in the page:
 *
 *     <!-- schema-sample: collection -->   the input, which the gate evaluates
 *     <!-- schema-sample: drizzle -->      generateSchema's output
 *     <!-- schema-sample: sql -->          generatePostgresDdl's, as `drizzle/schema.sql`
 *
 * and this compares the last two against a live run of the real generators on
 * the first. `--write` puts the current output back into the page, which is how
 * a change to a generator reaches the docs: run it, read the diff, commit.
 *
 * The SQL block is generated with policies, search and vector **off**, because
 * that is exactly how `generate-postgres-ddl.ts` writes `drizzle/schema.sql` —
 * Atlas manages none of the three, and each is written to a file of its own.
 * The Drizzle block has no such switch: the CLI never strips policies from
 * `schema.generated.ts`, so neither does the page.
 *
 *     TSX_TSCONFIG_PATH=tsconfig.typecheck.json node --import tsx tooling/scripts/check-schema-sample.mjs
 *     pnpm check:schema-sample
 *     pnpm check:schema-sample --write
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectionSnippets } from "./docs-verify/collection-snippets.mjs";
import { generateSchema } from "../../packages/server-postgres/src/schema/generate-drizzle-schema-logic.ts";
import { generatePostgresDdl } from "../../packages/server-postgres/src/schema/generate-postgres-ddl-logic.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAGE = "docs/architecture/schema-as-code.md";
const CONTENT = "website/src/content/docs";
const LOCALES = ["de", "es", "fr", "it", "pt"];

/**
 * All six copies of the page.
 *
 * Not the English one alone. A fabricated `serial("id")` reads exactly as wrong
 * in German as it does in English, and the locale mirrors carried the same
 * hand-written pair for as long as the source did. The blocks are generated
 * output — the same bytes in every language — so there is nothing to translate
 * and no reason for the five to be checked more loosely than the one.
 */
const DOCS = [`${CONTENT}/${PAGE}`, ...LOCALES.map((l) => `${CONTENT}/${l}/${PAGE}`)];

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const write = process.argv.includes("--write");

/**
 * The marked blocks, as `{ marker: { body, start, end } }` where start/end are
 * offsets into the file bounding the fence's body.
 *
 * Deliberately positional rather than "the first ```sql on the page": a page
 * grows other fences, and a gate that silently retargets one is worse than one
 * that fails.
 */
function markedBlocks(text) {
    const blocks = new Map();
    const marker = /<!--\s*schema-sample:\s*([a-z]+)\s*-->\s*\n```[a-zA-Z]*[^\n]*\n/g;
    for (const m of text.matchAll(marker)) {
        const bodyStart = m.index + m[0].length;
        const fenceEnd = text.indexOf("\n```", bodyStart - 1);
        if (fenceEnd === -1) continue;
        blocks.set(m[1], { body: text.slice(bodyStart, fenceEnd + 1), start: bodyStart, end: fenceEnd + 1 });
    }
    return blocks;
}

/** What the generators emit for one page's sample collection. */
async function expectedFor(collections) {
    return {
        // The header line the CLI writes into the file is kept, and a
        // `// schema.generated.ts` line above it says which file this is.
        drizzle: `// schema.generated.ts\n${(await generateSchema(collections)).trimEnd()}\n`,
        // Exactly how `generate-postgres-ddl.ts` writes `drizzle/schema.sql`.
        sql: `${(await generatePostgresDdl(collections, {
            includePolicies: false,
            includeSearch: false,
            includeVector: false
        })).trimEnd()}\n`
    };
}

const problems = [];
const rewritten = [];
let checked = 0;

for (const doc of DOCS) {
    const docPath = path.join(ROOT, doc);
    if (!fs.existsSync(docPath)) {
        problems.push({ doc, message: "the page does not exist. A locale mirror of it is expected beside the English one." });
        continue;
    }

    const text = fs.readFileSync(docPath, "utf8");
    const blocks = markedBlocks(text);
    const missing = ["collection", "drizzle", "sql"].filter((k) => !blocks.has(k));
    if (missing.length > 0) {
        problems.push({
            doc,
            message:
                `no \`<!-- schema-sample: ${missing.join(" -->\`, no \`<!-- schema-sample: ")} -->\` marker. ` +
                "All three are needed — the collection to generate from, and the two blocks generated from it. " +
                "Without them this gate compares nothing, which is how the page drifted in the first place. " +
                "A re-translation that dropped the comments is the likely cause; put them back above the same fences."
        });
        continue;
    }

    // The sample collection is read through the same evaluator the doc-examples
    // gate uses, so a page cannot show one collection and generate from another.
    const { results } = await collectionSnippets(ROOT, { globs: [doc] });
    const collectionBody = blocks.get("collection").body.trim();
    const sample = results.find((r) => r.snippet.code.trim() === collectionBody);

    if (!sample || sample.error || sample.collections.length === 0) {
        problems.push({
            doc,
            message: `the \`schema-sample: collection\` block produced no collection${sample?.error ? ` — ${sample.error.message}` : ""}.`
        });
        continue;
    }

    checked++;
    const expected = await expectedFor(sample.collections);
    const stale = ["drizzle", "sql"].filter((key) => blocks.get(key).body !== expected[key]);
    if (stale.length === 0) continue;

    if (write) {
        // Back to front, so an earlier replacement does not move a later offset.
        let next = text;
        for (const key of ["sql", "drizzle"].filter((k) => stale.includes(k))) {
            const { start, end } = blocks.get(key);
            next = next.slice(0, start) + expected[key] + next.slice(end);
        }
        fs.writeFileSync(docPath, next);
        rewritten.push(`${doc} (${stale.join(", ")})`);
        continue;
    }

    for (const key of stale) {
        const got = blocks.get(key).body.split("\n");
        const want = expected[key].split("\n");
        const at = got.findIndex((line, i) => line !== want[i]);
        problems.push({
            doc,
            message:
                `the \`${key}\` block is not what the generator emits — first difference at line ${at + 1}:\n` +
                `        page:      ${JSON.stringify(got[at] ?? "(end of block)")}\n` +
                `        generator: ${JSON.stringify(want[at] ?? "(end of output)")}`
        });
    }
}

if (write && problems.length === 0) {
    console.log(rewritten.length === 0
        ? green("✓ Schema sample: every page already shows what the generators emit; nothing to write.")
        : green(`✓ Rewrote ${rewritten.length} page(s) from the generators. Read the diff before committing:\n    ${rewritten.join("\n    ")}`));
    process.exit(0);
}

if (problems.length === 0) {
    console.log(green(`✓ Schema sample: the drizzle and SQL blocks on all ${checked} copies of ${PAGE} are what the generators emit.`));
    process.exit(0);
}

console.error(red(`\n✗ ${problems.length} problem(s) with the schema sample:\n`));
for (const { doc, message } of problems) {
    console.error(`    ${doc}`);
    console.error(dim(`      ${message}`));
}
console.error(dim(
    "\n  Run `pnpm check:schema-sample --write` to regenerate the blocks, then read the diff:" +
    "\n  a change here is a change to what every reader of that page believes.\n"
));
process.exit(1);

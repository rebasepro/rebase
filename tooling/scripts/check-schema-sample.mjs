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
const DOC = "website/src/content/docs/docs/architecture/schema-as-code.md";

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

const docPath = path.join(ROOT, DOC);
const text = fs.readFileSync(docPath, "utf8");
const blocks = markedBlocks(text);

const missing = ["collection", "drizzle", "sql"].filter((k) => !blocks.has(k));
if (missing.length > 0) {
    console.error(red(`✗ ${DOC} has no \`<!-- schema-sample: ${missing[0]} -->\` block.`));
    console.error(dim(
        `  Expected all three of collection, drizzle, sql; missing: ${missing.join(", ")}.\n` +
        "  Without them this gate compares nothing, which is how the page drifted in the first place.\n"
    ));
    process.exit(1);
}

// The sample collection is read through the same evaluator the doc-examples gate
// uses, so the page cannot show one collection and generate from another.
const { results } = await collectionSnippets(ROOT, { globs: [DOC] });
const collectionBody = blocks.get("collection").body.trim();
const sample = results.find((r) => r.snippet.code.trim() === collectionBody);

if (!sample || sample.error || sample.collections.length === 0) {
    console.error(red(`✗ The \`schema-sample: collection\` block in ${DOC} produced no collection.`));
    if (sample?.error) console.error(dim(`  ${sample.error.message}`));
    process.exit(1);
}

const collections = sample.collections;

const expected = {
    // The header line the CLI writes into the file is kept, and a `// schema.generated.ts`
    // line above it says which file a reader is looking at.
    drizzle: `// schema.generated.ts\n${(await generateSchema(collections)).trimEnd()}\n`,
    sql: `${(await generatePostgresDdl(collections, {
        includePolicies: false,
        includeSearch: false,
        includeVector: false
    })).trimEnd()}\n`
};

const stale = [];
for (const key of ["drizzle", "sql"]) {
    if (blocks.get(key).body === expected[key]) continue;
    stale.push(key);
}

if (stale.length === 0) {
    console.log(green(`✓ Schema sample: the drizzle and SQL blocks in ${path.basename(DOC)} are what the generators emit.`));
    process.exit(0);
}

if (write) {
    // Back to front, so an earlier replacement does not move a later offset.
    let next = text;
    for (const key of ["sql", "drizzle"].filter((k) => stale.includes(k))) {
        const { start, end } = blocks.get(key);
        next = next.slice(0, start) + expected[key] + next.slice(end);
    }
    fs.writeFileSync(docPath, next);
    console.log(green(`✓ Rewrote ${stale.join(" and ")} in ${DOC} from the generators. Read the diff before committing.`));
    process.exit(0);
}

console.error(red(`\n✗ ${DOC} shows ${stale.length} block(s) the generators do not emit: ${stale.join(", ")}.\n`));
for (const key of stale) {
    const got = blocks.get(key).body.split("\n");
    const want = expected[key].split("\n");
    const at = got.findIndex((line, i) => line !== want[i]);
    console.error(`    ${key}: first difference at line ${at + 1} of the block`);
    console.error(dim(`      page:      ${JSON.stringify(got[at] ?? "(end of block)")}`));
    console.error(dim(`      generator: ${JSON.stringify(want[at] ?? "(end of output)")}`));
}
console.error(dim(
    "\n  Run `pnpm check:schema-sample --write` to regenerate the blocks, then read the diff:" +
    "\n  a change here is a change to what every reader of that page believes.\n"
));
process.exit(1);

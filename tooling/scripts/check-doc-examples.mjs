#!/usr/bin/env node
/**
 * Every collection example in the docs is a collection the server would accept.
 *
 * The docs had a whole class of example that compiles and cannot boot. `admin`
 * was introduced in 0.11 and the panel's keys moved into it, but `widget`,
 * `defaultFilter`, `fixedFilter`, `sort`, `entityActions`, `entityViews`,
 * `additionalFields`, `exportable`, `components` and `Actions` are all still
 * real names — just one level down. A fence writing one at the top of a
 * collection typechecks (excess-property checking does not reach a variable
 * that is never annotated), reads perfectly, and makes
 * `assertCollectionConfigs` refuse to start:
 *
 *     `widget` is no longer read here. `widget` belongs in the property's
 *     `admin` block — write `admin: { widget: … }`.
 *
 * Three of those were live in `collections/index.md` and `relations.md` when
 * this gate was written, next to one — `overrides: EntityOverrides` — naming a
 * type that has never existed at all.
 *
 * ## What it does
 *
 * Extracts every fenced TypeScript block in the **English** docs that declares
 * a collection (`defineCollection(`, or a `…CollectionConfig` annotation),
 * *evaluates* it with every import and free name stubbed, and hands the
 * resulting objects to `findCollectionConfigProblems` — the same function
 * `@rebasepro/server` runs at boot — with `unknownKeys: "error"`, which is the
 * strictest setting a project can ask for.
 *
 * Compiling is not enough and running is not a substitute for compiling: the
 * two gates catch different halves. `verify:docs` compiles the same fences
 * against the real types and finds a key that exists nowhere; this one finds a
 * key that exists somewhere else.
 *
 * ## Opting out
 *
 * A fence that is deliberately a fragment — an object literal cut out of a
 * larger one, with no `slug` and no intention of being pasted whole — marks
 * itself:
 *
 *     <!-- doc-examples: fragment -->
 *     ```typescript
 *     admin: { … }
 *     ```
 *
 * Every mark is an example nobody validates, so the bar is "this is not a
 * config", not "this fails".
 *
 *     TSX_TSCONFIG_PATH=tsconfig.typecheck.json node --import tsx tooling/scripts/check-doc-examples.mjs
 *     pnpm check:doc-examples
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectionSnippets } from "./docs-verify/collection-snippets.mjs";
import { findCollectionConfigProblems } from "../../packages/server/src/collections/validate-config.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const { results, fragments } = await collectionSnippets(ROOT);

const findings = [];
let collectionCount = 0;

for (const { snippet, collections, error } of results) {
    const where = `${snippet.file}:${snippet.line}`;

    if (error) {
        findings.push({
            where,
            message:
                `the example could not be evaluated — ${error.message}. A fence that cannot ` +
                "run is a fence a reader cannot paste. If it is deliberately a fragment, mark " +
                "it `<!-- doc-examples: fragment -->`."
        });
        continue;
    }

    if (collections.length === 0) {
        findings.push({
            where,
            message:
                "the example names a collection type but produced no collection object — it is " +
                "either a fragment, which should say so with `<!-- doc-examples: fragment -->`, " +
                "or a config whose `slug` went missing."
        });
        continue;
    }

    collectionCount += collections.length;
    // `"error"` rather than the default `"warn"`: a key nobody recognises may be
    // deliberate metadata in somebody's project, and is never that in a doc.
    for (const problem of findCollectionConfigProblems(collections, { unknownKeys: "error" })) {
        findings.push({ where, message: `${problem.path}: ${problem.message}` });
    }
}

if (findings.length === 0) {
    console.log(green(
        `✓ Doc examples: ${collectionCount} collection(s) across ${results.length} fence(s) ` +
        `are configs the server accepts${fragments ? ` (${fragments} marked as fragments)` : ""}.`
    ));
    process.exit(0);
}

console.error(red(`\n✗ ${findings.length} problem(s) in the docs' collection examples:\n`));
for (const { where, message } of findings) {
    console.error(`    ${where}`);
    console.error(dim(`      ${message}`));
}
console.error(dim(
    "\n  These are the errors `assertCollectionConfigs` raises at boot, against the same" +
    "\n  objects. A reader who pastes one of these examples gets a server that will not start.\n"
));
process.exit(1);

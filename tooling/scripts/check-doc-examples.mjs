#!/usr/bin/env node
/**
 * Every table example in the docs is a schema the backend would accept, and
 * every `customizeTable` example is one the panel would accept.
 *
 * The docs had a whole class of example that compiles and cannot boot. When
 * the panel's keys moved into the collection's `admin` block in 0.11,
 * `widget`, `defaultFilter`, `sort` and `entityActions` stayed real names one
 * level down, so a fence writing one at the top of a collection typechecked
 * and refused to start; three were live when the first version of this gate
 * ran. The table model has the same class in new shapes: a table without a
 * primary key, `rls: []`, `defaultPolicies: false` beside `"admin-only"`, a
 * `belongsTo` bound to a column of the wrong type, a varchar whose length
 * contradicts its `max`, a feature the planner cannot lower yet. Every one of
 * them typechecks; every one stops `rebase db generate`, `db push` and boot
 * with a `SchemaDefinitionError`.
 *
 * ## What it does
 *
 * Extracts every fenced TypeScript block in the **English** docs and the agent
 * skills that calls `defineTable`, `defineAuthTable`, `defineView` or
 * `customizeTable` — and every excerpt that builds columns — *evaluates* it
 * with the real builders (see `docs-verify/table-snippets.mjs` for what is
 * stubbed and why), and hands the definitions to `compileTables` and
 * `lowerTables`: the compiler every door that reads `backend/schema` runs, and
 * the lowering into what the planner and runtime read. `customizeTable` runs
 * for real and refuses an unknown option, a legacy `admin` name or a component
 * that is not a value.
 *
 * Compiling is not enough and running is not a substitute for compiling: the
 * two gates catch different halves. `verify:docs` compiles the same fences
 * against the real types and finds a name that exists nowhere; this one finds
 * a schema the compiler refuses.
 *
 * ## Opting out
 *
 * A fence that is deliberately not runnable marks itself:
 *
 *     <!-- doc-examples: fragment -->
 *     ```typescript
 *     relations: { … }
 *     ```
 *
 * Every mark is an example nobody validates, so the bar is "this is not a
 * schema", not "this fails".
 *
 *     TSX_TSCONFIG_PATH=tsconfig.typecheck.json node --import tsx tooling/scripts/check-doc-examples.mjs
 *     pnpm check:doc-examples
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { tableSnippets } from "./docs-verify/table-snippets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const { results, fragments } = await tableSnippets(ROOT);

const findings = [];
let tables = 0;
let customizations = 0;

for (const { snippet, problems, error, whole, ...counts } of results) {
    const where = `${snippet.file}:${snippet.line}`;
    tables += counts.tables;
    customizations += counts.customizations;

    if (error) {
        findings.push({
            where,
            message:
                `the example could not be evaluated — ${error.message}. A fence that cannot ` +
                "run is a fence a reader cannot paste." +
                (whole ? "" : " If it is deliberately not runnable, mark it `<!-- doc-examples: fragment -->`.")
        });
        continue;
    }
    if (whole && counts.tables === 0 && counts.customizations === 0) {
        findings.push({
            where,
            message:
                "the example calls a table builder or customizeTable but produced nothing — the call " +
                "is in a branch that never runs, or the fence is an excerpt that should say so with " +
                "`<!-- doc-examples: fragment -->`."
        });
        continue;
    }
    for (const message of problems) findings.push({ where, message });
}

if (tables === 0) {
    // The docs teach tables on dozens of pages; reading none means the
    // recogniser broke, not that there is nothing to check.
    console.error(red("✗ Doc examples: no table definition found in any fence — the gate is checking nothing."));
    process.exit(2);
}

if (findings.length === 0) {
    console.log(green(
        `✓ Doc examples: ${tables} table(s) and ${customizations} customization(s) across ${results.length} fence(s) ` +
        `compile, lower and customize${fragments ? ` (${fragments} marked as fragments)` : ""}.`
    ));
    process.exit(0);
}

console.error(red(`\n✗ ${findings.length} problem(s) in the docs' table examples:\n`));
for (const { where, message } of findings) {
    console.error(`    ${where}`);
    console.error(dim(`      ${message}`));
}
console.error(dim(
    "\n  These are the errors `rebase db generate`, `db push` and boot raise (or `customizeTable`" +
    "\n  throws), against the same definitions. A reader who pastes one of these examples gets" +
    "\n  a backend that will not start.\n"
));
process.exit(1);

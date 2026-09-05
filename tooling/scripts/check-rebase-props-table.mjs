#!/usr/bin/env node
/**
 * The `<Rebase>` props table on the frontend overview lists every prop, and
 * only props that exist.
 *
 * It listed ten of twenty-four, and two of the ten — `basePath` and
 * `baseCollectionPath` — were declared on `RebaseProps` and never destructured
 * by `Rebase.tsx`. So the table was simultaneously missing more than half the
 * surface and documenting two props that did nothing, which is the worst of
 * both: a reader looking for `translations` concluded it did not exist, and a
 * reader who found `basePath` set it and watched their collection views hang.
 *
 * A hand-written table drifts the moment a prop is added. This does not
 * generate the prose — a one-line description is a judgement, not a
 * projection of the type — but it does hold the *set* of rows to the set of
 * declared props, in both directions.
 *
 *     pnpm check:rebase-props
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROPS = path.join(ROOT, "packages/app/src/core/RebaseProps.tsx");
const DOC = path.join(ROOT, "website/src/content/docs/docs/frontend/index.md");

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

/** The members of `RebaseProps`, in declaration order. */
function declaredProps() {
    const source = fs.readFileSync(PROPS, "utf8");
    const start = source.indexOf("export type RebaseProps");
    if (start === -1) throw new Error("RebaseProps declaration not found");
    const body = source.slice(start);
    // Members of the top-level type literal: four-space indented `name?: ` or
    // `name: `. Nested object types are indented further and so are skipped.
    return [...body.matchAll(/^ {4}([a-zA-Z][a-zA-Z0-9]*)\??:/gm)].map(m => m[1]);
}

/** The prop names in the marked table, in document order. */
function documentedProps() {
    const doc = fs.readFileSync(DOC, "utf8");
    const start = doc.indexOf("<!-- rebase-props:start -->");
    const end = doc.indexOf("<!-- rebase-props:end -->");
    if (start === -1 || end === -1) {
        throw new Error("the rebase-props markers are missing from the frontend overview");
    }
    return [...doc.slice(start, end).matchAll(/^\| `([a-zA-Z][a-zA-Z0-9]*)`/gm)].map(m => m[1]);
}

const declared = declaredProps();
const documented = documentedProps();

const missing = declared.filter(p => !documented.includes(p));
const extra = documented.filter(p => !declared.includes(p));

if (missing.length === 0 && extra.length === 0) {
    console.log(green(`✓ <Rebase> props table: all ${declared.length} props documented, none invented.`));
    process.exit(0);
}

if (missing.length > 0) {
    console.error(red(`\n✗ ${missing.length} prop(s) of RebaseProps are not in the table:\n`));
    for (const p of missing) console.error(`    ${p}`);
}
if (extra.length > 0) {
    console.error(red(`\n✗ ${extra.length} row(s) name a prop RebaseProps does not declare:\n`));
    for (const p of extra) console.error(`    ${p}`);
}
console.error(dim(
    `\n  ${path.relative(ROOT, DOC)}, between the rebase-props markers.` +
    "\n  A prop nobody can find is a prop nobody uses; a row for a prop that does" +
    "\n  not exist is worse, because setting it looks like it should work.\n"
));
process.exit(1);

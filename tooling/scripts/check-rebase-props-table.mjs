#!/usr/bin/env node
/**
 * The props tables on the frontend overview list every prop, and only props
 * that exist.
 *
 * The `<Rebase>` table listed ten of twenty-four, and two of the ten —
 * `basePath` and `baseCollectionPath` — were declared on `RebaseProps` and never
 * destructured by `Rebase.tsx`. So the table was simultaneously missing more
 * than half the surface and documenting two props that did nothing, which is the
 * worst of both: a reader looking for `translations` concluded it did not exist,
 * and a reader who found `basePath` set it and watched their collection views
 * hang.
 *
 * `<RebaseCMS>` has a table of its own since 0.31 — `tableCustomizations`,
 * `externalCollections` and the rest are its props, declared on
 * `RebaseCMSConfig` — and it drifts the same way, so it is held the same way.
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
const DOC = "website/src/content/docs/docs/frontend/index.md";

/**
 * Each table and the declaration it documents.
 *
 * `opener` is where the declaration's body starts; its members are the
 * four-space-indented `name?:` / `name:` lines up to the first line that closes
 * it at column 0. Nested object types are indented further and so are skipped.
 */
export const TARGETS = [
    {
        component: "<Rebase>",
        source: "packages/app/src/core/RebaseProps.tsx",
        opener: /^export type RebaseProps\b[^{]*\{/m,
        marker: "rebase-props"
    },
    {
        component: "<RebaseCMS>",
        source: "packages/cms-types/src/controllers/registry.ts",
        opener: /^export interface RebaseCMSConfig\b[^{]*\{/m,
        marker: "rebase-cms-props"
    }
];

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

/** The members of the declaration, in declaration order. */
export function declaredProps(target, root = ROOT) {
    const source = fs.readFileSync(path.join(root, target.source), "utf8");
    const m = target.opener.exec(source);
    if (!m) throw new Error(`${target.opener} not found in ${target.source}`);
    const start = m.index + m[0].length;
    const end = source.indexOf("\n}", start);
    if (end === -1) throw new Error(`the declaration at ${target.opener} in ${target.source} has no closing brace`);
    const props = [...source.slice(start, end).matchAll(/^ {4}([a-zA-Z][a-zA-Z0-9]*)\??:/gm)].map(x => x[1]);
    if (props.length === 0) throw new Error(`read no members out of ${target.source} — the guard would check nothing`);
    return props;
}

/** The prop names in the marked table, in document order. */
export function documentedProps(target, root = ROOT) {
    const doc = fs.readFileSync(path.join(root, DOC), "utf8");
    const start = doc.indexOf(`<!-- ${target.marker}:start -->`);
    const end = doc.indexOf(`<!-- ${target.marker}:end -->`);
    if (start === -1 || end === -1) {
        throw new Error(`the ${target.marker} markers are missing from ${DOC}`);
    }
    return [...doc.slice(start, end).matchAll(/^\| `([a-zA-Z][a-zA-Z0-9]*)`/gm)].map(x => x[1]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    let failed = false;
    for (const target of TARGETS) {
        let declared;
        let documented;
        try {
            declared = declaredProps(target);
            documented = documentedProps(target);
        } catch (error) {
            console.error(red(`✗ ${target.component}: ${error.message}`));
            failed = true;
            continue;
        }
        const missing = declared.filter(p => !documented.includes(p));
        const extra = documented.filter(p => !declared.includes(p));
        if (missing.length === 0 && extra.length === 0) {
            console.log(green(`✓ ${target.component} props table: all ${declared.length} props documented, none invented.`));
            continue;
        }
        failed = true;
        if (missing.length > 0) {
            console.error(red(`\n✗ ${missing.length} prop(s) of ${target.component} (${target.source}) are not in the table:\n`));
            for (const p of missing) console.error(`    ${p}`);
        }
        if (extra.length > 0) {
            console.error(red(`\n✗ ${extra.length} row(s) of the ${target.component} table name a prop ${target.source} does not declare:\n`));
            for (const p of extra) console.error(`    ${p}`);
        }
        console.error(dim(`\n  ${DOC}, between the ${target.marker} markers.`));
    }
    if (failed) {
        console.error(dim(
            "\n  A prop nobody can find is a prop nobody uses; a row for a prop that does" +
            "\n  not exist is worse, because setting it looks like it should work.\n"
        ));
        process.exit(1);
    }
}

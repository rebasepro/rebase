#!/usr/bin/env node
/**
 * Every per-property `admin` option is on the properties page.
 *
 * The sibling of `check:rebase-props`, pointed at the other hand-written table
 * of a declared type: `packages/cms-types/src/types/property_options.ts` against
 * `collections/properties.mdx`. It listed 30 of 36 keys, and four of the six it
 * missed — `locale`, `minimumFractionDigits`, `maximumFractionDigits`,
 * `notation` — appeared in no English page at all. A number column could be
 * formatted as compact currency in the reader's own locale and there was no way
 * to find that out short of reading the `.d.ts`.
 *
 * One direction only, like its sibling: a key on the page that the interfaces do
 * not declare is caught by `check:prose-types` and by the snippet typechecker,
 * and flagging every extra row here would fire on the prose around the tables.
 *
 *     pnpm check:property-options
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TYPES = path.join(ROOT, "packages/cms-types/src/types/property_options.ts");
const DOC = path.join(ROOT, "website/src/content/docs/docs/collections/properties.mdx");

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

/**
 * The interfaces whose keys a collection author writes.
 *
 * Everything in the module that is an `admin` block or is reachable from one.
 * `PreviewType` and the like are unions rather than option bags and have no keys
 * to document.
 */
const INTERFACE = /^export interface ((?:Admin\w*Options|NumberFormatOptions|PropertyDisabledConfig))\b[^{]*\{/gm;

/** `{ interface: [key, …] }`, in declaration order. */
function declaredOptions() {
    const source = fs.readFileSync(TYPES, "utf8");
    /** @type {Map<string, string[]>} */
    const out = new Map();
    for (const m of source.matchAll(INTERFACE)) {
        const start = m.index + m[0].length;
        const end = source.indexOf("\n}", start);
        if (end === -1) throw new Error(`${m[1]} has no closing brace`);
        const body = source.slice(start, end);
        // Members at one indent level. A nested object type is indented further
        // and so is skipped; each of those has an interface of its own here.
        out.set(m[1], [...body.matchAll(/^ {4}([a-zA-Z][a-zA-Z0-9]*)\??:/gm)].map(x => x[1]));
    }
    return out;
}

const declared = declaredOptions();
if (declared.size === 0) {
    console.error(red(`✗ Read no interfaces out of ${path.relative(ROOT, TYPES)} — the guard is checking nothing.`));
    process.exit(2);
}

const doc = fs.readFileSync(DOC, "utf8");
/** A key is documented when the page names it in backticks, bare or under a prefix. */
const documented = new Set(
    [...doc.matchAll(/`(?:admin\.|format\.)?([a-zA-Z][a-zA-Z0-9]*)`/g)].map(m => m[1])
);

const missing = [];
let total = 0;
for (const [iface, keys] of declared) {
    for (const key of keys) {
        total++;
        if (!documented.has(key)) missing.push(`${iface}.${key}`);
    }
}

if (missing.length === 0) {
    console.log(green(`✓ Property options: all ${total} key(s) across ${declared.size} interface(s) are on the properties page.`));
    process.exit(0);
}

console.error(red(`\n✗ ${missing.length} of ${total} property option(s) are on no row of the properties page:\n`));
for (const key of missing) console.error(`    ${key}`);
console.error(dim(
    `\n  ${path.relative(ROOT, DOC)}, declared in ${path.relative(ROOT, TYPES)}.` +
    "\n  An option nobody can find is an option nobody uses, and four of these" +
    "\n  appeared in no English page at all when this check was written.\n"
));
process.exit(1);

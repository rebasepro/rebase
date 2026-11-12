#!/usr/bin/env node
/**
 * How much of the authoring surface is documented where an editor can show it?
 *
 * These are the types and builders a person writes a table against, and the
 * *only* place most of them are ever explained is the hover in an editor. A field with
 * no JSDoc is a field whose meaning has to be guessed from its name — which is
 * how `readOnly` and `disabled` came to be used interchangeably (they are not:
 * one renders a value, the other renders a greyed-out control that can clear
 * itself), and how `clearable` got copied onto properties whose fields have no
 * clear button.
 *
 * Counted, rather than argued about, because "add JSDoc" is the kind of task
 * that is 80% done forever. A ratchet is the only version of it that holds.
 *
 *     pnpm check:jsdoc-coverage
 *     pnpm check:jsdoc-coverage --list     # name the bare fields
 *
 * ## What counts
 *
 * A **member**: a property or method signature inside an exported
 * `interface`, object `type` or `class`, or a member of an exported object
 * literal (`export const col = { … }`), in one of the files below. Methods
 * count since the authoring surface became a builder: `col.text()`,
 * `.notNull()` and `rel.belongsTo()` are methods, and the hover on them is the
 * whole explanation a reader gets. Not call signatures, not `constructor`,
 * not `private`/`protected` members, not anything in a `.test.ts`.
 *
 * A field is **documented** when the lines immediately above it are a `/** … *\/`
 * block, or when it is the member of an interface whose *own* one-line purpose
 * covers it (there is no such exemption today; the block has to be on the
 * field).
 *
 * A `@deprecated`-only block still counts as documented: it says the one thing
 * a reader most needs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The authoring surface, as files.
 *
 * Deliberately not "every exported interface in the monorepo". These are what
 * somebody writes by hand: a table in `backend/schema/*.ts` (`defineTable`,
 * `col.*`, `rel.*`, `json.*`, the column, table and hook options) and its
 * panel customization in `frontend/src/cms/*.tsx` (`customizeTable`), where an
 * undocumented member is a question with no answer short of reading the
 * implementation. The wire descriptors, the inference helpers and the
 * collection view model the panel builds internally are excluded — their
 * readers have the code.
 */
const TARGETS = [
    "packages/types/src/schema/columns.ts",
    "packages/types/src/schema/column_options.ts",
    "packages/types/src/schema/json.ts",
    "packages/types/src/schema/relations.ts",
    "packages/types/src/schema/table.ts",
    "packages/types/src/schema/table_options.ts",
    "packages/types/src/schema/hooks.ts",
    "packages/cms-types/src/table_customization.ts"
];

/**
 * Containers in those files that nobody writes: the builder's recorded state
 * and the structural "any table" shapes the compiler accepts. Each is read
 * through the builder that fills it, whose methods are counted and carry the
 * explanation. Named one by one, with the reason, so the list cannot grow into
 * a way to exclude a real authoring type.
 */
const NOT_AUTHORED = new Map([
    ["ColumnDef", "what a column builder has recorded — filled by `col.*` and its modifiers, which are documented"],
    ["ColumnStorage", "a storage column's options as stored and served (bucket by key, bytes) — `StorageOptions` is what is written"],
    ["AnyTableDef", "the structural shape `compileTables` accepts any table as — a `defineTable` result, never written"],
    ["AnyViewDef", "the same for views"],
    ["CustomizableTable", "the structural constraint `customizeTable<typeof t>` checks a table against — never written"]
]);

/** The ceiling. Lower it when the number falls; never raise it. */
const MAX_BARE_PERCENT = 5;

const red = (s) => `[31m${s}[0m`;
const green = (s) => `[32m${s}[0m`;
const dim = (s) => `[2m${s}[0m`;

/**
 * Fields of the exported interfaces and object type aliases in one file.
 *
 * A hand-rolled scan rather than the TypeScript compiler API: this repository
 * cannot adopt TS 7's compiler API yet (see the memory note), and the shape
 * being matched — a property signature at one indent level inside a braced
 * block — is regular enough that a parser would be borrowed weight. It reads
 * the file the way the reader does.
 */
function fieldsOf(file) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    const lines = source.split("\n");

    const fields = [];
    let container = null;
    let depth = 0;

    // Only a declaration whose line *ends* in `{` opens a container. A
    // multi-line union (`export type Property =`) opens nothing, and treating it
    // as a container was enough to swallow the rest of the file: every later
    // declaration was skipped as "already inside one", and the scan reported
    // zero fields for `properties.ts` while looking like it worked.
    const OPENER = /^export\s+(?:declare\s+)?(?:(?:abstract\s+)?(?:interface|type|class)|const)\s+([A-Za-z0-9_]+)\b.*\{\s*$/;
    // `name?: type`, `name: type`, `name(…)` or `name<T>(…)` at exactly one
    // level of indentation. `private`/`protected` members do not match: the
    // keyword is followed by a space, not by `:` or `(`.
    const FIELD = /^ {4}(?:readonly\s+|static\s+|async\s+)*([A-Za-z_$][A-Za-z0-9_$]*)\??\s*[:(<]/;
    /** A comment line. Its braces are prose — `@example` blocks are full of them. */
    const isComment = (line) => {
        const t = line.trim();
        return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
    };
    /**
     * A field pinned to one literal — `type: "string"`, `kind: "belongsTo"`,
     * `writable: true`.
     *
     * Exempt, because the value *is* the sentence. These are discriminants and
     * the narrowings of them that each union member carries; the field itself is
     * documented once, on the base interface, and repeating "always
     * `"belongsTo"`" eleven times would add lines and no information. A ceiling
     * that counts them measures how many unions a file has, not how much of it
     * is explained.
     */
    const LITERAL_PIN = /:\s*("[^"]*"|'[^']*'|true|false|-?\d+)\s*;?\s*$/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isComment(line)) continue;

        if (container === null) {
            const opener = OPENER.exec(line);
            if (opener) {
                container = opener[1];
                depth = 1;
            }
            continue;
        }

        if (depth === 1) {
            const field = LITERAL_PIN.test(line) ? null : FIELD.exec(line);
            // An overload repeats a name already counted; `constructor` is
            // not something a reader writes.
            const repeated = field && fields.some(f => f.container === container && f.name === field[1]);
            if (field && !repeated && field[1] !== "constructor") {
                const previous = lines[i - 1]?.trim() ?? "";
                fields.push({
                    container,
                    name: field[1],
                    line: i + 1,
                    documented: previous === "*/" || previous.startsWith("/**")
                });
            }
        }

        // Track braces so a nested object literal's members are not counted as
        // fields of the container — they belong to an inline shape, which is a
        // different (and much smaller) surface.
        depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
        if (depth <= 0) container = null;
    }

    return fields;
}

const list = process.argv.includes("--list");

let total = 0;
const bare = [];

for (const file of TARGETS) {
    for (const field of fieldsOf(file)) {
        if (NOT_AUTHORED.has(field.container)) continue;
        total += 1;
        if (!field.documented) bare.push({ ...field, file });
    }
}

if (total === 0) {
    // A ratchet over nothing is a green light. The scan finding no fields means
    // the files moved or the pattern broke, not that everything is documented.
    console.error(red("✗ No fields found — the scan is broken, not the surface."));
    process.exit(1);
}

const percent = (bare.length / total) * 100;

if (list) {
    for (const field of bare) {
        console.log(`${field.file}:${field.line}  ${field.container}.${field.name}`);
    }
    console.log("");
}

console.log(dim(`Scanned ${total} authoring field(s) across ${TARGETS.length} file(s).`));

if (percent > MAX_BARE_PERCENT) {
    console.error(red(
        `\n✗ ${bare.length} of ${total} (${percent.toFixed(1)}%) carry no JSDoc — over the ${MAX_BARE_PERCENT}% ceiling.`
    ));
    console.error(dim("\n  These types are authored by hand and read through an editor's hover."));
    console.error(dim("  Name them: pnpm check:jsdoc-coverage --list\n"));
    process.exit(1);
}

console.log(green(`✓ ${bare.length} of ${total} authoring field(s) bare (${percent.toFixed(1)}%), under the ${MAX_BARE_PERCENT}% ceiling.`));

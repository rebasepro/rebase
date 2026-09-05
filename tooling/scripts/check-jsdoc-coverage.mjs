#!/usr/bin/env node
/**
 * How much of the authoring surface is documented where an editor can show it?
 *
 * These are the types a person writes a collection against, and the *only*
 * place most of them are ever explained is the hover in an editor. A field with
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
 * A **field**: a property signature inside an exported `interface` or object
 * `type` in one of the files below. Not methods, not call signatures, not
 * anything in a `.test.ts`.
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
 * Deliberately not "every exported interface in the monorepo". These are the
 * types somebody writes by hand in `config/collections/*.ts`, where an
 * undocumented field is a question with no answer short of reading the
 * implementation. Runtime and internal types are excluded — their readers have
 * the code.
 */
const TARGETS = [
    "packages/types/src/types/properties.ts",
    "packages/types/src/types/relations.ts",
    "packages/cms-types/src/types/property_options.ts"
];

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
    const OPENER = /^export\s+(?:declare\s+)?(?:interface|type)\s+([A-Za-z0-9_]+)\b.*\{\s*$/;
    // `name?: type` or `name: type` at exactly one level of indentation.
    const FIELD = /^ {4}(?:readonly\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\??\s*:/;
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
            if (field) {
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

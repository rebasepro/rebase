#!/usr/bin/env node
/**
 * Every key `customizeTable` accepts is on the customization reference.
 *
 * The sibling of `check:rebase-props`, pointed at the other hand-written table
 * of a declared type: the option interfaces of `customizeTable` against
 * `frontend/customize-table.md`. When it read the per-property `admin` options
 * of the collection model it found the reference listing 30 of 36 keys, and
 * four of the six it missed — `locale`, `minimumFractionDigits`,
 * `maximumFractionDigits`, `notation` — appeared in no English page at all. A
 * number column could be formatted as compact currency in the reader's own
 * locale and there was no way to find that out short of reading the `.d.ts`.
 *
 * Since 0.31 the panel's options are no longer an `admin` block on a backend
 * collection: they are what `customizeTable(slug, { … })` takes, in
 * `frontend/src/cms/*.tsx`, declared in `packages/cms-types/src/table_customization.ts`.
 * Several of them are methods (`dynamicProps?(props)`, `fileName?(context)`),
 * which a reader writes exactly like a key, so a member is a key whether it is
 * written `name?:` or `name?(`.
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

/**
 * The interfaces whose keys a `customizeTable` call writes, by the file that
 * declares them.
 *
 * Everything the options object is or reaches: the table-level options, the
 * per-field options of each column kind, and the shapes their keys take
 * (`display`, `form`, `kanban`, an enum's labels). Type aliases (`TableFields`,
 * `EnumLabels`) are unions or mapped types with no keys of their own.
 * `NumberFormatOptions` is still declared beside the collection model's
 * property options, and a number field's `format` takes it unchanged.
 */
const SOURCES = [
    {
        file: "packages/cms-types/src/table_customization.ts",
        interfaces: [
            "TableCustomizationOptions",
            "FieldOptions",
            "TextFieldOptions",
            "EnumFieldOptions",
            "NumberFieldOptions",
            "DateFieldOptions",
            "VectorFieldOptions",
            "StorageFieldOptions",
            "ArrayFieldOptions",
            "JsonFieldOptions",
            "EnumLabelOptions",
            "RelationFieldOptions",
            "StorageCustomization",
            "EnumLabel",
            "FieldDisabled",
            "TableKanban",
            "TableDisplay",
            "TableFormSection",
            "TableFormLayout",
            "TableFormView",
            "TableAdditionalField"
        ]
    },
    {
        file: "packages/cms-types/src/types/property_options.ts",
        interfaces: ["NumberFormatOptions"]
    }
];

/** The customization reference. A page added here is a page the reference grew. */
const DOCS = [
    "website/src/content/docs/docs/frontend/customize-table.md"
].map((rel) => path.join(ROOT, rel));

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

/**
 * Members at one indent level — a property (`name?:`) or a method (`name?(`).
 * A nested object type is indented further and so is skipped; each of those
 * has an interface of its own in the list above.
 */
const MEMBER = /^ {4}(\w+)\??[:(]/gm;

/**
 * `{ interface: [key, …] }`, in declaration order.
 *
 * @param {string} root
 * @returns {Map<string, string[]>}
 */
export function declaredOptions(root = ROOT) {
    /** @type {Map<string, string[]>} */
    const out = new Map();
    for (const { file, interfaces } of SOURCES) {
        const source = fs.readFileSync(path.join(root, file), "utf8");
        for (const name of interfaces) {
            const m = new RegExp(`^export interface ${name}\\b[^{]*\\{`, "m").exec(source);
            if (!m) throw new Error(`${name} is not an exported interface in ${file} — the list in this script is stale.`);
            const start = m.index + m[0].length;
            const end = source.indexOf("\n}", start);
            if (end === -1) throw new Error(`${name} in ${file} has no closing brace`);
            const keys = [...source.slice(start, end).matchAll(MEMBER)].map(x => x[1]);
            if (keys.length === 0) throw new Error(`${name} in ${file} declares no member this scan can read.`);
            out.set(name, keys);
        }
    }
    return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    let declared;
    try {
        declared = declaredOptions();
    } catch (error) {
        console.error(red(`✗ ${error.message}`));
        process.exit(2);
    }

    const doc = DOCS.map((f) => fs.readFileSync(f, "utf8")).join("\n");
    /** A key is documented when the page names it in backticks, bare or under a prefix. */
    const documented = new Set(
        [...doc.matchAll(/`(?:[a-zA-Z]+\.)*([a-zA-Z][a-zA-Z0-9]*)(?:\(\))?`/g)].map(m => m[1])
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
        console.log(green(`✓ Customization options: all ${total} key(s) across ${declared.size} interface(s) are on the customization reference.`));
        process.exit(0);
    }

    console.error(red(`\n✗ ${missing.length} of ${total} customization option(s) are on no row of the reference:\n`));
    for (const key of missing) console.error(`    ${key}`);
    console.error(dim(
        `\n  ${DOCS.map((f) => path.relative(ROOT, f)).join(", ")}, declared in ` +
        `${SOURCES.map(s => s.file).join(" and ")}.` +
        "\n  An option nobody can find is an option nobody uses, and four of these" +
        "\n  appeared in no English page at all when this check was written.\n"
    ));
    process.exit(1);
}

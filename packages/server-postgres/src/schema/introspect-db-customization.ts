/**
 * The `frontend/src/cms/<table>.tsx` introspection writes beside a table whose
 * structure suggested how the panel should show it: a `customizeTable(…)` of
 * plain data (an icon, a group, a title field, a board, a sort, the list and
 * form order, field options).
 *
 * A minimal emitter on purpose. Its values are strings, booleans, arrays and
 * nested objects — never code — so it needs none of the CLI codemod's
 * customization printer (which handles functions and JSX, and which this
 * package must not depend on).
 *
 * @module
 */

/** A value this emitter prints: data only. */
export type CustomizationValue = string | number | boolean | readonly CustomizationValue[] | { readonly [key: string]: CustomizationValue | undefined };

/** The package `customizeTable` is imported from. */
export const CMS_PACKAGE = "@rebasepro/cms";

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const key = (name: string): string => IDENTIFIER.test(name) ? name : JSON.stringify(name);

/** One value as source, four-space indented, `depth` levels in. Short scalar arrays stay on one line. */
export function printCustomizationValue(value: CustomizationValue, depth = 0): string {
    const pad = "    ".repeat(depth + 1);
    const close = "    ".repeat(depth);
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) {
        const items: readonly CustomizationValue[] = value;
        if (items.length === 0) return "[]";
        const scalars = items.every(item => typeof item !== "object");
        const inline = `[${items.map(item => printCustomizationValue(item, depth)).join(", ")}]`;
        if (scalars && inline.length <= 80) return inline;
        return `[\n${items.map(item => `${pad}${printCustomizationValue(item, depth + 1)}`).join(",\n")}\n${close}]`;
    }
    const entries = Object.entries(value).filter((entry): entry is [string, CustomizationValue] => entry[1] !== undefined);
    if (entries.length === 0) return "{}";
    return `{\n${entries.map(([name, item]) => `${pad}${key(name)}: ${printCustomizationValue(item, depth + 1)}`).join(",\n")}\n${close}}`;
}

/** What {@link printCustomizationModule} prints. */
export interface CustomizationModule {
    /** The table's slug, `customizeTable`'s first argument. */
    slug: string;
    /** The identifier the table is exported as from its schema module. */
    tableIdentifier: string;
    /** The schema module, relative to the customization file, without extension: `../../../backend/schema/film`. */
    tableImport: string;
    /** The options: plain data. */
    options: { readonly [key: string]: CustomizationValue | undefined };
    /** Comment lines written above the export. */
    comments?: readonly string[];
}

/**
 * The whole module:
 *
 * ```ts
 * import { customizeTable } from "@rebasepro/cms";
 * import type { film } from "../../../backend/schema/film";
 *
 * export const filmCms = customizeTable<typeof film>("film", { … });
 * ```
 */
export function printCustomizationModule(module: CustomizationModule): string {
    const comments = (module.comments ?? []).map(line => `// ${line.replace(/\s*[\r\n]+\s*/g, " ")}`);
    return [
        `import { customizeTable } from ${JSON.stringify(CMS_PACKAGE)};`,
        `import type { ${module.tableIdentifier} } from ${JSON.stringify(module.tableImport)};`,
        "",
        ...comments,
        `export const ${module.tableIdentifier}Cms = customizeTable<typeof ${module.tableIdentifier}>(${JSON.stringify(module.slug)}, ${printCustomizationValue(module.options)});`,
        ""
    ].join("\n");
}

/**
 * `customizeTable`: a frontend file's deltas over the collection a Postgres
 * table projects to (POSTGRES-FIRST.md §6.2).
 *
 * The types do the heavy checking — every key that names a field is checked
 * against `typeof table` — so the runtime half is cheap and exists for the
 * cases the compiler cannot see: a JavaScript caller, the untyped form, and the
 * habits of the old `admin` block (a string component path, a lazy thunk,
 * `propertiesOrder`). Each is refused with a message that says what to write.
 */
import {
    FIELD_COMPONENT_KEYS,
    FIELD_CUSTOMIZATION_KEYS,
    TABLE_CUSTOMIZATION_BRAND,
    TABLE_CUSTOMIZATION_KEYS,
    type CustomizableTable,
    type TableCustomization,
    type TableCustomizationOptions,
    type TableSlug
} from "@rebasepro/cms-types";

/** Old `admin` names, and what each is called in `customizeTable`. */
const RENAMED_TABLE_KEYS: Readonly<Record<string, string>> = {
    admin: "the same options at the top level — `customizeTable` has no `admin` block",
    propertiesOrder: "`fieldOrder`",
    listProperties: "`listFields`",
    previewProperties: "`previewFields`",
    properties: "`fields`",
    orderProperty: "`kanban.orderField`",
    titleProperty: "`display.title`",
    slug: "the first argument of `customizeTable`",
    callbacks: "`hooks` on `defineTable` (server hooks never ship to the browser)",
    securityRules: "`rls` on `defineTable`"
};

/** Old property and property-`admin` names, and what each is called in a field customization. */
const RENAMED_FIELD_KEYS: Readonly<Record<string, string>> = {
    admin: "the same options directly on the field — a field customization has no `admin` block",
    hideFromCollection: "`hidden`",
    previewProperties: "`previewFields`",
    properties: "`fields`",
    propertiesOrder: "`fieldOrder`",
    enum: "`enumLabels` (the values themselves are the column's, on `defineTable`)",
    validation: "`.validate({ … })` / `.notNull()` on the column",
    storagePath: "`storage.path`",
    type: "the column's builder on `defineTable`",
    relation: "`relations` on `defineTable`",
    userSelect: "`.userId()` on the column in `backend/schema` (who may pick users is a schema fact the server reads)"
};

const TABLE_KEYS: ReadonlySet<string> = new Set(TABLE_CUSTOMIZATION_KEYS);
const FIELD_KEYS: ReadonlySet<string> = new Set(FIELD_CUSTOMIZATION_KEYS);
const COMPONENT_KEYS: ReadonlySet<string> = new Set(FIELD_COMPONENT_KEYS);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Levenshtein distance, for "did you mean". */
function distance(a: string, b: string): number {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let previous = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const current = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1));
            previous = current;
        }
    }
    return row[b.length];
}

function suggestion(key: string, known: ReadonlySet<string>, renamed: Readonly<Record<string, string>>): string {
    if (Object.prototype.hasOwnProperty.call(renamed, key)) return ` — it is ${renamed[key]} now`;
    let best: string | undefined;
    let bestDistance = 3;
    for (const candidate of known) {
        const d = distance(key, candidate);
        if (d < bestDistance) {
            best = candidate;
            bestDistance = d;
        }
    }
    return best ? ` — did you mean \`${best}\`?` : "";
}

function refuseUnknownKeys(
    value: Record<string, unknown>,
    known: ReadonlySet<string>,
    renamed: Readonly<Record<string, string>>,
    where: string
): void {
    const unknown = Object.keys(value).filter(key => !known.has(key));
    if (unknown.length === 0) return;
    const lines = unknown.map(key => `  - \`${key}\`${suggestion(key, known, renamed)}`);
    throw new Error(`${where}: unknown option${unknown.length > 1 ? "s" : ""}:\n${lines.join("\n")}`);
}

/** The source of a function, for telling a lazy `() => import(…)` thunk from a component. */
function sourceOf(fn: unknown): string {
    try {
        return Function.prototype.toString.call(fn);
    } catch {
        return "";
    }
}

/** A function of no parameters… */
const NO_PARAMETERS = /^\s*(?:async\s*)?(?:function\s*\w*\s*)?\(\s*\)/;
/** …that loads a module: `import(…)` as written, or the `require(…)` a CommonJS build turns it into. */
const LOADS_A_MODULE = /\bimport\s*\(|\brequire\s*\(/;

function isLazyThunk(fn: unknown): boolean {
    const source = sourceOf(fn);
    return NO_PARAMETERS.test(source) && LOADS_A_MODULE.test(source);
}

const BY_VALUE =
    "Components are imported by value now: `import { MyField } from \"./MyField\"`, then pass `MyField` itself. " +
    "A frontend customization runs only in the browser, so string paths and lazy `() => import(…)` thunks are gone.";

/**
 * Refuse anything that is not a React component value: a string path, a lazy
 * thunk, or a plain object.
 */
function assertComponent(value: unknown, where: string): void {
    if (value === undefined) return;
    if (typeof value === "string") {
        throw new Error(`${where} is the string ${JSON.stringify(value)}. ${BY_VALUE}`);
    }
    if (typeof value === "function") {
        if (isLazyThunk(value)) throw new Error(`${where} is a lazy import thunk. ${BY_VALUE}`);
        return;
    }
    // `memo`, `forwardRef` and `lazy` return objects tagged with `$$typeof`.
    if (isRecord(value) && "$$typeof" in value) return;
    throw new Error(`${where} is not a React component. ${BY_VALUE}`);
}

function validateField(value: unknown, where: string): void {
    if (value === undefined) return;
    if (!isRecord(value)) throw new Error(`${where} must be an object of field options, got ${JSON.stringify(value)}.`);
    refuseUnknownKeys(value, FIELD_KEYS, RENAMED_FIELD_KEYS, where);
    for (const key of COMPONENT_KEYS) assertComponent(value[key], `${where}.${key}`);
    if (value.referenceTo !== undefined && (typeof value.referenceTo !== "string" || value.referenceTo.length === 0)) {
        throw new Error(`${where}.referenceTo must be the slug of the collection the column points at.`);
    }
    if (value.dynamicProps !== undefined && typeof value.dynamicProps !== "function") {
        throw new Error(`${where}.dynamicProps must be a function of the record's values.`);
    }
    for (const nested of ["fields", "oneOf"] as const) {
        const map = value[nested];
        if (map === undefined) continue;
        if (!isRecord(map)) throw new Error(`${where}.${nested} must be an object keyed by ${nested === "fields" ? "key" : "variant"}.`);
        for (const [key, field] of Object.entries(map)) validateField(field, `${where}.${nested}.${key}`);
    }
    validateField(value.of, `${where}.of`);
    if (value.overrides !== undefined) validateOptions(value.overrides, `${where}.overrides`, false);
}

function validateEntries(value: unknown, where: string, check: (entry: Record<string, unknown>, at: string) => void): void {
    if (value === undefined) return;
    if (!Array.isArray(value)) throw new Error(`${where} must be a list.`);
    value.forEach((entry: unknown, index) => {
        if (typeof entry === "string") return;
        const at = `${where}[${index}]`;
        if (!isRecord(entry)) throw new Error(`${at} must be an object or the key of one registered app-wide.`);
        check(entry, at);
    });
}

function validateOptions(options: unknown, where: string, allowFields: boolean): void {
    if (!isRecord(options)) throw new Error(`${where} needs an object of options.`);
    refuseUnknownKeys(options, TABLE_KEYS, RENAMED_TABLE_KEYS, where);
    if (!allowFields && options.fields !== undefined) {
        throw new Error(`${where}.fields: a relation's \`overrides\` restyle the tab, not the target's fields. Customize the target table's fields with its own \`customizeTable\`.`);
    }

    const kanban = options.kanban;
    if (kanban !== undefined) {
        if (!isRecord(kanban)) throw new Error(`${where}.kanban must be \`{ columnField, orderField }\`.`);
        refuseUnknownKeys(kanban, new Set(["columnField", "orderField"]), { columnProperty: "`columnField`", orderProperty: "`orderField`" }, `${where}.kanban`);
        if (typeof kanban.columnField !== "string") throw new Error(`${where}.kanban.columnField must name the column the board groups by.`);
    }

    validateEntries(options.entityActions, `${where}.entityActions`, (action, at) => {
        if (typeof action.name !== "string") throw new Error(`${at} needs a \`name\`.`);
        if (typeof action.onClick !== "function") throw new Error(`${at} needs an \`onClick\` function.`);
    });
    validateEntries(options.entityViews, `${where}.entityViews`, (view, at) => assertComponent(view.Builder, `${at}.Builder`));
    validateEntries(options.customViews, `${where}.customViews`, (view, at) => {
        if (view.Builder === undefined) throw new Error(`${at} needs a \`Builder\` component.`);
        assertComponent(view.Builder, `${at}.Builder`);
    });

    const formView = options.formView;
    if (formView !== undefined) {
        if (!isRecord(formView)) throw new Error(`${where}.formView must be \`{ Builder }\`.`);
        assertComponent(formView.Builder, `${where}.formView.Builder`);
    }

    const actions = options.Actions;
    if (actions !== undefined) {
        if (!Array.isArray(actions)) throw new Error(`${where}.Actions must be a list of components.`);
        actions.forEach((component: unknown, index) => assertComponent(component, `${where}.Actions[${index}]`));
    }

    const components = options.components;
    if (components !== undefined) {
        if (!isRecord(components)) throw new Error(`${where}.components must be an object keyed by component name.`);
        for (const [name, override] of Object.entries(components)) {
            if (!isRecord(override)) throw new Error(`${where}.components["${name}"] must be \`{ Component, wrap? }\`.`);
            assertComponent(override.Component, `${where}.components["${name}"].Component`);
        }
    }

    const display = options.display;
    if (display !== undefined) {
        if (!isRecord(display)) throw new Error(`${where}.display must be an object of slots.`);
        for (const [slot, source] of Object.entries(display)) {
            if (source !== undefined && typeof source !== "string" && typeof source !== "function") {
                throw new Error(`${where}.display.${slot} must be a field path or a resolver function.`);
            }
        }
    }

    const fields = options.fields;
    if (fields !== undefined) {
        if (!isRecord(fields)) throw new Error(`${where}.fields must be an object keyed by column or relation.`);
        for (const [key, field] of Object.entries(fields)) validateField(field, `${where}.fields.${key}`);
    }
}

/** Freeze a plain object in place; components and functions are left alone. */
function freezeRecord(value: unknown): void {
    if (isRecord(value) && !("$$typeof" in value)) Object.freeze(value);
}

/**
 * State what a table's default collection should look like in the panel.
 *
 * The first argument is the table's slug — the name it was defined under,
 * unless `defineTable` was given another `slug`. With the type parameter every
 * key that names a field, every enum label and every entity action's `row` is
 * checked against the table:
 *
 * ```tsx
 * export const postsCms = customizeTable<typeof posts>("posts", {
 *     icon: "FileText",
 *     kanban: { columnField: "status", orderField: "__order" },
 *     fields: { content: { Field: CustomMarkdownEditor } },
 * });
 * ```
 *
 * The slug is read from the table's type: for
 * `defineTable("blog_posts", { slug: "posts", … })` the first argument is
 * `"posts"`, still with the one type argument. Without a type argument the
 * slug is any string and the options are accepted loosely typed.
 *
 * The result is frozen; pass it to `<RebaseCMS tableCustomizations>`. Unknown
 * options, legacy `admin` names and components that are not values throw here,
 * with what to write instead.
 *
 * @group Tables
 */
export function customizeTable<T extends CustomizableTable | undefined = undefined>(
    slug: TableSlug<T>,
    options: NoInfer<TableCustomizationOptions<T>>
): TableCustomization<T> {
    if (typeof slug !== "string" || slug.length === 0) {
        throw new Error("`customizeTable(slug, options)` needs the slug of the table it customizes as its first argument.");
    }
    const where = `customizeTable("${slug}")`;
    validateOptions(options, where, true);

    const fields: unknown = options.fields;
    if (isRecord(fields)) {
        for (const field of Object.values(fields)) freezeRecord(field);
        Object.freeze(fields);
    }
    for (const key of ["kanban", "display", "form", "components"] as const) freezeRecord(options[key]);

    return Object.freeze({ ...options, brand: TABLE_CUSTOMIZATION_BRAND, table: slug });
}

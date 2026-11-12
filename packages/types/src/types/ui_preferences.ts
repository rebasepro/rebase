/**
 * UI preferences: how a table is presented in the panel, stored as data.
 *
 * A table's schema lives in `backend/schema/*.ts`; how the panel presents it
 * (labels, icon, column order and widths, hidden columns, the default view
 * mode, enum labels and colours …) is a customization. Code customizations are
 * written with `customizeTable` in the frontend. What the collection editor and
 * the views change at runtime is stored as a {@link UiTablePreferences} delta —
 * for the whole workspace, or for one user — and folded in after the code
 * customizations, in this order:
 *
 *   projected table → `tableCustomizations` (code) → workspace preferences → user preferences
 *
 * Every key here is one `customizeTable` accepts, with a JSON value only: no
 * function, component or resolver can arrive this way. Schema facts (column
 * types, validation, enum values, rules, `description`) are never stored here;
 * they are schema edits (`TablePatch`).
 *
 * @module
 */
import type { WhereFilterOp } from "./filter-operators";

/**
 * Where a preference applies: to everybody in the workspace, or to one user.
 *
 * @group UI preferences
 */
export type UiPreferenceScope = "workspace" | "user";

/**
 * The label (and colour) of one enum value. A colour is a chip colour key
 * (`"green"`, `"orangeDark"`).
 *
 * @group UI preferences
 */
export interface UiEnumLabel {
    label: string;
    color?: string;
    disabled?: boolean;
}

/**
 * How one field is presented: the data-only subset of a field customization.
 *
 * @group UI preferences
 */
export interface UiFieldPreferences {
    name?: string;
    hidden?: boolean;
    hiddenInForm?: boolean;
    disabled?: boolean;
    readOnly?: boolean;
    columnWidth?: number;
    span?: 1 | 2 | 3 | 4;
    multiline?: boolean;
    markdown?: boolean;
    previewAsTag?: boolean;
    clearable?: boolean;
    urlPreview?: boolean | "image" | "video" | "audio" | "file";
    mode?: "date" | "date_time";
    timezone?: string;
    enumLabels?: { [value: string]: string | UiEnumLabel };
    enumOrder?: (string | number)[];
    expanded?: boolean;
    minimalistView?: boolean;
    sortable?: boolean;
    canAddElements?: boolean;
    spreadChildren?: boolean;
    keyValue?: boolean;
    previewFields?: string[];
    fieldOrder?: string[];
    widget?: "select" | "dialog";
    includeId?: boolean;
    includeEntityLink?: boolean;
    referenceTo?: string;
    /** JSON-logic conditions (`{ disabled, hidden, readOnly, required … }`). */
    conditions?: { [key: string]: UiJsonValue };
    /** A JSON document's keys. */
    fields?: { [key: string]: UiFieldPreferences };
    /** An array's items. */
    of?: UiFieldPreferences;
}

/**
 * A JSON value, as conditions carry them.
 *
 * @group UI preferences
 */
export type UiJsonValue = string | number | boolean | null | UiJsonValue[] | { [key: string]: UiJsonValue };

/**
 * The record slots of a table, each naming a field.
 *
 * @group UI preferences
 */
export interface UiDisplayPreferences {
    title?: string;
    subtitle?: string;
    image?: string;
    status?: string;
    date?: string;
    tags?: string;
}

/**
 * One sort: the field, the direction, and where nulls go.
 *
 * @group UI preferences
 */
export type UiSortTuple = [string, "asc" | "desc"] | [string, "asc" | "desc", "first" | "last"];

/**
 * A filter on one field: an operator and its value, or several.
 *
 * @group UI preferences
 */
export type UiFilterCondition = [WhereFilterOp, UiJsonValue];

/**
 * How one table is presented: the data-only subset of `customizeTable`'s
 * options. A stored preference is a delta: what it names replaces what the
 * code customization says, key by key (`fields` field by field).
 *
 * @group UI preferences
 */
export interface UiTablePreferences {
    name?: string;
    singularName?: string;
    icon?: string;
    group?: string;
    hideFromNavigation?: boolean;
    hideFromEntityViews?: boolean;
    defaultViewMode?: string;
    enabledViews?: string[];
    defaultSize?: "xs" | "s" | "m" | "l" | "xl";
    kanban?: { columnField: string; orderField?: string };
    fieldOrder?: string[];
    listFields?: string[];
    previewFields?: string[];
    display?: UiDisplayPreferences;
    hideIdFromCollection?: boolean;
    /** The default sort. */
    sort?: UiSortTuple | UiSortTuple[];
    /** The filter a visitor starts from. */
    defaultFilter?: { [field: string]: UiFilterCondition | UiFilterCondition[] };
    pagination?: boolean | number;
    inlineEditing?: boolean;
    selectionEnabled?: boolean;
    exportable?: boolean;
    openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";
    defaultEntityAction?: "view" | "edit";
    sideDialogWidth?: number | string;
    defaultSelectedView?: string;
    formAutoSave?: boolean;
    alwaysApplyDefaultValues?: boolean;
    includeJsonView?: boolean;
    localChangesBackup?: "manual_apply" | "auto_apply" | false;
    hideIdFromForm?: boolean;
    /** Registered entity actions, by key. */
    entityActions?: string[];
    disableDefaultActions?: ("edit" | "copy" | "delete")[];
    /** Registered entity views, by key. */
    entityViews?: string[];
    /** Registered collection views, by key. */
    customViews?: string[];
    fields?: { [key: string]: UiFieldPreferences };
}

/**
 * Every key a {@link UiTablePreferences} may hold, as data: what the server
 * validates a stored preference by.
 *
 * @group UI preferences
 */
export const UI_PREFERENCE_TABLE_KEYS = [
    "alwaysApplyDefaultValues", "customViews", "defaultEntityAction", "defaultFilter", "defaultSelectedView", "defaultSize",
    "defaultViewMode", "disableDefaultActions", "display", "enabledViews", "entityActions", "entityViews",
    "exportable", "fieldOrder", "fields", "formAutoSave", "group", "hideFromEntityViews", "hideFromNavigation",
    "hideIdFromCollection", "hideIdFromForm", "icon", "includeJsonView", "inlineEditing", "kanban", "listFields",
    "localChangesBackup", "name", "openEntityMode", "pagination", "previewFields", "selectionEnabled",
    "sideDialogWidth", "singularName", "sort"
] as const satisfies readonly (keyof UiTablePreferences)[];

/**
 * Every key a {@link UiFieldPreferences} may hold, as data.
 *
 * @group UI preferences
 */
export const UI_PREFERENCE_FIELD_KEYS = [
    "canAddElements", "clearable", "columnWidth", "conditions", "disabled", "enumLabels", "enumOrder", "expanded",
    "fieldOrder", "fields", "hidden", "hiddenInForm", "includeEntityLink", "includeId", "keyValue", "markdown",
    "minimalistView", "mode", "multiline", "name", "of", "previewAsTag", "previewFields", "readOnly",
    "referenceTo", "sortable", "span", "spreadChildren", "timezone", "urlPreview", "widget"
] as const satisfies readonly (keyof UiFieldPreferences)[];

/** Compiles only when `T` is `never`. */
type AssertNever<T extends never = never> = T;
/** An interface key the table list does not name fails to compile. */
type _EveryTableKeyIsListed = AssertNever<Exclude<keyof UiTablePreferences, typeof UI_PREFERENCE_TABLE_KEYS[number]>>;
/** An interface key the field list does not name fails to compile. */
type _EveryFieldKeyIsListed = AssertNever<Exclude<keyof UiFieldPreferences, typeof UI_PREFERENCE_FIELD_KEYS[number]>>;

/**
 * One problem with a preference delta: the path to the value, and what is
 * wrong with it.
 *
 * @group UI preferences
 */
export interface UiPreferenceProblem {
    path: string;
    message: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
const isStringList = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every(item => typeof item === "string");

type Check = (value: unknown, path: string, out: UiPreferenceProblem[]) => void;

const expect = (ok: (value: unknown) => boolean, what: string): Check => (value, path, out) => {
    if (!ok(value)) out.push({ path, message: `must be ${what}.` });
};
const oneOf = (...allowed: readonly (string | number | boolean)[]): Check =>
    expect(value => allowed.some(a => a === value), allowed.map(a => JSON.stringify(a)).join(" | "));
const boolean = /*#__PURE__*/ expect(value => typeof value === "boolean", "a boolean");
const string = /*#__PURE__*/ expect(value => typeof value === "string", "a string");
const stringList = /*#__PURE__*/ expect(isStringList, "a list of strings");
const positiveNumber = /*#__PURE__*/ expect(value => typeof value === "number" && Number.isFinite(value) && value > 0, "a positive number");

function isJson(value: unknown, depth = 0): boolean {
    if (depth > 32) return false;
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(item => isJson(item, depth + 1));
    if (isRecord(value)) return Object.values(value).every(item => isJson(item, depth + 1));
    return false;
}

const enumLabels: Check = (value, path, out) => {
    if (!isRecord(value)) {
        out.push({ path, message: "must map enum values to labels." });
        return;
    }
    for (const [key, label] of Object.entries(value)) {
        if (typeof label === "string") continue;
        if (!isRecord(label) || typeof label.label !== "string"
            || (label.color !== undefined && typeof label.color !== "string")
            || (label.disabled !== undefined && typeof label.disabled !== "boolean")
            || Object.keys(label).some(k => k !== "label" && k !== "color" && k !== "disabled")) {
            out.push({ path: `${path}.${key}`, message: "must be a label, or `{ label, color?, disabled? }` with a chip colour key." });
        }
    }
};

const fieldMap: Check = (value, path, out) => {
    if (!isRecord(value)) {
        out.push({ path, message: "must map field keys to field preferences." });
        return;
    }
    for (const [key, field] of Object.entries(value)) fieldProblems(field, `${path}.${key}`, out);
};

/**
 * The checks, built on first use: module-level calls would keep this file in
 * every bundle that imports `@rebasepro/types`, whether it validates a
 * preference or not.
 */
let builtChecks: { field: Readonly<Record<typeof UI_PREFERENCE_FIELD_KEYS[number], Check>>; table: Readonly<Record<typeof UI_PREFERENCE_TABLE_KEYS[number], Check>> } | undefined;
function checks(): NonNullable<typeof builtChecks> {
    builtChecks ??= { field: fieldChecks(), table: tableChecks() };
    return builtChecks;
}

const fieldChecks = (): Readonly<Record<typeof UI_PREFERENCE_FIELD_KEYS[number], Check>> => ({
    name: string,
    hidden: boolean,
    hiddenInForm: boolean,
    disabled: boolean,
    readOnly: boolean,
    columnWidth: positiveNumber,
    span: oneOf(1, 2, 3, 4),
    multiline: boolean,
    markdown: boolean,
    previewAsTag: boolean,
    clearable: boolean,
    urlPreview: oneOf(true, false, "image", "video", "audio", "file"),
    mode: oneOf("date", "date_time"),
    timezone: string,
    enumLabels,
    enumOrder: expect(value => Array.isArray(value) && value.every(item => typeof item === "string" || typeof item === "number"), "a list of enum values"),
    expanded: boolean,
    minimalistView: boolean,
    sortable: boolean,
    canAddElements: boolean,
    spreadChildren: boolean,
    keyValue: boolean,
    previewFields: stringList,
    fieldOrder: stringList,
    widget: oneOf("select", "dialog"),
    includeId: boolean,
    includeEntityLink: boolean,
    referenceTo: string,
    conditions: expect(value => isRecord(value) && isJson(value), "an object of JSON-logic rules"),
    fields: fieldMap,
    of: (value, path, out) => fieldProblems(value, path, out)
});

const tableChecks = (): Readonly<Record<typeof UI_PREFERENCE_TABLE_KEYS[number], Check>> => ({
    name: string,
    singularName: string,
    icon: string,
    group: string,
    hideFromNavigation: boolean,
    hideFromEntityViews: boolean,
    defaultViewMode: string,
    enabledViews: stringList,
    defaultSize: oneOf("xs", "s", "m", "l", "xl"),
    kanban: expect(value => isRecord(value) && typeof value.columnField === "string"
        && (value.orderField === undefined || typeof value.orderField === "string")
        && Object.keys(value).every(k => k === "columnField" || k === "orderField"), "`{ columnField, orderField? }`"),
    fieldOrder: stringList,
    listFields: stringList,
    previewFields: stringList,
    display: expect(value => isRecord(value) && Object.entries(value).every(([slot, field]) =>
        ["title", "subtitle", "image", "status", "date", "tags"].includes(slot) && typeof field === "string"),
    "an object naming a field for each of title, subtitle, image, status, date, tags"),
    hideIdFromCollection: boolean,
    sort: expect(value => isSortTuple(value) || (Array.isArray(value) && value.length > 0 && value.every(isSortTuple)), "`[field, \"asc\" | \"desc\"]` or a list of them"),
    defaultFilter: expect(value => isRecord(value) && Object.values(value).every(condition =>
        isCondition(condition) || (Array.isArray(condition) && condition.length > 0 && condition.every(isCondition))),
    "an object of `[operator, value]` conditions by field"),
    pagination: expect(value => typeof value === "boolean" || (typeof value === "number" && Number.isInteger(value) && value > 0), "a boolean or a page size"),
    inlineEditing: boolean,
    selectionEnabled: boolean,
    exportable: boolean,
    openEntityMode: oneOf("side_panel", "full_screen", "split", "dialog"),
    defaultEntityAction: oneOf("view", "edit"),
    sideDialogWidth: expect(value => typeof value === "string" || (typeof value === "number" && value > 0), "a width"),
    defaultSelectedView: string,
    formAutoSave: boolean,
    alwaysApplyDefaultValues: boolean,
    includeJsonView: boolean,
    localChangesBackup: oneOf("manual_apply", "auto_apply", false),
    hideIdFromForm: boolean,
    entityActions: stringList,
    disableDefaultActions: expect(value => Array.isArray(value) && value.every(item => item === "edit" || item === "copy" || item === "delete"), "a list of \"edit\" | \"copy\" | \"delete\""),
    entityViews: stringList,
    customViews: stringList,
    fields: fieldMap
});

const FILTER_OPS: readonly string[] = [
    "<", "<=", "==", "!=", ">=", ">", "array-contains", "in", "not-in", "array-contains-any", "array-contains-all",
    "array-contained-by", "like", "ilike", "not-like", "not-ilike", "is-null", "is-not-null"
] satisfies readonly WhereFilterOp[];

const isSortTuple = (value: unknown): boolean => Array.isArray(value)
    && (value.length === 2 || value.length === 3)
    && typeof value[0] === "string"
    && (value[1] === "asc" || value[1] === "desc")
    && (value.length === 2 || value[2] === "first" || value[2] === "last");

const isCondition = (value: unknown): boolean => Array.isArray(value)
    && value.length === 2 && typeof value[0] === "string" && FILTER_OPS.includes(value[0]) && isJson(value[1]);

const isFieldKey = (key: string): key is typeof UI_PREFERENCE_FIELD_KEYS[number] =>
    (UI_PREFERENCE_FIELD_KEYS as readonly string[]).includes(key);
const isTableKey = (key: string): key is typeof UI_PREFERENCE_TABLE_KEYS[number] =>
    (UI_PREFERENCE_TABLE_KEYS as readonly string[]).includes(key);

function fieldProblems(value: unknown, path: string, out: UiPreferenceProblem[]): void {
    if (!isRecord(value)) {
        out.push({ path, message: "must be an object of field preferences." });
        return;
    }
    for (const [key, entry] of Object.entries(value)) {
        if (!isFieldKey(key)) {
            out.push({ path: `${path}.${key}`, message: `is not a field preference. A field preference is one of ${UI_PREFERENCE_FIELD_KEYS.join(", ")}; schema facts (type, validation, enum values, description) are schema edits, and components are written in code.` });
            continue;
        }
        if (entry === undefined) continue;
        checks().field[key](entry, `${path}.${key}`, out);
    }
}

/**
 * Every problem with a table's preference delta as it arrived: a key that is
 * not a preference (a schema fact, a component, a misspelling) or a value of
 * the wrong shape. Empty when it may be stored.
 *
 * @group UI preferences
 */
export function uiTablePreferencesProblems(value: unknown): UiPreferenceProblem[] {
    const out: UiPreferenceProblem[] = [];
    if (!isRecord(value)) return [{ path: "", message: "must be an object of table preferences." }];
    for (const [key, entry] of Object.entries(value)) {
        if (!isTableKey(key)) {
            out.push({ path: key, message: `is not a table preference. A table preference is one of ${UI_PREFERENCE_TABLE_KEYS.join(", ")}; schema facts (columns, rules, description, history) are schema edits, and code (actions, components, callbacks) is written in code.` });
            continue;
        }
        if (entry === undefined) continue;
        checks().table[key](entry, key, out);
    }
    return out;
}

/**
 * Whether a value is a well-formed {@link UiTablePreferences} delta.
 *
 * @group UI preferences
 */
export function isUiTablePreferences(value: unknown): value is UiTablePreferences {
    return uiTablePreferencesProblems(value).length === 0;
}

/**
 * One delta over another: what `over` names replaces what `base` says, key by
 * key, and `fields` (and a field's nested `fields` / `of`) field by field.
 *
 * @group UI preferences
 */
export function mergeUiTablePreferences(base: UiTablePreferences, over: UiTablePreferences): UiTablePreferences {
    const out: UiTablePreferences = { ...base, ...over };
    if (base.fields || over.fields) out.fields = mergeFieldMaps(base.fields, over.fields);
    return out;
}

function mergeFieldMaps(
    base: UiTablePreferences["fields"],
    over: UiTablePreferences["fields"]
): { [key: string]: UiFieldPreferences } {
    const out: { [key: string]: UiFieldPreferences } = { ...base };
    for (const [key, field] of Object.entries(over ?? {})) {
        out[key] = out[key] ? mergeField(out[key], field) : field;
    }
    return out;
}

function mergeField(base: UiFieldPreferences, over: UiFieldPreferences): UiFieldPreferences {
    const out: UiFieldPreferences = { ...base, ...over };
    if (base.fields || over.fields) out.fields = mergeFieldMaps(base.fields, over.fields);
    if (base.of && over.of) out.of = mergeField(base.of, over.of);
    if (base.enumLabels && over.enumLabels) out.enumLabels = { ...base.enumLabels, ...over.enumLabels };
    return out;
}

/**
 * The preferences of a workspace or a user, by table slug.
 *
 * @group UI preferences
 */
export interface UiPreferences {
    tables: { [slug: string]: UiTablePreferences };
}

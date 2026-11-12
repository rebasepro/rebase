/**
 * One edit in the collection editor, split into what it changes about the
 * table and what it changes about how the panel presents it.
 *
 * The editor edits one collection view model at a time — the panel's flat
 * collection of `Property`s, projected from the table the server serves and
 * customized. Saving it is two different writes (POSTGRES-FIRST.md §6.4):
 *
 * - **Schema** — column types, nullability, defaults, validation, enum values,
 *   storage rules, relations, row-level security, `history`, `description` —
 *   is a list of {@link TablePatch} operations for the server's schema editor,
 *   which edits `backend/schema/*.ts` and nothing else.
 * - **Presentation** — labels, icon, group, view modes, column order, hidden
 *   columns, widths, enum labels and colours, kanban — is a
 *   {@link UiTablePreferences} delta, stored as a UI preference (a JSON UI
 *   config in development, `rebase.ui_preferences` when deployed).
 *
 * Nothing presentational is ever sent to the schema routes and nothing about
 * the schema is ever stored as a preference: the presentation keys are exactly
 * `UI_PREFERENCE_TABLE_KEYS` / `UI_PREFERENCE_FIELD_KEYS`, every one of them a
 * `customizeTable` key (checked at compile time below).
 *
 * The module is pure: given the collection before and after, and the table as
 * served, it returns the two writes, or throws {@link SplitEditError} for an
 * edit that is not an edit (renaming a slug is a migration).
 *
 * @module
 */
import type {
    EnumValueConfig,
    EnumValues,
    Properties,
    Property,
    Relation,
    SecurityRule,
    TableDescriptor,
    TablePatch,
    UiDisplayPreferences,
    UiFieldPreferences,
    UiTablePreferences,
    WireColumnDef,
    WireRelation,
    UI_PREFERENCE_FIELD_KEYS,
    UI_PREFERENCE_TABLE_KEYS
} from "@rebasepro/types";
import { isRedactedSecurityRule, isUiTablePreferences, rulePatches } from "@rebasepro/types";
import type { AdminCollection, FIELD_CUSTOMIZATION_KEYS, TABLE_CUSTOMIZATION_KEYS } from "@rebasepro/cms-types";
import {
    PropertyNotAColumnError,
    wireColumnFromProperty,
    wireColumnOfDescriptor,
    wireRelationFromRelation,
    wireRelationOfDescriptor
} from "./property_column";

// ── The key partition is the customization's ────────────────────────────────

/** Compiles only when `T` is `never`. */
type AssertNever<T extends never = never> = T;
/** Every table preference is a `customizeTable` key. */
type _TablePreferencesAreCustomizations = AssertNever<Exclude<typeof UI_PREFERENCE_TABLE_KEYS[number], typeof TABLE_CUSTOMIZATION_KEYS[number]>>;
/** Every field preference is a field customization key. */
type _FieldPreferencesAreCustomizations = AssertNever<Exclude<typeof UI_PREFERENCE_FIELD_KEYS[number], typeof FIELD_CUSTOMIZATION_KEYS[number]>>;

// ── The result ──────────────────────────────────────────────────────────────

/**
 * What one save of the collection editor writes.
 */
export interface SplitEdit {
    /** The table slug the edit is about. */
    table: string;
    /** The schema editor's operations, in the order they apply. Empty when the schema is unchanged. */
    schema: TablePatch[];
    /** The presentation delta: only the keys the edit changed. Empty when nothing presentational changed. */
    presentation: UiTablePreferences;
    /**
     * The table's rules come from `defaultRls` and the edit gives it rules of
     * its own: saving detaches it from the inherited rules. The caller asks
     * before sending a schema edit with this set.
     */
    detachesInheritedRules?: true;
}

/**
 * Why an edit cannot be split into a schema edit and a presentation delta.
 *
 * - `MIGRATION_REQUIRED` — the slug, the SQL table or the database changed:
 *   that moves data, which is a migration.
 * - `NOT_A_COLUMN` — a property has no column equivalent on a table.
 * - `REDACTED_RULES` — the caller was served rules it may not read, so it may
 *   not write them back.
 * - `NO_PRIMARY_KEY` — a new table names no primary key.
 * - `EXTERNAL_COLLECTION` — the collection is not a table of this backend:
 *   it is defined in the frontend, which the schema editor does not write.
 */
export class SplitEditError extends Error {
    constructor(
        readonly code: "MIGRATION_REQUIRED" | "NOT_A_COLUMN" | "REDACTED_RULES" | "NO_PRIMARY_KEY" | "EXTERNAL_COLLECTION",
        message: string,
        readonly key?: string
    ) {
        super(message);
        this.name = "SplitEditError";
    }
}

/** What {@link splitEdit} reads. */
export interface SplitEditInput {
    /** The collection as the editor loaded it; absent for a new table. */
    before?: AdminCollection;
    /** The collection as the editor is saving it. */
    after: AdminCollection;
    /** The table as the server serves it: the facts the view model cannot carry are kept from it. */
    table?: TableDescriptor;
}

// ── Small helpers ───────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** Deep equality of the JSON-like values a collection holds. Functions compare by identity. */
export function sameValue(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (a instanceof RegExp && b instanceof RegExp) return a.source === b.source && a.flags === b.flags;
    if (Array.isArray(a) || Array.isArray(b)) {
        return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
    }
    if (!isRecord(a) || !isRecord(b)) return false;
    const keys = Object.keys(a).filter(key => a[key] !== undefined);
    const other = Object.keys(b).filter(key => b[key] !== undefined);
    return keys.length === other.length && keys.every(key => sameValue(a[key], b[key]));
}

const stringsOnly = (value: unknown): string[] | undefined =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;

function setIf<T, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
    if (value !== undefined) target[key] = value;
}

// ── Presentation: table level ───────────────────────────────────────────────

function displayOf(collection: AdminCollection): UiDisplayPreferences | undefined {
    const display = collection.display;
    if (!isRecord(display)) return undefined;
    const out: UiDisplayPreferences = {};
    for (const slot of ["title", "subtitle", "image", "status", "date", "tags"] as const) {
        const value = display[slot];
        if (typeof value === "string") out[slot] = value;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

const VIEW_SIZES = ["xs", "s", "m", "l", "xl"] as const;
const ENTITY_MODES = ["side_panel", "full_screen", "split", "dialog"] as const;
const isOneOf = <T extends string>(allowed: readonly T[], value: unknown): value is T =>
    typeof value === "string" && (allowed as readonly string[]).includes(value);

/**
 * The table-level presentation a collection states, in the preference
 * vocabulary (`propertiesOrder` → `fieldOrder`, `kanban.columnProperty` →
 * `kanban.columnField`, …). Code-valued options (an action object, a
 * resolver) are not data and are left out.
 */
export function tablePresentationOf(collection: AdminCollection): UiTablePreferences {
    const c = collection;
    const out: UiTablePreferences = {};
    setIf(out, "name", c.name);
    setIf(out, "singularName", c.singularName);
    if (typeof c.icon === "string") out.icon = c.icon;
    setIf(out, "group", c.group);
    setIf(out, "hideFromNavigation", c.hideFromNavigation);
    setIf(out, "hideFromEntityViews", c.hideFromEntityViews);
    setIf(out, "defaultViewMode", c.defaultViewMode);
    setIf(out, "enabledViews", c.enabledViews ? [...c.enabledViews] : undefined);
    if (isOneOf(VIEW_SIZES, c.defaultSize)) out.defaultSize = c.defaultSize;
    const columnField = c.kanban?.columnProperty;
    if (typeof columnField === "string") {
        out.kanban = { columnField, ...(typeof c.orderProperty === "string" ? { orderField: c.orderProperty } : {}) };
    }
    setIf(out, "fieldOrder", c.propertiesOrder ? [...c.propertiesOrder] : undefined);
    setIf(out, "listFields", c.listProperties ? [...c.listProperties] : undefined);
    setIf(out, "previewFields", c.previewProperties ? [...c.previewProperties] : undefined);
    setIf(out, "display", displayOf(c));
    setIf(out, "hideIdFromCollection", c.hideIdFromCollection);
    // Query defaults are data only when they hold JSON values.
    const query = { sort: c.sort, defaultFilter: c.defaultFilter };
    if (isUiTablePreferences(query)) {
        setIf(out, "sort", query.sort);
        setIf(out, "defaultFilter", query.defaultFilter);
    }
    setIf(out, "pagination", c.pagination);
    setIf(out, "inlineEditing", c.inlineEditing);
    setIf(out, "selectionEnabled", c.selectionEnabled);
    if (typeof c.exportable === "boolean") out.exportable = c.exportable;
    if (isOneOf(ENTITY_MODES, c.openEntityMode)) out.openEntityMode = c.openEntityMode;
    setIf(out, "defaultEntityAction", c.defaultEntityAction);
    setIf(out, "sideDialogWidth", c.sideDialogWidth);
    if (typeof c.defaultSelectedView === "string") out.defaultSelectedView = c.defaultSelectedView;
    setIf(out, "formAutoSave", c.formAutoSave);
    setIf(out, "alwaysApplyDefaultValues", c.alwaysApplyDefaultValues);
    setIf(out, "includeJsonView", c.includeJsonView);
    setIf(out, "localChangesBackup", c.localChangesBackup);
    setIf(out, "hideIdFromForm", c.hideIdFromForm);
    setIf(out, "entityActions", stringsOnly(c.entityActions));
    setIf(out, "disableDefaultActions", c.disableDefaultActions ? [...c.disableDefaultActions] : undefined);
    setIf(out, "entityViews", stringsOnly(c.entityViews));
    setIf(out, "customViews", stringsOnly(c.customViews));
    return out;
}

// ── Presentation: field level ───────────────────────────────────────────────

/** A property's enum values as a list, whichever form they were written in. */
function enumList(values: EnumValues | undefined): EnumValueConfig[] {
    if (values === undefined) return [];
    if (Array.isArray(values)) return values;
    return Object.entries(values).map(([id, value]) => typeof value === "string" ? { id, label: value } : { ...value, id });
}

/**
 * The presentation of one property, in the preference vocabulary. `admin.*`
 * keys keep their names except `hideFromCollection` (`hidden`),
 * `disabled.hidden` (`hiddenInForm`) and `previewProperties`
 * (`previewFields`).
 */
export function fieldPresentationOf(property: Property): UiFieldPreferences {
    const out: UiFieldPreferences = {};
    setIf(out, "name", property.name);
    const admin = property.admin;
    if (admin) {
        setIf(out, "hidden", admin.hideFromCollection);
        if (typeof admin.disabled === "boolean") out.disabled = admin.disabled;
        else if (isRecord(admin.disabled) && typeof admin.disabled.hidden === "boolean") out.hiddenInForm = admin.disabled.hidden;
        setIf(out, "readOnly", admin.readOnly);
        setIf(out, "columnWidth", admin.columnWidth);
        setIf(out, "span", admin.span);
        if ("multiline" in admin) setIf(out, "multiline", admin.multiline);
        if ("markdown" in admin) setIf(out, "markdown", admin.markdown);
        if ("previewAsTag" in admin) setIf(out, "previewAsTag", admin.previewAsTag);
        if ("clearable" in admin) setIf(out, "clearable", admin.clearable);
        if ("urlPreview" in admin) setIf(out, "urlPreview", admin.urlPreview);
        if ("expanded" in admin) setIf(out, "expanded", admin.expanded);
        if ("minimalistView" in admin) setIf(out, "minimalistView", admin.minimalistView);
        if ("sortable" in admin) setIf(out, "sortable", admin.sortable);
        if ("canAddElements" in admin) setIf(out, "canAddElements", admin.canAddElements);
        if ("spreadChildren" in admin) setIf(out, "spreadChildren", admin.spreadChildren);
        if ("previewProperties" in admin) setIf(out, "previewFields", admin.previewProperties ? [...admin.previewProperties] : undefined);
        if ("widget" in admin) setIf(out, "widget", admin.widget);
        if ("includeId" in admin) setIf(out, "includeId", admin.includeId);
        if ("includeEntityLink" in admin) setIf(out, "includeEntityLink", admin.includeEntityLink);
    }
    if (property.conditions && isRecord(property.conditions)) {
        const conditions: NonNullable<UiFieldPreferences["conditions"]> = {};
        for (const [key, value] of Object.entries(property.conditions)) {
            if (isJsonValue(value)) conditions[key] = value;
        }
        if (Object.keys(conditions).length > 0) out.conditions = conditions;
    }
    if (property.type === "reference" && property.path) out.referenceTo = property.path;
    if (property.type === "date") {
        setIf(out, "mode", property.mode);
        setIf(out, "timezone", property.timezone);
    }
    if (property.type === "map") {
        setIf(out, "keyValue", property.keyValue);
        setIf(out, "fieldOrder", property.propertiesOrder ? [...property.propertiesOrder] : undefined);
        if (property.properties) {
            const fields: NonNullable<UiFieldPreferences["fields"]> = {};
            for (const [key, nested] of Object.entries(property.properties)) {
                const presentation = fieldPresentationOf(nested);
                if (Object.keys(presentation).length > 0) fields[key] = presentation;
            }
            if (Object.keys(fields).length > 0) out.fields = fields;
        }
    }
    if (property.type === "array" && property.of && !Array.isArray(property.of)) {
        const of = fieldPresentationOf(property.of);
        if (Object.keys(of).length > 0) out.of = of;
    }
    if ((property.type === "string" || property.type === "number") && property.enum !== undefined) {
        const labels: NonNullable<UiFieldPreferences["enumLabels"]> = {};
        for (const value of enumList(property.enum)) {
            const color = typeof value.color === "string" ? value.color : undefined;
            labels[String(value.id)] = color !== undefined || value.disabled !== undefined
                ? { label: value.label, ...(color !== undefined ? { color } : {}), ...(value.disabled !== undefined ? { disabled: value.disabled } : {}) }
                : value.label;
        }
        out.enumLabels = labels;
        out.enumOrder = enumList(property.enum).map(value => value.id);
    }
    return out;
}

function isJsonValue(value: unknown, depth = 0): value is NonNullable<UiFieldPreferences["conditions"]>[string] {
    if (depth > 32) return false;
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(item => isJsonValue(item, depth + 1));
    if (isRecord(value)) return Object.values(value).every(item => isJsonValue(item, depth + 1));
    return false;
}

/** What changed between two field presentations: the keys of `after` that differ, nested maps field by field. */
function fieldDelta(before: UiFieldPreferences, after: UiFieldPreferences): UiFieldPreferences {
    const out: UiFieldPreferences = {};
    for (const key of Object.keys(after)) {
        if (key === "fields" || key === "of" || key === "enumLabels" || key === "enumOrder") continue;
        copyIfChanged(out, before, after, key);
    }
    if (after.fields) {
        const fields: NonNullable<UiFieldPreferences["fields"]> = {};
        for (const [key, nested] of Object.entries(after.fields)) {
            const delta = fieldDelta(before.fields?.[key] ?? {}, nested);
            if (Object.keys(delta).length > 0) fields[key] = delta;
        }
        if (Object.keys(fields).length > 0) out.fields = fields;
    }
    if (after.of) {
        const of = fieldDelta(before.of ?? {}, after.of);
        if (Object.keys(of).length > 0) out.of = of;
    }
    if (after.enumLabels) {
        const labels: NonNullable<UiFieldPreferences["enumLabels"]> = {};
        for (const [value, label] of Object.entries(after.enumLabels)) {
            if (!sameValue(before.enumLabels?.[value], label)) labels[value] = label;
        }
        if (Object.keys(labels).length > 0) out.enumLabels = labels;
    }
    // The order is presentation only while the values are the same set; a new
    // or removed value is a schema change and carries its own order.
    if (after.enumOrder && before.enumOrder && !sameValue(before.enumOrder, after.enumOrder)
        && sameValue([...before.enumOrder].map(String).sort(), [...after.enumOrder].map(String).sort())) {
        out.enumOrder = after.enumOrder;
    }
    return out;
}

/** `out[key] = after[key]` when it differs from `before[key]`, for a key both objects share by type. */
function copyIfChanged<T extends object>(out: T, before: T, after: T, key: string): void {
    const next: unknown = Reflect.get(after, key);
    if (next !== undefined && !sameValue(Reflect.get(before, key), next)) Reflect.set(out, key, next);
}

/** What changed between two table presentations. */
function tableDelta(before: UiTablePreferences, after: UiTablePreferences): UiTablePreferences {
    const out: UiTablePreferences = {};
    for (const key of Object.keys(after)) {
        if (key === "fields") continue;
        copyIfChanged(out, before, after, key);
    }
    return out;
}

// ── Schema: columns and relations ───────────────────────────────────────────

/** The relations a collection states, by name: its relation properties and its `relations` list. */
function relationsOf(collection: AdminCollection): Map<string, { relation: Relation; property?: Property }> {
    const out = new Map<string, { relation: Relation; property?: Property }>();
    const listed: unknown = "relations" in collection ? collection.relations : undefined;
    for (const relation of Array.isArray(listed) ? listed : []) {
        if (isRelation(relation) && relation.relationName) out.set(relation.relationName, { relation });
    }
    for (const [key, property] of Object.entries(collection.properties ?? {})) {
        if (property.type === "relation" && property.relation) {
            out.set(property.relation.relationName ?? key, { relation: property.relation, property });
        }
    }
    return out;
}

const isRelation = (value: unknown): value is Relation =>
    isRecord(value) && typeof value.kind === "string" && typeof value.target === "function";

/** The column properties of a collection, in order. */
function columnsOf(collection: AdminCollection): [string, Property][] {
    const properties: Properties = collection.properties ?? {};
    return Object.entries(properties).filter(([, property]) => property.type !== "relation");
}

/** The wire form of a column property, read over the column as served. */
function wireOf(key: string, property: Property, served: Map<string, WireColumnDef>): WireColumnDef {
    try {
        return wireColumnFromProperty(key, property, served.get(key));
    } catch (error) {
        if (error instanceof PropertyNotAColumnError) throw new SplitEditError("NOT_A_COLUMN", error.message, error.key);
        throw error;
    }
}

function wireRelationOf(name: string, entry: { relation: Relation; property?: Property }, served: Map<string, WireRelation>): WireRelation {
    try {
        return wireRelationFromRelation(name, entry.relation, {
            base: served.get(name),
            required: entry.relation.kind === "belongsTo" && entry.property ? entry.property.validation?.required === true : undefined,
            access: entry.property?.access
        });
    } catch (error) {
        if (error instanceof PropertyNotAColumnError) throw new SplitEditError("NOT_A_COLUMN", error.message, error.key);
        throw error;
    }
}

// ── Schema: rules ───────────────────────────────────────────────────────────

const hasRedacted = (rules: readonly SecurityRule[] | undefined): boolean => (rules ?? []).some(isRedactedSecurityRule);

/**
 * The `rls` operations for an edit of the rules tab.
 *
 * The tab shows the table's effective rules: the declared ones, and the ones
 * the platform adds (the admin baseline, tenant scoping). Only the declared
 * ones are written, and a declared rule the edit left as it was is sent back
 * exactly as served, so {@link rulePatches} leaves its text — and its
 * policy's name, a hash of the rule as written — alone.
 */
function rlsPatches(
    slug: string,
    before: readonly SecurityRule[],
    after: readonly SecurityRule[],
    table: TableDescriptor | undefined
): { patches: TablePatch[]; detaches: boolean } {
    if (sameValue(before, after)) return { patches: [], detaches: false };
    if (hasRedacted(before) || hasRedacted(after)) {
        throw new SplitEditError("REDACTED_RULES",
            `The rules of "${slug}" were served to you redacted, so they cannot be written back from here. Ask an admin, or edit them in backend/schema.`, "rls");
    }
    const declared = table && table.rls.posture === "rules" ? table.rls.rules : table ? [] : [...before];
    // Which of the effective rules shown are declared ones, by position.
    const declaredAt = new Map<number, SecurityRule>();
    const usedDeclared = new Set<number>();
    before.forEach((rule, index) => {
        const match = declared.findIndex((candidate, i) => !usedDeclared.has(i) && sameValue(candidate, rule));
        if (match >= 0) {
            usedDeclared.add(match);
            declaredAt.set(index, declared[match]);
        }
    });
    const injected = before.filter((_, index) => !declaredAt.has(index));
    const written = after
        .filter(rule => !injected.some(added => sameValue(added, rule)))
        .map(rule => declared.find(candidate => sameValue(candidate, rule)) ?? rule);

    const inherited = table?.rls.inherited === true;
    if (inherited) {
        return written.length === 0 || sameValue(written, declared)
            ? { patches: [], detaches: false }
            : { patches: [{ op: "setRls", table: slug, rls: [written[0], ...written.slice(1)] }], detaches: true };
    }
    if (written.length === 0) {
        return declared.length === 0 ? { patches: [], detaches: false } : { patches: [{ op: "setRls", table: slug, rls: "admin-only" }], detaches: false };
    }
    if (declared.length === 0) {
        return { patches: [{ op: "setRls", table: slug, rls: [written[0], ...written.slice(1)] }], detaches: false };
    }
    return { patches: rulePatches(slug, declared, written), detaches: false };
}

// ── The split ───────────────────────────────────────────────────────────────

/** Refuse what an edit cannot change. */
function refuseMigrations(before: AdminCollection, after: AdminCollection): void {
    const moved = (key: "slug" | "table" | "dataSource" | "databaseId", what: string): void => {
        const a: unknown = Reflect.get(before, key);
        const b: unknown = Reflect.get(after, key);
        if (a !== undefined && b !== undefined && a !== b) {
            throw new SplitEditError("MIGRATION_REQUIRED",
                `Changing ${what} of "${before.slug}" from "${String(a)}" to "${String(b)}" moves its rows, which is a migration, not an edit. ` +
                "Create a new table and migrate the rows, or write the rename in backend/schema together with a migration.", key);
        }
    };
    moved("slug", "the slug");
    moved("table", "the SQL table");
    moved("dataSource", "the database");
    moved("databaseId", "the database");
}

/** A new table, as the `createTable` it is. */
function createTable(after: AdminCollection): TablePatch {
    const served = new Map<string, WireColumnDef>();
    const columns: Record<string, WireColumnDef> = {};
    for (const [key, property] of columnsOf(after)) columns[key] = wireOf(key, property, served);
    if (!Object.values(columns).some(column => column.primaryKey)) {
        throw new SplitEditError("NO_PRIMARY_KEY", `The new table "${after.slug}" has no primary key. Mark one field as its id.`);
    }
    const relations: Record<string, WireRelation> = {};
    for (const [name, entry] of relationsOf(after)) relations[name] = wireRelationOf(name, entry, new Map());
    const rules = (after.securityRules ?? []).filter(rule => !isRedactedSecurityRule(rule));
    const sqlName = "table" in after && typeof after.table === "string" ? after.table : undefined;
    const table = sqlName && sqlName !== after.slug ? { table: sqlName } : {};
    return {
        op: "createTable",
        table: {
            name: after.slug,
            ...table,
            columns,
            ...(Object.keys(relations).length > 0 ? { relations } : {}),
            rls: rules.length > 0 ? [rules[0], ...rules.slice(1)] : "admin-only",
            ...(after.description ? { description: after.description } : {}),
            ...(after.history ? { history: true } : {})
        }
    };
}

/**
 * Split one save of the collection editor into the schema edit and the
 * presentation delta it makes.
 *
 * - A column added, changed or removed is `addColumn` / `changeColumn` /
 *   `removeColumn`; a column whose schema facts did not change produces
 *   nothing, whatever happened to its label or width.
 * - A relation added, changed or removed is `addRelation` /
 *   `changeRelation` / `removeRelation`.
 * - The rules are {@link rulePatches} over the declared rules (an untouched
 *   rule is never rewritten), `setRls` for a posture.
 * - `description` and `history` are `setOption`.
 * - Everything else the edit changed that is a preference key is the
 *   presentation delta. A new table's presentation is everything it states.
 *
 * @throws {@link SplitEditError} for a slug, table or database change, a
 *   property with no column equivalent, redacted rules, or a new table without
 *   a primary key.
 */
export function splitEdit({ before, after, table }: SplitEditInput): SplitEdit {
    const slug = before?.slug ?? after.slug;

    if (!before) {
        const presentation = tablePresentationOf(after);
        const fields: NonNullable<UiTablePreferences["fields"]> = {};
        for (const [key, property] of Object.entries(after.properties ?? {})) {
            const field = fieldPresentationOf(property);
            // A new enum's labels are written with its values; only real overrides are presentation.
            delete field.enumOrder;
            if (Object.keys(field).length > 0) fields[key] = field;
        }
        if (Object.keys(fields).length > 0) presentation.fields = fields;
        return { table: slug, schema: [createTable(after)], presentation };
    }

    refuseMigrations(before, after);

    const servedColumns = new Map<string, WireColumnDef>();
    const servedRelations = new Map<string, WireRelation>();
    for (const column of table?.columns ?? []) {
        if (!column.derived && !column.private) servedColumns.set(column.key, wireColumnOfDescriptor(column));
    }
    for (const relation of table?.relations ?? []) {
        if (table) servedRelations.set(relation.name, wireRelationOfDescriptor(relation, table));
    }

    const schema: TablePatch[] = [];

    // Columns.
    const beforeColumns = new Map(columnsOf(before));
    const afterColumns = new Map(columnsOf(after));
    for (const [key, property] of afterColumns) {
        const previous = beforeColumns.get(key);
        const next = wireOf(key, property, servedColumns);
        if (!previous) {
            schema.push({ op: "addColumn", table: slug, key, column: next });
            continue;
        }
        const was = wireOf(key, previous, servedColumns);
        if (!sameValue(was, next)) schema.push({ op: "changeColumn", table: slug, key, column: next });
    }
    for (const key of beforeColumns.keys()) {
        if (!afterColumns.has(key)) schema.push({ op: "removeColumn", table: slug, key });
    }

    // Relations.
    const beforeRelations = relationsOf(before);
    const afterRelations = relationsOf(after);
    for (const [name, entry] of afterRelations) {
        const previous = beforeRelations.get(name);
        const next = wireRelationOf(name, entry, servedRelations);
        if (!previous) {
            schema.push({ op: "addRelation", table: slug, name, relation: next });
            continue;
        }
        if (!sameValue(wireRelationOf(name, previous, servedRelations), next)) {
            schema.push({ op: "changeRelation", table: slug, name, relation: next });
        }
    }
    for (const name of beforeRelations.keys()) {
        if (!afterRelations.has(name)) schema.push({ op: "removeRelation", table: slug, name });
    }

    // Rules.
    const rls = rlsPatches(slug, before.securityRules ?? [], after.securityRules ?? [], table);
    schema.push(...rls.patches);

    // Table options.
    if ((before.description ?? "") !== (after.description ?? "")) {
        schema.push({ op: "setOption", table: slug, option: "description", value: after.description ? after.description : null });
    }
    if (Boolean(before.history) !== Boolean(after.history)) {
        schema.push({ op: "setOption", table: slug, option: "history", value: after.history ? true : null });
    }

    // Presentation.
    const presentation = tableDelta(tablePresentationOf(before), tablePresentationOf(after));
    const fields: NonNullable<UiTablePreferences["fields"]> = {};
    for (const [key, property] of Object.entries(after.properties ?? {})) {
        const previous = before.properties?.[key];
        const delta = previous ? fieldDelta(fieldPresentationOf(previous), fieldPresentationOf(property)) : fieldPresentationOf(property);
        if (!previous) delete delta.enumOrder;
        if (Object.keys(delta).length > 0) fields[key] = delta;
    }
    if (Object.keys(fields).length > 0) presentation.fields = fields;

    return { table: slug, schema, presentation, ...(rls.detaches ? { detachesInheritedRules: true } : {}) };
}

/** Whether a split edit writes nothing. */
export function isEmptyEdit(edit: SplitEdit): boolean {
    return edit.schema.length === 0 && Object.keys(edit.presentation).length === 0;
}

/** The delete of a table, as the operation it is. The SQL table and its rows stay. */
export function deleteTableEdit(slug: string): TablePatch[] {
    return [{ op: "deleteTable", table: slug }];
}

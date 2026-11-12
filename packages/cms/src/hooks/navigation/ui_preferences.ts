/**
 * UI preferences folded into a table's collection.
 *
 * A preference is a {@link UiTablePreferences} delta — JSON data in the
 * `customizeTable` vocabulary — so folding one in is folding in a
 * customization: it is translated here to `customizeTable`'s options and
 * applied with `applyTableCustomization`, the one place the vocabulary meets
 * the panel's view model. Two things differ from a code customization:
 *
 * - it is data from a file or the server, so each value is narrowed (a chip
 *   colour that is not a colour key, a condition that is not JSON logic, is
 *   dropped) rather than trusted;
 * - registered keys (`entityActions`, `entityViews`, `customViews`) are added
 *   beside what the code declares, not instead of it: code can hold objects a
 *   preference cannot, and a preference must not delete them.
 */
import type { AnyFieldCustomization, EnumLabel, TableCustomizationOptions, UserConfigurationPersistence } from "@rebasepro/cms-types";
import type { ColorKey, EnumValueConditions, PropertyConditions, UiFieldPreferences, UiPreferences, UiTablePreferences } from "@rebasepro/types";
import { isUiTablePreferences, mergeUiTablePreferences } from "@rebasepro/types";
import { stripCollectionPath } from "@rebasepro/common";

import { customizeTable } from "../../tables/customize_table";
import { applyTableCustomization, type TableCollection } from "../../tables/apply_customization";

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const HUES = ["blue", "cyan", "teal", "green", "yellow", "orange", "red", "pink", "purple", "gray", "indigo", "violet", "fuchsia", "rose", "emerald"];
const TONES = ["", "Lighter", "Light", "Dark", "Darker"];

/** Whether a string is a chip colour key (`"green"`, `"orangeDark"`). */
export function isColorKey(value: unknown): value is ColorKey {
    if (typeof value !== "string") return false;
    const tone = TONES.find(t => t !== "" && value.endsWith(t)) ?? "";
    return HUES.includes(value.slice(0, value.length - tone.length));
}

type ConditionRule = NonNullable<PropertyConditions["disabled"]>;
const asRule = (value: unknown): ConditionRule | undefined =>
    typeof value === "boolean" || isRecord(value) ? value : undefined;
const asLogic = (value: unknown): Record<string, unknown> | undefined => isRecord(value) ? value : undefined;
const asNumberOrLogic = (value: unknown): number | Record<string, unknown> | undefined =>
    typeof value === "number" ? value : asLogic(value);
const asString = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;

function enumConditionsOf(value: unknown): Record<string, EnumValueConditions> | undefined {
    if (!isRecord(value)) return undefined;
    const out: Record<string, EnumValueConditions> = {};
    for (const [id, entry] of Object.entries(value)) {
        if (!isRecord(entry)) continue;
        const conditions: EnumValueConditions = {};
        const disabled = asLogic(entry.disabled);
        const hidden = asLogic(entry.hidden);
        if (disabled) conditions.disabled = disabled;
        if (hidden) conditions.hidden = hidden;
        if (typeof entry.disabledMessage === "string") conditions.disabledMessage = entry.disabledMessage;
        out[id] = conditions;
    }
    return out;
}

/** JSON-logic conditions, narrowed to the keys a property's conditions take. */
function conditionsOf(value: UiFieldPreferences["conditions"]): PropertyConditions | undefined {
    if (!value) return undefined;
    const out: PropertyConditions = {};
    const set = <K extends keyof PropertyConditions>(key: K, next: PropertyConditions[K] | undefined): void => {
        if (next !== undefined) out[key] = next;
    };
    set("disabled", asRule(value.disabled));
    set("hidden", asRule(value.hidden));
    set("readOnly", asRule(value.readOnly));
    set("required", asRule(value.required));
    set("disabledMessage", asString(value.disabledMessage));
    set("requiredMessage", asString(value.requiredMessage));
    if (typeof value.clearOnDisabled === "boolean") out.clearOnDisabled = value.clearOnDisabled;
    set("min", asNumberOrLogic(value.min));
    set("max", asNumberOrLogic(value.max));
    set("maxFileSize", asNumberOrLogic(value.maxFileSize));
    for (const key of ["defaultValue", "allowedEnumValues", "excludedEnumValues", "referencePath", "referenceFilter", "canAddElements", "sortable", "acceptedFiles"] as const) {
        set(key, asLogic(value[key]));
    }
    set("enumConditions", enumConditionsOf(value.enumConditions));
    return Object.keys(out).length > 0 ? out : undefined;
}

/** One field's preferences, as a field customization. */
export function fieldCustomizationOf(field: UiFieldPreferences): AnyFieldCustomization {
    const { enumLabels, conditions, fields, of, ...plain } = field;
    const out: AnyFieldCustomization = { ...plain };
    if (enumLabels) {
        const labels: Record<string, string | EnumLabel> = {};
        for (const [value, label] of Object.entries(enumLabels)) {
            labels[value] = typeof label === "string"
                ? label
                : {
                    label: label.label,
                    ...(isColorKey(label.color) ? { color: label.color } : {}),
                    ...(label.disabled !== undefined ? { disabled: label.disabled } : {})
                };
        }
        out.enumLabels = labels;
    }
    const narrowed = conditionsOf(conditions);
    if (narrowed) out.conditions = narrowed;
    if (fields) {
        const nested: Record<string, AnyFieldCustomization> = {};
        for (const [key, value] of Object.entries(fields)) nested[key] = fieldCustomizationOf(value);
        out.fields = nested;
    }
    if (of) out.of = fieldCustomizationOf(of);
    return out;
}

/** A table's preferences, as `customizeTable`'s options. */
export function customizationOptionsOf(preferences: UiTablePreferences): TableCustomizationOptions {
    const { fields, ...table } = preferences;
    const out: TableCustomizationOptions = { ...table };
    if (fields) {
        const customized: Record<string, AnyFieldCustomization> = {};
        for (const [key, field] of Object.entries(fields)) customized[key] = fieldCustomizationOf(field);
        out.fields = customized;
    }
    return out;
}

/** The registered keys a preference adds beside what the code declares. */
const REGISTERED_LISTS = ["entityActions", "entityViews", "customViews"] as const;

function keepCodeEntries(before: TableCollection, after: TableCollection, preferences: UiTablePreferences): TableCollection {
    const out: TableCollection = { ...after };
    for (const key of REGISTERED_LISTS) {
        const added = preferences[key];
        if (!added) continue;
        const declared: unknown = Reflect.get(before, key);
        const objects = Array.isArray(declared) ? declared.filter(entry => typeof entry !== "string") : [];
        const merged = [...objects, ...added];
        Reflect.set(out, key, merged);
        if (out.admin) out.admin = { ...out.admin, [key]: merged };
    }
    return out;
}

/**
 * A table's collection with a preference delta folded in. `undefined` or an
 * empty delta leaves it as it is.
 */
export function applyUiPreferences(collection: TableCollection, preferences: UiTablePreferences | undefined): TableCollection {
    if (!preferences || Object.keys(preferences).length === 0) return collection;
    const customized = applyTableCustomization(collection, customizeTable(collection.slug, customizationOptionsOf(preferences)));
    return keepCodeEntries(collection, customized, preferences);
}

/**
 * The tables of `<RebaseCMS uiConfig>` (the contents of
 * `frontend/src/cms/ui-config.json`), keeping only valid preferences: an
 * entry that is not one is skipped, with a warning in development.
 */
export function uiConfigPreferences(config: { tables?: { [slug: string]: object } } | undefined): UiPreferences {
    const tables: UiPreferences["tables"] = {};
    for (const [slug, preferences] of Object.entries(config?.tables ?? {})) {
        if (isUiTablePreferences(preferences)) tables[slug] = preferences;
        else if (process.env.NODE_ENV !== "production") {
            console.warn(`[rebase] uiConfig.tables["${slug}"] holds keys that are not table preferences. Skipped.`);
        }
    }
    return { tables };
}

/**
 * A user's persistence with a layer of their preferences beneath it: what
 * the server stores for them, received by an embedding that asks the server
 * for nothing itself. What they change there is kept by `persistence` and
 * read over the layer.
 */
export function withUserLayer(persistence: UserConfigurationPersistence, user: UiPreferences): UserConfigurationPersistence {
    return {
        ...persistence,
        getTablePreferences: (path: string) => {
            const stored = user.tables[stripCollectionPath(path)];
            const local = persistence.getTablePreferences(path);
            return stored ? mergeUiTablePreferences(stored, local) : local;
        }
    };
}

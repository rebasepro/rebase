import type { EnumValueConfig, EnumValues } from "../types/properties";

export function getLabelOrConfigFrom(enumValues: EnumValueConfig[], key?: string | number): EnumValueConfig | undefined {
    if (key === null || key === undefined) return undefined;
    return enumValues.find((entry) => String(entry.id) === String(key));
}

/** Whether every entry of an enum array is a `{ id, label }` config (not a plain value). */
function isConfigList(entries: EnumValueConfig[] | Array<string | number>): entries is EnumValueConfig[] {
    return entries.every((entry) => typeof entry === "object");
}

/**
 * Every spelling of an enum as `{ id, label }` entries.
 *
 * An array may also be a plain list of values — `["draft", "published"]` — as
 * a JS collection config writes it. The DDL and codegen read such a list as
 * the values, so the admin does too: each becomes `{ id: value, label: value }`.
 * Before, the admin took every entry for a config, found no `id` or `label` on
 * a string, and its dropdown came out empty.
 */
export function enumToObjectEntries(enumValues: EnumValues | Array<string | number>): EnumValueConfig[] {
    if (Array.isArray(enumValues)) {
        if (isConfigList(enumValues)) return enumValues;
        const entries: ReadonlyArray<EnumValueConfig | string | number> = enumValues;
        return entries.map((entry) =>
            typeof entry === "string" || typeof entry === "number"
                ? { id: entry, label: String(entry) }
                : entry);
    }
    return Object.entries(enumValues).map(([id, value]) =>
        typeof value === "string" ? { id, label: value } : { ...value, id });
}

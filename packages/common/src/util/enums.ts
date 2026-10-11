import { EnumValueConfig, EnumValues } from "@rebasepro/types";

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
        const entries: ReadonlyArray<EnumValueConfig | string | number> = enumValues;
        if (entries.every((entry) => typeof entry === "object")) return enumValues as EnumValueConfig[]; // SAFETY: every entry checked to be a config just above
        return entries.map((entry) =>
            typeof entry === "string" || typeof entry === "number"
                ? { id: entry, label: String(entry) }
                : entry);
    } else {
        return Object.entries(enumValues).map(([id, value]) => {
            if (typeof value === "string") {
                return {
                    id,
                    label: value
                }
            } else {
                return {
                    ...value,
                    id
                }
            }
        });
    }
}

export function getLabelOrConfigFrom(enumValues: EnumValueConfig[], key?: string | number): EnumValueConfig | undefined {
    if (key === null || key === undefined) return undefined;
    return enumValues.find((entry) => String(entry.id) === String(key));
}

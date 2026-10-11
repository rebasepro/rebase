import { EnumValueConfig, EnumValues } from "@rebasepro/types";
import { unslugify } from "@rebasepro/utils";

// Canonical utility functions — single source of truth in @rebasepro/utils
export { unslugify, prettifyIdentifier, isObject, isPlainObject, mergeDeep } from "@rebasepro/utils";

/**
 * Extract enum values from a list of sample values.
 * This is inference-specific logic (not a general utility).
 */
export function extractEnumFromValues(values: unknown[]) {
    if (!Array.isArray(values)) {
        return [];
    }
    // A number or a boolean in a text column is one of its options too (`10`
    // and `12` beside `S`, `M`, `L`): left out, the enum refused the rows it
    // was inferred from. Its id is its text, which is what the import writes.
    const seen = new Set<string>();
    const enumValues: Array<{ id: string, label: string }> = [];
    for (const value of values) {
        if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
        const id = String(value);
        if (seen.has(id)) continue;
        seen.add(id);
        enumValues.push({ id, label: typeof value === "string" ? unslugify(value) : id });
    }
    enumValues.sort((a, b) => a.label.localeCompare(b.label));
    return enumValues;
}

export function resolveEnumValues(input: EnumValues): EnumValueConfig[] | undefined {
    // Check Array.isArray first since typeof [] === "object" is true in JavaScript
    if (Array.isArray(input)) {
        return input as EnumValueConfig[];
    } else if (typeof input === "object" && input !== null) {
        return Object.entries(input).map(([id, value]) =>
        (typeof value === "string"
            ? {
                id,
                label: value
            }
            : value));
    } else {
        return undefined;
    }
}

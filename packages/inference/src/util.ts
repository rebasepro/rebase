import { EnumValueConfig, EnumValues } from "@rebasepro/types";
import { unslugify } from "@rebasepro/utils";

// Canonical utility functions — single source of truth in @rebasepro/utils
export { unslugify, prettifyIdentifier, isObject, isPlainObject, mergeDeep } from "@rebasepro/utils";

/**
 * Extract enum values from a list of sample values.
 * This is schema-inference-specific logic (not a general utility).
 */
export function extractEnumFromValues(values: unknown[]) {
    if (!Array.isArray(values)) {
        return [];
    }
    const enumValues = values
        .map((value) => {
            if (typeof value === "string") {
                return ({
                    id: value,
                    label: unslugify(value)
                });
            } else
                return null;
        }).filter(Boolean) as Array<{ id: string, label: string }>;
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

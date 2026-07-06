import type { CollectionConfig, PropertyConfig } from "@rebasepro/types";
import type { AuthController, Entity, EntityStatus, EntityValues } from "@rebasepro/types";
import { deepEqual as equal } from "fast-equals";
import { getIn, setIn } from "@rebasepro/formex";
import { getDefaultValuesFor } from "@rebasepro/common";
import { isObject, mergeDeep } from "@rebasepro/utils";
import { z } from "zod";

// extract touched values for nested touched trees and map to current values
export function extractTouchedValues(values: unknown, touched: Record<string, boolean>): Record<string, unknown> {
    let acc: Record<string, unknown> = {};
    if (!touched || typeof touched !== "object") {
        return acc;
    }

    Object.entries(touched).forEach(([key, value]) => {
        if (value) {
            acc = setIn(acc, key, getIn(values, key)) as Record<string, unknown>;
        }
    })

    return acc;
}

/**
 * Recursively removes empty plain objects `{}` and empty arrays `[]` from a value tree.
 * This prevents ghost containers created by `setIn` intermediate path construction
 * (e.g. `{ address: {} }` when only `address.city` was touched but value is undefined)
 * from falsely triggering the unsaved local changes indicator.
 */
/**
 * Check if a value is semantically empty (null, undefined, or empty string).
 */
function isSemanticEmpty(v: unknown): boolean {
    return v === null || v === undefined || v === "";
}

export function removeEmptyContainers(obj: unknown): unknown {
    if (Array.isArray(obj)) {
        const cleaned = obj.map(removeEmptyContainers);
        // Keep arrays even if they contain only nulls/undefined — that's intentional data
        return cleaned;
    }
    if (obj && typeof obj === "object" && Object.getPrototypeOf(obj) === Object.prototype) {
        const result: Record<string, unknown> = {};
        for (const key of Object.keys(obj)) {
            const cleaned = removeEmptyContainers((obj as Record<string, unknown>)[key]);
            // Skip empty plain objects
            if (cleaned && typeof cleaned === "object" && !Array.isArray(cleaned)
                && Object.getPrototypeOf(cleaned) === Object.prototype
                && Object.keys(cleaned).length === 0) {
                continue;
            }
            result[key] = cleaned;
        }
        // After cleaning, check if all remaining values are semantically empty
        // (null, undefined, or ""). This catches ghost objects like {type: "", value: null}
        // created by oneOf block initialization that aren't meaningful changes.
        if (Object.keys(result).length > 0 && Object.values(result).every(isSemanticEmpty)) {
            return {};
        }
        return result;
    }
    return obj;
}

export function getChanges<T extends object>(source: Partial<T>, comparison: Partial<T>): Partial<T> {
    const changes: Partial<T> = {};

    if (!source) {
        return {};
    }
    if (!comparison) {
        return source;
    }

    const allKeys = Array.from(new Set([...Object.keys(source), ...Object.keys(comparison)]));

    for (const key of allKeys) {
        const sourceValue = (source as Record<string, unknown>)[key];
        const comparisonValue = (comparison as Record<string, unknown>)[key];

        if (equal(sourceValue, comparisonValue)) {
            continue;
        }

        const sourceHasKey = source && typeof source === "object" && Object.prototype.hasOwnProperty.call(source, key);
        const comparisonHasKey = comparison && typeof comparison === "object" && Object.prototype.hasOwnProperty.call(comparison, key);

        if (comparisonHasKey && !sourceHasKey) {
            (changes as Record<string, unknown>)[key] = undefined;
        } else if (Array.isArray(sourceValue)) {
            const comparisonArray = Array.isArray(comparisonValue) ? comparisonValue : [];
            if (sourceValue.length !== comparisonArray.length) {
                (changes as Record<string, unknown>)[key] = sourceValue;
                continue;
            }
            const hasChanges = sourceValue.some((item, index) => !equal(item, comparisonArray[index]));
            if (hasChanges) {
                (changes as Record<string, unknown>)[key] = sourceValue;
            }
        } else if (isObject(sourceValue) && sourceValue && isObject(comparisonValue) && comparisonValue) {
            const nestedChanges = getChanges(sourceValue, comparisonValue);
            if (Object.keys(nestedChanges).length > 0) {
                (changes as Record<string, unknown>)[key] = nestedChanges;
            }
        } else {
            (changes as Record<string, unknown>)[key] = sourceValue;
        }
    }

    return changes;
}

export function getInitialEntityValues<M extends Record<string, unknown>>(
    authController: AuthController,
    collection: CollectionConfig,
    path: string,
    status: "new" | "existing" | "copy",
    entity: Entity<M> | undefined,
    propertyConfigs?: Record<string, PropertyConfig>
): Partial<EntityValues<M>> {
    const properties = collection.properties;
    if ((status === "existing" || status === "copy") && entity) {
        let values: Partial<EntityValues<M>>;
        if (!collection.alwaysApplyDefaultValues) {
            values = entity.values ?? getDefaultValuesFor(properties);
        } else {
            const defaultValues = getDefaultValuesFor(properties);
            values = mergeDeep(defaultValues, entity.values ?? {});
        }
        // When copying, clear ID fields so the database generates new IDs
        if (status === "copy") {
            const result = { ...values };
            for (const [key, property] of Object.entries(properties)) {
                if (property && "isId" in property && property.isId) {
                    delete (result as Record<string, unknown>)[key];
                }
            }
            return result;
        }
        return values;
    } else if (status === "new") {
        return getDefaultValuesFor(properties);
    } else {
        console.error({
            status,
            entity
        });
        throw new Error("Form has not been initialised with the correct parameters");
    }
}

export function zodToFormErrors(zodError: z.ZodError): Record<string, string> {
    let errors: Record<string, string> = {};
    for (const issue of zodError.issues) {
        const path = issue.path.join(".");
        if (path && !getIn(errors, path)) {
            errors = setIn(errors, path, issue.message) as Record<string, string>;
        }
    }
    return errors;
}


import type { PropertyConfig, AdminCollection } from "@rebasepro/cms-types";
import type { Entity, EntityStatus, EntityValues } from "@rebasepro/types";
import type { AuthController } from "@rebasepro/cms-types";
import { deepEqual as equal } from "fast-equals";
import { getIn, setIn } from "@rebasepro/forms";
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

/**
 * What the local-changes backup still has to offer, given what the form is
 * already showing — the answer the "unsaved local changes" banner is asking for.
 * `undefined` means there is nothing left to apply, and no banner.
 *
 * Measured against what the form *opens showing*, not against the stored
 * record. The banner exists to offer a draft the form is not already displaying,
 * and an edit carried across a change of layout is in both the backup and the
 * form: measuring against the stored values alone offered to restore the values
 * already on screen, over an edit the user had never left.
 */
export function getUnappliedLocalChanges<M extends Record<string, unknown>>(
    backupValues: Partial<M>,
    openingValues: Partial<M>
): Partial<M> | undefined {
    const changes = getChanges(backupValues, openingValues);
    const cleaned = removeEmptyContainers(changes);
    if (!cleaned || typeof cleaned !== "object" || Object.keys(cleaned).length === 0) {
        return undefined;
    }
    return cleaned as Partial<M>;
}

/**
 * What travels when the same record changes layout — the split's "hide list",
 * full screen's "show list", the side panel's "open full screen". One mounted
 * form is replaced by another showing the same record, so the edit in progress
 * has to be handed over; left to the local-changes backup alone, the new form
 * met it as a draft from a closed tab and raised the "unsaved local changes"
 * banner over changes the user had made a second earlier and never left.
 *
 * Returns `undefined` when there is nothing to carry, which is its own answer: a
 * record nobody edited must open in the next layout exactly as clean as it was.
 *
 * Only what was edited here travels, keyed by `touched` — the same subset the
 * backup stores. Carrying the whole record instead marks every field touched in
 * the receiving form, which lights up every empty required field as an error and
 * writes the entire record back out as a "local change".
 */
export function getEditHandoffValues<M extends Record<string, unknown>>({
    status,
    dirty,
    values,
    touched,
    storedValues
}: {
    status: EntityStatus;
    /** Whether `values` differ from what is stored. */
    dirty: boolean;
    values: Partial<M>;
    touched: Record<string, boolean>;
    /** The stored record, for the fallback below. Absent for a new one. */
    storedValues?: Partial<M>;
}): Partial<M> | undefined {

    if (!values) return undefined;

    // A record with nothing stored behind it carries whole: there is no
    // baseline to fall back to, so anything not carried is simply lost.
    if (status === "new" || status === "copy") {
        return Object.keys(values).length > 0 ? values : undefined;
    }

    if (!dirty) return undefined;

    const touchedValues = removeEmptyContainers(extractTouchedValues(values, touched ?? {})) as Partial<M> | undefined;
    if (touchedValues && Object.keys(touchedValues).length > 0) {
        return touchedValues;
    }

    // Dirty with nothing touched — a value set programmatically, by a plugin or
    // a custom field that writes through `setFieldValue` without the blur that
    // marks it. Diffing against the stored record still finds it, and dropping
    // it here would hand over a form that opens clean over an edit.
    const changes = getChanges(values, storedValues ?? {});
    return Object.keys(changes).length > 0 ? changes : undefined;
}

export function getInitialEntityValues<M extends Record<string, unknown>>(
    authController: AuthController,
    collection: AdminCollection,
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

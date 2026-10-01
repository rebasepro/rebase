
import type { PropertyConfig, AdminCollection } from "@rebasepro/cms-types";
import type { Entity, EntityStatus, EntityValues } from "@rebasepro/types";
import type { AuthController } from "@rebasepro/cms-types";
import { deepEqual as equal } from "fast-equals";
import { getIn, setIn } from "@rebasepro/forms";
import { buildConditionContext, evaluateCondition, getCopyValues, getDefaultValuesFor } from "@rebasepro/common";
import { isPlainObject, mergeDeep } from "@rebasepro/utils";
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
 * The edit to carry or back up: each top-level property the user touched,
 * **whole** — the same unit a save writes.
 *
 * `extractTouchedValues` builds a tree of only the touched paths, which is a
 * diff, and a diff cannot say "this item is gone": a list that shrank from
 * three items to one, or a key-value map with a key deleted, came back whole
 * when the diff was merged onto the stored record. Carrying the property whole
 * and overlaying it (see {@link overlayEdit}) shows exactly what the user left.
 *
 * Which properties count is still decided by the touched tree with its ghost
 * containers removed, so a field merely focused carries nothing.
 */
export function getTouchedPropertyValues<M extends Record<string, unknown>>(
    values: Partial<M>,
    touched: Record<string, boolean>
): Partial<M> {
    const touchedTree = removeEmptyContainers(extractTouchedValues(values, touched ?? {}));
    const result: Record<string, unknown> = {};
    if (!touchedTree || typeof touchedTree !== "object") return result as Partial<M>;
    for (const key of Object.keys(touchedTree)) {
        if (Object.prototype.hasOwnProperty.call(values, key)) {
            result[key] = (values as Record<string, unknown>)[key];
        }
    }
    return result as Partial<M>;
}

/**
 * What a form shows when an edit is laid over `base`: each property the edit
 * carries replaces the base's, whole.
 *
 * Not `mergeDeep`, which merged arrays of maps index by index and kept the base
 * items past the edit's length, and kept map keys the edit had dropped — so a
 * deleted section or key came back when the edit changed layout or a draft was
 * restored, in a form that then read as clean.
 */
export function overlayEdit<M extends Record<string, unknown>>(base: Partial<M>, edit: Partial<M>): Partial<M> {
    return { ...base, ...edit };
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
        } else if (isPlainObject(sourceValue) && isPlainObject(comparisonValue)) {
            // Plain objects only. A `Date` has no keys of its own, so walking
            // into two different dates finds nothing and loses the edit; a
            // class instance (a relation) would come back as a bare `{ id }`
            // that no longer says what it is.
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
 * What an update of a stored record sends: every top-level property whose value
 * differs from the stored one — whole.
 *
 * Whole, because that is the unit an update replaces. It sets each property it
 * carries, so the value sent *is* the property's new value: a map sent as the
 * one key that changed would erase every key left out, a key-value map with a
 * key removed would arrive empty, and a geopoint with one coordinate moved is
 * refused for lacking the other. {@link getChanges} walks into plain objects to
 * find what changed inside them, which is right for comparing a draft with the
 * form and wrong for a write.
 */
export function getChangedProperties<M extends Record<string, unknown>>(
    values: Partial<M>,
    storedValues: Partial<M>
): Partial<M> {
    const changes: Partial<M> = {};
    const keys = new Set([...Object.keys(values), ...Object.keys(storedValues)]);
    for (const key of keys) {
        if (!equal(values[key], storedValues[key])) {
            (changes as Record<string, unknown>)[key] = values[key];
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
    if (!backupValues || typeof backupValues !== "object") return undefined;
    // The backup holds whole properties (see `getTouchedPropertyValues`), so
    // each one is compared whole and offered whole: a diff of it could not say
    // that a key was deleted, and `overlayEdit` lays down what it is given as
    // the property's entire value.
    const unapplied: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(backupValues)) {
        if (!equal(value, (openingValues as Record<string, unknown> | undefined)?.[key])) {
            unapplied[key] = value;
        }
    }
    return Object.keys(unapplied).length > 0 ? unapplied as Partial<M> : undefined;
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

    const touchedValues = getTouchedPropertyValues(values, touched ?? {});
    if (Object.keys(touchedValues).length > 0) {
        return touchedValues;
    }

    // Dirty with nothing touched — a value set programmatically, by a plugin or
    // a custom field that writes through `setFieldValue` without the blur that
    // marks it. Diffing against the stored record still finds it, and dropping
    // it here would hand over a form that opens clean over an edit.
    const changes = getChangedProperties(values, storedValues ?? {});
    return Object.keys(changes).length > 0 ? changes : undefined;
}

/**
 * A new record's values with each top-level `conditions.defaultValue` applied —
 * the rule evaluated against the declared defaults, as a new record has nothing
 * else yet. Without it the rule was documented, editable in Studio, and never
 * read: a new record opened with the static default.
 */
function withConditionalDefaults<M extends Record<string, unknown>>(
    values: Partial<EntityValues<M>>,
    properties: AdminCollection["properties"],
    path: string,
    authController: AuthController
): Partial<EntityValues<M>> {
    let result = values;
    for (const [key, property] of Object.entries(properties ?? {})) {
        const rule = property?.conditions?.defaultValue;
        if (rule === undefined) continue;
        const context = buildConditionContext({
            propertyKey: key,
            values: values as Record<string, unknown>,
            path,
            authController
        });
        result = { ...result, [key]: evaluateCondition(rule, context) };
    }
    return result;
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
        // A copy gets its own key, and leaves behind every relation it could
        // only take by re-pointing another row — see `getCopyValues`.
        if (status === "copy") {
            return getCopyValues(collection, values);
        }
        return values;
    } else if (status === "new") {
        return withConditionalDefaults(getDefaultValuesFor(properties), properties, path, authController);
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

import type { Property } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";
import { getTitlePropertyKey, getTitlePropertyKeyForValues } from "@rebasepro/app";
import { isPropertyBuilder } from "@rebasepro/common";

/**
 * Which properties fill a preview surface, best first.
 *
 * The implementation lives in `@rebasepro/app` so that the admin package and
 * the app package cannot disagree about what a record looks like in a card —
 * they had drifted, and only one of the two copies had learned to keep
 * relations out of the list.
 */
export { getEntityPreviewKeys } from "@rebasepro/app";

/**
 * The property that fills the title slot for a collection.
 *
 * Ranking lives in `@rebasepro/common` so every surface (list rows, cards,
 * board cards, detail header, relation chips) agrees on what an entity is
 * called. Identifiers are excluded from the property *schema* — primary keys,
 * foreign keys, UUID columns — not from the key name.
 */
export function getEntityTitlePropertyKey<M extends Record<string, unknown>>(
    collection: AdminCollection<M>
): string | undefined {
    return getTitlePropertyKey(collection);
}

/**
 * Same as {@link getEntityTitlePropertyKey}, but skips candidates that carry
 * no readable value for this particular entity (empty, or an opaque id).
 */
export function getEntityTitlePropertyKeyForEntity<M extends Record<string, unknown>>(
    collection: AdminCollection<M>,
    values: Record<string, unknown> | undefined,
    entityId?: string | number
): string | undefined {
    return getTitlePropertyKeyForValues(collection, values, entityId);
}

/**
 * True when a property key points at a user picker, whose stored value is an
 * auth user id that has to be resolved before it can be displayed.
 */
export function isUserSelectProperty<M extends Record<string, unknown>>(
    collection: AdminCollection<M>,
    propertyKey: string | undefined
): boolean {
    if (!propertyKey) return false;
    const property = collection.properties[propertyKey];
    if (!property || isPropertyBuilder(property)) return false;
    const prop = property as Property;
    return prop.type === "string" && Boolean(prop.userSelect);
}

/**
 * Attempt to turn a title value (which might be a relation, reference, date, array, or other complex object)
 * into a renderable, human-readable string.
 */
export function resolveTitleToString(title: any): string {
    if (title === null || title === undefined) {
        return "";
    }

    if (typeof title !== "object") {
        return String(title);
    }

    // Check if it's a relation shape: { __type: "relation", id, path, data }
    if ("__type" in title && title.__type === "relation") {
        if (title.data && title.data.values) {
            const values = title.data.values;
            // Prioritize common title fields in eagerly loaded relation data
            for (const key of ["name", "title", "label", "displayName"]) {
                if (values[key] !== undefined && values[key] !== null) {
                    return String(values[key]);
                }
            }
            // Fallback: search for first short string value in values
            for (const val of Object.values(values)) {
                if (typeof val === "string" && val.length > 0 && val.length < 200) {
                    return val;
                }
            }
        }
        if (title.id !== undefined && title.id !== null) {
            return String(title.id);
        }
    }

    // Check if it's a reference shape: { isEntityReference() } or similar
    if ("isEntityReference" in title && typeof title.isEntityReference === "function" && title.isEntityReference()) {
        return String(title.id);
    }
    if ("id" in title && "path" in title && !("__type" in title)) {
        // Flat reference/relation-like object
        return String(title.id);
    }

    // Check if it's a Date
    if (title instanceof Date) {
        return title.toLocaleDateString();
    }

    // Check if it has a string/number property like name/title/label/id
    if ("name" in title && title.name !== undefined && title.name !== null && typeof title.name !== "object") {
        return String(title.name);
    }
    if ("title" in title && title.title !== undefined && title.title !== null && typeof title.title !== "object") {
        return String(title.title);
    }
    if ("label" in title && title.label !== undefined && title.label !== null && typeof title.label !== "object") {
        return String(title.label);
    }
    if ("id" in title && title.id !== undefined && title.id !== null && typeof title.id !== "object") {
        return String(title.id);
    }

    // Fallback: try converting to string, or JSON.stringify if it looks like a generic object
    try {
        const str = String(title);
        if (str !== "[object Object]") {
            return str;
        }
        return JSON.stringify(title);
    } catch {
        return "";
    }
}


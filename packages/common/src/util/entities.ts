import {
    DataType,
    Entity,
    EntityReference,
    EntityRelation,
    EntityStatus,
    EntityValues,
    Properties,
    Property
} from "@rebasepro/types";
import { DEFAULT_ONE_OF_TYPE, DEFAULT_ONE_OF_VALUE } from "./common";
import { mergeDeep } from "@rebasepro/utils";

export function isReadOnly(property: Property): boolean {
    if (property.ui?.readOnly)
        return true;
    if (property.type === "date") {
        if (property.autoValue)
            return true;
    }
    if (property.type === "reference") {
        return !property.path && !("Field" in (property.ui || {}) && property.ui?.Field);
    }
    return false;
}

export function isHidden(property: Property): boolean {
    return typeof property.ui?.disabled === "object" && Boolean(property.ui?.disabled.hidden);
}

export function isPropertyBuilder(property?: Property) {
    return typeof property?.dynamicProps === "function";
}

export function getDefaultValuesFor<M extends Record<string, unknown>>(properties: Properties): Partial<EntityValues<M>> {
    if (!properties) return {};
    return Object.entries(properties)
        .map(([key, property]) => {
            if (!property) return {};
            const value = getDefaultValueFor(property);
            return value === undefined ? {} : { [key]: value };
        })
        .reduce((a, b) => ({ ...a,
...b }), {}) as EntityValues<M>;
}

export function getDefaultValueFor(property?: Property) {
    if (!property) return undefined;
    if (isPropertyBuilder(property)) return undefined;
    if (property.defaultValue || property.defaultValue === null) {
        return property.defaultValue;
    } else if (property.type === "map" && property.properties) {
        const defaultValuesFor = getDefaultValuesFor(property.properties as Properties);
        if (Object.keys(defaultValuesFor).length === 0) return undefined;
        return defaultValuesFor;
    } else {
        return getDefaultValueFortype(property.type);
    }
}

export function getDefaultValueFortype(type: DataType) {
    if (type === "string") {
        return null;
    } else if (type === "number") {
        return null;
    } else if (type === "boolean") {
        return false;
    } else if (type === "date") {
        return null;
    } else if (type === "array") {
        return [];
    } else if (type === "map") {
        return {};
    } else if (type === "vector") {
        return null;
    } else if (type === "binary") {
        return null;
    } else {
        return null;
    }
}

/**
 * Update the automatic values in an entity before save
 * @group Driver
 */
export function updateDateAutoValues<M extends Record<string, unknown>>({
    inputValues,
    properties,
    status,
    timestampNowValue
}:
    {
        inputValues: Partial<EntityValues<M>>,
        properties: Properties,
        status: EntityStatus,
        timestampNowValue: unknown
    }): EntityValues<M> {
    return traverseValuesProperties(
        inputValues,
        properties,
        (inputValue, property) => {
            if (property.type === "date") {
                if (status === "existing" && property.autoValue === "on_update") {
                    return timestampNowValue;
                } else if ((status === "new" || status === "copy") &&
                    (property.autoValue === "on_update" || property.autoValue === "on_create")) {
                    return timestampNowValue;
                } else {
                    return inputValue;
                }
            } else {
                return inputValue;
            }
        }
    ) ?? {} as M;
}

/**
 * Add missing required fields, expected in the collection, to the values of an entity
 * @param values
 * @param properties
 * @group Driver
 */
export function sanitizeData<M extends Record<string, unknown>>
    (
        values: EntityValues<M>,
        properties: Properties
    ) {
    const result = values as Record<string, unknown>;
    Object.entries(properties)
        .forEach(([key, property]) => {
            if (values && values[key] !== undefined) result[key] = values[key];
            else if ((property as Property).validation?.required) result[key] = null;
        });
    return result;
}

export function getReferenceFrom<M extends Record<string, unknown>>(entity: Entity<M>): EntityReference {
    if (typeof entity.id !== "string")
        throw new Error("Only string IDs are supported in references");
    return new EntityReference({
        id: entity.id,
        path: entity.path,
        driver: entity.driver,
        databaseId: entity.databaseId
    });
}

export function getRelationFrom<M extends Record<string, unknown>>(entity: Entity<M>): EntityRelation {
    return new EntityRelation(entity.id, entity.path, entity);
}

/**
 * Normalize a value into a proper EntityRelation instance.
 * Handles EntityRelation class instances, and plain objects
 * with `__type === "relation"` or an `isEntityRelation()` method.
 *
 * Returns null if the value cannot be coerced.
 */
export function normalizeToEntityRelation(value: unknown): EntityRelation | null {
    if (value instanceof EntityRelation) return value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;

    const obj = value as Record<string, unknown>;
    const isRelationLike =
        obj.__type === "relation" ||
        obj.__type === "reference" ||
        (typeof obj.isEntityRelation === "function" && (obj.isEntityRelation as () => boolean)()) ||
        (typeof obj.isEntityReference === "function" && (obj.isEntityReference as () => boolean)());

    if (!isRelationLike) return null;

    return new EntityRelation(
        obj.id as string | number,
        obj.path as string,
        obj.data as Entity | undefined
    );
}

export function traverseValuesProperties<M extends Record<string, unknown>>(
    inputValues: Partial<EntityValues<M>>,
    properties: Properties,
    operation: (value: unknown, property: Property) => unknown
): EntityValues<M> | undefined {
    // Handle null/undefined inputValues - use empty object as base for mergeDeep
    const safeInputValues = inputValues ?? {};

    const updatedValues = Object.entries(properties)
        .map(([key, property]) => {
            const inputValue = safeInputValues && (safeInputValues)[key];
            const updatedValue = traverseValueProperty(inputValue, property as Property, operation);
            if (updatedValue === null) return null;
            if (updatedValue === undefined) return undefined;
            return ({ [key]: updatedValue });
        })
        .reduce((a, b) => ({ ...a,
...b }), {}) as EntityValues<M>;
    // Use mergeDeep to preserve class instances like EntityReference, GeoPoint
    const result = mergeDeep(safeInputValues, updatedValues);
    if (!result || Object.keys(result).length === 0) return undefined;
    return result;
}

export function traverseValueProperty(inputValue: unknown,
    property: Property,
    operation: (value: unknown, property: Property) => unknown): unknown {

    let value;
    if (property.type === "map" && property.properties) {
        value = traverseValuesProperties(inputValue as Partial<Record<string, unknown>>, property.properties, operation);
    } else if (property.type === "array") {
        const of = property.of;
        if (of && Array.isArray(inputValue) && !Array.isArray(of)) {
            value = inputValue.map((e) => traverseValueProperty(e, of, operation));
        } else if (of && Array.isArray(inputValue) && Array.isArray(of)) {
            value = inputValue.map((e, i) => {
                if (i < of.length)
                    return traverseValueProperty(e, of[i], operation);
                return null
            }).filter(Boolean);
        } else if (property.oneOf && Array.isArray(inputValue)) {
            const typeField = property.oneOf?.typeField ?? DEFAULT_ONE_OF_TYPE;
            const valueField = property.oneOf?.valueField ?? DEFAULT_ONE_OF_VALUE;
            value = inputValue.map((e) => {
                if (e === null) return null;
                if (typeof e !== "object") return e;
                const rec = e as Record<string, unknown>;
                const type = rec[typeField] as string;
                const childProperty = property.oneOf?.properties[type];
                if (!type || !childProperty) return e;
                return {
                    [typeField]: type,
                    [valueField]: traverseValueProperty(rec[valueField], childProperty, operation)
                };
            });
        } else {
            value = inputValue;
        }
    } else {
        value = operation(inputValue, property);
    }

    return value;
}

/**
 * Relation reference types used throughout the server layer.
 * These replace the 50+ manual `{ id, path, __type: "relation" }` constructions.
 */
export interface RelationRef {
    readonly id: string | number;
    readonly path: string;
    readonly __type: "relation";
}

export interface RelationRefWithData extends RelationRef {
    readonly data: Entity;
}

/**
 * Create a lightweight relation stub for CMS views.
 * Replaces inline `{ id, path, __type: "relation" }` object literals.
 */
export function createRelationRef(id: string | number, path: string): RelationRef {
    return { id, path, __type: "relation" };
}

/**
 * Create a hydrated relation reference that includes the full entity data.
 * Used when entity data has been pre-fetched (e.g., via batch loading or JOINs).
 */
export function createRelationRefWithData(id: string | number, path: string, data: Entity): RelationRefWithData {
    return { id, path, __type: "relation", data };
}

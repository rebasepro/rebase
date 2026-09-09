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

export function isPropertyBuilder(property?: Property) {
    return typeof property?.dynamicProps === "function";
}

/**
 * What a form opens with: a value for every property it can write.
 *
 * `excludeFromApi` columns are left out, and that is the whole of the rule —
 * they are not part of the API surface in either direction, so there is nothing
 * for a form to open showing and nothing it may send back. Including them was
 * not cosmetic: the baseline is what gets submitted, so a new record carried
 * `passwordHash: null` and `emailVerificationToken: null` into the create, and
 * the server refused the whole write with "these columns are the server's to
 * set" — the users collection could not be added to from the panel at all. The
 * fields were invisible on screen (`admin.disabled.hidden`), which is what made
 * the error read as being about the roles the operator *had* just edited.
 *
 * Server-side defaulting does not come through here: `applyDefaultValuesOnCreate`
 * asks each property for its own default, so an excluded column with a declared
 * `defaultValue` is still filled in on an in-process write.
 */
export function getDefaultValuesFor<M extends Record<string, unknown>>(properties: Properties): Partial<EntityValues<M>> {
    if (!properties) return {};
    return Object.entries(properties)
        .map(([key, property]) => {
            if (!property) return {};
            if ((property as Property).excludeFromApi) return {};
            const value = getDefaultValueFor(property);
            return value === undefined ? {} : { [key]: value };
        })
        .reduce((a, b) => ({ ...a,
...b }), {}) as EntityValues<M>;
}

export function getDefaultValueFor(property?: Property): unknown {
    if (!property) return undefined;
    if (isPropertyBuilder(property)) return undefined;
    // `defaultValue !== undefined`, not truthiness. The test used to be
    // `property.defaultValue || property.defaultValue === null`, which special-
    // cased exactly one falsy value and dropped the rest: `defaultValue: 0`
    // fell through to the per-type default and became `null`, `defaultValue: ""`
    // became `null`, and `defaultValue: false` survived only by coincidence
    // (the per-type default for a boolean is also `false`). A default of zero
    // is the most ordinary default a number column has.
    if (property.defaultValue !== undefined) {
        return property.defaultValue;
    } else if (property.type === "map" && property.properties) {
        const defaultValuesFor = getDefaultValuesFor(property.properties as Properties);
        if (Object.keys(defaultValuesFor).length === 0) return undefined;
        return defaultValuesFor;
    } else {
        return getDefaultValueFortype(property.type);
    }
}

export function getDefaultValueFortype(type: DataType): unknown {
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
 * Update the automatic values in a entity before save
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
 * Stamp the acting user's uid into the `user_on_create` / `user_on_update`
 * columns a collection declares.
 *
 * A deliberate sibling of {@link updateDateAutoValues} rather than another
 * branch inside it. The two share a shape and nothing else: one takes an
 * instant the server generates and the other takes an identity the request
 * carries, so overloading the timestamp function would have meant threading a
 * second, unrelated argument through every one of its callers and letting a
 * `date` property and a `string` property compete for the same `autoValue`
 * union. Called side by side in the driver.
 *
 * The stamped value overwrites whatever arrived in the body. A caller who can
 * set `createdBy` is a caller who can attribute their write to somebody else,
 * which is the one thing an audit column must not allow.
 *
 * `uid` is `undefined` for an anonymous request, a service token or an
 * in-process write; the column is set to an explicit `null` there. Explicit
 * matters on an update: leaving the key absent would keep whatever uid the
 * column already held, so an anonymous edit would be recorded as the previous
 * editor's. Refusing that write outright is `required`'s job, not this
 * function's — see `assertWriteValuesValid`.
 *
 * Top-level properties only, deliberately, unlike {@link updateDateAutoValues}.
 * `traverseValuesProperties` cannot express "set this key to null" — a `null`
 * from its operation means "leave the key out" — and an audit column nested
 * inside a `map` is not a column at all, so there is nothing down there to
 * stamp.
 *
 * @group Driver
 */
export function updateUserAutoValues<M extends Record<string, unknown>>({
    inputValues,
    properties,
    status,
    uid
}:
    {
        inputValues: Partial<EntityValues<M>>,
        properties: Properties,
        status: EntityStatus,
        uid: string | undefined
    }): EntityValues<M> {
    const result = { ...(inputValues ?? {}) } as Record<string, unknown>;
    for (const [key, property] of Object.entries(properties ?? {})) {
        const prop = property as (Property & { autoValue?: string }) | undefined;
        if (!prop || prop.type !== "string") continue;
        const autoValue = prop.autoValue;
        if (autoValue !== "user_on_create" && autoValue !== "user_on_update") continue;
        // `user_on_create` says nothing about an update: the column holds the
        // creator's uid and this write is not rewriting it.
        if (status === "existing" && autoValue === "user_on_create") continue;
        // A copy is a new row and gets a new author, exactly as it gets a new
        // `created_on`.
        result[key] = uid ?? null;
    }
    return result as EntityValues<M>;
}

/**
 * Fill in the `defaultValue`s a create left unset.
 *
 * `defaultValue` was read by exactly one thing: the Studio's form, which uses it
 * to prefill inputs. Every other way into the same collection — the REST create,
 * the SDK, the socket, an import — stored whatever arrived and nothing where the
 * key was absent. So `active: { type: "boolean", defaultValue: true }` produced
 * rows with `active` unset through the API and `true` through the panel, from
 * one declaration that reads like a promise about the data.
 *
 * Only genuinely absent keys are filled. An explicit `null` is a caller saying
 * "no value", which is a different statement from not mentioning the field, and
 * overwriting it would make the default impossible to opt out of.
 *
 * `getDefaultValuesFor` also invents a per-type default for properties with no
 * `defaultValue` at all (`false` for a boolean, `[]` for an array, `null` for
 * the rest) — right for a form, which must render *something* in every input,
 * and wrong here, where an absent key must stay absent so the column's own
 * DEFAULT applies. Only declared defaults are taken.
 *
 * @param values the caller's payload
 * @param properties the collection's declared properties
 * @group Driver
 */
export function applyDefaultValuesOnCreate<M extends Record<string, unknown>>(
    values: Partial<EntityValues<M>> | undefined,
    properties: Properties
): Partial<EntityValues<M>> {
    if (!properties) return values ?? {};
    const result = { ...(values ?? {}) } as Record<string, unknown>;

    for (const [key, property] of Object.entries(properties)) {
        if (!property) continue;
        const declared = declaresDefault(property as Property);
        if (!declared) continue;
        // Asked of the property, not read out of `getDefaultValuesFor`: that
        // one answers for a *form*, and leaves out the columns the API excludes.
        // A server-owned column with a declared default is still defaulted here.
        const defaultValue = getDefaultValueFor(property as Property);
        if (result[key] !== undefined) {
            // A map whose own sub-properties carry defaults is filled in
            // field by field, so `{ notify: false }` keeps `notify` and still
            // gains the siblings it did not mention.
            if ((property as Property).type === "map" &&
                (property as Property & { defaultValue?: unknown }).defaultValue === undefined &&
                isPlainObject(result[key])) {
                result[key] = {
                    ...(defaultValue as Record<string, unknown> ?? {}),
                    ...(result[key] as Record<string, unknown>)
                };
            }
            continue;
        }
        if (defaultValue !== undefined) result[key] = defaultValue;
    }
    return result as Partial<EntityValues<M>>;
}

/** Does this property, or something nested under it, state a `defaultValue`? */
function declaresDefault(property: Property): boolean {
    if (isPropertyBuilder(property)) return false;
    if (property.defaultValue !== undefined) return true;
    if (property.type === "map" && property.properties) {
        return Object.values(property.properties as Properties)
            .some(child => child && declaresDefault(child as Property));
    }
    return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Add missing required fields, expected in the collection, to the values of a entity
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
    return new EntityRelation(entity.id, entity.path, entity as unknown as Record<string, unknown>);
}

/**
 * Normalize a value into a proper EntityRelation instance.
 * Handles EntityRelation class instances, and plain objects
 * with `__type === "relation"` or an `isEntityRelation()` method.
 *
 * When `propertyType` is `"relation"`, also accepts plain objects that
 * have `id` and `path` fields — these are relation-shaped objects from
 * edge cases in the data pipeline (REST fallback, stale cache, custom data source).
 *
 * When `targetPath` is given, also accepts a bare id. A relation column is a
 * foreign key, and the REST layer returns it as the scalar it is; only some
 * fetch paths hydrate it into an object. Which form a caller sees therefore
 * depends on how the row was loaded, and a caller that only accepted objects
 * reported half of its own data as a type error. The declared target is the
 * missing half: with it, an id is a relation that has not been fetched yet.
 *
 * Returns null if the value cannot be coerced.
 */
export function normalizeToEntityRelation(value: unknown, propertyType?: string, targetPath?: string): EntityRelation | null {
    if (value instanceof EntityRelation) return value;

    if (targetPath && (typeof value === "string" || typeof value === "number")) {
        // An empty string is an unset foreign key, not row "".
        if (value === "") return null;
        return new EntityRelation(value, targetPath);
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) return null;

    const obj = value as Record<string, unknown>;
    const isRelationLike =
        obj.__type === "relation" ||
        obj.__type === "reference" ||
        (typeof obj.isEntityRelation === "function" && (obj.isEntityRelation as () => boolean)()) ||
        (typeof obj.isEntityReference === "function" && (obj.isEntityReference as () => boolean)()) ||
        (propertyType === "relation" && typeof obj.id !== "undefined" && typeof obj.path === "string");

    if (!isRelationLike) return null;

    return new EntityRelation(
        obj.id as string | number,
        obj.path as string,
        obj.data as Record<string, unknown> | undefined
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
 * Create a lightweight relation stub for admin views.
 * Replaces inline `{ id, path, __type: "relation" }` object literals.
 */
export function createRelationRef(id: string | number, path: string): RelationRef {
    return { id,
path,
__type: "relation" };
}

/**
 * Create a hydrated relation reference that includes the full entity data.
 * Used when entity data has been pre-fetched (e.g., via batch loading or JOINs).
 */
export function createRelationRefWithData(id: string | number, path: string, data: Entity): RelationRefWithData {
    return { id,
path,
__type: "relation",
data };
}

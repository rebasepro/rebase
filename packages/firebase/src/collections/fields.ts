// Types only: brings the admin augmentation (`admin` on every property kind)
// into any program that reads these field types.
import type { FirebaseProperties, FirebaseProperty, InferEntityType, Property } from "@rebasepro/cms-types";

/**
 * The keys a Firestore field adds to the property it describes. Each is a
 * shorter way to write something the property model already has.
 *
 * @group Firebase
 */
export interface FirestoreFieldShorthands {
    /**
     * The field must have a value: `validation.required`, written once. Writing
     * both with different values is refused.
     */
    required?: boolean;
}

/** The Firestore property of one `type`. */
type KindOf<T> = Extract<FirebaseProperty, { type: T }>;

/**
 * A reference field: the reference property as Firestore allows it, with
 * `target` in place of `path`.
 * @group Firebase
 */
export interface FirestoreReferenceField extends Omit<KindOf<"reference">, "path">, FirestoreFieldShorthands {
    /**
     * The slug of the collection this field points at — on any data source.
     * A target on another source (a Postgres table's collection) is stored in
     * the document as the target's id, a string, never as a Firestore
     * `DocumentReference`; a target in the same Firestore database is stored
     * as a `DocumentReference`, as before.
     */
    target?: string;
}

/**
 * A map field, whose nested `properties` are fields too.
 * @group Firebase
 */
export interface FirestoreMapField extends Omit<KindOf<"map">, "properties">, FirestoreFieldShorthands {
    /** The fields of the map, by key. */
    properties?: FirestoreFields;
}

/**
 * An array field, whose `of` and `oneOf` blocks are fields too.
 * @group Firebase
 */
export interface FirestoreArrayField extends Omit<KindOf<"array">, "of" | "oneOf">, FirestoreFieldShorthands {
    /** The field every element of the array is, or one per position. */
    of?: FirestoreField | readonly FirestoreField[];
    /** Typed blocks: each element names its block type in `typeField`. */
    oneOf?: FirestoreFieldBlocks;
}

/** Each kind that does not nest, with the shorthands. */
type ScalarField<P> = P extends unknown ? P & FirestoreFieldShorthands : never;

/**
 * One field of a Firestore collection: any property Firestore can store —
 * `string`, `number`, `boolean`, `date`, `geopoint`, `map`, `array`,
 * `reference`, `binary` — with every key that kind accepts (validation, enum
 * values with labels and colours, storage, conditions, `admin` presentation
 * options), plus the {@link FirestoreFieldShorthands}.
 *
 * @group Firebase
 */
export type FirestoreField =
    | ScalarField<Exclude<FirebaseProperty, { type: "reference" | "map" | "array" }>>
    | FirestoreReferenceField
    | FirestoreMapField
    | FirestoreArrayField;

/**
 * A Firestore collection's fields, by key.
 * @group Firebase
 */
export interface FirestoreFields {
    [key: string]: FirestoreField;
}

/**
 * The block types of an array of typed blocks (`array.oneOf`).
 * @group Firebase
 */
export interface FirestoreFieldBlocks {
    /** One field per block type, keyed by the value of `typeField`. */
    properties: FirestoreFields;
    /** The order the block types are offered in. */
    propertiesOrder?: string[];
    /** The key holding a block's type. Defaults to `type`. */
    typeField?: string;
    /** The key holding a block's value. Defaults to `value`. */
    valueField?: string;
}

/** `required: true`, as the property model says it. */
type RequiredPart<F> = F extends { required: true } ? { validation: { required: true } } : unknown;

/**
 * The property a field normalises to, as a type: the shorthands written out,
 * nested fields normalised the same way. What `defineFirestoreCollection`
 * returns under `properties`, and what the document type is inferred from.
 *
 * @group Firebase
 */
export type FirestoreFieldAsProperty<F> =
    Omit<F, "required" | "target" | "properties" | "of" | "oneOf">
    & RequiredPart<F>
    & (F extends { target: string } ? { path: string } : unknown)
    & (F extends { properties: infer NP } ? { properties: FirestoreFieldsAsProperties<NP> } : unknown)
    & (F extends { of: infer O }
        ? { of: O extends readonly unknown[] ? { -readonly [I in keyof O]: FirestoreFieldAsProperty<O[I]> } : FirestoreFieldAsProperty<O> }
        : unknown)
    & (F extends { oneOf: infer B }
        ? { oneOf: Omit<B, "properties"> & (B extends { properties: infer BP } ? { properties: FirestoreFieldsAsProperties<BP> } : unknown) }
        : unknown);

/**
 * {@link FirestoreFieldAsProperty} over a whole field map.
 * @group Firebase
 */
export type FirestoreFieldsAsProperties<FS> = {
    -readonly [K in keyof FS]: FirestoreFieldAsProperty<FS[K]>;
};

/**
 * The document type a collection's fields describe — what `defineCollection`
 * infers from `properties`, through the same `InferEntityType`. A field with
 * `required: true` (or `validation.required: true`) is a required key; a
 * reference is an `EntityReference`, a date a `Date`, a map its own document.
 *
 * Tolerant of a field map with an error in it: a field that does not
 * normalise to a property widens to any property instead of collapsing the
 * whole type, so the rest of the collection is still checked against the real
 * key set.
 *
 * @group Firebase
 */
export type FirestoreDocumentOf<FS> = InferEntityType<{
    [K in keyof FirestoreFieldsAsProperties<FS>]: FirestoreFieldsAsProperties<FS>[K] extends Property
        ? FirestoreFieldsAsProperties<FS>[K]
        : Property;
}>;

/**
 * Turn a collection's fields into the property model the admin and the
 * Firestore driver read: `required` becomes `validation.required`, a
 * reference's `target` becomes its `path`, nested fields are normalised the
 * same way. Every other key is kept as written.
 *
 * @param fields the fields, by key
 * @param where who is asking, for the error messages — the collection's slug
 * @group Firebase
 */
export function normalizeFirestoreFields(fields: FirestoreFields, where: string): FirebaseProperties {
    const properties: FirebaseProperties = {};
    for (const [key, field] of Object.entries(fields)) {
        properties[key] = normalizeFirestoreField(field, `${where}: field "${key}"`);
    }
    return properties;
}

function normalizeFirestoreField(field: FirestoreField, where: string): FirebaseProperty {
    if (typeof field !== "object" || field === null || typeof field.type !== "string") {
        throw new Error(`${where} is not a field: write \`{ type: "string" }\` (or another field type) as its value.`);
    }
    const type: string = field.type;
    switch (field.type) {
        case "reference": {
            if ("path" in field) {
                throw new Error(
                    `${where} sets \`path\`. A Firestore field names the collection it points at with ` +
                    "`target: \"<collection slug>\"`, on any data source — write that instead."
                );
            }
            const { required, target, ...property } = field;
            return withRequired(target !== undefined ? { ...property, path: target } : property, required, where);
        }
        case "map": {
            const { required, properties, ...property } = field;
            return withRequired(
                properties !== undefined
                    ? { ...property, properties: normalizeFirestoreFields(properties, `${where}.properties`) }
                    : property,
                required,
                where
            );
        }
        case "array": {
            const { required, of, oneOf, ...property } = field;
            const normalizedOf = of === undefined
                ? undefined
                : isFieldList(of)
                    ? of.map((item, index) => normalizeFirestoreField(item, `${where}.of[${index}]`))
                    : normalizeFirestoreField(of, `${where}.of`);
            const normalizedOneOf = oneOf === undefined
                ? undefined
                : { ...oneOf, properties: normalizeFirestoreFields(oneOf.properties, `${where}.oneOf`) };
            return withRequired({
                ...property,
                ...(normalizedOf !== undefined ? { of: normalizedOf } : {}),
                ...(normalizedOneOf !== undefined ? { oneOf: normalizedOneOf } : {})
            }, required, where);
        }
        case "string": {
            const { required, ...property } = field;
            return withRequired(property, required, where);
        }
        case "number": {
            const { required, ...property } = field;
            return withRequired(property, required, where);
        }
        case "boolean": {
            const { required, ...property } = field;
            return withRequired(property, required, where);
        }
        case "date": {
            const { required, ...property } = field;
            return withRequired(property, required, where);
        }
        case "geopoint": {
            const { required, ...property } = field;
            return withRequired(property, required, where);
        }
        case "binary": {
            const { required, ...property } = field;
            return withRequired(property, required, where);
        }
        default:
            throw new Error(
                `${where} has type "${type}", which Firestore does not store. Use one of string, number, ` +
                "boolean, date, geopoint, map, array, reference or binary — a relation or a vector belongs to a Postgres table."
            );
    }
}

function isFieldList(of: FirestoreField | readonly FirestoreField[]): of is readonly FirestoreField[] {
    return Array.isArray(of);
}

/** `property` with `required` written into its `validation`; refused when the two disagree. */
function withRequired<P extends { validation?: { required?: boolean } }>(property: P, required: boolean | undefined, where: string): P {
    if (required === undefined) return property;
    const declared = property.validation?.required;
    if (declared !== undefined && declared !== required) {
        throw new Error(
            `${where} says \`required: ${String(required)}\` and \`validation.required: ${String(declared)}\`. ` +
            "Write it once — `required` is short for `validation.required`."
        );
    }
    return { ...property, validation: { ...property.validation, required } };
}

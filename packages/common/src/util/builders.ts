import {
    AdditionalFieldDelegate,
    ArrayProperty,
    BooleanProperty,
    DateProperty,
    EntityCallbacks,
    EntityCollection,
    EnumValueConfig,
    EnumValues,
    FirebaseCollection,
    FirebaseProperties,
    GeopointProperty,
    InferEntityType,
    MapProperty,
    MongoDBCollection,
    MongoProperties,
    NumberProperty,
    PostgresCollection,
    PostgresProperties,
    Properties,
    Property,
    ReferenceProperty,
    StringProperty,
    User
} from "@rebasepro/types";


/**
 * Identity function we use to defeat the type system of Typescript and build
 * collection views with all its properties
 * @param collection
 * @group Builder
 */
export function buildCollection<
    M extends Record<string, unknown> = Record<string, unknown>,
    USER extends User = User>
    (
        collection: EntityCollection<M, USER>
    ): EntityCollection<M, USER> {
    return collection;
}

// ── defineCollection ─────────────────────────────────────────────────────
// A smarter builder that uses `const` type-parameter inference (TS 5.0+)
// to capture literal property types automatically. This gives you
// autocomplete on `titleProperty`, `sort`, `propertiesOrder`, `fixedFilter`,
// callbacks, etc. — without writing `as const` or passing manual generics.

/**
 * Define a PostgreSQL-backed collection with full type inference.
 *
 * The `const P` generic captures literal property types from your
 * `properties` object, which enables autocomplete on `titleProperty`,
 * `sort`, `propertiesOrder`, `fixedFilter`, and entity callbacks.
 *
 * @example
 * ```ts
 * const products = defineCollection({
 *     name: "Products",
 *     slug: "products",
 *     table: "products",
 *     properties: {
 *         name: { name: "Name", type: "string", validation: { required: true } },
 *         price: { name: "Price", type: "number" },
 *     },
 *     titleProperty: "name",  // ✅ autocomplete: "name" | "price"
 *     sort: ["price", "asc"], // ✅ autocomplete on first element
 * });
 * ```
 *
 * @group Builder
 */
export function defineCollection<
    const P extends PostgresProperties,
    USER extends User = User
>(
    collection: Omit<PostgresCollection<InferEntityType<P>, USER>, "properties"> & { properties: P }
): PostgresCollection<InferEntityType<P>, USER> & { properties: P };

/**
 * Define a Firestore-backed collection with full type inference.
 * @group Builder
 */
export function defineCollection<
    const P extends FirebaseProperties,
    USER extends User = User
>(
    collection: Omit<FirebaseCollection<InferEntityType<P>, USER>, "properties"> & { properties: P }
): FirebaseCollection<InferEntityType<P>, USER> & { properties: P };

/**
 * Define a MongoDB-backed collection with full type inference.
 * @group Builder
 */
export function defineCollection<
    const P extends MongoProperties,
    USER extends User = User
>(
    collection: Omit<MongoDBCollection<InferEntityType<P>, USER>, "properties"> & { properties: P }
): MongoDBCollection<InferEntityType<P>, USER> & { properties: P };

/**
 * Implementation — delegates to the correct overload at the type level.
 * At runtime this is a plain identity function.
 */
export function defineCollection(
    collection: EntityCollection
): EntityCollection {
    return collection;
}

/**
 * Identity function we use to defeat the type system of Typescript and preserve
 * the property keys.
 * @param property
 * @group Builder
 */
export function buildProperty<T, P extends Property = Property>(
    property: P
):
    P extends StringProperty ? StringProperty :
    P extends NumberProperty ? NumberProperty :
    P extends BooleanProperty ? BooleanProperty :
    P extends DateProperty ? DateProperty :
    P extends GeopointProperty ? GeopointProperty :
    P extends ReferenceProperty ? ReferenceProperty :
    P extends ArrayProperty ? ArrayProperty :
    P extends MapProperty ? MapProperty : never {

    // SAFETY: Identity function — P is a subtype of the conditional return type by definition
    return property as unknown as ReturnType<typeof buildProperty<T, P>>;
}

/**
 * Identity function we use to defeat the type system of Typescript and preserve
 * the properties keys.
 * @param properties
 * @group Builder
 */
export function buildProperties<M extends Record<string, unknown>>(
    properties: Properties
): Properties {
    return properties;
}

/**
 * Identity function we use to defeat the type system of Typescript and preserve
 * the properties keys.
 * @param propertiesOrBuilder
 * @group Builder
 */
export function buildPropertiesOrBuilder<M extends Record<string, unknown>>(
    propertiesOrBuilder: Properties
): Properties {
    return propertiesOrBuilder;
}

/**
 * Identity function we use to defeat the type system of Typescript and preserve
 * the properties keys.
 * @param enumValues
 * @group Builder
 */
export function buildEnum(
    enumValues: EnumValues
): EnumValues {
    return enumValues;
}

/**
 * Identity function we use to defeat the type system of Typescript and preserve
 * the properties keys.
 * @param enumValueConfig
 * @group Builder
 */
export function buildEnumValueConfig(
    enumValueConfig: EnumValueConfig
): EnumValueConfig {
    return enumValueConfig;
}

/**
 * Identity function we use to defeat the type system of Typescript and preserve
 * the properties keys.
 * @param callbacks
 * @group Builder
 */
export function buildEntityCallbacks<M extends Record<string, unknown> = Record<string, unknown>>(
    callbacks: EntityCallbacks<M>
): EntityCallbacks<M> {
    return callbacks;
}

/**
 * Identity function we use to defeat the type system of Typescript and build
 * additional field delegates views with all its properties
 * @param additionalFieldDelegate
 * @group Builder
 */
export function buildAdditionalFieldDelegate<M extends Record<string, unknown>, USER extends User = User>(
    additionalFieldDelegate: AdditionalFieldDelegate<M, USER>
): AdditionalFieldDelegate<M, USER> {
    return additionalFieldDelegate;
}



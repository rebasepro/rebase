import {
    ArrayProperty,
    BooleanProperty,
    DateProperty,
    CollectionConfig,
    FirebaseCollectionConfig,
    FirebaseProperties,
    GeopointProperty,
    InferSnapshotType,
    MapProperty,
    MongoDBCollectionConfig,
    MongoProperties,
    NumberProperty,
    PostgresCollectionConfig,
    PostgresProperties,
    Property,
    ReferenceProperty,
    StringProperty,
    User
} from "@rebasepro/types";


/**
 * @deprecated Use {@link defineCollection} instead — it infers property
 * types automatically (autocomplete on `titleProperty`, `sort`,
 * `propertiesOrder`, callbacks) without manual generics.
 * `buildCollection` is kept for FireCMS migration compatibility and will
 * be removed before 1.0.
 *
 * @group Builder
 */
export function buildCollection<
    M extends Record<string, unknown> = Record<string, unknown>,
    USER extends User = User>
    (
        collection: CollectionConfig<M, USER>
    ): CollectionConfig<M, USER> {
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
 * `sort`, `propertiesOrder`, `fixedFilter`, and snapshot callbacks.
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
    collection: Omit<PostgresCollectionConfig<InferSnapshotType<P>, USER>, "properties"> & { properties: P }
): PostgresCollectionConfig<InferSnapshotType<P>, USER> & { properties: P };

/**
 * Define a Firestore-backed collection with full type inference.
 * @group Builder
 */
export function defineCollection<
    const P extends FirebaseProperties,
    USER extends User = User
>(
    collection: Omit<FirebaseCollectionConfig<InferSnapshotType<P>, USER>, "properties"> & { properties: P }
): FirebaseCollectionConfig<InferSnapshotType<P>, USER> & { properties: P };

/**
 * Define a MongoDB-backed collection with full type inference.
 * @group Builder
 */
export function defineCollection<
    const P extends MongoProperties,
    USER extends User = User
>(
    collection: Omit<MongoDBCollectionConfig<InferSnapshotType<P>, USER>, "properties"> & { properties: P }
): MongoDBCollectionConfig<InferSnapshotType<P>, USER> & { properties: P };

/**
 * Implementation — delegates to the correct overload at the type level.
 * At runtime this is a plain identity function.
 */
export function defineCollection(
    collection: CollectionConfig
): CollectionConfig {
    return collection;
}

/**
 * @deprecated Use plain typed property objects with {@link defineCollection}
 * instead — `defineCollection` infers property types automatically, making
 * this wrapper unnecessary. `buildProperty` is kept for FireCMS migration
 * compatibility and will be removed before 1.0.
 *
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

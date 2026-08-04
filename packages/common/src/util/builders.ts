import {
    CollectionConfig,
    FirebaseCollectionConfig,
    FirebaseProperties,
    InferEntityType,
    MongoDBCollectionConfig,
    MongoProperties,
    PostgresCollectionConfig,
    PostgresProperties,
    User
} from "@rebasepro/types";


// ── defineCollection ─────────────────────────────────────────────────────
// A smarter builder that uses `const` type-parameter inference (TS 5.0+)
// to capture literal property types automatically. This gives you
// autocomplete on `display.title`, `sort`, `propertiesOrder`, `fixedFilter`,
// callbacks, etc. — without writing `as const` or passing manual generics.

/**
 * Define a PostgreSQL-backed collection with full type inference.
 *
 * The `const P` generic captures literal property types from your
 * `properties` object, which enables autocomplete on `display.title`,
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
 *     display: { title: "name" },  // ✅ autocomplete: "name" | "price"
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
    collection: Omit<PostgresCollectionConfig<InferEntityType<P>, USER>, "properties"> & { properties: P }
): PostgresCollectionConfig<InferEntityType<P>, USER> & { properties: P };

/**
 * Define a Firestore-backed collection with full type inference.
 * @group Builder
 */
export function defineCollection<
    const P extends FirebaseProperties,
    USER extends User = User
>(
    collection: Omit<FirebaseCollectionConfig<InferEntityType<P>, USER>, "properties"> & { properties: P }
): FirebaseCollectionConfig<InferEntityType<P>, USER> & { properties: P };

/**
 * Define a MongoDB-backed collection with full type inference.
 * @group Builder
 */
export function defineCollection<
    const P extends MongoProperties,
    USER extends User = User
>(
    collection: Omit<MongoDBCollectionConfig<InferEntityType<P>, USER>, "properties"> & { properties: P }
): MongoDBCollectionConfig<InferEntityType<P>, USER> & { properties: P };

/**
 * Implementation — delegates to the correct overload at the type level.
 * At runtime this is a plain identity function.
 */
export function defineCollection(
    collection: CollectionConfig
): CollectionConfig {
    return collection;
}


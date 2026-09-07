import {
    CollectionConfig,
    FirebaseCollectionConfig,
    FirebaseProperties,
    FirebaseProperty,
    InferEntityType,
    MongoDBCollectionConfig,
    MongoProperties,
    MongoProperty,
    PostgresCollectionConfig,
    PostgresProperties,
    PostgresProperty,
    Properties,
    Property,
    StrictProperties,
    User,
    resolveResourceRefs,
    type ResourceRef
} from "@rebasepro/types";


// ── defineCollection ─────────────────────────────────────────────────────
// A smarter builder that uses `const` type-parameter inference (TS 5.0+)
// to capture literal property types automatically. This gives you
// autocomplete on `display.title`, `sort`, `propertiesOrder`, `fixedFilter`,
// callbacks, etc. — without writing `as const` or passing manual generics.

/** The engines a collection can declare. `postgres` when it says nothing. */
type CollectionEngine = "postgres" | "firestore" | "mongodb";

/**
 * The concrete collection type an `engine` selects.
 *
 * This builder used to be three overloads — one per engine — and overload
 * resolution is what made its errors unreadable. When no overload matches,
 * TypeScript emits **one** diagnostic at the call site listing each overload's
 * *first* failure, so a misspelled key on a Postgres collection came back as
 * three paragraphs of `No overload matches this call. Overload 1 of 3 … Overload
 * 3 of 3, '(collection: Omit<MongoDBCollectionConfig<…>>)'` — pointing at
 * `defineCollection(` and blaming a database the project does not use.
 *
 * One signature, with the engine as a type parameter, reports the error at the
 * key instead. Same fix as `@rebasepro/cms-types`, and deliberately the same
 * shape: this is the builder a headless (`--headless`) scaffold, `rebase schema
 * introspect` output and the example app's own collections use, so the two must
 * not diverge.
 */
type CollectionConfigForEngine<E, P, USER extends User> =
    E extends "firestore" ? FirebaseCollectionConfig<EntityShapeOf<P>, USER>
        : E extends "mongodb" ? MongoDBCollectionConfig<EntityShapeOf<P>, USER>
            : PostgresCollectionConfig<EntityShapeOf<P>, USER>;

/**
 * `InferEntityType`, tolerant of a property map that has an error in it.
 *
 * The key set has to survive a bad property, or one mistake hides every other
 * check that reads it. See `KEYS` on the signature below.
 */
type EntityShapeOf<P> = InferEntityType<{
    [K in keyof P]: P[K] extends Property ? P[K] : Property;
}>;

/** The property union an engine admits — the engine gate, as a type. */
type PropertyForEngine<E> =
    E extends "firestore" ? FirebaseProperty
        : E extends "mongodb" ? MongoProperty
            : PostgresProperty;

/** {@link PropertyForEngine} as a property map, for the `P` constraint. */
type PropertiesForEngine<E> =
    E extends "firestore" ? FirebaseProperties
        : E extends "mongodb" ? MongoProperties
            : PostgresProperties;

/**
 * Define a collection with full type inference. Postgres unless `engine` says
 * otherwise.
 *
 * The `const P` generic captures literal property types from your
 * `properties` object, so every key that names a property — a security rule's
 * `ownerField`, a relation's `localKey`, an entity callback's `value` — is
 * checked against the collection's own property names rather than `string`.
 *
 * This is the builder for a project with no admin panel. One with an admin
 * panel wants `defineCollection` from `@rebasepro/cms-types`, which is the same
 * function with the `admin` block type-checked.
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
 *     securityRules: [{ operation: "select", access: "public" }]
 * });
 * ```
 *
 * @group Builder
 */
export function defineCollection<
    const E extends CollectionEngine = "postgres",
    /**
     * The properties, **constrained**. This is what checks them, and what
     * supplies the contextual type inside them: without a constraint the
     * parameter of an inline `callbacks: { beforeSave: ({ value }) => … }` has
     * nothing to be typed from, and TypeScript reports an implicit `any` on a
     * callback the author wrote correctly.
     */
    const P extends PropertiesForEngine<E> & Properties = PropertiesForEngine<E> & Properties,
    /**
     * The properties again, **unconstrained**, and this is why there are two.
     *
     * A constraint TypeScript cannot satisfy is one it silently falls back
     * from: one property with a bad `defaultValue` made `P` become
     * `PostgresProperties`, the entity shape become `Record<string, unknown>`,
     * and every key that is checked against the property names — `display.title`,
     * `propertiesOrder`, `sort` — widen to `string` and stop being checked.
     *
     * `KEYS` has no constraint to fall back from, so `keyof KEYS` survives a bad
     * property and the rest of the collection is still checked against the real
     * key set.
     */
    const KEYS = Properties,
    USER extends User = User
>(
    collection: Omit<CollectionConfigForEngine<E, KEYS, USER>, "properties" | "engine" | "dataSource">
        & {
            engine?: E;
            properties: StrictProperties<P, PropertyForEngine<E>> & KEYS;
            dataSource?: ResourceRef;
        }
): CollectionConfigForEngine<E, KEYS, USER> & { properties: KEYS };

/**
 * At runtime this is a plain identity function: a resource handle written where
 * a key belongs — `dataSource: analytics` — becomes its key, so past this point
 * a collection is plain data. The signature above is the rest of the point.
 * @group Builder
 */
export function defineCollection(
    collection: Omit<CollectionConfig, "dataSource"> & { dataSource?: ResourceRef }
): CollectionConfig {
    return resolveResourceRefs(collection) as CollectionConfig;
}


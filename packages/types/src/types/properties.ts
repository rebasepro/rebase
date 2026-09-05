import type { ComponentRef } from "./component_ref";

import type { Entity, EntityReference, EntityRelation, EntityValues, GeoPoint, Vector } from "./entities";
import type { JoinStep, OnAction, Relation, ResolvedRelation } from "./relations";
import type { ColorKey, ColorScheme } from "./chips";
import type { AuthState } from "../controllers/auth_state";
import type { AfterReadProps, BeforeSaveProps } from "./entity_callbacks";
import type { User } from "../users";

/**
 * Callbacks/Hooks for individual property fields
 * @group Entity properties
 */
export type PropertyCallbacks<T = unknown, M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> = {
    /**
     * Callback used after fetching data, to transform the value before rendering
     */
    afterRead?(props: Omit<AfterReadProps<M, USER>, "entity"> & {
        value: T;
        entity: Entity<M> | undefined;
    }): Promise<T> | T;

    /**
     * Callback used before saving, after validation.
     * You can modify the value before it's saved.
     */
    beforeSave?(props: Omit<BeforeSaveProps<M, USER>, "values"> & {
        value: T;
        previousValue: T | undefined;
        values: Partial<M>;
    }): Promise<T> | T;
}

/**
 * @group Entity properties
 */
export type DataType =
    | "string"
    | "number"
    | "boolean"
    | "date"
    | "geopoint"
    | "reference"
    | "relation"
    | "array"
    | "map"
    | "vector"
    | "binary";

export type Property =
    | StringProperty
    | NumberProperty
    | BooleanProperty
    | DateProperty
    | GeopointProperty
    | ReferenceProperty
    | RelationProperty
    | ArrayProperty
    | MapProperty
    | VectorProperty
    | BinaryProperty;

export type Properties = {
    [key: string]: Property;
};

/**
 * `Omit` that survives a union.
 *
 * `Property` is a union discriminated on `type`, and a bare `Omit<Property, K>`
 * collapses it into one object whose `type` is the union of every tag — so
 * `property.type === "string"` stops narrowing and the concrete property types
 * become unreachable. The `T extends unknown` clause makes it distribute, so
 * each member is omitted from separately and keeps its own discriminant.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * The fields that describe a property's **column**, which only an engine with
 * columns has.
 *
 * `columnType` names a Postgres type (`uuid`, `bigserial`, `jsonb`, `text[]`)
 * and `columnName` overrides the snake_case derivation used to build a column
 * name. `DataSourceCapabilities.supportsColumnTypes` already reported this at
 * runtime — `false` for both document engines — while the types let a MongoDB
 * property declare `columnType: "bigserial"`.
 *
 * They stay declared on the concrete property interfaces rather than moving,
 * because that is where their per-type value unions live; what changes is that
 * the document engines' property aliases omit them.
 */
type SqlColumnFields = "columnType" | "columnName";

export type PostgresProperty = Exclude<Property, ReferenceProperty>;
export type PostgresProperties = {
    [key: string]: PostgresProperty;
};

export type FirebaseProperty = DistributiveOmit<Exclude<Property, RelationProperty | VectorProperty>, SqlColumnFields>;
export type FirebaseProperties = {
    [key: string]: FirebaseProperty;
};

// MongoDB is a document store: it uses references (stored pointers), not
// SQL-style relations/joins. Same gating as Firestore.
//
// `vector` goes with them: it is pgvector-shaped, only `@rebasepro/server-postgres`
// reads it, and `supportsVectors` on the engine's capabilities says so.
export type MongoProperty = DistributiveOmit<Exclude<Property, RelationProperty | VectorProperty>, SqlColumnFields>;
export type MongoProperties = {
    [key: string]: MongoProperty;
};

/**
 * Union of all engine-specific property maps. Use this at engine-agnostic
 * boundaries (collection editor, normalization) where the concrete engine is
 * unknown but the narrowed property constraint must be satisfied.
 */
export type EngineProperties = PostgresProperties | FirebaseProperties | MongoProperties;

/**
 * What a key the surrounding shape does not declare resolves to.
 *
 * Nothing is assignable to it — it has required members nobody can spell — so
 * the key errors. It is a *named* type rather than `never` purely for the
 * message: TypeScript prints the target, so the compiler reads back the key that
 * is wrong and the keys that would have been right, instead of saying "not
 * assignable to type 'never'".
 *
 * ```
 * Type '{ required: true }' is not assignable to type
 *   '{ readonly required: true } & NoSuchKey<"validaton", "name" | "type" | "validation" | …>'.
 *   Property 'didYouMean' is missing …
 * ```
 *
 * `Known` is the set of keys that *were* available. TypeScript elides a long
 * union after a few members, so this is a hint and not an exhaustive listing —
 * which is the right trade: the near-miss is usually alphabetically adjacent to
 * the key that was meant, and a wall of 25 names would be read by nobody.
 */
export type NoSuchKey<K extends PropertyKey, Known extends PropertyKey = never> = {
    /** The key that was written, so the compiler reads it back verbatim. */
    readonly noSuchKey: K;
    /** The keys that were available. Required, so the type is unsatisfiable. */
    readonly didYouMean: Known;
};

/**
 * What a property whose `type` the engine does not have resolves to.
 *
 * Same trick as {@link NoSuchKey}, for a different mistake: a `relation`
 * on a Firestore collection, a `vector` on MongoDB. The gate used to live on the
 * builder's `P extends FirebaseProperties` constraint, which reported it as a
 * failed constraint on the whole property map — and, worse, made a *single* bad
 * property collapse `P` back to its constraint, taking every `admin` key check
 * with it. Expressed here it is one error, on the property, and the rest of the
 * collection is still checked.
 */
export type PropertyTypeNotOnThisEngine<T> = {
    /** The `type` tag that has no home on this engine. Required, so nothing fits. */
    readonly __rebasePropertyTypeNotOnThisEngine: T;
};

/**
 * A relation checked against the concrete member of the union its own `kind`
 * selects, rather than against the union as a whole.
 *
 * `Relation` is closed — `BelongsToRelation` has `localKey` and no
 * `foreignKeyOnTarget`, `HasManyRelation` the reverse — but excess-property
 * checking against a *union* passes any key that any member declares. So
 * `{ kind: "belongsTo", foreignKeyOnTarget: "author_id" }` typechecked, and
 * described a link that cannot exist: the generator reads `localKey`, defaults
 * it to `<relationName>_id`, and the column the author actually named is never
 * looked at. The relation resolves to a different link than the one written.
 *
 * The runtime already refuses this — `validate-config` rejects a link field that
 * does not belong to the kind — so this is the same rule one stage earlier,
 * where it costs a red squiggle instead of a failed boot.
 */
type StrictRelation<R> = R extends { kind: infer K }
    ? R & {
        [Key in Exclude<keyof R, keyof Extract<Relation, { kind: K }>>]:
            NoSuchKey<Key, keyof Extract<Relation, { kind: K }>>;
    }
    : R;

/**
 * `V`, plus every key it carries that `Shape` does not declare, typed so it
 * cannot be satisfied.
 *
 * The `relation` block is descended into, because it is the one nested shape
 * that is a closed union rather than a single interface — see
 * {@link StrictRelation}. The rest (`array.of`, `map.properties`, the `admin`
 * options) are left to the weak-type check and the boot validator.
 */
type ExactProperty<V, Shape> = [Shape] extends [never]
    ? PropertyTypeNotOnThisEngine<V extends { type: infer T } ? T : never>
    : V & {
        [K in Exclude<keyof V, keyof Shape>]: NoSuchKey<K, keyof Shape>;
    } & (V extends { relation: infer R } ? { relation: StrictRelation<R> } : unknown);

/**
 * A property map in which each value is checked against the *concrete* member of
 * the property union that its own `type` tag selects.
 *
 * ### Why this type has to exist
 *
 * `defineCollection` takes `properties: P` where `const P extends Properties`.
 * `Properties` is an index signature, and **every object literal is assignable
 * to an index signature** — extra keys included — so TypeScript's
 * excess-property check never ran inside a property. The consequences were not
 * theoretical:
 *
 * - `validation` misspelled `validaton` compiled, and the field was quietly not
 *   required.
 * - `multiline: true` and `markdown: true` written flat — the shape the docs
 *   themselves showed — compiled, and then the backend refused to boot with a
 *   migration hint pointing at `admin: { … }`.
 * - `multiSelect: true`, a key that exists nowhere in the codebase, compiled.
 *
 * Annotating `const c: PostgresCollectionConfig = { … }` *did* catch all three,
 * which is the tell: the checking was never missing, only bypassed by the
 * inference the builder exists to provide.
 *
 * The map is homomorphic (`[K in keyof P]`), so it stays invertible and `const P`
 * inference is unaffected — `admin.display.title` still completes over the
 * collection's own keys. Verified against the full probe suite before landing.
 *
 * Nested shapes (`array.of`, `map.properties`, and the `admin` block's own
 * options) are not reached by this type; the weak-type check covers an `admin`
 * block whose keys are *all* unknown, and the boot validator covers the rest.
 */
export type StrictProperties<P, AllowedProperty> = {
    [K in keyof P]: P[K] extends { type: infer T }
        ? ExactProperty<P[K], Extract<AllowedProperty, { type: T }>>
        : P[K];
};

/**
 * A helper type to infer the underlying data type from a Property definition.
 * This is the core of the type inference system.
 */
export type InferPropertyType<P extends Property> =
    P extends StringProperty ? string :
        P extends NumberProperty ? number :
            P extends BooleanProperty ? boolean :
                P extends DateProperty ? Date :
                    P extends GeopointProperty ? GeoPoint :
                        P extends ReferenceProperty ? EntityReference :
                            P extends RelationProperty ? EntityRelation | EntityRelation[] :
                                P extends ArrayProperty ? (P["of"] extends Property ? InferPropertyType<P["of"]>[] : unknown[]) :
                                    P extends MapProperty ? (P["properties"] extends Properties ? InferEntityType<P["properties"]> : Record<string, unknown>) :
                                        P extends VectorProperty ? Vector :
                                            P extends BinaryProperty ? string :
                                                never;

/**
 * Helper type that determines whether a property is required.
 * Uses direct structural matching against `{ validation: { required: true } }`
 * (without the optional marker on `validation`), which correctly narrows
 * literal `true` while treating widened `boolean` as not-required.
 */
type IsRequired<P extends Property> = P extends { validation: { required: true } } ? true : false;

/**
 * Extract keys from Properties where the property is required.
 */
type RequiredPropertyKeys<P extends Properties> = {
    [K in keyof P]: IsRequired<P[K]> extends true ? K : never;
}[keyof P];

/**
 * Extract keys from Properties where the property is optional.
 */
type OptionalPropertyKeys<P extends Properties> = {
    [K in keyof P]: IsRequired<P[K]> extends true ? never : K;
}[keyof P];

/**
 * A generic type that converts a `Properties` schema definition into a corresponding
 * TypeScript entity type. It correctly handles required and optional properties.
 *
 * A property is considered required when it has `validation: { required: true }`.
 * The `true` must be a literal type — if `required` is typed as `boolean`,
 * the property will be treated as optional (use `as const` for literal inference).
 *
 * @example
 * const productSchema = {
 *   name: { type: 'string', validation: { required: true } },
 *   price: { type: 'number' }
 * } as const satisfies Properties;
 * type Product = InferEntityType<typeof productSchema>;
 * // Result: { name: string; price?: number; }
 */
export type InferEntityType<P extends Properties> = {
    -readonly [K in RequiredPropertyKeys<P>]: InferPropertyType<P[K]>;
} & {
    -readonly [K in OptionalPropertyKeys<P>]?: InferPropertyType<P[K]>;
};

export interface BaseProperty<CustomProps = unknown> {
    /**
     * The label the admin panel shows for this field — a column header, a form
     * label, a card caption.
     *
     * Optional, and derived from the property key when absent
     * (`publishDate` -> "Publish Date", via `prettifyIdentifier`, which is the
     * same derivation the collection editor already uses when it suggests one).
     *
     * It was required, and that was a UI concern levied on everyone: a headless
     * project has no panel and no reason to invent display names, yet could not
     * declare a property without one. Set it when the derived label is wrong —
     * `"URL"` rather than "Url", `"Postcode"` rather than "Zip" — which is the
     * only time it earns the line.
     */
    name?: string;

    /**
     * Property description, always displayed under the field
     */
    description?: string;

    /**
     * You can use this prop to reuse a property that has been defined
     * in the top level of the admin in the prop `fields`.
     * All the configuration will be taken from the inherited config, and
     * overwritten by the current property config.
     */
    propertyConfig?: string;

    /**
     * Explicit database column name. When set, this value is used as-is
     * for the SQL column name, bypassing any snake_case conversion of
     * the property key.
     *
     * This is automatically populated by `rebase schema introspect`
     * to guarantee an exact match with the live database schema.
     *
     * For manually-authored collections you can omit this — the framework
     * will derive the column name from the property key via `toSnakeCase()`.
     */
    columnName?: string;

    /**
     * Rules for validating this property
     */
    validation?: PropertyValidationSchema;

    /**
     * Never mention this column on the API surface, in either direction.
     *
     * For secrets the server must store and read but no client should ever
     * receive — password hashes, verification tokens. The value is still
     * written and queryable server-side; it is stripped from every row the API
     * serves, for every caller, including admins and service keys, and it is
     * absent from every generated description of the surface: the SDK's `Row`,
     * `Insert` and `Update` types, and the OpenAPI schemas, filters and
     * parameters.
     *
     * The generated types are a *description*, not a second enforcement point:
     * the server still accepts such a field on a write, because that is how the
     * value gets written in the first place. Nothing generated offers it.
     *
     * This is a server-side guarantee, unlike `admin.hideFromCollection`, which
     * only stops the admin panel from *rendering* a field and leaves it in the
     * JSON payload.
     */
    excludeFromApi?: boolean;

    // NOTE: `defaultValue` is intentionally NOT on BaseProperty.
    // Each concrete property type (StringProperty, NumberProperty, etc.)
    // defines its own typed `defaultValue` for compile-time safety.

    /**
     * Use this to define dynamic properties that change based on certain conditions
     * or on the entity's values. For example, you can make a field read-only if
     * another field has a certain value.
     * This function receives the same props as a `PropertyBuilder` and should return a partial `Property` object.
     */
    dynamicProps?: (props: PropertyBuilderProps) => Partial<Property>;

    /**
     * Declarative conditions for dynamic property behavior using JSON Logic.
     *
     * An alternative to PropertyBuilder functions that can be:
     * - Stored in the database as JSON
     * - Edited via the collection editor UI
     * - Evaluated at runtime like property builders
     *
     * @see PropertyConditions for available condition options
     * @see https://jsonlogic.com/ for JSON Logic syntax
     */
    conditions?: PropertyConditions;

    /**
     * Callbacks/Hooks for this property field to transform and sanitize data during its lifecycle.
     */
    callbacks?: PropertyCallbacks;

    /**
     * Arbitrary key-value metadata for external consumers.
     * Not interpreted by Rebase — passed through serialization unchanged.
     * Used by domain apps to store custom per-property config
     * (e.g. CRM visibility flags, display hints).
     */
    metadata?: Record<string, unknown>;

}

export interface StringProperty extends BaseProperty {
    type: "string";
    /**
     * Default value for new entities. Must be a string.
     */
    defaultValue?: string;
    /**
     * Optional database column type. If not set, it defaults to `varchar` or `uuid` depending on `isId` configuration.
     * Use `text` for strings with unbound length, `char` for fixed-length strings, or `varchar` for variable-length strings with a limit.
     */
    columnType?: "varchar" | "text" | "char" | "uuid";
    /**
     * Rules for validating this property
     */
    validation?: StringPropertyValidationSchema;
    /**
     * Marks this field as a Primary Key / Unique Identifier.
     * Framework behavior: Auto-maps to `collection.primaryKeys` internally if not explicitly set.
     * Drizzle append: `.primaryKey()`
     * UI behavior: Field value cannot be changed after creation.
     *
     * You can set this to `"manual"` for a user-defined ID, or specify a generation strategy:
     * 'uuid' -> Drizzle `.defaultRandom()` (Postgres gen_random_uuid())
     * 'cuid' -> Drizzle `.default(sql\`cuid()\`)`
     * Or any other random string to act as a raw SQL default expression: e.g. `nanoid()`
     *
     * On the UI side, the field automatically gets disabled on new entities if a string strategy is provided.
     */
    isId?: boolean | "manual" | "uuid" | "cuid" | string;
    /**
     * You can use the enum values providing a map of possible
     * exclusive values the property can take, mapped to the label that it is
     * displayed in the dropdown. You can use a simple object with the format
     * `value` => `label`, or with the format `value` => `EnumValueConfig` if you
     * need extra customization, (like disabling specific options or assigning
     * colors). If you need to ensure the order of the elements, you can pass
     * a `Map` instead of a plain object.
     *
     */
    enum?: EnumValues;
    /**
     * You can specify a `Storage` configuration. It is used to
     * indicate that this string refers to a path in your storage provider.
     */
    storage?: StorageConfig;

    /**
     * This property is used to indicate that the string is a user ID, and
     * it will be rendered as a user picker.
     * Note that the user ID needs to be the one used in your authentication
     * provider (e.g. the ID in your `users` table).
     * You can also use a property builder to specify the user path dynamically
     * based on other values of the entity.
     */
    userSelect?: boolean;

    /**
     * Does this field include an email
     */
    email?: boolean;

    /**
     * Does this string hold a URL?
     *
     * A statement about the *data*, which is why it sits here beside `email`
     * rather than in the admin block: the OpenAPI generator turns it into
     * `format: "uri"`, so it is part of the published API contract. How the panel
     * renders it — as a link, an image, a video — is `admin.urlPreview`.
     */
    url?: boolean;
}

export interface NumberProperty extends BaseProperty {
    type: "number";
    /**
     * Default value for new entities. Must be a number.
     */
    defaultValue?: number;
    /**
     * Optional database column type. Allows specifying exact database numeric types.
     * If not provided, integer fields (where validation.integer is true or isId is true) default to `integer`, others to `numeric`.
     */
    columnType?: "integer" | "real" | "double precision" | "numeric" | "bigint" | "serial" | "bigserial";
    /**
     * Rules for validating this property
     */
    validation?: NumberPropertyValidationSchema;
    /**
     * Marks this field as a Primary Key / Unique Identifier.
     * Framework behavior: Auto-maps to `collection.primaryKeys` internally if not explicitly set.
     * Drizzle append: `.primaryKey()`
     * UI behavior: Field value cannot be changed after creation.
     *
     * You can set this to `"manual"` for a user-defined ID, or specify a generation strategy:
     * 'increment' -> PostgreSQL `GENERATED BY DEFAULT AS IDENTITY` or auto-incrementing integer.
     * Or any other random string to act as a raw SQL default expression.
     */
    isId?: boolean | "manual" | "increment" | string;
    /**
     * You can use the enum values providing a map of possible
     * exclusive values the property can take, mapped to the label that it is
     * displayed in the dropdown.
     */
    enum?: EnumValues;

}

/**
 * @group Entity properties
 */
export interface BooleanProperty extends BaseProperty {
    type: "boolean";
    /**
     * Default value for new entities. Must be a boolean.
     */
    defaultValue?: boolean;
    /**
     * Rules for validating this property
     */
    validation?: PropertyValidationSchema;
}

/**
 * Which pgvector distance a query measures with, and therefore which operator
 * class an index has to be built for. The names match the `distance` option on
 * `vectorSearch`, because an index built for one operator is not used by a
 * query that asks for another.
 *
 * @group Entity properties
 */
export type VectorDistance = "cosine" | "l2" | "inner_product";

/**
 * How the ANN index over a vector column is built.
 *
 * Without an index, `vectorSearch` is an exact scan: correct at any size,
 * and linear in the number of rows. With one, it is approximate and fast.
 * That trade is why this is configurable rather than implied.
 *
 * @group Entity properties
 */
export interface VectorIndexConfig {
    /**
     * `hnsw` (the default) builds a navigable-graph index: slower to build,
     * better recall, and it needs no training data, so it works on an empty
     * table. `ivfflat` is cheaper to build but partitions by centroid, so an
     * index built on an empty or tiny table has useless partitions — build it
     * after the data is loaded, and set {@link lists}.
     */
    method?: "hnsw" | "ivfflat";
    /**
     * Which distance operators to index, defaulting to `cosine` — the default
     * `vectorSearch` measures with. Name several to index several; each one is
     * a separate index with its own build cost and its own storage.
     */
    distance?: VectorDistance | VectorDistance[];
    /** HNSW: connections per node. Postgres defaults to 16. */
    m?: number;
    /** HNSW: candidate-list size while building. Postgres defaults to 64. */
    efConstruction?: number;
    /** IVFFlat: number of partitions. Postgres defaults to 100. */
    lists?: number;
}

export interface VectorProperty extends BaseProperty {
    type: "vector";
    /**
     * Default value for new entities.
     */
    defaultValue?: Vector;
    /**
     * How many numbers each embedding has — 1536 for OpenAI's
     * `text-embedding-3-small`, 768 for many sentence transformers.
     *
     * **Required, and effectively frozen.** It is the column's width
     * (`vector(1536)`), so changing it is a rewrite of every row, and every
     * stored embedding was produced by a model that no longer matches. Take the
     * number from the model you are actually going to use.
     */
    dimensions: number;
    /**
     * ANN index configuration for this column.
     *
     * Omitted, a single HNSW index for cosine distance is created — which is
     * what the default `vectorSearch` uses. `false` creates none, leaving
     * `vectorSearch` an exact scan.
     *
     * Indexes are only created when {@link dimensions} is at most 2000:
     * pgvector cannot index a wider `vector` column, so a 3072-dimension
     * embedding is left unindexed rather than failing the boot.
     */
    index?: VectorIndexConfig | false;
    /**
     * The rules every property has: `required`, `unique`. A vector has no
     * length or range rules of its own — {@link dimensions} is the column's
     * width, and the database enforces it.
     */
    validation?: PropertyValidationSchema;
}

/**
 * @group Entity properties
 */
export interface BinaryProperty extends BaseProperty {
    type: "binary";
    /**
     * Default value for new entities. Must be a base64-encoded string.
     */
    defaultValue?: string;
    /**
     * The rules every property has: `required`, `unique`. Size limits belong to
     * the upload path, not here.
     */
    validation?: PropertyValidationSchema;
}

export interface DateProperty extends BaseProperty {
    type: "date";
    /**
     * Default value for new entities. Must be a Date.
     */
    defaultValue?: Date;
    /**
     * Optional database column type. If not set, defaults to `timestamp` with timezone.
     */
    columnType?: "timestamp" | "date" | "time";
    /**
     * Rules for validating this property
     */
    validation?: DatePropertyValidationSchema;
    /**
     * Set the granularity of the field to a date or date + time.
     * Defaults to `date_time`.
     *
     */
    mode?: "date" | "date_time";
    /**
     * Timezone string to evaluate the date in.
     */
    timezone?: string;
    /**
     * If this flag is  set to `on_create` or `on_update` this timestamp is
     * updated automatically on creation of the entity only or on every
     * update (including creation). Useful for creating `created_on` or
     * `updated_on` fields
     */
    autoValue?: "on_create" | "on_update";
}

/**
 * @group Entity properties
 */
export interface GeopointProperty extends BaseProperty {
    type: "geopoint";
    /**
     * Default value for new entities. Must be a GeoPoint.
     */
    defaultValue?: GeoPoint;
    /**
     * Rules for validating this property
     */
    validation?: PropertyValidationSchema;
}

/**
 * A pointer to a entity, stored **as a value** on the row (id + path, and
 * optionally a `driver`/`databaseId` for cross-datasource pointers).
 *
 * This is the native primitive of **document databases** — it maps 1:1 to a
 * Firestore `DocumentReference`, and is persisted by the MongoDB driver as a
 * tagged sub-document. It carries no schema-level relationship (no foreign key,
 * no join, no cascade) and is resolved on demand.
 *
 * **Which to use:**
 * - Firestore / MongoDB collection → use `reference`.
 * - Postgres collection → use {@link RelationProperty} (`type: "relation"`),
 *   which models a real foreign key / join with prefetch and cascade.
 *
 * @group Entity properties
 */
export interface ReferenceProperty extends BaseProperty {
    type: "reference";
    /**
     * Default value for new entities. Must be a EntityReference.
     */
    defaultValue?: EntityReference;
    /**
     * Marks this field as a Primary Key / Unique Identifier.
     * Framework behavior: Auto-maps to `collection.primaryKeys` internally if not explicitly set.
     * Drizzle append: `.primaryKey()`
     * UI behavior: Field value cannot be changed after creation.
     */
    isId?: boolean;
    /**
     * Absolute collection path of the collection this reference points to.
     * The collection of the entity is inferred based on the root navigation, so
     * the filters and search delegate existing there are applied to this view
     * as well.
     * You can leave this prop undefined if the path is not yet know, e.g.
     * you are using a property builder and the path depends on a different
     * property.
     */
    path?: string;
}

/**
 * A schema-level relationship between collections **within a single
 * datasource** — backed by a foreign key, junction table, or explicit join
 * path. The resolved value (an `EntityRelation`) can carry a prefetched entity
 * payload to eliminate N+1 queries, and supports `onUpdate`/`onDelete` cascade.
 *
 * This is the native primitive of **relational databases** (Postgres). It is
 * the SQL counterpart to {@link ReferenceProperty}.
 *
 * **Which to use:**
 * - Postgres collection → use `relation`.
 * - Firestore / MongoDB collection → use {@link ReferenceProperty}
 *   (`type: "reference"`), a stored pointer with no join engine.
 *
 * @group Entity properties
 */
export interface RelationProperty extends BaseProperty {
    type: "relation";
    /**
     * Default value for new entities. Must be a EntityRelation or array of EntityRelation.
     */
    defaultValue?: EntityRelation | EntityRelation[];
    /**
     * Marks this field as a Primary Key / Unique Identifier.
     * Framework behavior: Auto-maps to `collection.primaryKeys` internally if not explicitly set.
     * Drizzle append: `.primaryKey()`
     * UI behavior: Field value cannot be changed after creation.
     */
    isId?: boolean;

    /**
     * The link this field represents.
     *
     * A closed union: pick the `kind` and the type offers exactly the fields
     * that kind needs. This used to be the relation's fields spread flat across
     * the property — `target`, `cardinality`, `direction`, `localKey`,
     * `foreignKeyOnTarget`, `through` and `joinPath`, every one optional and all
     * of them simultaneously legal. Which link you meant then had to be
     * inferred, and combinations that meant nothing (a `many` relation carrying
     * a `localKey`) typechecked and corrupted writes.
     *
     * @example
     * ```ts
     * tags: {
     *     name: "Tags",
     *     type: "relation",
     *     relation: { kind: "manyToMany", target: () => tagsCollection }
     * }
     * ```
     */
    relation?: Relation;

    /**
     * The same relation with every default filled in, stamped during
     * normalization. **Do not set manually** — it is derived from
     * {@link RelationProperty.relation}, or looked up by name from the
     * collection's `relations` array.
     */
    resolvedRelation?: ResolvedRelation;
}

export interface ArrayProperty extends BaseProperty {
    type: "array";
    /**
     * Default value for new entities. Must be an array.
     */
    defaultValue?: unknown[];
    /**
     * Optional database column type. By default, maps to a native Postgres array
     * (e.g. `text[]`, `integer[]`/`numeric[]`, `boolean[]`) if the element type
     * is a primitive, otherwise defaults to `jsonb`.
     */
    columnType?: "json" | "jsonb" | "text[]" | "integer[]" | "boolean[]" | "numeric[]";
    /**
     * The property of this array.
     * You can specify any property (except another Array property)
     * You can leave this field empty only if you are providing a custom field,
     * or using the `oneOf` prop, otherwise an error will be thrown.
     */
    of?: Property | Property[];
    /**
     * Use this field if you would like to have an array of typed objects.
     * It is useful if you need to have values of different types in the same
     * array.
     * Each entry of the array is an object with the shape:
     * ```
     * { type: "YOUR_TYPE", value: "YOUR_VALUE"}
     * ```
     * Note that you can use any property so `value` can take any value (strings,
     * numbers, array, objects...)
     * You can customise the `type` and `value` fields to suit your needs.
     *
     * An example use case for this feature may be a blog entry, where you have
     * images and text blocks using markdown.
     */
    oneOf?: {
        /**
         * Record of properties, where the key is the `type` and the value
         * is the corresponding property
         */
        properties: Properties;
        /**
         * Order in which the properties are displayed.
         * If you are specifying your collection as code, the order is the same as the
         * one you define in `properties`, and you don't need to specify this prop.
         */
        propertiesOrder?: string[];
        /**
         * Name of the field to use as the discriminator for type
         * Defaults to `type`
         */
        typeField?: string;
        /**
         * Name of the  field to use as the value
         * Defaults to `value`
         */
        valueField?: string;
    };
    /**
     * Rules for validating this property
     */
    validation?: ArrayPropertyValidationSchema;
}

export interface MapProperty extends BaseProperty {
    type: "map";
    /**
     * Default value for new entities. Must be a record/object.
     */
    defaultValue?: Record<string, unknown>;
    /**
     * Optional database column type. Defaults to `jsonb`.
     */
    columnType?: "json" | "jsonb";
    /**
     * Record of properties included in this map.
     */
    properties?: Properties;
    /**
     * Order in which the properties are displayed.
     * If you are specifying your collection as code, the order is the same as the
     * one you define in `properties`, and you don't need to specify this prop.
     *
     * Stays on the property rather than moving to the `admin` block, unlike the
     * rest of the map's presentation options: `sortProperties` in
     * `@rebasepro/common` reads it recursively, and `@rebasepro/firebase` calls
     * that when it builds collections. A core package cannot read the admin
     * block — the field exists only once `@rebasepro/cms-types` is installed.
     */
    propertiesOrder?: string[];
    /**
     * Rules for validating this property.
     * NOTE: If you don't set `required` in the map property, an empty object
     * will be considered valid, even if you set `required` in the properties.
     */
    validation?: PropertyValidationSchema;
    /**
     * Render this map as a key-value table that allows to use
     * arbitrary keys. You don't need to define the properties in this case.
     *
     * Core rather than admin despite the wording: it says the map has no
     * declared shape, which is what the OpenAPI generator emits the schema
     * from (`additionalProperties` instead of a property list).
     */
    keyValue?: boolean;
}

/**
 * What a `dynamicProps` builder is handed when it computes a property.
 *
 * Called on every render of the form, for one field, so it is a pure function of
 * these arguments: the entity being edited, the value in this field, and who is
 * editing. It runs **in the browser** and shapes what is offered — it is not a
 * security boundary, and a rule that must hold has to be a security rule as well.
 *
 * @group Entity properties
 */
export type PropertyBuilderProps<M extends Record<string, unknown> = Record<string, unknown>> = {
    /** The entity's values as they stand right now, including unsaved edits. */
    values: Partial<M>;
    /** The values as last saved, or `undefined` for an entity being created. */
    previousValues?: Partial<M>;
    /** The value in *this* field. `undefined` before anything is typed. */
    propertyValue?: unknown;
    /** Position within the parent array, when this property is an array element. */
    index?: number;
    /** The collection path this entity belongs to. */
    path: string;
    /** The entity's id, or `undefined` while it is being created. */
    entityId?: string | number;
    /** Who is editing — the signed-in user and their roles. */
    authController: AuthState;
};

/**
 * We use this type to define mapping between string or number values in
 * the data source to a label (such in a select dropdown).
 * The key in this Record is the value saved in the driver, and the value in
 * this record is the label displayed in the UI.
 * You can add additional customization by assigning a {@link EnumValueConfig} for the
 * label instead of a simple string (for enabling or disabling options and
 * choosing colors).
 * If you need to ensure the order of the elements use an array of {@link EnumValueConfig}
 * @group Entity properties
 */
export type EnumValues = EnumValueConfig[] | Record<string | number, string | EnumValueConfig>;

/**
 * Configuration for a particular entry in an `EnumValues`
 * @group Entity properties
 */
export type EnumValueConfig = {
    /**
     * Value stored in the data source.
     */
    id: string | number;
    /**
     * Displayed label
     */
    label: string;
    /**
     * This value will not be selectable
     */
    disabled?: boolean;
    /**
     * You can pick from a list of predefined color combinations or define
     * your own {@link ColorScheme}
     */
    color?: ColorKey | ColorScheme;
}

/**
 * Rules to validate any property. Some properties have specific rules
 * additionally to these.
 * @group Entity properties
 */
export interface PropertyValidationSchema {
    /**
     * Is this field required
     */
    required?: boolean;

    /**
     * Customize the required message when the property is not set
     */
    requiredMessage?: string;

    /**
     * If the unique flag is set to `true`, you can only have one entity in the
     * collection with this value.
     */
    unique?: boolean;

    /**
     * If the uniqueInArray flag is set to `true`, you can only have this value
     * once per entry in the parent `ArrayProperty`. It has no effect if this
     * property is not a child of an `ArrayProperty`. It works on direct
     * children of an `ArrayProperty` or first level children of `MapProperty`
     */
    uniqueInArray?: boolean;
}

/**
 * Validation rules for numbers
 * @group Entity properties
 */
export interface NumberPropertyValidationSchema extends PropertyValidationSchema {
    /** Smallest accepted value, **inclusive**. `min: 0` accepts `0`. */
    min?: number;
    /** Largest accepted value, **inclusive**. `max: 100` accepts `100`. */
    max?: number;
    /** Must be strictly below this. The exclusive twin of {@link max}. */
    lessThan?: number;
    /** Must be strictly above this. The exclusive twin of {@link min}. */
    moreThan?: number;
    /** Must be greater than zero. `0` is rejected — use `min: 0` to allow it. */
    positive?: boolean;
    /** Must be less than zero. `0` is rejected. */
    negative?: boolean;
    /** No fractional part. Does not change the column type; see `columnType`. */
    integer?: boolean;
}

/**
 * Validation rules for strings
 * @group Entity properties
 */
export interface StringPropertyValidationSchema extends PropertyValidationSchema {
    /** Exactly this many characters — a country code, a fixed-width reference. */
    length?: number;
    /** Fewest characters accepted, inclusive. */
    min?: number;
    /**
     * Most characters accepted, inclusive.
     *
     * Also sizes the column: a `max` turns `TEXT` into `VARCHAR(max)`, so
     * lowering it on a table that already has longer rows is a migration the
     * database will refuse, not just a stricter form.
     */
    max?: number;
    /**
     * A pattern the whole value must match.
     *
     * A `string` is compiled per request, so it must be a valid regular
     * expression — one that will not compile is rejected at boot, because
     * `toPattern` answers `undefined` for it and the caller reads
     * `if (pattern && !pattern.test(value))`: the rule would silently become no
     * rule. A `RegExp` literal has already been compiled by the engine.
     */
    matches?: string | RegExp;
    /**
     * Message displayed when the input does not satisfy the regex in `matches`
     */
    matchesMessage?: string;
    /**
     * Strip leading and trailing whitespace **before** saving.
     *
     * A transform, not a check: it changes the value that is written, which is
     * what makes it the fix for "the same tag twice, one with a trailing space".
     */
    trim?: boolean;
    /** Lowercase the value before saving. A transform, like {@link trim}. */
    lowercase?: boolean;
    /** Uppercase the value before saving. A transform, like {@link trim}. */
    uppercase?: boolean;
}

/**
 * Validation rules for dates
 * @group Entity properties
 */
export interface DatePropertyValidationSchema extends PropertyValidationSchema {
    /** Earliest accepted date, inclusive. A fixed instant, not "today". */
    min?: Date;
    /** Latest accepted date, inclusive. A fixed instant, not "today". */
    max?: Date;
}

/**
 * Validation rules for arrays
 * @group Entity properties
 */
export interface ArrayPropertyValidationSchema extends PropertyValidationSchema {
    /** Fewest elements accepted, inclusive. Counts elements, not characters. */
    min?: number;
    /** Most elements accepted, inclusive. Counts elements, not characters. */
    max?: number;
}

/**
 * Additional configuration related to Storage related fields
 * @group Entity properties
 */
export type StorageConfig = {
    /**
     * Key referencing a named storage backend from the StorageRegistry.
     * Must match a `StorageSourceDefinition.key` or a key registered
     * in `initializeRebaseBackend({ storage: { ... } })`.
     *
     * When omitted, the default storage source is used.
     */
    storageSource?: string;

    /**
     * Store files for this property as **public**: they are placed under the
     * public prefix and served via stable, token-less, permanent, CDN-cacheable
     * URLs (safe to persist and hotlink). Use for public assets like avatars or
     * storefront images. Defaults to `false` (private, short-lived signed URLs).
     */
    public?: boolean;

    /**
     * File MIME types that can be uploaded to this reference. Don't specify for
     * all.
     * Note that you can also use the asterisk notation, so `image/*`
     * accepts any image file, and so on.
     */
    acceptedFiles?: FileType[];

    /**
     * Advanced image resizing and cropping configuration.
     * Applied before upload to optimize storage and bandwidth.
     * Only applies to image MIME types: image/jpeg, image/png, image/webp
     */
    imageResize?: ImageResize;

    /**
     * Specific metadata set in your uploaded file.
     * For the default Firebase implementation, the values passed here are of type
     * `firebase.storage.UploadMetadata`
     */
    metadata?: Record<string, unknown>,

    /**
     * You can use this prop to customize the uploaded filename.
     * You can use a function as a callback or a string where you
     * specify some placeholders that get replaced with the corresponding values.
     * - `{file}` - Full file name
     * - `{file.name}` - Name of the file without extension
     * - `{file.ext}` - Extension of the file
     * - `{rand}` - Random value used to avoid name collisions
     * - `{entityId}` - ID of the entity
     * - `{propertyKey}` - ID of this property
     * - `{path}` - Path of this entity
     *
     * @param context
     */
    fileName?: string | ((context: UploadedFileContext) => string | Promise<string>);

    /**
     * Absolute path in your bucket.
     *
     * You can use a function as a callback or a string where you
     * specify some placeholders that get replaced with the corresponding values.
     * - `{file}` - Full file name
     * - `{file.name}` - Name of the file without extension
     * - `{file.ext}` - Extension of the file
     * - `{rand}` - Random value used to avoid name collisions
     * - `{entityId}` - ID of the entity
     * - `{propertyKey}` - ID of this property
     * - `{path}` - Path of this entity
     */
    storagePath: string | ((context: UploadedFileContext) => string);

    /**
     * When set to true, this flag indicates that the bucket name will be
     * included in the saved storage path.
     *
     * E.g. `s3://my-bucket/path/to/file.png` instead of just `path/to/file.png`
     *
     * Defaults to false.
     */
    includeBucketUrl?: boolean;

    /**
     * When set to true, this flag indicates that the download URL of the file
     * will be saved in the driver, instead of the storage path.
     *
     * Note that the generated URL may use a token that, if disabled, may
     * make the URL unusable and lose the original reference to Cloud Storage,
     * so it is not encouraged to use this flag.
     *
     * Defaults to false.
     */
    storeUrl?: boolean,

    /**
     * Define maximal file size in bytes
     */
    maxSize?: number,

    /**
     * Use this callback to process the file before uploading it to the storage.
     * If nothing is returned, the file is uploaded as it is.
     * @param file
     */
    processFile?: (file: File) => Promise<File> | undefined;

    /**
     * Postprocess the saved value (storage path or URL)
     * after it has been resolved.
     */
    postProcess?: (pathOrUrl: string) => Promise<string>;

    /**
     * You can use this prop in order to provide a custom preview URL.
     * Useful when the file's path is different from the original field value
     */
    previewUrl?: (fileName: string) => string;
}

/**
 * @group Entity properties
 */
export interface UploadedFileContext {
    /**
     * Uploaded file
     */
    file: File;

    /**
     * Property field name
     */
    propertyKey: string;

    /**
     * Property related to this upload
     */
    property: StringProperty | ArrayProperty;

    /**
     * Entity ID
     */
    entityId?: string | number;

    /**
     * Entity path. E.g. `products/PID/locales`
     */
    path?: string;

    /**
     * Values of the current entity
     */
    values: EntityValues<any>;

    /**
     * Storage meta specified by the developer
     */
    storage: StorageConfig;
}

/**
 * MIME types for storage fields
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Common_types
 * @group Entity properties
 */
export type FileType =
    | "image/*"
    | "video/*"
    | "audio/*"
    | "application/*"
    | "text/*"
    | "font/*"
    | string;

export interface ImageResize {
    /**
     * Maximum width in pixels. Image will be scaled down proportionally if wider.
     */
    maxWidth?: number;

    /**
     * Maximum height in pixels. Image will be scaled down proportionally if taller.
     */
    maxHeight?: number;

    /**
     * Resize mode determines how the image fits within maxWidth/maxHeight bounds.
     * - `contain`: Scale down to fit within bounds, preserving aspect ratio (default)
     * - `cover`: Scale to fill bounds, preserving aspect ratio (may crop)
     */
    mode?: "contain" | "cover";

    /**
     * Output format for the resized image.
     * - `original`: Keep the original format (default)
     * - `jpeg`: Convert to JPEG
     * - `png`: Convert to PNG
     * - `webp`: Convert to WebP
     */
    format?: "original" | "jpeg" | "png" | "webp";

    /**
     * Quality for lossy formats (JPEG, WebP). Number between 0 and 100.
     * Higher is better quality but larger file size. Defaults to 80.
     */
    quality?: number;
}

/**
 * A JSON Logic rule that gets evaluated at runtime.
 * @see https://jsonlogic.com/
 *
 * Common operators:
 * - Comparison: ==, !=, ===, !==, >, <, >=, <=
 * - Logic: and, or, !, !!
 * - Data access: var, missing, missing_some
 * - Array: in, map, filter, reduce, all, some, none, merge
 * - String: substr, cat
 * - Numeric: +, -, *, /, %, min, max
 *
 * Custom operators:
 * - hasRole(roleId) - check if user has role by ID
 * - hasAnyRole([roleIds]) - check if user has any of the roles
 * - isToday(timestamp) - check if timestamp is today
 * - isPast(timestamp) - check if timestamp is in the past
 * - isFuture(timestamp) - check if timestamp is in the future
 *
 * @group Entity properties
 */
export type JsonLogicRule = Record<string, any>;

/**
 * A condition that is either a JSON Logic rule or a literal answer.
 *
 * The unconditional case is the common one — "this field is never editable",
 * "this field is never shown" — and with only a rule accepted it had to be
 * spelled `{ "==": [1, 1] }`, which reads as a puzzle at the call site. A plain
 * `true` says the same thing.
 *
 * @group Entity properties
 */
export type ConditionRule = JsonLogicRule | boolean;

/**
 * Conditions for individual enum values within a property.
 * @group Entity properties
 */
export interface EnumValueConditions {
    /**
     * Disable this enum option when condition is true.
     * The option appears grayed out and cannot be selected.
     */
    disabled?: JsonLogicRule;

    /**
     * Message explaining why this option is disabled.
     */
    disabledMessage?: string;

    /**
     * Completely hide this enum option when condition is true.
     * The option is removed from the dropdown/list.
     */
    hidden?: JsonLogicRule;
}

/**
 * Declarative conditions for dynamic property behavior.
 * All conditions are JSON Logic rules evaluated against ConditionContext.
 *
 * An alternative to PropertyBuilder functions that can be:
 * - Stored in the database as JSON
 * - Edited via the collection editor UI
 * - Evaluated at runtime like property builders
 *
 * @see https://jsonlogic.com/ for JSON Logic syntax
 * @group Entity properties
 */
export interface PropertyConditions {

    // ═══════════════════════════════════════════════════════════════════════
    // FIELD STATE CONDITIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Disable the field when this condition evaluates to true.
     * The field becomes non-editable but still visible (unless also hidden).
     *
     * @example Disable when another field has a specific value
     * \`\`\`json
     * { "==": [{ "var": "values.status" }, "archived"] }
     * \`\`\`
     *
     * A literal `true` disables it unconditionally.
     */
    disabled?: ConditionRule;

    /**
     * Message to display when the field is disabled by a condition.
     */
    disabledMessage?: string;

    /**
     * Clear the field's value when it becomes disabled.
     * @default false
     */
    clearOnDisabled?: boolean;

    /**
     * Hide the field completely when this condition evaluates to true.
     * The field is removed from the form (not just visually hidden).
     *
     * A literal `true` hides it unconditionally. This is the way to keep a
     * property out of the form without keeping it out of the collection.
     */
    hidden?: ConditionRule;

    /**
     * Make the field read-only when this condition evaluates to true.
     * Renders as a preview instead of an input.
     *
     * A literal `true` makes it read-only unconditionally.
     */
    readOnly?: ConditionRule;

    // ═══════════════════════════════════════════════════════════════════════
    // VALIDATION CONDITIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Make the field required when this condition evaluates to true.
     * Overrides the static `validation.required` setting.
     */
    required?: JsonLogicRule;

    /**
     * Custom message when conditional required validation fails.
     */
    requiredMessage?: string;

    /**
     * Dynamic minimum value for number/string length.
     * Should evaluate to a number.
     */
    min?: JsonLogicRule;

    /**
     * Dynamic maximum value for number/string length.
     * Should evaluate to a number.
     */
    max?: JsonLogicRule;

    // ═══════════════════════════════════════════════════════════════════════
    // VALUE CONDITIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Dynamic default value for new entities.
     * Should evaluate to a value of the appropriate type for the field.
     * Only applied when entityId is empty (new entity).
     */
    defaultValue?: JsonLogicRule;

    // ═══════════════════════════════════════════════════════════════════════
    // ENUM CONDITIONS (for string/number properties with enum values)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Conditions for individual enum values.
     * Keys are the enum value IDs, values are condition configs.
     *
     * @example Disable certain enum options based on user role
     * \`\`\`json
     * {
     *   "admin": {
     *     "disabled": { "!": { "hasRole": "admin" } },
     *     "disabledMessage": "Admin option requires admin role"
     *   }
     * }
     * \`\`\`
     */
    enumConditions?: Record<string | number, EnumValueConditions>;

    /**
     * Filter which enum values are available.
     * Should evaluate to an array of allowed enum value IDs.
     */
    allowedEnumValues?: JsonLogicRule;

    /**
     * Exclude specific enum values.
     * Should evaluate to an array of enum value IDs to exclude.
     */
    excludedEnumValues?: JsonLogicRule;

    // ═══════════════════════════════════════════════════════════════════════
    // REFERENCE CONDITIONS (for reference properties)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Dynamic path for reference properties.
     * Should evaluate to a collection path string.
     */
    referencePath?: JsonLogicRule;

    /**
     * Dynamic filter for reference selection.
     * Should evaluate to a FilterValues object.
     */
    referenceFilter?: JsonLogicRule;

    // ═══════════════════════════════════════════════════════════════════════
    // ARRAY CONDITIONS (for array properties)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Can elements be added to the array?
     */
    canAddElements?: JsonLogicRule;

    /**
     * Can elements be reordered in the array?
     */
    sortable?: JsonLogicRule;

    // ═══════════════════════════════════════════════════════════════════════
    // STORAGE CONDITIONS (for file upload properties)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Dynamic accepted file types.
     * Should evaluate to an array of MIME types.
     */
    acceptedFiles?: JsonLogicRule;

    /**
     * Dynamic maximum file size in bytes.
     * Should evaluate to a number.
     */
    maxFileSize?: JsonLogicRule;
}

/**
 * Context available during JSON Logic condition evaluation.
 * Mirrors PropertyBuilderProps but adapted for JSON serialization.
 * @group Entity properties
 */
export interface ConditionContext {
    /**
     * Current form/entity values.
     * Date values are converted to Unix timestamps (milliseconds).
     */
    values: Record<string, unknown>;

    /**
     * Previous values before the current edit session.
     */
    previousValues: Record<string, unknown>;

    /**
     * Current value of this property specifically.
     */
    propertyValue: unknown;

    /**
     * Collection path (e.g., "products", "users/uid123/orders")
     */
    path: string;

    /**
     * Entity ID. Undefined for new entities.
     */
    entityId?: string;

    /**
     * Whether this is a new entity being created.
     */
    isNew: boolean;

    /**
     * Index of this property (only for array items).
     */
    index?: number;

    /**
     * Current authenticated user information.
     */
    user: {
        uid: string;
        email: string | null;
        displayName: string | null;
        photoURL: string | null;
        /** Role IDs the user has (extracted from Role[].id) */
        roles: string[];
    };

    /**
     * Current timestamp as Unix milliseconds.
     */
    now: number;
}

import type { CollectionCallbacks } from "./entity_callbacks";

import type { EnumValues, Properties, PostgresProperties, FirebaseProperties, MongoProperties } from "./properties";

import type { User } from "../users";
import type { EmailSendResult } from "../controllers/email";
import type { Relation } from "./relations";
import type { SecurityRule } from "./security_rules";
import { getDataSourceCapabilities } from "./data_source";
import type { WhereFilterOp, FilterValues, FilterPreset } from "./filter-operators";
import type { SearchConfig } from "./search";
import type { CollectionIndex } from "./indexes";

/**
 * Base interface containing all driver-agnostic collection properties.
 * Use {@link PostgresCollectionConfig} or {@link FirebaseCollectionConfig} for
 * driver-specific type safety, or {@link CollectionConfig} when you
 * need to handle any collection regardless of backend.
 *
 * @group Models
 */
export interface BaseCollectionConfig<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> {

    /**
     * The collection's identity. Required, and the value nearly everything else
     * keys on:
     *
     * - the REST path — `/api/data/<slug>`
     * - the SDK accessor — `client.data.<slug>` / `client.data.collection("<slug>")`
     * - the admin panel's URL
     * - the target of a `reference` or `relation` property
     *
     * Conventionally kebab-case and plural (`blog-posts`). It is independent of
     * {@link table}: the slug is what callers say, the table is where the rows
     * live, and renaming one does not rename the other.
     *
     * Treat it as frozen once anything has shipped against it — changing a slug
     * changes every URL and every generated accessor at once.
     *
     * @example
     * defineCollection({
     *     slug: "blog-posts",   // /api/data/blog-posts, client.data.blogPosts
     *     table: "posts",
     *     properties: { … }
     * })
     */
    slug: string;

    /**
     * Name of the collection, typically plural.
     * E.g. `Products`, `Blog`
     */
    name: string;

    /**
     * Singular name of an entry in this collection
     * E.g. `Product`, `Blog entry`
     */
    singularName?: string;

    /**
     * Optional description of this view. You can use Markdown.
     */
    description?: string;

    /**
     * Child collections nested under entities of this collection.
     * Populated automatically during normalization from driver-specific fields
     * (e.g. Firebase `subcollections`, Postgres `relations` with many-cardinality).
     *
     * Custom drivers can set this directly to expose child collections to the UI.
     */
    childCollections?: () => CollectionConfig<Record<string, unknown>>[];


    /**
     * The data source this collection belongs to — the routing key shared by
     * the frontend router and the backend driver registry. It points at a
     * {@link DataSourceDefinition} registered on `<Rebase dataSources>` (front)
     * and `initializeRebaseBackend({ dataSources })` (back).
     *
     * If not specified, the default data source `"(default)"` is used, which
     * for a standard Rebase app is the server-mediated Postgres backend.
     *
     * @example
     * // Default data source (server-mediated Postgres)
     * { slug: "products" }
     *
     * // A direct-transport Firestore data source registered as "analytics"
     * { slug: "events", dataSource: "analytics" }
     *
     * // The same, spelled once — `defineCollection` accepts the handle
     * // `database("analytics")` returned and records its key here.
     * import { analytics } from "../resources";
     * defineCollection({ slug: "events", dataSource: analytics, … })
     *
     * A string on the recorded collection, because a collection is data past
     * `defineCollection`: it serialises, it compares with `===`, and it reaches
     * the admin UI over the wire, none of which a handle survives.
     */
    dataSource?: string;

    /**
     * The database engine backing this collection (`"postgres"`, `"firestore"`,
     * `"mongodb"`, or a custom id).
     *
     * On concrete collection types ({@link PostgresCollectionConfig},
     * {@link FirebaseCollectionConfig}, {@link MongoDBCollectionConfig}) this is a literal
     * discriminant. On the base type it is optional and gets stamped
     * automatically during collection normalization from the registered
     * {@link DataSourceDefinition}.
     *
     * Prefer setting {@link dataSource} and letting the engine be resolved.
     */
    engine?: string;

    /**
     * Which database within the engine.
     * - For Firestore: The Firestore database ID (e.g., for multi-database projects)
     * - For PostgreSQL: Schema or database name
     * - For MongoDB: Database name
     *
     * If not specified, the default database of the engine is used. Resolved
     * from the collection's {@link DataSourceDefinition} when omitted here.
     */
    databaseId?: string;

    /**
     * Set of properties that compose a entity
     */
    properties: Properties;












    /**
     * Mark this collection as an authentication collection.
     * When true, this collection is used for user management, login, password hashing, and invitation flows.
     */
    auth?: boolean | AuthCollectionConfig;







    /**
     * Row-level authorization rules for this collection.
     *
     * Driver-agnostic on purpose, unlike `disableDefaultPolicies`, `table` and
     * `relations`, which are declared on {@link PostgresCollectionConfig} only.
     * The rules are a *contract* — who may read or write which rows — and each
     * engine enforces it its own way:
     *
     * - **Postgres** compiles them to real `CREATE POLICY` statements and lets
     *   the database enforce them (see {@link PostgresCollectionConfig.securityRules},
     *   which narrows this with the raw-SQL details).
     * - **MongoDB** translates them into a query filter it AND-s into every
     *   read and write, honouring `access`, `ownerField`, `roles`, `mode` and
     *   the `operation`/`operations` selectors, and making a best effort at raw
     *   `using`/`withCheck` SQL.
     * - **Firestore** does not implement them at all; its own rules language is
     *   evaluated by Google, not from here. `supportsRLS` on
     *   {@link DataSourceCapabilities} reports which engines generate policies,
     *   which is not the same question as whether an engine honours a rule.
     */
    securityRules?: readonly SecurityRule[];

    /**
     * This interface defines all the callbacks that can be used when a entity
     * is being created, updated or deleted.
     * Useful for adding your own logic or blocking the execution of the operation.
     */
    readonly callbacks?: CollectionCallbacks<M, USER>;















    /**
     * User id of the owner of this collection. This is used only by plugins, or if you
     * are writing custom code
     */
    ownerId?: string;

    /**
     * Arbitrary key-value metadata for external consumers.
     * Not interpreted by Rebase — passed through serialization unchanged.
     * Used by domain apps to store custom per-collection config.
     */
    metadata?: Record<string, unknown>;




    /**
     * If set to true, changes to the entity will be saved in a subcollection.
     * This prop has no effect if the history plugin is not enabled
     */
    history?: boolean;

    /**
     * Whether a write naming a field this collection does not declare is
     * rejected with a 400. Defaults to `true`.
     *
     * Set to `false` where a column really does exist that the config never
     * declared — populated by a trigger, or introspected rather than declared —
     * and callers need to write it. The column still has to exist: the driver
     * checks the key against the table's own columns whatever this is set to,
     * because a key with no column behind it is not passed to the database and
     * refused, it is dropped from the statement and answered 201.
     *
     * It does not let a typo through to Postgres for Postgres to judge. That is
     * what this flag was documented as doing, and no such judgment ever
     * happened.
     */
    strictWrites?: boolean;








}

// ── Driver-specific collection types ──────────────────────────────────

/**
 * A collection backed by PostgreSQL (or any SQL database).
 * Adds support for SQL-style relations (JOINs) and Row Level Security.
 *
 * Use this type instead of {@link CollectionConfig} when you want
 * compile-time safety that only SQL-relevant fields appear.
 *
 * @group Models
 */
export interface PostgresCollectionConfig<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User>
    extends BaseCollectionConfig<M, USER> {
    properties: PostgresProperties;

    /**
     * The database engine for this collection. For Postgres collections this
     * can be omitted (Postgres is the default) or set to `"postgres"`.
     */
    engine?: "postgres" | undefined;

    /**
     * The PostgreSQL table name for this collection.
     *
     * Optional: it defaults to `toSnakeCase(slug)`, which is what
     * `getTableName()` has always returned when it was absent. The type simply
     * demanded what the runtime already derived, so the smallest collection
     * anyone could write named its table twice —
     * `{ slug: "todos", table: "todos", … }` — and "why do I write it twice"
     * is the first question every evaluator asked.
     *
     * Set it only when the table name differs from the slug: an existing
     * database whose table is `blog_posts` while the URL should stay `posts`.
     *
     * Note that a **derived** name is still a real name, and nothing yet warns
     * when one moves. Foreign-key and junction column defaults are derived from
     * the *slug* rather than from this field, so renaming a slug re-derives
     * them on the next `db push` even where `table` is pinned.
     */
    table?: string;

    /**
     * The PostgreSQL schema name for this table.
     * E.g. "public", "rebase", "auth".
     * If not specified, "public" is used (or the default search path).
     */
    schema?: string;

    /**
     * For SQL databases, you can define the relations between collections here.
     * Relations describe JOINs, foreign keys, and junction tables.
     */
    relations?: Relation[];

    /**
     * Security rules for this collection (PostgreSQL Row Level Security).
     * When defined, the schema generator will enable RLS on the table and
     * create the corresponding PostgreSQL policies.
     *
     * Supports three levels of expressiveness:
     * 1. **Convenience shortcuts** — `ownerField`, `access`, `roles`
     * 2. **Raw SQL** — `using` and `withCheck` for full PostgreSQL power
     * 3. **Combined** — mix shortcuts with `roles` for common patterns
     *
     * The authenticated user context is available in raw SQL via:
     * - `rebase.uid()`   — the current user's ID
     * - `rebase.roles()` — comma-separated app role IDs
     * - `rebase.jwt()`   — full JWT claims as JSONB
     */
    securityRules?: readonly SecurityRule[];

    /**
     * Opt out of the framework's default Row Level Security policies.
     *
     * The schema generator automatically injects, for every collection, a
     * baseline SELECT policy granting the trusted server context and the
     * `admin` role read access (reads run under a restricted role, so RLS
     * default-denies without it). For auth collections it additionally injects
     * a self-read policy (`id = rebase.uid()`) and an admin-only write gate
     * (INSERT/UPDATE/DELETE require the `admin` role or the trusted server
     * context), making privileged columns such as `roles` safe by default.
     *
     * Author-defined `securityRules` are permissive and broaden access on top
     * of these defaults. Set this flag to `true` to remove the defaults
     * entirely and take full responsibility for the collection's RLS.
     *
     * @default false
     */
    disableDefaultPolicies?: boolean;

    /**
     * Opt in to Postgres full-text search for this collection.
     *
     * Omit it and `.search()` keeps its existing behaviour exactly — an
     * `ILIKE '%term%'` across top-level string properties. Declare it and the
     * collection gains one generated `tsvector` column and a GIN index, and
     * `.search()` compiles to a ranked `@@ websearch_to_tsquery` against them.
     *
     * Postgres-only, like {@link VectorProperty}: the block is rejected at boot
     * on other engines rather than silently ignored.
     *
     * @see SearchConfig
     */
    search?: SearchConfig;

    /**
     * Ordinary indexes on this collection's table.
     *
     * Collection-level, not per-property, because an index over two columns
     * has no single property to hang on and a partial index has none at all —
     * and because a second declaration site for the single-column case would
     * put the same object in two places. An index's identity is a column list
     * in an order; the single-column case is a degenerate one, not a special
     * one.
     *
     * `VectorProperty.index` stays where it is: an ANN structure is a property
     * of the column's type, not of a query.
     *
     * Postgres-only, like {@link SearchConfig}: refused on another engine
     * rather than silently ignored.
     */
    indexes?: readonly CollectionIndex<Extract<keyof M, string>>[];
}

/**
 * A collection backed by Firebase / Firestore.
 * Adds support for subcollections (nested document collections).
 *
 * Use this type instead of {@link CollectionConfig} when you want
 * compile-time safety that only Firestore-relevant fields appear.
 *
 * @group Models
 */
export interface FirebaseCollectionConfig<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User>
    extends BaseCollectionConfig<M, USER> {
    /**
     * The database engine for this collection. Must be set to `"firestore"`.
     */
    engine: "firestore";

    /**
     * Set of properties that compose a entity.
     * Firestore collections support `reference` properties but not `relation`.
     */
    properties: FirebaseProperties;

    /**
     * The Firestore collection path to query. Defaults to `slug` if not set.
     * Use this when the Firestore path differs from the slug
     * (e.g., when a PostgreSQL collection already uses the same slug).
     *
     * @example
     * ```typescript
     * const fsCustomer: FirebaseCollectionConfig = {
     *     slug: "fs_customer",        // URL: /c/fs_customer
     *     path: "customer",           // Firestore path: customer
     *     name: "Customers (Firestore)",
     *     engine: "firestore",
     *     properties: { ... }
     * };
     * ```
     */
    path?: string;

    /**
     * You can add subcollections to your entity in the same way you define the root
     * collections. The collections added here will be displayed when opening
     * the side dialog of a entity.
     */
    subcollections?: () => CollectionConfig<Record<string, unknown>>[];
}

/**
 * A collection backed by MongoDB.
 *
 * Use this type instead of {@link CollectionConfig} when you want
 * compile-time safety that only MongoDB-relevant fields appear.
 *
 * @group Models
 */
export interface MongoDBCollectionConfig<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User>
    extends BaseCollectionConfig<M, USER> {

    /**
     * The database engine for this collection. Must be set to `"mongodb"`.
     */
    engine: "mongodb";

    /**
     * Set of properties that compose a entity.
     * MongoDB collections support `reference` properties but not `relation`.
     */
    properties: MongoProperties;

    /**
     * The MongoDB collection name to use. Defaults to `slug` if not set.
     * Use this when the MongoDB collection name differs from the slug
     * (e.g., when a PostgreSQL collection already uses the same slug).
     *
     * @example
     * ```typescript
     * const mongoCustomer: MongoDBCollectionConfig = {
     *     slug: "mongo_customer",      // URL: /c/mongo_customer
     *     path: "customer",            // MongoDB collection: customer
     *     name: "Customers (MongoDB)",
     *     engine: "mongodb",
     *     properties: { ... }
     * };
     * ```
     */
    path?: string;
}

/**
 * A collection backed by any data source.
 * This is a discriminated union — use {@link PostgresCollectionConfig},
 * {@link FirebaseCollectionConfig}, or {@link MongoDBCollectionConfig} for
 * driver-specific type safety.
 *
 * @group Models
 */
export type CollectionConfig<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> =
    | PostgresCollectionConfig<M, USER>
    | FirebaseCollectionConfig<M, USER>
    | MongoDBCollectionConfig<M, USER>;

/**
 * A collection of *any* row type.
 *
 * `CollectionConfig` is **invariant** in `M`: `callbacks` both consumes `M`
 * (`AfterReadProps<M>`) and produces it, so neither direction of assignment
 * holds. `CollectionConfig<SomeRow>` is therefore not assignable to a bare
 * `CollectionConfig`, whose `M` defaults to `Record<string, unknown>`.
 *
 * That matters wherever a collection is merely *referred to* rather than read
 * from. `defineCollection` returns a config whose `M` is inferred from the
 * properties — the whole point of it — so a field typed `() => CollectionConfig`
 * rejects every collection the builder produces, and `target: () => otherCollection`
 * (the documented way to point a relation at its other end) does not compile in
 * any project that uses the builder.
 *
 * `any` is deliberate and is what it is for here: these positions never read the
 * target's rows, they only identify which collection is meant, so there is no
 * type safety to preserve and invariance is pure obstruction.
 *
 * @group Models
 */
export type AnyCollectionConfig = CollectionConfig<any, any>;

/**
 * Type guard for PostgreSQL collections.
 * Returns true if the collection uses the Postgres engine (or the default engine).
 *
 * Generic over the *input* type, and narrows by intersection rather than
 * replacement. Narrowing to a bare `PostgresCollectionConfig` discarded whatever
 * the caller actually had — most visibly the admin panel's view model, whose
 * flattened presentation fields vanished the moment a collection passed through
 * one of these guards.
 *
 * @group Models
 */
export function isPostgresCollectionConfig<C extends CollectionConfig<any, any>>(
    collection: C
): collection is C & PostgresCollectionConfig<any, any> {
    return !collection.engine || collection.engine === "postgres";
}

/**
 * Narrows to the SQL collection fields — `table`, `relations`,
 * `disableDefaultPolicies` — by asking the engine's declared capabilities
 * rather than by naming Postgres.
 *
 * The two halves of this already existed and were never joined. The engine
 * split (`PostgresCollectionConfig` / `FirebaseCollectionConfig` /
 * `MongoDBCollectionConfig`) said which fields belong to which engine at the
 * type level; {@link DataSourceCapabilities} said the same thing at runtime,
 * down to a `supportsRelations` flag. So call sites guarded on the capability
 * and then read a field the base type had to declare for them — which is why
 * those fields were on the base, and why a MongoDB collection could be written
 * with a `table`.
 *
 * Prefer this over {@link isPostgresCollectionConfig} wherever the question is
 * "does this collection live in a SQL table", so a custom SQL engine
 * registered through `registerDataSourceCapabilities` is included.
 *
 * @group Models
 */
export function isRelationalCollectionConfig<C extends CollectionConfig<any, any>>(
    collection: C
): collection is C & PostgresCollectionConfig<any, any> {
    return getDataSourceCapabilities(collection.engine).supportsRelations;
}

/**
 * Type guard for Firebase / Firestore collections.
 * @group Models
 */
export function isFirebaseCollectionConfig<C extends CollectionConfig<any, any>>(
    collection: C
): collection is C & FirebaseCollectionConfig<any, any> {
    return collection.engine === "firestore";
}

/**
 * Type guard for MongoDB collections.
 * @group Models
 */
export function isMongoDBCollectionConfig<C extends CollectionConfig<any, any>>(
    collection: C
): collection is C & MongoDBCollectionConfig<any, any> {
    return collection.engine === "mongodb";
}

/**
 * Returns the data path for a collection.
 * For Firestore or MongoDB collections with a `path`, returns that value;
 * otherwise falls back to `slug`.
 */
export function getCollectionDataPath<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User>(
    collection: CollectionConfig<M, USER>
): string {
    if (isFirebaseCollectionConfig(collection) && collection.path) {
        return collection.path;
    }
    if (isMongoDBCollectionConfig(collection) && collection.path) {
        return collection.path;
    }
    return collection.slug;
}

/**
 * Reads a collection's driver-declared subcollections thunk (the `subcollections`
 * field) independent of engine identity, so engine-agnostic code doesn't have to
 * type-guard against a specific driver. Returns `undefined` when the collection
 * declares none.
 *
 * Pair with `getDataSourceCapabilities(engine).supportsSubcollections` to decide
 * whether the engine honours subcollections at all before reading them.
 * @group Models
 */
export function getDeclaredSubcollections<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User>(
    collection: CollectionConfig<M, USER>
): (() => CollectionConfig<Record<string, unknown>>[]) | undefined {
    return (collection as FirebaseCollectionConfig<M, USER>).subcollections;
}

/**
 * Where the rows in an {@link EntityChildView} come from.
 *
 * The two are not the same thing, and conflating them is what made a Postgres
 * relation borrow Firestore's addressing:
 *
 * - `subcollection` is **containment**. The rows live under the parent; the
 *   path is their identity, and they cannot exist without it. This is what
 *   Firestore has natively.
 * - `relation` is a **link**. The rows are an ordinary collection, narrowed to
 *   those the parent reaches. `owned` means the child carries the parent's
 *   foreign key and belongs to it alone; `linked` means the row is shared
 *   through a junction, so what the parent controls is the link, not the row.
 *
 * @group Models
 */
export type ChildViewSource =
    | { kind: "subcollection" }
    | {
        kind: "relation";
        relationKey: string;
        mode: "owned" | "linked";
        /**
         * Slug of the collection the rows actually live in.
         *
         * Distinct from the view's `key`, which is the relation. A `linked` view
         * needs both: the key addresses the parent's set, and this addresses the
         * whole collection to pick an existing row out of.
         */
        targetSlug: string;
    };

/**
 * A list of rows rendered inside an entity view — the tab under a record.
 *
 * This is a *presentation* descriptor, which is the whole point: rendering a
 * related list as a tab used to require minting a child `CollectionConfig` with
 * its own slug, which dragged a URL grammar, a path resolver and a second
 * read/write pipeline along with it. A tab needs a key, a collection to list,
 * and to know where its rows come from.
 *
 * @group Models
 */
export interface EntityChildView<M extends Record<string, unknown> = Record<string, unknown>> {
    /**
     * Stable identifier for this view: the tab id and the path segment.
     *
     * For a relation this is the **relation key** — the name the backend
     * resolves a nested path segment by — not the target collection's slug.
     * Those differ whenever a relation is named, which is every inline relation
     * property, and the mismatch is why such a tab used to open onto an error.
     */
    key: string;

    /** The collection whose rows this view lists, with any overrides applied. */
    collection: CollectionConfig<M>;

    source: ChildViewSource;
}


export type { WhereFilterOp, FilterValues, WireFilterValues, FilterPreset } from "./filter-operators";


export type InferCollectionConfigType<S extends CollectionConfig> = S extends CollectionConfig<infer M> ? M : never;

/**
 * Configuration for authentication collections.
 *
 * Controls what happens when admins create users, reset passwords,
 * and which entity actions are auto-injected.
 *
 * Use `auth: true` as sugar for `{ enabled: true }` with all defaults.
 *
 * @example Override user creation
 * ```ts
 * auth: {
 *     enabled: true,
 *     onCreateUser: async (values, ctx) => {
 *         const hash = await ctx.hashPassword("welcome123");
 *         return {
 *             values: { ...values, passwordHash: hash, emailVerified: true },
 *             temporaryPassword: "welcome123",
 *         };
 *     },
 * }
 * ```
 *
 * @example Disable the reset-password entity action
 * ```ts
 * auth: {
 *     enabled: true,
 *     actions: { resetPassword: false },
 * }
 * ```
 *
 * @group Models
 */
export interface AuthCollectionConfig {
    /** Set to true to mark this collection as the authentication collection. */
    enabled: boolean;

    /**
     * Called when an admin creates a user via the collection REST API.
     *
     * Default: generate password → hash → normalize email → save →
     *          send invitation email (or return temp password if no email configured).
     *
     * Override to implement custom invitation flows, LDAP sync, etc.
     */
    onCreateUser?: (
        values: Record<string, unknown>,
        ctx: AuthCollectionContext
    ) => Promise<AuthCollectionCreateResult>;

    /**
     * Called when an admin resets a user's password via the admin panel.
     *
     * Default: generate reset token → send email (or generate + return temp password).
     * Override for custom reset flows.
     */
    onResetPassword?: (
        uid: string,
        ctx: AuthCollectionContext
    ) => Promise<AuthCollectionResetResult>;

    /**
     * Control which auth-specific entity actions are auto-injected.
     *
     * Default: `{ resetPassword: true }` — the framework auto-injects
     * the built-in `resetPasswordAction` into the collection's entity actions.
     *
     * Set to `false` to disable, or pass a custom `EntityAction` to replace the UI.
     *
     * The object form is an `EntityAction` from `@rebasepro/cms-types`, typed
     * here as `object` because it is a React component with admin controllers in
     * its props and nothing on the server reads it — only whether the built-in
     * action is injected, which is the boolean.
     */
    actions?: {
        resetPassword?: boolean | object;
    };
}

/**
 * Context provided to collection-level auth hooks.
 *
 * This is a simplified facade over the server internals —
 * it exposes only what's needed for custom auth flows without
 * coupling collection config to internal interfaces.
 *
 * @group Models
 */
export interface AuthCollectionContext {
    /** Hash a password using the configured algorithm (scrypt by default). */
    hashPassword: (password: string) => Promise<string>;
    /**
     * Send an email. Only available when email service is configured.
     *
     * Resolves with what the provider reported — the assigned Message-ID, most
     * usefully — so a hook that sends a message can store the id and later
     * thread a reply back to it. Callers that do not care may ignore it.
     */
    sendEmail?: (options: { to: string; subject: string; html: string; text?: string }) => Promise<EmailSendResult>;
    /** Whether the email service is configured and available. */
    emailConfigured: boolean;
    /** The app name from email config (for templates). */
    appName: string;
    /** The base URL for password reset links. */
    resetPasswordUrl: string;
}

/**
 * Result of a collection-level `onCreateUser` hook.
 * @group Models
 */
export interface AuthCollectionCreateResult {
    /** Processed values to persist (must include passwordHash, NOT raw password). */
    values: Record<string, unknown>;
    /** If set, shown to the admin in the creation result dialog. */
    temporaryPassword?: string;
    /** Whether an invitation email was sent. */
    invitationSent?: boolean;
}

/**
 * Result of a collection-level `onResetPassword` hook.
 * @group Models
 */
export interface AuthCollectionResetResult {
    /** If set, shown to the admin. */
    temporaryPassword?: string;
    /** Whether a reset email was sent. */
    invitationSent?: boolean;
}

import React, { Dispatch, SetStateAction } from "react";
import type { Entity, EntityStatus, EntityValues } from "./entities";
import type { EntityCallbacks } from "./entity_callbacks";

import type { EnumValues, Properties } from "./properties";
import type { ExportConfig } from "./export_import";

import type { User } from "../users";
import type { RebaseContext } from "../rebase_context";
import type { Relation } from "./relations";
import type { EntityCustomView, FormViewConfig } from "./entity_views";
import type { EntityAction } from "./entity_actions";
import type { ComponentRef } from "./component_ref";
import type { CollectionComponentOverrideMap } from "./component_overrides";

/**
 * Base interface containing all driver-agnostic collection properties.
 * Use {@link PostgresCollection} or {@link FirebaseCollection} for
 * driver-specific type safety, or {@link EntityCollection} when you
 * need to handle any collection regardless of backend.
 *
 * @group Models
 */
export interface BaseEntityCollection<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> {

    /**
     * You can set an alias that will be used internally instead of the collection name.
     * The `slug` value will be used to determine the URL of the collection.
     * Note that you can use this value in reference properties too.
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
    childCollections?: () => EntityCollection<Record<string, unknown>>[];


    /**
     * The data source this collection belongs to — the routing key shared by
     * the frontend router and the backend driver registry. It points at a
     * {@link DataSourceDefinition} registered on `<Rebase dataSources>` (front)
     * and `initRebase({ dataSources })` (back).
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
     */
    dataSource?: string;

    /**
     * The engine backing this collection (`"postgres"`, `"firestore"`,
     * `"mongodb"`, or a custom id). Drives editor capabilities (relations vs
     * subcollections, RLS, column types).
     *
     * @deprecated Prefer {@link dataSource} for routing. `driver` is retained
     * as an engine hint and for backward compatibility: when `dataSource` is
     * omitted it also acts as the data-source key.
     *
     * If not specified, `"postgres"` is assumed.
     */
    driver?: string;

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
     * Set of properties that compose an entity
     */
    properties: Properties;

    /**
     * Icon for the navigation sidebar or cards.
     */
    icon?: string | React.ReactNode;

    /**
     * Navigation group for this collection.
     * Collections sharing the same group name will be visually grouped
     * together in the drawer and home page. If not set, the collection
     * falls into the default "Views" group.
     */
    group?: string;

    /**
     * Array of entity views that this collection has.
     * Can be an array of `EntityCustomView` or a string representing the key of a global `EntityCustomView`.
     */
    entityViews?: (string | EntityCustomView<Record<string, unknown>>)[];

    /**
     * Default preview properties displayed when this collection is referenced to.
     */
    previewProperties?: string[];

    /**
     * Properties to display as columns in the list view.
     * If not specified, the list view uses a smart default (Title, Status, Date).
     */
    listProperties?: string[];

    /**
     * Title property of the entity. This is the property that will be used
     * as the title in entity related views and references.
     * If not specified, the first property simple text property will be used.
     */
    readonly titleProperty?: Extract<keyof M, string> | (string & {});

    /**
     * When editing an entity, you can choose to open the entity in a side dialog
     * or in a full screen dialog. Defaults to `full_screen`.
     */
    openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";

    /**
     * Controls what happens when a user clicks on an entity in the collection view.
     * - `"edit"` (default): Opens the entity in the edit form.
     * - `"view"`: Opens a read-only detail view with an "Edit" button.
     */
    defaultEntityAction?: "view" | "edit";

    /**
     * Replace the default entity form with a custom component.
     * The Builder receives the same props as entity view tabs
     * (entity, formContext, collection, etc.) and has full control over the UI.
     *
     * Works in both edit mode and read-only mode (when `defaultEntityAction`
     * is `"view"`). In read-only mode, `formContext.readOnly` will be `true`.
     */
    formView?: FormViewConfig;

    /**
     * Prevent default actions from being displayed or executed on this collection.
     */
    disableDefaultActions?: ("edit" | "copy" | "delete")[];

    /**
     * Mark this collection as an authentication collection.
     * When true, this collection is used for user management, login, password hashing, and invitation flows.
     */
    auth?: boolean | AuthCollectionConfig;

    /**
     * Opt out of the framework's default Row Level Security policies for
     * authentication collections.
     *
     * When a collection has `auth` enabled, the schema generator automatically
     * injects an admin-only write policy (INSERT/UPDATE/DELETE require the
     * `admin` role, or the trusted server context) for any write operation that
     * the collection does not already cover with an explicit `securityRules`
     * entry. This makes privileged columns such as `roles` safe by default — a
     * non-admin cannot modify the user row through the data API regardless of
     * which code path issues the write.
     *
     * Defining your own write rule for an operation overrides the default for
     * that operation. Set this flag to `true` to remove the default policies
     * entirely and take full responsibility for the collection's RLS.
     *
     * @default false
     */
    disableDefaultAuthPolicies?: boolean;


    /**
     * Order in which the properties are displayed.
     * If you are specifying your collection as code, the order is the same as the
     * one you define in `properties`. Additional columns are added at the
     * end of the list, if the order is not specified.
     * You can use this prop to hide some properties from the table view.
     * Note that if you set this prop, other ways to hide fields, like
     * `hidden` in the property definition, will be ignored.
     * `propertiesOrder` has precedence over `hidden`.
     *     - For properties use the property key.
     *     - For additional fields use the field key.
     *     - If you have subcollections, you get a column for each subcollection,
     *       with the path (or alias) as the subcollection, prefixed with
     *       `subcollection:`. e.g. `subcollection:orders`.
     * You can use this prop to hide some properties from the table view.
     * Note that if you set this prop, other ways to hide fields, like
     * `hidden` in the property definition,will be ignored.
     * `propertiesOrder` has precedence over `hidden`.
     */
    propertiesOrder?: (Extract<keyof M, string> | (string & {}) | string | `subcollection:${string}`)[];

    /**
     * If enabled, content is loaded in batches. If `false` all entities in the
     * collection are loaded. This means that when reaching the end of the
     * collection, the CMS will load more entities.
     * You can specify a number to specify the pagination size (50 by default)
     * Defaults to `true`
     */
    pagination?: boolean | number;


    selectionEnabled?: boolean;

    /**
     * This interface defines all the callbacks that can be used when an entity
     * is being created, updated or deleted.
     * Useful for adding your own logic or blocking the execution of the operation.
     */
    readonly callbacks?: EntityCallbacks<M, USER>;

    /**
     * Pass your own selection controller if you want to control selected
     * entities externally.
     * @see useSelectionController
     */
    selectionController?: SelectionController<M>;

    /**
     * Force a filter in this view. If applied, the rest of the filters will
     * be disabled. Filters applied with this prop cannot be changed.
     * e.g. `fixedFilter: { age: [">", 18] }`
     * e.g. `fixedFilter: { related_user: ["==", new EntityReference("sdc43dsw2", "users")] }`
     */
    readonly fixedFilter?: FilterValues<Extract<keyof M, string> | (string & {})>;

    /**
     * Initial filters applied to the collection this collection is related to.
     * Defaults to none. Filters applied with this prop can be changed.
     * e.g. `defaultFilter: { age: [">", 18] }`
     * e.g. `defaultFilter: { related_user: ["==", new EntityReference("sdc43dsw2", "users")] }`
     */
    readonly defaultFilter?: FilterValues<Extract<keyof M, string> | (string & {})>; // setting FilterValues<M> can break defining collections by code

    /**
     * Pre-defined filter presets that appear as quick-access options in the
     * collection toolbar. Each preset applies a set of filters (and
     * optionally a sort order) with a single click.
     *
     * ```ts
     * filterPresets: [
     *   {
     *     label: "Shipped this month",
     *     filterValues: {
     *       status: ["==", "shipped"],
     *       order_date: [">=", new Date(Date.now() - 30 * 86400000)]
     *     }
     *   }
     * ]
     * ```
     */
    readonly filterPresets?: FilterPreset<Extract<keyof M, string> | (string & {})>[];

    /**
     * Default sort applied to this collection.
     * When setting this prop, entities will have a default order
     * applied in the collection.
     * e.g. `sort: ["order", "asc"]`
     */
    readonly sort?: [Extract<keyof M, string> | (string & {}), "asc" | "desc"];

    /**
     * You can add additional fields to the collection view by implementing
     * an additional field delegate.
     */
    readonly additionalFields?: AdditionalFieldDelegate<M, USER>[];

    /**
     * Default size of the rendered collection
     */
    defaultSize?: CollectionSize;

    /**
     * Can the elements in this collection be edited inline in the collection
     * view. If this flag is set to false but `permissions.edit` is `true`, entities
     * can still be edited in the side panel
     */
    inlineEditing?: boolean;

    /**
     * Should this collection be hidden from the main navigation panel, if
     * it is at the root level, or in the entity side panel if it's a
     * subcollection.
     * It will still be accessible if you reach the specified path.
     * You can also use this collection as a reference target.
     */
    hideFromNavigation?: boolean;

    /**
     * If you want to open custom views or subcollections by default when opening the edit
     * view of an entity, you can specify the path to the view here.
     * The path is relative to the current collection. For example if you have a collection
     * that has a custom view as well as a subcollection that refers to another entity, you can
     * either specify the path to the custom view or the path to the subcollection.
     */
    defaultSelectedView?: string | DefaultSelectedViewBuilder;

    /**
     * Should the ID of this collection be hidden from the form view.
     */
    hideIdFromForm?: boolean;

    /**
     * Should the ID of this collection be hidden from the grid view.
     */
    hideIdFromCollection?: boolean;

    /**
     * If set to true, the form will be auto-saved when the user changes
     * the value of a field.
     * Defaults to false.
     * When a new entity is created, this property can be updated to generated a new ID
     */
    formAutoSave?: boolean;

    /**
     *
     */
    exportable?: boolean | ExportConfig<USER>;

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
     * Width of the side dialog (in pixels) when opening an entity in this collection.
     */
    sideDialogWidth?: number | string;

    /**
     * If set to true, the default values of the properties will be applied
     * to the entity every time the entity is updated (not only when created).
     * Defaults to false.
     */
    alwaysApplyDefaultValues?: boolean;

    /**
     * If set to true, a tab including the JSON representation of the entity will be included.
     */
    includeJsonView?: boolean;

    /**
     * If set to true, changes to the entity will be saved in a subcollection.
     * This prop has no effect if the history plugin is not enabled
     */
    history?: boolean;

    /**
     * Should local changes be backed up in local storage, to prevent data loss on
     * accidental navigations.
     * - `manual_apply`: When the user navigates back to an entity with local changes,
     *   they will be prompted to restore the changes.
     * - `auto_apply`: When the user navigates back to an entity with local changes,
     *   the changes will be automatically applied.
     * - `false`: Local changes will not be backed up.
     * Defaults to `manual_apply`.
     */
    localChangesBackup?: "manual_apply" | "auto_apply" | false;

    /**
     * Default view mode for displaying this collection.
     * - "table": Display entities in a table with inline editing (default)
     * - "cards": Display entities as a grid of cards with thumbnails
     * - "kanban": Display entities in a Kanban board grouped by a property
     * Defaults to "table".
     */
    defaultViewMode?: ViewMode;

    /**
     * Which view modes are available for this collection.
     * Possible values: "table", "cards", "kanban".
     * Defaults to all three: ["table", "cards", "kanban"].
     * Note: "kanban" will only be available if the collection has at least
     * one string property with `enum` defined, regardless of this setting.
     */
    enabledViews?: ViewMode[];

    /**
     * Configuration for Kanban board view mode.
     * When set, the Kanban view mode becomes available.
     */
    kanban?: KanbanConfig<M>;

    /**
     * Property key to use for ordering items.
     * Must reference a string/text property. When items are reordered,
     * this property will be updated with lexicographic sort keys
     * (e.g. "a0", "a1", "a0V") using string-based fractional indexing.
     * Used by Kanban view for ordering within columns
     * and can be used for general ordering purposes.
     */
    readonly orderProperty?: Extract<keyof M, string> | (string & {});

    /**
     * Actions that can be performed on the entities in this collection.
     */
    entityActions?: EntityAction<M, USER>[];

    /**
     * Builder for the collection actions rendered in the toolbar
     */
    Actions?: ComponentRef<CollectionActionsProps>[];

    /**
     * The database table name for this collection.
     * Automatically set for PostgreSQL collections.
     * For non-SQL backends, this may be undefined.
     */
    table?: string;

    /**
     * Relations defined for this collection.
     * Populated at normalization time from inline relation properties
     * or explicit relation definitions.
     */
    relations?: Relation[];

    /**
     * Security rules for this collection (Row Level Security).
     * When defined, the backend enforces access control policies.
     */
    securityRules?: SecurityRule[];

    /**
     * Collection-scoped component overrides. These take precedence over
     * global overrides set on `<Rebase>`, but only within this collection's
     * views (entity form, detail view, table, empty state, etc.).
     *
     * Only collection-scoped components (like `Entity.Form`, `Collection.EmptyState`,
     * `Collection.Card`, etc.) can be overridden here. App-level components
     * (like `Shell.AppBar`, `HomePage`) can only be overridden at the `<Rebase>` level.
     *
     * @example
     * ```tsx
     * const productsCollection: PostgresCollection = {
     *     name: "Products",
     *     slug: "products",
     *     table: "products",
     *     components: {
     *         "Entity.Form": { Component: ProductCustomForm },
     *         "Collection.Card": { Component: ProductCard },
     *     },
     *     properties: { ... }
     * };
     * ```
     */
    components?: CollectionComponentOverrideMap;
}

// ── Driver-specific collection types ──────────────────────────────────

/**
 * A collection backed by PostgreSQL (or any SQL database).
 * Adds support for SQL-style relations (JOINs) and Row Level Security.
 *
 * Use this type instead of {@link EntityCollection} when you want
 * compile-time safety that only SQL-relevant fields appear.
 *
 * @group Models
 */
export interface PostgresCollection<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User>
    extends BaseEntityCollection<M, USER> {
    properties: Properties;

    /**
     * The driver for this collection. For Postgres collections this
     * can be omitted (Postgres is the default) or set to `"postgres"`.
     */
    driver?: "postgres" | undefined;

    /**
     * The PostgreSQL table name for this collection.
     */
    table: string;

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
     * Security rules for this collection (Supabase-style Row Level Security).
     * When defined, the schema generator will enable RLS on the table and
     * create the corresponding PostgreSQL policies.
     *
     * Supports three levels of expressiveness:
     * 1. **Convenience shortcuts** — `ownerField`, `access`, `roles`
     * 2. **Raw SQL** — `using` and `withCheck` for full PostgreSQL power
     * 3. **Combined** — mix shortcuts with `roles` for common patterns
     *
     * The authenticated user context is available in raw SQL via:
     * - `auth.uid()`   — the current user's ID
     * - `auth.roles()` — comma-separated app role IDs
     * - `auth.jwt()`   — full JWT claims as JSONB
     */
    securityRules?: SecurityRule[];
}

/**
 * A collection backed by Firebase / Firestore.
 * Adds support for subcollections (nested document collections).
 *
 * Use this type instead of {@link EntityCollection} when you want
 * compile-time safety that only Firestore-relevant fields appear.
 *
 * @group Models
 */
export interface FirebaseCollection<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User>
    extends BaseEntityCollection<M, USER> {
    /**
     * The driver for this collection. Must be set to `"firestore"`.
     */
    driver: "firestore";

    /**
     * The Firestore collection path to query. Defaults to `slug` if not set.
     * Use this when the Firestore path differs from the slug
     * (e.g., when a PostgreSQL collection already uses the same slug).
     *
     * @example
     * ```typescript
     * const fsCustomer: FirebaseCollection = {
     *     slug: "fs_customer",        // URL: /c/fs_customer
     *     path: "customer",           // Firestore path: customer
     *     name: "Customers (Firestore)",
     *     driver: "firestore",
     *     properties: { ... }
     * };
     * ```
     */
    path?: string;

    /**
     * You can add subcollections to your entity in the same way you define the root
     * collections. The collections added here will be displayed when opening
     * the side dialog of an entity.
     */
    subcollections?: () => EntityCollection<Record<string, unknown>>[];
}

/**
 * A collection backed by MongoDB.
 *
 * Use this type instead of {@link EntityCollection} when you want
 * compile-time safety that only MongoDB-relevant fields appear.
 *
 * @group Models
 */
export interface MongoDBCollection<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User>
    extends BaseEntityCollection<M, USER> {

    /**
     * The driver for this collection. Must be set to `"mongodb"`.
     */
    driver: "mongodb";

    /**
     * The MongoDB collection name to use. Defaults to `slug` if not set.
     * Use this when the MongoDB collection name differs from the slug
     * (e.g., when a PostgreSQL collection already uses the same slug).
     *
     * @example
     * ```typescript
     * const mongoCustomer: MongoDBCollection = {
     *     slug: "mongo_customer",      // URL: /c/mongo_customer
     *     path: "customer",            // MongoDB collection: customer
     *     name: "Customers (MongoDB)",
     *     driver: "mongodb",
     *     properties: { ... }
     * };
     * ```
     */
    path?: string;
}

/**
 * A collection backed by any data source.
 * This is a discriminated union — use {@link PostgresCollection},
 * {@link FirebaseCollection}, or {@link MongoDBCollection} for
 * driver-specific type safety.
 *
 * @group Models
 */
export type EntityCollection<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> =
    | PostgresCollection<M, USER>
    | FirebaseCollection<M, USER>
    | MongoDBCollection<M, USER>;

// ── Capability intersection types ─────────────────────────────────────
// Use these after a `getDataSourceCapabilities()` guard to safely access
// driver-specific fields without coupling to a concrete driver type.

/**
 * An EntityCollection that supports SQL-style relations (e.g. Postgres).
 * @deprecated Use `EntityCollection` directly — `table`, `relations`, and `securityRules` are now on `BaseEntityCollection`.
 */
export type CollectionWithRelations<M extends Record<string, unknown> = Record<string, unknown>> =
    EntityCollection<M> & { table?: string; relations?: Relation[]; securityRules?: SecurityRule[] };

/** An EntityCollection that supports subcollections (e.g. Firestore). */
export type CollectionWithSubcollections<M extends Record<string, unknown> = Record<string, unknown>> =
    EntityCollection<M> & { subcollections?: () => EntityCollection<Record<string, unknown>>[] };


// ── Type guards ───────────────────────────────────────────────────────

/**
 * Type guard for PostgreSQL collections.
 * Returns true if the collection uses the Postgres driver (or the default driver).
 * @group Models
 */
export function isPostgresCollection<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User>(
    collection: EntityCollection<M, USER>
): collection is PostgresCollection<M, USER> {
    return !collection.driver || collection.driver === "postgres";
}

/**
 * Type guard for Firebase / Firestore collections.
 * @group Models
 */
export function isFirebaseCollection<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User>(
    collection: EntityCollection<M, USER>
): collection is FirebaseCollection<M, USER> {
    return collection.driver === "firestore";
}

/**
 * Type guard for MongoDB collections.
 * @group Models
 */
export function isMongoDBCollection<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User>(
    collection: EntityCollection<M, USER>
): collection is MongoDBCollection<M, USER> {
    return collection.driver === "mongodb";
}

/**
 * Returns the data path for a collection.
 * For Firestore or MongoDB collections with a `path`, returns that value;
 * otherwise falls back to `slug`.
 */
export function getCollectionDataPath<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User>(
    collection: EntityCollection<M, USER>
): string {
    if (isFirebaseCollection(collection) && collection.path) {
        return collection.path;
    }
    if (isMongoDBCollection(collection) && collection.path) {
        return collection.path;
    }
    return collection.slug;
}


/**
 * Configuration for Kanban board view mode.
 * @group Collections
 */
export interface KanbanConfig<M extends Record<string, unknown> = Record<string, unknown>> {
    /**
     * Property key to use for Kanban board columns.
     * Must reference a string property with `enum` values defined.
     * Entities will be grouped into columns based on this property's value.
     * The column order is determined by the order of `enum` values in the property.
     */
    columnProperty: Extract<keyof M, string> | (string & {});
}

/**
 * View mode for displaying a collection.
 * - "list": Simple, clean list view — the classic CMS default
 * - "table": Table with inline editing
 * - "cards": Grid of visual cards with thumbnails
 * - "kanban": Board view grouped by a property
 * @group Collections
 */
export type ViewMode = "list" | "table" | "cards" | "kanban";

/**
 * Parameter passed to the `Actions` prop in the collection configuration.
 * The component will receive this prop when it is rendered in the collection
 * toolbar.
 *
 * @group Models
 */
export interface CollectionActionsProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User, EC extends EntityCollection<M> = EntityCollection<M>> {
    /**
     * Full collection path of this entity. This is the full path, like
     * `users/1234/addresses`
     */
    path: string;

    /**
     * Path of the last collection, like `addresses`
     */
    relativePath: string;

    /**
     * Array of the parent path segments like `['users']`
     */
    parentCollectionSlugs: string[];
    parentEntityIds: string[];

    /**
     * The collection configuration
     */
    collection: EC;

    /**
     * Use this controller to get the selected entities and to update the
     * selected entities state.
     */
    selectionController: SelectionController<M>;

    /**
     * Use this controller to get the table controller and to update the
     * table controller state.
     */
    tableController: EntityTableController<M>;

    /**
     * Context of the app status
     */
    context: RebaseContext<USER>;

    /**
     * Count of the entities in this collection.
     * undefined means the count is still loading.
     */
    collectionEntitiesCount?: number;

    /**
     * Programmatically open the new-document form for this collection,
     * optionally pre-populating it with initial field values.
     * The form opens in the same mode configured for the collection
     * (side panel, full screen, or split).
     *
     * This is the primary hook for workflows that need to create a document
     * from external data — e.g. fetching content from a URL, importing from
     * a third-party API, or duplicating from another system.
     *
     * @example
     * // Inside a custom CollectionAction component:
     * openNewDocument({ title: "Fetched title", body: "..." });
     */
    openNewDocument: (defaultValues?: Record<string, unknown>) => void;

}

/**
 * Use this controller to retrieve the selected entities or modify them in
 * an {@link EntityCollection}
 * @group Models
 */
export interface SelectionController<M extends Record<string, unknown> = Record<string, unknown>> {
    selectedEntities: Entity<M>[];
    setSelectedEntities(entities: Entity<M>[]): void;
    setSelectedEntities(action: (prev: Entity<M>[]) => Entity<M>[]): void;
    isEntitySelected(entity: Entity<M>): boolean;
    toggleEntitySelection(entity: Entity<M>, newSelectedState?: boolean): void;
}

/**
 * Filter conditions in a `Query.where()` clause are specified using the
 * strings `<`, `<=`, `==`, `>=`, `>`, `array-contains`, `in`, and `array-contains-any`.
 * @group Models
 */
export type WhereFilterOp =
    | "<"
    | "<="
    | "=="
    | "!="
    | ">="
    | ">"
    | "array-contains"
    | "in"
    | "not-in"
    | "array-contains-any";

/**
 * Used to define filters applied in collections
 *
 * e.g. `{ age: [">=", 18] }`
 *
 * @group Models
 */
export type FilterValues<Key extends string> =
    Partial<Record<Key, [WhereFilterOp, unknown] | [WhereFilterOp, unknown][]>>;

/**
 * A pre-defined filter preset for quick access in the collection toolbar.
 * Users can select a preset to instantly apply a set of filters and
 * optionally a sort order.
 *
 * @group Models
 */
export interface FilterPreset<Key extends string = string> {
    /**
     * Display label shown in the preset menu.
     * If omitted, a summary is auto-generated from the filter keys.
     */
    label?: string;

    /**
     * The filter values to apply when this preset is selected.
     */
    filterValues: FilterValues<Key>;

    /**
     * Optional sort override to apply alongside the filter values.
     */
    sort?: [Key, "asc" | "desc"];
}


/**
 * Used to indicate valid filter combinations (e.g. created in Firestore)
 * If the user selects a specific filter/sort combination, the CMS checks if it's
 * valid, otherwise it reverts to the simpler valid case
 * @group Models
 */
export type FilterCombination<Key extends string> = Partial<Record<Key, "asc" | "desc">>;

/**
 * Sizes in which a collection can be rendered
 * @group Models
 */
export type CollectionSize = "xs" | "s" | "m" | "l" | "xl";

export type AdditionalFieldDelegateProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> = {
    entity: Entity<M>,
    context: RebaseContext<USER>
};

/**
 * Use this interface for adding additional fields to entity collection views and forms.
 * @group Models
 */
export interface AdditionalFieldDelegate<M extends Record<string, unknown> = Record<string, unknown>,
    USER extends User = User> {

    /**
     * ID of this column. You can use this id in the `properties` field of the
     * collection in any order you want
     */
    key: string;

    /**
     * Header of this column
     */
    name: string;

    /**
     * Width of the generated column in pixels
     */
    width?: number;

    /**
     * Builder for the custom field
     */
    Builder?(props: { entity: Entity<M>, context: RebaseContext<USER> }): React.ReactNode;


    /**
     * If this column needs to update dynamically based on other properties,
     * you can define an array of keys as strings with the
     * `dependencies` prop.
     * e.g. ["name", "surname"]
     * This is a performance optimization, if you don't define dependencies
     * it will be updated in every render.
     */
    dependencies?: NoInfer<Extract<keyof M, string>> | NoInfer<Extract<keyof M, string>>[] | (string & {}) | (string & {})[];

    /**
     * Use this prop to define the value of the column as a string or number.
     * This is the value that will be used for exporting the collection.
     * If `Builder` is defined, this prop will be ignored in the collection
     * view.
     * @param entity
     */
    value?(props: {
        entity: Entity<M>,
        context: RebaseContext
    }): string | number | Promise<string | number> | undefined;
}


export type InferCollectionType<S extends EntityCollection> = S extends EntityCollection<infer M> ? M : never;

/**
 * Used in the {@link EntityCollection#defaultSelectedView} to define the default
 * @group Models
 */
export type DefaultSelectedViewBuilder = (params: DefaultSelectedViewParams) => string | undefined;

/**
 * Used in the {@link EntityCollection#defaultSelectedView} to define the default
 * @group Models
 */
export type DefaultSelectedViewParams = {
    status?: EntityStatus;
    entityId?: string | number;
};
/**
 * You can use this controller to control the table view of a collection.
 */
export type EntityTableController<M extends Record<string, unknown> = Record<string, unknown>> = {
    data: Entity<M>[];
    dataLoading: boolean;
    noMoreToLoad: boolean;
    dataLoadingError?: Error;
    filterValues?: FilterValues<Extract<keyof M, string> | (string & {})>;
    setFilterValues?: (filterValues: FilterValues<Extract<keyof M, string> | (string & {})>) => void;
    sortBy?: [Extract<keyof M, string> | (string & {}), "asc" | "desc"];
    setSortBy?: (sortBy?: [Extract<keyof M, string> | (string & {}), "asc" | "desc"]) => void;
    searchString?: string;
    setSearchString?: (searchString?: string) => void;
    clearFilter?: () => void;
    itemCount?: number;
    setItemCount?: (itemCount: number) => void;
    initialScroll?: number;
    onScroll?: (props: {
        scrollDirection: "forward" | "backward",
        scrollOffset: number,
        scrollUpdateWasRequested: boolean
    }) => void;
    paginationEnabled?: boolean;
    pageSize?: number;
    checkFilterCombination?: (filterValues: FilterValues<string>,
        sortBy?: [string, "asc" | "desc"]) => boolean;
    popupCell?: SelectedCellProps<M>;
    setPopupCell?: (popupCell?: SelectedCellProps<M>) => void;

    onAddColumn?: (column: string) => void;
}

export type SelectedCellProps<M extends Record<string, unknown> = Record<string, unknown>> = {
    propertyKey: Extract<keyof M, string> | (string & {});
    cellRect: DOMRect;
    width: number;
    height: number;
    entityPath: string;
    entityId: string | number;
};

/**
 * SQL operation that a policy applies to.
 * @group Models
 */
export type SecurityOperation = "select" | "insert" | "update" | "delete" | "all";

/**
 * Flexible Row Level Security rule for a collection.
 *
 * Inspired by Supabase's approach to PostgreSQL RLS. Rules can range from
 * simple convenience shortcuts to fully custom SQL expressions, giving you the
 * full power of PostgreSQL Row Level Security.
 *
 * The authenticated user's identity is available in raw SQL via:
 * - `auth.uid()`   — the user's ID
 * - `auth.roles()` — comma-separated app role IDs
 * - `auth.jwt()`   — full JWT claims as JSONB
 *
 * These are set automatically per-transaction by the backend.
 *
 * **How rules combine:** PostgreSQL evaluates all matching policies for an
 * operation. Permissive rules are OR'd together (any one passing is enough).
 * Restrictive rules are AND'd (all must pass). This mirrors Supabase behavior.
 *
 * **Mutual exclusivity:** `ownerField`, `access`, and raw SQL (`using`/`withCheck`)
 * cannot be combined. The type system enforces this — attempting to set
 * conflicting fields will produce a compile-time error.
 *
 * @group Models
 */
export type SecurityRule = OwnerSecurityRule | PublicSecurityRule | RawSQLSecurityRule | RolesOnlySecurityRule;

/**
 * Shared fields for all SecurityRule variants.
 * @group Models
 */
export interface SecurityRuleBase {
    /**
     * Optional human-readable name for the policy.
     * If not provided, one will be auto-generated from the table name and operation.
     * Must be unique per table.
     *
     * When using `operations` (array), each generated policy will have the
     * operation name appended, e.g. `"owner_access_select"`, `"owner_access_update"`.
     */
    name?: string;

    /**
     * Which SQL operation this policy applies to.
     * Use this when the policy targets a single operation or all operations.
     *
     * For multiple specific operations, use `operations` (array) instead.
     * If neither is specified, defaults to `"all"`.
     *
     * @default "all"
     */
    operation?: SecurityOperation;

    /**
     * Array of SQL operations this policy applies to.
     * The compiler will generate one PostgreSQL policy per operation, sharing
     * the same configuration.
     *
     * This reduces boilerplate when the same rule applies to multiple (but not all)
     * operations.
     *
     * Takes precedence over `operation` (singular) if both are specified.
     *
     * @example
     * // Same rule for select and update
     * { operations: ["select", "update"], ownerField: "user_id" }
     *
     * @example
     * // Equivalent to operation: "all"
     * { operations: ["all"], ownerField: "user_id" }
     */
    operations?: SecurityOperation[];

    /**
     * Whether this policy is `"permissive"` (default) or `"restrictive"`.
     *
     * - **permissive**: Multiple permissive policies for the same operation are
     *   OR'd together — if *any* passes, access is granted.
     * - **restrictive**: Restrictive policies are AND'd with all permissive
     *   policies — they act as additional gates that *must* also pass.
     *
     * This is the same model as PostgreSQL / Supabase.
     *
     * @default "permissive"
     */
    mode?: "permissive" | "restrictive";

    /**
     * **Shortcut.** Restrict this rule to users that have one of these
     * application-level roles.
     *
     * **Important:** These are NOT native PostgreSQL database roles. They are
     * application roles managed by Rebase, stored in the `rebase.user_roles`
     * table, and injected into each transaction via `auth.roles()`.
     *
     * Generates a condition like:
     *   `auth.roles() ~ '<role1>|<role2>'`
     *
     * Can be combined with `ownerField`, `access`, or raw `using`/`withCheck`.
     * When combined, the role check is AND'd with the other condition.
     *
     * @example
     * // Only admins can delete
     * { operation: "delete", roles: ["admin"] }
     *
     * @example
     * // Admins have unfiltered read access to all rows
     * { operation: "select", roles: ["admin"], using: "true" }
     */
    roles?: string[];

    // ── Advanced: native PostgreSQL role targeting ───────────────────────

    /**
     * **Advanced.** Native PostgreSQL database roles the policy applies to.
     *
     * By default, all generated policies target the `public` role (i.e.
     * every database connection). This is correct for most setups where
     * a single database role is used for all connections.
     *
     * **Important:** These are NOT the same as the application-level `roles`
     * (admin, editor, viewer, etc.) — those are enforced in the USING/WITH
     * CHECK clauses via `auth.roles()`. This field controls the PostgreSQL
     * `TO` clause in `CREATE POLICY ... TO role_name`.
     *
     * Use this if you have dedicated PostgreSQL roles (e.g. `app_read`,
     * `app_write`) and want policies to target specific ones.
     *
     * @default ["public"]
     *
     * @example
     * // Only apply this policy when connected as `app_role`
     * { operation: "select", access: "public", pgRoles: ["app_role"] }
     */
    pgRoles?: string[];
}

/**
 * Security rule that grants access based on row ownership.
 * Generates a USING/WITH CHECK clause like: `<column> = auth.uid()`
 *
 * Cannot be combined with `using`, `withCheck`, or `access`.
 *
 * @example
 * { operation: "all", ownerField: "user_id" }
 *
 * @group Models
 */
export interface OwnerSecurityRule extends SecurityRuleBase {
    /** The property (column) that stores the owner's user ID. */
    ownerField: string;
    access?: never;
    using?: never;
    withCheck?: never;
}

/**
 * Security rule that grants unrestricted row access (no row filtering).
 * Generates `USING (true)`.
 *
 * This means "no row-level filter", NOT "anonymous/unauthenticated access".
 * Authentication is still enforced at the API layer — this only controls which
 * *rows* authenticated users can see.
 *
 * Cannot be combined with `using`, `withCheck`, or `ownerField`.
 *
 * @example
 * // Public read (any authenticated user sees all rows)
 * { operation: "select", access: "public" }
 *
 * @group Models
 */
export interface PublicSecurityRule extends SecurityRuleBase {
    /** Grant unrestricted row access for this operation. */
    access: "public";
    ownerField?: never;
    using?: never;
    withCheck?: never;
}

/**
 * Security rule using raw SQL expressions for full PostgreSQL RLS power.
 *
 * Cannot be combined with `ownerField` or `access`.
 *
 * You can reference columns via `{column_name}` which will be resolved to
 * `table.column_name` in the generated Drizzle code.
 *
 * @example
 * // Rows published in the last 30 days are visible
 * { operation: "select", using: "{published_at} > now() - interval '30 days'" }
 *
 * @example
 * // Only the owner, or users with 'moderator' role
 * {
 *   operation: "select",
 *   using: "{user_id} = auth.uid() OR auth.roles() ~ 'moderator'"
 * }
 *
 * @group Models
 */
export interface RawSQLSecurityRule extends SecurityRuleBase {
    /**
     * Raw SQL expression for the `USING` clause.
     * This controls which *existing* rows are visible / can be modified / deleted.
     * Applied to SELECT, UPDATE, and DELETE.
     */
    using: string;

    /**
     * Raw SQL expression for the `WITH CHECK` clause.
     * This controls which *new/updated* row values are allowed.
     * Applied to INSERT and UPDATE.
     *
     * If not provided on INSERT/UPDATE policies, falls back to `using`
     * (which matches PostgreSQL's own default behavior).
     */
    withCheck?: string;

    ownerField?: never;
    access?: never;
}

/**
 * Security rule that only filters by application roles, without any
 * row-level condition (USING/WITH CHECK).
 *
 * Useful for simple "only admins can access this table" rules where
 * no per-row filtering is needed.
 *
 * @example
 * // Only admins can delete
 * { operation: "delete", roles: ["admin"] }
 *
 * @group Models
 */
export interface RolesOnlySecurityRule extends SecurityRuleBase {
    ownerField?: never;
    access?: never;
    using?: never;
    withCheck?: never;
}

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
        userId: string,
        ctx: AuthCollectionContext
    ) => Promise<AuthCollectionResetResult>;

    /**
     * Control which auth-specific entity actions are auto-injected.
     *
     * Default: `{ resetPassword: true }` — the framework auto-injects
     * the built-in `resetPasswordAction` into the collection's entity actions.
     *
     * Set to `false` to disable, or pass a custom `EntityAction` to replace the UI.
     */
    actions?: {
        resetPassword?: boolean | EntityAction;
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
    /** Send an email. Only available when email service is configured. */
    sendEmail?: (options: { to: string; subject: string; html: string; text?: string }) => Promise<void>;
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

/**
 * The typed admin block, and the type you author a collection against.
 *
 * A collection is one file. Schema, security rules and callbacks sit at the top
 * level, where the backend reads them; everything the admin panel renders sits
 * under `admin`. `@rebasepro/types` declares that field as an opaque
 * {@link AdminBlock} because a server has no use for a kanban column definition
 * and naming one would drag `React.ReactNode` back into the BaaS contract. This
 * is the other side of that boundary — the 38 fields, fully typed, in the package
 * where React exists.
 *
 * Each field is declared exactly once, here. Core does not carry a React-free
 * skeleton of the same shape; two definitions that agree only by luck is the
 * `WhereFilterOp` mistake, and this block is far bigger than one union.
 */
import type React from "react";
import type {
    AdminBlock,
    CollectionConfig,
    ComponentRef,
    FilterPreset,
    FilterValues,
    FirebaseCollectionConfig,
    FirebaseProperties,
    InferEntityType,
    MongoDBCollectionConfig,
    MongoProperties,
    OrderByTuple,
    PostgresCollectionConfig,
    PostgresProperties,
    User
} from "@rebasepro/types";
// A value, not a type: the runtime list core owns.
import { ADMIN_COLLECTION_KEYS as CORE_ADMIN_COLLECTION_KEYS } from "@rebasepro/types";

import type {
    AdditionalFieldDelegate,
    CollectionActionsProps,
    CollectionSize,
    DefaultSelectedViewBuilder,
    KanbanConfig,
    SelectionController,
    ViewMode
} from "./collections";
import type { EntityCustomView, FormViewConfig } from "./types/entity_views";
import type { EntityAction } from "./types/entity_actions";
import type { ExportConfig } from "./types/export_import";
import type { CollectionComponentOverrideMap } from "./types/component_overrides";

/**
 * Admin-panel presentation and behaviour for a collection.
 *
 * A `type` rather than an `interface`, and that is load-bearing: TypeScript gives
 * an implicit index signature to an object *type alias* but not to an interface,
 * so as an interface this would not be assignable to {@link AdminBlock} — and
 * every collection authored with a typed `admin` block would be rejected wherever
 * a plain `CollectionConfig` is expected. Declaration merging is not wanted here
 * anyway; a plugin adding fields to the block would have nothing reading them.
 *
 * @group Models
 */
export type AdminCollectionOptions<
    M extends Record<string, unknown> = Record<string, unknown>,
    USER extends User = User
> = {
    /**
     * Icon for the navigation sidebar or cards.
     *
     * Either a Lucide icon name (`"FileText"`, `"ShoppingCart"`) or a rendered
     * element. Prefer the name: it survives serialization, so the collection file
     * stays loadable by the backend and by `rebase generate-sdk`, and it is what
     * the schema editor writes back.
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
     * When editing a entity, you can choose to open the entity in a side dialog
     * or in a full screen dialog. Defaults to `full_screen`.
     */
    openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";

    /**
     * Controls what happens when a user clicks on a entity in the collection view.
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
     * Order in which the properties are displayed.
     * If you are specifying your collection as code, the order is the same as the
     * one you define in `properties`. Additional columns are added at the
     * end of the list, if the order is not specified.
     *
     * You can use this prop to hide some properties from the table view.
     * Note that if you set this prop, other ways to hide fields, like
     * `hidden` in the property definition, will be ignored.
     * `propertiesOrder` has precedence over `hidden`.
     *
     * Supported entry formats:
     *     - For properties, use the property key.
     *     - For additional fields, use the field key.
     *     - Child collections (Firestore subcollections, or Postgres relations
     *       with `many` cardinality) each get a column with id
     *       `subcollection:<slug>`, e.g. `subcollection:orders`.
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
    readonly sort?: OrderByTuple<Extract<keyof M, string> | (string & {})>;

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
     * view. Even when inline editing is disabled, entities can still be
     * edited in the side panel (subject to `securityRules`).
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
     * view of a entity, you can specify the path to the view here.
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
     * Width of the side dialog (in pixels) when opening a entity in this collection.
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
     * Should local changes be backed up in local storage, to prevent data loss on
     * accidental navigations.
     * - `manual_apply`: When the user navigates back to a entity with local changes,
     *   they will be prompted to restore the changes.
     * - `auto_apply`: When the user navigates back to a entity with local changes,
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
     * const productsCollection: PostgresCollectionConfig = {
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
    components?: CollectionComponentOverrideMap;};

/**
 * A collection typed for authoring: the BaaS contract, with `admin` narrowed from
 * {@link AdminBlock} to {@link AdminCollectionOptions}.
 *
 * This is what a collection file should be typed against in a CMS project. It is
 * assignable to `CollectionConfig` — `AdminCollectionOptions` satisfies
 * `AdminBlock`'s index signature — so the same object passes to
 * `initializeRebaseBackend`, the drizzle generator and the SDK codegen unchanged.
 *
 * @group Models
 */
export type AdminCollectionConfig<
    M extends Record<string, unknown> = Record<string, unknown>,
    USER extends User = User
> = WithTypedAdmin<CollectionConfig<M, USER>, M, USER>;

/** Distributive, for the reason spelled out on {@link WithFlatAdmin}. */
type WithTypedAdmin<C, M extends Record<string, unknown>, USER extends User> =
    C extends unknown
        ? Omit<C, "admin"> & { admin?: AdminCollectionOptions<M, USER> }
        : never;

/** {@link AdminCollectionConfig} for a Postgres collection. @group Models */
export type AdminPostgresCollectionConfig<
    M extends Record<string, unknown> = Record<string, unknown>,
    USER extends User = User
> = Omit<PostgresCollectionConfig<M, USER>, "admin"> & {
    admin?: AdminCollectionOptions<M, USER>;
};

/** {@link AdminCollectionConfig} for a Firestore collection. @group Models */
export type AdminFirebaseCollectionConfig<
    M extends Record<string, unknown> = Record<string, unknown>,
    USER extends User = User
> = Omit<FirebaseCollectionConfig<M, USER>, "admin"> & {
    admin?: AdminCollectionOptions<M, USER>;
};

/** {@link AdminCollectionConfig} for a MongoDB collection. @group Models */
export type AdminMongoDBCollectionConfig<
    M extends Record<string, unknown> = Record<string, unknown>,
    USER extends User = User
> = Omit<MongoDBCollectionConfig<M, USER>, "admin"> & {
    admin?: AdminCollectionOptions<M, USER>;
};

/**
 * Define a collection with the admin block type-checked.
 *
 * The same identity function as `defineCollection` in `@rebasepro/common` — which
 * is what a BaaS or headless project uses, and where `admin` is the opaque
 * {@link AdminBlock} — with one difference: here the block is
 * {@link AdminCollectionOptions}, so `admin: { icon, listProperties, kanban }`
 * gets completion and a typo is an error.
 *
 * Import it from the layer you are in. A project with an admin panel wants this
 * one; a project without one has no `admin` block to check.
 *
 * `const P` captures the literal property types, which is what gives
 * `admin.titleProperty`, `admin.sort` and `admin.propertiesOrder` completion over
 * the collection's own property keys rather than plain `string`.
 *
 * @example
 * export default defineCollection({
 *     slug: "posts",
 *     table: "posts",
 *     properties: {
 *         title: { name: "Title", type: "string" },
 *         status: { name: "Status", type: "string" }
 *     },
 *     admin: {
 *         icon: "FileText",
 *         titleProperty: "title",     // completion: "title" | "status"
 *         listProperties: ["title", "status"]
 *     }
 * });
 *
 * @group Builder
 */
export function defineCollection<
    const P extends PostgresProperties,
    USER extends User = User
>(
    collection: Omit<AdminPostgresCollectionConfig<InferEntityType<P>, USER>, "properties">
        & { properties: P }
): AdminPostgresCollectionConfig<InferEntityType<P>, USER> & { properties: P };

/** Define a Firestore-backed collection with the admin block checked. @group Builder */
export function defineCollection<
    const P extends FirebaseProperties,
    USER extends User = User
>(
    collection: Omit<AdminFirebaseCollectionConfig<InferEntityType<P>, USER>, "properties">
        & { properties: P }
): AdminFirebaseCollectionConfig<InferEntityType<P>, USER> & { properties: P };

/** Define a MongoDB-backed collection with the admin block checked. @group Builder */
export function defineCollection<
    const P extends MongoProperties,
    USER extends User = User
>(
    collection: Omit<AdminMongoDBCollectionConfig<InferEntityType<P>, USER>, "properties">
        & { properties: P }
): AdminMongoDBCollectionConfig<InferEntityType<P>, USER> & { properties: P };

/** Identity at runtime; the overloads above are the whole point. @group Builder */
export function defineCollection(collection: AdminCollectionConfig): AdminCollectionConfig {
    return collection;
}

/**
 * Re-exported from `@rebasepro/types`, where the list has to live: the ts-morph
 * schema editor in `@rebasepro/server` needs it to know which keys go inside the
 * block when it rewrites a collection file, and a core package may not import
 * this one. The list is plain data, so core is a fine home for it.
 *
 * What core *cannot* do is check the list against the type. That happens here.
 *
 * @group Models
 */
export type { AdminCollectionKey } from "@rebasepro/types";

/**
 * Core's list, re-exported through a `satisfies` clause that is the agreement
 * check: a key core names that is not an option here fails to compile, and
 * `satisfies` keeps the literal tuple type rather than widening it to `string[]`.
 *
 * The reverse direction — an option missing from core's list — has no type-level
 * expression, since there is no exhaustiveness check over an optional-property
 * keyof. `test/admin_collection.test.ts` counts them instead.
 */
export const ADMIN_COLLECTION_KEYS = CORE_ADMIN_COLLECTION_KEYS satisfies readonly (keyof AdminCollectionOptions)[];


/**
 * A collection as the admin panel works with it: the contract with the `admin`
 * block flattened onto the top level.
 *
 * The panel reads presentation fields in a few hundred places, and threading
 * `collection.admin?.propertiesOrder` through all of them would be noise that
 * buys nothing — the panel has already resolved the collection by then, merging
 * the declared config with the user's per-collection overrides from local
 * storage. So the panel gets a flat *view model*, exactly as it already does for
 * entities (`Entity` is an admin view model over flat rows, not a wire type).
 *
 * The distinction that matters is direction:
 *
 * - **Reading** a resolved collection → `AdminCollection` (flat, convenient).
 * - **Authoring or persisting** one → {@link AdminCollectionConfig} (nested,
 *   which is what the file on disk and the wire both look like).
 *
 * `admin` is kept alongside the flattened fields so the collection editor can
 * still see the block it has to write back.
 *
 * @group Models
 */
export type AdminCollection<
    M extends Record<string, unknown> = Record<string, unknown>,
    USER extends User = User
> = WithFlatAdmin<CollectionConfig<M, USER>, M, USER>;

/**
 * Flatten the admin block onto one member of the collection union at a time.
 *
 * `CollectionConfig` is a union discriminated on `engine`
 * (Postgres | Firestore | MongoDB), and a bare `Omit<Union, "admin">` collapses it
 * into a single object type with the discriminant widened. The result stops being
 * assignable back to `CollectionConfig`, so every call that hands a resolved
 * collection to a core function fails — which is exactly what happened. The
 * `C extends unknown` clause makes the mapping distributive, so each member keeps
 * its literal `engine` and stays assignable to its counterpart.
 */
type WithFlatAdmin<C, M extends Record<string, unknown>, USER extends User> =
    C extends unknown
        ? Omit<C, "admin"> & AdminCollectionOptions<M, USER> & { admin?: AdminCollectionOptions<M, USER> }
        : never;

/** {@link AdminCollection} for a Postgres collection. @group Models */
export type AdminPostgresCollection<
    M extends Record<string, unknown> = Record<string, unknown>,
    USER extends User = User
> = Omit<PostgresCollectionConfig<M, USER>, "admin">
    & AdminCollectionOptions<M, USER>
    & { admin?: AdminCollectionOptions<M, USER> };

/**
 * Flatten a collection's `admin` block onto it, producing the panel's view model.
 *
 * Shallow by design: the block's fields are independent, so a deep merge would
 * only create opportunities for a nested object to be half from one source and
 * half from the other. `admin` survives on the result.
 *
 * Idempotent — flattening an already-flat collection returns an equivalent one —
 * because the panel resolves collections at more than one entry point (the
 * registry, `<Rebase collections>`, a plugin's `modifyCollection`) and they must
 * not fight over which has run.
 */
export function resolveAdminCollection<
    M extends Record<string, unknown> = Record<string, unknown>,
    USER extends User = User
>(collection: AdminCollectionConfig<M, USER> | AdminCollection<M, USER>): AdminCollection<M, USER> {
    const block = (collection as { admin?: AdminCollectionOptions<M, USER> }).admin;
    if (!block) return collection as AdminCollection<M, USER>;
    return { ...(collection as AdminCollection<M, USER>), ...block, admin: block };
}

/**
 * The inverse: lift flattened admin fields back into the block.
 *
 * Used on the way out — persisting from the collection editor, or handing a
 * collection to anything that expects the authoring shape. Any key in
 * {@link ADMIN_COLLECTION_KEYS} found at the top level is moved down, so a
 * round trip through the panel does not leave the file flat.
 */
export function toAdminCollectionConfig<
    M extends Record<string, unknown> = Record<string, unknown>,
    USER extends User = User
>(collection: AdminCollection<M, USER> | AdminCollectionConfig<M, USER>): AdminCollectionConfig<M, USER> {
    const source = collection as Record<string, unknown>;
    const top: Record<string, unknown> = {};
    const block: Record<string, unknown> = { ...(source.admin as object ?? {}) };

    for (const [key, value] of Object.entries(source)) {
        if (key === "admin") continue;
        if ((ADMIN_COLLECTION_KEYS as readonly string[]).includes(key)) block[key] = value;
        else top[key] = value;
    }

    if (Object.keys(block).length > 0) top.admin = block;
    return top as AdminCollectionConfig<M, USER>;
}

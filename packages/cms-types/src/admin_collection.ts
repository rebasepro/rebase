/**
 * The typed admin block, and the type you author a collection against.
 *
 * A collection is one file. Schema, security rules and callbacks sit at the top
 * level, where the backend reads them; everything the admin panel renders sits
 * under `admin`. `@rebasepro/types` does not declare that field at all — naming a
 * kanban column definition would drag `React.ReactNode` back into the BaaS
 * contract, and a server has no use for one. `augment.ts` in this package declares
 * it, by declaration merging, onto core's `CollectionConfig`. So this is the other
 * side of that boundary: the 38 fields, fully typed, in the package where React
 * exists, and reachable only by a program that has opted in.
 *
 * Each field is declared exactly once, here. Core does not carry a React-free
 * skeleton of the same shape; two definitions that agree only by luck is the
 * `WhereFilterOp` mistake, and this block is far bigger than one union.
 */
import type React from "react";
import type {
    CollectionCallbacks,
    CollectionConfig,
    ComponentRef,
    FilterPreset,
    FilterValues,
    FirebaseCollectionConfig,
    FirebaseProperties,
    FirebaseProperty,
    InferEntityType,
    MongoDBCollectionConfig,
    MongoProperties,
    MongoProperty,
    OrderBySpec,
    PostgresCollectionConfig,
    PostgresProperties,
    PostgresProperty,
    Property,
    Properties,
    StrictProperties,
    User
} from "@rebasepro/types";
// A value, not a type: the runtime list core owns.
import { resolveResourceRefs, type ResourceRef } from "@rebasepro/types";
import { ADMIN_COLLECTION_KEYS as CORE_ADMIN_COLLECTION_KEYS, nestAdminCollectionKeys } from "@rebasepro/types";

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
import type { CollectionCustomView } from "./types/collection_views";
import type { EntityDisplay } from "./types/entity_display";
import type { FormLayoutConfig } from "./types/form_layout";
import type { EntityAction } from "./types/entity_actions";
import type { ExportConfig } from "./types/export_import";
import type { CollectionComponentOverrideMap } from "./types/component_overrides";

/**
 * A key naming one of `M`'s fields, or a dotted path into a `map` field.
 *
 * Both forms are resolved with `getValueInPath`, so `"profile.displayName"` is
 * as valid as `"title"`. Only the *root* is checked — the path below it is a
 * nested `Properties` object this type has no view of — which is enough to
 * reject the mistake that actually happens: a misspelled or removed field.
 *
 * When `M` is the default `Record<string, unknown>` — the plain
 * `const x: PostgresCollectionConfig = { … }` annotation, which infers nothing —
 * `Extract<keyof M, string>` is `string` and this accepts anything, exactly as
 * before. `defineCollection` is what supplies a real `M` and turns the check on.
 */
export type PropertyPath<M> =
    | Extract<keyof M, string>
    | `${Extract<keyof M, string>}.${string}`;

/**
 * The `display` block for a collection, with its property paths checked
 * against `M`.
 *
 * `EntityDisplay` is generic over the path type so that
 * `@rebasepro/cms-types`' two halves do not import each other in a cycle;
 * this alias is what an authoring site actually names.
 */
export type CollectionDisplay<
    M extends Record<string, unknown> = Record<string, unknown>,
    USER extends User = User
> = EntityDisplay<PropertyPath<M>, M, USER>;

/**
 * A key naming a *column* in the list view: a property path, a child-collection
 * column, or the `key` of one of this collection's `additionalFields`.
 *
 * `AdditionalFieldDelegate.key` is a plain `string`, and the block is not
 * generic over its own `additionalFields`, so there is no type-level channel
 * carrying those keys here. Accepting any string to cover them is what made this
 * field unchecked in the first place; instead the two provable arms are closed
 * and {@link AdditionalFieldKey} is the explicit, castable escape.
 */
export type ColumnKey<M> =
    | PropertyPath<M>
    | `subcollection:${string}`
    | AdditionalFieldKey;

/**
 * Opt-out for a `propertiesOrder` / `listProperties` entry that names an
 * `additionalFields` key rather than a property.
 *
 * The brand is **required**, which is the entire mechanism: a bare `"score"` is
 * not assignable, so the entry has to be written `"score" as AdditionalFieldKey`
 * — a visible admission that this key is not a property. An optional brand
 * (`__additionalFieldKey?: never`) would be satisfied by every string and put us
 * straight back to accepting typos.
 *
 * ```ts
 * propertiesOrder: ["title", "score" as AdditionalFieldKey]
 * ```
 */
export type AdditionalFieldKey = string & { readonly __additionalFieldKey: true };

/**
 * Admin-panel presentation and behaviour for a collection.
 *
 * A `type` rather than an `interface`, and that is load-bearing: TypeScript gives
 * an implicit index signature to an object *type alias* but not to an interface.
 * `toAdminCollectionConfig` has to widen a collection carrying this block to
 * `Record<string, unknown>` in order to move the flattened keys back under
 * `admin`, and as an interface that conversion is an error (TS2352, "index
 * signature for type 'string' is missing"). Flipping it and running
 * `pnpm typecheck` reproduces that in one line.
 *
 * Declaration merging is not wanted here anyway; a plugin adding fields to the
 * block would have nothing reading them.
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
    previewProperties?: Extract<keyof M, string>[];

    /**
     * Properties to display as columns in the list view.
     * If not specified, the list view uses a smart default (Title, Status, Date).
     */
    listProperties?: ColumnKey<M>[];

    /**
     * Lifecycle callbacks that run **in the browser**, in the admin panel.
     *
     * The twin of the collection's top-level `callbacks`, and the distinction is
     * only where the code runs — the shape is identical:
     *
     * - `callbacks` runs on the server, on every path that reaches it (REST,
     *   realtime, `dataAsAdmin`). Its bodies are stripped from the admin bundle,
     *   so a secret read there never leaves the server.
     * - `browserCallbacks` runs in the panel, and nowhere else. It ships to
     *   every visitor.
     *
     * This exists for collections on a `direct` or `custom` transport — a
     * Firestore collection the panel talks to itself, with no Rebase server in
     * the request path. Nothing server-side sees those writes, so `callbacks`
     * can never fire for them; this block is the only place their lifecycle
     * logic can live.
     *
     * Two rules follow from "ships to every visitor", and neither is a style
     * preference:
     *
     * 1. **No secrets.** No API keys, no `process.env`, no logic you would mind
     *    a reader of the bundle seeing. Put that in `callbacks`.
     * 2. **Not a security boundary.** A `browserCallbacks.afterRead` that
     *    redacts a field redacts it *after* the browser already holds the row —
     *    for a direct transport the raw document came straight from the store.
     *    It is presentation. Redaction that has to hold belongs in `callbacks`,
     *    or in the store's own rules.
     *
     * On a server-transport collection (the default) the server has already run
     * `callbacks` before the row arrives, so a `browserCallbacks.afterRead`
     * here runs *in addition* — write it to be idempotent, or don't write it.
     *
     * ```ts
     * admin: {
     *     browserCallbacks: {
     *         afterRead: ({ row }) => ({ ...row, label: `${row.city} (${row.code})` })
     *     }
     * }
     * ```
     */
    browserCallbacks?: CollectionCallbacks<M, USER>;

    /**
     * How a record of this collection shows up — its title, subtitle, image,
     * status, date and tags.
     *
     * Each role takes a property path or a resolver, and a resolver may be
     * async:
     *
     * ```ts
     * display: {
     *     title: "name",
     *     image: "cover.url",
     *     subtitle: ({ entity }) => `${entity.values.city}, ${entity.values.country}`,
     *     status: async ({ entity, context }) =>
     *         (await context.data.audits.get(`${entity.id}/latest`))?.state
     * }
     * ```
     *
     * Every role left out is derived from the property schema exactly as before,
     * so a collection that says nothing renders as it always did. See
     * {@link EntityDisplay} for what each role means and
     * {@link EntityDisplayResolver} for what a resolver is handed.
     */
    readonly display?: EntityDisplay<PropertyPath<M>, M, USER>;

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
     * How the generated form is laid out: which properties are grouped into
     * sections in the main column, and which are pulled out into the metadata
     * rail beside it.
     *
     * Entirely optional. With no `form` block the layout is derived from the
     * properties themselves — see {@link FormLayoutConfig} — which is what most
     * collections should rely on. Reach for this when the derived grouping is
     * wrong for your domain, not to restate it.
     *
     * Unlike {@link FormViewConfig}, this does not replace the generated form:
     * every field keeps its validation, error focus, local-changes restore and
     * autosave wiring.
     */
    form?: FormLayoutConfig<M>;

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
    propertiesOrder?: ColumnKey<M>[];

    /**
     * If enabled, content is loaded in batches. If `false` all entities in the
     * collection are loaded. This means that when reaching the end of the
     * collection, the admin will load more entities.
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
    readonly fixedFilter?: FilterValues<PropertyPath<M>>;

    /**
     * Initial filters applied to the collection this collection is related to.
     * Defaults to none. Filters applied with this prop can be changed.
     * e.g. `defaultFilter: { age: [">", 18] }`
     * e.g. `defaultFilter: { related_user: ["==", new EntityReference("sdc43dsw2", "users")] }`
     */
    // Keyed by property *path*, not by `FilterValues<M>` — the latter types each
    // value against that property's own type, which is what the old note here
    // warned breaks code-defined collections (an `EntityReference` filter on a
    // relation, a `Date` on a string column). Narrowing the key is independent
    // of that, and a dotted path still reaches into a `map`/jsonb column.
    readonly defaultFilter?: FilterValues<PropertyPath<M>>;

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
    readonly filterPresets?: FilterPreset<PropertyPath<M>>[];

    /**
     * Default sort applied to this collection.
     * When setting this prop, entities will have a default order
     * applied in the collection.
     *
     * One key, or several applied in order of significance — the second breaks
     * ties on the first, and so on. The row id breaks the last tie, so the
     * order is total and paging over it neither repeats nor skips rows.
     *
     * @example sort: ["order", "asc"]
     * @example sort: [["roles", "asc"], ["createdAt", "desc"]]
     */
    readonly sort?: OrderBySpec<PropertyPath<M>>;

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
     *
     * Note that this covers *both* roles at once. A collection that is a root
     * collection **and** the target of a many-relation is hidden in both places,
     * which is rarely what you want for a join or audit table: it should not be
     * a destination in the drawer, but it is exactly what you want to see on its
     * parent. Use {@link hideFromEntityViews} to separate the two.
     */
    hideFromNavigation?: boolean;

    /**
     * Should this collection be hidden from the tab strip of a parent entity,
     * when it is reached as a child view (a Firestore subcollection, or the
     * target of a `many`-cardinality relation).
     *
     * Independent of {@link hideFromNavigation}, which governs the drawer. The
     * two exist separately because a collection commonly plays both roles and
     * wants a different answer for each:
     *
     * - a join table (`company_members`) is not a destination but *is* a
     *   meaningful tab → `hideFromNavigation: true`, this left unset;
     * - a table with a dedicated workspace (`scraped_jobs`) may want the
     *   opposite, so the workspace stays the only way in.
     *
     * Defaults to `false`. Setting {@link hideFromNavigation} does not imply it.
     */
    hideFromEntityViews?: boolean;

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
     * - "list": Display entities as a list (default)
     * - "table": Display entities in a table with inline editing
     * - "cards": Display entities as a grid of cards with thumbnails
     * - "kanban": Display entities in a Kanban board grouped by a property
     * - any `key` from {@link customViews}
     * Defaults to "list".
     */
    defaultViewMode?: ViewMode;

    /**
     * Which view modes are available for this collection.
     * Possible values: "list", "table", "cards", "kanban", and any `key` from
     * {@link customViews}.
     * Defaults to all four built-ins plus every declared custom view.
     * Note: "kanban" will only be available if the collection has at least
     * one string property with `enum` defined, regardless of this setting.
     * With a single entry the view switcher is hidden.
     */
    enabledViews?: ViewMode[];

    /**
     * Additional ways to render this collection's rows, offered in the view
     * switcher beside list / table / cards / kanban.
     *
     * Can be an array of `CollectionCustomView` or a string naming the `key` of
     * one registered globally on `<RebaseCMS collectionViews={…}>`. The
     * string form is what lets a React-free config package reference React UI,
     * and it is what the collection editor stores.
     *
     * A custom view is another rendering of the *same query* — it is handed the
     * live table controller and inherits filters, search and the entity side
     * panel. Use an `AppView` instead for a workflow spanning collections.
     *
     * @example
     * ```ts
     * admin: {
     *     customViews: [
     *         { key: "map", name: "Map", icon: "Map", Builder: MapView }
     *     ],
     *     enabledViews: ["table", "map"],
     *     defaultViewMode: "map"
     * }
     * ```
     */
    customViews?: (string | CollectionCustomView<Record<string, unknown>>)[];

    /**
     * Configuration for Kanban board view mode.
     * When set, the Kanban view mode becomes available.
     *
     * A board is only half-configured without {@link orderProperty}. Cards
     * still drag between columns — that writes `columnProperty` — but their
     * order *within* a column has nowhere to be stored, so it resets on the
     * next read and the board renders a warning bar saying so. Declare both,
     * always.
     */
    kanban?: KanbanConfig<M>;

    /**
     * Property key to use for ordering items.
     *
     * Must reference a **string** property — a `number` can never hold one of
     * these keys, so a numeric `sortOrder` leaves the board permanently asking
     * to be initialised. The convention across the collections here is a
     * hidden `__order: { type: "string", admin: { disabled: true,
     * hideFromCollection: true } }`.
     *
     * Reordering writes a `fractional-indexing` key built from the base36,
     * lower-case alphabet `0123456789abcdefghijklmnopqrstuvwxyz` — `"i0"`,
     * `"i1"`, `"i0i"`. Single case because *Postgres* does the sorting and its
     * default collation is not byte ordering; base36 rather than the library's
     * default base62 for the same reason. Generating a key without passing
     * that alphabet yields base62 keys (`"a0"`), which this board rejects.
     *
     * Nothing assigns a key on insert. A row created by a cron, a seed, a
     * migration or the REST API lands with this property null, and the board
     * shows an **Initialize** bar until someone clicks it. Backends that
     * create rows for a board should append a key themselves — see the
     * "Kanban boards" section of the `rebase-collections` skill.
     *
     * Used by Kanban view for ordering within columns and can be used for
     * general ordering purposes.
     */
    readonly orderProperty?: Extract<keyof M, string>;

    /**
     * Actions that can be performed on the entities in this collection.
     *
     * An entry may be the action itself, or the `key` of one registered app-level
     * on `<RebaseCMS entityActions={…}>` — `resolveEntityAction` looks a string
     * up against that list.
     *
     * The key form is what lets a collection declared in a React-free config
     * package use an action whose UI is React: an action carries an `onClick` and
     * usually renders a dialog, so importing one into a collection file pulls the
     * admin bundle into any backend that loads it for its schema. Naming it costs
     * nothing there.
     *
     * `string` was accepted at runtime and by the collection editor — which stores
     * exactly these keys — long before the type said so, which meant the documented
     * approach needed a cast. Mirrors `entityViews`, typed this way already.
     */
    entityActions?: (string | EntityAction<M, USER>)[];

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
 * There is deliberately no `AdminCollectionConfig` here any more.
 *
 * It used to be `Omit<CollectionConfig, "admin"> & { admin?: AdminCollectionOptions }`,
 * a wrapper that existed because core typed the block opaquely. Now that `augment.ts`
 * declares `admin` directly on `BaseCollectionConfig`, `CollectionConfig` *is* the
 * authoring type — the wrapper would be an alias of it, and a second name for one thing
 * is what this whole refactor has been removing.
 *
 * A project opts its program in with one line, once:
 *
 * ```ts
 * /// <reference types="@rebasepro/cms-types" />
 * ```
 *
 * after which `admin` is typed on every collection and every property. Without it,
 * writing one is an error — which is the guarantee a BaaS install depends on.
 */

/**
 * The engines a collection can name. Absent means Postgres.
 *
 * The discriminant that replaced three overloads of `defineCollection`. See
 * {@link CollectionConfigForEngine} for why that mattered.
 */
type CollectionEngine = "postgres" | "firestore" | "mongodb";

/**
 * The concrete collection type an `engine` selects.
 *
 * `defineCollection` used to be three overloads — one per engine — and overload
 * resolution is what made its errors unreadable. When no overload matches,
 * TypeScript emits **one** diagnostic at the call site listing each overload's
 * *first* failure, so:
 *
 *  - a bad `defaultValue` **and** a misspelled `admin.display.title` in the same
 *    collection reported only the first. Fixing it revealed the second on the
 *    next run, one per edit-compile cycle;
 *  - the error landed on `defineCollection(`, not on the key that was wrong;
 *  - and every Postgres collection's error dragged `FirebaseCollectionConfig`
 *    and `MongoDBCollectionConfig` through the message, naming two engines the
 *    author had not mentioned and does not use.
 *
 * With one signature there is no resolution to fail: each error is reported
 * where it is, all of them at once, against the one config type the `engine`
 * selects.
 */
type CollectionConfigForEngine<E, P, USER extends User> =
    E extends "firestore" ? FirebaseCollectionConfig<EntityShapeOf<P>, USER>
        : E extends "mongodb" ? MongoDBCollectionConfig<EntityShapeOf<P>, USER>
            : PostgresCollectionConfig<EntityShapeOf<P>, USER>;

/**
 * `InferEntityType`, tolerant of a property map that has an error in it.
 *
 * `P` is deliberately **unconstrained** on the builder, and this is why. A
 * constraint TypeScript cannot satisfy is a constraint it silently falls back
 * from: one property with a bad `defaultValue` made `P extends PostgresProperties`
 * fail, `P` became `PostgresProperties`, `M` became `Record<string, unknown>`,
 * and every `admin` key — `display.title`, `listProperties`, `propertiesOrder` —
 * widened to `string` and stopped being checked. So a collection with two
 * mistakes reported one, and reported the second only after the first was fixed.
 *
 * With no constraint, `keyof P` survives a bad property and the `admin` block is
 * still checked against the real key set. Exactness and the engine gate move
 * into `StrictProperties`, which reports them on the property itself.
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
 * Define a collection with the admin block type-checked.
 *
 * The same identity function as `defineCollection` in `@rebasepro/common` — which
 * is what a BaaS or headless project uses, and where `admin` does not exist at all
 * — with one difference: importing this one brings the augmentation with it, so
 * `admin: { icon, listProperties, kanban }` gets completion and a typo is an
 * error. See {@link AdminCollectionOptions}.
 *
 * Import it from the layer you are in. A project with an admin panel wants this
 * one; a project without one has no `admin` block to check.
 *
 * `const P` captures the literal property types, which is what gives
 * `admin.display`, `admin.sort` and `admin.propertiesOrder` completion over
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
 *         display: { title: "title" },   // completion: "title" | "status"
 *         listProperties: ["title", "status"]
 *     }
 * });
 *
 * @group Builder
 */
export function defineCollection<
    const E extends CollectionEngine = "postgres",
    /**
     * The properties, **constrained**. This is what checks them, and — just as
     * importantly — what supplies the contextual type inside them: without a
     * constraint the parameter of an inline
     * `callbacks: { beforeSave: ({ value }) => … }` has nothing to be typed
     * from, and TypeScript reports an implicit `any` on a callback the author
     * wrote correctly.
     */
    const P extends PropertiesForEngine<E> & Properties = PropertiesForEngine<E> & Properties,
    /**
     * The properties again, **unconstrained**, and this is why there are two.
     *
     * A constraint TypeScript cannot satisfy is one it silently falls back
     * from: one property with a bad `defaultValue` made `P` become
     * `PostgresProperties`, the entity shape become `Record<string, unknown>`,
     * and every `admin` key — `display.title`, `listProperties`,
     * `propertiesOrder` — widen to `string` and stop being checked. A
     * collection with two mistakes reported one, and revealed the second only
     * after the first was fixed.
     *
     * `KEYS` has no constraint to fall back from, so `keyof KEYS` survives a bad
     * property and the `admin` block is still checked against the real key set.
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
 * At runtime this records the collection as data: a resource handle written
 * where a key belongs — `dataSource: analytics`, `storageSource: media` — is
 * replaced by its key, so what leaves here serialises and compares like the
 * string it always was. The signature above is the rest of the point.
 * @group Builder
 */
export function defineCollection(
    collection: Omit<CollectionConfig, "dataSource"> & { dataSource?: ResourceRef }
): CollectionConfig {
    return resolveResourceRefs(collection) as CollectionConfig;
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

/** Compiles only when `T` is `never` — see {@link _EveryAdminCollectionOptionIsListed}. */
type AssertNeverKey<T extends never = never> = T;

/** Local alias, so the assertion below can name the list's element type. */
type AdminCollectionKeyName = typeof CORE_ADMIN_COLLECTION_KEYS[number];

/**
 * Core's list, re-exported through a `satisfies` clause that is the agreement
 * check: a key core names that is not an option here fails to compile, and
 * `satisfies` keeps the literal tuple type rather than widening it to `string[]`.
 */
export const ADMIN_COLLECTION_KEYS = CORE_ADMIN_COLLECTION_KEYS satisfies readonly (keyof AdminCollectionOptions)[];

/**
 * And the reverse: an option declared here that core's list does not name.
 *
 * This direction was believed to have no type-level expression — `keyof` over
 * optional properties does in fact yield them all, so it does. A test counted
 * the list instead, which catches a *change* in size but not a key added to the
 * options and forgotten here.
 *
 * It matters more since the boot validator started warning about unrecognised
 * `admin` keys: a real option missing from this list would make the server
 * report a correct config as a typo, and a check that cries wolf gets switched
 * off. The compile error arrives at the person adding the option, which is the
 * only moment anyone can fix it cheaply.
 */
type _EveryAdminCollectionOptionIsListed =
    AssertNeverKey<Exclude<keyof AdminCollectionOptions, AdminCollectionKeyName>>;


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
 * - **Authoring or persisting** one → core's `CollectionConfig`, with the `admin`
 *   block this package augments onto it (nested, which is what the file on disk
 *   and the wire both look like).
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
>(collection: CollectionConfig<M, USER> | AdminCollection<M, USER>): AdminCollection<M, USER> {
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
 *
 * The nesting itself lives in `@rebasepro/types` because the schema editor in
 * `@rebasepro/server` — which cannot import this package — has to do exactly the
 * same thing when it writes a collection file back to disk. Two copies of the
 * rule disagreed on which side wins, and the disagreement was invisible.
 */
export function toAdminCollectionConfig<
    M extends Record<string, unknown> = Record<string, unknown>,
    USER extends User = User
>(collection: AdminCollection<M, USER> | CollectionConfig<M, USER>): CollectionConfig<M, USER> {
    return nestAdminCollectionKeys(collection as Record<string, unknown>) as unknown as CollectionConfig<M, USER>;
}

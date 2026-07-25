/**
 * The admin panel's half of a collection, as core sees it.
 *
 * A collection is still one file — schema, security and callbacks at the top
 * level, everything the admin panel renders under `admin`. The backend loads that
 * file and never looks inside the block, which is why the block is typed
 * opaquely here: 38 fields describing kanban columns, side-dialog widths and
 * toolbar actions have no meaning to a server, and naming them would put
 * `React.ReactNode` and nine UI controllers back in the BaaS contract.
 *
 * The real types live in `AdminCollectionOptions` in `@rebasepro/admin-types`,
 * which is where React exists. There is exactly one definition of each field —
 * declaring a React-free skeleton here as well would be the `WhereFilterOp`
 * mistake, two copies that agree only by luck. `AdminCollectionOptions` is
 * assignable to this, so a collection typed for authoring passes anywhere a
 * `CollectionConfig` is expected, with no cast and no generic threading.
 *
 * Two consequences, both intended:
 *
 * - Nothing in core can *read* a typed admin field. If a server ever needs one,
 *   that is a signal the field was misclassified, not a reason to widen this.
 * - The whole block is one subtree, so `serializeCollections` drops it in one
 *   step and `computeSchemaVersion` excludes it — an admin-only edit no longer
 *   changes the schema hash and reports every client's SDK as stale.
 *
 * @group Models
 */
export type AdminBlock = {
    readonly [key: string]: unknown;
};

/**
 * Every key that belongs inside a collection's `admin` block, as data.
 *
 * The type that describes these fields is `AdminCollectionOptions` in
 * `@rebasepro/admin-types`, and it is erased at build time — but three runtime
 * consumers need the list, and two of them are core:
 *
 * - `serializeCollections`, to drop the block from the contract
 * - the ts-morph schema editor in `@rebasepro/server`, which rewrites collection
 *   files on disk from the admin panel and has to know where each key goes. A key
 *   missing from this list gets written to the *top level* of the file, where the
 *   backend ignores it and the panel never finds it again.
 * - the `collections-admin-block` codemod
 *
 * `@rebasepro/admin-types` re-exports this and asserts it names only real option
 * keys; the count is pinned by a test there.
 *
 * @group Models
 */
export const ADMIN_COLLECTION_KEYS = [
    "Actions",
    "additionalFields",
    "alwaysApplyDefaultValues",
    "components",
    "defaultEntityAction",
    "defaultFilter",
    "defaultSelectedView",
    "defaultSize",
    "defaultViewMode",
    "disableDefaultActions",
    "enabledViews",
    "entityActions",
    "entityViews",
    "exportable",
    "filterPresets",
    "fixedFilter",
    "formAutoSave",
    "formView",
    "group",
    "hideFromNavigation",
    "hideIdFromCollection",
    "hideIdFromForm",
    "icon",
    "includeJsonView",
    "inlineEditing",
    "kanban",
    "listProperties",
    "localChangesBackup",
    "openEntityMode",
    "orderProperty",
    "pagination",
    "previewProperties",
    "propertiesOrder",
    "selectionController",
    "selectionEnabled",
    "sideDialogWidth",
    "sort",
    "titleProperty"
] as const;

/** A key of a collection's `admin` block. @group Models */
export type AdminCollectionKey = typeof ADMIN_COLLECTION_KEYS[number];

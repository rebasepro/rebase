/**
 * The keys of a collection's admin block, as data.
 *
 * There is no *type* for the block in this package any more, and that is the point:
 * `admin` is not declared on `BaseCollectionConfig` or on any property here, so a
 * BaaS install cannot even write one. `@rebasepro/admin-types` adds the field back by
 * declaration merging, which is why installing it is what makes the admin surface
 * appear.
 *
 * The *list* still has to live here, because three runtime consumers need it and two
 * of them are core — see below.
 */

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

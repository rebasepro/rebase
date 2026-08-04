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
    "display",
    "enabledViews",
    "entityActions",
    "entityViews",
    "exportable",
    "filterPresets",
    "fixedFilter",
    "form",
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

/**
 * Every key that belongs inside a *property's* `admin` block, as data.
 *
 * The union of `AdminPropertyOptions` and its per-type extensions
 * (`AdminStringOptions`, `AdminArrayOptions`, …) in `@rebasepro/admin-types`.
 * It lives here for the same reason {@link ADMIN_COLLECTION_KEYS} does: the
 * runtime consumers are core packages that the BaaS guard forbids from
 * importing `@rebasepro/admin-types`. Here it is the boot-time collection
 * validator in `@rebasepro/server`, which has to tell "you left `readOnly` at
 * the top of the property, where nothing reads it" apart from "you invented a
 * key we have never heard of".
 *
 * `@rebasepro/admin-types` re-exports this and asserts it names only real
 * option keys.
 *
 * @group Models
 */
export const ADMIN_PROPERTY_KEYS = [
    "canAddElements",
    "clearable",
    "columnWidth",
    "customProps",
    "disabled",
    "expanded",
    "Field",
    "Filter",
    "filterOperators",
    "fixedFilter",
    "hideFromCollection",
    "includeEntityLink",
    "includeId",
    "markdown",
    "minimalistView",
    "multiline",
    "Preview",
    "previewAsTag",
    "previewProperties",
    "readOnly",
    "sortable",
    "span",
    "spreadChildren",
    "urlPreview",
    "widget",
] as const;

/** A key of a property's `admin` block. @group Models */
export type AdminPropertyKey = typeof ADMIN_PROPERTY_KEYS[number];

/**
 * The pre-0.31 `admin` blocks, frozen at 0.30 — part of the migration's input
 * format (see `./index.ts`). Nothing at runtime may import it.
 *
 * At 0.30 `@rebasepro/cms-types` declared `admin` on the collection and on
 * every property by declaration merging, with option types that name React.
 * The migration never interprets a value in these blocks: the lift reports the
 * block as presentation (a `ui` note) and the codemod moves its source text,
 * verbatim, into `customizeTable`. So the keys are the exact set the panel
 * read (`ADMIN_COLLECTION_KEYS` / `ADMIN_PROPERTY_KEYS` at 0.30) and each value
 * is `unknown` — a misspelled key is still an error, and no CMS type is pulled
 * into the migration module.
 */

/**
 * Every key of a collection's `admin` block at 0.30.
 *
 * @group Migration
 */
export const LEGACY_ADMIN_COLLECTION_KEYS = [
    "Actions",
    "additionalFields",
    "alwaysApplyDefaultValues",
    "browserCallbacks",
    "components",
    "customViews",
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
    "hideFromEntityViews",
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
    "sort"
] as const;

/**
 * A key of a collection's `admin` block.
 *
 * @group Migration
 */
export type LegacyAdminCollectionKey = typeof LEGACY_ADMIN_COLLECTION_KEYS[number];

/**
 * Every key of a property's `admin` block at 0.30.
 *
 * @group Migration
 */
export const LEGACY_ADMIN_PROPERTY_KEYS = [
    "canAddElements",
    "clearable",
    "columnWidth",
    "customProps",
    "disabled",
    "expanded",
    "Field",
    "filledByServer",
    "Filter",
    "filterOperators",
    "fixedFilter",
    "format",
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
    "renderInForm",
    "sortable",
    "span",
    "spreadChildren",
    "urlPreview",
    "widget"
] as const;

/**
 * A key of a property's `admin` block.
 *
 * @group Migration
 */
export type LegacyAdminPropertyKey = typeof LEGACY_ADMIN_PROPERTY_KEYS[number];

/**
 * A collection's `admin` block: the panel's options, carried as source by the codemod.
 *
 * @group Migration
 */
export type LegacyAdminCollectionOptions = { [K in LegacyAdminCollectionKey]?: unknown };

/**
 * A property's `admin` block: the panel's options, carried as source by the codemod.
 *
 * @group Migration
 */
export type LegacyAdminPropertyOptions = { [K in LegacyAdminPropertyKey]?: unknown };

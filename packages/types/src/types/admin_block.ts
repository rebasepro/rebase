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

/**
 * Move flattened admin keys back down into the `admin` block.
 *
 * The admin panel works with a *flat* view model — the block merged onto the
 * collection — so what comes back from a form has `icon` and `defaultViewMode`
 * at the top level while `admin` still holds whatever the file was loaded with.
 * This is the way back.
 *
 * **The top-level value wins.** It is the one the form just wrote; the block is
 * the copy the collection was loaded with, and preferring it resolves every edit
 * in favour of the value the user changed away from.
 *
 * This lives here, next to the key lists, because it had two implementations —
 * `toAdminCollectionConfig` in `@rebasepro/admin-types` and `nestAdminKeys` in
 * `@rebasepro/server`'s schema editor — that agreed on everything except that
 * precedence, which is the only part that decides whether a save is visible.
 *
 * @group Models
 */
export function nestAdminKeysOf(
    source: Record<string, unknown>,
    adminKeys: readonly string[]
): Record<string, unknown> {
    const keys = new Set<string>(adminKeys);
    const top: Record<string, unknown> = {};
    const block: Record<string, unknown> = { ...((source.admin as Record<string, unknown> | undefined) ?? {}) };

    for (const [key, value] of Object.entries(source)) {
        if (key === "admin") continue;
        if (keys.has(key)) block[key] = value;
        else top[key] = value;
    }

    if (Object.keys(block).length > 0) top.admin = block;
    return top;
}

/**
 * {@link nestAdminKeysOf} for a collection.
 *
 * @group Models
 */
export function nestAdminCollectionKeys(collection: Record<string, unknown>): Record<string, unknown> {
    return nestAdminKeysOf(collection, ADMIN_COLLECTION_KEYS);
}

/**
 * {@link nestAdminKeysOf} for a property, applied to its children too.
 *
 * A map property carries `properties`, an array property carries `of`, and both
 * hold properties with `admin` blocks of their own. A flat `readOnly` left on a
 * child is as dead — and as fatal at the next boot — as one left on the parent,
 * so the walk goes all the way down.
 *
 * @group Models
 */
export function nestAdminPropertyKeys(property: Record<string, unknown>): Record<string, unknown> {
    const nested = nestAdminKeysOf(property, ADMIN_PROPERTY_KEYS);

    const children = nested.properties;
    if (children && typeof children === "object" && !Array.isArray(children)) {
        nested.properties = Object.fromEntries(
            Object.entries(children as Record<string, unknown>).map(([key, child]) => [
                key,
                child && typeof child === "object" && !Array.isArray(child)
                    ? nestAdminPropertyKeys(child as Record<string, unknown>)
                    : child
            ])
        );
    }

    const of = nested.of;
    if (Array.isArray(of)) {
        nested.of = of.map(entry => entry && typeof entry === "object" && !Array.isArray(entry)
            ? nestAdminPropertyKeys(entry as Record<string, unknown>)
            : entry);
    } else if (of && typeof of === "object") {
        nested.of = nestAdminPropertyKeys(of as Record<string, unknown>);
    }

    return nested;
}

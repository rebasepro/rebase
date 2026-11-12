/**
 * The keys of a collection's and a property's admin block, as data, and the way
 * back from the panel's flat view model to the block.
 *
 * The types that describe these fields are `AdminCollectionOptions` and the
 * `Admin*Options` property types in this package; `admin_collection.ts` and
 * `types/property_options.ts` hold both lists to them in both directions, so a
 * key cannot be added to one side and forgotten on the other. Nothing on the
 * backend reads the admin block any more, which is why the lists live here and
 * not in `@rebasepro/types`.
 */

/**
 * Every key that belongs inside a collection's `admin` block, as data.
 *
 * Read by the collection editor (which writes edited collections back with the
 * block nested), by `nestAdminCollectionKeys` below, and by the repository's
 * `collections-admin-block` / `docs-admin-block` codemods, which read this file.
 *
 * @group Models
 */
export const ADMIN_COLLECTION_KEYS = [
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

/** A key of a collection's `admin` block. @group Models */
export type AdminCollectionKey = typeof ADMIN_COLLECTION_KEYS[number];

/**
 * Every key that belongs inside a *property's* `admin` block, as data: the union
 * of `AdminPropertyOptions` and its per-type extensions (`AdminStringOptions`,
 * `AdminArrayOptions`, …).
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
 * It lives next to the key lists so there is one implementation of that
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

/** A record of properties, keyed by name — a map's `properties`, or a `oneOf` block's. */
function nestEachProperty(properties: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(properties).map(([key, child]) => [
            key,
            isNestable(child) ? nestAdminPropertyKeys(child) : child
        ])
    );
}

/** Anything the walk can descend into: a plain object, not an array. */
function isNestable(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * {@link nestAdminKeysOf} for a property, applied to its children too.
 *
 * A map property carries `properties`, an array property carries `of`, and an
 * array of typed blocks carries `oneOf.properties` — a record of properties like
 * a map's. All of them hold properties with `admin` blocks of their own. A flat
 * `readOnly` left on a child is as dead — and as fatal at the next boot — as one
 * left on the parent, so the walk goes all the way down.
 *
 * `oneOf` was the container this walk did not know about, and it is the one the
 * block-based collection templates are built out of: every block inside them
 * kept its flat `markdown`, and the collection they created would not boot.
 *
 * @group Models
 */
export function nestAdminPropertyKeys(property: Record<string, unknown>): Record<string, unknown> {
    const nested = nestAdminKeysOf(property, ADMIN_PROPERTY_KEYS);

    const children = nested.properties;
    if (isNestable(children)) {
        nested.properties = nestEachProperty(children);
    }

    // `oneOf` is not itself a property — it is a block holding `properties`
    // alongside `typeField`, `valueField` and `propertiesOrder`, none of which
    // may be walked as one.
    const oneOf = nested.oneOf;
    if (isNestable(oneOf) && isNestable(oneOf.properties)) {
        nested.oneOf = { ...oneOf, properties: nestEachProperty(oneOf.properties) };
    }

    const of = nested.of;
    if (Array.isArray(of)) {
        nested.of = of.map(entry => isNestable(entry) ? nestAdminPropertyKeys(entry) : entry);
    } else if (isNestable(of)) {
        nested.of = nestAdminPropertyKeys(of);
    }

    return nested;
}

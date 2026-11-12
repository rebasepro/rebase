/**
 * The signed-in user's preferences as an overlay on a resolved collection —
 * the last layer of the composition (see `compose_collections.ts`).
 *
 * The registry resolves a collection synchronously, for any collection the
 * panel holds — a served table or an external (Firestore) one — and merges
 * this overlay into it. It is the views' own vocabulary translated back: a
 * user's preferences are what the views write (column widths, order, view
 * mode, the board's column, size) in `customizeTable`'s names, and this maps
 * each to the key of the panel's view model it came from. Kept apart from the
 * customization merge, which the eager bundle does not carry.
 */
import type { UiFieldPreferences, UiTablePreferences } from "@rebasepro/types";

/** Table keys whose view-model key has the same name. */
const SAME_NAME = [
    "name", "singularName", "icon", "group", "hideFromNavigation", "hideFromEntityViews", "defaultViewMode", "enabledViews",
    "defaultSize", "hideIdFromCollection", "pagination", "inlineEditing", "selectionEnabled", "exportable", "openEntityMode",
    "defaultEntityAction", "sideDialogWidth", "defaultSelectedView", "formAutoSave", "alwaysApplyDefaultValues",
    "includeJsonView", "localChangesBackup", "hideIdFromForm", "disableDefaultActions", "sort", "defaultFilter"
] as const satisfies readonly (keyof UiTablePreferences)[];

/** Field keys that are `admin.*` options of the property under the same name. */
const ADMIN_SAME_NAME = [
    "readOnly", "columnWidth", "span", "multiline", "markdown", "previewAsTag", "clearable", "urlPreview", "expanded",
    "minimalistView", "sortable", "canAddElements", "spreadChildren", "widget", "includeId", "includeEntityLink"
] as const satisfies readonly (keyof UiFieldPreferences)[];

function fieldOverlay(field: UiFieldPreferences): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const admin: Record<string, unknown> = {};
    if (field.name !== undefined) out.name = field.name;
    if (field.mode !== undefined) out.mode = field.mode;
    if (field.timezone !== undefined) out.timezone = field.timezone;
    if (field.keyValue !== undefined) out.keyValue = field.keyValue;
    if (field.fieldOrder !== undefined) out.propertiesOrder = [...field.fieldOrder];
    for (const key of ADMIN_SAME_NAME) if (field[key] !== undefined) admin[key] = field[key];
    if (field.hidden !== undefined) admin.hideFromCollection = field.hidden;
    if (field.disabled !== undefined) admin.disabled = field.disabled;
    if (field.hiddenInForm !== undefined) admin.disabled = { hidden: field.hiddenInForm };
    if (field.previewFields !== undefined) admin.previewProperties = [...field.previewFields];
    if (Object.keys(admin).length > 0) out.admin = admin;
    if (field.fields) {
        const properties: Record<string, unknown> = {};
        for (const [key, nested] of Object.entries(field.fields)) properties[key] = fieldOverlay(nested);
        out.properties = properties;
    }
    if (field.of) out.of = fieldOverlay(field.of);
    return out;
}

/**
 * A user's preferences for one collection as the partial view model the
 * registry merges into it. Enum labels and registered views are workspace
 * matters and not part of a user's layer. A field the collection does not have
 * (`fields`, the collection's property keys) is left out: merged, it would be a
 * property with no type.
 */
export function userPreferencesOverlay(preferences: UiTablePreferences | undefined, fields: ReadonlySet<string>): Record<string, unknown> {
    if (!preferences) return {};
    const out: Record<string, unknown> = {};
    for (const key of SAME_NAME) if (preferences[key] !== undefined) out[key] = preferences[key];
    if (preferences.fieldOrder !== undefined) out.propertiesOrder = [...preferences.fieldOrder];
    if (preferences.listFields !== undefined) out.listProperties = [...preferences.listFields];
    if (preferences.previewFields !== undefined) out.previewProperties = [...preferences.previewFields];
    if (preferences.kanban) {
        out.kanban = { columnProperty: preferences.kanban.columnField };
        if (preferences.kanban.orderField !== undefined) out.orderProperty = preferences.kanban.orderField;
    }
    if (preferences.display) out.display = { ...preferences.display };
    if (preferences.fields) {
        const properties: Record<string, unknown> = {};
        for (const [key, field] of Object.entries(preferences.fields)) {
            if (fields.has(key)) properties[key] = fieldOverlay(field);
        }
        if (Object.keys(properties).length > 0) out.properties = properties;
    }
    return out;
}

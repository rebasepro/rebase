/**
 * Where each legacy presentation key goes in `customizeTable`.
 *
 * A migration tool legitimately freezes legacy knowledge, so the table lives
 * here — written out in full, one entry per legacy key, as plain data. It is
 * guarded against the real surface by `tooling/scripts/test/codemod-vocabulary.test.mjs`
 * (`pnpm test:gates`): every destination must be a key `customizeTable`
 * accepts (`TABLE_CUSTOMIZATION_KEYS` / `FIELD_CUSTOMIZATION_KEYS` in
 * `@rebasepro/cms-types`), every renamed key must agree with the hint
 * `customizeTable` refuses the old name with, and every legacy `admin` key
 * (`ADMIN_COLLECTION_KEYS` / `ADMIN_PROPERTY_KEYS` in `@rebasepro/types`) must
 * have an entry here — a destination, or an explicit `dropped` with why.
 *
 * A destination is a key of the customization (`"fieldOrder"`) or a path into
 * one (`"kanban.orderField"`). Keep the literals plain: the gate test reads
 * this file as source.
 */

/** Where a legacy key goes: a customization key or path, or why it has none. */
export type Destination = string | { dropped: string };

/** A collection's `admin` keys → `customizeTable` options. */
export const COLLECTION_ADMIN_DESTINATIONS: Readonly<Record<string, Destination>> = {
    Actions: "Actions",
    additionalFields: "additionalFields",
    alwaysApplyDefaultValues: "alwaysApplyDefaultValues",
    browserCallbacks: "browserCallbacks",
    components: "components",
    customViews: "customViews",
    defaultEntityAction: "defaultEntityAction",
    defaultFilter: "defaultFilter",
    defaultSelectedView: "defaultSelectedView",
    defaultSize: "defaultSize",
    defaultViewMode: "defaultViewMode",
    disableDefaultActions: "disableDefaultActions",
    display: "display",
    enabledViews: "enabledViews",
    entityActions: "entityActions",
    entityViews: "entityViews",
    exportable: "exportable",
    filterPresets: "filterPresets",
    fixedFilter: "fixedFilter",
    form: "form",
    formAutoSave: "formAutoSave",
    formView: "formView",
    group: "group",
    hideFromEntityViews: "hideFromEntityViews",
    hideFromNavigation: "hideFromNavigation",
    hideIdFromCollection: "hideIdFromCollection",
    hideIdFromForm: "hideIdFromForm",
    icon: "icon",
    includeJsonView: "includeJsonView",
    inlineEditing: "inlineEditing",
    kanban: "kanban",
    listProperties: "listFields",
    localChangesBackup: "localChangesBackup",
    openEntityMode: "openEntityMode",
    orderProperty: "kanban.orderField",
    pagination: "pagination",
    previewProperties: "previewFields",
    propertiesOrder: "fieldOrder",
    selectionController: "selectionController",
    selectionEnabled: "selectionEnabled",
    sideDialogWidth: "sideDialogWidth",
    sort: "sort"
};

/** Keys inside a collection's `admin.kanban` → keys of `customizeTable`'s `kanban`. */
export const KANBAN_DESTINATIONS: Readonly<Record<string, string>> = {
    columnProperty: "columnField",
    orderProperty: "orderField"
};

/** A property's `admin` keys → field-customization options. `disabled: { hidden: true }` also becomes `hiddenInForm`. */
export const PROPERTY_ADMIN_DESTINATIONS: Readonly<Record<string, Destination>> = {
    canAddElements: "canAddElements",
    clearable: "clearable",
    columnWidth: "columnWidth",
    customProps: "customProps",
    disabled: "disabled",
    expanded: "expanded",
    Field: "Field",
    filledByServer: "filledByServer",
    Filter: "Filter",
    filterOperators: "filterOperators",
    fixedFilter: "fixedFilter",
    format: "format",
    hideFromCollection: "hidden",
    includeEntityLink: "includeEntityLink",
    includeId: "includeId",
    markdown: "markdown",
    minimalistView: "minimalistView",
    multiline: "multiline",
    Preview: "Preview",
    previewAsTag: "previewAsTag",
    previewProperties: "previewFields",
    readOnly: "readOnly",
    renderInForm: "renderInForm",
    sortable: "sortable",
    span: "span",
    spreadChildren: "spreadChildren",
    urlPreview: "urlPreview",
    widget: "widget"
};

/** Presentation fields of a collection outside its `admin` block (what the lift reports as not carried). */
export const COLLECTION_FIELD_DESTINATIONS: Readonly<Record<string, Destination>> = {
    name: "name",
    singularName: "singularName",
    icon: "icon",
    "auth.actions.resetPassword": "resetPasswordAction",
    admin: { dropped: "not a destination itself: each of its keys is routed by COLLECTION_ADMIN_DESTINATIONS." },
    childCollections: { dropped: "customizeTable has no child collections: a table's hasMany / manyToMany relations are its record tabs (reported as a manual step)." },
    ownerId: { dropped: "stamped by the collection editor; nothing on the request path or in the panel reads it." }
};

/** Presentation fields of a property outside its `admin` block. Labels equal to the derived one are dropped on the way. */
export const PROPERTY_FIELD_DESTINATIONS: Readonly<Record<string, Destination>> = {
    name: "name",
    description: "description",
    enum: "enumLabels",
    propertiesOrder: "fieldOrder",
    mode: "mode",
    timezone: "timezone",
    propertyConfig: "propertyConfig",
    conditions: "conditions",
    dynamicProps: "dynamicProps",
    metadata: "metadata",
    overrides: "overrides",
    "storage.processFile": "storage",
    "storage.postProcess": "storage",
    "storage.previewUrl": "storage",
    "storage.fileName": "storage",
    admin: { dropped: "not a destination itself: each of its keys is routed by PROPERTY_ADMIN_DESTINATIONS." },
    userSelect: { dropped: "carried by the lift as `.userId()` on the column; the CMS reads it from the descriptor." },
    defaultValue: "defaultValue",
    validation: { dropped: "a relation's `requiredMessage` / `uniqueInArray` are panel messages customizeTable has no option for." },
    "oneOf.propertiesOrder": { dropped: "the order the panel offers block types in; customizeTable has no option for it." },
    isId: { dropped: "`\"manual\"` and `true` are the same key to the server; the difference had no other reader." },
    type: { dropped: "a reference inside a JSON array is a document value; there is nothing to customize." }
};

/**
 * Keys of a rule source renamed with the move to tables, by where they are
 * written: the argument of `policy.existsIn(…)` / a literal
 * `{ kind: "existsIn", … }` (`ExistsInPolicyExpression` in `@rebasepro/types`),
 * and a tenant's `membership: { … }` source (`TenantMembershipSource`). The
 * SDK-call pass (`sdk-calls.ts`, rule 11) applies them to the project's own
 * code; the gate test holds each new key to the type's members.
 */
export const RULE_KEY_RENAMES: Readonly<Record<"existsIn" | "membership", Readonly<Record<string, string>>>> = {
    existsIn: { collection: "table" },
    membership: { collection: "table" }
};

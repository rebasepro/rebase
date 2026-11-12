/**
 * Folds a `customizeTable(...)` result into the collection a table projects
 * to.
 *
 * The panel's views read one view model — a flat collection of `Property`s,
 * with the presentation keys (`propertiesOrder`, `kanban.columnProperty`,
 * `display`, a property's `admin.hideFromCollection` …) where they always
 * were. `customizeTable` speaks the spec's names (`fieldOrder`,
 * `kanban.columnField`, `fields.x.hidden` …); this module is the single place
 * that translates one into the other, so no view changes.
 *
 * A customization is written against the table as its author last saw it, and
 * the server may have redacted a column for this caller or the table may have
 * moved on since. Neither is an error at runtime: what does not match is
 * skipped, and said once, in development.
 */
import type {
    AdminArrayOptions,
    AdminCollectionOptions,
    AdminDateOptions,
    AdminMapOptions,
    AdminNumberOptions,
    AdminPostgresCollection,
    AdminPropertyOptions,
    AdminReferenceOptions,
    AdminRelationOptions,
    AdminStringOptions,
    AdminVectorOptions,
    AnyFieldCustomization,
    FormLayoutConfig,
    StorageCustomization,
    TableCustomization,
    TableCustomizationOptions,
    TableDisplay
} from "@rebasepro/cms-types";
import type {
    AnyCollectionConfig,
    ArrayProperty,
    EnumValueConfig,
    EnumValues,
    MapProperty,
    Properties,
    Property,
    PropertyBuilderProps,
    ReferenceProperty,
    Relation,
    StorageConfig
} from "@rebasepro/types";

/**
 * A table's collection in the panel, after customization.
 *
 * The projected collection's own type, with one difference: its properties
 * may include a `reference` — what a `fields.x.referenceTo` column becomes —
 * which the legacy `PostgresProperties` does not admit, although the planner,
 * the row codec and every view already handle one on a Postgres table.
 *
 * @group Tables
 */
export type TableCollection = Omit<AdminPostgresCollection, "properties"> & { properties: Properties };

// ── Development warnings ─────────────────────────────────────────────────────

const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
    if (process.env.NODE_ENV === "production" || warned.has(key)) return;
    warned.add(key);
    console.warn(`[rebase] ${message}`);
}

/** Forget which warnings were shown. For tests. */
export function resetCustomizationWarnings(): void {
    warned.clear();
}

// ── Small helpers ────────────────────────────────────────────────────────────

/** `target[key] = value`, unless `value` is `undefined`. */
function set<T, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
    if (value !== undefined) target[key] = value;
}

/** What the collection's field names resolve against. */
interface Known {
    slug: string;
    properties: ReadonlySet<string>;
    relations: ReadonlySet<string>;
    additional: ReadonlySet<string>;
}

function knownOf(collection: TableCollection, customization: TableCustomizationOptions): Known {
    const relations = new Set<string>();
    for (const relation of collection.relations ?? []) {
        if (relation.relationName) relations.add(relation.relationName);
    }
    for (const [key, property] of Object.entries(collection.properties)) {
        if (property.type === "relation") relations.add(property.relation?.relationName ?? key);
    }
    const additional = new Set<string>([
        ...(collection.additionalFields ?? []).map(field => field.key),
        ...(customization.additionalFields ?? []).map(field => field.key)
    ]);
    return { slug: collection.slug, properties: new Set(Object.keys(collection.properties)), relations, additional };
}

/** Whether an entry of a column list names something the collection has. */
function isKnownColumn(id: string, known: Known): boolean {
    if (id.startsWith("subcollection:")) return known.relations.has(id.slice("subcollection:".length));
    if (known.additional.has(id)) return true;
    const root = id.split(".")[0];
    return known.properties.has(root) || known.relations.has(root);
}

/** A column list without the entries the collection does not have, each dropped with a warning. */
function knownColumns<Id extends string>(ids: readonly Id[] | undefined, known: Known | undefined, where: string): Id[] | undefined {
    if (ids === undefined) return undefined;
    if (!known) return [...ids];
    return ids.filter(id => {
        if (isKnownColumn(id, known)) return true;
        warnOnce(`${where}:${id}`, `${where} names "${id}", which the "${known.slug}" table does not serve to this user. Skipped.`);
        return false;
    });
}

// ── Collection level ─────────────────────────────────────────────────────────

function displayOf(display: TableDisplay | undefined, known: Known | undefined, where: string): AdminCollectionOptions["display"] {
    if (display === undefined) return undefined;
    const out: NonNullable<AdminCollectionOptions["display"]> = {};
    for (const slot of ["title", "subtitle", "image", "status", "date", "tags"] as const) {
        const source = display[slot];
        if (source === undefined) continue;
        if (typeof source === "string" && known && !isKnownColumn(source, known)) {
            warnOnce(`${where}.display.${slot}`, `${where} display.${slot} names "${source}", which the "${known.slug}" table does not serve to this user. Skipped.`);
            continue;
        }
        if (slot === "date") set(out, "date", display.date);
        else if (slot === "tags") set(out, "tags", display.tags);
        else set(out, slot, display[slot]);
    }
    return out;
}

function formOf(form: TableCustomizationOptions["form"], known: Known | undefined, where: string): FormLayoutConfig | undefined {
    if (form === undefined) return undefined;
    const out: FormLayoutConfig = {};
    set(out, "sidebar", knownColumns(form.sidebar, known, `${where} form.sidebar`));
    set(out, "showRecordMeta", form.showRecordMeta);
    if (form.sections) {
        out.sections = form.sections.map(section => {
            const properties = knownColumns(section.fields, known, `${where} form.sections["${section.key}"]`) ?? [];
            return {
                key: section.key,
                properties,
                ...(section.title !== undefined ? { title: section.title } : {}),
                ...(section.collapsed !== undefined ? { collapsed: section.collapsed } : {}),
                ...(section.collapsible !== undefined ? { collapsible: section.collapsible } : {}),
                ...(section.readVariant !== undefined ? { readVariant: section.readVariant } : {})
            };
        });
    }
    return out;
}

/**
 * The panel's collection-level presentation keys for a customization. `known`
 * is the collection the names resolve against; without it (a relation's tab
 * overrides) nothing is filtered.
 */
function presentationOf(customization: TableCustomizationOptions, known: Known | undefined, where: string): AdminCollectionOptions {
    const c = customization;
    const admin: AdminCollectionOptions = {};
    let orderProperty: string | undefined;

    set(admin, "icon", c.icon);
    set(admin, "group", c.group);
    set(admin, "hideFromNavigation", c.hideFromNavigation);
    set(admin, "hideFromEntityViews", c.hideFromEntityViews);

    set(admin, "defaultViewMode", c.defaultViewMode);
    set(admin, "enabledViews", c.enabledViews ? [...c.enabledViews] : undefined);
    set(admin, "customViews", c.customViews ? [...c.customViews] : undefined);
    set(admin, "defaultSize", c.defaultSize);
    if (c.kanban) {
        const { columnField, orderField } = c.kanban;
        if (known && !known.properties.has(columnField)) {
            warnOnce(`${where}.kanban`, `${where} kanban.columnField names "${columnField}", which the "${known.slug}" table does not serve to this user. The board is left as projected.`);
        } else {
            admin.kanban = { columnProperty: columnField };
        }
        if (orderField !== undefined) {
            if (known && !known.properties.has(orderField)) {
                warnOnce(`${where}.kanban.orderField`, `${where} kanban.orderField names "${orderField}", which the "${known.slug}" table does not serve to this user. Skipped.`);
            } else {
                orderProperty = orderField;
            }
        }
    }

    set(admin, "propertiesOrder", knownColumns(c.fieldOrder, known, `${where} fieldOrder`));
    set(admin, "listProperties", knownColumns(c.listFields, known, `${where} listFields`));
    set(admin, "previewProperties", knownColumns(c.previewFields, known, `${where} previewFields`));
    set(admin, "hideIdFromCollection", c.hideIdFromCollection);
    set(admin, "pagination", c.pagination);

    set(admin, "inlineEditing", c.inlineEditing);
    set(admin, "selectionEnabled", c.selectionEnabled);
    set(admin, "selectionController", c.selectionController);
    set(admin, "exportable", c.exportable);
    set(admin, "openEntityMode", c.openEntityMode);
    set(admin, "defaultEntityAction", c.defaultEntityAction);
    set(admin, "sideDialogWidth", c.sideDialogWidth);
    set(admin, "defaultSelectedView", c.defaultSelectedView);

    set(admin, "form", formOf(c.form, known, where));
    set(admin, "formView", c.formView ? { ...c.formView } : undefined);
    set(admin, "formAutoSave", c.formAutoSave);
    set(admin, "alwaysApplyDefaultValues", c.alwaysApplyDefaultValues);
    set(admin, "includeJsonView", c.includeJsonView);
    set(admin, "localChangesBackup", c.localChangesBackup);
    set(admin, "hideIdFromForm", c.hideIdFromForm);

    set(admin, "entityActions", c.entityActions ? [...c.entityActions] : undefined);
    set(admin, "disableDefaultActions", c.disableDefaultActions ? [...c.disableDefaultActions] : undefined);
    set(admin, "entityViews", c.entityViews ? [...c.entityViews] : undefined);
    set(admin, "Actions", c.Actions ? [...c.Actions] : undefined);
    set(admin, "components", c.components ? { ...c.components } : undefined);
    set(admin, "browserCallbacks", c.browserCallbacks);

    // The block's read-only keys, written once.
    const display = displayOf(c.display, known, where);
    return {
        ...admin,
        ...(orderProperty !== undefined ? { orderProperty } : {}),
        ...(display !== undefined ? { display } : {}),
        ...(c.additionalFields !== undefined ? { additionalFields: [...c.additionalFields] } : {}),
        ...(c.sort !== undefined ? { sort: c.sort } : {}),
        ...(c.fixedFilter !== undefined ? { fixedFilter: c.fixedFilter } : {}),
        ...(c.defaultFilter !== undefined ? { defaultFilter: c.defaultFilter } : {}),
        ...(c.filterPresets !== undefined ? { filterPresets: [...c.filterPresets] } : {})
    };
}

/** A relation's tab overrides, as the `Partial<CollectionConfig>` the relation carries. */
function overridesOf(overrides: Omit<TableCustomizationOptions, "fields">, where: string): Partial<AnyCollectionConfig> {
    const out: Partial<AnyCollectionConfig> = { admin: presentationOf(overrides, undefined, where) };
    set(out, "name", overrides.name);
    set(out, "singularName", overrides.singularName);
    set(out, "description", overrides.description);
    set(out, "metadata", overrides.metadata);
    return out;
}

// ── Field level ──────────────────────────────────────────────────────────────

/** The options every field takes, each with the key the view model reads. */
const COMMON_FIELD_KEYS: ReadonlySet<string> = new Set([
    "name", "description", "hidden", "hiddenInForm", "disabled", "readOnly", "Field", "Preview", "Filter",
    "columnWidth", "filledByServer", "span", "customProps", "filterOperators", "propertyConfig", "conditions",
    "dynamicProps", "metadata", "referenceTo"
]);

/** The further options each kind of view-model property takes. */
const FIELD_KEYS_BY_TYPE: Readonly<Record<Property["type"], readonly string[]>> = {
    string: ["multiline", "markdown", "previewAsTag", "clearable", "urlPreview", "enumLabels", "enumOrder", "storage"],
    number: ["clearable", "format", "enumLabels", "enumOrder"],
    boolean: [],
    date: ["clearable", "mode", "timezone"],
    geopoint: [],
    reference: ["previewFields", "fixedFilter", "includeId", "includeEntityLink"],
    relation: ["previewFields", "widget", "fixedFilter", "includeId", "includeEntityLink", "renderInForm", "overrides"],
    array: ["expanded", "minimalistView", "sortable", "canAddElements", "of", "oneOf", "enumLabels", "enumOrder", "storage"],
    map: ["expanded", "minimalistView", "spreadChildren", "previewFields", "keyValue", "fields", "fieldOrder"],
    vector: ["clearable"],
    binary: []
};

function warnInapplicable(property: Property, field: AnyFieldCustomization, where: string): void {
    const applicable = new Set(FIELD_KEYS_BY_TYPE[property.type]);
    for (const [key, value] of Object.entries(field)) {
        if (value === undefined || COMMON_FIELD_KEYS.has(key) || applicable.has(key)) continue;
        warnOnce(`${where}.${key}`, `${where}.${key} does not apply to a ${property.type} field. Skipped.`);
    }
}

/** The options of the base `admin` block, over what the property already says. */
function commonAdmin(existing: AdminPropertyOptions | undefined, field: AnyFieldCustomization): AdminPropertyOptions {
    const admin: AdminPropertyOptions = { ...existing };
    set(admin, "hideFromCollection", field.hidden);
    set(admin, "disabled", field.disabled);
    if (field.hiddenInForm !== undefined) {
        const disabled = admin.disabled;
        const config = typeof disabled === "object" ? disabled : {};
        if (field.hiddenInForm) admin.disabled = { ...config, hidden: true };
        else if (typeof disabled === "object") admin.disabled = { ...config, hidden: false };
    }
    set(admin, "readOnly", field.readOnly);
    set(admin, "Field", field.Field);
    set(admin, "Preview", field.Preview);
    set(admin, "Filter", field.Filter);
    set(admin, "columnWidth", field.columnWidth);
    set(admin, "filledByServer", field.filledByServer);
    set(admin, "span", field.span);
    set(admin, "customProps", field.customProps);
    set(admin, "filterOperators", field.filterOperators);
    return admin;
}

/** A property's enum values as a list, whichever form they were written in. */
function enumList(values: EnumValues): EnumValueConfig[] {
    if (Array.isArray(values)) return values.map(value => ({ ...value }));
    return Object.entries(values).map(([id, value]) => typeof value === "string" ? { id, label: value } : { ...value, id });
}

/**
 * The enum values with the labels, colours and order the customization gives,
 * over the projected ones. A value it does not mention keeps its projected
 * label and colour, which is what keeps colours deterministic.
 */
function mergeEnum(values: EnumValues | undefined, field: AnyFieldCustomization, where: string): EnumValueConfig[] | undefined {
    const { enumLabels, enumOrder } = field;
    if (enumLabels === undefined && enumOrder === undefined) return undefined;
    if (values === undefined) {
        warnOnce(`${where}.enumLabels`, `${where} labels enum values, but the field has no closed set of values. Skipped.`);
        return undefined;
    }
    const list = enumList(values);
    const byValue = new Map(list.map(value => [String(value.id), value]));
    for (const [value, label] of Object.entries(enumLabels ?? {})) {
        if (label === undefined) continue;
        const entry = byValue.get(value);
        if (!entry) {
            warnOnce(`${where}.enumLabels.${value}`, `${where}.enumLabels names "${value}", which is not one of the column's values. Skipped.`);
            continue;
        }
        if (typeof label === "string") {
            entry.label = label;
        } else {
            entry.label = label.label;
            set(entry, "color", label.color);
            set(entry, "disabled", label.disabled);
        }
    }
    if (enumOrder === undefined) return list;
    const ordered: EnumValueConfig[] = [];
    for (const value of enumOrder) {
        const entry = byValue.get(String(value));
        if (!entry) {
            warnOnce(`${where}.enumOrder.${value}`, `${where}.enumOrder names "${value}", which is not one of the column's values. Skipped.`);
            continue;
        }
        if (!ordered.includes(entry)) ordered.push(entry);
    }
    return [...ordered, ...list.filter(entry => !ordered.includes(entry))];
}

/** The browser-only storage functions over the column's storage rules. */
function mergeStorage(storage: StorageConfig | undefined, overlay: StorageCustomization | undefined, where: string): StorageConfig | undefined {
    if (overlay === undefined) return storage;
    if (storage === undefined) {
        warnOnce(`${where}.storage`, `${where}.storage customizes uploads, but the column is not a \`col.storage()\` column. Skipped.`);
        return undefined;
    }
    const out: StorageConfig = { ...storage };
    if (overlay.path) out.storagePath = overlay.path;
    set(out, "fileName", overlay.fileName);
    set(out, "processFile", overlay.processFile);
    set(out, "postProcess", overlay.postProcess);
    set(out, "previewUrl", overlay.previewUrl);
    return out;
}

/** A text column holding another collection's key, as the reference the panel picks and previews. */
function asReference(property: Property, slug: string, where: string): Property {
    if (property.type !== "string") {
        warnOnce(`${where}.referenceTo`, `${where}.referenceTo decorates a text or uuid column; this one is ${property.type}. Skipped.`);
        return property;
    }
    const reference: ReferenceProperty = { type: "reference", path: slug };
    set(reference, "name", property.name);
    set(reference, "description", property.description);
    set(reference, "columnName", property.columnName);
    set(reference, "validation", property.validation);
    set(reference, "access", property.access);
    set(reference, "excludeFromApi", property.excludeFromApi);
    if (property.admin) reference.admin = commonAdmin(property.admin, {});
    return reference;
}

/** Each key of a map, customized. */
function applyNested(properties: Properties | undefined, fields: AnyFieldCustomization["fields"], where: string): Properties | undefined {
    if (fields === undefined) return properties;
    if (properties === undefined) {
        warnOnce(`${where}.fields`, `${where}.fields customizes the keys of a document whose shape the column does not state. Skipped.`);
        return undefined;
    }
    const out: Properties = { ...properties };
    for (const [key, field] of Object.entries(fields)) {
        if (field === undefined) continue;
        const property = properties[key];
        if (!property) {
            warnOnce(`${where}.fields.${key}`, `${where}.fields names "${key}", which the document does not have. Skipped.`);
            continue;
        }
        out[key] = applyField(property, field, `${where}.fields.${key}`);
    }
    return out;
}

function applyArray(property: ArrayProperty, field: AnyFieldCustomization, where: string): ArrayProperty {
    const admin: AdminArrayOptions = commonAdmin(property.admin, field);
    set(admin, "expanded", field.expanded);
    set(admin, "minimalistView", field.minimalistView);
    set(admin, "sortable", field.sortable);
    set(admin, "canAddElements", field.canAddElements);
    const out: ArrayProperty = { ...property, admin };

    const item = property.of;
    const itemField: AnyFieldCustomization = { ...field.of };
    // Labels, order and upload functions given on the array apply to its items.
    set(itemField, "enumLabels", field.enumLabels);
    set(itemField, "enumOrder", field.enumOrder);
    set(itemField, "storage", field.storage);
    if (Object.values(itemField).some(value => value !== undefined)) {
        if (item === undefined || Array.isArray(item)) {
            warnOnce(`${where}.of`, `${where} customizes the array's items, but the column does not state one item type. Skipped.`);
        } else {
            out.of = applyField(item, itemField, `${where}.of`);
        }
    }

    if (field.oneOf !== undefined) {
        if (!property.oneOf) {
            warnOnce(`${where}.oneOf`, `${where}.oneOf customizes typed blocks, but the column is not a list of typed blocks. Skipped.`);
        } else {
            const properties = { ...property.oneOf.properties };
            for (const [variant, variantField] of Object.entries(field.oneOf)) {
                const variantProperty = properties[variant];
                if (!variantProperty) {
                    warnOnce(`${where}.oneOf.${variant}`, `${where}.oneOf names "${variant}", which is not one of the block's variants. Skipped.`);
                    continue;
                }
                properties[variant] = applyField(variantProperty, variantField, `${where}.oneOf.${variant}`);
            }
            out.oneOf = { ...property.oneOf, properties };
        }
    }
    return out;
}

function applyMap(property: MapProperty, field: AnyFieldCustomization, where: string): MapProperty {
    const admin: AdminMapOptions = commonAdmin(property.admin, field);
    set(admin, "expanded", field.expanded);
    set(admin, "minimalistView", field.minimalistView);
    set(admin, "spreadChildren", field.spreadChildren);
    set(admin, "previewProperties", field.previewFields ? [...field.previewFields] : undefined);
    const out: MapProperty = { ...property, admin };
    set(out, "keyValue", field.keyValue);
    set(out, "properties", applyNested(property.properties, field.fields, where));
    set(out, "propertiesOrder", field.fieldOrder ? [...field.fieldOrder] : undefined);
    return out;
}

/**
 * One field's customization over its view-model property.
 *
 * @param property the property the table projected
 * @param field the customization
 * @param where how messages name the field
 */
function applyField(property: Property, field: AnyFieldCustomization, where: string): Property {
    warnInapplicable(property, field, where);
    const base: Property = field.referenceTo !== undefined ? asReference(property, field.referenceTo, where) : { ...property };
    set(base, "name", field.name);
    set(base, "description", field.description);
    set(base, "propertyConfig", field.propertyConfig);
    set(base, "conditions", field.conditions);
    if (field.metadata !== undefined) base.metadata = { ...base.metadata, ...field.metadata };

    const next = applyTyped(base, field, where);
    if (field.dynamicProps !== undefined) {
        // What `dynamicProps` returns is a customization too: it is applied over
        // the customized property each time the form asks.
        next.dynamicProps = (props: PropertyBuilderProps) => {
            const delta = field.dynamicProps?.(props);
            if (!delta) return {};
            const { dynamicProps: _ignored, ...rest } = delta;
            void _ignored;
            const { dynamicProps: _own, ...settled } = next;
            void _own;
            return applyField(settled, rest, where);
        };
    }
    return next;
}

function applyTyped(property: Property, field: AnyFieldCustomization, where: string): Property {
    switch (property.type) {
        case "string": {
            const admin: AdminStringOptions = commonAdmin(property.admin, field);
            set(admin, "multiline", field.multiline);
            set(admin, "markdown", field.markdown);
            set(admin, "previewAsTag", field.previewAsTag);
            set(admin, "clearable", field.clearable);
            set(admin, "urlPreview", field.urlPreview);
            const out = { ...property, admin };
            set(out, "enum", mergeEnum(property.enum, field, where));
            set(out, "storage", mergeStorage(property.storage, field.storage, where));
            return out;
        }
        case "number": {
            const admin: AdminNumberOptions = commonAdmin(property.admin, field);
            set(admin, "clearable", field.clearable);
            set(admin, "format", field.format);
            const out = { ...property, admin };
            set(out, "enum", mergeEnum(property.enum, field, where));
            return out;
        }
        case "date": {
            const admin: AdminDateOptions = commonAdmin(property.admin, field);
            set(admin, "clearable", field.clearable);
            const out = { ...property, admin };
            set(out, "mode", field.mode);
            set(out, "timezone", field.timezone);
            return out;
        }
        case "vector": {
            const admin: AdminVectorOptions = commonAdmin(property.admin, field);
            set(admin, "clearable", field.clearable);
            return { ...property, admin };
        }
        case "reference": {
            const admin: AdminReferenceOptions = commonAdmin(property.admin, field);
            set(admin, "previewProperties", field.previewFields ? [...field.previewFields] : undefined);
            set(admin, "fixedFilter", field.fixedFilter);
            set(admin, "includeId", field.includeId);
            set(admin, "includeEntityLink", field.includeEntityLink);
            return { ...property, admin };
        }
        case "relation": {
            const admin: AdminRelationOptions = commonAdmin(property.admin, field);
            set(admin, "previewProperties", field.previewFields ? [...field.previewFields] : undefined);
            set(admin, "widget", field.widget);
            set(admin, "fixedFilter", field.fixedFilter);
            set(admin, "includeId", field.includeId);
            set(admin, "includeEntityLink", field.includeEntityLink);
            set(admin, "renderInForm", field.renderInForm);
            const out = { ...property, admin };
            if (field.overrides !== undefined && property.relation) {
                out.relation = { ...property.relation, overrides: overridesOf(field.overrides, `${where}.overrides`) };
            }
            return out;
        }
        case "array":
            return applyArray(property, field, where);
        case "map":
            return applyMap(property, field, where);
        case "boolean":
        case "geopoint":
        case "binary":
            return { ...property, admin: commonAdmin(property.admin, field) };
    }
}

// ── Entry points ─────────────────────────────────────────────────────────────

/**
 * A table's projected collection with a customization folded in.
 *
 * Labels, icon, group, views, kanban, display slots, columns, form layout,
 * actions, custom views and every per-field option are written where the
 * panel's views read them; enum labels and colours are merged onto the
 * projected values, so a value the customization does not mention keeps its
 * seeded colour. A field, column or slot the collection does not have — the
 * server redacted it for this caller, or the table changed — is skipped with
 * a warning in development, never an error.
 *
 * A customization for another slug is not applied.
 *
 * @param collection what the table projects to
 * @param customization the result of `customizeTable`
 *
 * @group Tables
 */
export function applyTableCustomization(collection: TableCollection, customization: TableCustomization): TableCollection {
    if (customization.table !== collection.slug) {
        warnOnce(`mismatch:${customization.table}:${collection.slug}`,
            `customizeTable("${customization.table}") was applied to the "${collection.slug}" table. Not applied.`);
        return collection;
    }
    const where = `customizeTable("${collection.slug}")`;
    const known = knownOf(collection, customization);
    const presentation = presentationOf(customization, known, where);

    const properties: Properties = { ...collection.properties };
    const overrides = new Map<string, Partial<AnyCollectionConfig>>();
    for (const [key, field] of Object.entries(customization.fields ?? {})) {
        if (field === undefined) continue;
        const at = `${where} fields.${key}`;
        const property = collection.properties[key];
        if (property) {
            properties[key] = applyField(property, field, at);
        } else if (!known.relations.has(key)) {
            warnOnce(at, `${at}: the "${collection.slug}" table serves no field "${key}" to this user. Skipped.`);
            continue;
        }
        if (field.overrides !== undefined) overrides.set(key, overridesOf(field.overrides, `${at}.overrides`));
    }

    const out: TableCollection = { ...collection, ...presentation, properties };
    set(out, "name", customization.name);
    set(out, "singularName", customization.singularName);
    set(out, "description", customization.description);
    if (customization.metadata !== undefined) out.metadata = { ...collection.metadata, ...customization.metadata };
    if (collection.relations && overrides.size > 0) {
        out.relations = collection.relations.map((relation): Relation => {
            const override = relation.relationName ? overrides.get(relation.relationName) : undefined;
            return override ? { ...relation, overrides: override } : relation;
        });
    }
    // The flat keys are what the panel reads; an `admin` block, when the
    // collection carries one, is spread over them on resolution, so it gets
    // the same values.
    if (collection.admin) out.admin = { ...collection.admin, ...presentation };
    return out;
}

/**
 * Every served table's collection, each with its customization folded in.
 *
 * A customization whose table is not among `collections` — not served to this
 * user, or misspelt — is ignored with a warning in development. Two
 * customizations of one table are refused: which one wins would depend on
 * import order.
 *
 * @param collections what the served tables project to
 * @param customizations the `customizeTable` results, as `<RebaseCMS tableCustomizations>` takes them
 *
 * @group Tables
 */
export function applyTableCustomizations(
    collections: readonly TableCollection[],
    customizations: readonly TableCustomization[]
): TableCollection[] {
    const bySlug = new Map<string, TableCustomization>();
    for (const customization of customizations) {
        if (bySlug.has(customization.table)) {
            throw new Error(`Two \`customizeTable("${customization.table}", …)\` results were passed. Merge them into one.`);
        }
        bySlug.set(customization.table, customization);
    }
    const served = new Set(collections.map(collection => collection.slug));
    for (const slug of bySlug.keys()) {
        if (!served.has(slug)) {
            warnOnce(`unserved:${slug}`, `customizeTable("${slug}") matches no table served to this user (not visible to this role, or misspelt). Ignored.`);
        }
    }
    return collections.map(collection => {
        const customization = bySlug.get(collection.slug);
        return customization ? applyTableCustomization(collection, customization) : collection;
    });
}

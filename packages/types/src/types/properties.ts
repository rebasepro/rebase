import type { ComponentRef } from "./component_ref";

import type { Entity, EntityReference, EntityRelation, EntityValues, GeoPoint, Vector } from "./entities";
import type { JoinStep, OnAction, Relation } from "./relations";
import type { EntityCollection, FilterValues } from "./collections";
import type { ColorKey, ColorScheme } from "./chips";
import type { AuthController } from "../controllers/auth";
import type { EntityAfterReadProps, EntityBeforeSaveProps } from "./entity_callbacks";
import type { User } from "../users";

/**
 * Callbacks/Hooks for individual property fields
 * @group Entity properties
 */
export type PropertyCallbacks<T = unknown, M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> = {
    /**
     * Callback used after fetching data, to transform the value before rendering
     */
    afterRead?(props: Omit<EntityAfterReadProps<M, USER>, "entity"> & {
        value: T;
        entity: Entity<M> | undefined;
    }): Promise<T> | T;

    /**
     * Callback used before saving, after validation.
     * You can modify the value before it's saved.
     */
    beforeSave?(props: Omit<EntityBeforeSaveProps<M, USER>, "values"> & {
        value: T;
        previousValue: T | undefined;
        values: Partial<M>;
    }): Promise<T> | T;
}

/**
 * @group Entity properties
 */
export type DataType =
    | "string"
    | "number"
    | "boolean"
    | "date"
    | "geopoint"
    | "reference"
    | "relation"
    | "array"
    | "map"
    | "vector"
    | "binary";

export type Property =
    | StringProperty
    | NumberProperty
    | BooleanProperty
    | DateProperty
    | GeopointProperty
    | ReferenceProperty
    | RelationProperty
    | ArrayProperty
    | MapProperty
    | VectorProperty
    | BinaryProperty;

export type Properties = {
    [key: string]: Property;
};

export type PostgresProperty = Exclude<Property, ReferenceProperty>;
export type PostgresProperties = {
    [key: string]: PostgresProperty;
};

export type FirebaseProperty = Exclude<Property, RelationProperty>;
export type FirebaseProperties = {
    [key: string]: FirebaseProperty;
};

/**
 * A helper type to infer the underlying data type from a Property definition.
 * This is the core of the type inference system.
 */
export type InferPropertyType<P extends Property> =
    P extends StringProperty ? string :
        P extends NumberProperty ? number :
            P extends BooleanProperty ? boolean :
                P extends DateProperty ? Date :
                    P extends GeopointProperty ? GeoPoint :
                        P extends ReferenceProperty ? EntityReference :
                            P extends RelationProperty ? EntityRelation | EntityRelation[] :
                                P extends ArrayProperty ? (P["of"] extends Property ? InferPropertyType<P["of"]>[] : unknown[]) :
                                    P extends MapProperty ? (P["properties"] extends Properties ? InferEntityType<P["properties"]> : Record<string, unknown>) :
                                        P extends VectorProperty ? Vector :
                                            P extends BinaryProperty ? string :
                                                never;

/**
 * Helper type that determines whether a property is required.
 * Uses direct structural matching against `{ validation: { required: true } }`
 * (without the optional marker on `validation`), which correctly narrows
 * literal `true` while treating widened `boolean` as not-required.
 */
type IsRequired<P extends Property> = P extends { validation: { required: true } } ? true : false;

/**
 * Extract keys from Properties where the property is required.
 */
type RequiredPropertyKeys<P extends Properties> = {
    [K in keyof P]: IsRequired<P[K]> extends true ? K : never;
}[keyof P];

/**
 * Extract keys from Properties where the property is optional.
 */
type OptionalPropertyKeys<P extends Properties> = {
    [K in keyof P]: IsRequired<P[K]> extends true ? never : K;
}[keyof P];

/**
 * A generic type that converts a `Properties` schema definition into a corresponding
 * TypeScript entity type. It correctly handles required and optional properties.
 *
 * A property is considered required when it has `validation: { required: true }`.
 * The `true` must be a literal type — if `required` is typed as `boolean`,
 * the property will be treated as optional (use `as const` for literal inference).
 *
 * @example
 * const productSchema = {
 *   name: { type: 'string', validation: { required: true } },
 *   price: { type: 'number' }
 * } as const satisfies Properties;
 * type Product = InferEntityType<typeof productSchema>;
 * // Result: { name: string; price?: number; }
 */
export type InferEntityType<P extends Properties> = {
    -readonly [K in RequiredPropertyKeys<P>]: InferPropertyType<P[K]>;
} & {
    -readonly [K in OptionalPropertyKeys<P>]?: InferPropertyType<P[K]>;
};

/**
 * Interface including all common properties of a CMS property.
 * @group Entity properties
 */
export interface BaseUIConfig<CustomProps = unknown> {
    columnWidth?: number;
    hideFromCollection?: boolean;
    readOnly?: boolean;
    disabled?: boolean | PropertyDisabledConfig;
    widthPercentage?: number;
    customProps?: CustomProps;
    Field?: ComponentRef<any>;
    Preview?: ComponentRef<any>;
}

export interface BaseProperty<CustomProps = unknown> {
    ui?: BaseUIConfig<CustomProps>;
    /**
     * Property name (e.g. Product)
     */
    name: string;

    /**
     * Property description, always displayed under the field
     */
    description?: string;

    /**
     * You can use this prop to reuse a property that has been defined
     * in the top level of the CMS in the prop `fields`.
     * All the configuration will be taken from the inherited config, and
     * overwritten by the current property config.
     */
    propertyConfig?: string;

    /**
     * Explicit database column name. When set, this value is used as-is
     * for the SQL column name, bypassing any snake_case conversion of
     * the property key.
     *
     * This is automatically populated by `rebase schema introspect`
     * to guarantee an exact match with the live database schema.
     *
     * For manually-authored collections you can omit this — the framework
     * will derive the column name from the property key via `toSnakeCase()`.
     */
    columnName?: string;

    /**
     * Rules for validating this property
     */
    validation?: PropertyValidationSchema;

    /**
     * This value will be set by default for new entities.
     */
    defaultValue?: unknown;

    /**
     * Use this to define dynamic properties that change based on certain conditions
     * or on the entity's values. For example, you can make a field read-only if
     * another field has a certain value.
     * This function receives the same props as a `PropertyBuilder` and should return a partial `Property` object.
     */
    dynamicProps?: (props: PropertyBuilderProps) => Partial<Property>;

    /**
     * Declarative conditions for dynamic property behavior using JSON Logic.
     *
     * An alternative to PropertyBuilder functions that can be:
     * - Stored in the database as JSON
     * - Edited via the collection editor UI
     * - Evaluated at runtime like property builders
     *
     * @see PropertyConditions for available condition options
     * @see https://jsonlogic.com/ for JSON Logic syntax
     */
    conditions?: PropertyConditions;

    /**
     * Callbacks/Hooks for this property field to transform and sanitize data during its lifecycle.
     */
    callbacks?: PropertyCallbacks;

}

/**
 * @group Entity properties
 */
export interface StringUIConfig extends BaseUIConfig {
    multiline?: boolean;
    markdown?: boolean;
    previewAsTag?: boolean;
    clearable?: boolean;
    url?: boolean | PreviewType;
}

export interface StringProperty extends BaseProperty {
    ui?: StringUIConfig;
    type: "string";
    /**
     * Optional database column type. If not set, it defaults to `varchar` or `uuid` depending on `isId` configuration.
     * Use `text` for strings with unbound length, `char` for fixed-length strings, or `varchar` for variable-length strings with a limit.
     */
    columnType?: "varchar" | "text" | "char" | "uuid";
    /**
     * Rules for validating this property
     */
    validation?: StringPropertyValidationSchema;
    /**
     * Marks this field as a Primary Key / Unique Identifier.
     * Framework behavior: Auto-maps to `collection.primaryKeys` internally if not explicitly set.
     * Drizzle append: `.primaryKey()`
     * UI behavior: Field value cannot be changed after creation.
     *
     * You can set this to `"manual"` for a user-defined ID, or specify a generation strategy:
     * 'uuid' -> Drizzle `.defaultRandom()` (Postgres gen_random_uuid())
     * 'cuid' -> Drizzle `.default(sql\`cuid()\`)`
     * Or any other random string to act as a raw SQL default expression: e.g. `nanoid()`
     *
     * On the UI side, the field automatically gets disabled on new entities if a string strategy is provided.
     */
    isId?: boolean | "manual" | "uuid" | "cuid" | string;
    /**
     * You can use the enum values providing a map of possible
     * exclusive values the property can take, mapped to the label that it is
     * displayed in the dropdown. You can use a simple object with the format
     * `value` => `label`, or with the format `value` => `EnumValueConfig` if you
     * need extra customization, (like disabling specific options or assigning
     * colors). If you need to ensure the order of the elements, you can pass
     * a `Map` instead of a plain object.
     *
     */
    enum?: EnumValues;
    /**
     * Is this string property long enough so it should be displayed in
     * a multiple line field. Defaults to false. If set to true,
     * the number of lines adapts to the content
     */
    multiline?: boolean;
    /**
     * Should this string property be displayed as a markdown field. If true,
     * the field is rendered as a text editors that supports markdown highlight
     * syntax. It also includes a preview of the result.
     */
    markdown?: boolean;
    /**
     * You can specify a `Storage` configuration. It is used to
     * indicate that this string refers to a path in your storage provider.
     */
    storage?: StorageConfig;

    /**
     * This property is used to indicate that the string is a user ID, and
     * it will be rendered as a user picker.
     * Note that the user ID needs to be the one used in your authentication
     * provider, e.g. Firebase Auth.
     * You can also use a property builder to specify the user path dynamically
     * based on other values of the entity.
     */
    userSelect?: boolean;

    /**
     * If the value of this property is a URL, you can set this flag to true
     * to add a link, or one of the supported media types to render a preview
     */
    url?: boolean | PreviewType;
    /**
     * Does this field include an email
     */
    email?: boolean;
    /**
     * Should this string be rendered as a tag instead of just text.
     */
    previewAsTag?: boolean;

    /**
     * You can use this property (a string) to behave as a reference to another
     * collection. The stored value is the ID of the entity in the
     * collection, and the `path` prop is used to
     * define the collection this reference points to.
     */
    reference?: ReferenceProperty;
}

/**
 * @group Entity properties
 */
export interface NumberUIConfig extends BaseUIConfig {
    clearable?: boolean;
}

export interface NumberProperty extends BaseProperty {
    ui?: NumberUIConfig;
    type: "number";
    /**
     * Optional database column type. Allows specifying exact database numeric types.
     * If not provided, integer fields (where validation.integer is true or isId is true) default to `integer`, others to `numeric`.
     */
    columnType?: "integer" | "real" | "double precision" | "numeric" | "bigint" | "serial" | "bigserial";
    /**
     * Rules for validating this property
     */
    validation?: NumberPropertyValidationSchema;
    /**
     * Marks this field as a Primary Key / Unique Identifier.
     * Framework behavior: Auto-maps to `collection.primaryKeys` internally if not explicitly set.
     * Drizzle append: `.primaryKey()`
     * UI behavior: Field value cannot be changed after creation.
     *
     * You can set this to `"manual"` for a user-defined ID, or specify a generation strategy:
     * 'increment' -> PostgreSQL `GENERATED BY DEFAULT AS IDENTITY` or auto-incrementing integer.
     * Or any other random string to act as a raw SQL default expression.
     */
    isId?: boolean | "manual" | "increment" | string;
    /**
     * You can use the enum values providing a map of possible
     * exclusive values the property can take, mapped to the label that it is
     * displayed in the dropdown.
     */
    enum?: EnumValues;

}

/**
 * @group Entity properties
 */
export interface BooleanProperty extends BaseProperty {
    ui?: BaseUIConfig;
    type: "boolean";
    /**
     * Rules for validating this property
     */
    validation?: PropertyValidationSchema;
}

/**
 * @group Entity properties
 */
export interface VectorUIConfig extends BaseUIConfig {
    clearable?: boolean;
}

export interface VectorProperty extends BaseProperty {
    ui?: VectorUIConfig;
    type: "vector";
    dimensions: number;
    validation?: PropertyValidationSchema;
}

/**
 * @group Entity properties
 */
export interface BinaryProperty extends BaseProperty {
    type: "binary";
    validation?: PropertyValidationSchema;
}

/**
 * @group Entity properties
 */
export interface DateUIConfig extends BaseUIConfig {
    clearable?: boolean;
}

export interface DateProperty extends BaseProperty {
    ui?: DateUIConfig;
    type: "date";
    /**
     * Optional database column type. If not set, defaults to `timestamp` with timezone.
     */
    columnType?: "timestamp" | "date" | "time";
    /**
     * Rules for validating this property
     */
    validation?: DatePropertyValidationSchema;
    /**
     * Set the granularity of the field to a date or date + time.
     * Defaults to `date_time`.
     *
     */
    mode?: "date" | "date_time";
    /**
     * Timezone string to evaluate the date in.
     */
    timezone?: string;
    /**
     * If this flag is  set to `on_create` or `on_update` this timestamp is
     * updated automatically on creation of the entity only or on every
     * update (including creation). Useful for creating `created_on` or
     * `updated_on` fields
     */
    autoValue?: "on_create" | "on_update";
    /**
     * Add an icon to clear the value and set it to `null`. Defaults to `false`
     */
    clearable?: boolean;
}

/**
 * @group Entity properties
 */
export interface GeopointProperty extends BaseProperty {
    ui?: BaseUIConfig;
    type: "geopoint";
    /**
     * Rules for validating this property
     */
    validation?: PropertyValidationSchema;
}

/**
 * @group Entity properties
 */
export interface ReferenceUIConfig extends BaseUIConfig {
    previewProperties?: string[];
}

export interface ReferenceProperty extends BaseProperty {
    ui?: ReferenceUIConfig;
    type: "reference";
    /**
     * Marks this field as a Primary Key / Unique Identifier.
     * Framework behavior: Auto-maps to `collection.primaryKeys` internally if not explicitly set.
     * Drizzle append: `.primaryKey()`
     * UI behavior: Field value cannot be changed after creation.
     */
    isId?: boolean;
    /**
     * Absolute collection path of the collection this reference points to.
     * The collection of the entity is inferred based on the root navigation, so
     * the filters and search delegate existing there are applied to this view
     * as well.
     * You can leave this prop undefined if the path is not yet know, e.g.
     * you are using a property builder and the path depends on a different
     * property.
     */
    path?: string;
    /**
     * Allow selection of entities that pass the given filter only.
     * e.g. `fixedFilter: { age: [">=", 18] }`
     */
    fixedFilter?: FilterValues<string>;

    /**
     * Should the reference include the ID of the entity. Defaults to `true`
     */
    includeId?: boolean;
    /**
     * Should the reference include a link to the entity (open the entity details). Defaults to `true`
     */
    includeEntityLink?: boolean;
}

/**
 * @group Entity properties
 */
export interface RelationUIConfig extends BaseUIConfig {
    previewProperties?: string[];
    widget?: "select" | "dialog";
}

export interface RelationProperty extends BaseProperty {
    ui?: RelationUIConfig;
    type: "relation";
    /**
     * Marks this field as a Primary Key / Unique Identifier.
     * Framework behavior: Auto-maps to `collection.primaryKeys` internally if not explicitly set.
     * Drizzle append: `.primaryKey()`
     * UI behavior: Field value cannot be changed after creation.
     */
    isId?: boolean;

    // ─── Inline relation config ───
    // Define the relation directly on the property. The framework automatically
    // extracts these into the collection's `relations[]` at normalization time.
    // You no longer need a separate `relations[]` entry for properties.

    /**
     * The target collection this relation points to.
     * When set, the framework treats this property as a self-contained relation
     * definition and no separate `relations[]` entry is needed.
     */
    target?: string | (() => EntityCollection | string);

    /**
     * Whether this property references one or many records.
     * Defaults to `"one"`.
     */
    cardinality?: "one" | "many";

    /**
     * Which side owns the persistence for this relationship.
     * - `"owning"`: The foreign key (for one-to-one) or junction table (for many-to-many) is on this collection.
     * - `"inverse"`: The foreign key is on the target collection's table.
     * Defaults to `"owning"`.
     */
    direction?: "owning" | "inverse";

    /**
     * The name of the corresponding relation on the target collection.
     * Used for inverse relations to locate the owning side.
     */
    inverseRelationName?: string;

    /**
     * Column on THIS table that stores the foreign key to the target.
     * Required when `direction` is `"owning"` and `cardinality` is `"one"`.
     * Auto-inferred if not set.
     * @example "author_id"
     */
    localKey?: string;

    /**
     * Column on the TARGET table that stores the foreign key back to this entity.
     * Required when `direction` is `"inverse"`.
     * Auto-inferred if not set.
     * @example "post_id"
     */
    foreignKeyOnTarget?: string;

    /**
     * Junction table configuration for many-to-many relationships.
     * Required when `cardinality` is `"many"` and `direction` is `"owning"`.
     * Auto-inferred if not set.
     */
    through?: {
        table: string;
        sourceColumn: string;
        targetColumn: string;
    };

    /**
     * Explicit, ordered join path for advanced multi-hop relations.
     * When set, overrides `localKey`, `foreignKeyOnTarget`, and `through`.
     */
    joinPath?: JoinStep[];

    /**
     * Cascade action on update.
     */
    onUpdate?: OnAction;

    /**
     * Cascade action on delete.
     */
    onDelete?: OnAction;

    /**
     * Overrides applied to the target collection when rendered as a subcollection tab.
     */
    overrides?: Partial<EntityCollection>;

    // ─── Framework-managed fields ───

    /**
     * Optional name for this relation. Defaults to the property key at runtime.
     * Only needed when the relation name should differ from the property key,
     * or for backward compatibility with existing `relations[]` entries.
     */
    relationName?: string;

    /**
     * The resolved relation object, populated by the framework at normalization time.
     * **Do not set manually** — it is computed from the inline fields above
     * or looked up from the collection's `relations[]` array.
     */
    relation?: Relation;

    // ─── UI configuration ───

    /**
     * Allow selection of entities that pass the given filter only.
     * e.g. `fixedFilter: { age: [">=", 18] }`
     */
    fixedFilter?: FilterValues<string>;

    /**
     * Should the reference include the ID of the entity. Defaults to `true`
     */
    includeId?: boolean;
    /**
     * Should the reference include a link to the entity (open the entity details). Defaults to `true`
     */
    includeEntityLink?: boolean;

    /**
     * Choose the widget to use for selecting the relation.
     * Defaults to `select`.
     */
    widget?: "select" | "dialog";
}

/**
 * @group Entity properties
 */
export interface ArrayUIConfig extends BaseUIConfig {
    expanded?: boolean;
    minimalistView?: boolean;
}

export interface ArrayProperty extends BaseProperty {
    ui?: ArrayUIConfig;
    type: "array";
    /**
     * Optional database column type. By default, maps to a native Postgres array
     * (e.g. `text[]`, `integer[]`/`numeric[]`, `boolean[]`) if the element type
     * is a primitive, otherwise defaults to `jsonb`.
     */
    columnType?: "json" | "jsonb" | "text[]" | "integer[]" | "boolean[]" | "numeric[]";
    /**
     * The property of this array.
     * You can specify any property (except another Array property)
     * You can leave this field empty only if you are providing a custom field,
     * or using the `oneOf` prop, otherwise an error will be thrown.
     */
    of?: Property | Property[];
    /**
     * Use this field if you would like to have an array of typed objects.
     * It is useful if you need to have values of different types in the same
     * array.
     * Each entry of the array is an object with the shape:
     * ```
     * { type: "YOUR_TYPE", value: "YOUR_VALUE"}
     * ```
     * Note that you can use any property so `value` can take any value (strings,
     * numbers, array, objects...)
     * You can customise the `type` and `value` fields to suit your needs.
     *
     * An example use case for this feature may be a blog entry, where you have
     * images and text blocks using markdown.
     */
    oneOf?: {
        /**
         * Record of properties, where the key is the `type` and the value
         * is the corresponding property
         */
        properties: Properties;
        /**
         * Order in which the properties are displayed.
         * If you are specifying your collection as code, the order is the same as the
         * one you define in `properties`, and you don't need to specify this prop.
         */
        propertiesOrder?: string[];
        /**
         * Name of the field to use as the discriminator for type
         * Defaults to `type`
         */
        typeField?: string;
        /**
         * Name of the  field to use as the value
         * Defaults to `value`
         */
        valueField?: string;
    };
    /**
     * Rules for validating this property
     */
    validation?: ArrayPropertyValidationSchema;

    /**
     * Can the elements in this array be reordered. Defaults to `true`.
     * This prop has no effect if `disabled` is set to true.
     */
    sortable?: boolean;
    /**
     * Can the elements in this array be added. Defaults to `true`
     * This prop has no effect if `disabled` is set to true.
     */
    canAddElements?: boolean;
}

/**
 * @group Entity properties
 */
export interface MapUIConfig extends BaseUIConfig {
    expanded?: boolean;
    minimalistView?: boolean;
    spreadChildren?: boolean;
}

export interface MapProperty extends BaseProperty {
    ui?: MapUIConfig;
    type: "map";
    /**
     * Optional database column type. Defaults to `jsonb`.
     */
    columnType?: "json" | "jsonb";
    /**
     * Record of properties included in this map.
     */
    properties?: Properties;
    /**
     * Order in which the properties are displayed.
     * If you are specifying your collection as code, the order is the same as the
     * one you define in `properties`, and you don't need to specify this prop.
     */
    propertiesOrder?: string[];
    /**
     * Rules for validating this property.
     * NOTE: If you don't set `required` in the map property, an empty object
     * will be considered valid, even if you set `required` in the properties.
     */
    validation?: PropertyValidationSchema;
    /**
     * Properties that are displayed when rendered as a preview
     */
    previewProperties?: string[];
    /**
     * Render this map as a key-value table that allows to use
     * arbitrary keys. You don't need to define the properties in this case.
     */
    keyValue?: boolean;
}

/**
 * @group Entity properties
 */
export type PropertyBuilderProps<M extends Record<string, unknown> = Record<string, unknown>> = {
    values: Partial<M>;
    previousValues?: Partial<M>;
    propertyValue?: unknown;
    index?: number;
    path: string;
    entityId?: string | number;
    authController: AuthController;
};

/**
 * @group Entity properties
 */
export interface PropertyDisabledConfig {
    /**
     * Enable this flag if you would like to clear the value of the field
     * when the corresponding property gets disabled.
     *
     * This is useful for keeping data consistency when you have conditional
     * properties.
     */
    clearOnDisabled?: boolean;

    /**
     * Explanation of why this property is disabled (e.g. a different field
     * needs to be enabled)
     */
    disabledMessage?: string;

    /**
     * Set this flag to true if you want to hide this field when disabled
     */
    hidden?: boolean;
}

/**
 * We use this type to define mapping between string or number values in
 * the data source to a label (such in a select dropdown).
 * The key in this Record is the value saved in the driver, and the value in
 * this record is the label displayed in the UI.
 * You can add additional customization by assigning a {@link EnumValueConfig} for the
 * label instead of a simple string (for enabling or disabling options and
 * choosing colors).
 * If you need to ensure the order of the elements use an array of {@link EnumValueConfig}
 * @group Entity properties
 */
export type EnumValues = EnumValueConfig[] | Record<string | number, string | EnumValueConfig>;

/**
 * Configuration for a particular entry in an `EnumValues`
 * @group Entity properties
 */
export type EnumValueConfig = {
    /**
     * Value stored in the data source.
     */
    id: string | number;
    /**
     * Displayed label
     */
    label: string;
    /**
     * This value will not be selectable
     */
    disabled?: boolean;
    /**
     * You can pick from a list of predefined color combinations or define
     * your own {@link ColorScheme}
     */
    color?: ColorKey | ColorScheme;
}

/**
 * Rules to validate any property. Some properties have specific rules
 * additionally to these.
 * @group Entity properties
 */
export interface PropertyValidationSchema {
    /**
     * Is this field required
     */
    required?: boolean;

    /**
     * Customize the required message when the property is not set
     */
    requiredMessage?: string;

    /**
     * If the unique flag is set to `true`, you can only have one entity in the
     * collection with this value.
     */
    unique?: boolean;

    /**
     * If the uniqueInArray flag is set to `true`, you can only have this value
     * once per entry in the parent `ArrayProperty`. It has no effect if this
     * property is not a child of an `ArrayProperty`. It works on direct
     * children of an `ArrayProperty` or first level children of `MapProperty`
     */
    uniqueInArray?: boolean;
}

/**
 * Validation rules for numbers
 * @group Entity properties
 */
export interface NumberPropertyValidationSchema extends PropertyValidationSchema {
    min?: number;
    max?: number;
    lessThan?: number;
    moreThan?: number;
    positive?: boolean;
    negative?: boolean;
    integer?: boolean;
}

/**
 * Validation rules for strings
 * @group Entity properties
 */
export interface StringPropertyValidationSchema extends PropertyValidationSchema {
    length?: number;
    min?: number;
    max?: number;
    matches?: string | RegExp;
    /**
     * Message displayed when the input does not satisfy the regex in `matches`
     */
    matchesMessage?: string;
    trim?: boolean;
    lowercase?: boolean;
    uppercase?: boolean;
}

/**
 * Validation rules for dates
 * @group Entity properties
 */
export interface DatePropertyValidationSchema extends PropertyValidationSchema {
    min?: Date;
    max?: Date;
}

/**
 * Validation rules for arrays
 * @group Entity properties
 */
export interface ArrayPropertyValidationSchema extends PropertyValidationSchema {
    min?: number;
    max?: number;
}

/**
 * Additional configuration related to Storage related fields
 * @group Entity properties
 */
export type StorageConfig = {
    /**
     * File MIME types that can be uploaded to this reference. Don't specify for
     * all.
     * Note that you can also use the asterisk notation, so `image/*`
     * accepts any image file, and so on.
     */
    acceptedFiles?: FileType[];

    /**
     * Advanced image resizing and cropping configuration.
     * Applied before upload to optimize storage and bandwidth.
     * Only applies to image MIME types: image/jpeg, image/png, image/webp
     */
    imageResize?: ImageResize;

    /**
     * Specific metadata set in your uploaded file.
     * For the default Firebase implementation, the values passed here are of type
     * `firebase.storage.UploadMetadata`
     */
    metadata?: Record<string, unknown>,

    /**
     * You can use this prop to customize the uploaded filename.
     * You can use a function as a callback or a string where you
     * specify some placeholders that get replaced with the corresponding values.
     * - `{file}` - Full file name
     * - `{file.name}` - Name of the file without extension
     * - `{file.ext}` - Extension of the file
     * - `{rand}` - Random value used to avoid name collisions
     * - `{entityId}` - ID of the entity
     * - `{propertyKey}` - ID of this property
     * - `{path}` - Path of this entity
     *
     * @param context
     */
    fileName?: string | ((context: UploadedFileContext) => string | Promise<string>);

    /**
     * Absolute path in your bucket.
     *
     * You can use a function as a callback or a string where you
     * specify some placeholders that get replaced with the corresponding values.
     * - `{file}` - Full file name
     * - `{file.name}` - Name of the file without extension
     * - `{file.ext}` - Extension of the file
     * - `{rand}` - Random value used to avoid name collisions
     * - `{entityId}` - ID of the entity
     * - `{propertyKey}` - ID of this property
     * - `{path}` - Path of this entity
     */
    storagePath: string | ((context: UploadedFileContext) => string);

    /**
     * When set to true, this flag indicates that the bucket name will be
     * included in the saved storage path.
     *
     * E.g. `s3://my-bucket/path/to/file.png` instead of just `path/to/file.png`
     *
     * Defaults to false.
     */
    includeBucketUrl?: boolean;

    /**
     * When set to true, this flag indicates that the download URL of the file
     * will be saved in the driver, instead of the storage path.
     *
     * Note that the generated URL may use a token that, if disabled, may
     * make the URL unusable and lose the original reference to Cloud Storage,
     * so it is not encouraged to use this flag.
     *
     * Defaults to false.
     */
    storeUrl?: boolean,

    /**
     * Define maximal file size in bytes
     */
    maxSize?: number,

    /**
     * Use this callback to process the file before uploading it to the storage.
     * If nothing is returned, the file is uploaded as it is.
     * @param file
     */
    processFile?: (file: File) => Promise<File> | undefined;

    /**
     * Postprocess the saved value (storage path or URL)
     * after it has been resolved.
     */
    postProcess?: (pathOrUrl: string) => Promise<string>;

    /**
     * You can use this prop in order to provide a custom preview URL.
     * Useful when the file's path is different from the original field value
     */
    previewUrl?: (fileName: string) => string;
}

/**
 * @group Entity properties
 */
export interface UploadedFileContext {
    /**
     * Uploaded file
     */
    file: File;

    /**
     * Property field name
     */
    propertyKey: string;

    /**
     * Property related to this upload
     */
    property: StringProperty | ArrayProperty;

    /**
     * Entity ID
     */
    entityId?: string | number;

    /**
     * Entity path. E.g. `products/PID/locales`
     */
    path?: string;

    /**
     * Values of the current entity
     */
    values: EntityValues<any>;

    /**
     * Storage meta specified by the developer
     */
    storage: StorageConfig;
}

/**
 * Used for previewing urls if the download file is known
 * @group Entity properties
 */
export type PreviewType = "image" | "video" | "audio" | "file";

/**
 * MIME types for storage fields
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Common_types
 * @group Entity properties
 */
export type FileType =
    | "image/*"
    | "video/*"
    | "audio/*"
    | "application/*"
    | "text/*"
    | "font/*"
    | string;

export interface ImageResize {
    /**
     * Maximum width in pixels. Image will be scaled down proportionally if wider.
     */
    maxWidth?: number;

    /**
     * Maximum height in pixels. Image will be scaled down proportionally if taller.
     */
    maxHeight?: number;

    /**
     * Resize mode determines how the image fits within maxWidth/maxHeight bounds.
     * - `contain`: Scale down to fit within bounds, preserving aspect ratio (default)
     * - `cover`: Scale to fill bounds, preserving aspect ratio (may crop)
     */
    mode?: "contain" | "cover";

    /**
     * Output format for the resized image.
     * - `original`: Keep the original format (default)
     * - `jpeg`: Convert to JPEG
     * - `png`: Convert to PNG
     * - `webp`: Convert to WebP
     */
    format?: "original" | "jpeg" | "png" | "webp";

    /**
     * Quality for lossy formats (JPEG, WebP). Number between 0 and 100.
     * Higher is better quality but larger file size. Defaults to 80.
     */
    quality?: number;
}

/**
 * A JSON Logic rule that gets evaluated at runtime.
 * @see https://jsonlogic.com/
 *
 * Common operators:
 * - Comparison: ==, !=, ===, !==, >, <, >=, <=
 * - Logic: and, or, !, !!
 * - Data access: var, missing, missing_some
 * - Array: in, map, filter, reduce, all, some, none, merge
 * - String: substr, cat
 * - Numeric: +, -, *, /, %, min, max
 *
 * Custom operators:
 * - hasRole(roleId) - check if user has role by ID
 * - hasAnyRole([roleIds]) - check if user has any of the roles
 * - isToday(timestamp) - check if timestamp is today
 * - isPast(timestamp) - check if timestamp is in the past
 * - isFuture(timestamp) - check if timestamp is in the future
 *
 * @group Entity properties
 */
export type JsonLogicRule = Record<string, any>;

/**
 * Conditions for individual enum values within a property.
 * @group Entity properties
 */
export interface EnumValueConditions {
    /**
     * Disable this enum option when condition is true.
     * The option appears grayed out and cannot be selected.
     */
    disabled?: JsonLogicRule;

    /**
     * Message explaining why this option is disabled.
     */
    disabledMessage?: string;

    /**
     * Completely hide this enum option when condition is true.
     * The option is removed from the dropdown/list.
     */
    hidden?: JsonLogicRule;
}

/**
 * Declarative conditions for dynamic property behavior.
 * All conditions are JSON Logic rules evaluated against ConditionContext.
 *
 * An alternative to PropertyBuilder functions that can be:
 * - Stored in the database as JSON
 * - Edited via the collection editor UI
 * - Evaluated at runtime like property builders
 *
 * @see https://jsonlogic.com/ for JSON Logic syntax
 * @group Entity properties
 */
export interface PropertyConditions {

    // ═══════════════════════════════════════════════════════════════════════
    // FIELD STATE CONDITIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Disable the field when this condition evaluates to true.
     * The field becomes non-editable but still visible (unless also hidden).
     *
     * @example Disable when another field has a specific value
     * \`\`\`json
     * { "==": [{ "var": "values.status" }, "archived"] }
     * \`\`\`
     */
    disabled?: JsonLogicRule;

    /**
     * Message to display when the field is disabled by a condition.
     */
    disabledMessage?: string;

    /**
     * Clear the field's value when it becomes disabled.
     * @default false
     */
    clearOnDisabled?: boolean;

    /**
     * Hide the field completely when this condition evaluates to true.
     * The field is removed from the form (not just visually hidden).
     */
    hidden?: JsonLogicRule;

    /**
     * Make the field read-only when this condition evaluates to true.
     * Renders as a preview instead of an input.
     */
    readOnly?: JsonLogicRule;

    // ═══════════════════════════════════════════════════════════════════════
    // VALIDATION CONDITIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Make the field required when this condition evaluates to true.
     * Overrides the static `validation.required` setting.
     */
    required?: JsonLogicRule;

    /**
     * Custom message when conditional required validation fails.
     */
    requiredMessage?: string;

    /**
     * Dynamic minimum value for number/string length.
     * Should evaluate to a number.
     */
    min?: JsonLogicRule;

    /**
     * Dynamic maximum value for number/string length.
     * Should evaluate to a number.
     */
    max?: JsonLogicRule;

    // ═══════════════════════════════════════════════════════════════════════
    // VALUE CONDITIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Dynamic default value for new entities.
     * Should evaluate to a value of the appropriate type for the field.
     * Only applied when entityId is empty (new entity).
     */
    defaultValue?: JsonLogicRule;

    // ═══════════════════════════════════════════════════════════════════════
    // ENUM CONDITIONS (for string/number properties with enum values)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Conditions for individual enum values.
     * Keys are the enum value IDs, values are condition configs.
     *
     * @example Disable certain enum options based on user role
     * \`\`\`json
     * {
     *   "admin": {
     *     "disabled": { "!": { "hasRole": "admin" } },
     *     "disabledMessage": "Admin option requires admin role"
     *   }
     * }
     * \`\`\`
     */
    enumConditions?: Record<string | number, EnumValueConditions>;

    /**
     * Filter which enum values are available.
     * Should evaluate to an array of allowed enum value IDs.
     */
    allowedEnumValues?: JsonLogicRule;

    /**
     * Exclude specific enum values.
     * Should evaluate to an array of enum value IDs to exclude.
     */
    excludedEnumValues?: JsonLogicRule;

    // ═══════════════════════════════════════════════════════════════════════
    // REFERENCE CONDITIONS (for reference properties)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Dynamic path for reference properties.
     * Should evaluate to a collection path string.
     */
    referencePath?: JsonLogicRule;

    /**
     * Dynamic filter for reference selection.
     * Should evaluate to a FilterValues object.
     */
    referenceFilter?: JsonLogicRule;

    // ═══════════════════════════════════════════════════════════════════════
    // ARRAY CONDITIONS (for array properties)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Can elements be added to the array?
     */
    canAddElements?: JsonLogicRule;

    /**
     * Can elements be reordered in the array?
     */
    sortable?: JsonLogicRule;

    // ═══════════════════════════════════════════════════════════════════════
    // STORAGE CONDITIONS (for file upload properties)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Dynamic accepted file types.
     * Should evaluate to an array of MIME types.
     */
    acceptedFiles?: JsonLogicRule;

    /**
     * Dynamic maximum file size in bytes.
     * Should evaluate to a number.
     */
    maxFileSize?: JsonLogicRule;
}

/**
 * Context available during JSON Logic condition evaluation.
 * Mirrors PropertyBuilderProps but adapted for JSON serialization.
 * @group Entity properties
 */
export interface ConditionContext {
    /**
     * Current form/entity values.
     * Date values are converted to Unix timestamps (milliseconds).
     */
    values: Record<string, unknown>;

    /**
     * Previous values before the current edit session.
     */
    previousValues: Record<string, unknown>;

    /**
     * Current value of this property specifically.
     */
    propertyValue: unknown;

    /**
     * Collection path (e.g., "products", "users/uid123/orders")
     */
    path: string;

    /**
     * Entity ID. Undefined for new entities.
     */
    entityId?: string;

    /**
     * Whether this is a new entity being created.
     */
    isNew: boolean;

    /**
     * Index of this property (only for array items).
     */
    index?: number;

    /**
     * Current authenticated user information.
     */
    user: {
        uid: string;
        email: string | null;
        displayName: string | null;
        photoURL: string | null;
        /** Role IDs the user has (extracted from Role[].id) */
        roles: string[];
    };

    /**
     * Current timestamp as Unix milliseconds.
     */
    now: number;
}

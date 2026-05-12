import fs from "fs";

let content = fs.readFileSync("packages/types/src/types/properties.ts", "utf8");

content = content.replace(`    /**
     * Width in pixels of this column in the collection view. If not set
     * the width is inferred based on the other configurations
     */
    columnWidth?: number;

    /**
     * Do not show this property in the collection view
     */
    hideFromCollection?: boolean;

    /**
     * Is this a read only property. When set to true, it gets rendered as a
     * preview.
     */
    readOnly?: boolean;

    /**
     * Is this field disabled.
     * When set to true, it gets rendered as a
     * disabled field. You can also specify a configuration for defining the
     * behaviour of disabled properties (including custom messages, clear value on
     * disabled or hide the field completely)
     */
    disabled?: boolean | PropertyDisabledConfig;`, "");

content = content.replace(`    /**
     * A number between 0 and 100 that indicates the width of the field in the form view.
     * It defaults to 100, but you can set it to 50 to have two fields in the same row.
     */
    widthPercentage?: number;

    /**
     * Additional props that are passed to the components defined in \`field\`
     * or in \`preview\`.
     */
    customProps?: CustomProps;`, "");

content = content.replace(`    /**
     * Custom field component to render this property in forms.
     * Used by the CMS layer.
     */
    Field?: React.ComponentType<any>;

    /**
     * Custom preview component to render this property in previews/tables.
     * Used by the CMS layer.
     */
    Preview?: React.ComponentType<any>;`, "");


content = content.replace(`export interface BaseProperty<CustomProps = unknown> {`, `export interface BaseUIConfig<CustomProps = unknown> {
    columnWidth?: number;
    hideFromCollection?: boolean;
    readOnly?: boolean;
    disabled?: boolean | PropertyDisabledConfig;
    widthPercentage?: number;
    customProps?: CustomProps;
    Field?: React.ComponentType<any>;
    Preview?: React.ComponentType<any>;
}

export interface BaseProperty<CustomProps = unknown> {
    ui?: BaseUIConfig<CustomProps>;`);


content = content.replace(`    /**
     * Indicates whether this string property should be displayed as multiline
     * in the form view.
     */
    multiline?: boolean;
    /**
     * This field should be rendered as a markdown field.
     */
    markdown?: boolean;
    /**
     * If this field is a URL, it will be rendered as a link in the collection view.
     * If the value is \`image\`, \`video\` or \`audio\`, it will be rendered as such.
     */
    url?: boolean | PreviewType;
    /**
     * Should this string be rendered as a tag instead of just text.
     */
    previewAsTag?: boolean;
    /**
     * Add an icon to clear the value and set it to \`null\`. Defaults to \`false\`
     */
    clearable?: boolean;

    /**
     * You can use this property (a string) to behave as a reference to another
     * collection. The stored value is the ID of the entity in the
     * collection, and the \`path\` prop is used to
     * define the collection this reference points to.
     */
    reference?: ReferenceProperty;`, "");

content = content.replace(`export interface StringProperty extends BaseProperty {`, `export interface StringUIConfig extends BaseUIConfig {
    multiline?: boolean;
    markdown?: boolean;
    previewAsTag?: boolean;
    clearable?: boolean;
    url?: boolean | PreviewType;
}

export interface StringProperty extends BaseProperty {
    ui?: StringUIConfig;`);

content = content.replace(`    /**
     * Add an icon to clear the value and set it to \`null\`. Defaults to \`false\`
     */
    clearable?: boolean;`, "");

content = content.replace(`export interface NumberProperty extends BaseProperty {`, `export interface NumberUIConfig extends BaseUIConfig {
    clearable?: boolean;
}

export interface NumberProperty extends BaseProperty {
    ui?: NumberUIConfig;`);

// remove clearable from DateProperty
content = content.replace(`    /**
     * Add an icon to clear the value and set it to \`null\`. Defaults to \`false\`
     */
    clearable?: boolean;`, "");

content = content.replace(`export interface DateProperty extends BaseProperty {`, `export interface DateUIConfig extends BaseUIConfig {
    clearable?: boolean;
}

export interface DateProperty extends BaseProperty {
    ui?: DateUIConfig;`);

content = content.replace(`export interface BooleanProperty extends BaseProperty {`, `export interface BooleanProperty extends BaseProperty {
    ui?: BaseUIConfig;`);

content = content.replace(`export interface GeopointProperty extends BaseProperty {`, `export interface GeopointProperty extends BaseProperty {
    ui?: BaseUIConfig;`);

content = content.replace(`    /**
     * Properties that need to be rendered when displaying a preview of this
     * reference. If not specified the first 3 are used. Only the first 3
     * specified values are considered.
     */
    previewProperties?: string[];`, "");

content = content.replace(`export interface ReferenceProperty extends BaseProperty {`, `export interface ReferenceUIConfig extends BaseUIConfig {
    previewProperties?: string[];
}

export interface ReferenceProperty extends BaseProperty {
    ui?: ReferenceUIConfig;`);


content = content.replace(`    /**
     * Properties that need to be rendered when displaying a preview of this
     * reference. If not specified the first 3 are used. Only the first 3
     * specified values are considered.
     */
    previewProperties?: string[];`, "");

content = content.replace(`    /**
     * Widget to be used to select the relation.
     * Defaults to \`select\`.
     */
    widget?: "select" | "dialog";`, "");

content = content.replace(`export interface RelationProperty extends BaseProperty {`, `export interface RelationUIConfig extends BaseUIConfig {
    previewProperties?: string[];
    widget?: "select" | "dialog";
}

export interface RelationProperty extends BaseProperty {
    ui?: RelationUIConfig;`);

content = content.replace(`    /**
     * Should the field be initially expanded. Defaults to \`true\`
     */
    expanded?: boolean;
    /**
     * Display the child properties directly, without being wrapped in an
     * extendable panel.
     */
    minimalistView?: boolean;`, "");

content = content.replace(`export interface ArrayProperty extends BaseProperty {`, `export interface ArrayUIConfig extends BaseUIConfig {
    expanded?: boolean;
    minimalistView?: boolean;
}

export interface ArrayProperty extends BaseProperty {
    ui?: ArrayUIConfig;`);


content = content.replace(`    /**
     * Display the child properties as independent columns in the collection
     * view
     */
    spreadChildren?: boolean;
    /**
     * Display the child properties directly, without being wrapped in an
     * extendable panel. Note that this will also hide the title of this property.
     */
    minimalistView?: boolean;
    /**
     * Should the field be initially expanded. Defaults to \`true\`
     */
    expanded?: boolean;`, "");

content = content.replace(`export interface MapProperty extends BaseProperty {`, `export interface MapUIConfig extends BaseUIConfig {
    expanded?: boolean;
    minimalistView?: boolean;
    spreadChildren?: boolean;
}

export interface MapProperty extends BaseProperty {
    ui?: MapUIConfig;`);

// Finally, put PostgresProperties and FirebaseProperties back
content = content.replace(`export type Properties = {
    [key: string]: Property;
};`, `export type Properties = {
    [key: string]: Property;
};

export type PostgresProperty = Exclude<Property, ReferenceProperty>;
export type PostgresProperties = {
    [key: string]: PostgresProperty;
};

export type FirebaseProperty = Exclude<Property, RelationProperty>;
export type FirebaseProperties = {
    [key: string]: FirebaseProperty;
};`);

fs.writeFileSync("packages/types/src/types/properties.ts", content);

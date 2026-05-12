import fs from "fs";

let content = fs.readFileSync("packages/types/src/types/properties.ts", "utf8");

// Remove from BaseProperty
content = content.replace(/\/\*\*[\s\S]*?columnWidth\?: number;/g, "");
content = content.replace(/\/\*\*[\s\S]*?hideFromCollection\?: boolean;/g, "");
content = content.replace(/\/\*\*[\s\S]*?readOnly\?: boolean;/g, "");
content = content.replace(/\/\*\*[\s\S]*?disabled\?: boolean \| PropertyDisabledConfig;/g, "");
content = content.replace(/\/\*\*[\s\S]*?widthPercentage\?: number;/g, "");
content = content.replace(/\/\*\*[\s\S]*?customProps\?: CustomProps;/g, "");
content = content.replace(/\/\*\*[\s\S]*?Field\?: React\.ComponentType<any>;/g, "");
content = content.replace(/\/\*\*[\s\S]*?Preview\?: React\.ComponentType<any>;/g, "");

// Remove from StringProperty
content = content.replace(/\/\*\*[\s\S]*?multiline\?: boolean;/g, "");
content = content.replace(/\/\*\*[\s\S]*?markdown\?: boolean;/g, "");
content = content.replace(/\/\*\*[\s\S]*?url\?: boolean \| PreviewType;/g, "");
content = content.replace(/\/\*\*[\s\S]*?previewAsTag\?: boolean;/g, "");
content = content.replace(/\/\*\*[\s\S]*?clearable\?: boolean;/g, "");
content = content.replace(/\/\*\*[\s\S]*?reference\?: ReferenceProperty;/g, "");

// Remove from NumberProperty, DateProperty
// clearable is already replaced by the generic regex above... wait, regex is global. It will remove it everywhere.

// Remove from ReferenceProperty
content = content.replace(/\/\*\*[\s\S]*?previewProperties\?: string\[\];/g, "");

// Remove from RelationProperty
// previewProperties already removed
content = content.replace(/\/\*\*[\s\S]*?widget\?: "select" \| "dialog";/g, "");

// Remove from ArrayProperty
content = content.replace(/\/\*\*[\s\S]*?expanded\?: boolean;/g, "");
content = content.replace(/\/\*\*[\s\S]*?minimalistView\?: boolean;/g, "");

// Remove from MapProperty
content = content.replace(/\/\*\*[\s\S]*?spreadChildren\?: boolean;/g, "");
// expanded and minimalistView already removed

// Add UI Configs
content = content.replace("export interface BaseProperty<CustomProps = unknown> {", `export interface BaseUIConfig<CustomProps = unknown> {
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

content = content.replace("export interface StringProperty extends BaseProperty {", `export interface StringUIConfig extends BaseUIConfig {
    multiline?: boolean;
    markdown?: boolean;
    previewAsTag?: boolean;
    clearable?: boolean;
    url?: boolean | PreviewType;
}

export interface StringProperty extends BaseProperty {
    ui?: StringUIConfig;`);

content = content.replace("export interface NumberProperty extends BaseProperty {", `export interface NumberUIConfig extends BaseUIConfig {
    clearable?: boolean;
}

export interface NumberProperty extends BaseProperty {
    ui?: NumberUIConfig;`);

content = content.replace("export interface DateProperty extends BaseProperty {", `export interface DateUIConfig extends BaseUIConfig {
    clearable?: boolean;
}

export interface DateProperty extends BaseProperty {
    ui?: DateUIConfig;`);

content = content.replace("export interface ReferenceProperty extends BaseProperty {", `export interface ReferenceUIConfig extends BaseUIConfig {
    previewProperties?: string[];
}

export interface ReferenceProperty extends BaseProperty {
    ui?: ReferenceUIConfig;`);

content = content.replace("export interface RelationProperty extends BaseProperty {", `export interface RelationUIConfig extends BaseUIConfig {
    previewProperties?: string[];
    widget?: "select" | "dialog";
}

export interface RelationProperty extends BaseProperty {
    ui?: RelationUIConfig;`);

content = content.replace("export interface ArrayProperty extends BaseProperty {", `export interface ArrayUIConfig extends BaseUIConfig {
    expanded?: boolean;
    minimalistView?: boolean;
}

export interface ArrayProperty extends BaseProperty {
    ui?: ArrayUIConfig;`);

content = content.replace("export interface MapProperty extends BaseProperty {", `export interface MapUIConfig extends BaseUIConfig {
    expanded?: boolean;
    minimalistView?: boolean;
    spreadChildren?: boolean;
}

export interface MapProperty extends BaseProperty {
    ui?: MapUIConfig;`);

fs.writeFileSync("packages/types/src/types/properties.ts", content);

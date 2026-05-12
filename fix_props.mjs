import fs from "fs";

let content = fs.readFileSync("packages/types/src/types/properties.ts", "utf8");

content = content.replace("export interface BaseUIConfig<CustomProps = unknown> {\n}", `export interface BaseUIConfig<CustomProps = unknown> {
    columnWidth?: number;
    hideFromCollection?: boolean;
    readOnly?: boolean;
    disabled?: boolean | PropertyDisabledConfig;
    widthPercentage?: number;
    customProps?: CustomProps;
    Field?: React.ComponentType<any>;
    Preview?: React.ComponentType<any>;
}`);

content = content.replace("export interface StringUIConfig extends BaseUIConfig {\n}", `export interface StringUIConfig extends BaseUIConfig {
    multiline?: boolean;
    markdown?: boolean;
    previewAsTag?: boolean;
    clearable?: boolean;
    url?: boolean | PreviewType;
}`);

content = content.replace("export interface NumberUIConfig extends BaseUIConfig {\n}", `export interface NumberUIConfig extends BaseUIConfig {
    clearable?: boolean;
}`);

content = content.replace("export interface ReferenceUIConfig extends BaseUIConfig {\n}", `export interface ReferenceUIConfig extends BaseUIConfig {
    previewProperties?: string[];
}`);

content = content.replace("export interface RelationUIConfig extends BaseUIConfig {", `export interface RelationUIConfig extends BaseUIConfig {
    widget?: "select" | "dialog";`);

content = content.replace("export interface ArrayUIConfig extends BaseUIConfig {\n}", `export interface ArrayUIConfig extends BaseUIConfig {
    expanded?: boolean;
    minimalistView?: boolean;
}`);

content = content.replace("export interface MapUIConfig extends BaseUIConfig {\n", `export interface MapUIConfig extends BaseUIConfig {
    expanded?: boolean;
    minimalistView?: boolean;\n`);

fs.writeFileSync("packages/types/src/types/properties.ts", content);

/**
 * Per-property presentation options.
 *
 * These lived in `@rebasepro/types` next to the property types they belong to, which
 * meant a BaaS install shipped `Field`, `Preview`, `columnWidth` and `hideFromCollection`
 * in its type surface with nothing to render them. They are attached to the property
 * types by `augment.ts` instead.
 */
import type { ComponentRef, WhereFilterOp } from "@rebasepro/types";

/**
 * Interface including all common properties of an admin property.
 * @group Entity properties
 */
export interface AdminPropertyOptions<CustomProps = unknown> {
    columnWidth?: number;
    hideFromCollection?: boolean;
    readOnly?: boolean;
    disabled?: boolean | PropertyDisabledConfig;
    widthPercentage?: number;
    customProps?: CustomProps;
    Field?: ComponentRef<any>;
    Preview?: ComponentRef<any>;

    /**
     * Narrow the filter operators offered for this property in collection
     * filter UIs (table header filters and the Filters dialog).
     *
     * The final offered set is the **intersection** of the engine's
     * capabilities, the property-type defaults, and this list — you can only
     * *restrict*, never enable an operator the underlying engine cannot run.
     *
     * Pass an empty array to disable filtering on this property entirely.
     *
     * @example
     * // Email column: exact match, contains, and null check only
     * admin: { filterOperators: ["==", "ilike", "is-null"] }
     */
    filterOperators?: readonly WhereFilterOp[];

    /**
     * Replace the filter field rendered for this property in collection
     * filter UIs. The component receives `FilterFieldBindingProps`
     * (property, resolved `operators`, `value`, `setValue`, …).
     *
     * Takes precedence over the collection-level
     * `components["Collection.FilterField"]` override and the built-in
     * per-type filter fields.
     */
    Filter?: ComponentRef<any>;
}

/**
 * @group Entity properties
 */
export interface AdminStringOptions extends AdminPropertyOptions {
    /**
     * Is this string property long enough so it should be displayed in
     * a multiple line field. Defaults to false. If set to true,
     * the number of lines adapts to the content
     */
    multiline?: boolean;
    /**
     * Should this string property be displayed as a markdown field. If true,
     * the field is rendered as a text editor that supports markdown highlight
     * syntax. It also includes a preview of the result.
     */
    markdown?: boolean;
    /**
     * Should this string be rendered as a tag instead of just text.
     */
    previewAsTag?: boolean;
    clearable?: boolean;
    /**
     * How to render a string that holds a URL: a link, or one of the supported
     * media types for an inline preview.
     *
     * Only presentation. Whether the string *is* a URL is `url` on the property
     * itself, which is what the OpenAPI contract is generated from.
     */
    urlPreview?: PreviewType;
}

/**
 * @group Entity properties
 */
export interface AdminNumberOptions extends AdminPropertyOptions {
    clearable?: boolean;
}

/**
 * @group Entity properties
 */
export interface AdminVectorOptions extends AdminPropertyOptions {
    clearable?: boolean;
}

/**
 * @group Entity properties
 */
export interface AdminDateOptions extends AdminPropertyOptions {
    /**
     * Add an icon to clear the value and set it to `null`. Defaults to `false`
     */
    clearable?: boolean;
}

/**
 * @group Entity properties
 */
export interface AdminReferenceOptions extends AdminPropertyOptions {
    previewProperties?: string[];
}

/**
 * @group Entity properties
 */
export interface AdminRelationOptions extends AdminPropertyOptions {
    previewProperties?: string[];
    widget?: "select" | "dialog";
}

/**
 * @group Entity properties
 */
export interface AdminArrayOptions extends AdminPropertyOptions {
    expanded?: boolean;
    minimalistView?: boolean;
}

/**
 * @group Entity properties
 */
export interface AdminMapOptions extends AdminPropertyOptions {
    expanded?: boolean;
    minimalistView?: boolean;
    spreadChildren?: boolean;
}

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
 * Used for previewing urls if the download file is known
 * @group Entity properties
 */
export type PreviewType = "image" | "video" | "audio" | "file";

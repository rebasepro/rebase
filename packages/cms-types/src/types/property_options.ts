/**
 * Per-property presentation options.
 *
 * These lived in `@rebasepro/types` next to the property types they belong to, which
 * meant a BaaS install shipped `Field`, `Preview`, `columnWidth` and `hideFromCollection`
 * in its type surface with nothing to render them. They are attached to the property
 * types by `augment.ts` instead.
 */
import type { ComponentRef, FilterValues, WhereFilterOp } from "@rebasepro/types";
import { ADMIN_PROPERTY_KEYS as CORE_ADMIN_PROPERTY_KEYS } from "@rebasepro/types";
import type { PropertySpan } from "./form_layout";

/**
 * Interface including all common properties of an admin property.
 * @group Entity properties
 */
export interface AdminPropertyOptions<CustomProps = unknown> {
    /**
     * Width of this property's column in the table view, in pixels. Omit and the
     * table derives one from the property type.
     *
     * A person can drag a column wider, and that is remembered per user; this is
     * the width everyone starts from.
     */
    columnWidth?: number;
    /**
     * Keep this property out of the table and card views. It is still on the
     * entity form, and still read and written by the API.
     *
     * For a field that should not leave the server at all, use
     * `excludeFromApi` on the property itself — this one is presentation, and
     * hiding a secret with it hides it from exactly one screen.
     */
    hideFromCollection?: boolean;
    /**
     * Render the **value**, not a control. Defaults to `false`.
     *
     * The distinction from {@link disabled} is what the field looks like and
     * what it can do. `readOnly` shows the value as text: nothing to focus,
     * nothing to clear, and no explanation owed, because there is no control to
     * wonder about. Use it for something the server owns — a computed total, an
     * `autoValue` timestamp.
     *
     * A property that is read-only *for some people* is not this: that is a
     * security rule, and writing it here leaves the column writable through the
     * API by anyone who skips the panel.
     */
    readOnly?: boolean;
    /**
     * Render the control, greyed out. Defaults to `false`.
     *
     * The counterpart to {@link readOnly}: this one is a field that *could* be
     * edited but is not, right now — usually because of a condition, which is
     * why it takes a config with a `disabledMessage` saying why and a
     * `clearOnDisabled` for the value that no longer applies. The control stays
     * visible so the reader can see the shape of what they are not allowed to
     * fill in.
     */
    disabled?: boolean | PropertyDisabledConfig;

    /**
     * How many of the form grid's {@link FORM_GRID_COLUMNS} columns this field
     * occupies. Omit to let the layout derive one from the property type.
     *
     * Spans snap to a shared grid, so two fields line up whatever order they
     * are declared in.
     */
    span?: PropertySpan;
    /**
     * Anything your own {@link Field} or {@link Preview} needs, passed straight
     * through untouched.
     *
     * Typed by the property's own `CustomProps` parameter, so a custom field
     * declares what it expects and a collection that supplies the wrong shape is
     * a compile error rather than an `undefined` at render time.
     */
    customProps?: CustomProps;
    /**
     * Replace the form control for this property.
     *
     * The component receives `FieldProps` — the value, `setValue`, the resolved
     * property, the whole entity's values, and any {@link customProps}. It owns
     * the input; validation, the label and the error line stay with the form.
     *
     * A `ComponentRef` rather than a component so a collection stays
     * serializable: the reference is a registered key, which survives being sent
     * to the schema editor and written back to the file.
     */
    Field?: ComponentRef<any>;
    /**
     * Replace how this property renders when it is *not* being edited — a table
     * cell, a card line, a reference chip.
     *
     * Separate from {@link Field} because the two are read in different places
     * and at different sizes; overriding one and not the other is normal.
     */
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
    /**
     * Add an icon that sets the value to `null`. Defaults to `false`.
     *
     * Worth setting where empty and empty-string are different answers — an
     * unset middle name is not the same as one somebody deleted.
     */
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
 * How a number is written out for reading.
 *
 * A thin, explicit subset of `Intl.NumberFormatOptions`. Explicit is the whole
 * point: nothing here is inferred. A collection that happens to carry a
 * `currency` column alongside a `total` column has not told us that one formats
 * the other — that is a relationship only the author knows, and guessing it
 * would put a euro sign on the one number that was never money.
 *
 * Presentation only. It changes what {@link PropertyPreview} renders — the
 * detail view, the table cell, a reference card — and never what the number
 * input holds, because a formatted string is not a number you can type into.
 */
export interface NumberFormatOptions {
    /** Defaults to `"decimal"`. `"currency"` requires {@link currency}. */
    style?: "decimal" | "currency" | "percent";
    /**
     * ISO 4217 code — `"EUR"`, `"USD"`. Setting it implies `style: "currency"`,
     * so the common case is one key.
     */
    currency?: string;
    /**
     * BCP 47 tag. Defaults to the panel's locale, which is what makes the same
     * amount read `1,234.50` for one user and `1.234,50` for another.
     */
    locale?: string;
    /** Pad to at least this many decimals — `2` writes `5` as `5.00`. */
    minimumFractionDigits?: number;
    /** Round to at most this many decimals. Does not change the stored value. */
    maximumFractionDigits?: number;
    /** `"compact"` renders `12000` as `12K`. Useful in narrow table columns. */
    notation?: "standard" | "compact";
}

/**
 * @group Entity properties
 */
export interface AdminNumberOptions extends AdminPropertyOptions {
    /**
     * Add an icon that sets the value to `null`. Defaults to `false`.
     *
     * Numbers are where this matters most: without it, clearing the input
     * leaves `0`, and "no price" and "free" become the same row.
     */
    clearable?: boolean;
    /**
     * Write this number out as currency, a percentage, or with fixed decimals.
     * Omit and the raw value renders, which stays the default: a number in the
     * database is shown as the number in the database.
     */
    format?: NumberFormatOptions;
}

/**
 * @group Entity properties
 */
export interface AdminVectorOptions extends AdminPropertyOptions {
    /**
     * Add an icon that sets the embedding to `null`. Defaults to `false`.
     *
     * A vector is normally written by whatever generates it, so this is for the
     * case where a human needs to say "this one is stale" and let it be
     * recomputed.
     */
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
    /**
     * Which of the *target's* properties are shown in the chip that stands in
     * for the referenced entity. At most three fit; the rest are ignored.
     *
     * Defaults to the target collection's own `admin.previewProperties`, then to
     * a derived guess. Name them here when the referring context wants different
     * ones — an order line wants the product's SKU, the catalogue wants its
     * name.
     */
    previewProperties?: string[];

    /**
     * Offer only entities that pass this filter in the selection dialog.
     * e.g. `fixedFilter: { age: [">=", 18] }`
     */
    fixedFilter?: FilterValues<string>;

    /** Show the referenced entity's id in previews. Defaults to `true`. */
    includeId?: boolean;

    /** Show a link that opens the referenced entity. Defaults to `true`. */
    includeEntityLink?: boolean;
}

/**
 * @group Entity properties
 */
export interface AdminRelationOptions extends AdminPropertyOptions {
    /**
     * Which of the *target's* properties are shown in the chip that stands in
     * for the related row. At most three fit; the rest are ignored.
     *
     * Defaults to the target collection's own `admin.previewProperties`, then to
     * a derived guess. Name them here when this side wants different ones.
     */
    previewProperties?: string[];

    /**
     * Which widget selects the related entity. Defaults to `select`.
     */
    widget?: "select" | "dialog";

    /**
     * Offer only entities that pass this filter in the selection widget.
     * e.g. `fixedFilter: { age: [">=", 18] }`
     */
    fixedFilter?: FilterValues<string>;

    /** Show the related entity's id in previews. Defaults to `true`. */
    includeId?: boolean;

    /** Show a link that opens the related entity. Defaults to `true`. */
    includeEntityLink?: boolean;

    /**
     * Render a **many**-relation as a picker inside the entity form as well as
     * the tab it already gets. Defaults to `false`.
     *
     * The entity view lists a many-relation's rows as a tab, which is the whole
     * treatment: the child rows are a list, not a value the form holds. This
     * flag exists for the project that wants the inline picker anyway — it is
     * off by default because the two surfaces are redundant by construction.
     *
     * No effect on a to-one relation: a foreign key gets no tab, so its picker
     * is always rendered.
     */
    renderInForm?: boolean;
}

/**
 * @group Entity properties
 */
export interface AdminArrayOptions extends AdminPropertyOptions {
    /**
     * Open every element on load instead of collapsing them to one line each.
     * Defaults to `false`.
     *
     * Expanding is right for a short list of small elements and wrong for a long
     * one: twenty open cards is a form nobody can find the bottom of.
     */
    expanded?: boolean;
    /**
     * Drop the per-element chrome — the frame, the header, the index — and
     * render the children alone. Defaults to `false`.
     *
     * For an array of one simple field, where the chrome is most of the pixels.
     */
    minimalistView?: boolean;

    /**
     * Can the elements in this array be reordered by dragging. Defaults to
     * `true`. No effect when the property is disabled.
     */
    sortable?: boolean;

    /**
     * Can elements be added to this array. Defaults to `true`. No effect when
     * the property is disabled.
     */
    canAddElements?: boolean;
}

/**
 * @group Entity properties
 */
export interface AdminMapOptions extends AdminPropertyOptions {
    /**
     * Open the map's fields on load instead of collapsing them behind its
     * header. Defaults to `false`.
     */
    expanded?: boolean;
    /**
     * Drop the map's frame and header and render its fields alone. Defaults to
     * `false`.
     */
    minimalistView?: boolean;
    /**
     * Lay the map's fields out as if they were the parent's own, rather than
     * grouped inside it. Defaults to `false`.
     *
     * Presentation only — the values still nest under this property's key in the
     * row, and in every read the API serves. It is for a group that is a
     * grouping in the schema and not in the form: an address, a set of
     * dimensions.
     */
    spreadChildren?: boolean;

    /**
     * Which of the map's own properties are shown when it is rendered as a
     * preview. Defaults to all of them, in `propertiesOrder`.
     */
    previewProperties?: string[];
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

/**
 * Every key any property `admin` block accepts, across the base options and the
 * per-type extensions.
 */
type AnyAdminPropertyOptionKey =
    | keyof AdminPropertyOptions
    | keyof AdminStringOptions
    | keyof AdminNumberOptions
    | keyof AdminVectorOptions
    | keyof AdminDateOptions
    | keyof AdminReferenceOptions
    | keyof AdminRelationOptions
    | keyof AdminArrayOptions
    | keyof AdminMapOptions;

/**
 * Core's list, re-exported through the same `satisfies` agreement check that
 * {@link ADMIN_COLLECTION_KEYS} gets: core owns the data because the boot-time
 * collection validator in `@rebasepro/server` needs it and may not import this
 * package, and this clause is what stops the data from drifting off the types.
 */
export const ADMIN_PROPERTY_KEYS = CORE_ADMIN_PROPERTY_KEYS satisfies readonly AnyAdminPropertyOptionKey[];

/**
 * And the reverse direction: an option key these types declare that core's list
 * does not name.
 *
 * The `satisfies` above only closes one side. This one matters since the boot
 * validator started warning about unrecognised keys inside a property's `admin`
 * block: an option missing from the list would make the server call a correct
 * config a typo, and a check that cries wolf is a check people turn off.
 */
type _EveryAdminPropertyOptionIsListed =
    AssertNeverPropertyKey<Exclude<AnyAdminPropertyOptionKey, typeof CORE_ADMIN_PROPERTY_KEYS[number]>>;

/** Compiles only when `T` is `never`. */
type AssertNeverPropertyKey<T extends never = never> = T;

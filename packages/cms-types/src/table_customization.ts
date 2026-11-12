/**
 * `customizeTable`: how a project states the deltas over the collection a
 * Postgres table projects to in the panel.
 *
 * A table defined with `defineTable` in `backend/schema/` reaches the panel
 * with no frontend file at all: labels, widgets, enum chips, relation pickers
 * and permission reflection are all derived from its descriptor. A file in
 * `frontend/src/cms/` says only what differs:
 *
 * ```tsx
 * import { customizeTable } from "@rebasepro/cms";
 * import type { posts } from "../../../backend/schema/posts";
 * import { CustomMarkdownEditor } from "../components/CustomMarkdownEditor";
 *
 * export const postsCms = customizeTable<typeof posts>("posts", {
 *     icon: "FileText",
 *     defaultViewMode: "cards",
 *     kanban: { columnField: "status", orderField: "__order" },
 *     fields: {
 *         status:  { enumLabels: { draft: { label: "Draft", color: "gray" } } },
 *         content: { Field: CustomMarkdownEditor },
 *     },
 * });
 * ```
 *
 * Everything in this module is typed against `typeof table`: a field, a
 * display slot, a kanban column, a form section entry or a sort key that the
 * table does not have is a compile error, an enum label for a value the column
 * cannot hold is a compile error, and an entity action's `row` is the table's
 * row: its `InferRow` columns, plus each relation the panel loaded, nested
 * under the relation's name as REST's `include` returns it
 * (`({ row }) => row.customer?.name`). Written without the type parameter
 * (`customizeTable("posts", { … })`) the same object is accepted, loosely typed.
 *
 * Components are values. A `Field`, `Preview`, `Filter`, `Builder` or override
 * `Component` is the React component itself, imported with a plain ES import:
 * this file runs only in the browser bundle, so there is no backend to keep
 * React out of, and no string path or lazy thunk to resolve.
 *
 * The keys are the panel's `admin` vocabulary under spec names. The internal
 * view model the views read is unchanged; `applyTableCustomization` in
 * `@rebasepro/cms` is the one place that maps these names onto it.
 */
import type React from "react";
import type {
    BuilderKind,
    ColorKey,
    ColorScheme,
    CollectionCallbacks,
    EntityRelation,
    ColumnsShape,
    FilterPreset,
    FilterValues,
    InferRow,
    TableSlugOf,
    InferUpdate,
    NumericColumnKind,
    OrderBySpec,
    Property,
    PropertyBuilderProps,
    PropertyConditions,
    RelationsShape,
    TemporalColumnKind,
    TextColumnKind,
    UploadedFileContext,
    User,
    WhereFilterOp
} from "@rebasepro/types";
import type { AdditionalFieldKey } from "./admin_collection";
import type {
    AdditionalFieldDelegateProps,
    CollectionActionsProps,
    CollectionSize,
    DefaultSelectedViewBuilder,
    SelectionController,
    ViewMode
} from "./collections";
import type { RebaseContext } from "./rebase_context";
import type { CollectionCustomView, CollectionCustomViewParams } from "./types/collection_views";
import type { CollectionComponentName, FilterFieldBindingProps } from "./types/component_overrides";
import type { EntityAction, EntityActionClickProps } from "./types/entity_actions";
import type { EntityCustomView, EntityCustomViewParams } from "./types/entity_views";
import type { ExportConfig } from "./types/export_import";
import type { PropertySpan } from "./types/form_layout";
import type { FieldProps } from "./types/plugins";
import type { NumberFormatOptions, PreviewType } from "./types/property_options";

// ── The table a customization is typed against ───────────────────────────────

/**
 * What `customizeTable` can be typed against: the result of `defineTable`,
 * `defineAuthTable` or `defineView`, read structurally so a frontend needs
 * only `import type { posts }` from `backend/schema`.
 *
 * @group Table customization
 */
export interface CustomizableTable {
    readonly name: string;
    readonly config: { readonly columns: ColumnsShape; readonly relations?: RelationsShape };
}

/** The `columns` of a table; any columns for the untyped form. */
type ColumnsOf<T> = T extends CustomizableTable ? T["config"]["columns"] : ColumnsShape;

/** The `relations` of a table; any relations for the untyped form. */
type RelationsOf<T> = T extends CustomizableTable ? NonNullable<T["config"]["relations"]> : RelationsShape;

/**
 * The slug a customization of `T` is matched by: the `slug` the table was
 * defined with, or the name it was defined under when it was given none — read
 * from `typeof table` (`TableSlugOf`). Any string for the untyped form.
 *
 * @group Table customization
 */
export type TableSlug<T> = T extends CustomizableTable ? TableSlugOf<T> : string;

/**
 * The column keys of `T`: the keys of its `columns`, which are the keys of
 * its rows on the wire and of its fields in the panel.
 *
 * @group Table customization
 */
export type TableColumnKey<T> = T extends CustomizableTable ? Extract<keyof ColumnsOf<T>, string> : string;

/**
 * The relation names of `T`: the keys of its `relations`.
 *
 * @group Table customization
 */
export type TableRelationKey<T> = T extends CustomizableTable ? Extract<keyof RelationsOf<T>, string> : string;

/**
 * A field of `T` the panel shows: a column or a relation.
 *
 * @group Table customization
 */
export type TableFieldKey<T> = TableColumnKey<T> | TableRelationKey<T>;

/**
 * A field of `T`, or a dotted path into one (`"seo.title"`, `"photos.0"`). Only
 * the root is checked; the path below it is resolved with the field's value.
 *
 * @group Table customization
 */
export type TableFieldPath<T> = TableFieldKey<T> | `${TableFieldKey<T>}.${string}`;

/**
 * An entry of a list of columns: a field path, a relation's tab as a column
 * (`subcollection:<relation>`), or the key of one of `additionalFields`,
 * written `"score" as AdditionalFieldKey`.
 *
 * @group Table customization
 */
export type TableColumnId<T> = TableFieldPath<T> | `subcollection:${TableRelationKey<T>}` | AdditionalFieldKey;

type Simplify<O> = { [K in keyof O]: O[K] } & {};

/** A loaded target row. Its columns are not typed: relation targets are thunks, so mutual relations compile. */
type IncludedRow = Record<string, unknown>;
/** A to-one relation other than `belongsTo`: its target's row when loaded, else its id, or `null` when there is none. */
type IncludedOne = IncludedRow | string | number | null;
/** A to-many relation: its targets' rows when every one was loaded, else their ids. */
type IncludedMany = IncludedRow[] | (string | number)[];

/**
 * What a row carries under a relation's name, as the panel hands it to a
 * display resolver or an entity action (`toWireRow`):
 *
 * - `belongsTo`: the target's row when the panel loaded it; absent otherwise —
 *   the key itself is in the foreign-key column (`customerId`);
 * - `hasOne`: the target's row when loaded, else its id, or `null`;
 * - `hasMany` / `manyToMany`: the targets' rows when loaded, else their ids;
 * - `via`: as its `cardinality` says; either, when that is not a literal.
 */
type IncludedRelationValue<Rel> =
    Rel extends { readonly kind: "belongsTo" } ? IncludedRow :
    Rel extends { readonly kind: "hasOne" } ? IncludedOne :
    Rel extends { readonly kind: "hasMany" | "manyToMany" } ? IncludedMany :
    Rel extends { readonly kind: "via"; readonly cardinality: "one" } ? IncludedOne :
    Rel extends { readonly kind: "via"; readonly cardinality: "many" } ? IncludedMany :
    IncludedOne | IncludedMany;

/**
 * A row of `T` as the panel hands it to a display resolver or an entity
 * action: the row as the server sends it (`InferRow<typeof table>`), plus each
 * relation, optional, under its name — present when the panel loaded it, which
 * it does for the relations it draws. The related rows' own columns are not
 * typed. A plain record for the untyped form.
 *
 * ```ts
 * display: { subtitle: ({ row }) => typeof row.customer?.name === "string" ? row.customer.name : undefined }
 * ```
 *
 * @group Table customization
 */
export type TableRow<T> = T extends CustomizableTable
    ? Simplify<InferRow<T> & { [K in TableRelationKey<T>]?: IncludedRelationValue<RelationsOf<T>[K]> }>
    : Record<string, unknown>;

/** A relation's value in the form: the view model's `EntityRelation`. */
type FormRelationValue<Rel> =
    Rel extends { readonly kind: "belongsTo" | "hasOne" } ? EntityRelation | null :
    Rel extends { readonly kind: "hasMany" | "manyToMany" } ? EntityRelation[] :
    Rel extends { readonly kind: "via"; readonly cardinality: "one" } ? EntityRelation | null :
    Rel extends { readonly kind: "via"; readonly cardinality: "many" } ? EntityRelation[] :
    EntityRelation | EntityRelation[] | null;

/** A column's value in the form: a temporal column holds a `Date` there (a string until it is parsed). */
type FormColumnValue<Col, V> = KindOf<Col> extends TemporalColumnKind ? Exclude<V, string> | Date | string : V;

/**
 * The values of a record of `T` as its form holds them — what `dynamicProps`
 * reads. Not the wire row: the form works on the panel's view model, where a
 * date column holds a `Date` and a relation an `EntityRelation`. A plain
 * record for the untyped form.
 *
 * @group Table customization
 */
export type TableFormValues<T> = T extends CustomizableTable
    ? Simplify<
        { [K in keyof InferRow<T>]: FormColumnValue<K extends keyof ColumnsOf<T> ? ColumnsOf<T>[K] : never, InferRow<T>[K]> } &
        { [K in TableRelationKey<T>]?: FormRelationValue<RelationsOf<T>[K]> }
    >
    : Record<string, unknown>;

/**
 * What an update of `T` accepts: `InferUpdate<typeof table>`. A plain record for
 * the untyped form.
 *
 * @group Table customization
 */
export type TableUpdate<T> = T extends CustomizableTable ? InferUpdate<T> : Record<string, unknown>;

type DataOf<Col> = Col extends { readonly $data: infer D } ? D : unknown;
type KindOf<Col> = Col extends { readonly $kind: infer K } ? K : BuilderKind;
type ElementOf<D> = D extends readonly (infer E)[] ? E : D;
/** A literal string or number type, or `never` for a wide one. */
type LiteralOf<D> =
    D extends string ? (string extends D ? never : D) :
    D extends number ? (number extends D ? never : D) :
    never;

/**
 * The values a column can hold when they form a closed set — a `col.enum([...])`
 * or a `.oneOf([...])`, or an array of either — and `never` for any other column.
 *
 * @group Table customization
 */
export type ColumnEnumValue<Col> = LiteralOf<ElementOf<DataOf<Col>>>;

/** The columns of `T` a kanban board can be grouped by: a single closed set of strings. */
type KanbanColumnKey<T> = T extends CustomizableTable
    ? {
        [K in TableColumnKey<T>]: DataOf<ColumnsOf<T>[K]> extends readonly unknown[]
            ? never
            : [ColumnEnumValue<ColumnsOf<T>[K]>] extends [never]
                ? never
                : ColumnEnumValue<ColumnsOf<T>[K]> extends string ? K : never
    }[TableColumnKey<T>]
    : string;

/** The text columns of `T`: what holds a kanban order key. */
type TextColumnKeyOf<T> = T extends CustomizableTable
    ? { [K in TableColumnKey<T>]: KindOf<ColumnsOf<T>[K]> extends TextColumnKind ? K : never }[TableColumnKey<T>]
    : string;

/**
 * The target of a relation, when it is a table a customization can be typed
 * against. A `rel.*` thunk is a `TableThunk` (`() => void`, so mutual relations
 * need no annotation), which carries no target type: this is `undefined` for
 * every relation `defineTable` builds, and a relation's options are typed
 * loosely.
 */
type RelationTargetOf<Rel> = Rel extends { readonly target: () => infer Target }
    ? Target extends CustomizableTable ? Target : undefined
    : undefined;

// ── Components, by value ─────────────────────────────────────────────────────

/**
 * A React component, by value: a function component, a class component, or a
 * `memo` / `forwardRef` / `lazy` result.
 *
 * Its props are compared both ways rather than strictly, so a component
 * written against a narrower props type (`FieldProps<StringProperty>`) is
 * accepted where the slot hands it the general one.
 *
 * @group Table customization
 */
export type ComponentSlot<P> =
    | { bivarianceHack(props: P): React.ReactNode | Promise<React.ReactNode> }["bivarianceHack"]
    | React.ComponentClass<P>;

/**
 * What a `Preview` component receives: the value of the field it stands for,
 * drawn somewhere other than its form — a table cell, a card, a reference chip.
 *
 * @group Table customization
 */
export interface FieldPreviewProps {
    /** The key (or dotted path) of the field. */
    propertyKey?: string;
    /** The value to draw. */
    value: unknown;
    /** The resolved field. */
    property: Property;
    /** How much room the surface gives it. */
    size: "small" | "medium" | "large";
    /** Most height the surface gives the preview, in pixels. Unlimited when omitted. */
    height?: number;
    /** Most width the surface gives the preview, in pixels. Unlimited when omitted. */
    width?: number;
    /** The field's `customProps`. */
    customProps?: unknown;
    /** Whether the preview may react to clicks. */
    interactive?: boolean;
    /** An image preview fills its container completely. Images only. */
    fill?: boolean;
    /** Relations draw as plain text rather than as cards. */
    textOnly?: boolean;
    /**
     * One line that cannot grow (a card slot, a chip, a fixed-height cell): a
     * block value — Markdown, multi-line text, a map, an array — draws an excerpt or
     * a count instead. Inferred from the preview's nesting when omitted.
     */
    compact?: boolean;
}

// ── Field customizations ─────────────────────────────────────────────────────

/**
 * One value of a closed set, as the panel draws it.
 *
 * @group Table customization
 */
export interface EnumLabel {
    /** The text on the chip and in the select. */
    label: string;
    /** A chip colour key (`"green"`, `"orangeDark"`) or a full scheme. A value left without one keeps its seeded colour. */
    color?: ColorKey | ColorScheme;
    /** Shown, but not offered for selection. */
    disabled?: boolean;
}

/**
 * Labels for some of a closed set's values: a string, or an {@link EnumLabel}.
 * Values left out keep the label and colour the projection gave them.
 *
 * @group Table customization
 */
export type EnumLabels<V extends string | number> = { [K in V]?: string | EnumLabel };

/**
 * `disabled` as an object: why, and what happens to the value.
 *
 * @group Table customization
 */
export interface FieldDisabled {
    /** Clear the value when the field becomes disabled. */
    clearOnDisabled?: boolean;
    /** Why the field cannot be edited, shown beside it. */
    disabledMessage?: string;
}

/**
 * What a field's `dynamicProps` is handed: the record as it is being edited,
 * in the form's view model ({@link TableFormValues}) — a date column holds a
 * `Date`, a relation an `EntityRelation` — not the wire row.
 *
 * @group Table customization
 */
export type FieldBuilderProps<Row> = Omit<PropertyBuilderProps, "values" | "previousValues"> & {
    /** The record's values right now, unsaved edits included. */
    values: Partial<Row>;
    /** The values as they were saved, when the record exists. */
    previousValues?: Partial<Row>;
};

/**
 * The browser-only half of a `col.storage()` column: the functions the server
 * cannot hold. The serializable half (`path` template, `accept`, `maxBytes`,
 * `imageResize`, `fileName` template, …) stays on `col.storage({ … })`.
 *
 * @group Table customization
 */
export interface StorageCustomization {
    /** Computes the folder a file is uploaded to, replacing the column's `path` template. */
    path?(context: UploadedFileContext): string;
    /** Computes the stored file name, replacing the column's `fileName` template. */
    fileName?(context: UploadedFileContext): string | Promise<string>;
    /** Transforms a file before it is uploaded (compress, strip metadata). */
    processFile?(file: File): Promise<File> | undefined;
    /** Transforms the stored path or URL before it is written to the column. */
    postProcess?(pathOrUrl: string): Promise<string>;
    /** The URL to preview a stored file at. */
    previewUrl?(fileName: string): string;
}

/**
 * What every field accepts, whatever its column type.
 *
 * @group Table customization
 */
export interface FieldOptions<Row = Record<string, unknown>> {
    /** The label. Derived from the key when omitted (`publishDate` → "Publish Date"). */
    name?: string;
    /** Help text under the field. */
    description?: string;
    /** Kept out of the table and card views. Still on the form, and still read and written by the API. */
    hidden?: boolean;
    /** Kept off the form: the field cannot be edited there. Still in the views. */
    hiddenInForm?: boolean;
    /** The control is drawn greyed out. An object says why. */
    disabled?: boolean | FieldDisabled;
    /** The value is drawn as text, with no control. */
    readOnly?: boolean;
    /** Replaces the form control. The component itself, imported by value. */
    Field?: ComponentSlot<FieldProps>;
    /** Replaces how the value is drawn outside the form. The component itself. */
    Preview?: ComponentSlot<FieldPreviewProps>;
    /** Replaces the filter control for this field. The component itself. */
    Filter?: ComponentSlot<FilterFieldBindingProps>;
    /** The column width in the table, in pixels. */
    columnWidth?: number;
    /** The server fills this field on create (a hook): the form lets a record be created without it. */
    filledByServer?: boolean;
    /** How many of the form grid's four columns the field spans. */
    span?: PropertySpan;
    /** Passed untouched to the field's `Field` and `Preview` components. */
    customProps?: unknown;
    /** Narrows the filter operators offered for the field. `[]` disables filtering on it. */
    filterOperators?: readonly WhereFilterOp[];
    /** The key of a custom field type registered with the panel. */
    propertyConfig?: string;
    /** JSON-logic rules that hide, disable or require the field from the record's values. Form only. */
    conditions?: PropertyConditions;
    /**
     * Changes this field's customization from the record being edited: return
     * the options that apply now. Form only.
     */
    dynamicProps?(props: FieldBuilderProps<Row>): AnyFieldCustomization | undefined;
    /** Opaque data for your own components. */
    metadata?: Record<string, unknown>;
}

/**
 * Options of a text or uuid column.
 *
 * @group Table customization
 */
export interface TextFieldOptions {
    /** A multi-line input, growing with its content. */
    multiline?: boolean;
    /** A markdown editor with a preview. */
    markdown?: boolean;
    /** Drawn as a chip rather than text. */
    previewAsTag?: boolean;
    /** Adds a control that sets the value to `null`. */
    clearable?: boolean;
    /** How a URL in the value is previewed: a media type, or `true` for a link. */
    urlPreview?: PreviewType | boolean;
    /**
     * The column holds the key of a record in another collection — possibly on
     * another data source, such as a Firestore collection declared with
     * `defineFirestoreCollection`. It is drawn and picked as a reference to
     * that collection, and the lookup is routed by `resolveDataSource`.
     */
    referenceTo?: string;
}

/**
 * Options of a `col.enum()` column.
 *
 * @group Table customization
 */
export interface EnumFieldOptions {
    /** Drawn as a chip rather than text. */
    previewAsTag?: boolean;
    /** Adds a control that sets the value to `null`. */
    clearable?: boolean;
}

/**
 * Options of a number column.
 *
 * @group Table customization
 */
export interface NumberFieldOptions {
    /** Adds a control that sets the value to `null`. */
    clearable?: boolean;
    /** Writes the number out as currency, a percentage, or with fixed decimals. */
    format?: NumberFormatOptions;
}

/**
 * Options of a timestamp, date or time column.
 *
 * @group Table customization
 */
export interface DateFieldOptions {
    /** Adds a control that sets the value to `null`. */
    clearable?: boolean;
    /** Pick and show a day only, or a day and a time. Derived from the column type when omitted. */
    mode?: "date" | "date_time";
    /** The IANA time zone the value is shown and picked in (`"Europe/Madrid"`). The viewer's when omitted. */
    timezone?: string;
}

/**
 * Options of a `col.vector()` column.
 *
 * @group Table customization
 */
export interface VectorFieldOptions {
    /** Adds a control that sets the value to `null`. */
    clearable?: boolean;
}

/**
 * Options of a `col.storage()` column.
 *
 * @group Table customization
 */
export interface StorageFieldOptions {
    /** The upload functions that run in the browser. */
    storage?: StorageCustomization;
    /** Adds a control that sets the value to `null`. */
    clearable?: boolean;
    /** How a URL in the value is previewed: a media type, or `true` for a link. */
    urlPreview?: PreviewType | boolean;
}

/**
 * Options of an array column.
 *
 * @group Table customization
 */
export interface ArrayFieldOptions<Item = NestedFieldCustomization> {
    /** Every item open on load. */
    expanded?: boolean;
    /** Items without their frame and header. */
    minimalistView?: boolean;
    /** Items can be reordered by dragging. */
    sortable?: boolean;
    /** Items can be added. */
    canAddElements?: boolean;
    /** The customization of each item. */
    of?: Item;
    /** The upload functions, for an array of files (`col.storage().multiple()`). */
    storage?: StorageCustomization;
}

/** `V` without `null` and `undefined`; `unknown` stays `unknown` (where `NonNullable` would make it `{}`). */
type Defined<V> = unknown extends V ? unknown : NonNullable<V>;

type JsonKeyOf<D> =
    unknown extends D ? string :
    D extends readonly unknown[] ? string :
    D extends object ? Extract<keyof D, string> :
    string;

/**
 * The customizations of the keys of a JSON document: typed by its keys when
 * the column says what the document is (`col.jsonb<T>()`, `json.object({ … })`).
 *
 * @group Table customization
 */
export type NestedFields<D> =
    unknown extends D ? { [key: string]: NestedFieldCustomization<unknown> } :
    D extends readonly unknown[] ? { [key: string]: NestedFieldCustomization<unknown> } :
    D extends object ? { [K in Extract<keyof D, string>]?: NestedFieldCustomization<D[K]> } :
    { [key: string]: NestedFieldCustomization<unknown> };

/**
 * Options of a `json` / `jsonb` column.
 *
 * @group Table customization
 */
export interface JsonFieldOptions<
    Key extends string = string,
    Fields = { [key: string]: NestedFieldCustomization },
    Item = NestedFieldCustomization
> {
    /** The document's fields open on load. */
    expanded?: boolean;
    /** The document's fields without its frame and header. */
    minimalistView?: boolean;
    /** The document's fields laid out as if they were the record's own. */
    spreadChildren?: boolean;
    /** Edited as free key/value pairs. */
    keyValue?: boolean;
    /** The document's keys shown when it is drawn as a preview. */
    previewFields?: Key[];
    /** The customization of each key of the document. */
    fields?: Fields;
    /** The order the document's keys are shown in. */
    fieldOrder?: Key[];
    /** The customization of each item, for a document that is a list. */
    of?: Item;
    /** The customization of each variant of a typed block (`json.oneOf`), by variant. */
    oneOf?: { [variant: string]: NestedFieldCustomization };
}

/**
 * Labels, colours and order for a closed set of values.
 *
 * @group Table customization
 */
export interface EnumLabelOptions<V extends string | number> {
    /** Labels and colours by value. */
    enumLabels?: EnumLabels<V>;
    /** The order the values are offered and the kanban columns are drawn in. The column's own order when omitted. */
    enumOrder?: readonly V[];
}

/** What a column with no closed set of values accepts for `enumLabels`: nothing. */
interface NoEnumLabels {
    enumLabels?: never;
    enumOrder?: never;
}

type EnumOptionsOf<V> =
    unknown extends V ? EnumLabelOptions<string | number> :
    [LiteralOf<ElementOf<V>>] extends [never] ? NoEnumLabels :
    EnumLabelOptions<LiteralOf<ElementOf<V>>>;

/**
 * The customization of one key of a JSON document, or of one item of a list.
 *
 * @group Table customization
 */
export type NestedFieldCustomization<V = unknown> =
    FieldOptions &
    Omit<TextFieldOptions, "referenceTo"> &
    NumberFieldOptions &
    DateFieldOptions &
    StorageFieldOptions &
    ArrayFieldOptions<NestedFieldCustomization<ElementOf<Defined<V>>>> &
    JsonFieldOptions<JsonKeyOf<Defined<V>>, NestedFields<Defined<V>>, NestedFieldCustomization<ElementOf<Defined<V>>>> &
    EnumOptionsOf<Defined<V>>;

/**
 * Options of a relation.
 *
 * @group Table customization
 */
export interface RelationFieldOptions<
    TargetKey extends string = string,
    TargetPath extends string = string,
    Overrides = Omit<TableCustomizationOptions, "fields">
> {
    /** The target's fields shown in the chip that stands for a related row. At most three fit. */
    previewFields?: TargetKey[];
    /** How a related row is picked. */
    widget?: "select" | "dialog";
    /** Offer only rows that pass this filter. */
    fixedFilter?: FilterValues<TargetPath>;
    /** Show the related row's id in previews. */
    includeId?: boolean;
    /** Show a link that opens the related row. */
    includeEntityLink?: boolean;
    /** Also render a many-relation as a picker in the form, beside its tab. */
    renderInForm?: boolean;
    /** How the target is presented when this relation is drawn as a tab of the record. */
    overrides?: Overrides;
}

type KindOptions<K, D> =
    K extends TextColumnKind | "uuid" ? TextFieldOptions :
    K extends "enum" ? EnumFieldOptions :
    K extends "storage" ? StorageFieldOptions :
    K extends NumericColumnKind ? NumberFieldOptions :
    K extends TemporalColumnKind ? DateFieldOptions :
    K extends "vector" ? VectorFieldOptions :
    K extends "array" ? ArrayFieldOptions<NestedFieldCustomization<ElementOf<D>>> :
    K extends "json" | "jsonb" ? JsonFieldOptions<JsonKeyOf<D>, NestedFields<D>, NestedFieldCustomization<ElementOf<D>>> :
    object;

/**
 * Every field option, for the untyped form and for code that handles any
 * field.
 *
 * @group Table customization
 */
export type AnyFieldCustomization =
    FieldOptions &
    TextFieldOptions &
    NumberFieldOptions &
    DateFieldOptions &
    StorageFieldOptions &
    ArrayFieldOptions &
    JsonFieldOptions &
    RelationFieldOptions &
    EnumLabelOptions<string | number>;

/**
 * The customization of one column: what every field accepts, the options of
 * its column type, and labels for its values when they form a closed set.
 *
 * `Col` is the column's builder type (`typeof posts.config.columns.status`);
 * without it every option is accepted.
 *
 * @group Table customization
 */
export type FieldCustomization<Col = undefined, Row = Record<string, unknown>> =
    [Col] extends [undefined]
        ? AnyFieldCustomization
        : FieldOptions<Row> & KindOptions<KindOf<Col>, DataOf<Col>> & EnumOptionsOf<DataOf<Col>>;

/**
 * The customization of one relation.
 *
 * @group Table customization
 */
export type RelationFieldCustomization<Rel = undefined, Row = Record<string, unknown>> =
    FieldOptions<Row> &
    RelationFieldOptions<
        TableFieldKey<RelationTargetOf<Rel>>,
        TableFieldPath<RelationTargetOf<Rel>>,
        Omit<TableCustomizationOptions<RelationTargetOf<Rel>>, "fields">
    > &
    NoEnumLabels;

/**
 * The `fields` of a customization: one entry per column or relation of `T`.
 *
 * @group Table customization
 */
export type TableFields<T> = T extends CustomizableTable
    ? {
        [K in TableFieldKey<T>]?: K extends TableColumnKey<T>
            ? FieldCustomization<ColumnsOf<T>[K], TableFormValues<T>>
            : RelationFieldCustomization<RelationsOf<T>[K], TableFormValues<T>>
    }
    : { [key: string]: AnyFieldCustomization };

// ── Collection-level pieces ──────────────────────────────────────────────────

/**
 * Kanban board configuration.
 *
 * @group Table customization
 */
export interface TableKanban<Column extends string = string, Order extends string = string> {
    /** The column the board's columns come from: a `col.enum()` (or `.oneOf()`) of strings. */
    columnField: Column;
    /**
     * The text column a card's position within its column is stored in — a
     * `col.text()` the board writes fractional order keys to. Without it the
     * order resets on every read.
     */
    orderField?: Order;
}

/**
 * Computes what fills a display slot from the row. May be async.
 *
 * @group Table customization
 */
export type TableDisplayResolver<Row = Record<string, unknown>, R = unknown, USER extends User = User> = {
    /**
     * Given the row, its id and the panel's context, return the slot's value —
     * `undefined` leaves the slot empty.
     */
    resolve(params: { row: Row; id: string; context: RebaseContext<USER> }): R | undefined | Promise<R | undefined>;
}["resolve"];

/**
 * Where each display slot of a record gets its value: a field path, or a
 * resolver.
 *
 * @group Table customization
 */
export interface TableDisplay<Path extends string = string, Row = Record<string, unknown>, USER extends User = User> {
    /** What the record is called: the heading, the row, every chip that points at it. */
    title?: Path | TableDisplayResolver<Row, string, USER>;
    /** The line under the title. */
    subtitle?: Path | TableDisplayResolver<Row, string, USER>;
    /** The record's picture: a storage path or a URL. */
    image?: Path | TableDisplayResolver<Row, string, USER>;
    /** The state chip. */
    status?: Path | TableDisplayResolver<Row, string, USER>;
    /** The timestamp the record is stamped with. */
    date?: Path | TableDisplayResolver<Row, Date | string | number, USER>;
    /** Free chips beside the status. */
    tags?: Path | TableDisplayResolver<Row, string[] | string, USER>;
}

/**
 * A section of the form.
 *
 * @group Table customization
 */
export interface TableFormSection<Id extends string = string> {
    /** Identifies the section; also the `id` of its anchor. */
    key: string;
    /** The heading. None when omitted. */
    title?: string;
    /** The fields in the section, in order. */
    fields: Id[];
    /** Starts collapsed. */
    collapsed?: boolean;
    /** Can be collapsed. */
    collapsible?: boolean;
    /** How the section reads when the record is shown rather than edited. */
    readVariant?: "grid" | "summary";
}

/**
 * How the form is laid out.
 *
 * @group Table customization
 */
export interface TableFormLayout<Id extends string = string> {
    /** The fields pulled out into the rail beside the form. */
    sidebar?: Id[];
    /** The sections of the main column. */
    sections?: TableFormSection<Id>[];
    /** Show the record's id and timestamps in the rail. */
    showRecordMeta?: boolean;
}

/**
 * A component that replaces the generated form.
 *
 * @group Table customization
 */
export interface TableFormView {
    /** The component itself. */
    Builder: ComponentSlot<EntityCustomViewParams>;
    /** Whether the record's bar offers Save and Discard while it is on screen. */
    includeActions?: boolean;
}

/**
 * An extra tab on a record.
 *
 * @group Table customization
 */
export type TableEntityView = Omit<EntityCustomView, "Builder"> & {
    /** The component the tab renders. */
    Builder?: ComponentSlot<EntityCustomViewParams>;
};

/**
 * Another way to render the collection's rows, offered in the view switcher.
 *
 * @group Table customization
 */
export type TableCustomView = Omit<CollectionCustomView, "Builder"> & {
    /** The component that renders the rows. */
    Builder: ComponentSlot<CollectionCustomViewParams>;
};

/**
 * The collection-scoped component overrides, each a component by value.
 *
 * @group Table customization
 */
export type TableComponentOverrides = {
    [K in CollectionComponentName]?: {
        /** The replacement. With `wrap`, it also receives `OriginalComponent`. */
        Component: ComponentSlot<Record<string, unknown>>;
        /** Inject the component it replaces as `OriginalComponent`. */
        wrap?: boolean;
    };
};

/**
 * A computed column of the collection view.
 *
 * @group Table customization
 */
export interface TableAdditionalField<Path extends string = string, USER extends User = User> {
    /** Identifies the column; name it in `fieldOrder` as `"key" as AdditionalFieldKey`. */
    key: string;
    /** The header. */
    name: string;
    /** The width, in pixels. */
    width?: number;
    /** Renders the cell. */
    Builder?(props: AdditionalFieldDelegateProps<Record<string, unknown>, USER>): React.ReactNode;
    /** The fields whose change recomputes the cell. */
    dependencies?: Path | Path[];
    /** The cell's value, for sorting nothing and exporting everything. */
    value?(props: AdditionalFieldDelegateProps<Record<string, unknown>>): string | number | Promise<string | number> | undefined;
}

/**
 * What an entity action's callbacks receive, with `row` typed as the table's
 * row.
 *
 * @group Table customization
 */
export type TableEntityActionProps<Row = Record<string, unknown>, USER extends User = User> =
    Omit<EntityActionClickProps<Record<string, unknown>, USER>, "row"> & {
        /** The record the action runs on, as the server sends it. Absent on a new record's form. */
        row?: Row;
    };

/**
 * An action on a record: a button in its bar, an item in its menu, an icon on
 * its row.
 *
 * @group Table customization
 */
export interface TableEntityAction<Row = Record<string, unknown>, USER extends User = User>
    extends Omit<EntityAction<Record<string, unknown>, USER>, "onClick" | "isEnabled" | "disabledReason"> {
    /** Runs the action. */
    onClick(props: TableEntityActionProps<Row, USER>): Promise<void> | void;
    /** Whether the action applies to this record. */
    isEnabled?(props: TableEntityActionProps<Row, USER>): boolean;
    /** Why it does not, asked only when `isEnabled` returns false. */
    disabledReason?(props: TableEntityActionProps<Row, USER>): string | undefined;
}

// ── The customization ────────────────────────────────────────────────────────

/**
 * What `customizeTable` takes: the deltas over a table's default collection.
 *
 * Every key is optional; a key left out keeps what the projection derived.
 *
 * @group Table customization
 */
export interface TableCustomizationOptions<T extends CustomizableTable | undefined = undefined, USER extends User = User> {

    // Identity and navigation

    /** The plural label: the drawer, the page heading. Derived from the table name when omitted. */
    name?: string;
    /** The label of one record. */
    singularName?: string;
    /** Shown under the collection's heading and on its home card. */
    description?: string;
    /** Opaque data for your own components, merged over the table's `metadata`. */
    metadata?: Record<string, unknown>;
    /** A Lucide icon name (`"FileText"`) or a rendered element. */
    icon?: string | React.ReactNode;
    /** The navigation group. */
    group?: string;
    /** Not listed in the drawer. Still reachable by URL and as a reference target. */
    hideFromNavigation?: boolean;
    /** Not offered as a tab on the records of tables that relate to it. */
    hideFromEntityViews?: boolean;

    // Views

    /** The view a visitor lands on: `"list"`, `"table"`, `"cards"`, `"kanban"` or a custom view's key. */
    defaultViewMode?: ViewMode;
    /** The views offered in the switcher. */
    enabledViews?: ViewMode[];
    /** The kanban board: which column groups it, which column orders it. */
    kanban?: TableKanban<KanbanColumnKey<T>, TextColumnKeyOf<T>>;
    /** More ways to render the rows, by value or by the key of one registered on `<RebaseCMS collectionViews>`. */
    customViews?: (string | TableCustomView)[];
    /** The default row size. */
    defaultSize?: CollectionSize;

    // Columns and slots

    /** The order fields are drawn in. Fields it leaves out follow, so nothing disappears. */
    fieldOrder?: TableColumnId<T>[];
    /** The columns of the list view. */
    listFields?: TableColumnId<T>[];
    /** The fields shown when a record of this table is referenced from another. */
    previewFields?: TableFieldKey<T>[];
    /** What fills a record's title, subtitle, image, status, date and tags. */
    display?: TableDisplay<TableFieldPath<T>, TableRow<T>, USER>;
    /** Computed columns of the collection view. */
    additionalFields?: TableAdditionalField<TableFieldPath<T>, USER>[];
    /** Hide the id column. */
    hideIdFromCollection?: boolean;

    // Query defaults

    /** The default sort. */
    sort?: OrderBySpec<TableFieldPath<T>>;
    /** A filter the visitor cannot change. */
    fixedFilter?: FilterValues<TableFieldPath<T>>;
    /** The filter a visitor starts from. */
    defaultFilter?: FilterValues<TableFieldPath<T>>;
    /** One-click filters in the toolbar. */
    filterPresets?: FilterPreset<TableFieldPath<T>>[];
    /** Load in pages (`true`, or the page size), or everything at once (`false`). */
    pagination?: boolean | number;

    // Behaviour

    /** Edit cells in place in the table. */
    inlineEditing?: boolean;
    /** Rows can be selected. */
    selectionEnabled?: boolean;
    /** A selection held outside the view. */
    selectionController?: SelectionController;
    /** Whether the toolbar offers Export, and extra columns for it. */
    exportable?: boolean | ExportConfig<USER>;
    /** How a record opens. */
    openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";
    /** Whether clicking a record opens it to read or to edit. */
    defaultEntityAction?: "view" | "edit";
    /** The width of the side panel a record opens in. */
    sideDialogWidth?: number | string;
    /** The tab a record opens on. */
    defaultSelectedView?: string | DefaultSelectedViewBuilder;

    // Form

    /** How the form is laid out: sections, and the rail beside it. */
    form?: TableFormLayout<TableColumnId<T>>;
    /** A component that replaces the generated form. */
    formView?: TableFormView;
    /** Save as the visitor types. */
    formAutoSave?: boolean;
    /** Fill declared defaults into a stored record's empty fields when it is opened. */
    alwaysApplyDefaultValues?: boolean;
    /** Add a tab with the record as JSON. */
    includeJsonView?: boolean;
    /** Keep unsaved edits in local storage. */
    localChangesBackup?: "manual_apply" | "auto_apply" | false;
    /** Hide the id from the form. */
    hideIdFromForm?: boolean;

    // Actions, views, overrides

    /** Actions on a record, by value or by the key of one registered on `<RebaseCMS entityActions>`. */
    entityActions?: (string | TableEntityAction<TableRow<T>, USER>)[];
    /** Built-in actions this table does not offer. */
    disableDefaultActions?: ("edit" | "copy" | "delete")[];
    /** Extra tabs on a record, by value or by the key of one registered on `<RebaseCMS entityViews>`. */
    entityViews?: (string | TableEntityView)[];
    /** Components rendered in the collection's toolbar. */
    Actions?: ComponentSlot<CollectionActionsProps>[];
    /** Collection-scoped component overrides. */
    components?: TableComponentOverrides;
    /**
     * Callbacks that run in the panel after the server's hooks. Presentation
     * only: they ship to every visitor and secure nothing.
     */
    browserCallbacks?: CollectionCallbacks<TableRow<T>, USER>;

    // Fields

    /** Per-field customizations, keyed by column or relation. */
    fields?: TableFields<T>;
}

/** The brand of a `customizeTable` result. */
export const TABLE_CUSTOMIZATION_BRAND = "rebase.table-customization";

/**
 * A table's customization: what `customizeTable` returns, and what
 * `<RebaseCMS tableCustomizations>` takes.
 *
 * Frozen. `table` is the slug of the table it applies to.
 *
 * @group Table customization
 */
export type TableCustomization<T extends CustomizableTable | undefined = undefined, USER extends User = User> =
    Readonly<TableCustomizationOptions<T, USER>> & {
        readonly brand: typeof TABLE_CUSTOMIZATION_BRAND;
        /** The slug of the table it applies to. */
        readonly table: TableSlug<T>;
    };

/**
 * Whether a value is the result of `customizeTable`, from this copy of the
 * package or another.
 *
 * @group Table customization
 */
export function isTableCustomization(value: unknown): value is TableCustomization {
    return typeof value === "object" && value !== null && "brand" in value && value.brand === TABLE_CUSTOMIZATION_BRAND;
}

// ── The keys, as data ────────────────────────────────────────────────────────

/** Compiles only when `T` is `never`. */
type AssertNever<T extends never = never> = T;

/**
 * Every key `customizeTable` accepts at the top level, as data: what the
 * runtime validation reads, and what the codemod and the collection editor
 * partition an `admin` block by.
 *
 * @group Table customization
 */
export const TABLE_CUSTOMIZATION_KEYS = [
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
    "description",
    "disableDefaultActions",
    "display",
    "enabledViews",
    "entityActions",
    "entityViews",
    "exportable",
    "fieldOrder",
    "fields",
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
    "listFields",
    "localChangesBackup",
    "metadata",
    "name",
    "openEntityMode",
    "pagination",
    "previewFields",
    "selectionController",
    "selectionEnabled",
    "sideDialogWidth",
    "singularName",
    "sort"
] as const satisfies readonly (keyof TableCustomizationOptions)[];

/** And the reverse: an option declared above that the list does not name fails to compile. */
type _EveryTableOptionIsListed = AssertNever<Exclude<keyof TableCustomizationOptions, typeof TABLE_CUSTOMIZATION_KEYS[number]>>;

/**
 * Every key a field customization accepts, across every column type, as data.
 *
 * @group Table customization
 */
export const FIELD_CUSTOMIZATION_KEYS = [
    "Field",
    "Filter",
    "Preview",
    "canAddElements",
    "clearable",
    "columnWidth",
    "conditions",
    "customProps",
    "description",
    "disabled",
    "dynamicProps",
    "enumLabels",
    "enumOrder",
    "expanded",
    "fieldOrder",
    "fields",
    "filledByServer",
    "filterOperators",
    "fixedFilter",
    "format",
    "hidden",
    "hiddenInForm",
    "includeEntityLink",
    "includeId",
    "keyValue",
    "markdown",
    "metadata",
    "minimalistView",
    "mode",
    "multiline",
    "name",
    "of",
    "oneOf",
    "overrides",
    "previewAsTag",
    "previewFields",
    "propertyConfig",
    "readOnly",
    "referenceTo",
    "renderInForm",
    "sortable",
    "span",
    "spreadChildren",
    "storage",
    "timezone",
    "urlPreview",
    "widget"
] as const satisfies readonly (keyof AnyFieldCustomization)[];

/** The reverse check for fields. */
type _EveryFieldOptionIsListed = AssertNever<Exclude<keyof AnyFieldCustomization, typeof FIELD_CUSTOMIZATION_KEYS[number]>>;

/**
 * The field options that take a React component, by value.
 *
 * @group Table customization
 */
export const FIELD_COMPONENT_KEYS = ["Field", "Preview", "Filter"] as const satisfies readonly (keyof AnyFieldCustomization)[];

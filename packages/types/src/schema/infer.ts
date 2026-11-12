import type { TemporalColumnKind } from "./column_type";
import type { BuilderKind, ColumnBuilder, ColumnFlags, ColumnsShape } from "./columns";
import type { BelongsToDef, RelationsShape } from "./relations";

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type DataOf<C> = C extends ColumnBuilder<infer D, BuilderKind, ColumnFlags> ? D : never;
type KindOf<C> = C extends ColumnBuilder<unknown, infer K, ColumnFlags> ? K : never;
type FlagsOf<C> = C extends ColumnBuilder<unknown, BuilderKind, infer F> ? F : never;

type Exposed<C> = FlagsOf<C>["exposed"] extends false ? false : true;
type Writable<C> = FlagsOf<C>["writable"] extends false ? false : true;
type NotNull<C> = FlagsOf<C>["notNull"] extends true ? true : false;
type HasDefault<C> = FlagsOf<C>["hasDefault"] extends true ? true : false;
type IsPrimaryKey<C> = FlagsOf<C>["primaryKey"] extends true ? true : false;

/** What a client may send for a column: its data, plus a `Date` for a temporal column. */
type WriteValue<C> = KindOf<C> extends TemporalColumnKind ? DataOf<C> | Date : DataOf<C>;

/**
 * A row as it is served, from a table's columns: a `NOT NULL` column is its
 * type, every other column may be `null`, a `.private()` column is absent.
 *
 * @group Schema
 */
export type RowOfColumns<C extends ColumnsShape> = Simplify<{
    [K in keyof C as Exposed<C[K]> extends true ? K : never]:
        NotNull<C[K]> extends true ? DataOf<C[K]> : DataOf<C[K]> | null
}>;

type RequiredInsertKeys<C extends ColumnsShape> = {
    [K in keyof C]: Writable<C[K]> extends true
        ? NotNull<C[K]> extends true
            ? HasDefault<C[K]> extends true ? never : K
            : never
        : never
}[keyof C];

type OptionalInsertKeys<C extends ColumnsShape> = {
    [K in keyof C]: Writable<C[K]> extends true ? (K extends RequiredInsertKeys<C> ? never : K) : never
}[keyof C];

type InsertValue<C> = NotNull<C> extends true ? WriteValue<C> : WriteValue<C> | null;

/**
 * What a create accepts, from a table's columns: a `NOT NULL` column without a
 * default is required, the rest are optional; a generated, read-only or
 * private column is not accepted at all.
 *
 * @group Schema
 */
export type InsertOfColumns<C extends ColumnsShape> = Simplify<
    { [K in RequiredInsertKeys<C>]: InsertValue<C[K]> } &
    { [K in OptionalInsertKeys<C>]?: InsertValue<C[K]> }
>;

/**
 * What an update accepts, from a table's columns: every writable column,
 * optional, the primary key aside.
 *
 * @group Schema
 */
export type UpdateOfColumns<C extends ColumnsShape> = Simplify<{
    [K in keyof C as Writable<C[K]> extends true ? (IsPrimaryKey<C[K]> extends true ? never : K) : never]?: InsertValue<C[K]>
}>;

/** `author_id` → `authorId`, the way a derived foreign key reaches the wire. */
type WireKey<S extends string> = S extends `${infer Head}_${infer Tail}`
    ? `${Head}${Capitalize<WireKey<Tail>>}`
    : S;

/** The key a `belongsTo`'s foreign key is served under. */
type ForeignKeyField<Name extends string, D> =
    D extends { readonly localKey: infer L }
        ? L extends string ? (string extends L ? never : WireKey<L>) : `${Name}Id`
        : `${Name}Id`;

/**
 * The foreign keys relations derive, as optional keys.
 *
 * Best effort: when the foreign-key column is declared in `columns` it is typed
 * there, exactly; a derived one is typed from the relation's `localKey` (or its
 * name) and may be `null`. The generated SDK types are exact.
 */
type DerivedForeignKeys<C extends ColumnsShape, R extends RelationsShape> = {
    [Name in Extract<keyof R, string> as R[Name] extends BelongsToDef
        ? ForeignKeyField<Name, R[Name]> extends keyof C ? never : ForeignKeyField<Name, R[Name]>
        : never]?: string | number | null
};

/** What `InferRow` and its siblings read: a table or a view, structurally. */
interface Schematic<C extends ColumnsShape = ColumnsShape, R extends RelationsShape = RelationsShape> {
    readonly config: { readonly columns: C; readonly relations?: R };
}

/**
 * The row type of a table or view: `InferRow<typeof posts>`.
 *
 * Wire types — a timestamp is an ISO string, a foreign key is the key — which
 * is what REST, the SDK and hooks all see.
 *
 * @group Schema
 */
export type InferRow<T extends Schematic> =
    T extends Schematic<infer C, infer R> ? Simplify<RowOfColumns<C> & DerivedForeignKeys<C, R>> : never;

/**
 * What a create accepts: `InferInsert<typeof posts>`.
 *
 * @group Schema
 */
export type InferInsert<T extends Schematic> =
    T extends Schematic<infer C, infer R> ? Simplify<InsertOfColumns<C> & DerivedForeignKeys<C, R>> : never;

/**
 * What an update accepts: `InferUpdate<typeof posts>`.
 *
 * @group Schema
 */
export type InferUpdate<T extends Schematic> =
    T extends Schematic<infer C, infer R> ? Simplify<UpdateOfColumns<C> & DerivedForeignKeys<C, R>> : never;

/**
 * The column keys of a table or view: `ColumnKeyOf<typeof posts>`.
 *
 * @group Schema
 */
export type ColumnKeyOf<T extends Schematic> = T extends Schematic<infer C> ? Extract<keyof C, string> : never;

/**
 * The relation names of a table or view: `RelationKeyOf<typeof posts>`.
 *
 * @group Schema
 */
export type RelationKeyOf<T extends Schematic> =
    T extends Schematic<ColumnsShape, infer R> ? Extract<keyof R, string> : never;

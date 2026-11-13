import type { TemporalColumnKind } from "./column_type";
import type { BuilderKind, ColumnBuilder, ColumnFlags, ColumnsShape } from "./columns";
import type { BelongsToDef, RelationsShape } from "./relations";
import type { TABLE_BRAND, TableSlugOf, VIEW_BRAND } from "./table";

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

// ── DatabaseOf: the generated `Database`, from `typeof import("./schema")` ──
//
// Read through the builders' phantom members (`$data`, `$kind`, `$flags`) and
// never through `ColumnsShape` / `ColumnBuilder`: relating a column to the
// builder class reaches `.transform()`, whose props carry the call context,
// whose default `Database` is this very type when a project registers
// `Register.tables` — a cycle TypeScript refuses ("circular default").

/** A table or view export of a schema module, by its brand alone. */
interface SchemaTableLike {
    readonly brand: typeof TABLE_BRAND | typeof VIEW_BRAND;
    readonly name: string;
}

/** The table and view exports of a module namespace; anything else (`defaultRls`, helpers) is ignored. */
type TableExportsOf<M> = { [K in keyof M]: M[K] extends SchemaTableLike ? M[K] : never }[keyof M];

type AccessorSeparator = "_" | "-" | " ";
type AccessorWords<S extends string> = S extends `${infer Head}${AccessorSeparator}${infer Tail}` ? [Head, ...AccessorWords<Tail>] : [S];
/** One word of `toPascalCase`: capitalised, a SHOUTING word folded down. */
type PascalWord<W extends string> = W extends "" ? "" : W extends Uppercase<W> ? Capitalize<Lowercase<W>> : Capitalize<W>;
type JoinPascal<T extends string[]> = T extends [infer Head extends string, ...infer Rest extends string[]]
    ? `${PascalWord<Head>}${JoinPascal<Rest>}`
    : "";
type SafeAccessor<S extends string> = S extends `${string}${AccessorSeparator}${string}`
    ? Uncapitalize<JoinPascal<AccessorWords<S>>>
    : Uncapitalize<S>;
/** The names `client.data` never serves as a table (`toTableAccessor` in `@rebasepro/common`). */
type ReservedAccessor = "table" | "then" | "toJSON" | "$$typeof";

/**
 * The property a slug is reachable under on `client.data`, as the type system
 * spells it: `order_items` → `orderItems`, `my-notes` → `myNotes`, a reserved
 * name → `<name>Table`. The same rule codegen applies
 * (`toTableAccessor`), for slugs made of letters, digits, `_`, `-` and
 * spaces.
 *
 * @group Schema
 */
export type TableAccessorOf<S extends string> = string extends S
    ? string
    : SafeAccessor<S> extends ReservedAccessor ? `${SafeAccessor<S>}Table` : SafeAccessor<S>;

type ColumnsOfTable<T> = T extends { readonly config: { readonly columns: infer C } } ? C : never;
type RelationsOfTable<T> = T extends { readonly config: { readonly relations?: infer R } }
    ? ([R] extends [undefined] ? Record<never, never> : NonNullable<R>)
    : Record<never, never>;

type PData<C> = C extends { readonly $data: infer D } ? D : never;
type PKind<C> = C extends { readonly $kind: infer K } ? K : never;
type PFlags<C> = C extends { readonly $flags: infer F } ? F : never;
type PExposed<C> = PFlags<C> extends { exposed: false } ? false : true;
type PWritable<C> = PFlags<C> extends { writable: false } ? false : true;
type PNotNull<C> = PFlags<C> extends { notNull: true } ? true : false;
type PHasDefault<C> = PFlags<C> extends { hasDefault: true } ? true : false;
type PPrimaryKey<C> = PFlags<C> extends { primaryKey: true } ? true : false;
type PWriteValue<C> = PKind<C> extends TemporalColumnKind ? PData<C> | Date : PData<C>;
type PInsertValue<C> = PNotNull<C> extends true ? PWriteValue<C> : PWriteValue<C> | null;

/**
 * The columns of a row as the generated `Row` writes them: a `NOT NULL` column
 * required, a nullable one optional and `| null`.
 */
type SdkRowColumns<C> = Simplify<
    { [K in keyof C as PExposed<C[K]> extends true ? (PNotNull<C[K]> extends true ? K : never) : never]: PData<C[K]> } &
    { [K in keyof C as PExposed<C[K]> extends true ? (PNotNull<C[K]> extends true ? never : K) : never]?: PData<C[K]> | null }
>;
type SdkInsertColumns<C> = Simplify<
    { [K in keyof C as PWritable<C[K]> extends true ? (PNotNull<C[K]> extends true ? (PHasDefault<C[K]> extends true ? never : K) : never) : never]: PInsertValue<C[K]> } &
    { [K in keyof C as PWritable<C[K]> extends true ? (PNotNull<C[K]> extends true ? (PHasDefault<C[K]> extends true ? K : never) : K) : never]?: PInsertValue<C[K]> }
>;
type SdkUpdateColumns<C> = Simplify<{
    [K in keyof C as PWritable<C[K]> extends true ? (PPrimaryKey<C[K]> extends true ? never : K) : never]?: PInsertValue<C[K]>
}>;

/** A key whose target table the type system cannot see: relation thunks are untyped so tables can point at each other. */
type LinkKey = string | number;
/** The loosest correct row of an included relation; the generated SDK types it exactly. */
type IncludedRow = Record<string, unknown>;

type Names<R> = Extract<keyof R, string>;
type BelongsToNames<R> = { [N in Names<R>]: R[N] extends { readonly kind: "belongsTo" } ? N : never }[Names<R>];
type FkKey<R, N extends keyof R & string> = ForeignKeyField<N, R[N]>;
/** A `belongsTo` whose key column is declared in `columns` (under its derived key). */
type DeclaredFk<C, R, N extends keyof R & string> = FkKey<R, N> extends keyof C ? true : false;
type RequiredLink<R, N extends keyof R> = R[N] extends { readonly notNull: true } ? true : false;
type Unconstrained<R, N extends keyof R> = R[N] extends { readonly constraint: false } ? true : false;
/** A link follows its declared key column's closure: hidden with it, unwritable with it. */
type LinkExposed<C, R, N extends keyof R & string> = FkKey<R, N> extends keyof C ? PExposed<C[FkKey<R, N>]> : true;
type LinkWritable<C, R, N extends keyof R & string> = FkKey<R, N> extends keyof C ? PWritable<C[FkKey<R, N>]> : true;
/** The value of a link written by name: the declared key column's type, or any key. */
type LinkValue<C, R, N extends keyof R & string> = FkKey<R, N> extends keyof C ? NonNullable<PData<C[FkKey<R, N>]>> : LinkKey;

/** The relations a read may include: every relation, minus a link whose key column is hidden. */
type IncludableNames<C, R> = {
    [N in Names<R>]: R[N] extends { readonly kind: "belongsTo" } ? (LinkExposed<C, R, N> extends true ? N : never) : N
}[Names<R>];

type PivotOf<D> = D extends { readonly kind: "manyToMany"; readonly pivot?: infer P } ? ([P] extends [undefined] ? Record<never, never> : NonNullable<P>) : Record<never, never>;
/** A junction's payload on a read, as the generated SDK writes it: a nullable column optional. */
type PivotRow<P> = SdkRowColumns<P>;
type PivotWrite<P> = Simplify<{ [K in keyof P as PWritable<P[K]> extends true ? K : never]?: PInsertValue<P[K]> }>;

/** One or many, as the relation's kind says; a `via` whose cardinality the type does not carry is either. */
type IncludedOf<D> =
    D extends { readonly kind: "belongsTo" | "hasOne" } ? IncludedRow :
    D extends { readonly kind: "via"; readonly cardinality: "one" } ? IncludedRow :
    D extends { readonly kind: "via"; readonly cardinality: "many" } ? IncludedRow[] :
    D extends { readonly kind: "via" } ? IncludedRow | IncludedRow[] :
    keyof PivotOf<D> extends never ? IncludedRow[] : Array<IncludedRow & { _pivot?: PivotRow<PivotOf<D>> }>;

/** The foreign keys relations derive (a key column declared in `columns` is typed there). */
type DerivedLinkColumns<C, R, Write extends boolean> = Simplify<
    { [N in BelongsToNames<R> as DeclaredFk<C, R, N> extends true ? never : RequiredLink<R, N> extends true ? (Write extends true ? never : FkKey<R, N>) : never]: LinkKey } &
    { [N in BelongsToNames<R> as DeclaredFk<C, R, N> extends true ? never : RequiredLink<R, N> extends true ? (Write extends true ? FkKey<R, N> : never) : FkKey<R, N>]?: RequiredLink<R, N> extends true ? LinkKey : LinkKey | null }
>;

type RowOfTable<C, R> = Simplify<
    SdkRowColumns<C> &
    DerivedLinkColumns<C, R, false> &
    { [N in IncludableNames<C, R>]?: IncludedOf<R[N]> }
>;

/** The relation-side writes: a link by name, a `hasOne` by the target's key, a to-many membership. */
type RelationWrites<C, R> = Simplify<
    { [N in BelongsToNames<R> as Unconstrained<R, N> extends true ? never : LinkWritable<C, R, N> extends true ? N : never]?:
        RequiredLink<R, N> extends true ? LinkValue<C, R, N> : LinkValue<C, R, N> | null } &
    { [N in Names<R> as R[N] extends { readonly kind: "hasOne" } ? N : never]?: LinkKey | null } &
    { [N in Names<R> as R[N] extends { readonly kind: "hasMany" | "manyToMany" } ? N : never]?:
        Array<LinkKey | (keyof PivotOf<R[N]> extends never ? { id: LinkKey } : { id: LinkKey; _pivot?: PivotWrite<PivotOf<R[N]>> })> }
>;

type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void ? I : never;
/** Boxed, so a relation's two spellings stay one union while the relations are intersected. */
interface SpellingBox<T> { spellings: T }
type Unbox<B> = B extends SpellingBox<infer T> ? T : never;
/** A required derived link is named on a create under either of its names. */
type RequiredLinkSpellings<C, R> = Unbox<UnionToIntersection<{
    [N in BelongsToNames<R>]: DeclaredFk<C, R, N> extends true ? never : RequiredLink<R, N> extends true
        ? SpellingBox<Unconstrained<R, N> extends true ? Record<FkKey<R, N>, LinkKey> : Record<FkKey<R, N>, LinkKey> | Record<N, LinkKey>>
        : never
}[BelongsToNames<R>]>>;

type InsertOfTable<C, R> =
    Simplify<SdkInsertColumns<C> & DerivedLinkColumns<C, R, true> & RelationWrites<C, R>> &
    ([RequiredLinkSpellings<C, R>] extends [never] ? unknown : RequiredLinkSpellings<C, R>);

type UpdateOfTable<C, R> = Simplify<
    SdkUpdateColumns<C> &
    { [N in BelongsToNames<R> as DeclaredFk<C, R, N> extends true ? never : FkKey<R, N>]?: RequiredLink<R, N> extends true ? LinkKey : LinkKey | null } &
    RelationWrites<C, R>
>;

type RelationsMapOf<C, R> =
    [IncludableNames<C, R>] extends [never] ? Record<never, never> : { [N in IncludableNames<C, R>]: string };

/** One table's entry, shaped as the generated `Database`'s. */
type TableEntryOf<T> = T extends SchemaTableLike ? {
    Row: RowOfTable<ColumnsOfTable<T>, RelationsOfTable<T>>;
    Insert: T extends { readonly brand: typeof VIEW_BRAND } ? never : InsertOfTable<ColumnsOfTable<T>, RelationsOfTable<T>>;
    Update: T extends { readonly brand: typeof VIEW_BRAND } ? never : UpdateOfTable<ColumnsOfTable<T>, RelationsOfTable<T>>;
    Relations: RelationsMapOf<ColumnsOfTable<T>, RelationsOfTable<T>>;
    Slug: TableSlugOf<T>;
} : never;

/**
 * The typed `Database` of a schema module, with no codegen run:
 * `DatabaseOf<typeof import("./backend/schema")>`.
 *
 * The same shape `rebase generate-sdk` emits — per table, under its accessor
 * (`orderItems` for `order_items`): `Row`, `Insert`, `Update`, `Relations` and
 * `Slug` — as far as the type system can know it. Every export of the module
 * that is a `defineTable` / `defineAuthTable` / `defineView` result is a
 * table; the rest (`defaultRls`, helpers) is ignored.
 *
 * Exact: every declared column — nullability, `.private()`, `.readOnly()`,
 * `.generatedAlwaysAs()`, defaults and stamps (optional on create), enums and
 * `.oneOf()` unions, `col.jsonb().$type<T>()` documents, temporal columns writable as
 * a `Date` — the slug, the view's missing writes, the relation names and their
 * cardinality, a junction's `_pivot`, a link hidden or read-only with its key
 * column, and a required derived link written by either name.
 *
 * Loose, because a relation's target is behind an untyped thunk (so tables
 * can point at each other): a derived foreign key is `string | number`, an
 * included row is `Record<string, unknown>`, `Relations` names the relations
 * but not the table each reaches (so a nested `include` is unchecked), a
 * `via`'s cardinality is either unless the type carries it, and a `via` is not
 * offered as a write. A key column bound with `.column("author_id")` under a
 * key other than the derived one (`authorId`) is not recognised as the link's.
 * The generated SDK is the exact source for all of these.
 *
 * Register it once instead of a generated `Database`:
 *
 * ```ts
 * declare module "@rebasepro/types" {
 *     interface Register { tables: typeof import("./backend/schema") }
 * }
 * ```
 *
 * @group Schema
 */
export type DatabaseOf<M> = {
    [T in TableExportsOf<M> as TableAccessorOf<TableSlugOf<T>>]: TableEntryOf<T>
};

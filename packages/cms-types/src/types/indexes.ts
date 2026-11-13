/**
 * Ordinary indexes, declared on a collection.
 *
 * Distinct from the two index-shaped things Rebase already builds. A `search`
 * block builds a GIN index over a generated `tsvector`, and a `vector`
 * property builds an ANN index over an embedding; both are structures the
 * *feature* owns and neither is a query the developer wrote. This is the plain
 * case — the btree behind a `where` clause — which had no declaration site at
 * all, so the only way to have one was to write it by hand, where the next
 * `rebase db push` planned it away.
 *
 * Every form here is core Postgres, deliberately. See {@link CollectionIndex}.
 */

/**
 * A key column of an index whose access method has no ordering.
 *
 * `gin` and `brin` reject `ASC`/`DESC`/`NULLS` outright — Postgres answers
 * `access method "gin" does not support ASC/DESC options` — so those methods
 * take this narrower shape and the combination is unrepresentable rather than
 * refused at build time.
 */
export interface UnorderedIndexKey<Keys extends string = string> {
    /**
     * A property key on this collection — never a column name.
     *
     * Which column that resolves to depends on the property, and the two
     * differ in exactly the case an index is most often wanted for: a
     * `belongsTo` relation compiles to its resolved `localKey`
     * (`primaryCategory` → `primary_category_id`), not to the snake-cased
     * property key. Anything else resolves through `columnName`, or the
     * snake-case default when it declares none.
     *
     * Writing the column name here would work for most properties and quietly
     * index nothing for a foreign key, which is the one people reach for.
     */
    prop: Keys | (string & {});
}

/**
 * A key column of an index, when its order matters.
 *
 * `direction` and `nulls` earn their place only when a query's `ORDER BY`
 * mixes directions. A lone `DESC` index is redundant with its `ASC` twin —
 * Postgres scans a btree backwards just as fast — and declaring both is
 * refused.
 *
 * Writing the Postgres default down explicitly is free: the derived name
 * hashes the *effective* order, so adding `direction: "asc"` to a column that
 * was already ascending is not a redefinition and rebuilds nothing.
 */
export interface IndexKey<Keys extends string = string> extends UnorderedIndexKey<Keys> {
    direction?: "asc" | "desc";
    /** Postgres's own default: `last` under `asc`, `first` under `desc`. */
    nulls?: "first" | "last";
}

/**
 * The rows a partial index covers.
 *
 * Structure rather than a SQL string, and this is the most load-bearing choice
 * in the type. A string would be replayed verbatim by Atlas in a scratch
 * database, would be the one place a caller reaches for an extension operator
 * class or a subquery, could not be checked against the collection's
 * properties, and could not be fingerprinted — its own text would have to go
 * into the derived name, so reformatting it would rename a live index.
 *
 * Structure keeps every reference resolvable at build time, keeps literals
 * going through the same quoting as the rest of the DDL, and keeps the name
 * stable under any rendering change.
 *
 * There is no `or`. An OR predicate almost always means the index should not
 * be partial at all; a caller who genuinely needs one declares two indexes.
 */
export type IndexPredicate<Keys extends string = string> =
    | { prop: Keys | (string & {}); op: "="; value: string | number | boolean }
    | { prop: Keys | (string & {}); op: "!=" | "<" | "<=" | ">" | ">="; value: string | number }
    | { prop: Keys | (string & {}); op: "is null" | "is not null" }
    /**
     * A non-empty list, enforced in the type. An empty `IN` is a predicate
     * matching nothing: it builds an index over zero rows and reports success,
     * which is the silent-empty-condition shape this codebase has been bitten
     * by before.
     */
    | { prop: Keys | (string & {}); op: "in"; value: readonly [string | number, ...(string | number)[]] }
    | { and: readonly [IndexPredicate<Keys>, ...IndexPredicate<Keys>[]] };

interface BaseCollectionIndex<Keys extends string = string> {
    /**
     * The key columns, in order. This *is* the index's identity.
     *
     * Postgres can only use a leading subset, so `["ownerId", "createdAt"]`
     * serves a query filtering on `ownerId`, and one filtering on both, and
     * never one filtering on `createdAt` alone.
     *
     * Capped at five keys. Postgres allows thirty-two; past four the trailing
     * columns are dead weight on every write, and the declaration is usually
     * someone hoping a query gets faster by accretion. Payload columns that
     * are not searched belong in `include`, which does not count against this.
     */
    on: readonly [Keys | IndexKey<Keys>, ...(Keys | IndexKey<Keys>)[]];

    where?: IndexPredicate<Keys>;

    /**
     * Why this index exists, in one line. Required, and the only required
     * field carrying no SQL.
     *
     * An index is the only thing a Rebase config can declare that costs money
     * forever and whose benefit is invisible from the config. `rebase doctor`
     * prints this beside "0 scans in 34 days, 412 MB", which is the one moment
     * anyone is in a position to decide whether to delete it. Without it
     * nobody can decide, so nobody does, and the table accretes indexes for
     * the life of the product.
     */
    reason: string;
}

/**
 * The default. Answers equality, range, `ORDER BY`, and uniqueness.
 */
export interface BtreeIndex<Keys extends string = string> extends BaseCollectionIndex<Keys> {
    using?: "btree";

    /**
     * A composite uniqueness guarantee.
     *
     * Single-column uniqueness is `validation.unique` on the property, and
     * declaring it here is refused rather than accepted as a synonym.
     * `validation.unique` compiles to an inline `UNIQUE` whose backing index
     * Postgres — not Rebase — names `<table>_<column>_key`. That name is in
     * every deployed database, appears in no contract file, and no release can
     * reach in and rename it.
     */
    unique?: boolean;

    /**
     * Payload columns carried in the leaf pages, for index-only scans. Not
     * searchable and not ordered — they save a heap fetch at the cost of a
     * fatter index. May not overlap `on`.
     */
    include?: readonly (Keys | (string & {}))[];
}

/**
 * Containment over an `array` property or a JSONB `map`, using core operator
 * classes only. Trigram and full-text search are `search:`, not this.
 */
export interface GinIndex<Keys extends string = string> extends BaseCollectionIndex<Keys> {
    using: "gin";
    on: readonly [Keys | UnorderedIndexKey<Keys>, ...(Keys | UnorderedIndexKey<Keys>)[]];
}

/**
 * A naturally-ordered column on an append-only table — tiny, and useless the
 * moment rows arrive out of order.
 */
export interface BrinIndex<Keys extends string = string> extends BaseCollectionIndex<Keys> {
    using: "brin";
    on: readonly [Keys | UnorderedIndexKey<Keys>, ...(Keys | UnorderedIndexKey<Keys>)[]];
}

/**
 * An index on a collection's table.
 *
 * No `gist` and no `hash`: every interesting gist operator class ships in an
 * extension, and hash indexes cannot be unique, composite, or ordered.
 *
 * The restriction to core Postgres is not conservatism, it is what keeps the
 * whole model on the Atlas path. `rebase db push` materialises the desired
 * state in a bare scratch database to plan against, `--exclude` does not
 * suppress that replay, and `CREATE EXTENSION` cannot be put in the file — so
 * an index needing `gin_trgm_ops` or `vector_cosine_ops` is refused at build
 * time rather than emitted to fail later against a database the author has
 * never heard of. Trigram search is `search:`; ANN is a `vector` property.
 */
export type CollectionIndex<Keys extends string = string> =
    | BtreeIndex<Keys>
    | GinIndex<Keys>
    | BrinIndex<Keys>;

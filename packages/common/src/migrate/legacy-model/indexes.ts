/**
 * The pre-0.31 collection indexes, frozen at 0.30 — part of the migration's
 * input format (see `./index.ts`). Nothing at runtime may import it.
 */

/**
 * An index key with no ordering (GIN, BRIN).
 *
 * @group Migration
 */
export interface LegacyUnorderedIndexKey<Keys extends string = string> {
    prop: Keys | (string & {});
}

/**
 * A b-tree index key.
 *
 * @group Migration
 */
export interface LegacyIndexKey<Keys extends string = string> extends LegacyUnorderedIndexKey<Keys> {
    direction?: "asc" | "desc";
    nulls?: "first" | "last";
}

/**
 * A partial index's predicate.
 *
 * @group Migration
 */
export type LegacyIndexPredicate<Keys extends string = string> =
    | { prop: Keys | (string & {}); op: "="; value: string | number | boolean }
    | { prop: Keys | (string & {}); op: "!=" | "<" | "<=" | ">" | ">="; value: string | number }
    | { prop: Keys | (string & {}); op: "is null" | "is not null" }
    | { prop: Keys | (string & {}); op: "in"; value: readonly [string | number, ...(string | number)[]] }
    | { and: readonly [LegacyIndexPredicate<Keys>, ...LegacyIndexPredicate<Keys>[]] };

interface LegacyBaseCollectionIndex<Keys extends string = string> {
    on: readonly [Keys | LegacyIndexKey<Keys>, ...(Keys | LegacyIndexKey<Keys>)[]];
    where?: LegacyIndexPredicate<Keys>;
    /** Why the index exists. */
    reason: string;
}

/**
 * A b-tree index.
 *
 * @group Migration
 */
export interface LegacyBtreeIndex<Keys extends string = string> extends LegacyBaseCollectionIndex<Keys> {
    using?: "btree";
    unique?: boolean;
    include?: readonly (Keys | (string & {}))[];
}

/**
 * A GIN index.
 *
 * @group Migration
 */
export interface LegacyGinIndex<Keys extends string = string> extends LegacyBaseCollectionIndex<Keys> {
    using: "gin";
    on: readonly [Keys | LegacyUnorderedIndexKey<Keys>, ...(Keys | LegacyUnorderedIndexKey<Keys>)[]];
}

/**
 * A BRIN index.
 *
 * @group Migration
 */
export interface LegacyBrinIndex<Keys extends string = string> extends LegacyBaseCollectionIndex<Keys> {
    using: "brin";
    on: readonly [Keys | LegacyUnorderedIndexKey<Keys>, ...(Keys | LegacyUnorderedIndexKey<Keys>)[]];
}

/**
 * A legacy collection index.
 *
 * @group Migration
 */
export type LegacyCollectionIndex<Keys extends string = string> =
    | LegacyBtreeIndex<Keys>
    | LegacyGinIndex<Keys>
    | LegacyBrinIndex<Keys>;

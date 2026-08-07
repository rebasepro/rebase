/**
 * Opt-in full-text search configuration.
 *
 * ## Why this is opt-in
 *
 * Without a `search` block, `.search()` behaves exactly as it always has: an
 * `ILIKE '%term%'` OR-ed across the collection's top-level, non-enum `string`
 * properties. That default is unchanged and will stay unchanged — declaring
 * this block is the only way to get anything else.
 *
 * The default has three limits that no amount of tuning inside it can fix:
 * it cannot reach inside `map` (JSONB) or `array` properties, it has no notion
 * of relevance, and a leading `%` means it can never use an index. Collections
 * that outgrow those limits declare what they want searched; collections that
 * have not are left completely alone.
 *
 * ## What declaring it does
 *
 * One `tsvector` column, `GENERATED ALWAYS AS … STORED`, plus one GIN index on
 * it. Postgres recomputes the column on every write of a source field, so it
 * cannot drift from the row, and refuses any attempt to write it directly.
 * `.search()` then compiles to `@@ websearch_to_tsquery(…)` against that
 * column, which stems, drops stopwords, AND-es the terms, and ranks.
 *
 * These are stated consequences, not hidden ones: the column and the index
 * appear in generated DDL, in `schema.generated.ts`, and in `rebase db push`
 * output like any other declared object.
 *
 * @example
 * ```ts
 * const talents: PostgresCollectionConfig = {
 *     slug: "talents",
 *     table: "talents",
 *     properties: { … },
 *     search: {
 *         language: "spanish",
 *         unaccent: true,
 *         fields: [
 *             { path: "full_name", weight: "A" },
 *             "location",
 *             "questionnaire.certifications"   // into the JSONB
 *         ]
 *     }
 * };
 * ```
 *
 * @group Search
 */
export interface SearchConfig {
    /**
     * The fields to index, in the author's own words. Nothing is inferred: a
     * field is searched if and only if it is named here.
     *
     * A bare string is shorthand for `{ path, weight: "B" }`.
     *
     * A path may address:
     * - a top-level `string` property — `"full_name"`
     * - a `string[]` property — `"tags"` (every element is indexed)
     * - a path into a `map` property — `"questionnaire.certifications"`,
     *   which indexes every string found at or below that point, including
     *   nested objects and arrays of strings. JSON *keys* are never indexed,
     *   only values.
     *
     * A path that does not resolve to one of those is a boot-time error, not
     * a silent omission — a search field you believe is live and is not is the
     * failure this whole block exists to prevent.
     */
    fields: readonly (string | SearchField)[];

    /**
     * The Postgres text search configuration, which decides stemming and
     * stopwords. `"spanish"` stems `auditores` to `auditor` and drops `de`;
     * `"simple"` does neither.
     *
     * Defaults to `"simple"`, which is the only choice that is never wrong:
     * a stemmer applied to the wrong language silently mangles lexemes. Set it
     * to your content's language to get stemming.
     *
     * @default "simple"
     */
    language?: string;

    /**
     * Fold accents before indexing, so `auditoria` matches `auditoría`.
     *
     * This is not cosmetic in accented languages. Postgres stems the two
     * spellings to *different* lexemes — `to_tsvector('spanish', 'auditoría')`
     * yields `auditor` while `'auditoria'` yields `auditori` — so without this
     * a query typed without accents misses the rows that carry them, which is
     * most queries most users type.
     *
     * Requires the `unaccent` extension. Boot fails with an explicit message if
     * it is not installed and cannot be created, rather than quietly indexing
     * accented text as-is.
     *
     * @default false
     */
    unaccent?: boolean;

    /**
     * Name of the generated column holding the `tsvector`.
     *
     * Only change this if `search_vector` collides with a column you already
     * have. It is part of your schema once created: renaming it later is a
     * column drop and recreate, which rewrites the table.
     *
     * @default "search_vector"
     */
    column?: string;

    /**
     * Also match on trigram similarity, so near-misses and typos still rank —
     * `iso14000` reaching `ISO 14001`, which no amount of stemming will do
     * because they are simply different lexemes.
     *
     * Adds a second generated `text` column and a GIN trigram index alongside
     * the `tsvector`, and requires the `pg_trgm` extension. Costs write time
     * and disk; buys the single most common class of failed search.
     *
     * Also changes what `_score` means: the trigram similarity is added to
     * `ts_rank`. It has to be. A typo matches nothing on the exact path, so
     * every row this finds has a `ts_rank` of zero — ranking by that alone
     * would order the results arbitrarily, which is the failure `fuzzy` exists
     * to fix.
     *
     * @default false
     */
    fuzzy?: boolean;

    /**
     * Similarity floor for {@link SearchConfig.fuzzy}, between 0 and 1. A row
     * whose trigram similarity to the query falls below this never matches on
     * the fuzzy path (it can still match on the exact one).
     *
     * Lower admits more typos and more noise. Ignored unless `fuzzy` is set.
     *
     * @default 0.3
     */
    fuzzyThreshold?: number;
}

/**
 * One indexed field, with the weight it carries in the ranking.
 *
 * @group Search
 */
export interface SearchField {
    /**
     * Property name, or dotted path into a `map` property.
     * @see SearchConfig.fields
     */
    path: string;

    /**
     * Postgres weight class. `ts_rank` scores an `A` hit far above a `D` hit,
     * which is how a name outranks a passing mention in a long description.
     *
     * The four classes are Postgres's own and there are exactly four.
     *
     * @default "B"
     */
    weight?: SearchWeight;
}

/**
 * Postgres tsvector weight classes, strongest to weakest.
 *
 * @group Search
 */
export type SearchWeight = "A" | "B" | "C" | "D";

/** The column name used when {@link SearchConfig.column} is not given. */
export const DEFAULT_SEARCH_COLUMN = "search_vector";

/** The text search configuration used when {@link SearchConfig.language} is not given. */
export const DEFAULT_SEARCH_LANGUAGE = "simple";

/** The weight a field carries when it does not name one. */
export const DEFAULT_SEARCH_WEIGHT: SearchWeight = "B";

/** The similarity floor used when {@link SearchConfig.fuzzyThreshold} is not given. */
export const DEFAULT_FUZZY_THRESHOLD = 0.3;

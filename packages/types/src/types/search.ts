/**
 * Opt-in full-text search configuration.
 *
 * ## Why this is opt-in
 *
 * Without a `search` block, `.search()` is `ILIKE '%term%'` per whitespace-
 * separated term, OR-ed across the collection's top-level, non-enum `string`
 * properties and AND-ed across the terms — so two typed words may be found in
 * two different columns, as they are here. Declaring this block is the only way
 * to get anything more than that.
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
     * How a search string is matched against the indexed fields.
     *
     * - `"fts"` (default) — one `@@ websearch_to_tsquery` against the generated
     *   `tsvector`. Stems, drops stopwords, reaches inside JSONB and arrays,
     *   uses the GIN index, and ranks. It matches **whole lexemes**, so `seb`
     *   does not find `sebastian` and `audit` does not find `Auditor`.
     * - `"hybrid"` — that predicate `OR` a substring match over the same
     *   declared fields, with accents folded on both sides. So one collection
     *   gets accent folding *and* substring/prefix matching, which is what a
     *   search box is: measured on five rows in `search-mode-matrix.test.ts`,
     *   `munoz` finds `Sebastian Munoz`, `seb` finds both Sebastians, `audit`
     *   finds the `ISO 14001 Lead Auditor`, and `iso 14001` does **not** drag
     *   in the `ISO 9001` row the way a loose `fuzzy` threshold does.
     *
     * ### Why this is a mode rather than the default
     *
     * The substring half cannot use the GIN index — a leading `%` never can —
     * so it is a scan over the declared fields' text, evaluated per row. The
     * `@@` half still runs first and still uses the index; what the mode costs
     * is the rows the index rejected, which the planner has to look at anyway
     * to apply the `OR`. On a large table that is the difference between an
     * index scan and a sequential one, and that is the author's call to make
     * rather than this default's.
     *
     * ### Changing this on a live collection
     *
     * Safe, and deliberately so. `mode` is **query-side only**: it changes no
     * generated column, no generation expression and no index, so it does not
     * trip the boot-time refusal a changed `search` block otherwise gets
     * (`searchDriftMessage` — rebuilding a STORED generated column rewrites the
     * table under an ACCESS EXCLUSIVE lock). Turning `"hybrid"` on for a
     * collection whose column already exists takes a deploy and nothing else.
     *
     * The accent folding on the substring half is likewise query-side and
     * unconditional under `"hybrid"` — it does **not** require
     * {@link SearchConfig.unaccent}, which is what makes the switch free. What
     * `unaccent` still buys is folding on the `@@` half, where the lexemes are
     * stored, and that one *is* a column rebuild.
     *
     * It does add the `unaccent` extension and one IMMUTABLE helper function to
     * the database if they are not there already. Both are `IF NOT EXISTS` /
     * `CREATE OR REPLACE`, so both are additive and idempotent.
     *
     * @default "fts"
     */
    mode?: SearchMode;

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
 * How {@link SearchConfig.mode} matches a search string.
 *
 * @group Search
 */
export type SearchMode = "fts" | "hybrid";

/**
 * Postgres tsvector weight classes, strongest to weakest.
 *
 * @group Search
 */
export type SearchWeight = "A" | "B" | "C" | "D";

/** The column name used when {@link SearchConfig.column} is not given. */
export const DEFAULT_SEARCH_COLUMN = "search_vector";

/** The matching strategy used when {@link SearchConfig.mode} is not given. */
export const DEFAULT_SEARCH_MODE: SearchMode = "fts";

/** The text search configuration used when {@link SearchConfig.language} is not given. */
export const DEFAULT_SEARCH_LANGUAGE = "simple";

/** The weight a field carries when it does not name one. */
export const DEFAULT_SEARCH_WEIGHT: SearchWeight = "B";

/** The similarity floor used when {@link SearchConfig.fuzzyThreshold} is not given. */
export const DEFAULT_FUZZY_THRESHOLD = 0.3;

/**
 * Sort keys a query computes rather than reads from a column.
 *
 * `orderBy` is otherwise typed against the row — `keyof M` — which is exactly
 * right for a column and exactly wrong for relevance: `_score` is produced by
 * the query, so it appears in no generated row type and a project with a
 * generated SDK could not name it. The runtime accepted it, the docs told
 * people to use it, and the types rejected it.
 *
 * Kept as a named union rather than a loose `string` so the other half of the
 * guarantee survives: a typo'd column is still a compile error, and remains a
 * 400 at runtime rather than a silently unsorted list.
 *
 * `_distance` is deliberately not here. A vector search orders by distance on
 * its own and overrides `orderBy` outright, so naming it would imply a choice
 * the caller does not have.
 *
 * @group Search
 */
export type ComputedSortField = typeof RELEVANCE_SORT_FIELD;

/**
 * The relevance sort key. Valid only on a collection that declares a
 * {@link SearchConfig} *and* on a query that carries a search string; anywhere
 * else it is an unknown field and the request is refused.
 */
export const RELEVANCE_SORT_FIELD = "_score";

/**
 * One field that matched, and the text around the hit.
 *
 * Returned per row as `_matches` when a query asks for it — see the `explain`
 * option on `.search()`. Answers the question a ranked list otherwise leaves
 * open: *why is this row here?* A candidate surfacing for "iso 14001" because
 * of a certification is a different result from one surfacing because the
 * string appears in a paragraph about something else, and the score alone
 * cannot tell them apart.
 *
 * @group Search
 */
export interface SearchMatch {
    /**
     * The declared field path that matched, exactly as written in
     * {@link SearchConfig.fields} — e.g. `"questionnaire.certifications"`.
     * Map it to a label for display; the path is stable, a label is yours.
     */
    field: string;

    /**
     * The matching text, with each hit wrapped in `<mark>…</mark>`.
     *
     * Built by Postgres's `ts_headline` over the same normalized text that was
     * indexed. With {@link SearchConfig.unaccent} on that means the snippet
     * reads with accents folded — `Auditoria` rather than `Auditoría`. That is
     * deliberate: `ts_headline` over the *original* text cannot find a hit the
     * unaccented query produced, so it returns the text with nothing marked at
     * all. A readable snippet that highlights beats a prettier one that
     * silently does not.
     *
     * Contains markup by construction. Render it as HTML or strip the tags —
     * do not display it raw, and do not trust it as plain text.
     */
    snippet: string;
}

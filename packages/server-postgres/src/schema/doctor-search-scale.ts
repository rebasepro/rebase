/**
 * `rebase doctor`: collections searched by a full scan of a large table.
 *
 * Without a `search` block, a search — the admin's search box, `?searchString=`,
 * `.search()` — is `ILIKE '%term%'` over every text column. A leading `%`
 * defeats a B-tree, so each one reads the whole table: on 100k posts a search
 * took 326 ms, half for the page and half for its count. Nothing reports it;
 * the box just gets slower as the table grows. This names the collections
 * where that has started to matter, and points at the block that fixes it.
 *
 * A hint, not a failure: it never changes doctor's exit code, and the database
 * is not changed — Rebase does not add a search index on its own.
 *
 * Lives beside `doctor-cli.ts` rather than inside it because that file runs
 * `main()` on import.
 */
import path from "path";
import chalk from "chalk";
import { getTableName, relationalCollections } from "@rebasepro/common";
import { isPostgresCollectionConfig, type CollectionConfig } from "@rebasepro/types";
import { loadCollections } from "./doctor";
import { buildSearchColumnSpec } from "./search-column";

/** Above this many rows an unindexed search is worth a word. */
export const UNINDEXED_SEARCH_ROWS = 10_000;

/** A collection whose search would be `ILIKE` over these fields. */
export interface IlikeSearchedCollection {
    slug: string;
    schema: string;
    table: string;
    /** The string properties the search reads. */
    fields: string[];
}

/**
 * The collections a search reaches without an index: no `search` block (or
 * one that does not build), and at least one property the default search
 * reads — a `string`, not an enum, not a uuid key (the rule in
 * `DrizzleConditionBuilder.buildSearchConditions`).
 */
export function ilikeSearchedCollections(collections: CollectionConfig[]): IlikeSearchedCollection[] {
    const found: IlikeSearchedCollection[] = [];
    for (const collection of relationalCollections(collections)) {
        if (!isPostgresCollectionConfig(collection)) continue;
        let indexed: boolean;
        try {
            indexed = buildSearchColumnSpec(collection) !== undefined;
        } catch {
            // A block that does not build is reported by the boot; the search
            // falls back to ILIKE meanwhile, so it counts as none here.
            indexed = false;
        }
        if (indexed) continue;
        const fields = Object.entries(collection.properties ?? {})
            .filter(([, property]) => property.type === "string" && !property.enum && property.isId !== "uuid")
            .map(([key]) => key);
        const table = getTableName(collection);
        if (fields.length === 0 || !table) continue;
        found.push({ slug: collection.slug, schema: collection.schema ?? "public", table, fields });
    }
    return found;
}

/** Those of `candidates` whose table holds more than `threshold` rows, by estimate. */
export function unindexedSearchFindings(
    candidates: IlikeSearchedCollection[],
    rowEstimates: ReadonlyMap<string, number>,
    threshold: number = UNINDEXED_SEARCH_ROWS
): (IlikeSearchedCollection & { rows: number })[] {
    return candidates
        .map(candidate => ({ ...candidate, rows: rowEstimates.get(`${candidate.schema}.${candidate.table}`) ?? 0 }))
        .filter(candidate => candidate.rows > threshold);
}

/**
 * Row counts by `schema.table`, estimated — `pg_class.reltuples`, or the
 * statistics collector's live-tuple count when the table was never analysed.
 * Nothing is scanned: counting the tables this is about would be the cost it
 * warns of.
 */
export async function estimateRowCounts(
    query: (text: string, values: unknown[]) => Promise<{ rows: { schema: string; table: string; rows: string | number }[] }>,
    schemas: string[]
): Promise<Map<string, number>> {
    const { rows } = await query(
        `SELECT n.nspname AS schema, c.relname AS table,
                GREATEST(c.reltuples, COALESCE(s.n_live_tup, 0), 0)::bigint AS rows
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
         WHERE c.relkind IN ('r', 'p') AND n.nspname = ANY($1)`,
        [schemas]
    );
    return new Map(rows.map(row => [`${row.schema}.${row.table}`, Number(row.rows)]));
}

/** The report, one warning per collection. */
export function formatUnindexedSearches(findings: (IlikeSearchedCollection & { rows: number })[]): string[] {
    if (findings.length === 0) return [];
    const lines = ["", chalk.yellow(`  ⚠ ${findings.length} collection(s) searched by reading the whole table:`)];
    for (const finding of findings) {
        lines.push(chalk.yellow(
            `     • ${finding.slug} — about ${finding.rows.toLocaleString("en-US")} rows, no \`search\` block: a search is ` +
            `ILIKE '%term%' over ${finding.fields.join(", ")}`
        ));
    }
    lines.push(chalk.gray(
        "    Each search reads every row, and its count reads them again. A `search` block indexes it\n" +
        "    (full-text, or `mode: \"hybrid\"` for substrings too): https://rebase.pro/docs/backend/search"
    ));
    return lines;
}

/**
 * Print the warning for the project at `collectionsPath`, against
 * `databaseUrl`. Never throws and never fails the run: it is a hint, and a
 * check that could not run says so in one grey line.
 */
export async function runSearchScaleCheck(collectionsPath: string, databaseUrl?: string): Promise<void> {
    if (!databaseUrl) return;
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    try {
        const collections = await loadCollections(path.resolve(process.cwd(), collectionsPath));
        const candidates = ilikeSearchedCollections(collections);
        if (candidates.length === 0) return;
        await client.connect();
        const estimates = await estimateRowCounts(
            (text, values) => client.query(text, values),
            [...new Set(candidates.map(candidate => candidate.schema))]
        );
        for (const line of formatUnindexedSearches(unindexedSearchFindings(candidates, estimates))) console.log(line);
    } catch (err) {
        console.log(chalk.gray(`  ⏭ Search on large tables: not checked (${err instanceof Error ? err.message : String(err)})`));
    } finally {
        await client.end().catch(() => undefined);
    }
}

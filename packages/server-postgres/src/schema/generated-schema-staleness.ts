import { CollectionConfig } from "@rebasepro/types";
import { getTableName, resolveCollectionRelations, relationalCollections } from "@rebasepro/common";
import { generateForeignKeyName, legacyForeignKeyName } from "@rebasepro/utils";

/**
 * Notice a generated Drizzle schema that a *library upgrade* invalidated.
 *
 * `rebase dev` already watches `config/collections` and warns when a collection
 * file changes. That covers drift the developer caused. It cannot cover this one,
 * because nothing the developer owns changed: 0.13 derives `category_id` where
 * 0.12 derived `categorie_id`, from the same unedited collection. The watcher
 * never fires, and `backend/src/schema.generated.ts` quietly stops describing the
 * schema the runtime expects.
 *
 * The consequence is not cosmetic. Boot-ensure renames the column in the
 * database, then relation validation reads the stale module and refuses to
 * start — on that boot and every boot after it, because the rename is already
 * applied and will not be attempted again.
 *
 * Deliberately narrow: this answers "does the generated schema name a foreign key
 * the way the previous rule did", not "is this file what we would generate now".
 * The wide question would report every whitespace change in the generator as a
 * fatal staleness, and a check that cries wolf gets switched off.
 */

/** One column the generated schema names under the pre-0.13 rule. */
export interface LegacyForeignKeyName {
    /** Table whose column declaration is stale. */
    table: string;
    /** The name the generated schema declares. */
    legacy: string;
    /** The name this release derives, and which the database now carries. */
    current: string;
    /** `<collection>.<relation>` that derives it, for the message. */
    relation: string;
}

/**
 * The slice of the generated source declaring one table.
 *
 * Scoping matters: two junctions in one file can carry columns of the same name,
 * and a whole-file match would attribute a stale column to whichever table the
 * reader looks at first. Returns "" when the table is not in the file at all,
 * which is not staleness — it is a table the generator has not been asked about.
 */
function tableBlock(source: string, table: string): string {
    // Both forms the generator emits. A collection with `schema: "rebase"` — the
    // auth users collection, in every scaffold — is written as
    // `rebaseSchema.table("users", …)`, so matching only `pgTable(` made this
    // blind to every table outside `public`: the block came back empty, and an
    // empty block reads as "a table the generator has not been asked about".
    // The rename check therefore never inspected them.
    const literal = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const start = source.search(new RegExp(`(?:pgTable|\\.table)\\(\\s*["']${literal}["']`));
    if (start === -1) return "";
    // Generated files put every table in its own `export const`, so the next one
    // is the end of this block. No brace counting, nothing to get wrong.
    const next = source.indexOf("\nexport ", start);
    return next === -1 ? source.slice(start) : source.slice(start, next);
}

/**
 * Whether a block *declares* the column, rather than merely mentioning it.
 *
 * A comment explaining the rename, or a policy expression naming the old column,
 * must not read as a declaration — otherwise regenerating the file would not
 * clear the finding and the check would be permanently red.
 */
function declaresColumn(block: string, column: string): boolean {
    // `categorieId: integer("categorie_id")` — the Drizzle column shape. Only
    // the string argument is the column; the key beside it is the *wire* name
    // and no longer agrees with it (`authorId: integer("author_id")`). Matching
    // both, as this did, made every camelCased key look like a column the
    // generated file did not declare.
    const literal = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[\\s,{])[\\w$"']+\\s*:\\s*\\w+\\(\\s*["']${literal}["']`, "m").test(block);
}

/**
 * @param generatedSource contents of `backend/src/schema.generated.ts`
 * @param collections     the project's collections, as this release reads them
 */
export function findLegacyForeignKeyNames(
    generatedSource: string,
    collections: CollectionConfig[]
): LegacyForeignKeyName[] {
    const found: LegacyForeignKeyName[] = [];
    const seen = new Set<string>();

    /**
     * Report `wanted` as stale when the generated schema declares what the
     * previous rule would have derived from `source` instead.
     *
     * The `wanted !== current` guard is what honours an explicitly named column.
     * An author who pinned `categorie_id` has said so on the relation, so the
     * generated file agreeing with them is correct, not stale — and the rename
     * note documents exactly that opt-out.
     */
    const consider = (
        table: string,
        wanted: string,
        sourceName: string | undefined,
        relation: string
    ): void => {
        if (!table || !wanted || !sourceName) return;

        const current = generateForeignKeyName(sourceName);
        const legacy = legacyForeignKeyName(sourceName);
        if (legacy === current) return;   // this name never moved
        if (wanted !== current) return;   // pinned by the author, or unrelated

        const block = tableBlock(generatedSource, table);
        if (!block) return;
        if (!declaresColumn(block, legacy)) return;
        if (declaresColumn(block, current)) return;   // already regenerated

        const key = `${table}.${legacy}`;
        if (seen.has(key)) return;
        seen.add(key);
        found.push({ table, legacy, current, relation });
    };

    // Same rule as the generator whose output this reads: a collection that
    // gets no table cannot have named a column in it. Inert in practice today —
    // the finding also requires the generated file to declare the table — but
    // the guard is what keeps that true when a non-SQL collection's slug happens
    // to match a SQL one's table.
    for (const collection of relationalCollections(collections)) {
        const sourceTable = getTableName(collection);

        for (const [name, relation] of Object.entries(resolveCollectionRelations(collection))) {
            const at = `${collection.slug}.${name}`;

            let target: CollectionConfig | undefined;
            try {
                target = relation.target?.();
            } catch {
                // A throwing target thunk is its own defect, reported at boot by
                // `validate-relations`. Nothing to say about its column names.
                continue;
            }

            switch (relation.kind) {
                case "belongsTo":
                    consider(sourceTable, relation.localKey, relation.relationName, at);
                    break;

                case "hasOne":
                case "hasMany":
                    if (target) {
                        consider(getTableName(target), relation.foreignKeyOnTarget, collection.slug, at);
                    }
                    break;

                case "manyToMany":
                    consider(relation.through.table, relation.through.sourceColumn, collection.slug, at);
                    if (target) {
                        consider(relation.through.table, relation.through.targetColumn, target.slug, at);
                    }
                    break;

                default:
                    // `via` joins are written by hand — there is no derived name
                    // for the rule change to have moved.
                    break;
            }
        }
    }

    return found;
}

/** One-line summary for a log or a CLI notice. */
export function describeLegacyForeignKeyNames(found: LegacyForeignKeyName[]): string {
    return found
        .map(f => `  • ${f.table}.${f.legacy} → ${f.current}  (${f.relation})`)
        .join("\n");
}

// ── The other way a generated schema goes stale ──────────────────────────────
//
// The rename above is the subtle one: nothing the developer owns changed. The
// ordinary one is the opposite — a collection or a relation was added and the
// generator was not re-run, so the checked-in module simply does not describe
// part of the schema. It fails later and elsewhere: relation validation, or a
// query against a table the module has never heard of.
//
// Still not "is this byte-for-byte what the generator would emit now". This asks
// only about *names*, which is what the rest of the system reads out of the
// file, so reformatting the generator cannot make it red.

/** Something the collections derive that the generated schema does not declare. */
export interface MissingGeneratedName {
    /** The table it belongs to, or is. */
    table: string;
    /** The column, when a column is what is missing. */
    column?: string;
    /** `<collection>` or `<collection>.<relation>`, for the message. */
    source: string;
}

/**
 * Tables and derived foreign-key columns the collections name and the generated
 * schema does not.
 *
 * @param generatedSource contents of `backend/src/schema.generated.ts`
 * @param collections     the project's collections, as this release reads them
 */
export function findMissingGeneratedNames(
    generatedSource: string,
    collections: CollectionConfig[]
): MissingGeneratedName[] {
    const missing: MissingGeneratedName[] = [];
    const seen = new Set<string>();

    const report = (table: string, source: string, column?: string): void => {
        const key = `${table}.${column ?? ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        missing.push({ table, source, ...(column ? { column } : {}) });
    };

    const requireColumn = (table: string, column: string | undefined, source: string): void => {
        if (!table || !column) return;
        const block = tableBlock(generatedSource, table);
        // A table that is absent is reported once, as a table. Listing each of
        // its columns as separately missing would bury the one fact that
        // explains all of them.
        if (!block) return report(table, source);
        if (!declaresColumn(block, column)) report(table, source, column);
    };

    for (const collection of relationalCollections(collections)) {
        const sourceTable = getTableName(collection);
        if (!tableBlock(generatedSource, sourceTable)) {
            report(sourceTable, collection.slug);
            continue;
        }

        for (const [name, relation] of Object.entries(resolveCollectionRelations(collection))) {
            const at = `${collection.slug}.${name}`;

            let target: CollectionConfig | undefined;
            try {
                target = relation.target?.();
            } catch {
                // Its own defect, reported at boot by `validate-relations`.
                continue;
            }

            switch (relation.kind) {
                case "belongsTo":
                    requireColumn(sourceTable, relation.localKey, at);
                    break;

                case "hasOne":
                case "hasMany":
                    if (target) requireColumn(getTableName(target), relation.foreignKeyOnTarget, at);
                    break;

                case "manyToMany":
                    requireColumn(relation.through.table, relation.through.sourceColumn, at);
                    requireColumn(relation.through.table, relation.through.targetColumn, at);
                    break;

                default:
                    // `via` joins are written by hand; there is no derived name
                    // to be missing.
                    break;
            }
        }
    }

    return missing;
}

/** One-line summary for a log or a CLI notice. */
export function describeMissingGeneratedNames(missing: MissingGeneratedName[]): string {
    return missing
        .map(m => (m.column
            ? `  • ${m.table}.${m.column} is not declared  (${m.source})`
            : `  • table ${m.table} is not declared  (${m.source})`))
        .join("\n");
}

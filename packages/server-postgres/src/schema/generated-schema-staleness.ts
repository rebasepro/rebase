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
    const start = source.indexOf(`pgTable("${table}"`);
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

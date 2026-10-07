/**
 * The foreign-key indexes `rebase db push` builds before Atlas plans.
 *
 * Rebase derives a btree for every `belongsTo` key and every junction's target
 * column (15b00afcd). On a table that already exists — every table of a
 * project upgraded across that release — the index is missing, and a push left
 * it to Atlas, which builds it inside the push's one transaction: a plain
 * `CREATE INDEX`, holding writes to the table for the whole build, about 0.4 s
 * at a million rows and 6 s at ten million. Atlas's own concurrent mode would
 * run the entire apply outside a transaction, which the push relies on.
 *
 * So the push builds those first, `CONCURRENTLY`, with the builder the boot
 * uses for the same indexes (`deferred-index-build.ts`: one at a time, a lock
 * budget for getting the table, an INVALID leftover dropped and rebuilt, a
 * claim shared with booting instances). Atlas then finds them and plans
 * nothing for them. One it could not build is still Atlas's, as before.
 *
 * Only an index whose columns are already there: a column this push adds is
 * created by Atlas, and its index with it, on a column that holds no values.
 */
import { declaredDatabaseExtensions, type CollectionConfig } from "@rebasepro/types";
import { planSchema } from "./plan/plan-schema";
import { diffPlanAgainstCatalogue, type DeferredIndexBuild } from "./plan/diff-plan";
import { readExistingSchema, type Queryable } from "./ensure-collection-tables";

/** The derived foreign-key indexes a live table lacks (or holds INVALID) whose columns it already has. */
export async function missingForeignKeyIndexes(
    client: Queryable,
    collections: CollectionConfig[]
): Promise<DeferredIndexBuild[]> {
    const schema = planSchema(collections, { databaseExtensions: declaredDatabaseExtensions() });
    const schemas = Array.from(new Set(schema.tables.map(table => table.schema)));
    // No row probes: whether a table holds rows decides only constraints on a
    // column being added, which this does not plan.
    const existing = await readExistingSchema(client, schemas, { probeTables: () => [] });
    const plan = diffPlanAgainstCatalogue(schema, existing);

    const specs = new Map(schema.tables.flatMap(table => table.indexes)
        .map(spec => [`${spec.schema}.${spec.indexName}`, spec]));
    return plan.deferredIndexes.filter(build => {
        const spec = specs.get(`${build.schema}.${build.indexName}`);
        if (spec?.derived !== "foreign-key") return false;
        const columns = existing.tables.get(`${build.schema}.${build.table}`);
        if (!columns) return false;
        return [...spec.keys.map(key => key.column), ...spec.include].every(column => columns.has(column));
    });
}

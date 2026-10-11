/**
 * The relation columns an aged database still holds under the name Rebase
 * derived before 0.13 (`categorie_id`, `people_id`), for `db push` to rename
 * before Atlas plans.
 *
 * Boot renames them losslessly (`diff-plan.ts`, `renameLegacyColumn`). Push
 * runs Atlas, which sees only "drop `categorie_id`, add `category_id` NOT
 * NULL": it listed the links as destructive changes to approve, and with
 * `--allow-destructive` dropped them. A pipeline that runs only `db push`
 * could not upgrade an aged database at all. Renaming first — the same
 * metadata-only statement boot runs — leaves Atlas nothing to plan.
 */
import { declaredDatabaseExtensions, type CollectionConfig } from "@rebasepro/types";
import { planSchema } from "./plan/plan-schema";
import { diffPlanAgainstCatalogue, type LegacyForeignKey } from "./plan/diff-plan";
import { readExistingSchema, type Queryable } from "./ensure-collection-tables";

export interface LegacyRename extends LegacyForeignKey {
    /** `ALTER TABLE … RENAME COLUMN …;` */
    sql: string;
}

export async function legacyForeignKeyRenames(client: Queryable, collections: CollectionConfig[]): Promise<LegacyRename[]> {
    const schema = planSchema(collections, { databaseExtensions: declaredDatabaseExtensions() });
    const schemas = Array.from(new Set(schema.tables.map(table => table.schema)));
    const existing = await readExistingSchema(client, schemas, { probeTables: () => [] });
    const plan = diffPlanAgainstCatalogue(schema, existing);
    return plan.legacyForeignKeys.map(legacy => {
        const action = plan.actions.find(a => a.kind === "rename-column" && a.target === `${legacy.table}.${legacy.expected}`);
        return { ...legacy, sql: action?.sql ?? "" };
    }).filter(rename => rename.sql !== "");
}

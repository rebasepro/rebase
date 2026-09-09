/**
 * "What column does this property compile to?", for tests.
 *
 * The question used to be asked of `getSqlColumnType` and `getDrizzleColumn`,
 * one per emitter — which is exactly the shape the refactor removed. There is
 * one answer now, and it lives on the {@link SchemaPlan}: these helpers look it
 * up so a test can keep asserting about a single column without rebuilding a
 * whole file and grepping it.
 */
import type { CollectionConfig } from "@rebasepro/types";
import { planSchema } from "../../src/schema/plan/plan-schema";
import { renderColumnDefinition, renderPgType } from "../../src/schema/plan/render-ddl";
import type { ColumnPlan } from "../../src/schema/plan/types";

/**
 * The planned column a property owns, or `undefined` when it owns none — an
 * inverse relation, whose column lives on the target table.
 */
export const planColumnFor = (
    collections: CollectionConfig[],
    slug: string,
    propName: string
): ColumnPlan | undefined => {
    const plan = planSchema(collections);
    const table = plan.tables.find(t => t.slug === slug);
    if (!table) throw new Error(`no table planned for collection "${slug}"`);
    return table.columns.find(column => column.source.propName === propName);
};

/** The Postgres type that column is declared with — `TEXT`, `JSONB`, `VECTOR(3)`. */
export const planColumnTypeFor = (
    collections: CollectionConfig[],
    slug: string,
    propName: string
): string | undefined => {
    const column = planColumnFor(collections, slug, propName);
    return column && renderPgType(column.type);
};

/** Everything after the column name, as `CREATE TABLE` writes it. */
export const planColumnDefinitionFor = (
    collections: CollectionConfig[],
    slug: string,
    propName: string
): string | undefined => {
    const column = planColumnFor(collections, slug, propName);
    return column && renderColumnDefinition(column);
};

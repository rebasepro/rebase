/**
 * `db push`'s half of index adoption (`index-adoption.ts`): before Atlas
 * plans, an existing index identical to a declared one takes the declared
 * one's name, so the plan finds it there instead of creating a twin beside it.
 * Boot does the same through its own plan (`diffPlanAgainstCatalogue`).
 */
import { declaredDatabaseExtensions, type CollectionConfig } from "@rebasepro/types";
import { planSchema } from "./plan/plan-schema";
import { sortIndexSpecs } from "./collection-index";
import { planIndexAdoptions, readIndexShapes, type IndexAdoption, type ShapeQueryable } from "./index-adoption";

/** The renames that make the database's identical indexes the collections' declared ones. */
export async function pushIndexAdoptions(client: ShapeQueryable, collections: CollectionConfig[]): Promise<IndexAdoption[]> {
    const schema = planSchema(collections, { databaseExtensions: declaredDatabaseExtensions() });
    const specs = sortIndexSpecs(schema.tables.flatMap(table => table.indexes));
    const shapes = await readIndexShapes(client, Array.from(new Set(schema.tables.map(table => table.schema))));
    return planIndexAdoptions(specs, shapes);
}

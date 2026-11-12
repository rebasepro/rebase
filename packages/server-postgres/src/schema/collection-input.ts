/**
 * TRANSITIONAL (B-PLAN-2): the one place the schema code turns legacy
 * collections into compiled tables — for the live schema editor only.
 *
 * The editor (`planSchemaChange` → `generateSchemaCommit`, and
 * `classifyTableChanges` under it) still receives the served and the edited
 * schema as collections from `@rebasepro/server`, through the driver's
 * `planSchemaChange`, and lifts them here with the codemod's lift
 * (`collectionsToTableDefs`). It should be handed the compiled tables (the
 * server holds the edited definitions); when it is, delete this file. Boot
 * never comes here: the appliers take `CompiledTable[]`.
 */
import { collectionsToTableDefs, compileSchema } from "@rebasepro/common";
import type { CollectionConfig, CompiledTable } from "@rebasepro/types";

/**
 * Edited collections as compiled tables.
 *
 * @throws SchemaDefinitionError naming every collection the table model cannot
 *   express, or the compile refuses.
 */
export function compileEditedCollections(collections: readonly CollectionConfig[]): CompiledTable[] {
    const { tables, defaultRls } = collectionsToTableDefs(collections);
    return compileSchema(tables, defaultRls ? { defaultRls } : {});
}

/**
 * The edited schema, as the live editor hands it: compiled tables, or — until
 * the server compiles them (B-R7) — its collections.
 */
export type EditedTables = readonly CompiledTable[] | readonly CollectionConfig[];

/** The slugs of the edited tables, in order — for a refusal that has to name one. */
export function editedSlugs(handed: EditedTables): string[] {
    return handed.map(entry => isCompiledTable(entry) ? entry.descriptor.slug : entry.slug);
}

/** Whether a value the server handed over is a `CompiledTable`. */
export function isCompiledTable(value: unknown): value is CompiledTable {
    return typeof value === "object" && value !== null
        && "descriptor" in value && typeof value.descriptor === "object" && value.descriptor !== null
        && "def" in value && typeof value.def === "object" && value.def !== null;
}

/** Whether a value the server handed over is a collection (a slug and its properties). */
function isCollectionInput(value: unknown): value is CollectionConfig {
    return typeof value === "object" && value !== null
        && "slug" in value && typeof value.slug === "string"
        && "properties" in value && typeof value.properties === "object" && value.properties !== null;
}

/**
 * What the editor plans from: the compiled tables it was handed, taken as
 * they are, or — while the server still hands collections — those compiled
 * through {@link compileEditedCollections}.
 *
 * @throws Error naming the entry that is neither.
 */
export function compileHandedTables(handed: readonly unknown[]): CompiledTable[] {
    if (handed.every(isCompiledTable)) return handed.filter(isCompiledTable);
    const collections = handed.filter(isCollectionInput);
    if (collections.length !== handed.length) {
        throw new Error("The schema was handed something that is neither a compiled table nor a collection; pass the compiled tables.");
    }
    return compileEditedCollections(collections);
}

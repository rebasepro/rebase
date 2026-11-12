/**
 * TRANSITIONAL (B-PLAN-2): the one place the schema code turns legacy
 * collections into the compiled tables the planner reads.
 *
 * The live schema editor (`planSchemaChange` → `generateSchemaCommit`, and
 * `classifyCollectionChanges` under it) still receives the edited schema as
 * collections from `@rebasepro/server`: the edits are not in the registry, so
 * they cannot be looked up as compiled tables. The boot appliers
 * (`ensureCollectionSchema`, `ensureCollectionPolicies`) are handed the
 * server's lowered collections before the driver opens, so there is no
 * registry to read them from either. Until the server hands the driver
 * compiled tables (slice B-R7), both are lifted here with the codemod's lift
 * (`collectionsToTableDefs`) and compiled. Nothing else may call this: every
 * other door already holds `CompiledTable[]`.
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
 * What a boot applier plans from: the compiled tables it was handed, taken as
 * they are, or — while the server still hands collections — those compiled
 * through {@link compileEditedCollections}. Never read from a registry: boot
 * provisions the schema before the driver opens.
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

import { compileSchema } from "@rebasepro/common";
import { collectionsToTableDefs, type LegacyCollectionConfig } from "@rebasepro/common/migrate";
import type { CompiledTable } from "@rebasepro/types";

/**
 * Legacy fixture collections lifted (`collectionsToTableDefs`) and compiled:
 * the compiled tables the live schema editor hands the planner, for the
 * suites whose fixtures are still collection literals. The planner itself
 * takes only compiled tables — the server compiles the edited definitions.
 *
 * @throws SchemaDefinitionError naming a fixture the lift or the compile refuses.
 */
export function compiledFromLegacy(collections: readonly LegacyCollectionConfig[]): CompiledTable[] {
    const { tables, defaultRls } = collectionsToTableDefs(collections);
    return compileSchema(tables, defaultRls ? { defaultRls } : {});
}

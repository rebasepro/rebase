/**
 * The proof that a migration is lossless: the legacy collections and the
 * migrated tables render the same SQL.
 *
 * "Before" is the collections exactly as the legacy loader serves them.
 * "After" is `backend/schema` read back through the new pipeline —
 * `loadBackendSchema` (index authority, sibling check, compile) with the CLI's
 * jiti importer, compiled by `compileLoadedSchema`, the one compile boot, the
 * runtime and the CLI share. The planner reads only compiled tables, so
 * "before" is the legacy collections lifted (`collectionsToTableDefs`, the
 * codemod's own core) and compiled. Both go through
 * `renderSchemaOutputs`, the renderer the plan-golden corpus is recorded
 * with: DDL under every option, policies, search, vector, triggers, views,
 * the Drizzle schema and the boot plans. A single byte of difference fails.
 */
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";

import type { ModuleImporter } from "./load-legacy";
import type { VerificationResult } from "./types";

/** The lines around the first and last difference of two texts, as a unified-style excerpt. */
export function describeDifference(before: string, after: string, context = 3, limit = 80): string {
    const a = before.split("\n");
    const b = after.split("\n");
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length - 1;
    let endB = b.length - 1;
    while (endA >= start && endB >= start && a[endA] === b[endB]) {
        endA--;
        endB--;
    }
    const from = Math.max(0, start - context);
    const lines: string[] = [`@@ line ${start + 1} @@`];
    for (let index = from; index < start; index++) lines.push(`  ${a[index]}`);
    for (let index = start; index <= endA; index++) lines.push(`- ${a[index]}`);
    for (let index = start; index <= endB; index++) lines.push(`+ ${b[index]}`);
    for (let index = endA + 1; index < Math.min(a.length, endA + 1 + context); index++) lines.push(`  ${a[index]}`);
    if (lines.length > limit) return [...lines.slice(0, limit), `… ${lines.length - limit} more lines`].join("\n");
    return lines.join("\n");
}

/**
 * Compare what the legacy collections and the migrated schema render.
 *
 * @param legacy the Postgres collections as the legacy loader serves them
 * @param schemaDir the migrated `backend/schema`, absolute
 */
export async function verifyMigration(
    legacy: readonly LegacyCollectionConfig[],
    schemaDir: string,
    importModule: ModuleImporter
): Promise<VerificationResult> {
    const { renderSchemaOutputs } = await import("@rebasepro/server-postgres");
    const { compileLoadedSchema, loadBackendSchema } = await import("@rebasepro/server");
    const { compileSchema } = await import("@rebasepro/common");
    const { collectionsToTableDefs } = await import("@rebasepro/common/migrate");
    let after: Record<string, string>;
    try {
        // Exactly as the server reads it: the index is authoritative, a sibling
        // definition it does not export is refused, every definition compiles.
        // `projectRoot: false` — config/ is still there until the user deletes it.
        const loaded = await loadBackendSchema(schemaDir, { projectRoot: false, importModule });
        if (!loaded.indexFile) throw new Error(`${schemaDir} has no index module.`);
        after = renderSchemaOutputs(compileLoadedSchema(loaded).tables);
    } catch (error) {
        return { identical: false, compared: 0, differences: [], error: `The migrated schema could not be read back: ${error instanceof Error ? error.message : String(error)}` };
    }
    let before: Record<string, string>;
    try {
        const lifted = collectionsToTableDefs(legacy);
        before = renderSchemaOutputs(compileSchema(lifted.tables, lifted.defaultRls ? { defaultRls: lifted.defaultRls } : {}));
    } catch (error) {
        return { identical: false, compared: 0, differences: [], error: `The legacy collections could not be lifted into tables: ${error instanceof Error ? error.message : String(error)}` };
    }
    const differences: VerificationResult["differences"] = [];
    const outputs = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const output of outputs) {
        const a = before[output] ?? "";
        const b = after[output] ?? "";
        if (a !== b) differences.push({ output, diff: describeDifference(a, b) });
    }
    return { identical: differences.length === 0, compared: outputs.length, differences };
}

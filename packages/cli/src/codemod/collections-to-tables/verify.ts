/**
 * The proof that a migration is lossless: the legacy collections and the
 * migrated tables render the same SQL.
 *
 * "Before" is the collections exactly as the legacy loader serves them.
 * "After" is `backend/schema` read back through the new pipeline — its index
 * imported, every definition compiled and lowered by `compileSchemaDefs`
 * (the one lowering boot, the runtime and the CLI share). Both go through
 * `renderSchemaOutputs`, the renderer the plan-golden corpus is recorded
 * with: DDL under every option, policies, search, vector, triggers, views,
 * the Drizzle schema and the boot plans. A single byte of difference fails.
 */
import fs from "node:fs";
import path from "node:path";
import { isTableDef, isViewDef, type AnyTableDef, type AnyViewDef, type CollectionConfig, type DefaultRls } from "@rebasepro/types";

import type { ModuleImporter } from "./load-legacy";
import type { VerificationResult } from "./types";

function isDefaultRls(value: unknown): value is DefaultRls {
    return value === "admin-only" || (Array.isArray(value) && value.length > 0 && value.every(rule => typeof rule === "object" && rule !== null));
}

/** The tables `<schemaDir>/index.ts` exports, and its `defaultRls`. */
export async function readMigratedSchema(schemaDir: string, importModule: ModuleImporter): Promise<{ defs: (AnyTableDef | AnyViewDef)[]; defaultRls?: DefaultRls }> {
    const indexFile = ["index.ts", "index.mts", "index.js"].map(name => path.join(schemaDir, name)).find(file => fs.existsSync(file));
    if (!indexFile) throw new Error(`${schemaDir} has no index module.`);
    const mod = await importModule(indexFile);
    const defs: (AnyTableDef | AnyViewDef)[] = [];
    let defaultRls: DefaultRls | undefined;
    for (const [name, value] of Object.entries(mod)) {
        if (isTableDef(value) || isViewDef(value)) {
            if (!defs.includes(value)) defs.push(value);
        } else if (name === "defaultRls" && isDefaultRls(value)) {
            defaultRls = value;
        }
    }
    return { defs, ...(defaultRls !== undefined ? { defaultRls } : {}) };
}

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
    legacy: readonly CollectionConfig[],
    schemaDir: string,
    importModule: ModuleImporter
): Promise<VerificationResult> {
    const { renderSchemaOutputs } = await import("@rebasepro/server-postgres");
    const { compileSchemaDefs } = await import("@rebasepro/server");
    let after: Record<string, string>;
    try {
        const { defs, defaultRls } = await readMigratedSchema(schemaDir, importModule);
        const { collections } = compileSchemaDefs(defs, defaultRls);
        after = renderSchemaOutputs(collections);
    } catch (error) {
        return { identical: false, compared: 0, differences: [], error: `The migrated schema could not be read back: ${error instanceof Error ? error.message : String(error)}` };
    }
    const before = renderSchemaOutputs(legacy);
    const differences: VerificationResult["differences"] = [];
    const outputs = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const output of outputs) {
        const a = before[output] ?? "";
        const b = after[output] ?? "";
        if (a !== b) differences.push({ output, diff: describeDifference(a, b) });
    }
    return { identical: differences.length === 0, compared: outputs.length, differences };
}

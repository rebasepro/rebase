/**
 * Child process for `cloud-policies.mjs`: compile one copy of the cloud app's
 * schema with the framework's own policy compiler and print the result.
 *
 * Run under `node --import tsx`, because the schema, the loader and the
 * compiler are TypeScript. Separate from the parent so the parent stays plain
 * ESM and a schema that throws on import cannot take the preflight down with
 * it.
 *
 *   argv: <tables|collections> <entry index.ts> <generate-postgres-ddl-logic.ts> <load-schema.ts> <common index.ts>
 *   stdout: MARKER, then `{ "<schema.table>": ["DROP POLICY …", "CREATE POLICY …"] }`
 *
 * `tables`: the entry is `backend/schema/index.ts`; its directory is loaded
 * with `loadBackendSchema` and lowered with `compileLoadedSchema`, exactly as
 * boot does. `collections`: the entry is a pre-0.31 `config/collections/index.ts`
 * and its `collections` export is lifted into tables and planned.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Anything a module prints on import comes before this, and is ignored. */
const MARKER = "@@rebase-cloud-policies@@"; // the same string in cloud-policies.mjs

const [kind, index, compiler, loader, lifter] = process.argv.slice(2);

const policies = {};
if (fs.existsSync(index)) {
    const { planTablePolicies } = await import(pathToFileURL(compiler).href);
    let tables;
    if (kind === "tables") {
        const { loadBackendSchema, compileLoadedSchema } = await import(pathToFileURL(loader).href);
        tables = compileLoadedSchema(await loadBackendSchema(path.dirname(index))).tables;
    } else {
        // The lift is `@rebasepro/common/migrate`; the compiler is the package root beside it.
        const { collectionsToTableDefs } = await import(pathToFileURL(lifter).href);
        const { compileSchema } = await import(pathToFileURL(path.resolve(path.dirname(lifter), "..", "index.ts")).href);
        const lifted = collectionsToTableDefs((await import(pathToFileURL(index).href)).collections ?? []);
        tables = compileSchema(lifted.tables, lifted.defaultRls ? { defaultRls: lifted.defaultRls } : {});
    }
    for (const plan of planTablePolicies(tables)) {
        policies[plan.qualified] = plan.policyStatements;
    }
}
process.stdout.write(`\n${MARKER}${JSON.stringify(policies)}\n`);

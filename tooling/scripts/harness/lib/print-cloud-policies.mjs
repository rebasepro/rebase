/**
 * Child process for `cloud-policies.mjs`: compile one copy of the cloud app's
 * schema with the framework's own policy compiler and print the result.
 *
 * Run under `node --import tsx`, because the schema, the loader and the
 * compiler are TypeScript. Separate from the parent so the parent stays plain
 * ESM and a schema that throws on import cannot take the preflight down with
 * it.
 *
 *   argv: <tables|collections> <entry index.ts> <generate-postgres-ddl-logic.ts> <load-schema.ts>
 *   stdout: MARKER, then `{ "<schema.table>": ["DROP POLICY …", "CREATE POLICY …"] }`
 *
 * `tables`: the entry is `backend/schema/index.ts`; its directory is loaded
 * with `loadBackendSchema` and lowered with `compileLoadedSchema`, exactly as
 * boot does. `collections`: the entry is a pre-0.31 `config/collections/index.ts`
 * and its `collections` export is planned as it was.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Anything a module prints on import comes before this, and is ignored. */
const MARKER = "@@rebase-cloud-policies@@"; // the same string in cloud-policies.mjs

const [kind, index, compiler, loader] = process.argv.slice(2);

const policies = {};
if (fs.existsSync(index)) {
    const { planCollectionPolicies } = await import(pathToFileURL(compiler).href);
    let collections;
    if (kind === "tables") {
        const { loadBackendSchema, compileLoadedSchema } = await import(pathToFileURL(loader).href);
        collections = compileLoadedSchema(await loadBackendSchema(path.dirname(index))).collections;
    } else {
        collections = (await import(pathToFileURL(index).href)).collections ?? [];
    }
    for (const plan of planCollectionPolicies(collections)) {
        policies[plan.qualified] = plan.policyStatements;
    }
}
process.stdout.write(`\n${MARKER}${JSON.stringify(policies)}\n`);

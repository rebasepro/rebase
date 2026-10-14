/**
 * Child process for `cloud-policies.mjs`: compile one copy of
 * `config/collections` with the framework's own policy compiler and print the
 * result.
 *
 * Run under `node --import tsx`, because both the collections and the compiler
 * are TypeScript. Separate from the parent so the parent stays plain ESM and a
 * collection that throws on import cannot take the preflight down with it.
 *
 *   argv: <collections index.ts> <generate-postgres-ddl-logic.ts>
 *   stdout: MARKER, then `{ "<schema.table>": ["DROP POLICY …", "CREATE POLICY …"] }`
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";

/** Anything a module prints on import comes before this, and is ignored. */
const MARKER = "@@rebase-cloud-policies@@"; // the same string in cloud-policies.mjs

const [index, compiler] = process.argv.slice(2);

const policies = {};
if (fs.existsSync(index)) {
    const mod = await import(pathToFileURL(index).href);
    const { planCollectionPolicies } = await import(pathToFileURL(compiler).href);
    for (const plan of planCollectionPolicies(mod.collections ?? [])) {
        policies[plan.qualified] = plan.policyStatements;
    }
}
process.stdout.write(`\n${MARKER}${JSON.stringify(policies)}\n`);

/**
 * The collections-to-tables codemod, run from this repository.
 *
 * The same library as `rebase migrate collections-to-tables`
 * (packages/cli/src/codemod/collections-to-tables) — this entry exists so a
 * project inside the monorepo (`app/`, `saas/`, a template, an example) can be
 * migrated against the workspace's SOURCE: every `@rebasepro/*` import the
 * project's modules make is pointed at `packages/<name>/src`, so the run never
 * reads a stale `dist`. A user's project runs the CLI command instead.
 *
 * Run: TSX_TSCONFIG_PATH=tsconfig.typecheck.json node --import tsx \
 *        tooling/scripts/migrate-collections-to-tables.mts <project dir> [--dry-run] [--check] [--json] [--force] [--skip-sdk-calls]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { printCollectionsToTablesHelp, runCollectionsToTables } from "../../packages/cli/src/codemod/collections-to-tables/command.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** `@rebasepro/<name>` → `packages/<name>/src/index.ts`, and the `@rebasepro/server/schema` entry. */
function workspaceAliases(): Record<string, string> {
    const aliases: Record<string, string> = {};
    for (const name of fs.readdirSync(path.join(ROOT, "packages"))) {
        const source = path.join(ROOT, "packages", name, "src", "index.ts");
        if (fs.existsSync(source)) aliases[`@rebasepro/${name}`] = source;
    }
    const schemaEntry = path.join(ROOT, "packages", "server", "src", "schema", "index.ts");
    if (fs.existsSync(schemaEntry)) aliases["@rebasepro/server/schema"] = schemaEntry;
    return aliases;
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
    printCollectionsToTablesHelp();
    process.exit(0);
}
const known = new Set(["--check", "--dry-run", "--json", "--force", "--skip-sdk-calls"]);
const unknown = args.filter(arg => arg.startsWith("-") && !known.has(arg));
const positionals = args.filter(arg => !arg.startsWith("-"));
if (unknown.length > 0 || positionals.length > 1) {
    console.error(`Usage: migrate-collections-to-tables.mts [dir] [--dry-run] [--check] [--json] [--force] [--skip-sdk-calls]${unknown.length > 0 ? ` (unknown: ${unknown.join(", ")})` : ""}`);
    process.exit(2);
}
await runCollectionsToTables({
    check: args.includes("--check"),
    dryRun: args.includes("--dry-run"),
    json: args.includes("--json"),
    force: args.includes("--force"),
    skipSdkCalls: args.includes("--skip-sdk-calls")
}, positionals[0], workspaceAliases());

import { isManyToMany } from "@rebasepro/types";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { createRequire } from "module";
import readline from "readline";
import { pathToFileURL } from "url";
import chalk from "chalk";
import { logger } from "@rebasepro/server";
import type { CollectionConfig, ResolvedRelation } from "@rebasepro/types";
import { moduleDir as __helpersDirname } from "./module-dir";



/**
 * Why is a dependency's binary missing — never installed, or installed with its
 * build script blocked?
 *
 * These need opposite advice, and getting it wrong is not a cosmetic miss. pnpm
 * 10+ refuses to run a dependency's lifecycle scripts unless it is allowlisted
 * (`pnpm.onlyBuiltDependencies`, or `allowBuilds` in `pnpm-workspace.yaml`).
 * `@ariga/atlas` downloads its platform binary in `preinstall`, so a blocked
 * script leaves a state that looks like a successful install: the package is on
 * disk with its `install.js` and `package.json`, `node_modules/.bin` is empty,
 * the install exits 0, and the only signal is `ERR_PNPM_IGNORED_BUILDS` several
 * screens up.
 *
 * Telling somebody in that state to install the package again sends them round
 * the same loop forever — the add succeeds, the script is blocked again,
 * nothing changes. Verified by doing it: `pnpm add @ariga/atlas` into a bare
 * project yields exactly this, three "Failed to create bin … ENOENT" warnings
 * and no binary.
 *
 * Resolution is attempted from the user's project first and this package
 * second, matching the order {@link resolveLocalBin} searches — the driver may
 * be installed a level up from where the command runs.
 */
export function diagnoseMissingBin(packageName: string): "not-installed" | "build-script-blocked" {
    const bases = [
        pathToFileURL(path.join(process.cwd(), "package.json")),
        pathToFileURL(path.join(__helpersDirname, "package.json"))
    ];

    for (const base of bases) {
        try {
            // `package.json` rather than the package root: a package with an
            // `exports` map that omits `.` is unresolvable by name even when it
            // is perfectly installed, which would misreport it as absent.
            createRequire(base).resolve(`${packageName}/package.json`);
            return "build-script-blocked";
        } catch {
            // Try the next base.
        }
    }
    return "not-installed";
}

export function resolveLocalBin(binName: string): string | null {
    // Try to find node_modules/.bin upwards from __helpersDirname first (package-relative)
    let dir = __helpersDirname;
    while (true) {
        const candidate = path.join(dir, "node_modules", ".bin", binName);
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    let cwd = process.cwd();
    // Try to find node_modules/.bin upwards from process.cwd()
    while (true) {
        const candidate = path.join(cwd, "node_modules", ".bin", binName);
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(cwd);
        if (parent === cwd) break;
        cwd = parent;
    }
    // Fall back to globally installed binary via which/where
    try {
        const cmd = process.platform === "win32" ? `where ${binName}` : `which ${binName}`;
        const globalPath = execSync(cmd, { encoding: "utf-8" }).trim().split("\n")[0].trim();
        if (globalPath && fs.existsSync(globalPath)) return globalPath;
    } catch {
        // not found globally
    }
    return null;
}

export async function getTableIncludesFromCollections(allCollections: CollectionConfig[]): Promise<string[]> {
    const { getTableName, resolveCollectionRelations, relationalCollections } = await import("@rebasepro/common");
    const { isPostgresCollectionConfig } = await import("@rebasepro/types");

    // The include list is the inverse of {@link getTableExcludes}: a name on it
    // is a name Atlas is allowed to drop. A Firestore collection called
    // `exercises` must not put `public.exercises` here — a real, unrelated table
    // of that name would lose its protection and be dropped by the next
    // auto-approved `db push`.
    const collections = relationalCollections(allCollections);
    const includes: string[] = [];
    for (const col of collections) {
        const tableName = getTableName(col);
        const schema = isPostgresCollectionConfig(col) && col.schema ? col.schema : "public";
        if (tableName) {
            includes.push(`${schema}.${tableName}`);
        }

        const resolvedRelations = resolveCollectionRelations(col);
        for (const relation of Object.values(resolvedRelations) as ResolvedRelation[]) {
            if (isManyToMany(relation)) {
                const junctionTableName = relation.through.table;
                const targetCollection = relation.target();
                const targetSchema = isPostgresCollectionConfig(targetCollection) && targetCollection.schema ? targetCollection.schema : "public";
                includes.push(`${targetSchema}.${junctionTableName}`);
            }
        }
    }
    
    return Array.from(new Set(includes));
}

export async function getTableIncludes(collectionsPath: string): Promise<string[]> {
    // Note: a relative --collections path resolves against the *current working
    // directory*, not the backend package. When invoked via the generated npm
    // script (cwd = backend/), the script uses "../config/collections" to
    // compensate — so running the CLI directly from the repo root with a
    // different relative path can silently point at the wrong place.
    const resolvedPath = path.resolve(collectionsPath);
    const collections: CollectionConfig[] = [];
    if (!fs.existsSync(resolvedPath)) {
        logger.warn(chalk.yellow(
            `  ⚠  Collections path not found: "${collectionsPath}"\n` +
            `     Resolved to: ${resolvedPath}\n` +
            `     (relative to cwd: ${process.cwd()})\n` +
            `     Pass an absolute path, or a path relative to where you run the command.`
        ));
    }
    if (fs.existsSync(resolvedPath)) {
        const stats = fs.statSync(resolvedPath);
        if (stats.isDirectory()) {
            const files = fs.readdirSync(resolvedPath);
            for (const file of files) {
                if ((file.endsWith(".ts") || file.endsWith(".js")) &&
                    !file.includes(".test.") &&
                    !file.endsWith(".d.ts") &&
                    file !== "index.ts" && file !== "index.js") {
                    try {
                        const filePath = path.join(resolvedPath, file);
                        const fileUrl = pathToFileURL(filePath).href;
                        const module = await import(fileUrl);
                        if (module && module.default) {
                            collections.push(module.default);
                        }
                    } catch {
                        // ignore
                    }
                }
            }
        }
    }

    return getTableIncludesFromCollections(collections);
}

export function getDevDatabaseUrl(databaseUrl: string): string {
    try {
        const parsed = new URL(databaseUrl);
        const dbName = parsed.pathname.slice(1);
        parsed.pathname = `/${dbName}_dev_diff`;
        return parsed.toString();
    } catch {
        return databaseUrl + "_dev_diff";
    }
}

export async function ensureDevDatabaseExists(databaseUrl: string, devDatabaseUrl: string) {
    try {
        const { Client } = await import("pg");
        const parsed = new URL(databaseUrl);
        const devDbName = new URL(devDatabaseUrl).pathname.slice(1);
        
        parsed.pathname = "/postgres";
        const client = new Client({ connectionString: parsed.toString() });
        await client.connect();
        try {
            const res = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [devDbName]);
            if (res.rowCount === 0) {
                await client.query(`CREATE DATABASE "${devDbName}"`);
                logger.info(chalk.gray(`  ✓ Created validation database "${devDbName}"`));
            }
        } finally {
            await client.end();
        }
    } catch {
        // Ignore, let Atlas handle connection failures
    }
}

/**
 * Query the live database for every user table/view outside the system
 * catalogs. Separated from {@link getTableExcludes} so its failure mode can
 * be handled explicitly (fail closed) and so tests can inject a stub.
 */
export async function queryExistingTables(databaseUrl: string): Promise<string[]> {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        const res = await client.query(`
            SELECT table_schema || '.' || table_name AS full_name
            FROM information_schema.tables
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
              AND table_type IN ('BASE TABLE', 'VIEW');
        `);
        return res.rows.map((row: { full_name: string }) => row.full_name);
    } finally {
        await client.end();
    }
}

/**
 * Raised when the exclude list could not be built. `db push` MUST abort on
 * this rather than continue: the exclude list is the only thing shielding
 * non-collection (user/system) tables from the auto-approved declarative
 * apply. A partial list — the old fail-open behaviour — meant a transient
 * introspection hiccup dropped every table not present in `schema.sql`.
 */
export class ExcludeIntrospectionError extends Error {
    constructor(message: string, readonly cause?: unknown) {
        super(message);
        this.name = "ExcludeIntrospectionError";
    }
}

/**
 * Build the `--exclude` list that protects tables Rebase doesn't manage from
 * the declarative apply. Anything not backing a collection (or its M2M
 * junctions) is excluded so Atlas never drops it.
 *
 * Fails **closed**: if the database can't be introspected we cannot know
 * which tables to protect, so we throw {@link ExcludeIntrospectionError}
 * instead of returning a near-empty list and letting the caller drop
 * everything.
 *
 * `deps` is injectable for tests; production uses the real pg-backed queries.
 */
export async function getTableExcludes(
    databaseUrl: string,
    collectionsPath: string,
    deps: {
        queryExistingTables?: (databaseUrl: string) => Promise<string[]>;
        getIncludes?: (collectionsPath: string) => Promise<string[]>;
    } = {}
): Promise<string[]> {
    const getIncludes = deps.getIncludes ?? getTableIncludes;
    const queryTables = deps.queryExistingTables ?? queryExistingTables;

    const includes = await getIncludes(collectionsPath);
    // Schemas the declarative apply must never touch. `rebase` holds the auth
    // tables (users, refresh_tokens, …), the RLS helper functions and Atlas's
    // own revision table. Excluding both the schema object AND its contents
    // keeps Atlas from planning a `DROP SCHEMA … CASCADE` — which on a live
    // database would take the user/auth tables with it.
    // `atlas_schema_revisions.*` is kept for backwards-compatibility with any
    // external revision schema.
    //
    // `auth` stays on this list even though Rebase no longer creates it, and
    // that is the point: on a database still holding the pre-1.0 schema it must
    // survive until the guarded cleanup retires it, and on a Supabase database
    // it is somebody else's and must never be in scope at all. Removing it here
    // would let a `db push` plan `DROP SCHEMA auth CASCADE` against a live
    // Supabase installation.
    const excludes: string[] = ["atlas_schema_revisions.*", "auth", "auth.*", "rebase", "rebase.*"];

    let existingTables: string[];
    try {
        existingTables = await queryTables(databaseUrl);
    } catch (err) {
        throw new ExcludeIntrospectionError(
            `Failed to introspect the database for unmapped tables: ${err instanceof Error ? err.message : String(err)}`,
            err
        );
    }

    for (const table of existingTables) {
        if (!includes.includes(table)) {
            excludes.push(table);
        }
    }

    return excludes;
}


/**
 * Ask a yes/no question on an interactive terminal.
 *
 * The `isTTY` guard is the contract, not an optimisation: non-interactive
 * shells (CI, pipes, agents) can never answer, and `readline` on a
 * non-TTY stdin resolves with whatever the pipe happens to contain — or never
 * resolves at all. Returning false there is what makes an unattended
 * `db push` abort instead of auto-confirming a destructive change. Callers
 * should already have gone through {@link decidePushSafety}, which decides
 * whether interactive confirmation is even possible; this is the backstop.
 *
 * Lives here rather than in cli.ts so it is reachable from a test — cli.ts uses
 * `import.meta` and cannot be imported by the jest runner.
 */
export async function promptConfirm(question: string): Promise<boolean> {
    if (!process.stdin.isTTY) return false;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer: string = await new Promise((resolve) => rl.question(question, resolve));
        return /^y(es)?$/i.test(answer.trim());
    } finally {
        rl.close();
    }
}

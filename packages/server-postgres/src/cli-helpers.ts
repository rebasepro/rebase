import { isManyToMany } from "@rebasepro/types";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { createRequire } from "module";
import readline from "readline";
import { pathToFileURL } from "url";
import chalk from "chalk";
import { isRebaseIndexName } from "./schema/collection-index";
import { out, outWarn } from "./cli-output";
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
    return getTableIncludesFromCollections(await loadCollectionsForCli(collectionsPath));
}

/**
 * Load a project's collections the way the Atlas-facing commands need them.
 *
 * Deliberately forgiving — a file that fails to import is skipped rather than
 * fatal — because the callers use this to *narrow* what Atlas may touch, and a
 * hard failure here would block a push over an unrelated broken file. Callers
 * that cannot tolerate a partial answer (the table excludes, which fail closed)
 * check the result themselves.
 */
export async function loadCollectionsForCli(collectionsPath: string): Promise<CollectionConfig[]> {
    // Note: a relative --collections path resolves against the *current working
    // directory*, not the backend package. When invoked via the generated npm
    // script (cwd = backend/), the script uses "../config/collections" to
    // compensate — so running the CLI directly from the repo root with a
    // different relative path can silently point at the wrong place.
    const resolvedPath = path.resolve(collectionsPath);
    const collections: CollectionConfig[] = [];
    if (!fs.existsSync(resolvedPath)) {
        outWarn(chalk.yellow(
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

    return collections;
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
                out(chalk.gray(`  ✓ Created validation database "${devDbName}"`));
            }
        } finally {
            await client.end();
        }
    } catch {
        // Ignore, let Atlas handle connection failures
    }
}

/**
 * The generated SQL for the project's `search` blocks, if it has any.
 *
 * @param drizzleDir directory holding the generated SQL. Defaults to `drizzle`
 *        under the working directory.
 */
export function readSearchDdl(drizzleDir: string = path.resolve(process.cwd(), "drizzle")): string {
    const searchFile = path.join(drizzleDir, "search.sql");
    if (!fs.existsSync(searchFile)) return "";
    return fs.readFileSync(searchFile, "utf-8").trim();
}

/**
 * Bring the search column, its index and their helpers up to date.
 *
 * Runs *after* Atlas, not before: the statements are `ALTER TABLE ... ADD
 * COLUMN`, so the table has to exist. Atlas is told to ignore these objects
 * entirely (`getSearchExcludes`) — it cannot manage them, and left to itself it
 * would plan a `DROP COLUMN` for every one, since they are absent from the
 * desired state it was given.
 *
 * A no-op when no collection declared `search`. A failure is *not* swallowed:
 * silently pushing a schema whose search column never appeared is how a
 * collection ends up with search configured, no error anywhere, and no results.
 */
export async function applySearchDdl(
    databaseUrl: string,
    drizzleDir: string = path.resolve(process.cwd(), "drizzle")
): Promise<void> {
    const sql = readSearchDdl(drizzleDir);
    if (!sql) return;

    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        await client.query(sql);
    } finally {
        await client.end();
    }
    out(chalk.gray("  ✓ Applied full-text search columns and indexes"));
}

/**
 * Glob patterns keeping Atlas away from the search objects.
 *
 * Returns an empty list — and so changes nothing — for a project with no
 * `search` block, which is every project that has not opted in.
 */
export async function getSearchExcludes(collectionsPath: string): Promise<string[]> {
    const { searchExcludePatterns } = await import("./schema/generate-postgres-ddl-logic");
    return searchExcludePatterns(await loadCollectionsForCli(collectionsPath));
}

/**
 * Query the live database for every user table/view outside the system
 * catalogs. Separated from {@link getTableExcludes} so its failure mode can
 * be handled explicitly (fail closed) and so tests can inject a stub.
 */
/**
 * Every index Postgres holds on a table Rebase manages, as
 * `schema.table.index`.
 *
 * Constraint-backed indexes are left out: a `PRIMARY KEY` or a `UNIQUE` is a
 * *constraint* to Atlas, diffed from the constraint declaration, and naming its
 * index in an exclude would shield the constraint itself.
 */
export async function queryExistingIndexes(databaseUrl: string): Promise<string[]> {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        const res = await client.query(`
            SELECT n.nspname || '.' || t.relname || '.' || i.relname AS full_name
            FROM pg_index x
            JOIN pg_class i ON i.oid = x.indexrelid
            JOIN pg_class t ON t.oid = x.indrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND t.relkind IN ('r', 'p')
              AND NOT EXISTS (
                  SELECT 1 FROM pg_constraint c WHERE c.conindid = i.oid
              );
        `);
        return res.rows.map((row: { full_name: string }) => row.full_name);
    } finally {
        await client.end();
    }
}

/**
 * Glob patterns keeping Atlas away from indexes that are not Rebase's.
 *
 * The problem this solves is live and predates the `indexes:` block. `db push`
 * is declarative, so an index on a managed table that is absent from
 * `schema.sql` is drift — and Atlas plans `DROP INDEX` for it. Verified
 * against atlas v1.2.3: create one by hand, re-run an unchanged push, and the
 * plan is a bare drop. `DROP INDEX` is not in `DESTRUCTIVE_PATTERNS`, so the
 * auto-approved apply took it without asking. Until now the only way to have
 * an index at all was to write it by hand, which made that the *only* outcome.
 *
 * Ownership rather than a prompt, because once indexes are declarable a drop
 * is usually correct: removing one from the config should remove it from the
 * database, quietly. What must never be dropped is an index Rebase never
 * created — a hand-written one, or one an introspected database arrived with.
 * {@link isRebaseIndexName} is the test, the same arrangement
 * `isGeneratedPolicyName` uses to let policy reconciliation drop only what it
 * generated.
 *
 * The named-in-the-desired-state check comes first and is what makes removal
 * work: a declared index that the author has just deleted still matches the
 * name pattern, is no longer in the plan, and so is *not* excluded — Atlas
 * drops it, as intended.
 *
 * Three-part `schema.table.index`, never two: a two-part pattern reads as a
 * *table* named `<index>` in a *schema* named `<table>`, matches nothing, and
 * reports no error — the trap already recorded for the search excludes.
 */
export async function getForeignIndexExcludes(
    databaseUrl: string,
    collectionsPath: string,
    deps: {
        queryExistingIndexes?: (databaseUrl: string) => Promise<string[]>;
        getManagedIndexNames?: (collectionsPath: string) => Promise<Set<string>>;
    } = {}
): Promise<string[]> {
    const queryIndexes = deps.queryExistingIndexes ?? queryExistingIndexes;
    const getManaged = deps.getManagedIndexNames ?? managedIndexNames;

    const managed = await getManaged(collectionsPath);

    let existing: string[];
    try {
        existing = await queryIndexes(databaseUrl);
    } catch (err) {
        // Fails CLOSED, like getTableExcludes: without the catalogue we cannot
        // tell a foreign index from one of ours, and guessing wrong destroys
        // an index somebody is relying on.
        throw new ExcludeIntrospectionError(
            `Failed to introspect the database for unmanaged indexes: ${err instanceof Error ? err.message : String(err)}`,
            err
        );
    }

    return existing.filter(full => {
        const indexName = full.slice(full.lastIndexOf(".") + 1);
        if (managed.has(indexName)) return false;   // ours, and still declared
        return !isRebaseIndexName(indexName);       // ours, but no longer declared -> let it drop
    });
}

/**
 * The index names the current collections would create — search, vector and
 * declared alike. Anything Atlas would emit is by definition not foreign.
 */
async function managedIndexNames(collectionsPath: string): Promise<Set<string>> {
    const collections = await loadCollectionsForCli(collectionsPath);
    const { resolveColumnName, searchExcludePatterns } = await import("./schema/generate-postgres-ddl-logic");
    const { buildCollectionIndexPlan } = await import("./schema/collection-index");

    const names = new Set<string>(
        buildCollectionIndexPlan(collections, resolveColumnName).map(spec => spec.indexName)
    );
    // Search objects are excluded from Atlas wholesale by their own patterns;
    // listing them here too is harmless and keeps this the single answer to
    // "is this index one of ours".
    for (const pattern of searchExcludePatterns(collections)) {
        names.add(pattern.slice(pattern.lastIndexOf(".") + 1));
    }
    return names;
}

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
    // `atlas_schema_revisions.*` covers a revision table living outside the
    // `rebase` schema — an externally managed Atlas setup — which the apply
    // must not plan changes against either.
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

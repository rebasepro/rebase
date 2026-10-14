import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { createRequire } from "module";
import { pathToFileURL } from "url";
import chalk from "chalk";
import { isRebaseIndexName } from "./schema/collection-index";
import type { GeneratedColumnDependency } from "./schema/generated-column-conflicts";
import { COLUMN_TYPES_SQL, type ExistingColumnType } from "./schema/destructive-sql";
import { UNDECLARABLE_CONSTRAINTS_SQL, undeclaredConstraintExcludes, type ExistingConstraint } from "./schema/undeclarable-constraints";
import { atlasExcludePattern, excludePatternParts } from "./schema/atlas-exclude";
import { out, outWarn } from "./cli-output";
import type { CollectionConfig } from "@rebasepro/types";
import { moduleDir as __helpersDirname } from "./module-dir";
import { generatedSqlDir } from "./generated-sql";



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
export type ProjectPackageManager = "pnpm" | "npm" | "yarn" | "bun" | "unknown";

/**
 * Which package manager installed this project, read off its lockfile.
 *
 * Every remedy for a blocked build script is package-manager specific, and
 * naming the wrong one is the same failure as naming none: `pnpm approve-builds`
 * is not a thing an npm user can run, and `pnpm.onlyBuiltDependencies` is a key
 * npm does not read. This existed as a pnpm-only message for long enough that
 * npm 12 — which blocks dependency lifecycle scripts by default, the way pnpm 10
 * does — could ship and leave every npm reader three unfollowable commands deep.
 *
 * The lockfile, not `npm_config_user_agent`: the question is how the project's
 * `node_modules` was built, not which binary happens to be invoking us. Walks up
 * because commands run from `backend/` in a scaffolded project, and the lockfile
 * is at the workspace root.
 */
export function detectProjectPackageManager(startDir: string = process.cwd()): ProjectPackageManager {
    const lockfiles: Array<[string, ProjectPackageManager]> = [
        ["pnpm-lock.yaml", "pnpm"],
        ["bun.lock", "bun"],
        ["bun.lockb", "bun"],
        ["yarn.lock", "yarn"],
        ["package-lock.json", "npm"]
    ];

    let dir = path.resolve(startDir);
    while (true) {
        for (const [file, manager] of lockfiles) {
            if (fs.existsSync(path.join(dir, file))) return manager;
        }
        const parent = path.dirname(dir);
        if (parent === dir) return "unknown";
        dir = parent;
    }
}

/**
 * How to let `@ariga/atlas` run its `preinstall`, in the reader's own package
 * manager.
 *
 * Returns the lines to print after "the binary is missing but the package is
 * installed". Kept next to {@link detectProjectPackageManager} so the two move
 * together, and returned rather than printed so it can be asserted on.
 */
export function describeBuildScriptRemedy(
    packageName: string,
    manager: ProjectPackageManager = detectProjectPackageManager()
): string[] {
    switch (manager) {
        case "npm":
            // npm 12 blocks dependency install scripts unless the root
            // package.json allowlists them. `rebase init` scaffolds the entry;
            // a project that predates it, or one that vendored its own
            // package.json, needs to add it.
            return [
                `    npm install-scripts approve ${packageName}`,
                "",
                "  or, to record it in the project (what `rebase init` scaffolds):",
                "",
                "    // package.json",
                `    "allowScripts": { "${packageName}": true }`,
                "",
                "  Then re-run `npm install`."
            ];
        case "yarn":
            return [
                "    // .yarnrc.yml",
                "    enableScripts: true",
                "",
                "  Then re-run `yarn install`."
            ];
        case "bun":
            return [
                "    // package.json",
                `    "trustedDependencies": ["${packageName}"]`,
                "",
                "  Then re-run `bun install`."
            ];
        case "pnpm":
        default:
            return [
                "    pnpm approve-builds",
                "",
                "  or, to record it in the project (what `rebase init` scaffolds):",
                "",
                "    // package.json",
                `    "pnpm": { "onlyBuiltDependencies": ["${packageName}"] }`,
                "",
                "  Then re-run `pnpm install`."
            ];
    }
}

/**
 * "Install again, from scratch", in the reader's own package manager.
 *
 * For the `bin-link-missing` state: the tree is half-written, and re-resolving
 * it is what recreates the `.bin` shim. `--force` on pnpm is what makes it
 * relink rather than decide the tree is already up to date.
 */
export function describeReinstallCommand(
    manager: ProjectPackageManager = detectProjectPackageManager()
): string {
    switch (manager) {
        case "npm": return "rm -rf node_modules && npm install";
        case "yarn": return "yarn install --force";
        case "bun": return "rm -rf node_modules && bun install";
        case "pnpm":
        default: return "pnpm install --force";
    }
}

/** `add <pkg>` as a dev dependency, in the reader's own package manager. */
export function describeDevAddCommand(
    packageName: string,
    manager: ProjectPackageManager = detectProjectPackageManager()
): string {
    switch (manager) {
        case "npm": return `npm install -D ${packageName}`;
        case "yarn": return `yarn add -D ${packageName}`;
        case "bun": return `bun add -d ${packageName}`;
        case "pnpm":
        default: return `pnpm add -D ${packageName}`;
    }
}

/**
 * Why a dependency's binary is not on `PATH`.
 *
 * `bin-link-missing` is the third state, and the reason this is not a boolean.
 * The `preinstall` did run and the binary IS on disk — only the
 * `node_modules/.bin` shim that points at it is absent. pnpm produces exactly
 * that when it writes the link before the script that creates the target
 * ("Failed to create bin … ENOENT"), and so does a tree copied without its
 * symlinks. Telling that reader their build scripts are blocked sends them to
 * `approve-builds`, which does nothing, because nothing is blocked.
 */
export type MissingBinDiagnosis = "not-installed" | "build-script-blocked" | "bin-link-missing";

/**
 * Where a package's own manifest lives, or null if it is not installed here.
 *
 * `package.json` rather than the package root: a package with an `exports` map
 * that omits `.` is unresolvable by name even when it is perfectly installed,
 * which would misreport it as absent.
 */
function resolvePackageManifest(packageName: string): string | null {
    const bases = [
        pathToFileURL(path.join(process.cwd(), "package.json")),
        pathToFileURL(path.join(__helpersDirname, "package.json"))
    ];
    for (const base of bases) {
        try {
            return createRequire(base).resolve(`${packageName}/package.json`);
        } catch {
            // Try the next base.
        }
    }
    return null;
}

/**
 * The binaries a package's own manifest declares, as absolute paths.
 *
 * `bin` is a string for a single binary named after the package, or a map.
 * Both forms appear in the wild and `@ariga/atlas` uses the map.
 */
export function declaredBinaries(manifestPath: string): string[] {
    let manifest: { name?: string; bin?: string | Record<string, string> };
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as typeof manifest;
    } catch {
        return [];
    }
    const dir = path.dirname(manifestPath);
    if (typeof manifest.bin === "string") return [path.resolve(dir, manifest.bin)];
    if (manifest.bin && typeof manifest.bin === "object") {
        return Object.values(manifest.bin)
            .filter((target): target is string => typeof target === "string")
            .map(target => path.resolve(dir, target));
    }
    return [];
}

export function diagnoseMissingBin(packageName: string): MissingBinDiagnosis {
    const manifestPath = resolvePackageManifest(packageName);
    if (!manifestPath) return "not-installed";

    // Installed — but "installed" was the whole verdict, and it is not enough.
    // `@ariga/atlas` downloads its platform binary in `preinstall`, so a blocked
    // script leaves the package on disk with its `install.js` and manifest and
    // no binary: the state this branch was written for. It is NOT the state of
    // a tree whose binary exists and whose `.bin` shim does not, and those two
    // need opposite advice. Ask the manifest which file the binary is, and look.
    const binaries = declaredBinaries(manifestPath);
    if (binaries.length === 0) return "build-script-blocked";
    return binaries.some(file => fs.existsSync(file)) ? "bin-link-missing" : "build-script-blocked";
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
    const { getTableName, relationalCollections, resolveJunctionSpecs } = await import("@rebasepro/common");
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
    }
    // Junctions where they are created — `public`, whatever schema either
    // endpoint is in. Qualifying one with an endpoint's schema left the real
    // junction excluded, invisible to Atlas, and planned for creation again.
    for (const junction of resolveJunctionSpecs(collections).values()) {
        includes.push(`${junction.schema}.${junction.table}`);
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
/** Paths this process has already complained about. See {@link loadCollectionsForCli}. */
const warnedMissingCollectionsPaths = new Set<string>();

export async function loadCollectionsForCli(collectionsPath: string): Promise<CollectionConfig[]> {
    // Note: a relative --collections path resolves against the *current working
    // directory*, not the backend package. When invoked via the generated npm
    // script (cwd = backend/), the script uses "../config/collections" to
    // compensate — so running the CLI directly from the repo root with a
    // different relative path can silently point at the wrong place.
    const resolvedPath = path.resolve(collectionsPath);
    const collections: CollectionConfig[] = [];
    if (!fs.existsSync(resolvedPath) && !warnedMissingCollectionsPaths.has(resolvedPath)) {
        // Once per path per process. `db push` re-enters this from
        // `schemaCommand`, `generatePostgresDdlCommand` and the Atlas argv
        // assembly, so the same four lines were printed four times — sixteen
        // lines of identical text ahead of the real output.
        //
        // An explicitly typed `--collections` never reaches here at all: it is
        // refused at the entry point, before anything is generated. See
        // `cli-collections-path.ts`. What is left is the default, which a
        // headless project legitimately does not have.
        warnedMissingCollectionsPaths.add(resolvedPath);
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

/**
 * The app database connections this process has open, by URL — one each.
 *
 * `rebase db push` used to open a connection per step: the auth bootstrap, the
 * connectivity probe, each catalogue read behind the Atlas excludes, the
 * column types, the generated-column edges, and then every post-step — RLS
 * lock, auth tables, vector, search, triggers, policies, reconcile, role,
 * legacy schema. 18 of them on a push that changed nothing. Locally each costs
 * a few milliseconds; against a hosted Postgres over TLS a connect is four or
 * five round trips (TCP, TLS 1.3, startup, SCRAM twice) — about 4 s of every
 * push at 40 ms, and more on a serverless database that wakes per connection.
 *
 * Opened on first use and closed by {@link closeAppClients} when the command
 * ends. The scratch database Atlas plans in is created and dropped through the
 * `postgres` database, on a connection of its own: it is not this one.
 */
const appClients = new Map<string, Promise<PgClient>>();

type PgClient = import("pg").Client;

async function openAppClient(databaseUrl: string, connectionTimeoutMillis?: number): Promise<PgClient> {
    const open = appClients.get(databaseUrl);
    if (open) return open;
    const opening = (async () => {
        const { Client } = await import("pg");
        const client = new Client({
            connectionString: databaseUrl,
            ...(connectionTimeoutMillis ? { connectionTimeoutMillis } : {})
        });
        // A connection can die while it sits idle between steps — Atlas runs
        // for seconds with this one open. Unheard, that `error` is an uncaught
        // exception and kills the process; heard, the next step opens another,
        // and a step running on it fails with its own error, as before.
        const forget = (): void => {
            if (appClients.get(databaseUrl) === opening) appClients.delete(databaseUrl);
        };
        client.on("error", forget);
        client.on("end", forget);
        await client.connect();
        return client;
    })();
    appClients.set(databaseUrl, opening);
    try {
        return await opening;
    } catch (err) {
        // Not kept: the next step tries again, and reports its own failure the
        // way it did when every step connected for itself.
        appClients.delete(databaseUrl);
        throw err;
    }
}

/**
 * Run one step on this process's connection to the app database.
 *
 * Every step leaves the session as it found it, which is what a connection of
 * its own used to guarantee by being closed. None of them sets anything for
 * the session — `SET LOCAL` inside their own transaction, or `RESET` — and one
 * that fails part-way through a transaction it opened is rolled back here, so
 * the next step does not meet `current transaction is aborted`.
 *
 * @param options.connectionTimeoutMillis applies only when this call is the one
 *        that connects.
 */
export async function withAppClient<T>(
    databaseUrl: string,
    step: (client: PgClient) => Promise<T>,
    options: { connectionTimeoutMillis?: number } = {}
): Promise<T> {
    const client = await openAppClient(databaseUrl, options.connectionTimeoutMillis);
    try {
        return await step(client);
    } catch (err) {
        // Outside a transaction this is a warning Postgres sends and nobody
        // reads; on a dead connection it fails too, which changes nothing.
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
    }
}

/** Close every connection {@link withAppClient} opened. Called once, as the command ends. */
export async function closeAppClients(): Promise<void> {
    const open = [...appClients.values()];
    appClients.clear();
    await Promise.all(open.map(async opening => {
        try {
            await (await opening).end();
        } catch {
            // Already gone, or never connected: nothing to close.
        }
    }));
}

/**
 * Names the empty database Atlas plans against, instead of `<db>_dev_diff`.
 *
 * The derived one is made with `CREATE DATABASE` beside the real database,
 * which assumes a server that holds more than one. PGlite — the managed
 * development database — serves exactly one: the CREATE succeeds and creates
 * nothing, so Atlas connected straight back to the database it was comparing
 * and refused it as "not clean". `rebase db push` on the managed database now
 * starts a second, throwaway PGlite and names it here. Anyone can name their
 * own the same way; a named database is neither created nor dropped.
 */
export const ATLAS_DEV_URL_ENV = "REBASE_ATLAS_DEV_URL";

/**
 * The database Atlas replays the desired schema into: the one
 * {@link ATLAS_DEV_URL_ENV} names (`named: true` — not ours to create or
 * drop), else `<db>_dev_diff`.
 */
export function atlasDevDatabaseUrl(
    databaseUrl: string,
    env: Readonly<Record<string, string | undefined>>
): { url: string; named: boolean } {
    const named = env[ATLAS_DEV_URL_ENV]?.trim();
    if (!named) return { url: getDevDatabaseUrl(databaseUrl), named: false };
    if (named === databaseUrl.trim()) {
        // Atlas would replay the schema into the database it is about to change.
        throw new Error(
            `${ATLAS_DEV_URL_ENV} names the same database as DATABASE_URL. It must be a separate, empty ` +
            "database that Atlas may fill and clear."
        );
    }
    return { url: named, named: true };
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

/**
 * Create the scratch database Atlas plans against, and say so when we cannot.
 *
 * Atlas needs a `--dev-url` — an empty database it can build the desired state
 * in — and this makes `<db>_dev_diff` next to the real one. The whole body used
 * to be wrapped in an empty catch commented "Ignore, let Atlas handle
 * connection failures", and Atlas's version of handling it is `postgres:
 * querying system variables: pq: database "app_dev_diff" does not exist
 * (3D000)` — the symptom, four frames downstream of the cause, with the cause
 * thrown away.
 *
 * The cause is almost always `42501`: `CREATE DATABASE` is a privilege managed
 * providers do not grant, so this is the first thing a hosted user hits and the
 * one they can do least with.
 *
 * @returns whether the scratch database was created by *this* call — the only
 *          case in which dropping it afterwards is ours to do.
 */
export async function ensureDevDatabaseExists(databaseUrl: string, devDatabaseUrl: string): Promise<boolean> {
    let devDbName = "";
    try {
        const { Client } = await import("pg");
        const parsed = new URL(databaseUrl);
        devDbName = new URL(devDatabaseUrl).pathname.slice(1);

        parsed.pathname = "/postgres";
        const client = new Client({ connectionString: parsed.toString() });
        await client.connect();
        try {
            const res = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [devDbName]);
            if (res.rowCount === 0) {
                await client.query(`CREATE DATABASE "${devDbName}"`);
                out(chalk.gray(`  ✓ Created validation database "${devDbName}"`));

                return true;
            }
        } finally {
            await client.end();
        }
    } catch (err) {
        outWarn(describeDevDatabaseFailure(err, devDbName || "<db>_dev_diff"));
    }

    return false;
}

/**
 * What went wrong creating the scratch database, and what to do about it.
 *
 * Exported for its test: the `42501` branch is the one that matters and it
 * cannot be provoked without a non-superuser role.
 */
export function describeDevDatabaseFailure(err: unknown, devDbName: string): string {
    const code = (err as { code?: string } | null)?.code;
    const message = err instanceof Error ? err.message : String(err);

    const lines = [
        chalk.yellow(`  ⚠  Could not create the Atlas scratch database "${devDbName}": ${message}`)
    ];
    if (code === "42501") {
        lines.push(chalk.gray(
            "     Atlas plans every change in a throwaway copy of the schema, and CREATE DATABASE\n" +
            "     is a privilege most managed providers withhold. Two ways forward:\n" +
            `       • GRANT the role CREATEDB:  ALTER ROLE "<role>" CREATEDB;\n` +
            `       • or create it once by hand:  CREATE DATABASE "${devDbName}";`
        ));
    } else {
        lines.push(chalk.gray("     Atlas will fail next with `database \"" + devDbName + "\" does not exist (3D000)`, which is this."));
    }

    return lines.join("\n");
}

/**
 * Drop the scratch database again, after the command that needed it succeeded.
 *
 * It is a full copy of the schema — no rows, but every table, type and index —
 * and it was left behind per target forever. The only notice anyone got was
 * `rebase db branch prune` reporting "3 Atlas scratch database(s) left over
 * from db push", and on a provider that bills per database it is a silent cost.
 *
 * Deliberately NOT called on the failure path: after a failed push the scratch
 * database holds the state Atlas was planning against, which is the one thing
 * worth inspecting.
 */
export async function dropDevDatabase(databaseUrl: string, devDatabaseUrl: string): Promise<void> {
    try {
        const { Client } = await import("pg");
        const parsed = new URL(databaseUrl);
        const devDbName = new URL(devDatabaseUrl).pathname.slice(1);

        parsed.pathname = "/postgres";
        const client = new Client({ connectionString: parsed.toString() });
        await client.connect();
        try {
            await client.query(`DROP DATABASE IF EXISTS "${devDbName}"`);
            out(chalk.gray(`  ✓ Removed validation database "${devDbName}"`));
        } finally {
            await client.end();
        }
    } catch (err) {
        // Not fatal, and not silent: the push has already succeeded, so the
        // worst case is one database left where `prune` can find it.
        outWarn(chalk.gray(
            `  ⚠  Could not remove the Atlas scratch database: ${err instanceof Error ? err.message : String(err)}\n` +
            "     `rebase db branch prune --include-dev-diff` clears them."
        ));
    }
}

/**
 * The generated SQL for the project's `search` blocks, if it has any.
 *
 * @param sqlDir directory holding the generated SQL. Defaults to
 *        `.rebase/sql` under the working directory.
 */
export function readSearchDdl(sqlDir: string = generatedSqlDir()): string {
    const searchFile = path.join(sqlDir, "search.sql");
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
    sqlDir: string = generatedSqlDir()
): Promise<void> {
    const sql = readSearchDdl(sqlDir);
    if (!sql) return;

    await withAppClient(databaseUrl, client => client.query(sql));
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
 * Every `generated column → column it reads` edge in the database.
 *
 * Read from `pg_depend` rather than by matching names in the expression text:
 * a generated column's `pg_attrdef` row carries one `deptype = 'n'` dependency
 * per column its expression references, which is the catalogue's own answer and
 * cannot be fooled by a column name that also appears inside a string literal
 * or as part of a longer identifier.
 *
 * Used by `db push` to find what has to come out of the way before Atlas runs —
 * see `generated-column-conflicts.ts` for why that is necessary at all.
 */
export async function queryGeneratedColumnDependencies(
    databaseUrl: string
): Promise<GeneratedColumnDependency[]> {
    return withAppClient(databaseUrl, async client => {
        const res = await client.query(`
            SELECT n.nspname       AS "schema",
                   c.relname       AS "table",
                   gen.attname     AS "column",
                   dep.attname     AS "dependsOn"
            FROM pg_attrdef ad
            JOIN pg_class c         ON c.oid = ad.adrelid
            JOIN pg_namespace n     ON n.oid = c.relnamespace
            JOIN pg_attribute gen   ON gen.attrelid = ad.adrelid AND gen.attnum = ad.adnum
            JOIN pg_depend d        ON d.classid = 'pg_attrdef'::regclass
                                   AND d.objid = ad.oid
                                   AND d.refclassid = 'pg_class'::regclass
                                   AND d.refobjid = ad.adrelid
                                   AND d.deptype = 'n'
            JOIN pg_attribute dep   ON dep.attrelid = ad.adrelid AND dep.attnum = d.refobjsubid
            WHERE gen.attgenerated <> ''
              AND NOT gen.attisdropped
              AND NOT dep.attisdropped;
        `);
        return res.rows as GeneratedColumnDependency[];
    });
}

/**
 * Every column in the database with its current type, for the destructive
 * gate to tell a widening `ALTER COLUMN … TYPE` from one that loses data.
 */
export async function queryColumnTypes(databaseUrl: string): Promise<ExistingColumnType[]> {
    return withAppClient(databaseUrl, async client => (await client.query<ExistingColumnType>(COLUMN_TYPES_SQL)).rows);
}

/**
 * Drop the generated columns standing in the way of an apply.
 *
 * Their indexes and their `COMMENT ON COLUMN` stamp go with them, which is
 * exactly right: `applySearchDdl` rebuilds all three from `search.sql` and a
 * surviving stamp would make the rebuilt column look like drift.
 */
export async function dropGeneratedColumns(
    databaseUrl: string,
    statements: string[]
): Promise<void> {
    if (statements.length === 0) return;
    await withAppClient(databaseUrl, async client => {
        for (const statement of statements) {
            await client.query(statement);
        }
    });
}

/**
 * The generated SQL for the project's `vector` properties, if it has any.
 *
 * @param sqlDir directory holding the generated SQL. Defaults to
 *        `.rebase/sql` under the working directory.
 */
export function readVectorDdl(sqlDir: string = generatedSqlDir()): string {
    const vectorFile = path.join(sqlDir, "vector.sql");
    if (!fs.existsSync(vectorFile)) return "";
    return fs.readFileSync(vectorFile, "utf-8").trim();
}

/**
 * Install pgvector and bring the vector columns and their ANN indexes up to
 * date.
 *
 * Runs *after* Atlas, like {@link applySearchDdl} and for the same reason: the
 * statements are `ALTER TABLE … ADD COLUMN`, so the table has to exist. Atlas
 * is told to ignore these objects entirely ({@link getVectorExcludes}) — it
 * cannot manage a type its dev database is structurally incapable of having,
 * and left to itself it would plan a `DROP COLUMN` for every one.
 *
 * A no-op when no collection declares a `vector` property. A failure is *not*
 * swallowed: a push that reported success while the embedding column never
 * appeared is how a project ends up with vector search configured, no error
 * anywhere, and no results.
 */
export async function applyVectorDdl(
    databaseUrl: string,
    sqlDir: string = generatedSqlDir()
): Promise<void> {
    const sql = readVectorDdl(sqlDir);
    if (!sql) return;

    const { vectorExtensionHint } = await import("./schema/vector-index");
    try {
        await withAppClient(databaseUrl, client => client.query(sql));
    } catch (err) {
        // The boot ensure explains this failure and the push has to as well —
        // it is the same missing extension, and a push is the *more* likely
        // place to meet it. Without this the developer gets a bare
        // `type "vector" does not exist`, which names nothing they can act on
        // and reads like a broken database rather than a line of config.
        const message = err instanceof Error ? err.message : String(err);
        const hint = vectorExtensionHint(message);
        if (!hint) throw err;
        throw new Error(`${message}${hint}`, { cause: err });
    }
    out(chalk.gray("  ✓ Applied vector columns and ANN indexes"));
}

/**
 * Glob patterns keeping Atlas away from the vector objects.
 *
 * Returns an empty list — and so changes nothing — for a project with no
 * `vector` property, which is every project that has not opted in.
 */
export async function getVectorExcludes(collectionsPath: string): Promise<string[]> {
    const { vectorExcludePatterns } = await import("./schema/generate-postgres-ddl-logic");
    return vectorExcludePatterns(await loadCollectionsForCli(collectionsPath));
}

/**
 * The generated SQL for the project's `autoValue: "on_update"` properties, if
 * it has any.
 *
 * @param sqlDir directory holding the generated SQL. Defaults to
 *        `.rebase/sql` under the working directory.
 */
export function readTriggersDdl(sqlDir: string = generatedSqlDir()): string {
    const triggersFile = path.join(sqlDir, "triggers.sql");
    if (!fs.existsSync(triggersFile)) return "";
    return fs.readFileSync(triggersFile, "utf-8").trim();
}

/**
 * Install the `updated_at` trigger function and bind it to every column that
 * asked for one.
 *
 * Runs *after* Atlas, like {@link applySearchDdl} and {@link applyVectorDdl}:
 * a trigger needs its table and its column to exist. Atlas is told to ignore
 * the triggers ({@link getTriggerExcludes}) because it cannot manage a function
 * at all — its free tier refuses to parse a desired state containing one.
 *
 * A no-op when no property declares `autoValue: "on_update"`. A failure is
 * *not* swallowed: a push that reported success while the trigger never
 * appeared is how `updated_at` ends up silently stale for every writer that is
 * not the driver, which is the whole reason the trigger exists.
 */
export async function applyTriggersDdl(
    databaseUrl: string,
    sqlDir: string = generatedSqlDir()
): Promise<void> {
    const sql = readTriggersDdl(sqlDir);
    if (!sql) return;

    await withAppClient(databaseUrl, client => client.query(sql));
    out(chalk.gray("  ✓ Applied `updated_at` triggers"));
}

/** @see getSearchExcludes */
export async function getTriggerExcludes(collectionsPath: string): Promise<string[]> {
    const { triggerExcludePatterns } = await import("./schema/generate-postgres-ddl-logic");
    return triggerExcludePatterns(await loadCollectionsForCli(collectionsPath));
}

/**
 * Query the live database for every user table/view outside the system
 * catalogs. Separated from {@link getTableExcludes} so its failure mode can
 * be handled explicitly (fail closed) and so tests can inject a stub.
 */
/** An index as the catalogue names it: its schema, its table and its own name. */
export interface ExistingIndex {
    schema: string;
    table: string;
    index: string;
}

/**
 * Every index Postgres holds on a table, by its parts — never joined with `.`,
 * which a name may itself contain.
 *
 * Constraint-backed indexes are left out: a `PRIMARY KEY` or a `UNIQUE` is a
 * *constraint* to Atlas, diffed from the constraint declaration, and naming its
 * index in an exclude would shield the constraint itself.
 */
export async function queryExistingIndexes(databaseUrl: string): Promise<ExistingIndex[]> {
    return withAppClient(databaseUrl, async client => {
        const res = await client.query<ExistingIndex>(`
            SELECT n.nspname AS "schema", t.relname AS "table", i.relname AS "index"
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
        return res.rows;
    });
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
 * reports no error — the trap already recorded for the search excludes. And
 * spelled by `atlasExcludePattern`: a raw `orders_idx[v1]` is a glob that
 * matches `orders_idxv`, so that index was dropped with no prompt.
 */
export async function getForeignIndexExcludes(
    databaseUrl: string,
    collectionsPath: string,
    deps: {
        queryExistingIndexes?: (databaseUrl: string) => Promise<ExistingIndex[]>;
        getManagedIndexNames?: (collectionsPath: string) => Promise<Set<string>>;
    } = {}
): Promise<string[]> {
    const queryIndexes = deps.queryExistingIndexes ?? queryExistingIndexes;
    const getManaged = deps.getManagedIndexNames ?? managedIndexNames;

    const managed = await getManaged(collectionsPath);

    let existing: ExistingIndex[];
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

    return existing
        .filter(({ index }) => {
            if (managed.has(index)) return false;   // ours, and still declared
            return !isRebaseIndexName(index);       // ours, but no longer declared -> let it drop
        })
        .map(({ schema, table, index }) => atlasExcludePattern(schema, table, index));
}

/**
 * The index names the current collections would create — search, vector and
 * declared alike. Anything Atlas would emit is by definition not foreign.
 */
async function managedIndexNames(collectionsPath: string): Promise<Set<string>> {
    const collections = await loadCollectionsForCli(collectionsPath);
    const { searchExcludePatterns, vectorExcludePatterns } =
        await import("./schema/generate-postgres-ddl-logic");
    const { resolveColumnName } = await import("./schema/column-plan-helpers");
    const { buildCollectionIndexPlan } = await import("./schema/collection-index");

    const names = new Set<string>(
        buildCollectionIndexPlan(collections, resolveColumnName).map(spec => spec.indexName)
    );
    // Search and vector objects are excluded from Atlas wholesale by their own
    // patterns; listing them here too is harmless and keeps this the single
    // answer to "is this index one of ours". The doc comment above claimed
    // vector was here long before it was — so an ANN index answered that
    // question with "somebody else's".
    for (const pattern of [...searchExcludePatterns(collections), ...vectorExcludePatterns(collections)]) {
        const object = excludePatternParts(pattern)?.[2];
        if (object !== undefined) names.add(object);
    }
    return names;
}

/** Every CHECK and EXCLUDE constraint the database holds. @see UNDECLARABLE_CONSTRAINTS_SQL */
export async function queryUndeclarableConstraints(databaseUrl: string): Promise<ExistingConstraint[]> {
    return withAppClient(databaseUrl, async client =>
        (await client.query<ExistingConstraint>(UNDECLARABLE_CONSTRAINTS_SQL)).rows);
}

/**
 * Patterns keeping Atlas away from the CHECK and EXCLUDE constraints the
 * collections do not declare — which, since a collection cannot declare
 * either, is all of them. See `schema/undeclarable-constraints.ts`.
 *
 * Fails CLOSED, like {@link getTableExcludes}: without the catalogue nothing
 * says which constraints are there, and a partial list lets the push drop a
 * rule the database enforces. `desiredSql` is the `schema.sql` Atlas is about
 * to diff against; a constraint it declares is Atlas's to manage.
 */
export async function getUndeclaredConstraintExcludes(
    databaseUrl: string,
    desiredSql: string,
    deps: { queryConstraints?: (databaseUrl: string) => Promise<ExistingConstraint[]> } = {}
): Promise<string[]> {
    const queryConstraints = deps.queryConstraints ?? queryUndeclarableConstraints;
    let existing: ExistingConstraint[];
    try {
        existing = await queryConstraints(databaseUrl);
    } catch (err) {
        throw new ExcludeIntrospectionError(
            `Failed to introspect the database for CHECK and EXCLUDE constraints: ${err instanceof Error ? err.message : String(err)}`,
            err
        );
    }
    return undeclaredConstraintExcludes(existing, desiredSql);
}

/** A table or view as the catalogue names it. */
export interface ExistingTable {
    schema: string;
    table: string;
}

export async function queryExistingTables(databaseUrl: string): Promise<ExistingTable[]> {
    return withAppClient(databaseUrl, async client => {
        const res = await client.query<ExistingTable>(`
            SELECT table_schema AS "schema", table_name AS "table"
            FROM information_schema.tables
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
              AND table_type IN ('BASE TABLE', 'VIEW');
        `);
        return res.rows;
    });
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
        queryExistingTables?: (databaseUrl: string) => Promise<ExistingTable[]>;
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

    let existingTables: ExistingTable[];
    try {
        existingTables = await queryTables(databaseUrl);
    } catch (err) {
        throw new ExcludeIntrospectionError(
            `Failed to introspect the database for unmapped tables: ${err instanceof Error ? err.message : String(err)}`,
            err
        );
    }

    for (const { schema, table } of existingTables) {
        if (!includes.includes(`${schema}.${table}`)) {
            excludes.push(atlasExcludePattern(schema, table));
        }
    }

    return excludes;
}

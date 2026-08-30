import arg from "arg";
import chalk from "chalk";
import { execa } from "execa";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { logger } from "@rebasepro/server";
import { out, outWarn, outError } from "./cli-output";
import { formatRelativeTime } from "@rebasepro/utils";
import {
    diagnoseMissingBin,
    resolveLocalBin,
    getTableIncludes,
    getDevDatabaseUrl,
    ensureDevDatabaseExists,
    applySearchDdl,
    getSearchExcludes,
    readSearchDdl,
    applyVectorDdl,
    getVectorExcludes,
    readVectorDdl,
    getTableExcludes,
    getForeignIndexExcludes,
    ExcludeIntrospectionError,
    promptConfirm
} from "./cli-helpers";
import { checkDatabaseConnectivity, diagnoseDbError } from "./cli-errors";
import { forLibpq } from "./utils/connection-string";
import { dropLegacyAuthSchema, RLS_BOOTSTRAP_SQL } from "./schema/rls-bootstrap-sql";
import { detectDestructiveStatements, decidePushSafety } from "./schema/destructive-sql";
import { stripCarvedOutStatements } from "./schema/carved-out-migration";
import { acceptsExcludeFlag, buildAtlasArgs } from "./schema/atlas-argv";

const __cliDirname = path.dirname(fileURLToPath(import.meta.url));



async function loadEnv(): Promise<void> {
    try {
        const dotenv = await import("dotenv");
        const envPaths = [
            process.env.DOTENV_CONFIG_PATH,
            path.resolve(process.cwd(), ".env"),
            path.resolve(process.cwd(), "../.env"),
            path.resolve(process.cwd(), "../../.env")
        ].filter(Boolean) as string[];

        for (const p of envPaths) {
            if (fs.existsSync(p)) {
                const parsed = dotenv.config({ path: p, quiet: true });
                if (parsed.parsed) {
                    for (const [key, val] of Object.entries(parsed.parsed)) {
                        if (process.env[key] === undefined) {
                            process.env[key] = val;
                        }
                    }
                    break;
                }
            }
        }
    } catch {
        // ignore
    }
}

export async function runPluginCommand(args: string[]) {
    // Also set as an environment variable, not just per `config()` call: this
    // command spawns `tsx` subprocesses (the schema generator, the DDL
    // generator, doctor) that load `.env` themselves, and they inherit this.
    // dotenv reads it before `options.quiet`; an explicit `false` still wins.
    if (process.env.DOTENV_CONFIG_QUIET === undefined) {
        process.env.DOTENV_CONFIG_QUIET = "true";
    }
    await loadEnv();
    const domain = args[0]; // "db" or "schema"
    const subcommand = args[1];

    if (domain === "db") {
        await dbCommand(subcommand, args);
    } else if (domain === "schema") {
        await schemaCommand(subcommand, args);
    } else if (domain === "doctor") {
        await doctorPluginCommand(args);
    } else {
        outError(chalk.red(`Unknown domain command: ${domain}`));
        process.exit(1);
    }
}

/** The migration files on disk, sorted, or none if the directory is absent. */
function listMigrationFiles(): string[] {
    const dir = path.resolve(process.cwd(), "drizzle", "migrations");
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
}

/**
 * Take Atlas's carve-outs back out of the migration `migrate diff` just wrote.
 *
 * The apply path hands Atlas `--exclude` and it never sees the search or vector
 * columns. The diff path has no such flag — `atlas migrate diff` rejects
 * `--exclude` outright, and an `atlas.hcl` `env` block's `exclude` is accepted
 * and then ignored — so Atlas replays the migration directory (which builds
 * both columns, because that DDL is appended to migrations), does not find them
 * in `schema.sql`, and plans `DROP COLUMN`. Applied, that would take search and
 * the embeddings away from every database the migration reaches.
 *
 * Returns whether a migration Atlas just wrote is still there afterwards: a
 * file whose only content was the spurious drop is deleted, because an empty
 * migration is worse than none — it takes a slot in the revision history and
 * the caller would append the carved-out DDL and the policies to it.
 *
 * @returns true when a new migration survives and may be appended to.
 */
async function stripCarvedOutFromNewestMigration(collectionsPath: string): Promise<boolean> {
    // Both carve-outs, for one reason: they are the same problem. Search is out
    // of Atlas's sight because its free tier will not parse a function; vector
    // is out because Atlas resolves the desired state in a dev database that
    // can never have pgvector. What follows from that is identical — the diff
    // replays a migration directory holding objects `schema.sql` omits, and
    // plans a drop for every one.
    const patterns = [
        ...await getSearchExcludes(collectionsPath),
        ...await getVectorExcludes(collectionsPath)
    ];
    if (patterns.length === 0) return true;

    const newest = listMigrationFiles().at(-1);
    if (!newest) return false;
    const file = path.resolve(process.cwd(), "drizzle", "migrations", newest);

    const result = stripCarvedOutStatements(fs.readFileSync(file, "utf-8"), patterns);

    // Fail CLOSED, and loudly. A drop this could not rewrite stays in the file
    // exactly as Atlas wrote it, and the file is one somebody applies next week
    // — by which time the column is gone and nothing connects it to this run.
    // The destructive gate does not cover it either: that reads the *push*
    // plan. So `db generate` stops here rather than hand back a migration that
    // destroys a column the developer never asked to lose.
    if (result.unhandled.length > 0) {
        outError(chalk.red(
            `\n  ✗ ${newest} drops an object Rebase manages outside Atlas, in a form the CLI`
        ));
        outError(chalk.red("    could not remove:"));
        for (const statement of result.unhandled) {
            outError(chalk.gray(`       ${statement.replace(/\s+/g, " ")}`));
        }
        outError(chalk.gray(
            "    Left as Atlas wrote it. Delete those statements by hand before running\n" +
            "    `rebase db migrate` — and please report them: rewriting this is meant to\n" +
            "    be automatic."
        ));
        process.exit(1);
    }

    if (result.removed.length === 0) return true;

    if (result.empty) {
        fs.rmSync(file);
        out(chalk.gray(
            `  ✓ Dropped ${newest} — it planned nothing but the removal of the search column,\n` +
            "    which Atlas cannot see and Rebase applies itself."
        ));
    } else {
        fs.writeFileSync(file, result.sql, "utf-8");
        out(chalk.gray(`  ✓ Kept the search column out of ${newest} (${result.removed.length} statement(s))`));
    }

    await runAtlas("migrate", ["hash", "--dir", "file://drizzle/migrations"], collectionsPath);
    return !result.empty;
}

async function dbCommand(subcommand: string, rawArgs: string[]): Promise<void> {
    const VALID_ACTIONS = ["push", "generate", "migrate", "branch", "backup", "restore", "backups"];
    if (!subcommand || !VALID_ACTIONS.includes(subcommand)) {
        outError(chalk.red(`Unknown db command. Valid: ${VALID_ACTIONS.join(", ")}`));
        process.exit(1);
    }

    if (subcommand === "branch") {
        await branchCommand(rawArgs);
        return;
    }

    if (subcommand === "backup" || subcommand === "restore" || subcommand === "backups") {
        const { backupCommand, restoreCommand, backupsCommand } = await import("./backup/backup-cli");
        if (subcommand === "backup") await backupCommand(rawArgs);
        else if (subcommand === "restore") await restoreCommand(rawArgs);
        else await backupsCommand(rawArgs);
        return;
    }

    const argsList = arg(
        {
            "--collections": String,
            "--allow-destructive": Boolean,
            "--yes": Boolean,
            "-c": "--collections",
            "-y": "--yes"
        },
        {
            argv: rawArgs.slice(2),
            permissive: true
        }
    );
    const collectionsPath = argsList["--collections"] || path.join("..", "config", "collections");

    if (subcommand === "generate") {
        out("");
        out(chalk.bold("  📦 Rebase DB Generate"));
        out(chalk.gray("  Step 1/2: Generating Drizzle schema & Postgres DDL from collections..."));
        out("");
        await schemaCommand("generate", rawArgs);
        await generatePostgresDdlCommand(rawArgs);
        out("");
        out(chalk.gray("  Step 2/2: Generating SQL migration files with Atlas..."));
        out("");
        const migrationName = argsList._[0] || "migration";
        const migrationsBefore = listMigrationFiles();
        await runAtlas("migrate", ["diff", migrationName, "--dir", "file://drizzle/migrations", "--to", "file://drizzle/schema.sql"], collectionsPath);
        // The diff cannot be told to ignore the carved-out objects the way the
        // apply can, so the drop it plans for them is taken back out of the
        // file it just wrote. A migration that was nothing else is deleted.
        let wroteNewMigration = listMigrationFiles().length > migrationsBefore.length;
        if (wroteNewMigration) {
            wroteNewMigration = await stripCarvedOutFromNewestMigration(collectionsPath);
        }
        
        // Post-process the migration Atlas just wrote.
        //
        // `wroteNewMigration` gates the whole block, and that gate is the point.
        // "The newest migration file" is only Atlas's when Atlas wrote one;
        // otherwise it is a migration that has already run in production, and
        // appending to it changes a hash Atlas has recorded while the appended
        // SQL never runs anywhere. The search half already said so and checked;
        // the `CREATE SCHEMA` rewrite and the policy append did not, so every
        // `db generate` that found nothing to diff still grew the last
        // migration by another copy of the policies.
        try {
            const migrationsDir = path.resolve(process.cwd(), "drizzle", "migrations");
            if (fs.existsSync(migrationsDir) && wroteNewMigration) {
                const files = fs.readdirSync(migrationsDir);
                const sqlFiles = files
                    .filter(f => f.endsWith(".sql"))
                    .sort();
                if (sqlFiles.length > 0) {
                    const newestMigrationFile = path.join(migrationsDir, sqlFiles[sqlFiles.length - 1]);

                    // Make CREATE SCHEMA idempotent so it doesn't conflict with
                    // --revisions-schema (Atlas pre-creates the rebase schema
                    // for its revision table before running migrations).
                    let migrationContent = fs.readFileSync(newestMigrationFile, "utf-8");
                    migrationContent = migrationContent.replace(
                        /CREATE SCHEMA (?!IF NOT EXISTS)("[^"]+");/g,
                        "CREATE SCHEMA IF NOT EXISTS $1;"
                    );
                    // Atlas never writes the search or vector objects into a
                    // migration — it is not shown them — so a migration
                    // replayed against a fresh database would build every table
                    // except the parts that make search and vector search work.
                    // Appending, because these are `ALTER TABLE ... ADD COLUMN`
                    // over the tables the migration just created.
                    //
                    // Vector first: `vector.sql` may open with
                    // `CREATE EXTENSION vector`, so prerequisites lead, which is
                    // the order a reader of the migration expects. Nothing in
                    // search depends on it either way.
                    const vectorContent = readVectorDdl();
                    if (vectorContent) {
                        migrationContent = `${migrationContent}\n\n${vectorContent}`;
                        out(chalk.gray("  ✓ Appended vector DDL to the migration"));
                    }

                    const searchContent = readSearchDdl();
                    if (searchContent) {
                        migrationContent = `${migrationContent}\n\n${searchContent}`;
                        out(chalk.gray("  ✓ Appended search DDL to the migration"));
                    }

                    fs.writeFileSync(newestMigrationFile, migrationContent, "utf-8");

                    // Append RLS policies, preceded by the RLS bootstrap so the
                    // migration is self-contained: Atlas replays migrations
                    // against a clean dev database where `rebase.uid()` would
                    // not otherwise exist.
                    const policiesFile = path.resolve(process.cwd(), "drizzle", "policies.sql");
                    if (fs.existsSync(policiesFile)) {
                        const policiesContent = fs.readFileSync(policiesFile, "utf-8");
                        fs.appendFileSync(newestMigrationFile, "\n\n" + RLS_BOOTSTRAP_SQL + "\n" + policiesContent);
                        out(chalk.gray(`  ✓ Appended RLS policies to migration file: ${path.basename(newestMigrationFile)}`));

                        // Re-hash the migration directory
                        out(chalk.gray("  Re-hashing migration files..."));
                        await runAtlas("migrate", ["hash", "--dir", "file://drizzle/migrations"], collectionsPath);
                        out(chalk.gray("  ✓ Migration directory checksum updated successfully."));
                    }
                }
            }
        } catch (err) {
            outWarn(chalk.yellow(`  ⚠️  Failed to append policies or re-hash migration: ${err instanceof Error ? err.message : String(err)}`));
        }

        if (!wroteNewMigration) {
            // Reachable whenever the only thing that changed is something Atlas
            // cannot see — a `search` block, a `vector` property, or a
            // `securityRules` edit. There is no new file to carry it, and the
            // previous migration must not be reopened: it has already run
            // wherever this project is deployed.
            out(chalk.gray(
                "  ℹ No migration written — nothing in this change is visible to Atlas.\n" +
                "    Search, vector and RLS DDL are applied by `rebase db push`, and at boot by\n" +
                "    the schema ensure. For a migration-only deployment, add drizzle/search.sql,\n" +
                "    drizzle/vector.sql and drizzle/policies.sql to a migration by hand."
            ));
        }

        out("");
        out(`  You can now run ${chalk.bold.green("rebase db migrate")} to apply the migrations to your database.`);
        out("");
    } else {
        out("");
        out(chalk.bold(`  🗄️  Rebase DB ${subcommand.charAt(0).toUpperCase() + subcommand.slice(1)}`));
        out("");

        if (subcommand === "push") {
            out(chalk.gray("  Step 1/3: Generating Drizzle schema & Postgres DDL from collections..."));
            out("");
            await schemaCommand("generate", rawArgs);
            await generatePostgresDdlCommand(rawArgs);
            out("");
            out(chalk.gray("  Step 2/3: Pushing schema to database with Atlas..."));
            out("");
            const databaseUrl = process.env.DATABASE_URL;
            if (databaseUrl) {
                await ensureAuthSchemaAndFunctions(databaseUrl);
            }

            // Preview the plan before touching data. `atlas schema apply` with
            // --auto-approve will silently DROP COLUMN on a field removal and
            // drop+add on a rename, so we first dry-run to obtain the planned
            // SQL and gate anything destructive.
            const plan = await runAtlas(
                "schema",
                ["apply", "--to", "file://drizzle/schema.sql", "--dry-run"],
                collectionsPath,
                { captureStdout: true }
            );
            const destructive = detectDestructiveStatements(plan);
            const allowDestructive = argsList["--allow-destructive"] === true || argsList["--yes"] === true;
            const decision = decidePushSafety({
                destructiveCount: destructive.length,
                allowDestructive,
                interactive: process.stdin.isTTY === true
            });

            if (destructive.length > 0) {
                outWarn(chalk.yellow(`  ⚠️  This push includes ${destructive.length} destructive change(s) that will DESTROY data:`));
                outWarn("");
                for (const d of destructive) {
                    outWarn(chalk.red(`       ${d.kind}: `) + chalk.gray(d.statement.replace(/\s+/g, " ")));
                }
                outWarn("");
                outWarn(chalk.yellow("  Full planned changes:"));
                outWarn(chalk.gray(plan.trim().split("\n").map((l) => `       ${l}`).join("\n")));
                outWarn("");

                if (decision === "refuse") {
                    outError(chalk.red("  ✗ Aborting: destructive changes require confirmation."));
                    outError(chalk.gray("    Re-run interactively, or pass --allow-destructive to proceed. Back up first: rebase db backup"));
                    process.exit(1);
                }
                if (decision === "confirm") {
                    const confirmed = await promptConfirm(
                        chalk.yellow("  Type 'yes' to apply these destructive changes (this cannot be undone): ")
                    );
                    if (!confirmed) {
                        out(chalk.gray("  Aborted. No changes were made."));
                        process.exit(1);
                    }
                } else {
                    // decision === "apply" via --allow-destructive
                    outWarn(chalk.yellow("  Proceeding because --allow-destructive was passed."));
                }
            }

            await runAtlas("schema", ["apply", "--to", "file://drizzle/schema.sql", "--auto-approve"], collectionsPath);
            out("");
            
            if (databaseUrl) {
                await ensureAuthTables(databaseUrl, collectionsPath);
                // After the tables exist and before the policies: the vector and
                // search columns are `ALTER TABLE ... ADD COLUMN`, and a policy
                // may reference the table they are added to.
                await applyVectorDdl(databaseUrl);
                await applySearchDdl(databaseUrl);
                await applyPolicies(databaseUrl);
                await reconcilePolicies(databaseUrl, collectionsPath);
                await ensureRlsUserRole(databaseUrl);
                await retireLegacyAuthSchema(databaseUrl);
            } else {
                outWarn(chalk.yellow("  ⚠️  DATABASE_URL not found in environment, skipping RLS policies application."));
            }
        } else if (subcommand === "migrate") {
            const databaseUrl = process.env.DATABASE_URL;
            if (databaseUrl) {
                await ensureAuthSchemaAndFunctions(databaseUrl);
            }
            const extraArgs = argsList._.filter(arg => arg !== "migrate");
            await runAtlas("migrate", ["apply", "--dir", "file://drizzle/migrations", ...extraArgs], collectionsPath);
            if (databaseUrl) {
                await ensureRlsUserRole(databaseUrl);
                await retireLegacyAuthSchema(databaseUrl);
            }
        }

        out("");
        out(chalk.green(`  ✓ rebase db ${subcommand} completed successfully.`));
        out("");
    }
}

async function ensureAuthSchemaAndFunctions(databaseUrl: string): Promise<void> {
    try {
        const { Client } = await import("pg");
        const client = new Client({ connectionString: databaseUrl });
        await client.connect();
        try {
            // Creates the `rebase` schema as its first statement, which also
            // covers the schema Atlas puts its revision table in
            // (`--revisions-schema rebase`). That used to need a separate,
            // deliberately migration-stream-excluded statement here, because the
            // helper functions lived in `auth` and creating `rebase` from the
            // preamble would have made Atlas plan a DROP for it. The generator
            // now always declares `rebase` in the desired schema, so there is
            // nothing to keep out.
            await client.query(RLS_BOOTSTRAP_SQL);
        } finally {
            await client.end();
        }
    } catch (err) {
        outWarn(chalk.yellow(`  ⚠️  Failed to bootstrap the RLS helper functions: ${err instanceof Error ? err.message : String(err)}`));
    }
}

/**
 * Create the framework auth tables (e.g. `rebase.users`) that the generated RLS
 * policies reference, before `applyPolicies` runs. Mirrors what the server does
 * at boot (`PostgresBootstrapper.initializeAuth` → `ensureAuthTablesExist`).
 *
 * Without this, `rebase db push` against a database that has never booted the
 * server fails while applying policies with `relation "rebase.users" does not
 * exist` — the documented first-run does `db push` *before* the first `dev`.
 * `ensureAuthTablesExist` is idempotent (CREATE TABLE IF NOT EXISTS), so it is
 * safe to run on every push and harmless once the server has also created them.
 */
async function ensureAuthTables(databaseUrl: string, collectionsPath: string): Promise<void> {
    try {
        const { drizzle } = await import("drizzle-orm/node-postgres");
        const { ensureAuthTablesExist } = await import("./auth/ensure-tables");
        const { loadCollections } = await import("./schema/doctor");
        const { Client } = await import("pg");

        const collections = await loadCollections(path.resolve(process.cwd(), collectionsPath));
        // The auth collection is flagged with `auth: true` or `auth: { enabled: true }`.
        const authCollection = collections.find((c) => {
            const a = c.auth;
            return a === true || (typeof a === "object" && a !== null && a.enabled === true);
        });

        const client = new Client({ connectionString: databaseUrl });
        await client.connect();
        try {
            await ensureAuthTablesExist(drizzle(client), authCollection);
        } finally {
            await client.end();
        }
    } catch (err) {
        outWarn(chalk.yellow(`  ⚠️  Failed to ensure framework auth tables: ${err instanceof Error ? err.message : String(err)}`));
    }
}

/**
 * Provision the restricted `rebase_user` role right after schema changes land,
 * so grants cover freshly created tables (default privileges cover future
 * ones). Only needed — and only possible without extra setup — when the
 * connection would bypass RLS (superuser / BYPASSRLS / table owner).
 */
async function ensureRlsUserRole(databaseUrl: string): Promise<void> {
    // Every failure in here used to escape uncaught, and `db migrate`'s caller
    // turns that into a bare `process.exit(1)` — so the migration would apply,
    // print `-- ok`, and then the command would die with NO output whatsoever
    // and a non-zero status. Seen with a module-resolution error inside the
    // dynamic import, where the entire diagnosis was one silent exit code.
    //
    // Reported rather than rethrown, and deliberately not fatal: the schema
    // change has already landed at this point, so failing the command implies a
    // rollback that did not happen. What is actually lost is the role
    // provisioning, and the message says so and how to finish it by hand.
    // No `auth`: the RLS helpers live in `rebase` now, and a schema the
    // framework no longer creates must not be granted on — on a Supabase
    // database that would hand the end-user role USAGE on their auth schema.
    const schemas = ["public", "rebase"];
    let rls: typeof import("./security/rls-enforcement");
    try {
        rls = await import("./security/rls-enforcement");
    } catch (err) {
        // A module-resolution failure here is a build problem, not a database
        // one, and it is exactly the case that used to produce the silent exit.
        outError(chalk.red(
            `\n  ✗ Could not load the RLS provisioning module: ${err instanceof Error ? err.message : String(err)}`
        ));
        return;
    }

    try {
        const { Client } = await import("pg");
        const client = new Client({ connectionString: databaseUrl });
        await client.connect();
        try {
            const runSql = async (text: string) => (await client.query(text)).rows as Record<string, unknown>[];
            const posture = await rls.detectConnectionPosture(runSql);
            if (posture.privileged) {
                await rls.ensureAppRole(runSql, schemas);
                out(chalk.gray(`  ✓ RLS role "${rls.REBASE_USER_ROLE}" provisioned/refreshed.`));
            }
        } finally {
            await client.end();
        }
    } catch (err) {
        outError(chalk.red(
            `\n  ✗ The schema change was applied, but the "${rls.REBASE_USER_ROLE}" role could not be ` +
            `provisioned: ${err instanceof Error ? err.message : String(err)}`
        ));
        outError(chalk.gray(rls.appRoleSetupInstructions("your database user", schemas)));
    }
}

/**
 * Retire the pre-1.0 `auth` schema, once nothing depends on it any more.
 *
 * Runs last on purpose. Postgres refuses to drop a function an RLS policy still
 * calls, so this only succeeds after the policies above have been rewritten to
 * `rebase.uid()`. See `dropLegacyAuthSchema` for what it reports when something
 * hand-written is still holding the schema open, and DROP_LEGACY_AUTH_SCHEMA_SQL
 * for the guards that keep it off a Supabase `auth` schema.
 */
async function retireLegacyAuthSchema(databaseUrl: string): Promise<void> {
    try {
        const { Client } = await import("pg");
        const client = new Client({ connectionString: databaseUrl });
        await client.connect();
        try {
            await dropLegacyAuthSchema(
                async (text) => (await client.query(text)).rows as Record<string, unknown>[],
                {
                    info: (m) => out(chalk.gray(`  ${m}`)),
                    warn: (m) => outWarn(chalk.yellow(`  ⚠️  ${m}`))
                }
            );
        } finally {
            await client.end();
        }
    } catch {
        // Connection-level failure only; the schema is inert either way.
    }
}

async function applyPolicies(databaseUrl: string): Promise<void> {
    try {
        const policiesPath = path.resolve(process.cwd(), "drizzle", "policies.sql");
        if (!fs.existsSync(policiesPath)) return;
        
        out(chalk.gray("  Step 3/3: Applying RLS policies to database..."));
        out("");
        
        const policiesContent = fs.readFileSync(policiesPath, "utf-8");
        const { Client } = await import("pg");
        const client = new Client({ connectionString: databaseUrl });
        await client.connect();
        try {
            await client.query(policiesContent);
            out(chalk.green("  ✓ RLS policies applied successfully."));
        } finally {
            await client.end();
        }
    } catch (err) {
        const hint = diagnoseDbError(err, databaseUrl);
        if (hint) {
            outError(hint);
        } else {
            outError(chalk.red(`  ✗ Failed to apply RLS policies: ${err instanceof Error ? err.message : String(err)}`));
        }
        process.exit(1);
    }
}

/**
 * Remove the policies an earlier push superseded but never dropped.
 *
 * `policies.sql` only DROPs the names it is about to CREATE, and a rule's
 * generated name contains a hash of its own semantics — so editing a rule
 * writes a *new* policy and abandons the old one. Postgres ORs PERMISSIVE
 * policies together, which makes an abandoned grant outrank every tightening
 * that replaced it, and push reported success the whole time.
 *
 * Runs after `applyPolicies` so the current policies are already in place: the
 * drift check then sees exactly the set that should survive, and anything else
 * on a managed table is by definition left over.
 */
async function reconcilePolicies(databaseUrl: string, collectionsPath: string): Promise<void> {
    try {
        const { checkPolicyDrift, dropOrphanedPolicies, formatPolicyDrift, hasDrift } =
            await import("./security/policy-drift");
        const { loadCollections } = await import("./schema/doctor");

        const collections = await loadCollections(path.resolve(process.cwd(), collectionsPath));
        const { Client } = await import("pg");
        const client = new Client({ connectionString: databaseUrl });
        await client.connect();
        try {
            const drift = await checkPolicyDrift(client as never, collections);
            const { dropped, kept } = await dropOrphanedPolicies(client as never, drift, collections);

            for (const p of dropped) {
                out(chalk.gray(`  ✓ Dropped superseded policy "${p.name}" on ${p.schema}.${p.table}`));
            }
            if (dropped.length > 0) {
                out(chalk.green(`  ✓ Removed ${dropped.length} superseded RLS ${dropped.length === 1 ? "policy" : "policies"}.`));
            }

            // Custom-named orphans are indistinguishable from policies someone
            // wrote in SQL deliberately, so they are reported, never dropped.
            if (kept.length > 0) {
                outWarn(chalk.yellow("  ⚠️  Policies in the database that no collection describes:"));
                for (const p of kept) {
                    outWarn(chalk.yellow(`       • ${p.schema}.${p.table} → "${p.name}" (${p.command} TO ${p.roles.join(", ")})`));
                }
                outWarn(chalk.yellow("       These still grant access. Drop them by hand if they are stale."));
            }

            // Missing/diverged are not push's to fix, but staying silent about
            // them is how a database ends up not matching its config.
            const remaining = { ...drift, orphaned: kept };
            if (hasDrift(remaining) && (remaining.missing.length > 0 || remaining.diverged.length > 0)) {
                outWarn(chalk.yellow("  ⚠️  RLS policies do not match your collections:"));
                outWarn(formatPolicyDrift({ ...remaining, orphaned: [] }));
            }
        } finally {
            await client.end();
        }
    } catch (err) {
        outWarn(chalk.yellow(`  ⚠️  Could not reconcile RLS policies: ${err instanceof Error ? err.message : String(err)}`));
    }
}

async function branchCommand(rawArgs: string[]): Promise<void> {
    const branchAction = rawArgs[2]; // create, list, delete, info

    if (!branchAction || branchAction === "--help") {
        printBranchHelp();
        return;
    }

    // Load .env for DATABASE_URL
    try {
        const dotenv = await import("dotenv");
        const envPath = process.env.DOTENV_CONFIG_PATH;
        if (envPath) {
            dotenv.config({ path: envPath, quiet: true });
        } else {
            dotenv.config({ quiet: true });
        }
    } catch {
        // dotenv may not be installed
    }

    const databaseUrl = process.env.DATABASE_URL || process.env.ADMIN_CONNECTION_STRING;
    if (!databaseUrl) {
        outError(chalk.red("✗ DATABASE_URL is not set. Make sure your .env file is configured."));
        process.exit(1);
    }

    // Dynamic imports to avoid loading heavy deps when not needed
    const { DatabasePoolManager } = await import("./databasePoolManager");
    const { BranchService } = await import("./services/BranchService");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { Pool } = await import("pg");

    const pool = new Pool({ connectionString: databaseUrl,
max: 3 });
    const db = drizzle(pool);
    const poolManager = new DatabasePoolManager(databaseUrl);
    const branchService = new BranchService(db, poolManager);

    // Ensure metadata table exists
    await branchService.ensureBranchMetadataTable();

    try {
        switch (branchAction) {
            case "create": {
                const name = rawArgs[3];
                if (!name) {
                    outError(chalk.red("✗ Branch name is required."));
                    out(chalk.gray("  Usage: rebase db branch create <name> [--from <source>]"));
                    process.exit(1);
                }
                let source: string | undefined;
                const fromIdx = rawArgs.indexOf("--from");
                if (fromIdx !== -1 && rawArgs[fromIdx + 1]) {
                    source = rawArgs[fromIdx + 1];
                }
                out("");
                out(chalk.bold("  🌿 Creating database branch..."));
                out(chalk.gray(`  Name:   ${name}`));
                if (source) out(chalk.gray(`  Source: ${source}`));
                out("");
                const branch = await branchService.createBranch(name, source ? { source } : undefined);
                out(chalk.green(`  ✓ Branch "${branch.name}" created successfully.`));
                out(chalk.gray(`    Database: rb_${branch.name}`));
                out(chalk.gray(`    Parent:   ${branch.parentDatabase}`));
                out("");
                break;
            }

            case "list": {
                const branches = await branchService.listBranches();
                out("");
                if (branches.length === 0) {
                    out(chalk.gray("  No branches found. Create one with: rebase db branch create <name>"));
                } else {
                    out(chalk.bold(`  🌿 ${branches.length} branch(es):`));
                    out("");
                    for (const b of branches) {
                        const size = b.sizeBytes != null
                            ? chalk.gray(` (${formatBytes(b.sizeBytes)})`)
                            : "";
                        const age = chalk.gray(` — created ${timeAgo(b.createdAt)}`);
                        out(`  ${chalk.green("●")} ${chalk.bold(b.name)}${size}${age}`);
                        out(chalk.gray(`    from ${b.parentDatabase}`));
                    }
                }
                out("");
                break;
            }

            case "delete": {
                const name = rawArgs[3];
                if (!name) {
                    outError(chalk.red("✗ Branch name is required."));
                    out(chalk.gray("  Usage: rebase db branch delete <name>"));
                    process.exit(1);
                }
                out("");
                out(chalk.bold(`  🗑️  Deleting branch "${name}"...`));
                await branchService.deleteBranch(name);
                out(chalk.green(`  ✓ Branch "${name}" deleted.`));
                out("");
                break;
            }

            case "info": {
                const name = rawArgs[3];
                if (!name) {
                    outError(chalk.red("✗ Branch name is required."));
                    out(chalk.gray("  Usage: rebase db branch info <name>"));
                    process.exit(1);
                }
                const info = await branchService.getBranchInfo(name);
                out("");
                if (!info) {
                    outError(chalk.red(`  ✗ Branch "${name}" not found.`));
                } else {
                    out(chalk.bold(`  🌿 Branch: ${info.name}`));
                    out(chalk.gray(`    Database: rb_${info.name}`));
                    out(chalk.gray(`    Parent:   ${info.parentDatabase}`));
                    out(chalk.gray(`    Created:  ${info.createdAt.toISOString()}`));
                    if (info.sizeBytes != null) {
                        out(chalk.gray(`    Size:     ${formatBytes(info.sizeBytes)}`));
                    }
                }
                out("");
                break;
            }

            default:
                outError(chalk.red(`Unknown branch action: "${branchAction}".`));
                printBranchHelp();
                process.exit(1);
        }
    } finally {
        await poolManager.shutdown();
        await pool.end();
    }
}

function printBranchHelp() {
    out(`
${chalk.bold("rebase db branch")} — Database branching commands

${chalk.green.bold("Usage")}
  rebase db branch ${chalk.blue("<command>")} [options]

${chalk.green.bold("Commands")}
  ${chalk.blue.bold("create")} <name> [--from <source>]   Create a new branch
  ${chalk.blue.bold("list")}                              List all branches
  ${chalk.blue.bold("delete")} <name>                     Delete a branch
  ${chalk.blue.bold("info")} <name>                       Show branch details

${chalk.green.bold("Examples")}
  ${chalk.gray("# Create a branch from the current database")}
  rebase db branch create feature_auth

  ${chalk.gray("# Create a branch from a specific source")}
  rebase db branch create staging --from production

  ${chalk.gray("# List all branches")}
  rebase db branch list

  ${chalk.gray("# Delete a branch")}
  rebase db branch delete feature_auth
`);
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** A branch's age, for "…created 6d ago". */
function timeAgo(date: Date): string {
    // No horizon: a branch created a year ago should still report an age here,
    // rather than fall back to a bare date in a one-line list entry.
    return formatRelativeTime(date, { maxMs: Number.POSITIVE_INFINITY }) ?? "unknown";
}



async function runAtlas(
    domain: "schema" | "migrate",
    args: string[],
    collectionsPath?: string,
    opts: { captureStdout?: boolean } = {}
): Promise<string> {
    const atlasBin = resolveLocalBin("atlas");
    if (!atlasBin) {
        // Two very different causes, and the advice for one is a loop for the
        // other — see `diagnoseMissingBin`. This used to say "Install it with:
        // pnpm add -D @ariga/atlas" unconditionally, which is the exact command
        // that produces the far more common of the two states.
        outError(chalk.red("\n✗ The atlas binary is missing, so the schema cannot be applied.\n"));

        if (diagnoseMissingBin("@ariga/atlas") === "build-script-blocked") {
            outError(chalk.yellow("  @ariga/atlas IS installed — only its binary is missing.\n"));
            outError(chalk.gray(
                "  It downloads that binary in a `preinstall` script, and pnpm 10+ does not\n" +
                "  run a dependency's scripts unless you allow it. The install still exits 0,\n" +
                "  so the only sign is `Ignored build scripts: @ariga/atlas` in its output.\n"
            ));
            outError("  Fix it with either:\n");
            outError(chalk.bold("    pnpm approve-builds\n"));
            outError("  or, to record it in the project (what `rebase init` scaffolds):\n");
            outError(chalk.bold(
                "    // package.json\n" +
                "    \"pnpm\": { \"onlyBuiltDependencies\": [\"@ariga/atlas\"] }\n"
            ));
            outError(chalk.gray("  Then re-run `pnpm install`.\n"));
        } else {
            outError(chalk.gray("  It is not installed in this project.\n"));
            outError("  Install it with:\n");
            outError(chalk.bold("    pnpm add -D @ariga/atlas\n"));
            outError(chalk.gray(
                "  If pnpm then reports `Ignored build scripts`, also run `pnpm approve-builds` —\n" +
                "  the package carries a `preinstall` script that fetches the binary.\n"
            ));
        }
        process.exit(1);
    }

    const env = { ...process.env as Record<string, string> };
    try {
        const dotenv = await import("dotenv");
        const envPaths = [
            process.env.DOTENV_CONFIG_PATH,
            path.resolve(process.cwd(), ".env"),
            path.resolve(process.cwd(), "../.env"),
            path.resolve(process.cwd(), "../../.env")
        ].filter(Boolean) as string[];

        for (const p of envPaths) {
            if (fs.existsSync(p)) {
                const parsed = dotenv.config({ path: p, quiet: true });
                if (parsed.parsed) {
                    for (const [key, val] of Object.entries(parsed.parsed)) {
                        if (env[key] === undefined) {
                            env[key] = val;
                        }
                    }
                    break;
                }
            }
        }
    } catch {
        // ignore
    }

    const databaseUrl = env.DATABASE_URL;
    if (!databaseUrl) {
        outError(chalk.red("✗ DATABASE_URL is not set. Make sure your .env file is configured."));
        process.exit(1);
    }

    // Pre-flight: verify the database is reachable before running Atlas.
    // This catches ECONNREFUSED / auth failures with a friendly banner
    // instead of letting Atlas surface a raw error.
    await checkDatabaseConnectivity(databaseUrl);

    const devDatabaseUrl = getDevDatabaseUrl(databaseUrl);
    await ensureDevDatabaseExists(databaseUrl, devDatabaseUrl);

    // Atlas speaks libpq, which rejects the `sslmode=no-verify` that
    // node-postgres accepts — see `forLibpq`. Rewritten only for the argv, so
    // everything above still connects with the URL as configured.
    const atlasUrl = forLibpq(databaseUrl);
    const atlasDevUrl = forLibpq(devDatabaseUrl);

    // Everything Atlas must keep its hands off, in one list.
    //
    // Gathered only for the invocations that accept the flag — which is
    // `schema apply` and nothing else. `atlas migrate diff` and `migrate apply`
    // both reject `--exclude` outright with `unknown flag`, and passing it there
    // took `rebase db generate` and `rebase db migrate` down for every project
    // declaring a `search` block; the diff keeps the same objects out of the
    // migration afterwards instead, with `stripCarvedOutStatements`. See
    // `acceptsExcludeFlag`.
    const excludes: string[] = [];
    if (collectionsPath && acceptsExcludeFlag(domain, args)) {
        // Search and vector objects are Rebase's, not Atlas's: the desired state
        // does not carry them, so an apply left to itself would drop them.
        excludes.push(...await getSearchExcludes(collectionsPath));
        excludes.push(...await getVectorExcludes(collectionsPath));

        // Fail CLOSED: the exclude list is the only thing shielding
        // non-collection tables from the auto-approved apply. If we can't
        // introspect the database to build it, abort rather than proceed with
        // a partial list that would let Atlas drop unmanaged tables.
        try {
            excludes.push(...await getTableExcludes(databaseUrl, collectionsPath));
        } catch (err) {
            if (err instanceof ExcludeIntrospectionError) {
                outError(chalk.red("\n✗ Aborting push: could not determine which tables to protect."));
                outError(chalk.gray(`  ${err.message}`));
                outError(chalk.gray("  Refusing to apply — a partial exclude list could drop tables Rebase does not manage."));
                const hint = diagnoseDbError(err.cause ?? err, databaseUrl);
                if (hint) outError(hint);
                process.exit(1);
            }
            throw err;
        }

        // And the indexes on those tables that Rebase did not create. Same
        // fail-closed contract as the table list above, for the same reason: a
        // partial answer here silently drops somebody's index.
        try {
            excludes.push(...await getForeignIndexExcludes(databaseUrl, collectionsPath));
        } catch (err) {
            if (err instanceof ExcludeIntrospectionError) {
                outError(chalk.red("\n✗ Aborting push: could not determine which indexes to protect."));
                outError(chalk.gray(`  ${err.message}`));
                outError(chalk.gray("  Refusing to apply — a partial exclude list could drop an index Rebase does not manage."));
                const hint = diagnoseDbError(err.cause ?? err, databaseUrl);
                if (hint) outError(hint);
                process.exit(1);
            }
            throw err;
        }
    }

    const atlasArgs = buildAtlasArgs({ domain, args, url: atlasUrl, devUrl: atlasDevUrl, excludes });

    // Stream stdout live but tee stderr so we can inspect Atlas's error text
    // for known, actionable failure modes (e.g. a dependency-drop that leaves
    // the schema half-applied) after the process exits. When capturing (used
    // for the destructive-change dry-run), pipe stdout and collect it instead.
    const subprocess = execa(atlasBin, atlasArgs, {
        cwd: process.cwd(),
        stdout: opts.captureStdout ? "pipe" : "inherit",
        stderr: "pipe",
        env
    });
    let stdoutText = "";
    if (opts.captureStdout) {
        subprocess.stdout?.on("data", (chunk: Buffer) => {
            stdoutText += chunk.toString();
        });
    }
    let stderrText = "";
    subprocess.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderrText += text;
        process.stderr.write(text);
    });
    try {
        await subprocess;
    } catch {
        outError(chalk.red(`\n✗ atlas ${domain} ${args.join(" ")} failed.\n`));
        // Surface actionable recovery guidance for recognized failures.
        const hint = diagnoseDbError({ message: stderrText }, databaseUrl);
        if (hint) {
            outError(hint);
        }
        process.exit(1);
    }
    // Atlas prints the plan to stdout, but fall back to stderr so the
    // destructive-change detector never misses a plan on a version/build that
    // routes it differently.
    if (opts.captureStdout) {
        return stdoutText.trim().length > 0 ? stdoutText : stderrText;
    }
    return "";
}

async function generatePostgresDdlCommand(rawArgs: string[]): Promise<void> {
    const argsList = arg(
        {
            "--collections": String,
            "--output": String,
            "-c": "--collections",
            "-o": "--output"
        },
        {
            argv: rawArgs.slice(2),
            permissive: true
        }
    );

    const ddlScript = path.join(__cliDirname, "schema", "generate-postgres-ddl.ts");
    const tsxBin = resolveLocalBin("tsx");
    if (!tsxBin) {
        outError(chalk.red("✗ Could not find tsx binary."));
        process.exit(1);
    }

    const collectionsPath = argsList["--collections"] || path.join("..", "config", "collections");
    const outputPath = argsList["--output"] || path.join("drizzle", "schema.sql");

    const cmdParts = [
        tsxBin,
        ddlScript,
        `--collections=${collectionsPath}`,
        `--output=${outputPath}`
    ];

    try {
        await execa(cmdParts[0], cmdParts.slice(1), {
            cwd: process.cwd(),
            stdio: "inherit",
            env: { ...process.env as Record<string, string> }
        });
    } catch (err: unknown) {
        outError(chalk.red(`✗ Failed to run Postgres DDL generator: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
    }
}

/**
 * `schema stale [--fix]` — is the generated Drizzle schema older than the rule
 * that derives its foreign-key names?
 *
 * This exists for one upgrade path and is worth the command. 0.13 derives
 * `category_id` where 0.12 derived `categorie_id`; boot-ensure renames the
 * database column to match, and the project's checked-in
 * `backend/src/schema.generated.ts` is then wrong in a way nothing the developer
 * did would explain. Relation validation refuses to boot on it, permanently,
 * because the rename has already been applied and will not run again.
 *
 * `rebase dev` calls this with `--fix` before starting the backend, so the
 * upgrade behaves the way the release note says it does: the column moves and the
 * project keeps working. Without `--fix` it reports and exits non-zero, which is
 * what a build or a CI step wants.
 */
async function schemaStaleCommand(rawArgs: string[]): Promise<void> {
    const argsList = arg(
        {
            "--collections": String,
            "--output": String,
            "--fix": Boolean,
            "-c": "--collections",
            "-o": "--output"
        },
        { argv: rawArgs.slice(2), permissive: true }
    );

    const collectionsPath = argsList["--collections"] || path.join("..", "config", "collections");
    const outputPath = argsList["--output"] || path.join("src", "schema.generated.ts");
    const schemaFile = path.resolve(process.cwd(), outputPath);

    // No generated schema yet is not staleness — a fresh project has not run the
    // generator, and saying "stale" about a file that does not exist would send
    // the reader looking for something to fix.
    if (!fs.existsSync(schemaFile)) return;

    const { loadCollections } = await import("./schema/doctor");
    const { findLegacyForeignKeyNames, describeLegacyForeignKeyNames } =
        await import("./schema/generated-schema-staleness");

    let stale;
    try {
        const collections = await loadCollections(path.resolve(process.cwd(), collectionsPath));
        stale = findLegacyForeignKeyNames(fs.readFileSync(schemaFile, "utf8"), collections);
    } catch (err) {
        // Best-effort by design: a collections directory that will not load is a
        // real error, but it is one the boot reports far better than this does.
        logger.debug(`schema stale: skipped (${err instanceof Error ? err.message : String(err)})`);
        return;
    }

    if (stale.length === 0) return;

    out("");
    outWarn(chalk.yellow(
        `  ⚠️  ${outputPath} names ${stale.length} foreign key(s) the way an earlier release did:`
    ));
    out(chalk.gray(describeLegacyForeignKeyNames(stale)));
    out("");

    if (!argsList["--fix"]) {
        outError(chalk.red(
            "  The database column has already been renamed at boot, so the generated schema no " +
            "longer matches it and the server will refuse to start."
        ));
        outError(chalk.red("  Run `rebase schema generate` to regenerate it."));
        process.exit(1);
    }

    out(chalk.gray("  Regenerating the Drizzle schema so it matches..."));
    await schemaCommand("generate", ["schema", "generate", `--collections=${collectionsPath}`, `--output=${outputPath}`]);
}

async function schemaCommand(subcommand: string, rawArgs: string[]): Promise<void> {
    if (subcommand === "stale") {
        await schemaStaleCommand(rawArgs);
        return;
    }

    if (subcommand === "generate") {
        const argsList = arg(
            {
                "--collections": String,
                "--output": String,
                "--watch": Boolean,
                "-c": "--collections",
                "-o": "--output",
                "-w": "--watch"
            },
            {
                argv: rawArgs.slice(2), // db generate ... or schema generate ...
                permissive: true
            }
        );

        // Here we just invoke the local generate-drizzle-schema.ts since we are inside the postgresql-backend
        // If installed in node_modules, __cliDirname is node_modules/@rebasepro/server-postgres/dist or src.
        const generatorScript = path.join(__cliDirname, "schema", "generate-drizzle-schema.ts");
        if (!fs.existsSync(generatorScript)) {
            outError(chalk.red(`✗ Could not find generate-drizzle-schema.ts at ${generatorScript}`));
            process.exit(1);
        }

        const tsxBin = resolveLocalBin("tsx");
        if (!tsxBin) {
            outError(chalk.red("✗ Could not find tsx binary."));
            process.exit(1);
        }

        const collectionsPath = argsList["--collections"] || path.join("..", "config", "collections");
        const outputPath = argsList["--output"] || path.join("src", "schema.generated.ts");
        const watch = argsList["--watch"] || false;

        out("");
        out(chalk.bold("  🔧 Rebase Schema Generator"));
        out("");

        const cmdParts = [
            tsxBin,
            generatorScript,
            `--collections=${collectionsPath}`,
            `--output=${outputPath}`
        ];
        if (watch) {
            cmdParts.push("--watch");
        }

        try {
            await execa(cmdParts[0], cmdParts.slice(1), {
                cwd: process.cwd(),
                stdio: "inherit",
                env: { ...process.env as Record<string, string> }
            });
        } catch (err: unknown) {
            outError(chalk.red(`✗ Failed to run schema generator: ${err instanceof Error ? err.message : String(err)}`));
            process.exit(1);
        }
    } else if (subcommand === "introspect") {
        const argsList = arg(
            {
                "--output": String,
                "--collections": String,
                "--force": Boolean,
                "--schema": String,
                "-o": "--output",
                "-c": "--collections",
                "-f": "--force"
            },
            {
                argv: rawArgs.slice(2),
                permissive: true
            }
        );

        const introspectScript = path.join(__cliDirname, "schema", "introspect-db.ts");
        if (!fs.existsSync(introspectScript)) {
            outError(chalk.red(`✗ Could not find introspect-db.ts at ${introspectScript}`));
            process.exit(1);
        }

        const tsxBin = resolveLocalBin("tsx");
        if (!tsxBin) {
            outError(chalk.red("✗ Could not find tsx binary."));
            process.exit(1);
        }

        const outputPath = argsList["--output"] || argsList["--collections"] || path.join("..", "config", "collections");

        out("");
        out(chalk.bold("  🔍 Rebase Schema Introspector"));
        out("");

        const cmdParts = [
            tsxBin,
            introspectScript,
            `--output=${outputPath}`,
            ...(argsList["--force"] ? ["--force"] : []),
            ...(argsList["--schema"] ? [`--schema=${argsList["--schema"]}`] : [])
        ];

        try {
            await execa(cmdParts[0], cmdParts.slice(1), {
                cwd: process.cwd(),
                stdio: "inherit",
                env: { ...process.env as Record<string, string> }
            });
        } catch (err: unknown) {
            outError(chalk.red(`✗ Failed to run schema introspector: ${err instanceof Error ? err.message : String(err)}`));
            process.exit(1);
        }
    } else {
        outError(chalk.red("Unknown schema command."));
        process.exit(1);
    }
}

async function doctorPluginCommand(rawArgs: string[]): Promise<void> {
    const parsedArgs = arg(
        {
            "--collections": String,
            "--schema": String,
            "--sdk": String,
            "--policies": Boolean,
            "-c": "--collections",
            "-s": "--schema",
            "-k": "--sdk"
        },
        {
            argv: rawArgs.slice(1), // skip "doctor"
            permissive: true
        }
    );

    const doctorScript = path.join(__cliDirname, "schema", "doctor-cli.ts");
    if (!fs.existsSync(doctorScript)) {
        outError(chalk.red(`✗ Could not find doctor.ts at ${doctorScript}`));
        process.exit(1);
    }

    const tsxBin = resolveLocalBin("tsx");
    if (!tsxBin) {
        outError(chalk.red("✗ Could not find tsx binary."));
        process.exit(1);
    }

    const collectionsPath = parsedArgs["--collections"] || path.join("..", "config", "collections");
    const schemaPath = parsedArgs["--schema"] || path.join("src", "schema.generated.ts");
    const sdkPath = parsedArgs["--sdk"] || path.join("..", "generated", "sdk", "database.types.ts");

    const cmdParts = [
        tsxBin,
        doctorScript,
        `--collections=${collectionsPath}`,
        `--schema=${schemaPath}`,
        `--sdk=${sdkPath}`,
        // Only the RLS checks: skips the schema/SDK diff, so it can run against
        // a deployed database as a CI gate.
        ...(parsedArgs["--policies"] ? ["--policies"] : [])
    ];

    try {
        await execa(cmdParts[0], cmdParts.slice(1), {
            cwd: process.cwd(),
            stdio: "inherit",
            env: { ...process.env as Record<string, string> }
        });
    } catch {
        process.exit(1);
    }
}


// Entry point when called directly
const argv1Real = process.argv[1] ? fs.realpathSync(process.argv[1]) : "";
if (import.meta.url === `file://${argv1Real}`) {
    // Drop node and script path
    runPluginCommand(process.argv.slice(2)).catch(() => process.exit(1));
}

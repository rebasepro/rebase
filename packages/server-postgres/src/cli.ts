import arg from "arg";
import chalk from "chalk";
import { execa } from "execa";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { logger } from "@rebasepro/server";
import {
    diagnoseMissingBin,
    resolveLocalBin,
    getTableIncludes,
    getDevDatabaseUrl,
    ensureDevDatabaseExists,
    getTableExcludes,
    ExcludeIntrospectionError,
    promptConfirm
} from "./cli-helpers";
import { checkDatabaseConnectivity, diagnoseDbError } from "./cli-errors";
import { forLibpq } from "./utils/connection-string";
import { AUTH_BOOTSTRAP_SQL } from "./schema/auth-bootstrap-sql";
import { detectDestructiveStatements, decidePushSafety } from "./schema/destructive-sql";

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
                const parsed = dotenv.config({ path: p });
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
        logger.error(chalk.red(`Unknown domain command: ${domain}`));
        process.exit(1);
    }
}

async function dbCommand(subcommand: string, rawArgs: string[]): Promise<void> {
    const VALID_ACTIONS = ["push", "generate", "migrate", "branch", "backup", "restore", "backups"];
    if (!subcommand || !VALID_ACTIONS.includes(subcommand)) {
        logger.error(chalk.red(`Unknown db command. Valid: ${VALID_ACTIONS.join(", ")}`));
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
        logger.info("");
        logger.info(chalk.bold("  📦 Rebase DB Generate"));
        logger.info(chalk.gray("  Step 1/2: Generating Drizzle schema & Postgres DDL from collections..."));
        logger.info("");
        await schemaCommand("generate", rawArgs);
        await generatePostgresDdlCommand(rawArgs);
        logger.info("");
        logger.info(chalk.gray("  Step 2/2: Generating SQL migration files with Atlas..."));
        logger.info("");
        const migrationName = argsList._[0] || "migration";
        await runAtlas("migrate", ["diff", migrationName, "--dir", "file://drizzle/migrations", "--to", "file://drizzle/schema.sql"], collectionsPath);
        
        // Post-process the newest migration file
        try {
            const migrationsDir = path.resolve(process.cwd(), "drizzle", "migrations");
            if (fs.existsSync(migrationsDir)) {
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
                    fs.writeFileSync(newestMigrationFile, migrationContent, "utf-8");

                    // Append RLS policies, preceded by the auth bootstrap so the
                    // migration is self-contained: Atlas replays migrations
                    // against a clean dev database where `auth.uid()` would not
                    // otherwise exist.
                    const policiesFile = path.resolve(process.cwd(), "drizzle", "policies.sql");
                    if (fs.existsSync(policiesFile)) {
                        const policiesContent = fs.readFileSync(policiesFile, "utf-8");
                        fs.appendFileSync(newestMigrationFile, "\n\n" + AUTH_BOOTSTRAP_SQL + "\n" + policiesContent);
                        logger.info(chalk.gray(`  ✓ Appended RLS policies to migration file: ${path.basename(newestMigrationFile)}`));
                        
                        // Re-hash the migration directory
                        logger.info(chalk.gray("  Re-hashing migration files..."));
                        await runAtlas("migrate", ["hash", "--dir", "file://drizzle/migrations"], collectionsPath);
                        logger.info(chalk.gray("  ✓ Migration directory checksum updated successfully."));
                    }
                }
            }
        } catch (err) {
            logger.warn(chalk.yellow(`  ⚠️  Failed to append policies or re-hash migration: ${err instanceof Error ? err.message : String(err)}`));
        }

        logger.info("");
        logger.info(`  You can now run ${chalk.bold.green("rebase db migrate")} to apply the migrations to your database.`);
        logger.info("");
    } else {
        logger.info("");
        logger.info(chalk.bold(`  🗄️  Rebase DB ${subcommand.charAt(0).toUpperCase() + subcommand.slice(1)}`));
        logger.info("");

        if (subcommand === "push") {
            logger.info(chalk.gray("  Step 1/3: Generating Drizzle schema & Postgres DDL from collections..."));
            logger.info("");
            await schemaCommand("generate", rawArgs);
            await generatePostgresDdlCommand(rawArgs);
            logger.info("");
            logger.info(chalk.gray("  Step 2/3: Pushing schema to database with Atlas..."));
            logger.info("");
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
                logger.warn(chalk.yellow(`  ⚠️  This push includes ${destructive.length} destructive change(s) that will DESTROY data:`));
                logger.warn("");
                for (const d of destructive) {
                    logger.warn(chalk.red(`       ${d.kind}: `) + chalk.gray(d.statement.replace(/\s+/g, " ")));
                }
                logger.warn("");
                logger.warn(chalk.yellow("  Full planned changes:"));
                logger.warn(chalk.gray(plan.trim().split("\n").map((l) => `       ${l}`).join("\n")));
                logger.warn("");

                if (decision === "refuse") {
                    logger.error(chalk.red("  ✗ Aborting: destructive changes require confirmation."));
                    logger.error(chalk.gray("    Re-run interactively, or pass --allow-destructive to proceed. Back up first: rebase db backup"));
                    process.exit(1);
                }
                if (decision === "confirm") {
                    const confirmed = await promptConfirm(
                        chalk.yellow("  Type 'yes' to apply these destructive changes (this cannot be undone): ")
                    );
                    if (!confirmed) {
                        logger.info(chalk.gray("  Aborted. No changes were made."));
                        process.exit(1);
                    }
                } else {
                    // decision === "apply" via --allow-destructive
                    logger.warn(chalk.yellow("  Proceeding because --allow-destructive was passed."));
                }
            }

            await runAtlas("schema", ["apply", "--to", "file://drizzle/schema.sql", "--auto-approve"], collectionsPath);
            logger.info("");
            
            if (databaseUrl) {
                await ensureAuthTables(databaseUrl, collectionsPath);
                await applyPolicies(databaseUrl);
                await reconcilePolicies(databaseUrl, collectionsPath);
                await ensureRlsUserRole(databaseUrl);
            } else {
                logger.warn(chalk.yellow("  ⚠️  DATABASE_URL not found in environment, skipping RLS policies application."));
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
            }
        }

        logger.info("");
        logger.info(chalk.green(`  ✓ rebase db ${subcommand} completed successfully.`));
        logger.info("");
    }
}

async function ensureAuthSchemaAndFunctions(databaseUrl: string): Promise<void> {
    try {
        const { Client } = await import("pg");
        const client = new Client({ connectionString: databaseUrl });
        await client.connect();
        try {
            await client.query(AUTH_BOOTSTRAP_SQL);
            // Runtime-only: pre-create the schema Atlas uses for its revision
            // table (`--revisions-schema rebase`). Kept out of
            // AUTH_BOOTSTRAP_SQL so it never enters the migration stream.
            await client.query("CREATE SCHEMA IF NOT EXISTS rebase");
        } finally {
            await client.end();
        }
    } catch (err) {
        logger.warn(chalk.yellow(`  ⚠️  Failed to bootstrap auth schema and helper functions: ${err instanceof Error ? err.message : String(err)}`));
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
        logger.warn(chalk.yellow(`  ⚠️  Failed to ensure framework auth tables: ${err instanceof Error ? err.message : String(err)}`));
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
    const schemas = ["public", "rebase", "auth"];
    let rls: typeof import("./security/rls-enforcement");
    try {
        rls = await import("./security/rls-enforcement");
    } catch (err) {
        // A module-resolution failure here is a build problem, not a database
        // one, and it is exactly the case that used to produce the silent exit.
        logger.error(chalk.red(
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
                logger.info(chalk.gray(`  ✓ RLS role "${rls.REBASE_USER_ROLE}" provisioned/refreshed.`));
            }
        } finally {
            await client.end();
        }
    } catch (err) {
        logger.error(chalk.red(
            `\n  ✗ The schema change was applied, but the "${rls.REBASE_USER_ROLE}" role could not be ` +
            `provisioned: ${err instanceof Error ? err.message : String(err)}`
        ));
        logger.error(chalk.gray(rls.appRoleSetupInstructions("your database user", schemas)));
    }
}

async function applyPolicies(databaseUrl: string): Promise<void> {
    try {
        const policiesPath = path.resolve(process.cwd(), "drizzle", "policies.sql");
        if (!fs.existsSync(policiesPath)) return;
        
        logger.info(chalk.gray("  Step 3/3: Applying RLS policies to database..."));
        logger.info("");
        
        const policiesContent = fs.readFileSync(policiesPath, "utf-8");
        const { Client } = await import("pg");
        const client = new Client({ connectionString: databaseUrl });
        await client.connect();
        try {
            await client.query(policiesContent);
            logger.info(chalk.green("  ✓ RLS policies applied successfully."));
        } finally {
            await client.end();
        }
    } catch (err) {
        const hint = diagnoseDbError(err, databaseUrl);
        if (hint) {
            logger.error(hint);
        } else {
            logger.error(chalk.red(`  ✗ Failed to apply RLS policies: ${err instanceof Error ? err.message : String(err)}`));
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
                logger.info(chalk.gray(`  ✓ Dropped superseded policy "${p.name}" on ${p.schema}.${p.table}`));
            }
            if (dropped.length > 0) {
                logger.info(chalk.green(`  ✓ Removed ${dropped.length} superseded RLS ${dropped.length === 1 ? "policy" : "policies"}.`));
            }

            // Custom-named orphans are indistinguishable from policies someone
            // wrote in SQL deliberately, so they are reported, never dropped.
            if (kept.length > 0) {
                logger.warn(chalk.yellow("  ⚠️  Policies in the database that no collection describes:"));
                for (const p of kept) {
                    logger.warn(chalk.yellow(`       • ${p.schema}.${p.table} → "${p.name}" (${p.command} TO ${p.roles.join(", ")})`));
                }
                logger.warn(chalk.yellow("       These still grant access. Drop them by hand if they are stale."));
            }

            // Missing/diverged are not push's to fix, but staying silent about
            // them is how a database ends up not matching its config.
            const remaining = { ...drift, orphaned: kept };
            if (hasDrift(remaining) && (remaining.missing.length > 0 || remaining.diverged.length > 0)) {
                logger.warn(chalk.yellow("  ⚠️  RLS policies do not match your collections:"));
                logger.warn(formatPolicyDrift({ ...remaining, orphaned: [] }));
            }
        } finally {
            await client.end();
        }
    } catch (err) {
        logger.warn(chalk.yellow(`  ⚠️  Could not reconcile RLS policies: ${err instanceof Error ? err.message : String(err)}`));
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
            dotenv.config({ path: envPath });
        } else {
            dotenv.config();
        }
    } catch {
        // dotenv may not be installed
    }

    const databaseUrl = process.env.DATABASE_URL || process.env.ADMIN_CONNECTION_STRING;
    if (!databaseUrl) {
        logger.error(chalk.red("✗ DATABASE_URL is not set. Make sure your .env file is configured."));
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
                    logger.error(chalk.red("✗ Branch name is required."));
                    logger.info(chalk.gray("  Usage: rebase db branch create <name> [--from <source>]"));
                    process.exit(1);
                }
                let source: string | undefined;
                const fromIdx = rawArgs.indexOf("--from");
                if (fromIdx !== -1 && rawArgs[fromIdx + 1]) {
                    source = rawArgs[fromIdx + 1];
                }
                logger.info("");
                logger.info(chalk.bold("  🌿 Creating database branch..."));
                logger.info(chalk.gray(`  Name:   ${name}`));
                if (source) logger.info(chalk.gray(`  Source: ${source}`));
                logger.info("");
                const branch = await branchService.createBranch(name, source ? { source } : undefined);
                logger.info(chalk.green(`  ✓ Branch "${branch.name}" created successfully.`));
                logger.info(chalk.gray(`    Database: rb_${branch.name}`));
                logger.info(chalk.gray(`    Parent:   ${branch.parentDatabase}`));
                logger.info("");
                break;
            }

            case "list": {
                const branches = await branchService.listBranches();
                logger.info("");
                if (branches.length === 0) {
                    logger.info(chalk.gray("  No branches found. Create one with: rebase db branch create <name>"));
                } else {
                    logger.info(chalk.bold(`  🌿 ${branches.length} branch(es):`));
                    logger.info("");
                    for (const b of branches) {
                        const size = b.sizeBytes != null
                            ? chalk.gray(` (${formatBytes(b.sizeBytes)})`)
                            : "";
                        const age = chalk.gray(` — created ${timeAgo(b.createdAt)}`);
                        logger.info(`  ${chalk.green("●")} ${chalk.bold(b.name)}${size}${age}`);
                        logger.info(chalk.gray(`    from ${b.parentDatabase}`));
                    }
                }
                logger.info("");
                break;
            }

            case "delete": {
                const name = rawArgs[3];
                if (!name) {
                    logger.error(chalk.red("✗ Branch name is required."));
                    logger.info(chalk.gray("  Usage: rebase db branch delete <name>"));
                    process.exit(1);
                }
                logger.info("");
                logger.info(chalk.bold(`  🗑️  Deleting branch "${name}"...`));
                await branchService.deleteBranch(name);
                logger.info(chalk.green(`  ✓ Branch "${name}" deleted.`));
                logger.info("");
                break;
            }

            case "info": {
                const name = rawArgs[3];
                if (!name) {
                    logger.error(chalk.red("✗ Branch name is required."));
                    logger.info(chalk.gray("  Usage: rebase db branch info <name>"));
                    process.exit(1);
                }
                const info = await branchService.getBranchInfo(name);
                logger.info("");
                if (!info) {
                    logger.error(chalk.red(`  ✗ Branch "${name}" not found.`));
                } else {
                    logger.info(chalk.bold(`  🌿 Branch: ${info.name}`));
                    logger.info(chalk.gray(`    Database: rb_${info.name}`));
                    logger.info(chalk.gray(`    Parent:   ${info.parentDatabase}`));
                    logger.info(chalk.gray(`    Created:  ${info.createdAt.toISOString()}`));
                    if (info.sizeBytes != null) {
                        logger.info(chalk.gray(`    Size:     ${formatBytes(info.sizeBytes)}`));
                    }
                }
                logger.info("");
                break;
            }

            default:
                logger.error(chalk.red(`Unknown branch action: "${branchAction}".`));
                printBranchHelp();
                process.exit(1);
        }
    } finally {
        await poolManager.shutdown();
        await pool.end();
    }
}

function printBranchHelp() {
    logger.info(`
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

function timeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
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
        logger.error(chalk.red("\n✗ The atlas binary is missing, so the schema cannot be applied.\n"));

        if (diagnoseMissingBin("@ariga/atlas") === "build-script-blocked") {
            logger.error(chalk.yellow("  @ariga/atlas IS installed — only its binary is missing.\n"));
            logger.error(chalk.gray(
                "  It downloads that binary in a `preinstall` script, and pnpm 10+ does not\n" +
                "  run a dependency's scripts unless you allow it. The install still exits 0,\n" +
                "  so the only sign is `Ignored build scripts: @ariga/atlas` in its output.\n"
            ));
            logger.error("  Fix it with either:\n");
            logger.error(chalk.bold("    pnpm approve-builds\n"));
            logger.error("  or, to record it in the project (what `rebase init` scaffolds):\n");
            logger.error(chalk.bold(
                "    // package.json\n" +
                "    \"pnpm\": { \"onlyBuiltDependencies\": [\"@ariga/atlas\"] }\n"
            ));
            logger.error(chalk.gray("  Then re-run `pnpm install`.\n"));
        } else {
            logger.error(chalk.gray("  It is not installed in this project.\n"));
            logger.error("  Install it with:\n");
            logger.error(chalk.bold("    pnpm add -D @ariga/atlas\n"));
            logger.error(chalk.gray(
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
                const parsed = dotenv.config({ path: p });
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
        logger.error(chalk.red("✗ DATABASE_URL is not set. Make sure your .env file is configured."));
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

    const atlasArgs = [domain, ...args];

    if (domain === "schema") {
        if (args.includes("apply")) {
            atlasArgs.push("--url", atlasUrl, "--dev-url", atlasDevUrl);
        } else if (args.includes("clean") || args.includes("inspect")) {
            atlasArgs.push("--url", atlasUrl);
        }
    } else if (domain === "migrate") {
        if (args.includes("diff")) {
            atlasArgs.push("--dev-url", atlasDevUrl);
        } else if (args.includes("apply") || args.includes("status")) {
            atlasArgs.push("--url", atlasUrl, "--revisions-schema", "rebase");
            if (args.includes("apply")) {
                atlasArgs.push("--allow-dirty");
            }
        }
    }

    if (domain === "schema" && args.includes("apply") && collectionsPath) {
        // Fail CLOSED: the exclude list is the only thing shielding
        // non-collection tables from the auto-approved apply. If we can't
        // introspect the database to build it, abort rather than proceed with
        // a partial list that would let Atlas drop unmanaged tables.
        let excludes: string[];
        try {
            excludes = await getTableExcludes(databaseUrl, collectionsPath);
        } catch (err) {
            if (err instanceof ExcludeIntrospectionError) {
                logger.error(chalk.red("\n✗ Aborting push: could not determine which tables to protect."));
                logger.error(chalk.gray(`  ${err.message}`));
                logger.error(chalk.gray("  Refusing to apply — a partial exclude list could drop tables Rebase does not manage."));
                const hint = diagnoseDbError(err.cause ?? err, databaseUrl);
                if (hint) logger.error(hint);
                process.exit(1);
            }
            throw err;
        }
        for (const exc of excludes) {
            atlasArgs.push("--exclude", exc);
        }
    }

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
        logger.error(chalk.red(`\n✗ atlas ${domain} ${args.join(" ")} failed.\n`));
        // Surface actionable recovery guidance for recognized failures.
        const hint = diagnoseDbError({ message: stderrText }, databaseUrl);
        if (hint) {
            logger.error(hint);
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
        logger.error(chalk.red("✗ Could not find tsx binary."));
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
        logger.error(chalk.red(`✗ Failed to run Postgres DDL generator: ${err instanceof Error ? err.message : String(err)}`));
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

    logger.info("");
    logger.warn(chalk.yellow(
        `  ⚠️  ${outputPath} names ${stale.length} foreign key(s) the way an earlier release did:`
    ));
    logger.info(chalk.gray(describeLegacyForeignKeyNames(stale)));
    logger.info("");

    if (!argsList["--fix"]) {
        logger.error(chalk.red(
            "  The database column has already been renamed at boot, so the generated schema no " +
            "longer matches it and the server will refuse to start."
        ));
        logger.error(chalk.red("  Run `rebase schema generate` to regenerate it."));
        process.exit(1);
    }

    logger.info(chalk.gray("  Regenerating the Drizzle schema so it matches..."));
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
            logger.error(chalk.red(`✗ Could not find generate-drizzle-schema.ts at ${generatorScript}`));
            process.exit(1);
        }

        const tsxBin = resolveLocalBin("tsx");
        if (!tsxBin) {
            logger.error(chalk.red("✗ Could not find tsx binary."));
            process.exit(1);
        }

        const collectionsPath = argsList["--collections"] || path.join("..", "config", "collections");
        const outputPath = argsList["--output"] || path.join("src", "schema.generated.ts");
        const watch = argsList["--watch"] || false;

        logger.info("");
        logger.info(chalk.bold("  🔧 Rebase Schema Generator"));
        logger.info("");

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
            logger.error(chalk.red(`✗ Failed to run schema generator: ${err instanceof Error ? err.message : String(err)}`));
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
            logger.error(chalk.red(`✗ Could not find introspect-db.ts at ${introspectScript}`));
            process.exit(1);
        }

        const tsxBin = resolveLocalBin("tsx");
        if (!tsxBin) {
            logger.error(chalk.red("✗ Could not find tsx binary."));
            process.exit(1);
        }

        const outputPath = argsList["--output"] || argsList["--collections"] || path.join("..", "config", "collections");

        logger.info("");
        logger.info(chalk.bold("  🔍 Rebase Schema Introspector"));
        logger.info("");

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
            logger.error(chalk.red(`✗ Failed to run schema introspector: ${err instanceof Error ? err.message : String(err)}`));
            process.exit(1);
        }
    } else {
        logger.error(chalk.red("Unknown schema command."));
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
        logger.error(chalk.red(`✗ Could not find doctor.ts at ${doctorScript}`));
        process.exit(1);
    }

    const tsxBin = resolveLocalBin("tsx");
    if (!tsxBin) {
        logger.error(chalk.red("✗ Could not find tsx binary."));
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

import arg from "arg";
import chalk from "chalk";
import { execa } from "execa";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { logger } from "@rebasepro/server-core";
import {
    resolveLocalBin,
    getTableIncludes,
    getDevDatabaseUrl,
    ensureDevDatabaseExists,
    getTableExcludes
} from "./cli-helpers";
import { checkDatabaseConnectivity, diagnoseDbError } from "./cli-errors";

const __cliDirname = path.dirname(fileURLToPath(import.meta.url));



export async function runPluginCommand(args: string[]) {
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
    const VALID_ACTIONS = ["push", "generate", "migrate", "branch"];
    if (!subcommand || !VALID_ACTIONS.includes(subcommand)) {
        logger.error(chalk.red(`Unknown db command. Valid: ${VALID_ACTIONS.join(", ")}`));
        process.exit(1);
    }

    if (subcommand === "branch") {
        await branchCommand(rawArgs);
        return;
    }

    const argsList = arg(
        {
            "--collections": String,
            "-c": "--collections"
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

                    // Append RLS policies
                    const policiesFile = path.resolve(process.cwd(), "drizzle", "policies.sql");
                    if (fs.existsSync(policiesFile)) {
                        const policiesContent = fs.readFileSync(policiesFile, "utf-8");
                        fs.appendFileSync(newestMigrationFile, "\n\n" + policiesContent);
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
            await runAtlas("schema", ["apply", "--to", "file://drizzle/schema.sql", "--auto-approve"], collectionsPath);
            logger.info("");
            
            const databaseUrl = process.env.DATABASE_URL;
            if (databaseUrl) {
                await applyPolicies(databaseUrl);
            } else {
                logger.warn(chalk.yellow("  ⚠️  DATABASE_URL not found in environment, skipping RLS policies application."));
            }
        } else if (subcommand === "migrate") {
            const extraArgs = argsList._.filter(arg => arg !== "migrate");
            await runAtlas("migrate", ["apply", "--dir", "file://drizzle/migrations", ...extraArgs], collectionsPath);
        }

        logger.info("");
        logger.info(chalk.green(`  ✓ rebase db ${subcommand} completed successfully.`));
        logger.info("");
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



async function runAtlas(domain: "schema" | "migrate", args: string[], collectionsPath?: string): Promise<void> {
    const atlasBin = resolveLocalBin("atlas");
    if (!atlasBin) {
        logger.error(chalk.red("✗ Could not find atlas binary."));
        const installCmd = "pnpm add -D @ariga/atlas";
        logger.error(chalk.gray(`  Install it with: ${installCmd}`));
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

    const atlasArgs = [domain, ...args];

    if (domain === "schema") {
        if (args.includes("apply")) {
            atlasArgs.push("--url", databaseUrl, "--dev-url", devDatabaseUrl);
        } else if (args.includes("clean") || args.includes("inspect")) {
            atlasArgs.push("--url", databaseUrl);
        }
    } else if (domain === "migrate") {
        if (args.includes("diff")) {
            atlasArgs.push("--dev-url", devDatabaseUrl);
        } else if (args.includes("apply") || args.includes("status")) {
            atlasArgs.push("--url", databaseUrl, "--revisions-schema", "rebase");
        }
    }

    if (domain === "schema" && args.includes("apply") && collectionsPath) {
        const excludes = await getTableExcludes(databaseUrl, collectionsPath);
        for (const exc of excludes) {
            atlasArgs.push("--exclude", exc);
        }
    }

    try {
        await execa(atlasBin, atlasArgs, {
            cwd: process.cwd(),
            stdio: "inherit",
            env
        });
    } catch (err: unknown) {
        logger.error(chalk.red(`\n✗ atlas ${domain} ${args.join(" ")} failed.\n`));
        process.exit(1);
    }
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

async function schemaCommand(subcommand: string, rawArgs: string[]): Promise<void> {
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
        // If installed in node_modules, __cliDirname is node_modules/@rebasepro/server-postgresql/dist or src.
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
        `--sdk=${sdkPath}`
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

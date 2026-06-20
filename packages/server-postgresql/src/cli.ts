import arg from "arg";
import chalk from "chalk";
import { execa } from "execa";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { logger } from "@rebasepro/server-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveLocalBin(binName: string): string | null {
    let cwd = process.cwd();
    // Try to find node_modules/.bin upwards
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
    const VALID_ACTIONS = ["push", "generate", "migrate", "studio", "branch"];
    if (!subcommand || !VALID_ACTIONS.includes(subcommand)) {
        logger.error(chalk.red(`Unknown db command. Valid: ${VALID_ACTIONS.join(", ")}`));
        process.exit(1);
    }

    if (subcommand === "branch") {
        await branchCommand(rawArgs);
        return;
    }

    if (subcommand === "generate") {
        logger.info("");
        logger.info(chalk.bold("  📦 Rebase DB Generate"));
        logger.info(chalk.gray("  Step 1/2: Generating Drizzle schema from collections..."));
        logger.info("");
        await schemaCommand("generate", rawArgs);
        logger.info("");
        logger.info(chalk.gray("  Step 2/2: Generating SQL migration files..."));
        logger.info("");
        await runDrizzleKit("generate", rawArgs);
        await fixMigrationStatementOrder();
        logger.info("");
        logger.info(`  You can now run ${chalk.bold.green("rebase db migrate")} to apply the migrations to your database.`);
        logger.info("");
    } else if (subcommand === "pull") {
        logger.info("");
        logger.info(chalk.yellow("  ⚠ \"rebase db pull\" has been removed."));
        logger.info(chalk.gray("  Use \"rebase schema introspect\" instead."));
        logger.info("");
        process.exit(1);
    } else {
        logger.info("");
        logger.info(chalk.bold(`  🗄️  Rebase DB ${subcommand.charAt(0).toUpperCase() + subcommand.slice(1)}`));
        logger.info("");

        if (subcommand === "push") {
            logger.info(chalk.gray("  Step 1/2: Generating Drizzle schema from collections..."));
            logger.info("");
            await schemaCommand("generate", rawArgs);
            logger.info("");
            logger.info(chalk.gray("  Step 2/2: Pushing schema to database..."));
            logger.info("");
            await runDrizzleKit("push", rawArgs);
        } else if (subcommand === "migrate") {
            await runDrizzleKit("migrate", rawArgs);
        } else if (subcommand === "studio") {
            const schemaPath = path.join(process.cwd(), "src", "schema.generated.ts");
            if (!fs.existsSync(schemaPath)) {
                logger.info(chalk.yellow("  ⚠ schema.generated.ts not found. Generating schema first..."));
                await schemaCommand("generate", rawArgs);
            }
            await runDrizzleKit("studio", rawArgs);
        } else {
            await runDrizzleKit(subcommand, rawArgs);
        }

        logger.info("");
        logger.info(chalk.green(`  ✓ rebase db ${subcommand} completed successfully.`));
        logger.info("");
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

/**
 * Post-process generated migration files to fix statement ordering issues.
 *
 * Drizzle-kit can emit DROP POLICY statements *after* ALTER TABLE ... ALTER COLUMN
 * for the same table. Postgres rejects this with:
 *   "cannot alter type of a column used in a policy definition"
 *
 * This scans the drizzle output directory for the most recently modified .sql file
 * and reorders statements so that DROP POLICY on a table always precedes any
 * ALTER TABLE on that same table.
 */
async function fixMigrationStatementOrder(): Promise<void> {
    const drizzleDir = path.join(process.cwd(), "drizzle");
    if (!fs.existsSync(drizzleDir)) return;

    // Find the most recently modified .sql file
    const sqlFiles = fs.readdirSync(drizzleDir)
        .filter(f => f.endsWith(".sql"))
        .map(f => ({
            name: f,
            mtime: fs.statSync(path.join(drizzleDir, f)).mtimeMs
        }))
        .sort((a, b) => b.mtime - a.mtime);

    if (sqlFiles.length === 0) return;

    const latestFile = path.join(drizzleDir, sqlFiles[0].name);
    let content = fs.readFileSync(latestFile, "utf-8");
    const originalContent = content;

    // Replace CREATE SCHEMA with CREATE SCHEMA IF NOT EXISTS to prevent failures
    content = content.replace(/CREATE SCHEMA "([^"]+)";/g, 'CREATE SCHEMA IF NOT EXISTS "$1";');

    const DELIMITER = "--> statement-breakpoint";
    const parts = content.split(DELIMITER);

    // Parse each statement to detect DROP POLICY and ALTER TABLE targets
    const dropPolicyRe = /DROP\s+POLICY\s+.+?\s+ON\s+"([^"]+)"/i;
    const alterTableRe = /ALTER\s+TABLE\s+"([^"]+)"\s+ALTER\s+COLUMN/i;

    // Collect indices of DROP POLICY statements and what tables they target
    const dropPolicyIndices = new Map<string, number[]>(); // table -> indices
    const alterColumnIndices = new Map<string, number>(); // table -> first ALTER index

    for (let i = 0; i < parts.length; i++) {
        const stmt = parts[i].trim();
        const dropMatch = stmt.match(dropPolicyRe);
        if (dropMatch) {
            const table = dropMatch[1];
            if (!dropPolicyIndices.has(table)) dropPolicyIndices.set(table, []);
            dropPolicyIndices.get(table)!.push(i);
        }
        const alterMatch = stmt.match(alterTableRe);
        if (alterMatch) {
            const table = alterMatch[1];
            if (!alterColumnIndices.has(table)) alterColumnIndices.set(table, i);
        }
    }

    // Check if any DROP POLICY comes after an ALTER COLUMN on the same table
    let needsReorder = false;
    for (const [table, dropIndices] of dropPolicyIndices) {
        const firstAlter = alterColumnIndices.get(table);
        if (firstAlter !== undefined) {
            for (const dropIdx of dropIndices) {
                if (dropIdx > firstAlter) {
                    needsReorder = true;
                    break;
                }
            }
        }
        if (needsReorder) break;
    }

    if (!needsReorder) {
        if (content !== originalContent) {
            fs.writeFileSync(latestFile, content, "utf-8");
        }
        return;
    }

    // Reorder: move DROP POLICY statements for affected tables before their ALTER TABLE
    // Strategy: stable sort — DROP POLICY on table X gets priority over ALTER on table X
    const stmtEntries = parts.map((stmt, idx) => ({ stmt,
idx }));

    stmtEntries.sort((a, b) => {
        const aDropMatch = a.stmt.trim().match(dropPolicyRe);
        const bAlterMatch = b.stmt.trim().match(alterTableRe);
        const bDropMatch = b.stmt.trim().match(dropPolicyRe);
        const aAlterMatch = a.stmt.trim().match(alterTableRe);

        // If a is DROP POLICY on table X and b is ALTER on table X, a goes first
        if (aDropMatch && bAlterMatch && aDropMatch[1] === bAlterMatch[1]) return -1;
        // If b is DROP POLICY on table X and a is ALTER on table X, b goes first
        if (bDropMatch && aAlterMatch && bDropMatch[1] === aAlterMatch[1]) return 1;
        // Otherwise preserve original order
        return a.idx - b.idx;
    });

    const reordered = stmtEntries.map(e => e.stmt).join(DELIMITER);
    fs.writeFileSync(latestFile, reordered, "utf-8");

    logger.info(chalk.yellow(`  \u26A0 Reordered migration statements in ${sqlFiles[0].name} (DROP POLICY before ALTER COLUMN)`));
}

async function runDrizzleKit(action: string, _rawArgs: string[]): Promise<void> {
    const drizzleKitBin = resolveLocalBin("drizzle-kit");
    if (!drizzleKitBin) {
        logger.error(chalk.red("✗ Could not find drizzle-kit binary."));
        const isNpm = (process.env.npm_config_user_agent ?? "").startsWith("npm/") || fs.existsSync(path.join(process.cwd(), "package-lock.json"));
        const installCmd = isNpm ? "npm install -D drizzle-kit" : "pnpm add -D drizzle-kit";
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
        // dotenv may not be available — fall through
    }

    const interactive = ["generate", "push"].includes(action) && Boolean(process.stdout.isTTY);

    // For push: always use --strict (prompts before destructive ops) and --verbose
    // (shows all SQL). This ensures unmapped tables are never silently dropped.
    const drizzleKitArgs = [action];
    if (action === "push") {
        drizzleKitArgs.push("--strict", "--verbose");
    }

    // Forward any additional arguments, excluding schema-generator-specific options
    const excludedFlags = ["--collections", "-c", "--output", "-o", "--watch", "-w"];
    for (let i = 2; i < _rawArgs.length; i++) {
        const arg = _rawArgs[i];
        if (excludedFlags.includes(arg)) {
            // Skip this flag and its value if it takes a parameter
            if (["--collections", "-c", "--output", "-o"].includes(arg)) {
                i++; // Skip the next arg (the value)
            }
            continue;
        }
        if (!drizzleKitArgs.includes(arg)) {
            drizzleKitArgs.push(arg);
        }
    }

    try {
        if (interactive) {
            await execa(drizzleKitBin, drizzleKitArgs, {
                cwd: process.cwd(),
                stdio: "inherit",
                env
            });
        } else {
            const child = execa(drizzleKitBin, drizzleKitArgs, {
                cwd: process.cwd(),
                env,
                reject: false
            });

            // Natively stream output while still capturing it for error parsing
            child.stdout?.pipe(process.stdout);
            child.stderr?.pipe(process.stderr);

            const result = await child;

            // eslint-disable-next-line no-control-regex
            const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\[?[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣷⣯⣟⡿⢿⣻⣽]+\]\s*/g, "");
            const stdout = stripAnsi(result.stdout || "").trim();
            const stderr = stripAnsi(result.stderr || "").trim();

            const hasTtyError = stdout.includes("Interactive prompts require a TTY terminal") ||
                               stderr.includes("Interactive prompts require a TTY terminal");

            if (result.exitCode !== 0 || hasTtyError) {
                logger.error(chalk.red(`\n✗ drizzle-kit ${action} failed.\n`));
                if (hasTtyError) {
                    logger.error(chalk.red("  Error: Interactive prompts require a TTY terminal."));
                    logger.error(chalk.gray("  Please run with --force to skip interactive prompts or run in an interactive terminal."));
                } else {
                    const errorOutput = stderr || stdout;
                    if (errorOutput) {
                        const lines = errorOutput.split("\n").filter((l: string) => l.trim());
                        let printedCount = 0;
                        for (const line of lines) {
                            if (line.toLowerCase().includes("error") || line.includes("cannot") || line.includes("already exists") || line.includes("does not exist") || line.includes("violates") || line.includes("permission denied")) {
                                logger.error(chalk.red(`  ${line.trim()}`));
                                printedCount++;
                            }
                        }
                        if (printedCount === 0) {
                            lines.slice(0, 10).forEach(line => logger.error(chalk.red(`  ${line.trim()}`)));
                        }
                    }
                }
                logger.error("");
                process.exit(1);
            }
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-control-regex
        const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\[?[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣷⣯⣟⡿⢿⣻⣽]+\]\s*/g, "");
        const cleaned = stripAnsi(msg).trim();
        const hasTtyError = cleaned.includes("Interactive prompts require a TTY terminal");
        logger.error(chalk.red(`\n✗ drizzle-kit ${action} failed.\n`));
        if (hasTtyError) {
            logger.error(chalk.red("  Error: Interactive prompts require a TTY terminal."));
            logger.error(chalk.gray("  Please run with --force to skip interactive prompts or run in an interactive terminal."));
        } else {
            const lines = cleaned.split("\n").filter((l: string) => l.trim());
            for (const line of lines) {
                if (line.toLowerCase().includes("error") || line.includes("cannot") || line.includes("already exists") || line.includes("does not exist") || line.includes("violates")) {
                    logger.error(chalk.red(`  ${line.trim()}`));
                }
            }
            if (lines.length === 0) {
                logger.error(chalk.gray(`  ${cleaned}`));
            }
        }
        logger.error("");
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
        // If installed in node_modules, __dirname is node_modules/@rebasepro/server-postgresql/dist or src.
        const generatorScript = path.join(__dirname, "schema", "generate-drizzle-schema.ts");
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

        const introspectScript = path.join(__dirname, "schema", "introspect-db.ts");
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

    const doctorScript = path.join(__dirname, "schema", "doctor-cli.ts");
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
import fsSync from "fs";
const argv1Real = process.argv[1] ? fsSync.realpathSync(process.argv[1]) : "";
if (import.meta.url === `file://${argv1Real}`) {
    // Drop node and script path
    runPluginCommand(process.argv.slice(2)).catch(() => process.exit(1));
}

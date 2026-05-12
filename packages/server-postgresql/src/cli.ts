import arg from "arg";
import chalk from "chalk";
import execa from "execa";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveLocalBin(binName: string): string | null {
    let cwd = process.cwd();
    // Try to find node_modules/.bin upwards
    while (cwd !== "/") {
        const candidate = path.join(cwd, "node_modules", ".bin", binName);
        if (fs.existsSync(candidate)) return candidate;
        cwd = path.dirname(cwd);
    }
    // Fall back to globally installed binary via which
    try {
        const globalPath = execSync(`which ${binName}`, { encoding: "utf-8" }).trim();
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
        console.error(chalk.red(`Unknown domain command: ${domain}`));
        process.exit(1);
    }
}

async function dbCommand(subcommand: string, rawArgs: string[]): Promise<void> {
    const VALID_ACTIONS = ["push", "pull", "generate", "migrate", "studio", "branch"];
    if (!subcommand || !VALID_ACTIONS.includes(subcommand)) {
        console.error(chalk.red(`Unknown db command. Valid: ${VALID_ACTIONS.join(", ")}`));
        process.exit(1);
    }

    if (subcommand === "branch") {
        await branchCommand(rawArgs);
        return;
    }

    if (subcommand === "generate") {
        console.log("");
        console.log(chalk.bold("  📦 Rebase DB Generate"));
        console.log(chalk.gray("  Step 1/2: Generating Drizzle schema from collections..."));
        console.log("");
        await schemaCommand("generate", rawArgs);
        console.log("");
        console.log(chalk.gray("  Step 2/2: Generating SQL migration files..."));
        console.log("");
        await runDrizzleKit("generate", rawArgs);
        await fixMigrationStatementOrder();
        console.log("");
        console.log(`  You can now run ${chalk.bold.green("rebase db migrate")} to apply the migrations to your database.`);
        console.log("");
    } else {
        console.log("");
        console.log(chalk.bold(`  🗄️  Rebase DB ${subcommand.charAt(0).toUpperCase() + subcommand.slice(1)}`));
        console.log("");

        if (subcommand === "push") {
            console.log(chalk.gray("  Step 1/2: Generating Drizzle schema from collections..."));
            console.log("");
            await schemaCommand("generate", rawArgs);
            console.log("");
            console.log(chalk.gray("  Step 2/2: Pushing schema to database..."));
            console.log("");
            await runDrizzleKit("push", rawArgs);
        } else if (subcommand === "migrate") {
            await runDrizzleKit("migrate", rawArgs);
        } else {
            await runDrizzleKit(subcommand, rawArgs);
        }

        console.log("");
        console.log(chalk.green(`  ✓ rebase db ${subcommand} completed successfully.`));
        console.log("");
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
        console.error(chalk.red("✗ DATABASE_URL is not set. Make sure your .env file is configured."));
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
                    console.error(chalk.red("✗ Branch name is required."));
                    console.log(chalk.gray("  Usage: rebase db branch create <name> [--from <source>]"));
                    process.exit(1);
                }
                let source: string | undefined;
                const fromIdx = rawArgs.indexOf("--from");
                if (fromIdx !== -1 && rawArgs[fromIdx + 1]) {
                    source = rawArgs[fromIdx + 1];
                }
                console.log("");
                console.log(chalk.bold("  🌿 Creating database branch..."));
                console.log(chalk.gray(`  Name:   ${name}`));
                if (source) console.log(chalk.gray(`  Source: ${source}`));
                console.log("");
                const branch = await branchService.createBranch(name, source ? { source } : undefined);
                console.log(chalk.green(`  ✓ Branch "${branch.name}" created successfully.`));
                console.log(chalk.gray(`    Database: rb_${branch.name}`));
                console.log(chalk.gray(`    Parent:   ${branch.parentDatabase}`));
                console.log("");
                break;
            }

            case "list": {
                const branches = await branchService.listBranches();
                console.log("");
                if (branches.length === 0) {
                    console.log(chalk.gray("  No branches found. Create one with: rebase db branch create <name>"));
                } else {
                    console.log(chalk.bold(`  🌿 ${branches.length} branch(es):`));
                    console.log("");
                    for (const b of branches) {
                        const size = b.sizeBytes != null
                            ? chalk.gray(` (${formatBytes(b.sizeBytes)})`)
                            : "";
                        const age = chalk.gray(` — created ${timeAgo(b.createdAt)}`);
                        console.log(`  ${chalk.green("●")} ${chalk.bold(b.name)}${size}${age}`);
                        console.log(chalk.gray(`    from ${b.parentDatabase}`));
                    }
                }
                console.log("");
                break;
            }

            case "delete": {
                const name = rawArgs[3];
                if (!name) {
                    console.error(chalk.red("✗ Branch name is required."));
                    console.log(chalk.gray("  Usage: rebase db branch delete <name>"));
                    process.exit(1);
                }
                console.log("");
                console.log(chalk.bold(`  🗑️  Deleting branch "${name}"...`));
                await branchService.deleteBranch(name);
                console.log(chalk.green(`  ✓ Branch "${name}" deleted.`));
                console.log("");
                break;
            }

            case "info": {
                const name = rawArgs[3];
                if (!name) {
                    console.error(chalk.red("✗ Branch name is required."));
                    console.log(chalk.gray("  Usage: rebase db branch info <name>"));
                    process.exit(1);
                }
                const info = await branchService.getBranchInfo(name);
                console.log("");
                if (!info) {
                    console.error(chalk.red(`  ✗ Branch "${name}" not found.`));
                } else {
                    console.log(chalk.bold(`  🌿 Branch: ${info.name}`));
                    console.log(chalk.gray(`    Database: rb_${info.name}`));
                    console.log(chalk.gray(`    Parent:   ${info.parentDatabase}`));
                    console.log(chalk.gray(`    Created:  ${info.createdAt.toISOString()}`));
                    if (info.sizeBytes != null) {
                        console.log(chalk.gray(`    Size:     ${formatBytes(info.sizeBytes)}`));
                    }
                }
                console.log("");
                break;
            }

            default:
                console.error(chalk.red(`Unknown branch action: "${branchAction}".`));
                printBranchHelp();
                process.exit(1);
        }
    } finally {
        await poolManager.shutdown();
        await pool.end();
    }
}

function printBranchHelp() {
    console.log(`
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
    const content = fs.readFileSync(latestFile, "utf-8");
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

    if (!needsReorder) return;

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

    console.log(chalk.yellow(`  ⚠ Reordered migration statements in ${sqlFiles[0].name} (DROP POLICY before ALTER COLUMN)`));
}

async function runDrizzleKit(action: string, _rawArgs: string[]): Promise<void> {
    const drizzleKitBin = resolveLocalBin("drizzle-kit");
    if (!drizzleKitBin) {
        console.error(chalk.red("✗ Could not find drizzle-kit binary."));
        console.error(chalk.gray("  Install it with: pnpm add -D drizzle-kit"));
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
                    Object.assign(env, parsed.parsed);
                    break;
                }
            }
        }
    } catch {
        // dotenv may not be available — fall through
    }

    const interactive = ["generate", "push"].includes(action);

    // For push: always use --strict (prompts before destructive ops) and --verbose
    // (shows all SQL). This ensures unmapped tables are never silently dropped.
    const drizzleKitArgs = [action];
    if (action === "push") {
        drizzleKitArgs.push("--strict", "--verbose");
    }

    try {
        if (interactive) {
            await execa(drizzleKitBin, drizzleKitArgs, {
                cwd: process.cwd(),
                stdio: "inherit",
                env
            });
        } else {
            const child = execa(drizzleKitBin, [action], {
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

            if (result.exitCode !== 0) {
                console.error(chalk.red(`\n✗ drizzle-kit ${action} failed.\n`));
                const errorOutput = stderr || stdout;
                if (errorOutput) {
                    const lines = errorOutput.split("\n").filter((l: string) => l.trim());
                    for (const line of lines) {
                        if (line.toLowerCase().includes("error") || line.includes("cannot") || line.includes("already exists") || line.includes("does not exist") || line.includes("violates") || line.includes("permission denied")) {
                            console.error(chalk.red(`  ${line.trim()}`));
                        }
                    }
                }
                console.error("");
                process.exit(1);
            }
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-control-regex
        const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\[?[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣷⣯⣟⡿⢿⣻⣽]+\]\s*/g, "");
        const cleaned = stripAnsi(msg).trim();
        console.error(chalk.red(`\n✗ drizzle-kit ${action} failed.\n`));
        const lines = cleaned.split("\n").filter((l: string) => l.trim());
        for (const line of lines) {
            if (line.toLowerCase().includes("error") || line.includes("cannot") || line.includes("already exists") || line.includes("does not exist") || line.includes("violates")) {
                console.error(chalk.red(`  ${line.trim()}`));
            }
        }
        if (lines.length === 0) {
            console.error(chalk.gray(`  ${cleaned}`));
        }
        console.error("");
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
            console.error(chalk.red(`✗ Could not find generate-drizzle-schema.ts at ${generatorScript}`));
            process.exit(1);
        }

        const tsxBin = resolveLocalBin("tsx");
        if (!tsxBin) {
            console.error(chalk.red("✗ Could not find tsx binary."));
            process.exit(1);
        }

        const collectionsPath = argsList["--collections"] || path.join("..", "shared", "collections");
        const outputPath = argsList["--output"] || path.join("src", "schema.generated.ts");
        const watch = argsList["--watch"] || false;

        console.log("");
        console.log(chalk.bold("  🔧 Rebase Schema Generator"));
        console.log("");

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
            console.error(chalk.red(`✗ Failed to run schema generator: ${err instanceof Error ? err.message : String(err)}`));
            process.exit(1);
        }
    } else if (subcommand === "introspect") {
        const argsList = arg(
            {
                "--output": String,
                "--force": Boolean,
                "--schema": String,
                "-o": "--output",
                "-f": "--force"
            },
            {
                argv: rawArgs.slice(2),
                permissive: true
            }
        );

        const introspectScript = path.join(__dirname, "schema", "introspect-db.ts");
        if (!fs.existsSync(introspectScript)) {
            console.error(chalk.red(`✗ Could not find introspect-db.ts at ${introspectScript}`));
            process.exit(1);
        }

        const tsxBin = resolveLocalBin("tsx");
        if (!tsxBin) {
            console.error(chalk.red("✗ Could not find tsx binary."));
            process.exit(1);
        }

        const outputPath = argsList["--output"] || path.join("..", "config", "collections");

        console.log("");
        console.log(chalk.bold("  🔍 Rebase Schema Introspector"));
        console.log("");

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
            console.error(chalk.red(`✗ Failed to run schema introspector: ${err instanceof Error ? err.message : String(err)}`));
            process.exit(1);
        }
    } else {
        console.error(chalk.red("Unknown schema command."));
        process.exit(1);
    }
}

async function doctorPluginCommand(rawArgs: string[]): Promise<void> {
    const parsedArgs = arg(
        {
            "--collections": String,
            "--schema": String,
            "-c": "--collections",
            "-s": "--schema"
        },
        {
            argv: rawArgs.slice(1), // skip "doctor"
            permissive: true
        }
    );

    const doctorScript = path.join(__dirname, "schema", "doctor-cli.ts");
    if (!fs.existsSync(doctorScript)) {
        console.error(chalk.red(`✗ Could not find doctor.ts at ${doctorScript}`));
        process.exit(1);
    }

    const tsxBin = resolveLocalBin("tsx");
    if (!tsxBin) {
        console.error(chalk.red("✗ Could not find tsx binary."));
        process.exit(1);
    }

    const collectionsPath = parsedArgs["--collections"] || path.join("..", "shared", "collections");
    const schemaPath = parsedArgs["--schema"] || path.join("src", "schema.generated.ts");

    const cmdParts = [
        tsxBin,
        doctorScript,
        `--collections=${collectionsPath}`,
        `--schema=${schemaPath}`
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

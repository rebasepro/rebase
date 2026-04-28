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
        console.log("");
        console.log(`  You can now run ${chalk.bold.green("rebase db migrate")} to apply the migrations to your database.`);
        console.log("");
    } else {
        // For push/pull/migrate/studio, print a clear header so the user
        // sees output even when drizzle-kit itself is quiet.
        console.log("");
        console.log(chalk.bold(`  🗄️  Rebase DB ${subcommand.charAt(0).toUpperCase() + subcommand.slice(1)}`));
        console.log("");
        await runDrizzleKit(subcommand, rawArgs);
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

    const pool = new Pool({ connectionString: databaseUrl, max: 3 });
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

async function runDrizzleKit(action: string, _rawArgs: string[]): Promise<void> {
    const drizzleKitBin = resolveLocalBin("drizzle-kit");
    if (!drizzleKitBin) {
        console.error(chalk.red("✗ Could not find drizzle-kit binary."));
        console.error(chalk.gray("  Install it with: pnpm add -D drizzle-kit"));
        process.exit(1);
    }

    try {
        await execa(drizzleKitBin, [action], {
            cwd: process.cwd(),
            stdio: "inherit",
            env: { ...process.env as Record<string, string> },
        });
    } catch (err: unknown) {
        console.error(chalk.red(`✗ Failed to run drizzle-kit ${action}: ${err instanceof Error ? err.message : String(err)}`));
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
                "-w": "--watch",
            },
            {
                argv: rawArgs.slice(2), // db generate ... or schema generate ...
                permissive: true,
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
            `--output=${outputPath}`,
        ];
        if (watch) {
            cmdParts.push("--watch");
        }

        try {
            await execa(cmdParts[0], cmdParts.slice(1), {
                cwd: process.cwd(),
                stdio: "inherit",
                env: { ...process.env as Record<string, string> },
            });
        } catch (err: unknown) {
            console.error(chalk.red(`✗ Failed to run schema generator: ${err instanceof Error ? err.message : String(err)}`));
            process.exit(1);
        }
    } else {
        console.error(chalk.red(`Unknown schema command.`));
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

/**
 * CLI command: rebase doctor
 *
 * Detects three-way schema drift between collection definitions,
 * the generated Drizzle schema, and the live PostgreSQL database.
 */
import chalk from "chalk";
import { execa } from "execa";
import {
    requireProjectRoot,
    requireBackendDir,
    getActiveBackendPlugin,
    resolvePluginCliScript,
    resolveTsx,
    findEnvFile
} from "../utils/project";

/**
 * `--help` is answered before the project guard, not after.
 *
 * `doctor` declared no `--help` at all, so the flag fell through to the command
 * body and hit `requireProjectRoot()` — and `rebase doctor --help` outside a
 * project answered "✗ Could not find a Rebase project root." Asking a command
 * what it does is the one question that cannot require being somewhere
 * particular to ask.
 */
function printDoctorHelp(): void {
    console.log(`
${chalk.bold("rebase doctor")} — Detect drift between collections, schema and database

${chalk.green.bold("Usage")}
  rebase doctor

Compares the collections you declare, the generated Drizzle schema, and the
tables that actually exist, then reports what disagrees and how to reconcile it.

Run from inside a Rebase project — it reads the project's collections and
connects to its database.
`);
}

export async function doctorCommand(rawArgs: string[]): Promise<void> {
    if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
        printDoctorHelp();
        return;
    }

    const projectRoot = requireProjectRoot();
    const backendDir = requireBackendDir(projectRoot);

    const activePlugin = getActiveBackendPlugin(backendDir);
    if (!activePlugin) {
        console.error(chalk.red("✗ Could not detect an active database plugin."));
        console.error(chalk.gray("  Make sure a package like @rebasepro/server-postgres is installed in backend/package.json."));
        process.exit(1);
    }

    const pluginCli = resolvePluginCliScript(backendDir, activePlugin);
    if (!pluginCli) {
        console.error(chalk.red(`✗ Could not find CLI entry point for ${activePlugin}.`));
        process.exit(1);
    }

    // Set up environment with DOTENV_CONFIG_PATH
    const envFile = findEnvFile(projectRoot);
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (envFile) {
        env.DOTENV_CONFIG_PATH = envFile;
    }

    try {
        const isTs = pluginCli.endsWith(".ts");
        if (isTs) {
            const tsxBin = resolveTsx(projectRoot);
            if (!tsxBin) {
                console.error(chalk.red("✗ Could not find tsx binary."));
                process.exit(1);
            }
            await execa(tsxBin, [pluginCli, ...rawArgs.slice(2)], {
                cwd: backendDir,
                stdio: "inherit",
                env
            });
        } else {
            await execa("node", [pluginCli, ...rawArgs.slice(2)], {
                cwd: backendDir,
                stdio: "inherit",
                env
            });
        }
    } catch {
        // If the process exits with an error code, execa will throw,
        // but inherit stdio means the user already saw the output.
        process.exit(1);
    }
}

/**
 * CLI command: rebase doctor
 *
 * Detects three-way schema drift between collection definitions,
 * the generated Drizzle schema, and the live PostgreSQL database.
 */
import chalk from "chalk";
import execa from "execa";
import {
    requireProjectRoot,
    requireBackendDir,
    getActiveBackendPlugin,
    resolvePluginCliScript,
    resolveTsx,
    findEnvFile
} from "../utils/project";

export async function doctorCommand(rawArgs: string[]): Promise<void> {
    const projectRoot = requireProjectRoot();
    const backendDir = requireBackendDir(projectRoot);

    const activePlugin = getActiveBackendPlugin(backendDir);
    if (!activePlugin) {
        console.error(chalk.red("✗ Could not detect an active database plugin."));
        console.error(chalk.gray("  Make sure a package like @rebasepro/server-postgresql is installed in backend/package.json."));
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
                env,
            });
        } else {
            await execa("node", [pluginCli, ...rawArgs.slice(2)], {
                cwd: backendDir,
                stdio: "inherit",
                env,
            });
        }
    } catch {
        // If the process exits with an error code, execa will throw,
        // but inherit stdio means the user already saw the output.
        process.exit(1);
    }
}

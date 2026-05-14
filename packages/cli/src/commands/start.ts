/**
 * CLI command: rebase start
 *
 * Starts the backend server in production mode.
 * Automatically detects the package manager (pnpm or npm) and
 * runs the start script in the backend workspace.
 */
import chalk from "chalk";
import execa from "execa";
import { requireProjectRoot, findEnvFile } from "../utils/project";
import { detectPackageManager, getPMCommands } from "../utils/package-manager";

export async function startCommand(): Promise<void> {
    const projectRoot = requireProjectRoot();
    const pm = detectPackageManager(projectRoot);
    const cmds = getPMCommands(pm);

    const startCmd = cmds.runWorkspace("backend", "start");

    // Set up environment with DOTENV_CONFIG_PATH
    const envFile = findEnvFile(projectRoot);
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (envFile) {
        env.DOTENV_CONFIG_PATH = envFile;
    }

    console.log(`${chalk.bold("Rebase")} — Starting backend server...\n`);

    try {
        await execa(startCmd[0], startCmd.slice(1), {
            cwd: projectRoot,
            stdio: "inherit",
            env
        });
    } catch {
        console.error(chalk.red("\n✗ Failed to start server."));
        process.exit(1);
    }
}

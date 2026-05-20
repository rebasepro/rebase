/**
 * CLI command: rebase build
 *
 * Runs the build script in all workspace packages.
 * Automatically detects the package manager (pnpm or npm) and
 * uses the correct workspace-aware command.
 */
import chalk from "chalk";
import { execa } from "execa";
import { requireProjectRoot } from "../utils/project";
import { detectPackageManager, getPMCommands } from "../utils/package-manager";

export async function buildCommand(): Promise<void> {
    const projectRoot = requireProjectRoot();
    const pm = detectPackageManager(projectRoot);
    const cmds = getPMCommands(pm);

    const buildCmd = cmds.runAll("build");

    console.log(`${chalk.bold("Rebase")} — Building all workspaces with ${chalk.cyan(pm)}...\n`);

    try {
        await execa(buildCmd[0], buildCmd.slice(1), {
            cwd: projectRoot,
            stdio: "inherit"
        });
    } catch {
        console.error(chalk.red("\n✗ Build failed."));
        process.exit(1);
    }
}

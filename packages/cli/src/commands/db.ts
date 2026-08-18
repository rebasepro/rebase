/**
 * CLI command: rebase db <action>
 */
import chalk from "chalk";
import path from "path";
import { execa } from "execa";
import {
    requireProjectRoot,
    requireBackendDir,
    getActiveBackendPlugin,
    resolvePluginCliScript,
    resolveTsx,
    findEnvFile
} from "../utils/project";
import { recordEvent } from "../telemetry";

/**
 * A destination that names a remote store rather than a local path.
 *
 * Matched as "scheme://" generally, not as a list of the schemes we support:
 * an unknown scheme is still not something to join onto a filesystem path, and
 * a Windows drive letter ("C:\backups") has no "//" so it stays a path.
 */
const REMOTE_DESTINATION_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Rewrite local path arguments so they mean what the user typed.
 *
 * The plugin CLI is spawned with `cwd: backendDir` — it has to be, because that
 * is where the plugin and its dependencies resolve from. But the developer runs
 * `rebase db` from the project root, so a relative `--out ./backups` was being
 * resolved against `backend/` and landed in `backend/backups`, while the
 * success line echoed the path as typed. The file was real and the reported
 * location was wrong, which is the worst way for a backup command to behave.
 * `rebase db --help` documents exactly this invocation.
 *
 * Absolutising here rather than inside the plugin keeps the fix where the cwd
 * is actually changed, and leaves the plugin usable on its own terms.
 */
export function absolutizeLocalPathArgs(args: string[], cwd: string): string[] {
    const takesPath = (flag: string) => flag === "--out" || flag === "-o";
    /**
     * Flags whose next token is a value, not a positional.
     *
     * Mirrors the `arg` specs in `@rebasepro/server-postgres`'s backup CLI.
     * Needed only to find the `db restore` dump argument: without it,
     * `restore --target-db app_restored ./x.dump` treats `app_restored` as the
     * positional — it is the first token not starting with `-` — and turns a
     * database name into a path while leaving the real dump path unresolved.
     */
    const VALUE_FLAGS = new Set([
        "--out", "-o", "--target-db", "--exclude-schema", "--row-security-role"
    ]);
    const out = [...args];

    for (let i = 0; i < out.length; i++) {
        const arg = out[i];

        // `--out=<value>`
        const eq = arg.indexOf("=");
        if (eq > 0 && takesPath(arg.slice(0, eq))) {
            const value = arg.slice(eq + 1);
            if (value && !REMOTE_DESTINATION_RE.test(value)) {
                out[i] = `${arg.slice(0, eq)}=${path.resolve(cwd, value)}`;
            }
            continue;
        }

        // `--out <value>`
        if (takesPath(arg)) {
            const value = out[i + 1];
            if (value && !value.startsWith("-") && !REMOTE_DESTINATION_RE.test(value)) {
                out[i + 1] = path.resolve(cwd, value);
                i++;
            }
        }
    }

    // `db restore <file>` — the dump to read is a positional, and a relative one
    // was resolved against `backend/` too, so the path printed by a preceding
    // `db backup` could not be pasted into `db restore`.
    const restoreAt = out.indexOf("restore");
    if (restoreAt !== -1) {
        for (let i = restoreAt + 1; i < out.length; i++) {
            const arg = out[i];
            if (arg.startsWith("-")) {
                // `--flag=value` carries its value inline; `--flag value` eats
                // the next token only when the flag actually takes one.
                if (!arg.includes("=") && VALUE_FLAGS.has(arg)) i++;
                continue;
            }
            // First true positional: the dump to restore.
            if (!REMOTE_DESTINATION_RE.test(arg)) out[i] = path.resolve(cwd, arg);
            break;
        }
    }

    return out;
}

export async function dbCommand(subcommand: string | undefined, rawArgs: string[]): Promise<void> {
    if (!subcommand || subcommand === "--help") {
        printDbHelp();
        return;
    }

    const projectRoot = requireProjectRoot();

    // Fire-and-forget, and a no-op unless the developer opted in. Never awaited:
    // the command is what the user is waiting for, and a slow collector must not
    // sit in front of it.
    void recordEvent("cli.db", { subcommand: subcommand ?? "none" }, { projectRoot });
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

    // Resolved against the directory the developer is standing in, before the
    // child is handed a different one. See absolutizeLocalPathArgs.
    const childArgs = absolutizeLocalPathArgs(rawArgs.slice(2), process.cwd());

    try {
        const isTs = pluginCli.endsWith(".ts");
        if (isTs) {
            const tsxBin = resolveTsx(projectRoot);
            if (!tsxBin) {
                console.error(chalk.red("✗ Could not find tsx binary."));
                process.exit(1);
            }
            await execa(tsxBin, [pluginCli, ...childArgs], {
                cwd: backendDir,
                stdio: "inherit",
                env
            });
        } else {
            await execa("node", [pluginCli, ...childArgs], {
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

function printDbHelp() {
    console.log(`
${chalk.bold("rebase db")} — Database management commands

${chalk.green.bold("Usage")}
  rebase db ${chalk.blue("<command>")} [options]

${chalk.green.bold("Commands")}
  ${chalk.gray("(Commands are provided by your active database driver plugin)")}
  ${chalk.blue.bold("push")}       Apply schema directly to database (development)
  ${chalk.blue.bold("generate")}   Generate migration files
  ${chalk.blue.bold("migrate")}    Run pending migrations
  ${chalk.blue.bold("branch")}     Database branching (create, list, delete, info)
  ${chalk.blue.bold("backup")}     Create a backup with pg_dump (--out <path|s3://…>)
  ${chalk.blue.bold("restore")}    Restore a backup with pg_restore (destructive; needs --yes)
  ${chalk.blue.bold("backups")}    List stored backups (backups list)

${chalk.green.bold("Examples")}
  ${chalk.gray("# Quick development workflow")}
  rebase schema generate && rebase db push

  ${chalk.gray("# Production migration workflow")}
  rebase db generate
  rebase db migrate

  ${chalk.gray("# Create a database branch")}
  rebase db branch create feature_auth

  ${chalk.gray("# Back up to a local directory, then to object storage")}
  rebase db backup --out ./backups
  rebase db backup --out s3://my-private-bucket/backups

  ${chalk.gray("# Restore into a fresh database (safe: does not touch the live one)")}
  rebase db restore ./backups/rebase-app-20260714T030000Z.dump --create-db --target-db app_restored
`);
}
